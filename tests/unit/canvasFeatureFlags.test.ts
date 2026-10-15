import { describe, expect, it } from 'vitest'
import { CANVAS_AUDIO_NODES_ENABLED, isCanvasAudioEntryVisible, isCanvasAudioKind } from '@/utils/canvasFeatureFlags'

describe('canvasFeatureFlags', () => {
  it('识别音频节点和音频素材类型', () => {
    expect(isCanvasAudioKind('audio')).toBe(true)
    expect(isCanvasAudioKind('音频')).toBe(true)
    expect(isCanvasAudioKind('audio/mpeg')).toBe(true)
    expect(isCanvasAudioKind('video')).toBe(false)
  })

  it('开放后展示音频入口且不影响其他节点', () => {
    expect(CANVAS_AUDIO_NODES_ENABLED).toBe(true)
    expect(isCanvasAudioEntryVisible('audio')).toBe(true)
    expect(isCanvasAudioEntryVisible('audio/wav')).toBe(true)
    expect(isCanvasAudioEntryVisible('image')).toBe(true)
    expect(isCanvasAudioEntryVisible('video')).toBe(true)
    expect(isCanvasAudioEntryVisible('text')).toBe(true)
    expect(isCanvasAudioEntryVisible('timeline')).toBe(true)
  })
})
