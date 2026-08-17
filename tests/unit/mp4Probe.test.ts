import { describe, expect, it } from 'vitest'
import { analyzeMp4ConcatCompatibility, getMp4ConcatKey, probeMp4 } from '@/utils/mp4Probe'

/* ── 合成结构正确、字段已知的 MP4，用来锁死 box 偏移 ──
   一律用 Uint8Array 而不是 Node 的 Buffer：测试的 types 只有 vite/client，
   加 @types/node 会连带把 src 按 Node 类型检查（setTimeout 变 NodeJS.Timeout）。 */

const bytes = (...values: number[]) => Uint8Array.from(values)
const zeros = (length: number) => new Uint8Array(length)
const u32 = (n: number) => {
  const buffer = new Uint8Array(4)
  new DataView(buffer.buffer).setUint32(0, n >>> 0)
  return buffer
}
const u16 = (n: number) => {
  const buffer = new Uint8Array(2)
  new DataView(buffer.buffer).setUint16(0, n)
  return buffer
}
const ascii = (text: string) => Uint8Array.from([...text].map((char) => char.charCodeAt(0)))
const concat = (parts: Uint8Array[]) => {
  const merged = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) {
    merged.set(part, offset)
    offset += part.length
  }
  return merged
}
const toHex = (data: Uint8Array) => [...data].map((byte) => byte.toString(16).padStart(2, '0')).join('')
const box = (type: string, ...parts: Uint8Array[]) => {
  const body = concat(parts)
  return concat([u32(body.length + 8), ascii(type), body])
}
const full = (type: string, version: number, ...parts: Uint8Array[]) => box(type, bytes(version, 0, 0, 0), ...parts)

const AVCC_1080P = bytes(0x01, 0x64, 0x00, 0x28, 0xff, 0xe1, 0x00, 0x04, 0x67, 0x64, 0x00, 0x28)
const AVCC_OTHER = bytes(0x01, 0x4d, 0x00, 0x1f, 0xff, 0xe1, 0x00, 0x04, 0x67, 0x4d, 0x00, 0x1f)

interface FakeMp4Options {
  width?: number
  height?: number
  frames?: number
  timescale?: number
  frameDelta?: number
  keyframes?: number[]
  avcc?: Uint8Array
  audio?: { sampleRate: number; channels: number } | null
  moovFirst?: boolean
}

function fakeMp4({
  width = 1920,
  height = 1080,
  frames = 150,
  timescale = 15360,
  frameDelta = 512,
  keyframes = [1, 31, 61, 91, 121],
  avcc = AVCC_1080P,
  audio = { sampleRate: 48000, channels: 2 },
  moovFirst = false,
}: FakeMp4Options = {}): ArrayBuffer {
  const duration = frames * frameDelta
  const tkhd = full(
    'tkhd',
    0,
    u32(0),
    u32(0),
    u32(1),
    u32(0),
    u32(duration),
    zeros(8),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    zeros(36),
    u32(width * 65536),
    u32(height * 65536),
  )
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
  const stbl = box(
    'stbl',
    full('stsd', 0, u32(1), avc1),
    full('stts', 0, u32(1), u32(frames), u32(frameDelta)),
    full('stss', 0, u32(keyframes.length), ...keyframes.map((n) => u32(n))),
  )
  const videoTrack = box(
    'trak',
    tkhd,
    box(
      'mdia',
      full('mdhd', 0, u32(0), u32(0), u32(timescale), u32(duration), u16(0x55c4), u16(0)),
      full('hdlr', 0, u32(0), ascii('vide'), zeros(12), bytes(0)),
      box('minf', stbl),
    ),
  )

  const tracks = [videoTrack]
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
    )
    tracks.push(
      box(
        'trak',
        full(
          'tkhd',
          0,
          u32(0),
          u32(0),
          u32(2),
          u32(0),
          u32(duration),
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
          full('mdhd', 0, u32(0), u32(0), u32(audio.sampleRate), u32(audio.sampleRate * 5), u16(0x55c4), u16(0)),
          full('hdlr', 0, u32(0), ascii('soun'), zeros(12), bytes(0)),
          box('minf', box('stbl', full('stsd', 0, u32(1), mp4a))),
        ),
      ),
    )
  }

  const ftyp = box('ftyp', ascii('isom'), u32(512), ascii('isomavc1'))
  const mdat = box('mdat', zeros(1024))
  const moov = box('moov', full('mvhd', 0, zeros(96)), ...tracks)
  const file = moovFirst ? concat([ftyp, moov, mdat]) : concat([ftyp, mdat, moov])
  return file.buffer as ArrayBuffer
}

describe('probeMp4', () => {
  it('读出视频轨规格、帧率与关键帧密度', () => {
    const probe = probeMp4(fakeMp4())
    expect(probe.error).toBeUndefined()
    expect(probe.brand).toBe('isom')
    expect(probe.fragmented).toBe(false)
    expect(probe.moovAfterMdat).toBe(true)
    expect(probe.video).toMatchObject({
      format: 'avc1',
      codedWidth: 1920,
      codedHeight: 1080,
      displayWidth: 1920,
      displayHeight: 1080,
      timescale: 15360,
      sampleCount: 150,
      keyframeCount: 5,
      allSync: false,
      decoderConfigBox: 'avcC',
      decoderConfigHex: toHex(AVCC_1080P),
      codecString: 'avc1.640028',
    })
    expect(probe.video?.durationSec).toBeCloseTo(5, 5)
    expect(probe.video?.fps).toBeCloseTo(30, 5)
    // 5 秒 5 个关键帧 → 裁剪只能吸附到 1 秒粒度
    expect(probe.video?.gopSec).toBeCloseTo(1, 5)
  })

  it('读出音频轨规格，并识别无音轨的素材', () => {
    expect(probeMp4(fakeMp4()).audio).toMatchObject({ format: 'mp4a', sampleRate: 48000, channels: 2 })
    expect(probeMp4(fakeMp4({ audio: null })).audio).toBeNull()
  })

  it('识别 moov 在文件头的排布（可只读文件头解析）', () => {
    expect(probeMp4(fakeMp4({ moovFirst: true })).moovAfterMdat).toBe(false)
  })

  it('对损坏或非 MP4 输入给出明确错误而不是崩溃', () => {
    expect(probeMp4(new ArrayBuffer(0)).error).toContain('过短')
    const garbage = new Uint8Array(64).fill(7)
    expect(probeMp4(garbage.buffer as ArrayBuffer).error).toContain('moov')
  })
})

describe('无损拼接判定', () => {
  it('规格完全一致时判定为可无损拼接', () => {
    const probes = [probeMp4(fakeMp4()), probeMp4(fakeMp4()), probeMp4(fakeMp4())]
    const result = analyzeMp4ConcatCompatibility(probes)
    expect(result.lossless).toBe(true)
    expect(result.groups).toEqual([[0, 1, 2]])
    expect(result.maxGopSec).toBeCloseTo(1, 5)
    expect(result.summary).toContain('可以无损拼接')
  })

  it.each([
    ['分辨率不同', { width: 1280, height: 720 }],
    ['解码配置不同', { avcc: AVCC_OTHER }],
    ['音轨结构不同', { audio: null }],
    ['采样率不同', { audio: { sampleRate: 44100, channels: 2 } }],
  ])('%s 时必须重编码', (_label, options) => {
    const result = analyzeMp4ConcatCompatibility([probeMp4(fakeMp4()), probeMp4(fakeMp4(options as never))])
    expect(result.lossless).toBe(false)
    expect(result.groups).toHaveLength(2)
    expect(result.summary).toContain('必须重编码')
  })

  it('帧率不同但解码配置一致时仍可无损拼接（时间戳可重排）', () => {
    const result = analyzeMp4ConcatCompatibility([
      probeMp4(fakeMp4()),
      probeMp4(fakeMp4({ frames: 120, frameDelta: 640 })),
    ])
    expect(result.lossless).toBe(true)
  })

  it('无法解析的素材单独归类并说明原因', () => {
    const result = analyzeMp4ConcatCompatibility([probeMp4(fakeMp4()), probeMp4(new ArrayBuffer(0))])
    expect(result.lossless).toBe(false)
    expect(result.invalid).toEqual([1])
    expect(result.summary).toContain('无法解析')
    expect(getMp4ConcatKey(null)).toBe('')
  })

  it('空输入不误判为可拼接', () => {
    const result = analyzeMp4ConcatCompatibility([])
    expect(result.lossless).toBe(false)
    expect(result.summary).toBe('没有可分析的素材')
  })
})
