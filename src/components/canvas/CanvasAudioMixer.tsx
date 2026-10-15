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
}) {
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState('')
  const [hasPreparedPreview, setHasPreparedPreview] = useState(false)
  const [solo, setSolo] = useState('')
  const lanes = clips.some((clip) => clip.lane === 'sfx') ? [...LANES, LEGACY_SFX_LANE] : [...LANES]
  const audio = useRef<HTMLAudioElement>(null)
  const requestRef = useRef(0)
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
    setBusy(false)
    return () => {
      requestRef.current += 1
    }
  }, [clips, duration, workspaceId, solo])
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview)
    },
    [preview],
  )
  useEffect(() => {
    const player = audio.current
    if (!player || !preview) return
    if (Math.abs(player.currentTime - playheadSec) > 0.25) player.currentTime = playheadSec
    if (playing) void player.play().catch(() => showToast('请点击播放器开始试听', 'info'))
    else player.pause()
  }, [preview, playheadSec, playing, showToast])
  const update = (clip: TimelineAudioClip, patch: Record<string, unknown>) =>
    onChange(
      clips.map((item) =>
        item.sourceNodeId === clip.sourceNodeId ? { ...item, ...normalizeAudioSettings({ ...item, ...patch }) } : item,
      ),
    )
  const prepare = async (download: boolean) => {
    if (busy) return
    const request = ++requestRef.current
    setBusy(true)
    try {
      const { renderAudioMix, audioBufferToWav } = await import('@/utils/audioMix')
      const output =
        download || !solo ? clips : clips.map((clip) => ({ ...clip, muted: clip.muted || clip.lane !== solo }))
      const buffer = await renderAudioMix(output, duration, workspaceId)
      if (request !== requestRef.current) return
      const blob = audioBufferToWav(buffer)
      const url = URL.createObjectURL(blob)
      if (download) {
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = `混音-${Date.now()}.wav`
        anchor.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      } else {
        setPreview(url)
        setHasPreparedPreview(true)
      }
    } catch (e: any) {
      if (request === requestRef.current) showToast(e?.message || '混音失败', 'error')
    } finally {
      if (request === requestRef.current) setBusy(false)
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
          <button type="button" disabled={busy || !clips.length || duration <= 0} onClick={() => void prepare(false)}>
            {busy ? '正在混音…' : preview ? '重新准备试听' : '准备混音试听'}
          </button>
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
      {hasPreparedPreview && !preview && clips.length > 0 && (
        <p className={styles.stalePreview} role="status">
          音轨或成片时长已变化，当前试听已失效。点击“准备混音试听”后再播放，导出会使用最新设置。
        </p>
      )}
      {preview && (
        <>
          <audio ref={audio} src={preview} preload="auto" />
          <p className={styles.note} role="status">
            试听已就绪，播放或拖动上方视频时音轨同步。
          </p>
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
