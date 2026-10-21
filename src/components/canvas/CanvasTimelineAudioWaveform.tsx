import { useEffect, useState } from 'react'
import { assetStreamUrl } from '@/utils/assetUrl'
import { loadAudioWaveform } from '@/utils/audioWaveform'
import type { TimelineAudioClip } from '@/utils/canvasAudio'
import styles from './CanvasTimelineEditor.module.css'

/** 波形仅在浏览器内解码，裁剪与循环按源音频时间取样。 */
export default function CanvasTimelineAudioWaveform({
  clip,
  workspaceId,
  length,
  width,
}: {
  clip: TimelineAudioClip
  workspaceId: number
  length: number
  width: number
}) {
  const [wave, setWave] = useState<{ key: string; peaks: number[] } | null>(null)
  const [failed, setFailed] = useState('')
  const key = `${workspaceId}:${clip.assetId}`
  useEffect(() => {
    const controller = new AbortController()
    void loadAudioWaveform(assetStreamUrl(clip.assetId, workspaceId), controller.signal, 256)
      .then((peaks) => {
        if (!controller.signal.aborted) setWave({ key, peaks })
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(key)
      })
    return () => controller.abort()
  }, [key, clip.assetId, workspaceId])
  const peaks = wave?.key === key ? wave.peaks : null
  if (!peaks)
    return <span className={styles.audioWavePlaceholder}>{failed === key ? '波形暂不可用' : '波形加载中…'}</span>
  const count = Math.max(1, Math.min(512, Math.floor(width / 4)))
  const duration = clip.outSec - clip.inSec
  return (
    <svg className={styles.audioWaveform} viewBox={`0 0 ${count * 4} 30`} preserveAspectRatio="none" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => {
        const time = ((index + 0.5) / count) * length
        const sourceTime = clip.inSec + (clip.loop && duration > 0 ? time % duration : time)
        const peak =
          peaks[
            Math.min(peaks.length - 1, Math.max(0, Math.floor((sourceTime / (clip.durationSec || 1)) * peaks.length)))
          ] || 0
        const height = Math.max(1, peak * 28)
        return <rect key={index} x={index * 4} y={(30 - height) / 2} width="2" height={height} rx="1" />
      })}
    </svg>
  )
}
