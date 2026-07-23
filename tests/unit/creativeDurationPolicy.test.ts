import { describe, expect, it } from 'vitest'
import { extractExplicitTotalDurationSeconds, validateCreativeDurationSelection } from '@/utils/creativeDurationPolicy'
import { SMART_VIDEO_DURATIONS } from '@/utils/videoDurationValue'

describe('creative duration policy', () => {
  it.each([
    ['生成一条11秒的视频广告', 11],
    ['视频时长为 10s，展示产品卖点', 10],
    ['总时长十五秒', 15],
    ['做一个五秒短片', 5],
    ['10秒爆款短视频', 10],
  ])('extracts an explicit total duration from %s', (requirement, expected) => {
    expect(extractExplicitTotalDurationSeconds(requirement)).toBe(expected)
  })

  it.each(['镜头1持续3秒，然后切换场景', '第3秒出现产品', '台词控制在5秒内'])(
    'does not treat a per-shot phrase as total duration: %s',
    (requirement) => {
      expect(extractExplicitTotalDurationSeconds(requirement)).toBeNull()
    },
  )

  it('accepts matching supported durations', () => {
    expect(validateCreativeDurationSelection('制作一条十秒视频', '10s')).toMatchObject({
      valid: true,
      selectedSeconds: 10,
      requestedSeconds: 10,
    })
  })

  it('rejects an unsupported duration before generation', () => {
    expect(validateCreativeDurationSelection('制作一条11秒视频', '10s')).toMatchObject({
      valid: false,
      issue: 'unsupported-requirement',
      requestedSeconds: 11,
    })
  })

  it('rejects a mismatch between the requirement and the structured selector', () => {
    expect(validateCreativeDurationSelection('视频时长15秒', '10s')).toMatchObject({
      valid: false,
      issue: 'requirement-mismatch',
      selectedSeconds: 10,
      requestedSeconds: 15,
    })
  })

  it('rejects an unsupported structured duration instead of snapping it', () => {
    expect(validateCreativeDurationSelection('展示新品', '11s')).toMatchObject({
      valid: false,
      issue: 'unsupported-selection',
      selectedSeconds: 11,
    })
  })

  it('uses the smart-video 1–15 second range when that flow supplies its policy', () => {
    const options = {
      supportedDurations: SMART_VIDEO_DURATIONS,
      supportedDurationLabel: '1至15秒内的整数',
    }

    expect(validateCreativeDurationSelection('制作一条11秒视频', '11s', options)).toMatchObject({
      valid: true,
      selectedSeconds: 11,
      requestedSeconds: 11,
    })
    expect(validateCreativeDurationSelection('制作一条16秒视频', '15s', options)).toMatchObject({
      valid: false,
      issue: 'unsupported-requirement',
      requestedSeconds: 16,
    })
  })
})
