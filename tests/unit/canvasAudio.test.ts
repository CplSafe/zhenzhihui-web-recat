import { describe, expect, it, vi } from 'vitest'
import {
  audioGainAt,
  isAudioFile,
  normalizeAudioSettings,
  parseTimelineAudio,
  readAudioDuration,
  syncTimelineAudio,
} from '@/utils/canvasAudio'
import { parseTimelineState } from '@/utils/timelineClips'
import { pickPersistedNodeData, collectCanvasElementAssetIds } from '@/utils/canvasElements'

const clip = {
  ...normalizeAudioSettings({ durationSec: 10, lane: 'voice' }),
  assetId: 71,
  sourceNodeId: 'audio-1',
  title: '旁白',
}
describe('音频编辑与画布持久化', () => {
  it('清理非法数值，裁剪不越界，人声不循环', () => {
    expect(
      normalizeAudioSettings({ durationSec: 10, inSec: -2, outSec: 99, volume: 4, loop: true, startSec: NaN }),
    ).toMatchObject({ inSec: 0, outSec: 10, volume: 1, startSec: 0, loop: false })
    expect(normalizeAudioSettings({ durationSec: 10, lane: 'bgm' })).toMatchObject({ loop: true, volume: 0.3 })
  })
  it('淡入淡出按画面末尾计算，静音和人声结束后无声音', () => {
    const s = normalizeAudioSettings({ durationSec: 10, fadeInSec: 2, fadeOutSec: 2 })
    expect(audioGainAt(s, 1, 6)).toBe(0.5)
    expect(audioGainAt(s, 5, 6)).toBe(0.5)
    expect(audioGainAt(s, 6, 6)).toBe(0)
    expect(audioGainAt({ ...s, muted: true }, 3, 6)).toBe(0)
    expect(audioGainAt(s, 11, 20)).toBe(0)
  })
  it('连线增删不覆盖编辑过的音量或裁剪，保留同轨多条来源', () => {
    const edited = { ...clip, volume: 0.6, inSec: 2 }
    const other = { ...clip, assetId: 72, sourceNodeId: 'audio-2' }
    expect(syncTimelineAudio([edited], [clip, other])).toEqual([edited, other])
    expect(syncTimelineAudio([edited, other], [other])).toEqual([other])
    expect(clip.inSec).toBe(0)
  })
  it('素材元数据稍后就绪时补齐时长，换素材重新初始化', () => {
    expect(syncTimelineAudio([{ ...clip, durationSec: 0, outSec: 0 }], [clip])[0].outSec).toBe(10)
    expect(syncTimelineAudio([{ ...clip, inSec: 2 }], [{ ...clip, assetId: 99 }])[0].inSec).toBe(0)
  })
  it('音轨和来源随草稿保存，素材收集包含全部音频 ID', () => {
    const state = parseTimelineState({ clips: [], audioClips: [clip] })
    expect(state.audioClips).toEqual([clip])
    expect(pickPersistedNodeData({ audio: clip, timeline: state, previewUrl: 'blob:local' })).toEqual({
      audio: clip,
      timeline: state,
    })
    const ids = collectCanvasElementAssetIds([
      {
        element_id: 'timeline-1',
        kind: 'node',
        op: 'upsert',
        payload: { type: 'timeline', data: { kind: 'timeline', timeline: state } },
      },
    ])
    expect(ids.has(71)).toBe(true)
  })
  it('拒绝无效素材引用，支持扩展名识别音频', () => {
    expect(parseTimelineAudio([{ ...clip, assetId: 0 }])).toEqual([])
    expect(isAudioFile({ name: '声音.M4A', type: '' })).toBe(true)
    expect(isAudioFile({ name: '声音.mp4', type: 'video/mp4' })).toBe(false)
  })
  it('读取真实媒体元数据并清理临时播放器', async () => {
    const audio = document.createElement('audio')
    Object.defineProperty(audio, 'duration', { value: 6.5 })
    const create = vi.spyOn(document, 'createElement').mockReturnValueOnce(audio)
    const result = readAudioDuration('blob:sample')
    audio.dispatchEvent(new Event('loadedmetadata'))
    await expect(result).resolves.toBe(6.5)
    expect(audio.hasAttribute('src')).toBe(false)
    create.mockRestore()
  })
  it('无法解码时显示错误并释放资源', async () => {
    const audio = document.createElement('audio')
    const create = vi.spyOn(document, 'createElement').mockReturnValueOnce(audio)
    const result = readAudioDuration('blob:bad')
    audio.dispatchEvent(new Event('error'))
    await expect(result).rejects.toThrow('无法解码')
    create.mockRestore()
  })
})
