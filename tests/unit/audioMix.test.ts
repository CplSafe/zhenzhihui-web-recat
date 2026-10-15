import { afterEach, describe, expect, it, vi } from 'vitest'
import { audioBufferToWav, mixAudioIntoMp4, renderAudioMix } from '@/utils/audioMix'
import { normalizeAudioSettings } from '@/utils/canvasAudio'

describe('混音 WAV 导出', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('写出立体声 PCM16 的正确文件头和截幅样本', async () => {
    const buffer = {
      numberOfChannels: 2,
      length: 3,
      sampleRate: 48000,
      getChannelData: (ch: number) => new Float32Array(ch === 0 ? [-2, 0, 2] : [0.5, -0.5, 0]),
    } as AudioBuffer
    const blob = audioBufferToWav(buffer)
    const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as ArrayBuffer)
      reader.onerror = () => reject(reader.error)
      reader.readAsArrayBuffer(blob)
    })
    const view = new DataView(bytes)
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('RIFF')
    expect(view.getUint16(22, true)).toBe(2)
    expect(view.getUint32(24, true)).toBe(48000)
    expect(view.getUint32(40, true)).toBe(12)
    expect(view.getInt16(44, true)).toBe(-32768)
    expect(view.getInt16(52, true)).toBe(32767)
  })
  it('不支持 AAC 时明确失败，不上传无声成片', async () => {
    vi.stubGlobal('AudioEncoder', undefined)
    await expect(mixAudioIntoMp4(new Blob(), [], 3, 21)).rejects.toThrow('不支持 AAC')
  })
  it('拒绝零时长和过长混音', async () => {
    await expect(renderAudioMix([], 0, 21)).rejects.toThrow('混音时长')
    await expect(renderAudioMix([], 301, 21)).rejects.toThrow('混音时长')
  })
  it('BGM 循环铺满、人声裁断、静音不下载，独立淡入淡出', async () => {
    const sources: any[] = []
    const gains: any[] = []
    const rendered = {} as AudioBuffer
    class OfflineContext {
      destination = {}
      decodeAudioData = vi.fn(async () => ({ duration: 8 }))
      createBufferSource() {
        const source = {
          start: vi.fn(),
          connect: vi.fn().mockImplementation((gain) => gain),
          loop: false,
          loopStart: 0,
          loopEnd: 0,
        }
        sources.push(source)
        return source
      }
      createGain() {
        const gain = { gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }, connect: vi.fn() }
        gains.push(gain)
        return gain
      }
      startRendering = vi.fn(async () => rendered)
    }
    vi.stubGlobal('OfflineAudioContext', OfflineContext)
    const request = vi.fn(async () => ({
      ok: true,
      headers: new Headers(),
      arrayBuffer: async () => new ArrayBuffer(8),
    }))
    vi.stubGlobal('fetch', request)
    const base = { assetId: 1, sourceNodeId: 'a', title: '配音' }
    const clips = [
      {
        ...base,
        ...normalizeAudioSettings({
          durationSec: 8,
          startSec: 2,
          inSec: 1,
          outSec: 6,
          volume: 0.8,
          fadeInSec: 1,
          fadeOutSec: 1,
        }),
      },
      {
        ...base,
        assetId: 2,
        sourceNodeId: 'b',
        ...normalizeAudioSettings({ durationSec: 8, lane: 'bgm', inSec: 2, outSec: 4 }),
      },
      { ...base, assetId: 3, sourceNodeId: 'c', ...normalizeAudioSettings({ durationSec: 8, muted: true }) },
    ]
    expect(await renderAudioMix(clips, 6, 21)).toBe(rendered)
    expect(request).toHaveBeenCalledTimes(2)
    expect(sources[0].start).toHaveBeenCalledWith(2, 1, 4)
    expect(sources[0].loop).toBe(false)
    expect(sources[1].start).toHaveBeenCalledWith(0, 2, 6)
    expect(sources[1]).toMatchObject({ loop: true, loopStart: 2, loopEnd: 4 })
    expect(gains[0].gain.linearRampToValueAtTime.mock.calls).toEqual([
      [0.8, 3],
      [0, 6],
    ])
  })
  it('音轨加载失败或裁剪为空时停止混音', async () => {
    vi.stubGlobal(
      'OfflineAudioContext',
      class {
        decodeAudioData = async () => ({ duration: 5 })
      },
    )
    const clip = {
      ...normalizeAudioSettings({ durationSec: 5, inSec: 5 }),
      assetId: 1,
      sourceNodeId: 'a',
      title: '声音',
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 403 })),
    )
    await expect(renderAudioMix([clip], 5, 21)).rejects.toThrow('HTTP 403')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(8) })),
    )
    await expect(renderAudioMix([clip], 5, 21)).rejects.toThrow('裁剪区间为空')
  })
})
