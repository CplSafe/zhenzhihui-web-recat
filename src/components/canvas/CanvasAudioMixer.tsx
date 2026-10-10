import { useEffect, useRef, useState } from 'react'
import { assetStreamUrl } from '@/utils/assetUrl'
import { normalizeAudioSettings, type TimelineAudioClip } from '@/utils/canvasAudio'
import { useToast } from '@/composables/useToast'
import styles from './CanvasAudioMixer.module.css'

const LANES = [
  { key: 'voice', label: '人声', color: '#6297da' },
  { key: 'bgm', label: 'BGM', color: '#43a783' },
  { key: 'sfx', label: '音效', color: '#b98a46' },
] as const
export default function CanvasAudioMixer({
  clips,
  duration,
  workspaceId,
  onChange,
  playheadSec,
  playing,
}: {
  clips: TimelineAudioClip[]
  duration: number
  workspaceId: number
  onChange: (clips: TimelineAudioClip[]) => void
  playheadSec: number
  playing: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState('')
  const audio = useRef<HTMLAudioElement>(null)
  const requestRef = useRef(0)
  const { showToast } = useToast()
  useEffect(() => {
    requestRef.current += 1
    setPreview('')
    setBusy(false)
    return () => {
      requestRef.current += 1
    }
  }, [clips, duration, workspaceId])
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
      const buffer = await renderAudioMix(clips, duration, workspaceId)
      if (request !== requestRef.current) return
      const blob = audioBufferToWav(buffer)
      const url = URL.createObjectURL(blob)
      if (download) {
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = `混音-${Date.now()}.wav`
        anchor.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      } else setPreview(url)
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
          <strong>音频混音</strong>
          <p>连线添加音轨 · 编辑仅作用于当前成片</p>
        </div>
        <div className={styles.actions}>
          <button type="button" disabled={busy || !clips.length || duration <= 0} onClick={() => void prepare(false)}>
            {busy ? '正在混音…' : preview ? '重新准备试听' : '准备混音试听'}
          </button>
          <button type="button" disabled={busy || !clips.length || duration <= 0} onClick={() => void prepare(true)}>
            导出混音 WAV
          </button>
        </div>
      </div>
      {preview && (
        <>
          <audio ref={audio} src={preview} preload="auto" />
          <p className={styles.note}>试听已就绪，播放或拖动上方视频时音轨同步；修改音轨后请重新准备试听。</p>
        </>
      )}
      {LANES.map((lane) => (
        <div key={lane.key} className={styles.lane}>
          <div className={styles.laneTitle}>
            <i style={{ background: lane.color }} />
            {lane.label}
          </div>
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
                    <div className={styles.controls}>
                      <label>
                        轨道
                        <select
                          aria-label={`${clip.title}轨道`}
                          value={clip.lane}
                          onChange={(e) => update(clip, { lane: e.target.value, loop: e.target.value === 'bgm' })}
                        >
                          {LANES.map((l) => (
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
