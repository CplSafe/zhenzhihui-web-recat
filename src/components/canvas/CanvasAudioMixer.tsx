import { useEffect, useRef, useState } from 'react'
import { assetStreamUrl } from '@/utils/assetUrl'
import { normalizeAudioSettings, type TimelineAudioClip } from '@/utils/canvasAudio'
import { useToast } from '@/composables/useToast'
import styles from './CanvasAudioMixer.module.css'

const LANES = [
  { key: 'voice', label: '人声', color: '#6297da' },
  { key: 'bgm', label: 'BGM', color: '#43a783' },
] as const
const LEGACY_SFX_LANE = { key: 'sfx', label: '历史音效', color: '#b98a46' } as const
const PREVIEW_TIMEOUT_MS = 30_000
export default function CanvasAudioMixer({
  clips,
  duration,
  workspaceId,
  onChange,
  playheadSec,
  playing,
  addableSources = [],
  onAddAudio,
  originalAudioVolume = 1,
  onOriginalAudioVolumeChange,
  onPreviewReadyChange,
  onSoloChange,
  onPreviewPlay,
}: {
  clips: TimelineAudioClip[]
  duration: number
  workspaceId: number
  onChange: (clips: TimelineAudioClip[]) => void
  playheadSec: number
  playing: boolean
  addableSources?: ReadonlyArray<{ nodeId: string; label: string }>
  onAddAudio?: (sourceNodeId: string) => void
  originalAudioVolume?: number
  onOriginalAudioVolumeChange?: (volume: number) => void
  onPreviewReadyChange?: (ready: boolean) => void
  onSoloChange?: (solo: boolean) => void
  onPreviewPlay?: (start: (() => Promise<boolean>) | null) => void
}) {
  const [busy, setBusy] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [preview, setPreview] = useState('')
  const [previewError, setPreviewError] = useState('')
  const [previewVersion, setPreviewVersion] = useState(0)
  const [solo, setSolo] = useState('')
  const [mediaReady, setMediaReady] = useState(false)
  const lanes = clips.some((clip) => clip.lane === 'sfx') ? [...LANES, LEGACY_SFX_LANE] : [...LANES]
  const audio = useRef<HTMLAudioElement>(null)
  const requestRef = useRef(0)
  const cacheRef = useRef(new Map<string, AudioBuffer>())
  const playPendingRef = useRef(false)
  const playBlockedRef = useRef(false)
  const { showToast } = useToast()
  const voiceDuration = clips
    .filter((clip) => clip.lane === 'voice' && !clip.muted)
    .reduce(
      (total, clip) => total + Math.min(Math.max(0, clip.outSec - clip.inSec), Math.max(0, duration - clip.startSec)),
      0,
    )
  const bgmCount = clips.filter((clip) => clip.lane === 'bgm').length
  const tickCount = Math.min(10, Math.max(1, Math.ceil(duration / 3)))
  useEffect(() => {
    requestRef.current += 1
    setPreview('')
    setMediaReady(false)
    playPendingRef.current = false
    playBlockedRef.current = false
    setPreviewError('')
    const canPrepare = clips.length > 0 && duration > 0
    setPreparing(canPrepare)
    let cancelled = false
    let url = ''
    const controller = new AbortController()
    const timeout = canPrepare
      ? setTimeout(() => {
          cancelled = true
          controller.abort()
          setPreparing(false)
          setPreviewError('音频试听准备超时')
        }, PREVIEW_TIMEOUT_MS)
      : undefined
    // 合并连续的参数编辑，避免每次滑条变化都解码整条音轨。
    const timer = setTimeout(() => {
      if (!canPrepare) return
      void (async () => {
        try {
          const { renderAudioMix, audioBufferToWav } = await import('@/utils/audioMix')
          if (cancelled) return
          const output = !solo ? clips : clips.map((clip) => ({ ...clip, muted: clip.muted || clip.lane !== solo }))
          const buffer = await renderAudioMix(output, duration, workspaceId, undefined, 1, {
            signal: controller.signal,
            cache: cacheRef.current,
          })
          if (cancelled) return
          url = URL.createObjectURL(audioBufferToWav(buffer))
          setPreview(url)
        } catch (e: any) {
          if (!cancelled) {
            const message = e?.message || '音频试听准备失败'
            setPreviewError(message)
            showToast(message, 'error')
          }
        } finally {
          clearTimeout(timeout)
          if (!cancelled) setPreparing(false)
        }
      })()
    }, 200)
    return () => {
      cancelled = true
      controller.abort()
      clearTimeout(timer)
      clearTimeout(timeout)
      requestRef.current += 1
      if (url) URL.revokeObjectURL(url)
    }
  }, [clips, duration, workspaceId, solo, previewVersion, showToast])
  useEffect(() => {
    if (!preview || mediaReady || previewError) return
    const timer = setTimeout(() => {
      setPreviewError('音频试听加载超时')
    }, PREVIEW_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [preview, mediaReady, previewError])
  useEffect(() => {
    cacheRef.current.clear()
  }, [workspaceId])
  useEffect(() => {
    onPreviewReadyChange?.(!clips.length || (mediaReady && !preparing && !previewError))
  }, [clips.length, mediaReady, preparing, previewError, onPreviewReadyChange])
  useEffect(() => {
    onSoloChange?.(Boolean(solo))
    return () => onSoloChange?.(false)
  }, [solo, onSoloChange])
  const startAudio = async (): Promise<boolean> => {
    const player = audio.current
    if (!clips.length) return true
    if (!player || !mediaReady) return false
    const request = requestRef.current
    playBlockedRef.current = false
    try {
      player.currentTime = playheadSec >= duration ? 0 : playheadSec
      await player.play()
      if (request !== requestRef.current || audio.current !== player) {
        player.pause()
        return false
      }
      return true
    } catch {
      if (request !== requestRef.current || audio.current !== player) return false
      playBlockedRef.current = true
      setPreviewError('音频未能播放')
      showToast('音频未能播放，请重试试听后重新点击播放', 'info')
      return false
    }
  }
  const startAudioRef = useRef(startAudio)
  startAudioRef.current = startAudio
  useEffect(() => {
    onPreviewPlay?.(() => startAudioRef.current())
    return () => onPreviewPlay?.(null)
  }, [onPreviewPlay])
  const syncAudio = () => {
    const player = audio.current
    if (!player || !preview) return
    if (previewError) {
      player.pause()
      return
    }
    try {
      if (Math.abs(player.currentTime - playheadSec) > 0.25) player.currentTime = playheadSec
    } catch {
      // 元数据未加载时不能定位，loadedmetadata 会再同步一次。
    }
    if (playing && player.paused && !playPendingRef.current && !playBlockedRef.current) {
      playPendingRef.current = true
      const request = requestRef.current
      void player
        .play()
        .catch(() => {
          if (request !== requestRef.current || audio.current !== player) return
          playBlockedRef.current = true
          setPreviewError('音频播放失败或被浏览器阻止')
          showToast('音频播放失败，请重试试听后重新点击播放', 'info')
        })
        .finally(() => {
          if (request === requestRef.current) playPendingRef.current = false
        })
    } else if (!playing) player.pause()
  }
  const syncAudioRef = useRef(syncAudio)
  syncAudioRef.current = syncAudio
  useEffect(() => {
    const player = audio.current
    syncAudioRef.current()
    return () => {
      player?.pause()
    }
  }, [preview, playing, previewError])
  useEffect(() => {
    syncAudioRef.current()
  }, [playheadSec])
  const update = (clip: TimelineAudioClip, patch: Record<string, unknown>) =>
    onChange(
      clips.map((item) =>
        item.sourceNodeId === clip.sourceNodeId ? { ...item, ...normalizeAudioSettings({ ...item, ...patch }) } : item,
      ),
    )
  const prepare = async (download: boolean) => {
    if (!download) {
      setPreviewVersion((version) => version + 1)
      return
    }
    if (busy) return
    const request = ++requestRef.current
    setBusy(true)
    try {
      const { renderAudioMix, audioBufferToWav } = await import('@/utils/audioMix')
      const output =
        download || !solo ? clips : clips.map((clip) => ({ ...clip, muted: clip.muted || clip.lane !== solo }))
      const buffer = await renderAudioMix(output, duration, workspaceId, undefined, 1, { cache: cacheRef.current })
      if (request !== requestRef.current) return
      const blob = audioBufferToWav(buffer)
      const url = URL.createObjectURL(blob)
      if (download) {
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = `混音-${Date.now()}.wav`
        anchor.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
    } catch (e: any) {
      if (request === requestRef.current) showToast(e?.message || '混音失败', 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className={styles.mixer} aria-label="音频混音台">
      <div className={styles.heading}>
        <div>
          <strong>音频剪辑与混音</strong>
          <p>添加画布音频，裁剪后混入当前成片；源音频不会被改动</p>
        </div>
        <div className={styles.actions}>
          {onAddAudio && (
            <select
              aria-label="添加画布音频"
              value=""
              disabled={!addableSources.length}
              onChange={(event) => {
                if (event.target.value) onAddAudio(event.target.value)
              }}
            >
              <option value="">＋ 添加音频</option>
              {addableSources.map((source) => (
                <option key={source.nodeId} value={source.nodeId}>
                  {source.label}
                </option>
              ))}
            </select>
          )}
          {previewError && (
            <button
              type="button"
              disabled={busy || preparing || !clips.length || duration <= 0}
              onClick={() => void prepare(false)}
            >
              重试试听
            </button>
          )}
          <button type="button" disabled={busy || !clips.length || duration <= 0} onClick={() => void prepare(true)}>
            导出混音 WAV
          </button>
        </div>
      </div>
      <div className={styles.summary} aria-label="混音概览">
        <div>
          <small>画面时长</small>
          <strong>{duration.toFixed(1)} 秒</strong>
        </div>
        <div>
          <small>人声占位</small>
          <strong>
            {voiceDuration.toFixed(1)} / {duration.toFixed(1)} 秒
          </strong>
        </div>
        <div>
          <small>BGM 轨</small>
          <strong>{bgmCount ? `${bgmCount} 条 · 可循环` : '未添加'}</strong>
        </div>
      </div>
      <div className={styles.ruler} aria-label="音频时间刻度">
        {Array.from({ length: tickCount + 1 }, (_, index) => (
          <span key={index}>{((duration * index) / tickCount).toFixed(0)}s</span>
        ))}
      </div>
      <div className={styles.originalLane}>
        <div>
          <strong>原视频声音</strong>
          <span>跟随画面轨</span>
        </div>
        <label>
          音量 {Math.round(originalAudioVolume * 100)}%
          <input
            aria-label="原视频声音音量"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={originalAudioVolume}
            onChange={(event) => onOriginalAudioVolumeChange?.(Number(event.target.value))}
          />
        </label>
        <button type="button" onClick={() => onOriginalAudioVolumeChange?.(originalAudioVolume ? 0 : 1)}>
          {originalAudioVolume ? '静音原声' : '开启原声'}
        </button>
      </div>
      {preparing && (
        <p className={styles.stalePreview} role="status">
          正在自动准备音频试听，就绪后会跟随上方视频播放。
        </p>
      )}
      {previewError && (
        <p className={styles.stalePreview} role="alert">
          {previewError}，请重试试听。
        </p>
      )}
      {preview && (
        <>
          <audio
            ref={audio}
            src={preview}
            preload="auto"
            onLoadedMetadata={syncAudio}
            onCanPlay={() => {
              if (previewError) return
              setMediaReady(true)
              syncAudio()
            }}
            onError={() => {
              setMediaReady(false)
              setPreviewError('音频试听加载失败')
            }}
          />
          {!previewError && (
            <p className={styles.note} role="status" aria-live="polite">
              {mediaReady ? '试听已就绪，播放或拖动上方视频时音轨同步。' : '试听文件已生成，正在加载音频，请稍候。'}
            </p>
          )}
        </>
      )}
      {lanes.map((lane) => (
        <div key={lane.key} className={styles.lane}>
          <div className={styles.laneTitle}>
            <i style={{ background: lane.color }} />
            {lane.label}
            <button
              type="button"
              aria-pressed={solo === lane.key}
              onClick={() => setSolo((value) => (value === lane.key ? '' : lane.key))}
            >
              {solo === lane.key ? '取消独听' : `独听${lane.label}`}
            </button>
          </div>
          {clips
            .filter((clip) => clip.lane === lane.key)
            .some((clip, index, sameLane) =>
              sameLane.slice(index + 1).some((other) => {
                const end = clip.loop ? duration : clip.startSec + clip.outSec - clip.inSec
                const otherEnd = other.loop ? duration : other.startSec + other.outSec - other.inSec
                return clip.startSec < otherEnd && other.startSec < end
              }),
            ) && (
            <p className={styles.warning}>
              同轨存在重叠音频，请调整起始位置或改派轨道；重叠片段会同时混音，不会覆盖源素材。
            </p>
          )}
          <div className={styles.clips}>
            {clips
              .filter((clip) => clip.lane === lane.key)
              .map((clip) => {
                const available = clip.outSec - clip.inSec
                const occupied = clip.loop
                  ? Math.max(0, duration - clip.startSec)
                  : Math.min(available, Math.max(0, duration - clip.startSec))
                return (
                  <div className={styles.clip} key={clip.sourceNodeId}>
                    <div className={styles.clipHeader}>
                      <strong>{clip.title}</strong>
                      <span>
                        {clip.origin === 'generated'
                          ? 'AIGC · AI生成'
                          : clip.origin === 'licensed'
                            ? '已声明授权'
                            : '上传 · 授权待确认'}
                      </span>
                      <a href={assetStreamUrl(clip.assetId, workspaceId)} download>
                        下载源音频
                      </a>
                    </div>
                    <div className={styles.track}>
                      <div
                        style={{
                          left: `${duration ? (clip.startSec / duration) * 100 : 0}%`,
                          width: `${duration ? (occupied / duration) * 100 : 0}%`,
                          background: lane.color,
                        }}
                      >
                        {occupied.toFixed(1)}s{clip.loop ? ' · 循环' : ''}
                      </div>
                      <span style={{ left: `${duration ? Math.min(100, (playheadSec / duration) * 100) : 0}%` }} />
                    </div>
                    <label className={styles.positionSlider}>
                      片段位置 {clip.startSec.toFixed(1)} 秒
                      <input
                        aria-label={`${clip.title}时间轴位置`}
                        type="range"
                        min="0"
                        max={Math.max(0, duration)}
                        step="0.1"
                        value={Math.min(duration, clip.startSec)}
                        onChange={(event) => update(clip, { startSec: Number(event.target.value) })}
                      />
                    </label>
                    <div className={styles.controls}>
                      <label>
                        轨道
                        <select
                          aria-label={`${clip.title}轨道`}
                          value={clip.lane}
                          onChange={(e) => update(clip, { lane: e.target.value, loop: e.target.value === 'bgm' })}
                        >
                          {lanes.map((l) => (
                            <option value={l.key} key={l.key}>
                              {l.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      {(
                        [
                          { key: 'startSec', text: '起始位置' },
                          { key: 'inSec', text: '裁剪起点' },
                          { key: 'outSec', text: '裁剪终点' },
                          { key: 'fadeInSec', text: '淡入' },
                          { key: 'fadeOutSec', text: '淡出' },
                        ] as const
                      ).map(({ key, text }) => (
                        <label key={key}>
                          {text}（秒）
                          <input
                            aria-label={`${clip.title}${text}`}
                            type="number"
                            min="0"
                            step="0.1"
                            max={key === 'startSec' ? duration : clip.durationSec}
                            value={clip[key]}
                            onChange={(e) => update(clip, { [key]: Number(e.target.value) })}
                          />
                        </label>
                      ))}
                      <label>
                        音量 {Math.round(clip.volume * 100)}%
                        <input
                          aria-label={`${clip.title}音量`}
                          type="range"
                          min="0"
                          max="1"
                          step="0.01"
                          value={clip.volume}
                          onChange={(e) => update(clip, { volume: Number(e.target.value) })}
                        />
                      </label>
                      <label className={styles.check}>
                        <input
                          type="checkbox"
                          checked={clip.muted}
                          onChange={(e) => update(clip, { muted: e.target.checked })}
                        />
                        静音
                      </label>
                      {lane.key === 'bgm' && (
                        <label className={styles.check}>
                          <input
                            type="checkbox"
                            checked={clip.loop}
                            onChange={(e) => update(clip, { loop: e.target.checked })}
                          />
                          循环铺满
                        </label>
                      )}
                    </div>
                    {!clip.loop && available > duration - clip.startSec && (
                      <p className={styles.warning}>
                        音频长于剩余画面，输出将在画面结束处裁断。请缩短人声文案或调整裁剪；不会自动修改上游内容。
                      </p>
                    )}
                  </div>
                )
              })}
            {!clips.some((clip) => clip.lane === lane.key) && (
              <span className={styles.empty}>将音频节点连到此剪辑节点，选择{lane.label}用途</span>
            )}
          </div>
        </div>
      ))}
    </section>
  )
}
