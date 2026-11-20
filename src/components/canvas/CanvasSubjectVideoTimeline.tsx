import { useEffect, useState } from 'react'
import { formatVideoTimeLabel } from '@/utils/videoDuration'
import { buildFilmstrip, getCachedFilmstrip } from '@/utils/videoFilmstrip'
import styles from './CanvasSubjectVideoTimeline.module.css'

interface Props {
  sourceUrl: string
  duration: number
  currentTime: number
  anchorTime?: number
  disabled?: boolean
  onSeek: (time: number) => void
  onJumpToAnchor: () => void
}

function formatFrameTime(time: number): string {
  const centiseconds = Math.round(time * 100)
  return `${formatVideoTimeLabel(centiseconds / 100)}.${String(centiseconds % 100).padStart(2, '0')}`
}

export default function CanvasSubjectVideoTimeline({
  sourceUrl,
  duration,
  currentTime,
  anchorTime,
  disabled,
  onSeek,
  onJumpToAnchor,
}: Props) {
  const [filmstrip, setFilmstrip] = useState<{ sourceUrl: string; frames: string[] }>()
  const hasDuration = Number.isFinite(duration) && duration > 0
  const endTime = hasDuration ? duration : 0
  const time = Number.isFinite(currentTime) ? Math.min(Math.max(0, currentTime), endTime) : 0
  const anchor =
    typeof anchorTime === 'number' && Number.isFinite(anchorTime) && anchorTime >= 0 && anchorTime <= endTime
      ? anchorTime
      : undefined
  const frames = (filmstrip?.sourceUrl === sourceUrl ? filmstrip.frames : getCachedFilmstrip(sourceUrl)) ?? []

  useEffect(() => {
    if (!sourceUrl || !hasDuration || getCachedFilmstrip(sourceUrl)) return
    let active = true
    void buildFilmstrip(sourceUrl).then((images) => {
      if (active && images.length) setFilmstrip({ sourceUrl, frames: images })
    })
    return () => {
      active = false
    }
  }, [sourceUrl, hasDuration])

  return (
    <div className={styles.timeline}>
      <div className={styles.controls}>
        <span className={styles.time}>
          {formatFrameTime(time)} / {formatFrameTime(endTime)}
        </span>
        {anchor !== undefined && (
          <button
            type="button"
            className={styles.jump}
            aria-label="返回标记帧"
            disabled={disabled || !hasDuration}
            onClick={onJumpToAnchor}
          >
            返回标记帧 <span className={styles.time}>{formatFrameTime(anchor)}</span>
          </button>
        )}
      </div>
      <div className={styles.track}>
        <div className={styles.filmstrip} aria-hidden="true">
          {frames.map((src, index) => (
            <img key={index} src={src} alt="" draggable={false} />
          ))}
        </div>
        {anchor !== undefined && hasDuration && (
          <div className={styles.marker} aria-hidden="true" style={{ left: `${(anchor / endTime) * 100}%` }} />
        )}
        <input
          className={styles.scrubber}
          type="range"
          aria-label="视频帧时间轴"
          aria-valuetext={`${time.toFixed(2)} 秒，共 ${endTime.toFixed(2)} 秒`}
          min={0}
          max={endTime}
          step={0.01}
          value={time}
          disabled={disabled || !hasDuration}
          onChange={(event) => onSeek(event.currentTarget.valueAsNumber)}
        />
      </div>
    </div>
  )
}
