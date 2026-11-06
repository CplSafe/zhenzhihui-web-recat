import { describe, expect, it } from 'vitest'
import { estimateRefineCredits, formatRefineDuration, getDemoDueAt, REFINE_DURATIONS } from '@/utils/refineDelivery'

describe('精制演示时长与交付时间', () => {
  it('为七档时长计算积分并按秒或分钟显示', () => {
    expect(REFINE_DURATIONS.map(estimateRefineCredits)).toEqual([563, 1125, 1688, 2250, 4500, 6750, 11250])
    expect(formatRefineDuration(45)).toBe('45 秒')
    expect(formatRefineDuration(300)).toBe('5 分钟')
  })
  it('按北京时间次日 18:00 交付，跨月仍正确', () => {
    const submitted = Date.parse('2026-01-31T23:50:00+08:00')
    const due = new Date(getDemoDueAt(submitted))
    expect(due.toISOString()).toBe('2026-02-01T10:00:00.000Z')
  })
})
