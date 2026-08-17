/**
 * MP4 样本表解析：把 stbl 里那堆压缩表还原成「每个样本在文件的哪个字节、什么时间、是不是关键帧」。
 *
 * mp4Probe 只读规格（能不能拼），这里读的是拼接真正需要的东西——样本级的位置与时间。
 * 两者共用 mp4Boxes 的 box 读取原语。
 *
 * 只解析非分片 MP4（progressive）。分片 MP4 的样本表在各个 moof 里，形态完全不同，
 * 由调用方先用 mp4Probe 的 fragmented 判定挡掉，这里不做静默降级。
 */
import { findBox, findPath, readBoxes, readFourCc, readVersion, toHex, type Bytes, type Mp4Box } from '@/utils/mp4Boxes'

/** 单个样本在文件中的位置与时间。时间单位是所属轨道的 timescale ticks。 */
export interface Mp4Sample {
  /** 在文件中的字节偏移。 */
  offset: number
  size: number
  /** 解码时间戳。 */
  dts: number
  /** 显示时间戳（无 ctts 时等于 dts）。 */
  cts: number
  /** 本样本占用的时长（ticks）。 */
  duration: number
  /** 是否关键帧（无 stss 时全部为 true）。 */
  sync: boolean
}

export interface Mp4Track {
  id: number
  /** 'vide' | 'soun' | 其他 */
  handler: string
  /** 样本格式：avc1 / hvc1 / mp4a … */
  format: string
  timescale: number
  /** 轨道时长（ticks，取 mdhd）。 */
  duration: number
  samples: Mp4Sample[]
  /** 解码配置 box 的原始字节（avcC / hvcC / esds …），拼接时原样复制到输出。 */
  decoderConfig: Bytes | null
  /** 解码配置 box 名。 */
  decoderConfigBox: string
  /** 解码配置字节的十六进制，用于比较两条素材是否同一套解码参数。 */
  decoderConfigHex: string
  /** 视频：编码尺寸。音频轨为 0。 */
  width: number
  height: number
  /** 视频：tkhd 里的显示尺寸（16.16 定点已换算）。 */
  displayWidth: number
  displayHeight: number
  /** 音频：采样率与声道数。视频轨为 0。 */
  sampleRate: number
  channels: number
  /** stsd 中该样本项除解码配置外的固定字段原样保留，写回输出时直接复用。 */
  sampleEntryBytes: Bytes | null
}

export interface DemuxedMp4 {
  video: Mp4Track | null
  audio: Mp4Track | null
  /** 解析失败原因；非空时其余字段不可信。 */
  error?: string
}

/** 读 FullBox 的 entry_count（version+flags 之后的 4 字节）。 */
function readEntryCount(view: DataView, box: Mp4Box): number {
  if (box.body + 8 > box.end) return 0
  return view.getUint32(box.body + 4)
}

/** 展开 stts：每项 [count, delta] → 每个样本的 duration。 */
function readSampleDeltas(view: DataView, stts: Mp4Box | undefined, total: number): number[] {
  const deltas: number[] = []
  if (!stts) return deltas
  const entries = readEntryCount(view, stts)
  for (let i = 0; i < entries; i += 1) {
    const at = stts.body + 8 + i * 8
    if (at + 8 > stts.end) break
    const count = view.getUint32(at)
    const delta = view.getUint32(at + 4)
    for (let n = 0; n < count && deltas.length < total; n += 1) deltas.push(delta)
  }
  return deltas
}

/** 展开 ctts：每项 [count, offset] → 每个样本的显示偏移。version 1 的 offset 是有符号的。 */
function readCompositionOffsets(view: DataView, ctts: Mp4Box | undefined, total: number): number[] {
  const offsets: number[] = []
  if (!ctts) return offsets
  const signed = readVersion(view, ctts) === 1
  const entries = readEntryCount(view, ctts)
  for (let i = 0; i < entries; i += 1) {
    const at = ctts.body + 8 + i * 8
    if (at + 8 > ctts.end) break
    const count = view.getUint32(at)
    const offset = signed ? view.getInt32(at + 4) : view.getUint32(at + 4)
    for (let n = 0; n < count && offsets.length < total; n += 1) offsets.push(offset)
  }
  return offsets
}

/** stsz：sample_size 非 0 表示所有样本等长，否则逐个读。 */
function readSampleSizes(view: DataView, stsz: Mp4Box | undefined): number[] {
  if (!stsz) return []
  const uniform = view.getUint32(stsz.body + 4)
  const count = view.getUint32(stsz.body + 8)
  if (uniform > 0) return new Array(count).fill(uniform)
  const sizes: number[] = []
  for (let i = 0; i < count; i += 1) {
    const at = stsz.body + 12 + i * 4
    if (at + 4 > stsz.end) break
    sizes.push(view.getUint32(at))
  }
  return sizes
}

/** stss：关键帧的样本序号（1-based）。 */
function readSyncSamples(view: DataView, stss: Mp4Box | undefined): Set<number> | null {
  if (!stss) return null // 没有 stss = 全部都是关键帧
  const set = new Set<number>()
  const entries = readEntryCount(view, stss)
  for (let i = 0; i < entries; i += 1) {
    const at = stss.body + 8 + i * 4
    if (at + 4 > stss.end) break
    set.add(view.getUint32(at))
  }
  return set
}

/** stco / co64：每个 chunk 在文件中的偏移。 */
function readChunkOffsets(view: DataView, stbl: readonly Mp4Box[]): number[] {
  const stco = findBox(stbl, 'stco')
  const co64 = findBox(stbl, 'co64')
  const offsets: number[] = []
  if (stco) {
    const entries = readEntryCount(view, stco)
    for (let i = 0; i < entries; i += 1) {
      const at = stco.body + 8 + i * 4
      if (at + 4 > stco.end) break
      offsets.push(view.getUint32(at))
    }
    return offsets
  }
  if (co64) {
    const entries = readEntryCount(view, co64)
    for (let i = 0; i < entries; i += 1) {
      const at = co64.body + 8 + i * 8
      if (at + 8 > co64.end) break
      offsets.push(Number(view.getBigUint64(at)))
    }
  }
  return offsets
}

/** stsc：[first_chunk, samples_per_chunk, sample_description_index]，first_chunk 是 1-based 且只在变化时出现。 */
function readSampleToChunk(view: DataView, stsc: Mp4Box | undefined): Array<{ firstChunk: number; perChunk: number }> {
  const list: Array<{ firstChunk: number; perChunk: number }> = []
  if (!stsc) return list
  const entries = readEntryCount(view, stsc)
  for (let i = 0; i < entries; i += 1) {
    const at = stsc.body + 8 + i * 12
    if (at + 12 > stsc.end) break
    list.push({ firstChunk: view.getUint32(at), perChunk: view.getUint32(at + 4) })
  }
  return list
}

/**
 * 由 stsc + stco + stsz 推出每个样本的文件偏移。
 *
 * chunk 内的样本是首尾相接的，所以 chunk 起始偏移加上前面样本的大小之和即可。
 */
function computeSampleOffsets(
  sizes: readonly number[],
  chunkOffsets: readonly number[],
  sampleToChunk: ReadonlyArray<{ firstChunk: number; perChunk: number }>,
): number[] {
  const offsets: number[] = []
  if (!sampleToChunk.length || !chunkOffsets.length) return offsets

  let sampleIndex = 0
  for (let entry = 0; entry < sampleToChunk.length && sampleIndex < sizes.length; entry += 1) {
    const { firstChunk, perChunk } = sampleToChunk[entry]
    // 本项覆盖到下一项的 first_chunk 之前；最后一项一直覆盖到末尾
    const nextFirstChunk = sampleToChunk[entry + 1]?.firstChunk ?? chunkOffsets.length + 1
    for (let chunk = firstChunk; chunk < nextFirstChunk && sampleIndex < sizes.length; chunk += 1) {
      const base = chunkOffsets[chunk - 1]
      if (base === undefined) return offsets
      let cursor = base
      for (let n = 0; n < perChunk && sampleIndex < sizes.length; n += 1) {
        offsets.push(cursor)
        cursor += sizes[sampleIndex]
        sampleIndex += 1
      }
    }
  }
  return offsets
}

/** 从 stsd 的样本项里取出解码配置 box（avcC / hvcC / av1C / vpcC / esds）。 */
function readDecoderConfig(
  view: DataView,
  buffer: ArrayBuffer,
  entry: Mp4Box,
  extensionStart: number,
): { box: string; bytes: Bytes | null; hex: string } {
  const known = ['avcC', 'hvcC', 'av1C', 'vpcC', 'esds']
  const extensions = readBoxes(view, extensionStart, entry.end)
  const config = extensions.find((box) => known.includes(box.type))
  if (!config) return { box: '', bytes: null, hex: '' }
  return {
    box: config.type,
    // 整个 box（含 header）原样复制：写回输出时直接塞进新的 stsd，不需要重新构造
    bytes: new Uint8Array(buffer.slice(config.start, config.end)),
    hex: toHex(view, config.body, config.end),
  }
}

/**
 * 从 esds 里取出 AudioSpecificConfig（DecoderSpecificInfo，tag 0x05）的十六进制。
 *
 * 判断两条 AAC 音轨能不能接到同一条轨道上，只有这几个字节说了算：
 * 音频对象类型、采样率索引、声道配置——解码器就靠它初始化。
 * esds 里其余的 ES_ID、bufferSizeDB、maxBitrate、avgBitrate 都是编码器**按本段内容**算出来的，
 * 同一个编码器压两段不同的素材就会得到不同的值。拿整段 esds 比对，等于把本来能无损拼接的
 * 音轨判成「格式不一致」，然后静默丢掉声音。
 *
 * 结构解析不出来时返回空串，调用方回落到整段比对——宁可保守，也不要把真不兼容的接到一起。
 */
export function readAudioSpecificConfigHex(configBox: Bytes | null | undefined): string {
  // 传入的是整个 esds box：8 字节 box header + 4 字节 version/flags，之后才是描述符链
  if (!configBox || configBox.length < 13) return ''
  let cursor = 12

  /** 描述符长度是 7 位一组的变长整数，最高位为 1 表示还有后续字节。 */
  const readLength = (): number => {
    let length = 0
    for (let i = 0; i < 4; i += 1) {
      const byte = configBox[cursor]
      if (byte === undefined) return -1
      cursor += 1
      length = (length << 7) | (byte & 0x7f)
      if (!(byte & 0x80)) return length
    }
    return -1
  }

  if (configBox[cursor] !== 0x03) return '' // ES_Descriptor
  cursor += 1
  if (readLength() < 0) return ''
  cursor += 2 // ES_ID
  const flags = configBox[cursor]
  if (flags === undefined) return ''
  cursor += 1
  if (flags & 0x80) cursor += 2 // streamDependenceFlag：依赖的 ES_ID
  if (flags & 0x40) {
    // URL_Flag：1 字节长度 + URL 本身
    const urlLength = configBox[cursor]
    if (urlLength === undefined) return ''
    cursor += 1 + urlLength
  }
  if (flags & 0x20) cursor += 2 // OCRstreamFlag

  if (configBox[cursor] !== 0x04) return '' // DecoderConfigDescriptor
  cursor += 1
  if (readLength() < 0) return ''
  // objectTypeIndication(1) + streamType 等(1) + bufferSizeDB(3) + maxBitrate(4) + avgBitrate(4)
  cursor += 13

  if (configBox[cursor] !== 0x05) return '' // DecoderSpecificInfo
  cursor += 1
  const length = readLength()
  if (length <= 0 || cursor + length > configBox.length) return ''
  return Array.from(configBox.subarray(cursor, cursor + length), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** VisualSampleEntry 固定字段长度：6 保留 + 2 索引 + 70，其后才是 avcC 等扩展 box。 */
const VISUAL_SAMPLE_ENTRY_FIXED = 78
/** AudioSampleEntry 固定字段长度：6 保留 + 2 索引 + 20。 */
const AUDIO_SAMPLE_ENTRY_FIXED = 28

function parseTrack(view: DataView, buffer: ArrayBuffer, trak: Mp4Box): Mp4Track | null {
  const trakKids = readBoxes(view, trak.body, trak.end)
  const tkhd = findBox(trakKids, 'tkhd')
  const mdia = findBox(trakKids, 'mdia')
  if (!mdia) return null

  const mdiaKids = readBoxes(view, mdia.body, mdia.end)
  const mdhd = findBox(mdiaKids, 'mdhd')
  const hdlr = findBox(mdiaKids, 'hdlr')
  if (!mdhd || !hdlr) return null

  const handler = readFourCc(view, hdlr.body + 8)
  const mdhdV1 = readVersion(view, mdhd) === 1
  const timescale = mdhdV1 ? view.getUint32(mdhd.body + 20) : view.getUint32(mdhd.body + 12)
  const duration = mdhdV1 ? Number(view.getBigUint64(mdhd.body + 24)) : view.getUint32(mdhd.body + 16)
  const trackId = tkhd
    ? readVersion(view, tkhd) === 1
      ? view.getUint32(tkhd.body + 20)
      : view.getUint32(tkhd.body + 12)
    : 0

  const stblBox = findPath(view, mdiaKids, ['minf', 'stbl'])
  if (!stblBox) return null
  const stbl = readBoxes(view, stblBox.body, stblBox.end)

  const stsd = findBox(stbl, 'stsd')
  const entry = stsd && readEntryCount(view, stsd) > 0 ? readBoxes(view, stsd.body + 8, stsd.end)[0] : undefined

  const sizes = readSampleSizes(view, findBox(stbl, 'stsz'))
  const deltas = readSampleDeltas(view, findBox(stbl, 'stts'), sizes.length)
  const compositionOffsets = readCompositionOffsets(view, findBox(stbl, 'ctts'), sizes.length)
  const syncSamples = readSyncSamples(view, findBox(stbl, 'stss'))
  const offsets = computeSampleOffsets(
    sizes,
    readChunkOffsets(view, stbl),
    readSampleToChunk(view, findBox(stbl, 'stsc')),
  )

  const samples: Mp4Sample[] = []
  let dts = 0
  for (let i = 0; i < sizes.length; i += 1) {
    const offset = offsets[i]
    if (offset === undefined) break
    const sampleDuration = deltas[i] ?? deltas[deltas.length - 1] ?? 0
    samples.push({
      offset,
      size: sizes[i],
      dts,
      cts: dts + (compositionOffsets[i] || 0),
      duration: sampleDuration,
      sync: syncSamples ? syncSamples.has(i + 1) : true,
    })
    dts += sampleDuration
  }

  const track: Mp4Track = {
    id: trackId,
    handler,
    format: entry?.type || '',
    timescale,
    duration,
    samples,
    decoderConfig: null,
    decoderConfigBox: '',
    decoderConfigHex: '',
    width: 0,
    height: 0,
    displayWidth: tkhd ? Math.round(view.getUint32(tkhd.end - 8) / 65536) : 0,
    displayHeight: tkhd ? Math.round(view.getUint32(tkhd.end - 4) / 65536) : 0,
    sampleRate: 0,
    channels: 0,
    sampleEntryBytes: null,
  }

  if (entry) {
    const fixed = handler === 'soun' ? AUDIO_SAMPLE_ENTRY_FIXED : VISUAL_SAMPLE_ENTRY_FIXED
    if (handler === 'vide') {
      track.width = view.getUint16(entry.body + 24)
      track.height = view.getUint16(entry.body + 26)
    } else if (handler === 'soun') {
      track.channels = view.getUint16(entry.body + 16)
      track.sampleRate = view.getUint32(entry.body + 24) / 65536
    }
    const config = readDecoderConfig(view, buffer, entry, entry.body + fixed)
    track.decoderConfig = config.bytes
    track.decoderConfigBox = config.box
    track.decoderConfigHex = config.hex
    // 固定字段原样保留：写回输出时不需要逐字段重建 avc1/mp4a 头
    track.sampleEntryBytes = new Uint8Array(buffer.slice(entry.body, entry.body + fixed))
  }

  return track
}

/**
 * 解析一份完整 MP4 的样本表。
 *
 * 必须传入整份文件字节：moov 可能排在 mdat 之后，而样本偏移是相对整个文件的。
 */
export function demuxMp4(buffer: ArrayBuffer): DemuxedMp4 {
  if (!buffer || buffer.byteLength < 16) return { video: null, audio: null, error: '文件为空或过短' }

  const view = new DataView(buffer)
  const top = readBoxes(view, 0, buffer.byteLength)
  const moov = findBox(top, 'moov')
  if (!moov) return { video: null, audio: null, error: '没有找到 moov：不是标准 MP4，或文件被截断' }

  const moovKids = readBoxes(view, moov.body, moov.end)
  if (findBox(moovKids, 'mvex') || top.some((box) => box.type === 'moof')) {
    return { video: null, audio: null, error: '分片 MP4（fMP4）暂不支持无损拼接' }
  }

  const result: DemuxedMp4 = { video: null, audio: null }
  for (const trak of moovKids.filter((box) => box.type === 'trak')) {
    const track = parseTrack(view, buffer, trak)
    if (!track) continue
    if (track.handler === 'vide' && !result.video) result.video = track
    else if (track.handler === 'soun' && !result.audio) result.audio = track
  }

  if (!result.video) return { ...result, error: '没有可用的视频轨' }
  if (!result.video.samples.length) return { ...result, error: '视频轨没有样本，可能是分片或损坏的文件' }
  return result
}

/**
 * 找出覆盖 [inSec, outSec) 的样本区间，起点吸附到关键帧。
 *
 * 无损拼接不能从任意帧开始解码——起点必须是关键帧，否则解码器拿不到参考帧，
 * 开头会是一段花屏。这里返回真实生效的时间区间，供 UI 如实回显给用户。
 */
export function selectSampleRange(
  track: Mp4Track,
  inSec: number,
  outSec: number,
): { startIndex: number; endIndex: number; actualInSec: number; actualOutSec: number } | null {
  const samples = track.samples
  if (!samples.length || !(track.timescale > 0)) return null

  const inTicks = Math.max(0, inSec) * track.timescale
  const outTicks = Math.max(0, outSec) * track.timescale

  // 起点：离 inTicks 最近的关键帧。向前吸附会带进用户已经裁掉的内容，
  // 向后吸附会丢掉用户要的内容，取最近的那个整体误差最小。
  let startIndex = 0
  let bestDistance = Number.POSITIVE_INFINITY
  for (let i = 0; i < samples.length; i += 1) {
    if (!samples[i].sync) continue
    const distance = Math.abs(samples[i].dts - inTicks)
    if (distance < bestDistance) {
      bestDistance = distance
      startIndex = i
    } else if (samples[i].dts > inTicks) {
      break // 已经越过目标点且距离在变大，后面不会更近
    }
  }

  // 终点：最后一个解码时间仍在 outTicks 之前的样本
  let endIndex = startIndex
  for (let i = startIndex; i < samples.length; i += 1) {
    if (samples[i].dts >= outTicks) break
    endIndex = i
  }
  if (endIndex < startIndex) endIndex = startIndex

  const actualInSec = samples[startIndex].dts / track.timescale
  const actualOutSec = (samples[endIndex].dts + samples[endIndex].duration) / track.timescale
  return { startIndex, endIndex, actualInSec, actualOutSec }
}
