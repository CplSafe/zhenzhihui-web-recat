import { describe, expect, it } from 'vitest'
import { demuxMp4, selectSampleRange } from '@/utils/mp4Demux'
import { AVCC_MAIN, fixtureMp4, toHex } from '../helpers/mp4Fixture'

describe('demuxMp4', () => {
  it('还原视频样本表：偏移、时间戳、关键帧标记', () => {
    const fixture = fixtureMp4({ frames: 30, frameDelta: 512, keyframes: [1, 11, 21] })
    const result = demuxMp4(fixture.buffer)

    expect(result.error).toBeUndefined()
    const video = result.video!
    expect(video.handler).toBe('vide')
    expect(video.format).toBe('avc1')
    expect(video.timescale).toBe(15360)
    expect(video.width).toBe(1920)
    expect(video.height).toBe(1080)
    expect(video.decoderConfigBox).toBe('avcC')
    expect(video.decoderConfigHex).toBe(toHex(AVCC_MAIN))
    expect(video.samples).toHaveLength(30)

    // dts 逐帧递增；关键帧只在 1/11/21 三处（转成 0-based 即 0/10/20）
    expect(video.samples[0]).toMatchObject({ dts: 0, cts: 0, duration: 512, sync: true })
    expect(video.samples[10]).toMatchObject({ dts: 10 * 512, sync: true })
    expect(video.samples[11]).toMatchObject({ dts: 11 * 512, sync: false })
    expect(video.samples.filter((sample) => sample.sync)).toHaveLength(3)
  })

  it('样本偏移指向真正的样本字节', () => {
    const fixture = fixtureMp4({ tag: 7, frames: 12 })
    const video = demuxMp4(fixture.buffer).video!
    const file = new Uint8Array(fixture.buffer)

    // 逐样本比对内容：偏移算错时长度可能碰巧对，但字节一定对不上
    video.samples.forEach((sample, index) => {
      const actual = file.subarray(sample.offset, sample.offset + sample.size)
      expect(Array.from(actual)).toEqual(Array.from(fixture.videoSampleBytes[index]))
    })
  })

  it('moov 在文件头时同样能解析', () => {
    const fixture = fixtureMp4({ moovFirst: true, frames: 8 })
    const video = demuxMp4(fixture.buffer).video!
    const file = new Uint8Array(fixture.buffer)
    expect(video.samples).toHaveLength(8)
    const first = video.samples[0]
    expect(Array.from(file.subarray(first.offset, first.offset + first.size))).toEqual(
      Array.from(fixture.videoSampleBytes[0]),
    )
  })

  it('解析音频轨规格与样本', () => {
    const fixture = fixtureMp4({ audio: { sampleRate: 48000, channels: 2, frames: 20, frameDelta: 1024 } })
    const audio = demuxMp4(fixture.buffer).audio!
    expect(audio).toMatchObject({ handler: 'soun', format: 'mp4a', sampleRate: 48000, channels: 2, timescale: 48000 })
    expect(audio.samples).toHaveLength(20)
    // 音频样本没有 stss，应当全部按关键帧处理
    expect(audio.samples.every((sample) => sample.sync)).toBe(true)
    expect(audio.decoderConfigBox).toBe('esds')
  })

  it('无音轨素材不报错，audio 为 null', () => {
    const result = demuxMp4(fixtureMp4({ audio: null }).buffer)
    expect(result.error).toBeUndefined()
    expect(result.audio).toBeNull()
    expect(result.video?.samples.length).toBeGreaterThan(0)
  })

  it('对损坏输入给出明确错误而不是崩溃', () => {
    expect(demuxMp4(new ArrayBuffer(0)).error).toContain('过短')
    expect(demuxMp4(new Uint8Array(64).fill(7).buffer as ArrayBuffer).error).toContain('moov')
  })
})

describe('selectSampleRange', () => {
  // 30 帧 / 15360 timescale / 512 每帧 = 30fps，关键帧在第 0、10、20 帧（即 0s / 0.333s / 0.667s）
  const video = () => demuxMp4(fixtureMp4({ frames: 30, keyframes: [1, 11, 21] }).buffer).video!

  it('起点吸附到最近的关键帧', () => {
    const track = video()
    // 0.30s 离 10 号关键帧（0.3333s）比离 0 号（0s）更近
    const range = selectSampleRange(track, 0.3, 0.9)
    expect(range?.startIndex).toBe(10)
    expect(range?.actualInSec).toBeCloseTo((10 * 512) / 15360, 5)
  })

  it('起点更靠近前一个关键帧时向前吸附', () => {
    const range = selectSampleRange(video(), 0.05, 0.5)
    expect(range?.startIndex).toBe(0)
    expect(range?.actualInSec).toBe(0)
  })

  it('终点取最后一个仍在区间内的样本，不吸附关键帧', () => {
    const track = video()
    const range = selectSampleRange(track, 0, 0.5)
    // 0.5s = 15 帧，最后一个 dts < 0.5s 的是第 14 帧
    expect(range?.endIndex).toBe(14)
    expect(range?.actualOutSec).toBeCloseTo((15 * 512) / 15360, 5)
  })

  it('区间过窄时至少保留一个样本，不会返回空区间', () => {
    const range = selectSampleRange(video(), 0.34, 0.34)
    expect(range).not.toBeNull()
    expect(range!.endIndex).toBeGreaterThanOrEqual(range!.startIndex)
  })

  it('没有样本时返回 null', () => {
    const track = { ...video(), samples: [] }
    expect(selectSampleRange(track, 0, 1)).toBeNull()
  })
})
