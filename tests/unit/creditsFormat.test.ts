import { describe, expect, it } from 'vitest'
import { formatCredits, fromMilli, multiplyCredits, subtractCredits, sumCredits, toMilli } from '@/utils/creditsFormat'

describe('formatCredits', () => {
  it('最多 2 位小数并去尾零', () => {
    expect(formatCredits(0)).toBe('0')
    expect(formatCredits(100)).toBe('100')
    expect(formatCredits(12.5)).toBe('12.5')
    expect(formatCredits(854.123)).toBe('854.12')
    expect(formatCredits(0.044)).toBe('0.04')
  })

  it('非零但不足 0.005 显示 <0.01', () => {
    expect(formatCredits(0.004)).toBe('<0.01')
  })

  it('带千分位', () => {
    expect(formatCredits(1234567.891)).toBe('1,234,567.89')
  })

  it('非法值显示 0', () => {
    expect(formatCredits(undefined)).toBe('0')
    expect(formatCredits('abc')).toBe('0')
  })
})

describe('毫积分运算', () => {
  it('toMilli 消除浮点误差', () => {
    expect(toMilli(0.1 + 0.2)).toBe(300)
    expect(fromMilli(1234)).toBe(1.234)
  })

  it('单价 × 数量精确到 0.001', () => {
    expect(fromMilli(toMilli(0.011) * 3)).toBe(0.033)
    expect(multiplyCredits(0.011, 3)).toBe(0.033)
  })

  it('求和与相减', () => {
    expect(sumCredits([0.1, 0.2])).toBe(0.3)
    expect(subtractCredits(12.34, 0.01)).toBe(12.33)
  })
})
