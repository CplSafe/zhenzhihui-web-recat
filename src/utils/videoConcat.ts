/**
 * 无损拼接：把多段 MP4 的样本原样接成一条，不解码也不重编码。
 *
 * 成立的前提是所有素材共用同一套解码参数（avcC 逐字节相同 + 编码尺寸一致）——
 * 解码器初始化一次就能连续解完整条轨道。画布上同模型同比例生成的视频天然满足；
 * 混入规格不同的素材时这里会明确报错，而不是产出一条放到一半花屏的片子。
 *
 * 裁剪点吸附到最近的关键帧：不重编码就没有别的选择，起点必须是关键帧，
 * 否则开头拿不到参考帧。实际生效的区间会随结果返回，供 UI 如实回显。
 */
import { demuxMp4, readAudioSpecificConfigHex, selectSampleRange, type Mp4Track } from '@/utils/mp4Demux'
import { muxMp4, type Bytes, type MuxSample, type MuxTrack } from '@/utils/mp4Muxer'
import { resolveTargetSpec, transcodeSegmentsToCommonSpec, type TranscodeSegment } from '@/utils/videoTranscode'

/** 一段待拼接的素材。 */
export interface ConcatSource {
  /** 完整 MP4 文件字节。 */
  buffer: ArrayBuffer
  inSec: number
  outSec: number
  muted?: boolean
  /** 出错信息里用来指代这一段，例如「片段 2」。 */
  label?: string
}

/** 单段在成片中实际生效的区间（吸附关键帧之后）。 */
export interface ConcatSegment {
  label: string
  requestedInSec: number
  requestedOutSec: number
  actualInSec: number
  actualOutSec: number
}

export interface ConcatResult {
  blob: Blob
  durationSec: number
  segments: ConcatSegment[]
  /** 不影响出片、但用户应当知道的降级，例如「已丢弃音轨」。 */
  warnings: string[]
}

/** 时间比较的容差：不同 timescale 换算后总有零点几毫秒的出入。 */
const TICK_EPSILON = 1e-6

function sourceLabel(source: ConcatSource, index: number): string {
  return source.label || `片段 ${index + 1}`
}

/** 两条视频轨能否接到同一条轨道上：解码参数与编码尺寸必须逐字节一致。 */
function videoConcatKey(track: Mp4Track): string {
  return [track.format, track.decoderConfigBox, track.decoderConfigHex, `${track.width}x${track.height}`].join('|')
}

/**
 * 两条音频轨能否接到一起：解码配置 + 采样率 + 声道数一致。
 *
 * 解码配置只比 AudioSpecificConfig，不比整段 esds——后者还含 ES_ID、bufferSizeDB、
 * maxBitrate、avgBitrate，这些是编码器按本段内容算出来的，同参数的两段音频照样不同。
 * 之前拿整段比对，结果是「同一个模型生成的两段视频」也会被判成格式不一致，声音被静默丢掉。
 * 解析不出 AudioSpecificConfig 时回落到整段比对，保守优先。
 */
function audioConcatKey(track: Mp4Track): string {
  const config = readAudioSpecificConfigHex(track.decoderConfig) || track.decoderConfigHex
  return [track.format, config, Math.round(track.sampleRate), track.channels].join('|')
}

/**
 * 把源轨道的时间刻度换算到输出刻度。
 *
 * 逐个样本从原始 dts 直接换算（而不是累加换算后的 duration），
 * 否则每个样本的舍入误差会一路累积，几千帧之后音画就对不上了。
 */
function rescale(ticks: number, from: number, to: number): number {
  if (from === to) return ticks
  return Math.round((ticks * to) / from)
}

/** 把某条轨道选中的样本区间转成输出样本，时间基点重设到 baseTicks。 */
function buildSegmentSamples(
  track: Mp4Track,
  startIndex: number,
  endIndex: number,
  outTimescale: number,
  baseTicks: number,
  bytesOf: (offset: number, size: number) => Bytes | null,
): MuxSample[] {
  const out: MuxSample[] = []
  const firstDts = track.samples[startIndex].dts

  for (let i = startIndex; i <= endIndex; i += 1) {
    const sample = track.samples[i]
    const data = bytesOf(sample.offset, sample.size)
    if (!data) continue
    const dts = baseTicks + rescale(sample.dts - firstDts, track.timescale, outTimescale)
    const cts = dts + rescale(sample.cts - sample.dts, track.timescale, outTimescale)
    out.push({ data, dts, cts, duration: 0, sync: sample.sync })
  }

  // duration 由相邻 dts 之差回填，保证与时间戳自洽；末样本沿用源片时长
  for (let i = 0; i < out.length; i += 1) {
    const next = out[i + 1]
    if (next) {
      out[i].duration = next.dts - out[i].dts
    } else {
      const source = track.samples[endIndex]
      out[i].duration = Math.max(1, rescale(source.duration, track.timescale, outTimescale))
    }
  }
  return out
}

/** 找出覆盖 [fromSec, toSec) 的音频样本下标区间。音频样本全是关键帧，不需要吸附。 */
function selectAudioRange(track: Mp4Track, fromSec: number, toSec: number): { start: number; end: number } | null {
  if (!track.samples.length || !(track.timescale > 0)) return null
  const fromTicks = fromSec * track.timescale
  const toTicks = toSec * track.timescale

  let start = -1
  let end = -1
  for (let i = 0; i < track.samples.length; i += 1) {
    const sample = track.samples[i]
    const sampleEnd = sample.dts + sample.duration
    if (sampleEnd <= fromTicks + TICK_EPSILON) continue
    if (sample.dts >= toTicks - TICK_EPSILON) break
    if (start < 0) start = i
    end = i
  }
  return start < 0 ? null : { start, end }
}

type DemuxedSource = ReturnType<typeof demuxMp4>

/** 逐段解析，任何一段解析不出视频轨就直接失败。 */
function demuxAll(sources: readonly ConcatSource[]): DemuxedSource[] {
  return sources.map((source, index) => {
    const result = demuxMp4(source.buffer)
    if (result.error || !result.video) {
      throw new Error(`${sourceLabel(source, index)}解析失败：${result.error || '没有视频轨'}`)
    }
    return result
  })
}

/** 各段视频规格是否完全一致——这是无损拼接唯一的硬前提。 */
function findVideoSpecMismatch(demuxed: readonly DemuxedSource[]): number {
  const videoKeys = demuxed.map((item) => videoConcatKey(item.video!))
  return videoKeys.findIndex((key) => key !== videoKeys[0])
}

/** 规格不一致时的统一说明，把差异点写清楚，用户才知道该怎么办。 */
function describeSpecMismatch(
  sources: readonly ConcatSource[],
  demuxed: readonly DemuxedSource[],
  mismatch: number,
): string {
  const first = demuxed[0].video!
  const other = demuxed[mismatch].video!
  const size = (track: typeof first) => `${track.width}×${track.height}`
  const detail =
    size(first) === size(other)
      ? '编码参数不一致'
      : `第 1 段 ${size(first)}，${sourceLabel(sources[mismatch], mismatch)} ${size(other)}`
  return `${sourceLabel(sources[mismatch], mismatch)}与第 1 段的视频规格不同（${detail}），无损拼接要求所有片段规格一致`
}

interface AudioDecision {
  keepAudio: boolean
  warnings: string[]
}

/** 音轨取舍：逐段静音改不了音频内容（那要重编码），只能整条保留或整条丢弃。 */
function decideAudio(sources: readonly ConcatSource[], demuxed: readonly DemuxedSource[]): AudioDecision {
  const warnings: string[] = []
  const mutedCount = sources.filter((source) => source.muted === true).length
  const audioKeys = demuxed.map((item) => (item.audio && item.audio.samples.length ? audioConcatKey(item.audio) : ''))
  const allHaveAudio = audioKeys.every((key) => key !== '')
  const audioUniform = allHaveAudio && audioKeys.every((key) => key === audioKeys[0])

  let keepAudio = true
  if (mutedCount === sources.length) {
    keepAudio = false // 全部静音：干脆不写音轨
  } else if (mutedCount > 0) {
    throw new Error('拼接不支持逐段静音：请把这些片段统一设为静音，或统一保留声音')
  } else if (!allHaveAudio) {
    keepAudio = false
    warnings.push('有片段没有音轨，成片已按无声处理')
  } else if (!audioUniform) {
    keepAudio = false
    warnings.push('各片段音频格式不一致，成片已按无声处理')
  }
  return { keepAudio, warnings }
}

/**
 * 把多段 MP4 无损拼成一条。
 *
 * 纯计算，不发请求：调用方负责把每段的完整文件字节取来。
 * 任何一段规格对不上就抛错，宁可失败也不产出一条会花屏的成片；
 * 需要跨规格合并时改用 concatMp4SourcesAsync（会重编码）。
 */
export function concatMp4Sources(sources: readonly ConcatSource[]): ConcatResult {
  if (sources.length < 1) throw new Error('没有可拼接的片段')

  const demuxed = demuxAll(sources)
  const mismatch = findVideoSpecMismatch(demuxed)
  if (mismatch > 0) throw new Error(describeSpecMismatch(sources, demuxed, mismatch))

  const { keepAudio, warnings } = decideAudio(sources, demuxed)
  const outVideoTimescale = demuxed[0].video!.timescale
  const outAudioTimescale = keepAudio ? demuxed[0].audio!.timescale : 0

  const videoSamples: MuxSample[] = []
  const audioSamples: MuxSample[] = []
  const segments: ConcatSegment[] = []
  let videoBase = 0
  let elapsedSec = 0

  demuxed.forEach((item, index) => {
    const source = sources[index]
    const video = item.video!
    const range = selectSampleRange(video, source.inSec, source.outSec)
    if (!range) throw new Error(`${sourceLabel(source, index)}没有可用的视频样本`)

    // 本段用到的字节整块复制一次，之后源缓冲区就可以被回收
    const audioRange =
      keepAudio && item.audio ? selectAudioRange(item.audio, range.actualInSec, range.actualOutSec) : null
    let spanStart = Number.POSITIVE_INFINITY
    let spanEnd = 0
    const visit = (track: Mp4Track, from: number, to: number) => {
      for (let i = from; i <= to; i += 1) {
        const sample = track.samples[i]
        if (!sample) continue
        spanStart = Math.min(spanStart, sample.offset)
        spanEnd = Math.max(spanEnd, sample.offset + sample.size)
      }
    }
    visit(video, range.startIndex, range.endIndex)
    if (audioRange && item.audio) visit(item.audio, audioRange.start, audioRange.end)

    const limit = source.buffer.byteLength
    spanStart = Math.max(0, Math.min(spanStart, limit))
    spanEnd = Math.min(spanEnd, limit)
    const span = new Uint8Array(source.buffer.slice(spanStart, spanEnd))
    const bytesOf = (offset: number, size: number): Bytes | null => {
      const from = offset - spanStart
      if (from < 0 || from + size > span.length) return null
      return span.subarray(from, from + size)
    }

    videoSamples.push(
      ...buildSegmentSamples(video, range.startIndex, range.endIndex, outVideoTimescale, videoBase, bytesOf),
    )

    if (audioRange && item.audio) {
      // 音频基点由已累计的秒数换算，而不是累加音频样本时长——
      // 后者会让每段末尾那点不足一帧的余量一路累积成音画不同步。
      const audioBase = Math.round(elapsedSec * outAudioTimescale)
      audioSamples.push(
        ...buildSegmentSamples(item.audio, audioRange.start, audioRange.end, outAudioTimescale, audioBase, bytesOf),
      )
    }

    const segmentSec = range.actualOutSec - range.actualInSec
    videoBase += rescale(Math.round(segmentSec * video.timescale), video.timescale, outVideoTimescale)
    elapsedSec += segmentSec

    segments.push({
      label: sourceLabel(source, index),
      requestedInSec: source.inSec,
      requestedOutSec: source.outSec,
      actualInSec: range.actualInSec,
      actualOutSec: range.actualOutSec,
    })
  })

  if (!videoSamples.length) throw new Error('裁剪后没有剩下任何画面')

  const firstVideo = demuxed[0].video!
  const tracks: MuxTrack[] = [
    {
      kind: 'video',
      timescale: outVideoTimescale,
      width: firstVideo.width,
      height: firstVideo.height,
      format: firstVideo.format,
      sampleEntry: firstVideo.sampleEntryBytes!,
      decoderConfig: firstVideo.decoderConfig,
      samples: videoSamples,
    },
  ]

  if (keepAudio && audioSamples.length) {
    const firstAudio = demuxed[0].audio!
    tracks.push({
      kind: 'audio',
      timescale: outAudioTimescale,
      width: 0,
      height: 0,
      format: firstAudio.format,
      sampleEntry: firstAudio.sampleEntryBytes!,
      decoderConfig: firstAudio.decoderConfig,
      samples: audioSamples,
    })
  } else if (keepAudio) {
    // 本该保留声音，却一个音频样本都没取到（裁剪区间落在音轨之外等）。
    // 不出声是事实，必须说出来——之前这里是直接出一条没有音轨的成片，用户完全无从判断。
    warnings.push('片段的裁剪区间内没有取到音频，成片已按无声处理')
  }

  return {
    blob: muxMp4(tracks),
    durationSec: Math.round(elapsedSec * 1000) / 1000,
    segments,
    warnings,
  }
}

export interface ConcatAsyncOptions {
  /**
   * 规格不一致时是否允许重编码。
   * 关闭（默认）时行为与 concatMp4Sources 完全一致：直接报错，不动画质。
   */
  allowTranscode?: boolean
  signal?: AbortSignal
  /** 重编码进度（已处理帧 / 总帧数）；无损路径不会回调。 */
  onTranscodeProgress?: (done: number, total: number) => void
}

/**
 * 拼接入口：规格一致走无损，不一致时按需重编码。
 *
 * 重编码是有损的，也很吃 CPU，因此必须由调用方显式开启，并且只在确实对不上时才发生——
 * 规格一致的常见情况仍然逐字节复制，画质与源片完全相同。
 */
export async function concatMp4SourcesAsync(
  sources: readonly ConcatSource[],
  options: ConcatAsyncOptions = {},
): Promise<ConcatResult> {
  if (sources.length < 1) throw new Error('没有可拼接的片段')

  const demuxed = demuxAll(sources)
  const mismatch = findVideoSpecMismatch(demuxed)
  if (mismatch <= 0) return concatMp4Sources(sources)
  if (!options.allowTranscode) throw new Error(describeSpecMismatch(sources, demuxed, mismatch))

  const { keepAudio, warnings } = decideAudio(sources, demuxed)
  const target = resolveTargetSpec(demuxed.map((item) => item.video!))

  // 逐段确定参与输出的样本区间；裁剪点仍吸附关键帧，与无损路径口径一致
  const segments: ConcatSegment[] = []
  const transcodeSegments: TranscodeSegment[] = []
  const audioSamples: MuxSample[] = []
  const outAudioTimescale = keepAudio ? demuxed[0].audio!.timescale : 0
  let elapsedSec = 0

  demuxed.forEach((item, index) => {
    const source = sources[index]
    const video = item.video!
    const range = selectSampleRange(video, source.inSec, source.outSec)
    if (!range) throw new Error(`${sourceLabel(source, index)}没有可用的视频样本`)

    transcodeSegments.push({
      buffer: source.buffer,
      track: video,
      startIndex: range.startIndex,
      endIndex: range.endIndex,
    })

    // 音频不参与重编码：样本原样复制，只把时间基点对到已累计的秒数上
    if (keepAudio && item.audio) {
      const audioRange = selectAudioRange(item.audio, range.actualInSec, range.actualOutSec)
      if (audioRange) {
        const bytes = new Uint8Array(source.buffer)
        const bytesOf = (offset: number, size: number): Bytes | null =>
          offset >= 0 && offset + size <= bytes.length ? bytes.subarray(offset, offset + size) : null
        audioSamples.push(
          ...buildSegmentSamples(
            item.audio,
            audioRange.start,
            audioRange.end,
            outAudioTimescale,
            Math.round(elapsedSec * outAudioTimescale),
            bytesOf,
          ),
        )
      }
    }

    elapsedSec += range.actualOutSec - range.actualInSec
    segments.push({
      label: sourceLabel(source, index),
      requestedInSec: source.inSec,
      requestedOutSec: source.outSec,
      actualInSec: range.actualInSec,
      actualOutSec: range.actualOutSec,
    })
  })

  const transcoded = await transcodeSegmentsToCommonSpec(transcodeSegments, target, {
    signal: options.signal,
    onProgress: options.onTranscodeProgress,
  })

  // 输出画幅由重编码决定，样本项里的宽高必须跟着改，否则播放器按旧尺寸渲染会拉伸
  const firstVideo = demuxed[0].video!
  const sampleEntry = new Uint8Array(firstVideo.sampleEntryBytes!) as Bytes
  new DataView(sampleEntry.buffer).setUint16(24, transcoded.spec.width)
  new DataView(sampleEntry.buffer).setUint16(26, transcoded.spec.height)

  const tracks: MuxTrack[] = [
    {
      kind: 'video',
      timescale: transcoded.timescale,
      width: transcoded.spec.width,
      height: transcoded.spec.height,
      format: firstVideo.format,
      sampleEntry,
      decoderConfig: transcoded.decoderConfig,
      samples: transcoded.samples,
    },
  ]

  if (keepAudio && audioSamples.length) {
    const firstAudio = demuxed[0].audio!
    tracks.push({
      kind: 'audio',
      timescale: outAudioTimescale,
      width: 0,
      height: 0,
      format: firstAudio.format,
      sampleEntry: firstAudio.sampleEntryBytes!,
      decoderConfig: firstAudio.decoderConfig,
      samples: audioSamples,
    })
  } else if (keepAudio) {
    // 本该保留声音，却一个音频样本都没取到（裁剪区间落在音轨之外等）。
    // 不出声是事实，必须说出来——之前这里是直接出一条没有音轨的成片，用户完全无从判断。
    warnings.push('片段的裁剪区间内没有取到音频，成片已按无声处理')
  }

  return {
    blob: muxMp4(tracks),
    durationSec: Math.round(elapsedSec * 1000) / 1000,
    segments,
    warnings: [
      ...warnings,
      `片段规格不一致，已统一重编码为 ${transcoded.spec.width}×${transcoded.spec.height}（画质会有损失）`,
    ],
  }
}
