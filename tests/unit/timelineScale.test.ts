import { describe, expect, it } from 'vitest'
import { getTimelinePixelsPerSecond, TIMELINE_AUTO_FIT_MAX_SEC } from '@/utils/timelineScale'

describe('getTimelinePixelsPerSecond', () => {
  it('fits timelines up to 30 seconds regardless of the previously selected zoom', () => {
    expect(getTimelinePixelsPerSecond(5, 900, 278)).toBe(180)
    expect(getTimelinePixelsPerSecond(TIMELINE_AUTO_FIT_MAX_SEC, 900, 480)).toBe(30)
  })

  it('shows 30 seconds by default for longer timelines and allows manual zoom', () => {
    expect(getTimelinePixelsPerSecond(31, 900)).toBe(30)
    expect(getTimelinePixelsPerSecond(60, 900)).toBe(30)
    expect(getTimelinePixelsPerSecond(60, 900, 45)).toBe(45)
  })

  it('clamps manual zoom for long timelines and handles empty measurements', () => {
    expect(getTimelinePixelsPerSecond(60, 900, 1)).toBe(6)
    expect(getTimelinePixelsPerSecond(60, 900, 900)).toBe(480)
    expect(getTimelinePixelsPerSecond(0, 0)).toBe(60)
    expect(getTimelinePixelsPerSecond(5, 0)).toBe(60)
  })
})
