/**
 * 构造结构完整、字段已知的 progressive MP4，供 demux / mux / 拼接用例使用。
 *
 * 与 mp4Probe.test.ts 里那份精简 fixture 的区别：这里带真实的样本表
 * （stsz / stsc / stco）和真实的 mdat 字节，因此可以逐样本校验偏移与内容——
 * box 偏移算错是静默的，读出来的是垃圾数值而不是异常，只有比对字节才能发现。
 *
 * 一律用 Uint8Array 而不是 Node 的 Buffer：测试的 types 只有 vite/client，
 * 加 @types/node 会连带把 src 按 Node 类型检查（setTimeout 变 NodeJS.Timeout）。
 */

export const bytes = (...values: number[]) => Uint8Array.from(values)
export const zeros = (length: number) => new Uint8Array(length)

export const u32 = (n: number) => {
  const buffer = new Uint8Array(4)
  new DataView(buffer.buffer).setUint32(0, n >>> 0)
  return buffer
}

export const u16 = (n: number) => {
  const buffer = new Uint8Array(2)
  new DataView(buffer.buffer).setUint16(0, n)
  return buffer
}

export const ascii = (text: string) => Uint8Array.from([...text].map((char) => char.charCodeAt(0)))

export const concat = (parts: Uint8Array[]) => {
  const merged = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) {
    merged.set(part, offset)
    offset += part.length
  }
  return merged
}

export const toHex = (data: Uint8Array) => [...data].map((byte) => byte.toString(16).padStart(2, '0')).join('')

export const box = (type: string, ...parts: Uint8Array[]) => {
  const body = concat(parts)
  return concat([u32(body.length + 8), ascii(type), body])
}

export const full = (type: string, version: number, ...parts: Uint8Array[]) =>
  box(type, bytes(version, 0, 0, 0), ...parts)

/** 1080p high@4.0 的 avcC；与 AVCC_ALT 不同，用来构造「规格不一致」场景。 */
export const AVCC_MAIN = bytes(0x01, 0x64, 0x00, 0x28, 0xff, 0xe1, 0x00, 0x04, 0x67, 0x64, 0x00, 0x28)
export const AVCC_ALT = bytes(0x01, 0x4d, 0x00, 0x1f, 0xff, 0xe1, 0x00, 0x04, 0x67, 0x4d, 0x00, 0x1f)

/** AAC-LC 48kHz 立体声的 AudioSpecificConfig。 */
export const ASC_AAC_LC_48K_STEREO = bytes(0x11, 0x90)
/** AAC-LC 44.1kHz 立体声：与上面属于真正不能直接拼在一起的两种配置。 */
export const ASC_AAC_LC_44K_STEREO = bytes(0x12, 0x10)

/**
 * 构造一个结构完整的 esds。
 *
 * avgBitrate 单独开出来是有原因的：真实编码器会按本段内容算出不同的码率写进这里，
 * 而它并不影响能否拼接。用例要靠它复现「同参数、不同码率」这个最常见的场景。
 */
export function esdsBox(asc: Uint8Array = ASC_AAC_LC_48K_STEREO, avgBitrate = 128000): Uint8Array {
  const descriptor = (tag: number, payload: Uint8Array) => concat([bytes(tag, payload.length), payload])
  const decoderSpecific = descriptor(0x05, asc)
  const decoderConfig = descriptor(
    0x04,
    concat([
      bytes(0x40, 0x15), // objectTypeIndication = AAC，streamType = audio
      bytes(0x00, 0x18, 0x00), // bufferSizeDB
      u32(avgBitrate * 2), // maxBitrate
      u32(avgBitrate),
      decoderSpecific,
    ]),
  )
  const es = descriptor(0x03, concat([u16(1), bytes(0x00), decoderConfig, descriptor(0x06, bytes(0x02))]))
  return full('esds', 0, es)
}

export interface FixtureOptions {
  /** 出现在每个样本字节里的标记，用来确认拼接后取到的是哪一段的内容。 */
  tag?: number
  width?: number
  height?: number
  frames?: number
  timescale?: number
  frameDelta?: number
  /** 关键帧的样本序号（1-based）。 */
  keyframes?: number[]
  avcc?: Uint8Array
  /** 每个视频样本的字节数按 baseSize + i 递增，确保偏移算错时一定对不上。 */
  baseSize?: number
  audio?: {
    sampleRate: number
    channels: number
    frames: number
    frameDelta: number
    /** 不传时用默认 esds；用来构造「同参数不同码率」「AudioSpecificConfig 不同」这两种场景。 */
    esds?: Uint8Array
  } | null
  /** true 时把 moov 放在 mdat 之前。 */
  moovFirst?: boolean
}

export interface Mp4Fixture {
  buffer: ArrayBuffer
  /** 每个视频样本的期望字节，供逐样本比对。 */
  videoSampleBytes: Uint8Array[]
  audioSampleBytes: Uint8Array[]
  options: Required<Omit<FixtureOptions, 'audio' | 'avcc'>> & {
    audio: FixtureOptions['audio']
    avcc: Uint8Array
  }
}

/** 每个样本填成可识别的字节：第 0 字节是段标记，第 1 字节是样本序号低位。 */
function makeSample(tag: number, index: number, size: number): Uint8Array {
  const data = new Uint8Array(size)
  data.fill((tag * 31 + index) & 0xff)
  data[0] = tag & 0xff
  data[1] = index & 0xff
  return data
}

/**
 * 生成一份可解析的 MP4。
 *
 * 样本布局：先所有视频样本，再所有音频样本，一个样本一个 chunk
 * （stsc 单项 + stco 逐样本），与 mp4Muxer 的输出布局一致。
 */
export function fixtureMp4(options: FixtureOptions = {}): Mp4Fixture {
  const {
    tag = 1,
    width = 1920,
    height = 1080,
    frames = 30,
    timescale = 15360,
    frameDelta = 512,
    keyframes = [1, 11, 21],
    avcc = AVCC_MAIN,
    baseSize = 100,
    audio = { sampleRate: 48000, channels: 2, frames: 47, frameDelta: 1024 },
    moovFirst = false,
  } = options

  const videoSampleBytes = Array.from({ length: frames }, (_, i) => makeSample(tag, i, baseSize + i))
  const audioSampleBytes = audio
    ? Array.from({ length: audio.frames }, (_, i) => makeSample(tag + 100, i, 40 + (i % 7)))
    : []

  const mdatPayload = concat([...videoSampleBytes, ...audioSampleBytes])
  const ftyp = box('ftyp', ascii('isom'), u32(512), ascii('isomiso2avc1mp41'))

  // 两种排布下 mdat 负载的起点不同；moov 在前时长度未知，先按 0 建一次量出长度再重建
  const buildMoov = (payloadStart: number) => {
    let cursor = payloadStart
    const videoOffsets = videoSampleBytes.map((sample) => {
      const offset = cursor
      cursor += sample.length
      return offset
    })
    const audioOffsets = audioSampleBytes.map((sample) => {
      const offset = cursor
      cursor += sample.length
      return offset
    })

    const videoDuration = frames * frameDelta
    const avc1 = box(
      'avc1',
      zeros(6),
      u16(1),
      zeros(16),
      u16(width),
      u16(height),
      u32(0x00480000),
      u32(0x00480000),
      u32(0),
      u16(1),
      zeros(32),
      u16(0x0018),
      u16(0xffff),
      box('avcC', avcc),
    )

    const videoStbl = box(
      'stbl',
      full('stsd', 0, u32(1), avc1),
      full('stts', 0, u32(1), u32(frames), u32(frameDelta)),
      full('stss', 0, u32(keyframes.length), ...keyframes.map((n) => u32(n))),
      full('stsc', 0, u32(1), u32(1), u32(1), u32(1)),
      full('stsz', 0, u32(0), u32(frames), ...videoSampleBytes.map((sample) => u32(sample.length))),
      full('stco', 0, u32(videoOffsets.length), ...videoOffsets.map((offset) => u32(offset))),
    )

    const videoTrak = box(
      'trak',
      full(
        'tkhd',
        0,
        u32(0),
        u32(0),
        u32(1),
        u32(0),
        u32(videoDuration),
        zeros(8),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        zeros(36),
        u32(width * 65536),
        u32(height * 65536),
      ),
      box(
        'mdia',
        full('mdhd', 0, u32(0), u32(0), u32(timescale), u32(videoDuration), u16(0x55c4), u16(0)),
        full('hdlr', 0, u32(0), ascii('vide'), zeros(12), bytes(0)),
        box('minf', box('vmhd', bytes(0, 0, 0, 1), zeros(8)), videoStbl),
      ),
    )

    const traks = [videoTrak]

    if (audio) {
      const mp4a = box(
        'mp4a',
        zeros(6),
        u16(1),
        zeros(8),
        u16(audio.channels),
        u16(16),
        u16(0),
        u16(0),
        u32(audio.sampleRate * 65536),
        audio.esds ?? esdsBox(),
      )
      const audioDuration = audio.frames * audio.frameDelta
      traks.push(
        box(
          'trak',
          full(
            'tkhd',
            0,
            u32(0),
            u32(0),
            u32(2),
            u32(0),
            u32(audioDuration),
            zeros(8),
            u16(0),
            u16(0),
            u16(0x0100),
            u16(0),
            zeros(36),
            u32(0),
            u32(0),
          ),
          box(
            'mdia',
            full('mdhd', 0, u32(0), u32(0), u32(audio.sampleRate), u32(audioDuration), u16(0x55c4), u16(0)),
            full('hdlr', 0, u32(0), ascii('soun'), zeros(12), bytes(0)),
            box(
              'minf',
              box('smhd', bytes(0, 0, 0, 0), zeros(4)),
              box(
                'stbl',
                full('stsd', 0, u32(1), mp4a),
                full('stts', 0, u32(1), u32(audio.frames), u32(audio.frameDelta)),
                full('stsc', 0, u32(1), u32(1), u32(1), u32(1)),
                full('stsz', 0, u32(0), u32(audio.frames), ...audioSampleBytes.map((s) => u32(s.length))),
                full('stco', 0, u32(audioOffsets.length), ...audioOffsets.map((offset) => u32(offset))),
              ),
            ),
          ),
        ),
      )
    }

    return box('moov', full('mvhd', 0, zeros(96)), ...traks)
  }

  let file: Uint8Array
  if (moovFirst) {
    // moov 长度依赖它自己写下的偏移，先量长度再用真实起点重建（表项数量不变，长度稳定）
    const probe = buildMoov(0)
    const payloadStart = ftyp.length + probe.length + 8
    const moov = buildMoov(payloadStart)
    file = concat([ftyp, moov, box('mdat', mdatPayload)])
  } else {
    const payloadStart = ftyp.length + 8
    file = concat([ftyp, box('mdat', mdatPayload), buildMoov(payloadStart)])
  }

  return {
    buffer: file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer,
    videoSampleBytes,
    audioSampleBytes,
    options: { tag, width, height, frames, timescale, frameDelta, keyframes, avcc, baseSize, audio, moovFirst },
  }
}
