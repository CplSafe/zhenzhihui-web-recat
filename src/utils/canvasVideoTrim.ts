import { demuxMp4, selectSampleRange, type Mp4Track } from '@/utils/mp4Demux'
import { concatMp4Sources, trimH264Mp4Precisely } from '@/utils/videoConcat'
import { isBrowserTranscodeSupported } from '@/utils/videoTranscode'

const MAX_SOURCE_BYTES = 512 * 1024 * 1024
const MIN_DURATION_SEC = 0.1
const ROUNDING_TOLERANCE_SEC = 0.001

export interface CanvasVideoTrimSource {
  media: Blob
  buffer: ArrayBuffer
  track: Mp4Track
  durationSec: number
  audio: Mp4Track | null
}

export interface CanvasVideoTrimResult {
  durationSec: number
  inSec: number
  outSec: number
}

interface CanvasVideoTrimPlan extends CanvasVideoTrimResult {
  requestedInSec: number
  requestedOutSec: number
  snapped: boolean
  precise: boolean
}

export async function loadCanvasVideoTrim(url: string, signal: AbortSignal): Promise<CanvasVideoTrimSource> {
  const response = await fetch(url, { credentials: 'include', signal })
  if (!response.ok) throw new Error(`读取原视频失败（HTTP ${response.status}）`)

  const tooLarge = '原视频超过 512 MB，浏览器无法安全裁剪。'
  if (Number(response.headers.get('content-length')) > MAX_SOURCE_BYTES) throw new Error(tooLarge)

  let media: Blob
  if (response.body) {
    const reader = response.body.getReader()
    const chunks: Blob[] = []
    let total = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > MAX_SOURCE_BYTES) {
          await reader.cancel()
          throw new Error(tooLarge)
        }
        chunks.push(new Blob([value]))
      }
    } finally {
      reader.releaseLock()
    }
    media = new Blob(chunks, { type: 'video/mp4' })
  } else {
    media = await response.blob()
    if (media.size > MAX_SOURCE_BYTES) throw new Error(tooLarge)
  }

  const buffer = await media.arrayBuffer()
  signal.throwIfAborted()
  const { video, audio, error } = demuxMp4(buffer)
  if (error || !video || !video.samples.length || video.timescale <= 0) {
    throw new Error('此视频无法在浏览器内裁剪。请选择普通 MP4 视频。')
  }
  const last = video.samples[video.samples.length - 1]
  const durationSec = (last.dts + last.duration) / video.timescale
  if (!Number.isFinite(durationSec) || durationSec <= MIN_DURATION_SEC) throw new Error('原视频太短，无法裁剪。')
  return { media, buffer, track: video, durationSec, audio }
}

export function planCanvasVideoTrim(
  track: Mp4Track,
  inSec: number,
  outSec: number,
  preferLossless = false,
): CanvasVideoTrimPlan | null {
  if (!Number.isFinite(inSec) || !Number.isFinite(outSec) || inSec < 0 || outSec - inSec < MIN_DURATION_SEC - 1e-6) {
    return null
  }
  const range = selectSampleRange(track, inSec, outSec)
  if (!range) return null
  const snapped =
    Math.abs(range.actualInSec - inSec) > ROUNDING_TOLERANCE_SEC ||
    Math.abs(range.actualOutSec - outSec) > ROUNDING_TOLERANCE_SEC
  if (
    snapped &&
    !preferLossless &&
    track.decoderConfigBox === 'avcC' &&
    track.format === 'avc1' &&
    isBrowserTranscodeSupported()
  ) {
    return {
      requestedInSec: inSec,
      requestedOutSec: outSec,
      inSec,
      outSec,
      durationSec: outSec - inSec,
      precise: true,
      snapped: false,
    }
  }
  if (range.startIndex === 0 && range.endIndex === track.samples.length - 1) return null
  const durationSec = range.actualOutSec - range.actualInSec
  if (durationSec < MIN_DURATION_SEC - 1e-6) return null

  return {
    requestedInSec: inSec,
    requestedOutSec: outSec,
    inSec: range.actualInSec,
    outSec: range.actualOutSec,
    durationSec,
    snapped,
    precise: false,
  }
}

export async function exportCanvasVideoTrim(
  source: CanvasVideoTrimSource,
  plan: CanvasVideoTrimPlan,
  title: string,
  signal: AbortSignal,
): Promise<{ file: File; result: CanvasVideoTrimResult }> {
  // 先让浏览器绘制保存状态，避免同步封装长视频时按钮看起来没有响应。
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  signal.throwIfAborted()
  const fileName = (title.trim() || '视频').replace(/\.[^./\\]+$/, '').replace(/[<>:"/\\|?*]/g, '_')
  const toFile = (blob: Blob) => new File([blob], `${fileName || '视频'}-裁剪.mp4`, { type: 'video/mp4' })
  if (plan.precise) {
    const blob = await trimH264Mp4Precisely(source.buffer, source.track, source.audio, plan.inSec, plan.outSec, signal)
    return { file: toFile(blob), result: { durationSec: plan.durationSec, inSec: plan.inSec, outSec: plan.outSec } }
  }

  const output = concatMp4Sources([{ buffer: source.buffer, inSec: plan.requestedInSec, outSec: plan.requestedOutSec }])
  const segment = output.segments[0]
  if (!segment || !output.blob.size || output.durationSec <= 0) throw new Error('裁剪未生成有效视频。')
  if (source.audio?.samples.length && output.warnings.some((warning) => /音轨|无声/.test(warning))) {
    throw new Error('该裁剪区间无法完整保留原音轨，请调整裁剪范围。')
  }

  return {
    file: toFile(output.blob),
    result: { durationSec: output.durationSec, inSec: segment.actualInSec, outSec: segment.actualOutSec },
  }
}
