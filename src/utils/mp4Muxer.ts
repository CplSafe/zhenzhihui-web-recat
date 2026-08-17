/**
 * 最小 MP4 封装器：把一串已编码样本写成可直接播放的 MP4。
 *
 * 只做封装，不碰码流——样本字节原样写入，解码配置（avcC/esds）从源文件整块复制。
 * 因此输出画质与源片逐字节一致，这也是「无损拼接」成立的前提。
 *
 * moov 写在 mdat 之前（faststart）：上传到素材中心后是边下边播，
 * moov 在尾部会让播放器必须先拉完整个文件才能起播。
 *
 * 代价是 chunk 偏移依赖 moov 自身大小，因此要写两遍：第一遍用占位偏移量出 moov 长度，
 * 第二遍填真实偏移。表项数量两遍完全一致，所以长度不会变，一次迭代即可收敛。
 */

import type { Bytes } from '@/utils/mp4Boxes'

export type { Bytes }

/** 待封装的单个样本。data 直接引用源缓冲区的切片，不做拷贝。 */
export interface MuxSample {
  data: Bytes
  /** 解码时间戳（所属轨道 timescale）。 */
  dts: number
  /** 显示时间戳。 */
  cts: number
  duration: number
  sync: boolean
}

export interface MuxTrack {
  kind: 'video' | 'audio'
  timescale: number
  /** 视频编码尺寸；音频轨传 0。 */
  width: number
  height: number
  /** stsd 样本项的 fourCC，例如 avc1 / mp4a。 */
  format: string
  /** 样本项固定字段（不含 box header），来自 mp4Demux 的 sampleEntryBytes。 */
  sampleEntry: Bytes
  /** 解码配置 box 的完整字节（含 header），例如整个 avcC。 */
  decoderConfig: Bytes | null
  samples: MuxSample[]
}

/** 影片时间轴的 timescale，固定 1000（毫秒），与轨道 timescale 无关。 */
const MOVIE_TIMESCALE = 1000
/** 未定义语言：ISO-639-2 'und' 的 5-bit 打包值。 */
const LANGUAGE_UND = 0x55c4
const MAX_UINT32 = 0xffffffff

/** 顺序写字节的小工具，自动扩容。 */
class ByteWriter {
  private buffer: Bytes
  private length = 0

  constructor(initial = 64 * 1024) {
    this.buffer = new Uint8Array(initial)
  }

  private ensure(extra: number) {
    if (this.length + extra <= this.buffer.length) return
    let next = this.buffer.length * 2
    while (next < this.length + extra) next *= 2
    const grown = new Uint8Array(next)
    grown.set(this.buffer.subarray(0, this.length))
    this.buffer = grown
  }

  u8(value: number) {
    this.ensure(1)
    this.buffer[this.length] = value & 0xff
    this.length += 1
  }

  u16(value: number) {
    this.ensure(2)
    this.buffer[this.length] = (value >>> 8) & 0xff
    this.buffer[this.length + 1] = value & 0xff
    this.length += 2
  }

  u32(value: number) {
    this.ensure(4)
    this.buffer[this.length] = (value >>> 24) & 0xff
    this.buffer[this.length + 1] = (value >>> 16) & 0xff
    this.buffer[this.length + 2] = (value >>> 8) & 0xff
    this.buffer[this.length + 3] = value & 0xff
    this.length += 4
  }

  i32(value: number) {
    this.u32(value < 0 ? value + 0x100000000 : value)
  }

  fourCc(value: string) {
    const text = `${value}    `.slice(0, 4)
    for (let i = 0; i < 4; i += 1) this.u8(text.charCodeAt(i))
  }

  bytes(value: Uint8Array) {
    this.ensure(value.length)
    this.buffer.set(value, this.length)
    this.length += value.length
  }

  zeros(count: number) {
    this.ensure(count)
    this.buffer.fill(0, this.length, this.length + count)
    this.length += count
  }

  /** 写一个 box：先占位长度，写完负载后回填。 */
  box(type: string, write: () => void) {
    const start = this.length
    this.u32(0)
    this.fourCc(type)
    write()
    const size = this.length - start
    this.buffer[start] = (size >>> 24) & 0xff
    this.buffer[start + 1] = (size >>> 16) & 0xff
    this.buffer[start + 2] = (size >>> 8) & 0xff
    this.buffer[start + 3] = size & 0xff
  }

  /** FullBox：box header 之后紧跟 version + 3 字节 flags。 */
  fullBox(type: string, version: number, flags: number, write: () => void) {
    this.box(type, () => {
      this.u8(version)
      this.u8((flags >>> 16) & 0xff)
      this.u8((flags >>> 8) & 0xff)
      this.u8(flags & 0xff)
      write()
    })
  }

  toUint8Array(): Bytes {
    return this.buffer.subarray(0, this.length)
  }
}

/** 轨道自身时间轴上的总时长。 */
function trackDuration(track: MuxTrack): number {
  return track.samples.reduce((total, sample) => total + sample.duration, 0)
}

/** 轨道时长换算到影片时间轴。 */
function movieDuration(track: MuxTrack): number {
  const ticks = trackDuration(track)
  return track.timescale > 0 ? Math.round((ticks / track.timescale) * MOVIE_TIMESCALE) : 0
}

/** 3x3 单位矩阵（16.16 定点，最后一行 2.30）。 */
function writeUnityMatrix(writer: ByteWriter) {
  const matrix = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000]
  matrix.forEach((value) => writer.u32(value))
}

function writeStsd(writer: ByteWriter, track: MuxTrack) {
  writer.fullBox('stsd', 0, 0, () => {
    writer.u32(1)
    writer.box(track.format, () => {
      writer.bytes(track.sampleEntry)
      if (track.decoderConfig) writer.bytes(track.decoderConfig)
    })
  })
}

/** stts：把逐样本 duration 压回 [count, delta] 游程。 */
function writeStts(writer: ByteWriter, track: MuxTrack) {
  const runs: Array<[number, number]> = []
  for (const sample of track.samples) {
    const last = runs[runs.length - 1]
    if (last && last[1] === sample.duration) last[0] += 1
    else runs.push([1, sample.duration])
  }
  writer.fullBox('stts', 0, 0, () => {
    writer.u32(runs.length)
    runs.forEach(([count, delta]) => {
      writer.u32(count)
      writer.u32(delta)
    })
  })
}

/** ctts：仅在存在显示偏移（B 帧重排）时写出。存在负偏移时用 version 1。 */
function writeCtts(writer: ByteWriter, track: MuxTrack) {
  const offsets = track.samples.map((sample) => sample.cts - sample.dts)
  if (offsets.every((offset) => offset === 0)) return

  const runs: Array<[number, number]> = []
  for (const offset of offsets) {
    const last = runs[runs.length - 1]
    if (last && last[1] === offset) last[0] += 1
    else runs.push([1, offset])
  }
  const signed = offsets.some((offset) => offset < 0)
  writer.fullBox('ctts', signed ? 1 : 0, 0, () => {
    writer.u32(runs.length)
    runs.forEach(([count, offset]) => {
      writer.u32(count)
      if (signed) writer.i32(offset)
      else writer.u32(offset)
    })
  })
}

/** stss：关键帧序号表。全部是关键帧时省略（等价语义，且省下一张表）。 */
function writeStss(writer: ByteWriter, track: MuxTrack) {
  if (track.samples.every((sample) => sample.sync)) return
  const indexes: number[] = []
  track.samples.forEach((sample, index) => {
    if (sample.sync) indexes.push(index + 1)
  })
  writer.fullBox('stss', 0, 0, () => {
    writer.u32(indexes.length)
    indexes.forEach((index) => writer.u32(index))
  })
}

/**
 * 写一条轨道的 stbl。
 *
 * 采用「一个样本一个 chunk」：stsc 恒为单项，stco 与样本一一对应。
 * 表会比按 chunk 分组略大（每样本 4 字节），换来的是偏移计算不会错，
 * 且样本可以按时间戳跨轨交错排列，边下边播时音视频同步到达。
 */
function writeStbl(writer: ByteWriter, track: MuxTrack, chunkOffsets: readonly number[]) {
  writer.box('stbl', () => {
    writeStsd(writer, track)
    writeStts(writer, track)
    writeCtts(writer, track)
    writeStss(writer, track)

    writer.fullBox('stsc', 0, 0, () => {
      writer.u32(1)
      writer.u32(1) // first_chunk
      writer.u32(1) // samples_per_chunk
      writer.u32(1) // sample_description_index
    })

    writer.fullBox('stsz', 0, 0, () => {
      writer.u32(0) // 非等长，逐个写
      writer.u32(track.samples.length)
      track.samples.forEach((sample) => writer.u32(sample.data.length))
    })

    writer.fullBox('stco', 0, 0, () => {
      writer.u32(chunkOffsets.length)
      chunkOffsets.forEach((offset) => writer.u32(offset))
    })
  })
}

function writeTrak(writer: ByteWriter, track: MuxTrack, trackId: number, chunkOffsets: readonly number[]) {
  const isVideo = track.kind === 'video'
  writer.box('trak', () => {
    // flags 0x7 = enabled | in movie | in preview
    writer.fullBox('tkhd', 0, 0x7, () => {
      writer.u32(0) // creation_time
      writer.u32(0) // modification_time
      writer.u32(trackId)
      writer.u32(0) // reserved
      writer.u32(movieDuration(track))
      writer.zeros(8) // reserved
      writer.u16(0) // layer
      writer.u16(0) // alternate_group
      writer.u16(isVideo ? 0 : 0x0100) // volume：音轨满音量
      writer.u16(0) // reserved
      writeUnityMatrix(writer)
      writer.u32((isVideo ? track.width : 0) * 65536)
      writer.u32((isVideo ? track.height : 0) * 65536)
    })

    writer.box('mdia', () => {
      writer.fullBox('mdhd', 0, 0, () => {
        writer.u32(0) // creation_time
        writer.u32(0) // modification_time
        writer.u32(track.timescale)
        writer.u32(trackDuration(track))
        writer.u16(LANGUAGE_UND)
        writer.u16(0) // pre_defined
      })

      writer.fullBox('hdlr', 0, 0, () => {
        writer.u32(0) // pre_defined
        writer.fourCc(isVideo ? 'vide' : 'soun')
        writer.zeros(12) // reserved
        writer.u8(0) // 空的 name（以 NUL 结尾）
      })

      writer.box('minf', () => {
        if (isVideo) {
          writer.fullBox('vmhd', 0, 1, () => {
            writer.u16(0) // graphicsmode
            writer.zeros(6) // opcolor
          })
        } else {
          writer.fullBox('smhd', 0, 0, () => {
            writer.u16(0) // balance
            writer.u16(0) // reserved
          })
        }

        writer.box('dinf', () => {
          writer.fullBox('dref', 0, 0, () => {
            writer.u32(1)
            // flags 1 = 媒体数据就在本文件内，无需外部 URL
            writer.fullBox('url ', 0, 1, () => {})
          })
        })

        writeStbl(writer, track, chunkOffsets)
      })
    })
  })
}

/** 交错后的样本顺序：每项记录它属于哪条轨道、在该轨道中的下标。 */
interface InterleavedEntry {
  trackIndex: number
  sampleIndex: number
}

/**
 * 按解码时间把各轨样本交错排列。
 *
 * 不交错（先写完整条视频轨再写音轨）也能播，但边下边播时音频要等视频全部下载完，
 * 前面一段是哑的。按时间归并后音视频字节在文件里就是同步靠近的。
 */
function interleaveSamples(tracks: readonly MuxTrack[]): InterleavedEntry[] {
  const cursors = tracks.map(() => 0)
  const order: InterleavedEntry[] = []
  const total = tracks.reduce((sum, track) => sum + track.samples.length, 0)

  for (let n = 0; n < total; n += 1) {
    let pick = -1
    let pickTime = Number.POSITIVE_INFINITY
    for (let t = 0; t < tracks.length; t += 1) {
      const sample = tracks[t].samples[cursors[t]]
      if (!sample) continue
      const seconds = tracks[t].timescale > 0 ? sample.dts / tracks[t].timescale : 0
      if (seconds < pickTime) {
        pickTime = seconds
        pick = t
      }
    }
    if (pick < 0) break
    order.push({ trackIndex: pick, sampleIndex: cursors[pick] })
    cursors[pick] += 1
  }
  return order
}

/** 写 ftyp。brand 用 isom + avc1，兼容面最广。 */
function writeFtyp(writer: ByteWriter) {
  writer.box('ftyp', () => {
    writer.fourCc('isom')
    writer.u32(512) // minor_version
    writer.fourCc('isom')
    writer.fourCc('iso2')
    writer.fourCc('avc1')
    writer.fourCc('mp41')
  })
}

/** 按给定的 chunk 偏移写出完整 moov。 */
function writeMoov(tracks: readonly MuxTrack[], offsetsByTrack: ReadonlyArray<readonly number[]>): Bytes {
  const writer = new ByteWriter()
  writer.box('moov', () => {
    const duration = Math.max(0, ...tracks.map(movieDuration))
    writer.fullBox('mvhd', 0, 0, () => {
      writer.u32(0) // creation_time
      writer.u32(0) // modification_time
      writer.u32(MOVIE_TIMESCALE)
      writer.u32(duration)
      writer.u32(0x00010000) // rate 1.0
      writer.u16(0x0100) // volume 1.0
      writer.u16(0) // reserved
      writer.zeros(8) // reserved
      writeUnityMatrix(writer)
      writer.zeros(24) // pre_defined
      writer.u32(tracks.length + 1) // next_track_ID
    })
    tracks.forEach((track, index) => writeTrak(writer, track, index + 1, offsetsByTrack[index]))
  })
  return writer.toUint8Array()
}

/**
 * 把若干轨道封装成一份 MP4。
 *
 * 返回 Blob 而不是单个 ArrayBuffer：样本字节仍然引用各自的源缓冲区，
 * Blob 由多段拼成，避免再复制一份完整成片（长片能省下几百 MB 峰值内存）。
 */
export function muxMp4(tracks: readonly MuxTrack[]): Blob {
  const usable = tracks.filter((track) => track.samples.length > 0)
  if (!usable.length) throw new Error('没有可封装的样本')

  const order = interleaveSamples(usable)

  // mdat 内的相对偏移：一个样本一个 chunk，按交错顺序首尾相接
  const relativeOffsets = usable.map((track) => new Array<number>(track.samples.length).fill(0))
  let payloadSize = 0
  for (const entry of order) {
    relativeOffsets[entry.trackIndex][entry.sampleIndex] = payloadSize
    payloadSize += usable[entry.trackIndex].samples[entry.sampleIndex].data.length
  }

  const ftypWriter = new ByteWriter(64)
  writeFtyp(ftypWriter)
  const ftyp = ftypWriter.toUint8Array()

  // 第一遍：占位偏移，只为量出 moov 的长度
  const probeMoov = writeMoov(usable, relativeOffsets)
  const payloadStart = ftyp.length + probeMoov.length + 8 // 8 = mdat 的 header

  if (payloadStart + payloadSize > MAX_UINT32) {
    throw new Error('成片超过 4GB，超出无损拼接支持的范围')
  }

  // 第二遍：填真实偏移。表项数量没变，moov 长度必然与第一遍一致
  const absoluteOffsets = relativeOffsets.map((list) => list.map((offset) => offset + payloadStart))
  const moov = writeMoov(usable, absoluteOffsets)
  if (moov.length !== probeMoov.length) {
    throw new Error('moov 长度在两遍写入之间变化，chunk 偏移不可信')
  }

  const mdatHeader = new ByteWriter(8)
  mdatHeader.u32(payloadSize + 8)
  mdatHeader.fourCc('mdat')

  const parts: BlobPart[] = [ftyp, moov, mdatHeader.toUint8Array()]
  for (const entry of order) parts.push(usable[entry.trackIndex].samples[entry.sampleIndex].data)

  return new Blob(parts, { type: 'video/mp4' })
}
