import { describe, expect, it } from 'vitest'
import { demuxMp4 } from '@/utils/mp4Demux'
import { concatMp4Sources } from '@/utils/videoConcat'
import { ASC_AAC_LC_44K_STEREO, ASC_AAC_LC_48K_STEREO, AVCC_ALT, esdsBox, fixtureMp4 } from '../helpers/mp4Fixture'

/** 与 fixture 默认音轨一致，用例里只改 esds。 */
const DEFAULT_AUDIO = { sampleRate: 48000, channels: 2, frames: 47, frameDelta: 1024 }

/** 把拼接结果重新解析回来——只有能被自己的解析器读回，才算真的写对了。 */
async function reparse(blob: Blob) {
  const buffer = await blob.arrayBuffer()
  return { buffer, result: demuxMp4(buffer), file: new Uint8Array(buffer) }
}

const clip = (tag: number, options: Parameters<typeof fixtureMp4>[0] = {}) =>
  fixtureMp4({ tag, frames: 30, keyframes: [1, 11, 21], ...options })

describe('concatMp4Sources', () => {
  it('两段整片拼接后可被重新解析，样本按顺序保留且字节未被改动', async () => {
    const a = clip(1)
    const b = clip(2)
    const out = concatMp4Sources([
      { buffer: a.buffer, inSec: 0, outSec: 1 },
      { buffer: b.buffer, inSec: 0, outSec: 1 },
    ])

    const { result, file } = await reparse(out.blob)
    expect(result.error).toBeUndefined()

    const video = result.video!
    expect(video.samples).toHaveLength(60)
    expect(video.width).toBe(1920)
    expect(video.height).toBe(1080)
    // 解码配置整块复制，与源片逐字节一致
    expect(video.decoderConfigHex).toBe(demuxMp4(a.buffer).video!.decoderConfigHex)

    // 前 30 个样本来自第 1 段，后 30 个来自第 2 段，内容逐字节保留
    const expected = [...a.videoSampleBytes, ...b.videoSampleBytes]
    video.samples.forEach((sample, index) => {
      const actual = file.subarray(sample.offset, sample.offset + sample.size)
      expect(Array.from(actual)).toEqual(Array.from(expected[index]))
    })
  })

  it('输出时间戳单调递增，第二段接在第一段之后而不是从零重来', async () => {
    const out = concatMp4Sources([
      { buffer: clip(1).buffer, inSec: 0, outSec: 1 },
      { buffer: clip(2).buffer, inSec: 0, outSec: 1 },
    ])
    const { result } = await reparse(out.blob)
    const samples = result.video!.samples

    for (let i = 1; i < samples.length; i += 1) {
      expect(samples[i].dts).toBeGreaterThan(samples[i - 1].dts)
    }
    // 第 2 段的首帧应当正好接在第 1 段末尾（30 帧 × 512 ticks）
    expect(samples[30].dts).toBe(30 * 512)
    expect(out.durationSec).toBeCloseTo(2, 3)
  })

  it('每段的首帧都是关键帧，否则解码器拿不到参考帧', async () => {
    const out = concatMp4Sources([
      { buffer: clip(1).buffer, inSec: 0.3, outSec: 0.9 },
      { buffer: clip(2).buffer, inSec: 0.3, outSec: 0.9 },
    ])
    const { result } = await reparse(out.blob)
    const samples = result.video!.samples
    const syncIndexes = samples.map((sample, index) => (sample.sync ? index : -1)).filter((i) => i >= 0)

    expect(samples[0].sync).toBe(true)
    // 两段各自的起点都必须落在关键帧上
    expect(syncIndexes).toContain(0)
    expect(out.segments).toHaveLength(2)
    out.segments.forEach((segment) => {
      // 0.3s 吸附到 10 号关键帧 = 0.3333s
      expect(segment.actualInSec).toBeCloseTo((10 * 512) / 15360, 4)
      expect(segment.requestedInSec).toBe(0.3)
    })
  })

  it('裁剪点吸附结果如实返回，供 UI 回显真实生效的区间', () => {
    const out = concatMp4Sources([
      { buffer: clip(1).buffer, inSec: 0.05, outSec: 0.5 },
      { buffer: clip(2).buffer, inSec: 0, outSec: 1 },
    ])
    expect(out.segments[0].actualInSec).toBe(0)
    expect(out.segments[0].requestedInSec).toBe(0.05)
    expect(out.segments[0].actualOutSec).toBeCloseTo((15 * 512) / 15360, 4)
  })

  it('保留音轨并按累计秒数重设时间基点', async () => {
    const out = concatMp4Sources([
      { buffer: clip(1).buffer, inSec: 0, outSec: 1 },
      { buffer: clip(2).buffer, inSec: 0, outSec: 1 },
    ])
    const { result } = await reparse(out.blob)
    const audio = result.audio!
    expect(audio.format).toBe('mp4a')
    expect(audio.timescale).toBe(48000)
    expect(audio.samples.length).toBeGreaterThan(0)
    for (let i = 1; i < audio.samples.length; i += 1) {
      expect(audio.samples[i].dts).toBeGreaterThanOrEqual(audio.samples[i - 1].dts)
    }
    expect(out.warnings).toEqual([])
  })

  it('全部静音时不写音轨', async () => {
    const out = concatMp4Sources([
      { buffer: clip(1).buffer, inSec: 0, outSec: 1, muted: true },
      { buffer: clip(2).buffer, inSec: 0, outSec: 1, muted: true },
    ])
    const { result } = await reparse(out.blob)
    expect(result.audio).toBeNull()
    expect(result.video?.samples.length).toBeGreaterThan(0)
  })

  it('逐段静音无法无损实现，明确报错而不是静默丢音', () => {
    expect(() =>
      concatMp4Sources([
        { buffer: clip(1).buffer, inSec: 0, outSec: 1, muted: true },
        { buffer: clip(2).buffer, inSec: 0, outSec: 1 },
      ]),
    ).toThrow(/逐段静音/)
  })

  it('有片段缺音轨时降级为无声，并给出提示', async () => {
    const out = concatMp4Sources([
      { buffer: clip(1).buffer, inSec: 0, outSec: 1 },
      { buffer: clip(2, { audio: null }).buffer, inSec: 0, outSec: 1 },
    ])
    const { result } = await reparse(out.blob)
    expect(result.audio).toBeNull()
    expect(out.warnings.join()).toContain('无声')
  })

  it('音频格式不一致时降级为无声，并给出提示', () => {
    const out = concatMp4Sources([
      { buffer: clip(1).buffer, inSec: 0, outSec: 1 },
      {
        buffer: clip(2, { audio: { sampleRate: 44100, channels: 2, frames: 40, frameDelta: 1024 } }).buffer,
        inSec: 0,
        outSec: 1,
      },
    ])
    expect(out.warnings.join()).toContain('无声')
  })

  it('同参数但码率不同的音轨照样保留声音——真实编码器逐段算出的码率本来就不一样', async () => {
    // esds 里的 bufferSizeDB / maxBitrate / avgBitrate 是按本段内容算的，两段必然不同；
    // 拿整段 esds 比对会把这种「其实完全兼容」的音轨判成格式不一致，声音就被静默丢掉了。
    const out = concatMp4Sources([
      {
        buffer: clip(1, { audio: { ...DEFAULT_AUDIO, esds: esdsBox(ASC_AAC_LC_48K_STEREO, 128000) } }).buffer,
        inSec: 0,
        outSec: 1,
      },
      {
        buffer: clip(2, { audio: { ...DEFAULT_AUDIO, esds: esdsBox(ASC_AAC_LC_48K_STEREO, 96431) } }).buffer,
        inSec: 0,
        outSec: 1,
      },
    ])

    const { result } = await reparse(out.blob)
    expect(result.audio).not.toBeNull()
    expect(result.audio!.samples.length).toBeGreaterThan(0)
    expect(out.warnings).toEqual([])
  })

  it('AudioSpecificConfig 真的不同时仍然丢音——这种才是解码器接不上的', () => {
    const out = concatMp4Sources([
      {
        buffer: clip(1, { audio: { ...DEFAULT_AUDIO, esds: esdsBox(ASC_AAC_LC_48K_STEREO) } }).buffer,
        inSec: 0,
        outSec: 1,
      },
      {
        buffer: clip(2, { audio: { ...DEFAULT_AUDIO, esds: esdsBox(ASC_AAC_LC_44K_STEREO) } }).buffer,
        inSec: 0,
        outSec: 1,
      },
    ])
    expect(out.warnings.join()).toContain('无声')
  })

  it('视频规格不一致时拒绝拼接，并指出是哪一段', () => {
    expect(() =>
      concatMp4Sources([
        { buffer: clip(1).buffer, inSec: 0, outSec: 1 },
        { buffer: clip(2, { width: 1280, height: 720 }).buffer, inSec: 0, outSec: 1, label: '片段 2' },
      ]),
    ).toThrow(/片段 2.*规格不同/)

    expect(() =>
      concatMp4Sources([
        { buffer: clip(1).buffer, inSec: 0, outSec: 1 },
        { buffer: clip(2, { avcc: AVCC_ALT }).buffer, inSec: 0, outSec: 1 },
      ]),
    ).toThrow(/规格不同/)
  })

  it('帧率不同但解码配置一致时可以拼，时间轴换算到统一刻度', async () => {
    const out = concatMp4Sources([
      { buffer: clip(1).buffer, inSec: 0, outSec: 1 },
      // 24fps：timescale 12288 / 每帧 512
      { buffer: clip(2, { timescale: 12288, frames: 24 }).buffer, inSec: 0, outSec: 1 },
    ])
    const { result } = await reparse(out.blob)
    const samples = result.video!.samples
    expect(result.video!.timescale).toBe(15360)
    expect(samples).toHaveLength(54)
    for (let i = 1; i < samples.length; i += 1) {
      expect(samples[i].dts).toBeGreaterThan(samples[i - 1].dts)
    }
    expect(out.durationSec).toBeCloseTo(2, 2)
  })

  it('单段也能输出（等价于一次纯裁剪）', async () => {
    const out = concatMp4Sources([{ buffer: clip(1).buffer, inSec: 0.35, outSec: 0.8 }])
    const { result } = await reparse(out.blob)
    expect(result.error).toBeUndefined()
    expect(result.video!.samples[0].sync).toBe(true)
    expect(out.segments).toHaveLength(1)
  })

  it('素材无法解析时指出是哪一段', () => {
    expect(() =>
      concatMp4Sources([
        { buffer: clip(1).buffer, inSec: 0, outSec: 1 },
        { buffer: new ArrayBuffer(0), inSec: 0, outSec: 1 },
      ]),
    ).toThrow(/片段 2解析失败/)
  })

  it('空输入直接拒绝', () => {
    expect(() => concatMp4Sources([])).toThrow(/没有可拼接/)
  })
})
