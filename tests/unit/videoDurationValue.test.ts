import { describe, expect, it } from 'vitest'
import { totalDurationSec } from '@/api/smartVideo'
import {
  SUPPORTED_VIDEO_DURATIONS,
  parseDurationSeconds,
  resolveVideoDuration,
  validateVideoDuration,
} from '@/utils/videoDurationValue'

describe('video duration values', () => {
  it.each([
    [5, 5],
    ['10', 10],
    ['15s', 15],
    ['3.5s', 3.5],
    [' 3.5 秒 ', 3.5],
  ])('parses %p as %p seconds', (value, expected) => {
    expect(parseDurationSeconds(value)).toBe(expected)
  })

  it.each([undefined, null, '', '3.5 seconds', '3-5s', 0, -5, Number.POSITIVE_INFINITY])(
    'rejects invalid or ambiguous input %p',
    (value) => {
      expect(parseDurationSeconds(value)).toBeNull()
    },
  )

  it('exposes and validates the exact supported durations', () => {
    expect(SUPPORTED_VIDEO_DURATIONS).toEqual([5, 10, 15])
    for (const duration of SUPPORTED_VIDEO_DURATIONS) {
      expect(validateVideoDuration(`${duration}s`)).toEqual({ valid: true, seconds: duration, reason: null })
    }
    expect(validateVideoDuration(11)).toEqual({ valid: false, seconds: 11, reason: 'unsupported' })
  })

  it('keeps compatibility snapping while offering strict resolution', () => {
    expect(resolveVideoDuration(3.5)).toBe(5)
    expect(resolveVideoDuration(7.5)).toBe(5)
    expect(resolveVideoDuration(11)).toBe(10)
    expect(resolveVideoDuration(13)).toBe(15)
    expect(resolveVideoDuration(11, { strict: true })).toBeNull()
    expect(resolveVideoDuration('invalid', { fallback: 15 })).toBe(15)
  })

  it('sums decimal shot durations and ignores shots excluded from video', () => {
    expect(
      totalDurationSec([{ duration: '3.5s' }, { duration: '1.25秒' }, { duration: '15s', includeInVideo: false }]),
    ).toBe(4.75)
  })
})
