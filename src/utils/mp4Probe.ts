/**
 * 读取 MP4 的容器规格，并判定多条素材能否「无损拼接」（不重编码直接串成一条）。
 *
 * 只解析 moov 里的元数据，不碰实际码流：判定拼接可行性不需要解码。
 * 判定标准是解码配置（avcC/hvcC 等原始字节）与画面尺寸完全一致——
 * 解码器初始化参数相同，样本才能直接接到同一条轨道上；否则必须重编码。
 *
 * box 层的读取原语在 mp4Boxes.ts，与 mp4Demux.ts 共用。
 */
import { findBox, readBoxes, readFourCc, toHex, type Mp4Box } from '@/utils/mp4Boxes'

export interface Mp4VideoTrack {
  /** 样本格式：avc1 / hvc1 / av01 等。 */
  format: string
  codedWidth: number
  codedHeight: number
  /** tkhd 中的显示尺寸（可能因非方形像素与编码尺寸不同）。 */
  displayWidth: number
  displayHeight: number
  timescale: number
  durationSec: number
  sampleCount: number
  /** 帧率；样本间隔不均匀时按总帧数/总时长估算。 */
  fps: number
  keyframeCount: number
  /** 没有 stss 表示所有帧都是关键帧。 */
  allSync: boolean
  /** 关键帧平均间隔（秒）：不重编码时，裁剪点只能吸附到这个粒度。 */
  gopSec: number
  /** 解码配置 box 名（avcC/hvcC/av1C/vpcC）。 */
  decoderConfigBox: string
  /** 解码配置原始字节的十六进制；拼接兼容性以它是否相同为准。 */
  decoderConfigHex: string
  /** 形如 avc1.640028，可直接喂给 WebCodecs。 */
  codecString: string
}

export interface Mp4AudioTrack {
  format: string
  sampleRate: number
  channels: number
  timescale: number
  durationSec: number
}

export interface Mp4Probe {
  brand: string
  /** 分片 MP4（含 mvex/moof）：样本表在分片里，这里读不到完整轨道信息。 */
  fragmented: boolean
  /** moov 排在 mdat 之后：必须拿到整份文件才能解析规格。 */
  moovAfterMdat: boolean
  video: Mp4VideoTrack | null
  audio: Mp4AudioTrack | null
  /** 解析失败原因；非空时其余字段不可信。 */
  error?: string
}

interface RawTrack {
  handler: string
  video?: Mp4VideoTrack
  audio?: Mp4AudioTrack
}

function parseTrack(view: DataView, trak: Mp4Box): RawTrack | null {
  const trakKids = readBoxes(view, trak.body, trak.end)
  const tkhd = findBox(trakKids, 'tkhd')
  const mdia = findBox(trakKids, 'mdia')
  if (!mdia) return null

  const mdiaKids = readBoxes(view, mdia.body, mdia.end)
  const mdhd = findBox(mdiaKids, 'mdhd')
  const hdlr = findBox(mdiaKids, 'hdlr')
  const minf = findBox(mdiaKids, 'minf')
  if (!mdhd || !hdlr || !minf) return null

  const handler = readFourCc(view, hdlr.body + 8)
  const mdhdVersion = view.getUint8(mdhd.body)
  const timescale = mdhdVersion === 1 ? view.getUint32(mdhd.body + 20) : view.getUint32(mdhd.body + 12)
  const mediaDuration = mdhdVersion === 1 ? Number(view.getBigUint64(mdhd.body + 24)) : view.getUint32(mdhd.body + 16)
  const durationSec = timescale > 0 ? mediaDuration / timescale : 0

  const stbl = findBox(readBoxes(view, minf.body, minf.end), 'stbl')
  if (!stbl) return null
  const stblKids = readBoxes(view, stbl.body, stbl.end)
  const stsd = findBox(stblKids, 'stsd')
  const stts = findBox(stblKids, 'stts')
  const stss = findBox(stblKids, 'stss')

  const entry = stsd && view.getUint32(stsd.body + 4) > 0 ? readBoxes(view, stsd.body + 8, stsd.end)[0] : undefined

  if (handler === 'vide') {
    // tkhd 末尾 8 字节是 16.16 定点的显示宽高
    const displayWidth = tkhd ? Math.round(view.getUint32(tkhd.end - 8) / 65536) : 0
    const displayHeight = tkhd ? Math.round(view.getUint32(tkhd.end - 4) / 65536) : 0

    let sampleCount = 0
    let ticks = 0
    if (stts) {
      const entries = view.getUint32(stts.body + 4)
      for (let i = 0; i < entries; i += 1) {
        const count = view.getUint32(stts.body + 8 + i * 8)
        const delta = view.getUint32(stts.body + 12 + i * 8)
        sampleCount += count
        ticks += count * delta
      }
    }
    const measuredDuration = ticks > 0 && timescale > 0 ? ticks / timescale : durationSec
    const keyframeCount = stss ? view.getUint32(stss.body + 4) : sampleCount

    const track: Mp4VideoTrack = {
      format: entry?.type || '',
      codedWidth: 0,
      codedHeight: 0,
      displayWidth,
      displayHeight,
      timescale,
      durationSec,
      sampleCount,
      fps: measuredDuration > 0 ? sampleCount / measuredDuration : 0,
      keyframeCount,
      allSync: !stss,
      gopSec: keyframeCount > 0 && durationSec > 0 ? durationSec / keyframeCount : 0,
      decoderConfigBox: '',
      decoderConfigHex: '',
      codecString: '',
    }

    if (entry) {
      // VisualSampleEntry：固定字段共 78 字节，其后才是 avcC/hvcC 等扩展 box
      track.codedWidth = view.getUint16(entry.start + 8 + 24)
      track.codedHeight = view.getUint16(entry.start + 8 + 26)
      const extensions = readBoxes(view, entry.start + 8 + 78, entry.end)
      const config = extensions.find((box) => ['avcC', 'hvcC', 'av1C', 'vpcC'].includes(box.type))
      if (config) {
        track.decoderConfigBox = config.type
        track.decoderConfigHex = toHex(view, config.body, config.end)
        if (config.type === 'avcC' && config.end - config.body >= 4) {
          const profile = view.getUint8(config.body + 1)
          const compat = view.getUint8(config.body + 2)
          const level = view.getUint8(config.body + 3)
          track.codecString = `avc1.${[profile, compat, level].map((b) => b.toString(16).padStart(2, '0')).join('')}`
        }
      }
    }
    return { handler, video: track }
  }

  if (handler === 'soun' && entry) {
    return {
      handler,
      audio: {
        format: entry.type,
        channels: view.getUint16(entry.start + 8 + 16),
        sampleRate: view.getUint32(entry.start + 8 + 24) / 65536,
        timescale,
        durationSec,
      },
    }
  }

  return { handler }
}

/** 解析一份完整 MP4 的容器规格。传入的必须是整份文件字节（moov 可能在末尾）。 */
export function probeMp4(buffer: ArrayBuffer): Mp4Probe {
  const empty: Mp4Probe = { brand: '', fragmented: false, moovAfterMdat: false, video: null, audio: null }
  if (!buffer || buffer.byteLength < 16) return { ...empty, error: '文件为空或过短' }

  const view = new DataView(buffer)
  const top = readBoxes(view, 0, buffer.byteLength)
  const ftyp = findBox(top, 'ftyp')
  const moov = findBox(top, 'moov')
  if (!moov) return { ...empty, error: '没有找到 moov：不是标准 MP4，或文件被截断' }

  const moovKids = readBoxes(view, moov.body, moov.end)
  const mdatIndex = top.findIndex((box) => box.type === 'mdat')
  const moovIndex = top.findIndex((box) => box.type === 'moov')

  const probe: Mp4Probe = {
    brand: ftyp ? readFourCc(view, ftyp.body) : '',
    fragmented: Boolean(findBox(moovKids, 'mvex')) || top.some((box) => box.type === 'moof'),
    moovAfterMdat: mdatIndex >= 0 && moovIndex > mdatIndex,
    video: null,
    audio: null,
  }

  for (const trak of moovKids.filter((box) => box.type === 'trak')) {
    const parsed = parseTrack(view, trak)
    if (!parsed) continue
    if (parsed.video && !probe.video) probe.video = parsed.video
    if (parsed.audio && !probe.audio) probe.audio = parsed.audio
  }

  if (!probe.video) probe.error = '没有可用的视频轨'
  return probe
}

/**
 * 无损拼接的兼容键：解码配置 + 编码尺寸 + 音轨结构。
 * 三者完全一致的素材才能不重编码地接在一起；键不同即必须重编码。
 */
export function getMp4ConcatKey(probe: Mp4Probe | null | undefined): string {
  if (!probe || probe.error || !probe.video) return ''
  const video = probe.video
  const audio = probe.audio
  return [
    video.decoderConfigBox || video.format,
    video.decoderConfigHex || 'no-config',
    `${video.codedWidth}x${video.codedHeight}`,
    audio ? `${audio.format}/${Math.round(audio.sampleRate)}/${audio.channels}` : 'no-audio',
  ].join('|')
}

export interface Mp4ConcatCompatibility {
  /** 全部素材规格一致，可以不重编码直接拼接。 */
  lossless: boolean
  /** 按兼容键分组后的下标集合；长度 > 1 说明规格不统一。 */
  groups: number[][]
  /** 有素材解析失败或没有视频轨时的下标。 */
  invalid: number[]
  /** 所有素材里最长的关键帧间隔：不重编码时裁剪精度受它约束。 */
  maxGopSec: number
  /** 用户可读的结论。 */
  summary: string
}

/** 判定一组素材能否无损拼接，并给出裁剪精度参考。 */
export function analyzeMp4ConcatCompatibility(
  probes: readonly (Mp4Probe | null | undefined)[],
): Mp4ConcatCompatibility {
  const byKey = new Map<string, number[]>()
  const invalid: number[] = []
  let maxGopSec = 0

  probes.forEach((probe, index) => {
    const key = getMp4ConcatKey(probe)
    if (!key) {
      invalid.push(index)
      return
    }
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key)!.push(index)
    maxGopSec = Math.max(maxGopSec, probe?.video?.gopSec || 0)
  })

  const groups = [...byKey.values()]
  const lossless = invalid.length === 0 && groups.length === 1 && probes.length > 0

  let summary: string
  if (!probes.length) summary = '没有可分析的素材'
  else if (invalid.length) summary = `有 ${invalid.length} 条素材无法解析或缺少视频轨，需要重编码或改用后端合成`
  else if (lossless) summary = `全部 ${probes.length} 条素材规格一致，可以无损拼接（不重编码）`
  else summary = `出现 ${groups.length} 种不同规格，跨规格拼接必须重编码`

  return { lossless, groups, invalid, maxGopSec, summary }
}
