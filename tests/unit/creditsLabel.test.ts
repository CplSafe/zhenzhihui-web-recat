import { describe, expect, it } from 'vitest'
import { creditsLabel, INSUFFICIENT_CREDITS_TEXT } from '@/utils/creditsFormat'

describe('creditsLabel', () => {
  it('直接展示后端积分，不换算成人民币', () => {
    expect(creditsLabel(100)).toBe('100 积分')
    expect(creditsLabel('1500')).toBe('1,500 积分')
    expect(creditsLabel(13.25)).toBe('13.25 积分')
    expect(creditsLabel(0.001)).toBe('<0.01 积分')
  })
  it('零、无效输入和负数安全兜底，保留积分不足提示', () => {
    for (const value of [0, undefined, null, 'abc', Infinity, -1]) {
      expect(creditsLabel(value)).toBe('0 积分')
    }
    expect(INSUFFICIENT_CREDITS_TEXT).toBe('积分不足，请充值积分')
  })
})
