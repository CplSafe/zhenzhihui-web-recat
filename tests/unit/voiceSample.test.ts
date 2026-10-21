import { describe, expect, it, vi } from 'vitest'
import { decodeVoiceVideo, isVoiceVideoFile, validateVoiceSampleRange, voiceSampleWav } from '@/utils/voiceSample'
import { demuxMp4 } from '@/utils/mp4Demux'
import { fixtureMp4 } from '../helpers/mp4Fixture'

describe('视频声音样本', () => {
  it('限定视频格式与 5～30 秒选区', () => {
    expect(isVoiceVideoFile({ name: 'a.mp4', type: '' })).toBe(true)
    expect(isVoiceVideoFile({ name: 'a.webm', type: 'video/webm' })).toBe(false)
    expect(validateVoiceSampleRange(60, 5, 35)).toBe('')
    expect(validateVoiceSampleRange(60, 0, 4)).toContain('5～30')
    expect(validateVoiceSampleRange(60, 0, 31)).toContain('5～30')
    expect(validateVoiceSampleRange(6, 2, 8)).toContain('有效')
    expect(validateVoiceSampleRange(6, NaN, 6)).toContain('有效')
  })
  it('真实去掉视频轨后解码，支持取消和无音轨报错', async () => {
    let extracted: ArrayBuffer | undefined
    const decoded = { duration: 8 } as AudioBuffer
    vi.stubGlobal(
      'OfflineAudioContext',
      class {
        async decodeAudioData(bytes: ArrayBuffer) {
          extracted = bytes
          return decoded
        }
      },
    )
    const source = fixtureMp4()
    const file = {
      name: 'video.mp4',
      type: 'video/mp4',
      size: source.buffer.byteLength,
      arrayBuffer: async () => source.buffer,
    } as File
    expect(await decodeVoiceVideo(file, new AbortController().signal)).toBe(decoded)
    expect(demuxMp4(extracted!).video).toBeFalsy()
    expect(demuxMp4(extracted!).audio?.samples.length).toBeGreaterThan(0)
    const abort = new AbortController()
    abort.abort()
    await expect(decodeVoiceVideo(file, abort.signal)).rejects.toMatchObject({ name: 'AbortError' })
    const silent = fixtureMp4({ audio: null })
    await expect(
      decodeVoiceVideo({ ...file, arrayBuffer: async () => silent.buffer }, new AbortController().signal),
    ).rejects.toThrow('没有')
    vi.unstubAllGlobals()
  })
  it('只导出选区，写入单声道 PCM WAV 头与采样', async () => {
    const channel = new Float32Array(80).fill(0.5)
    const buffer = {
      duration: 8,
      sampleRate: 10,
      length: 80,
      numberOfChannels: 2,
      getChannelData: () => channel,
    } as unknown as AudioBuffer
    const blob = voiceSampleWav(buffer, 1, 6)
    const view = new DataView(await blob.arrayBuffer())
    expect(blob.type).toBe('audio/wav')
    expect(blob.size).toBe(144)
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(40, true)).toBe(100)
    expect(view.getInt16(44, true)).toBe(16384)
    expect(() => voiceSampleWav(buffer, 1, 2)).toThrow('5～30')
  })
})
