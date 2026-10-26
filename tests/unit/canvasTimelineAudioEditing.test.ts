import { describe, expect, it } from 'vitest'
import { resolveAudioTrackStart } from '@/utils/canvasTimelineAudioEditing'

describe('同步音轨位置', () => {
  it('吸附播放头或片段边界，阈值外保持原位置', () => {
    expect(resolveAudioTrackStart(4.94, 10, [0, 5], 0.1)).toBe(5)
    expect(resolveAudioTrackStart(4.7, 10, [0, 5], 0.1)).toBe(4.7)
    expect(resolveAudioTrackStart(4.94, 10)).toBe(4.94)
  })
  it('约束成片范围并稳定精度', () => {
    expect(resolveAudioTrackStart(-1, 10)).toBe(0)
    expect(resolveAudioTrackStart(15, 10, [10], 0.2)).toBe(9.9)
    expect(resolveAudioTrackStart(1, 0)).toBe(0)
    expect(resolveAudioTrackStart(NaN, 10)).toBe(0)
    expect(resolveAudioTrackStart(0.1 + 0.2, 10)).toBe(0.3)
  })
})
