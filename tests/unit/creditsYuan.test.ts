import { describe, expect, it } from 'vitest'

import {
  INSUFFICIENT_CREDITS_TEXT,
  YUAN_PER_CREDIT,
  creditsToYuanAmount,
  creditsYuanHint,
  creditsYuanLabel,
  creditsYuanSuffix,
} from '@/utils/creditsYuan'

describe('creditsYuan', () => {
  it('按 1 积分 = 0.02 元换算', () => {
    expect(YUAN_PER_CREDIT).toBe(0.02)
    expect(creditsToYuanAmount(12)).toBe('0.24')
    expect(creditsToYuanAmount(1500)).toBe('30')
  })

  it('去掉多余尾零，避免出现 2.00 / 0.50 这类展示', () => {
    expect(creditsToYuanAmount(100)).toBe('2')
    expect(creditsToYuanAmount(25)).toBe('0.5')
    // 浮点误差场景：3 * 0.02 = 0.060000000000000005
    expect(creditsToYuanAmount(3)).toBe('0.06')
  })

  it('非正数或非法输入不产生金额提示', () => {
    expect(creditsToYuanAmount(0)).toBe('')
    expect(creditsToYuanAmount(-5)).toBe('')
    expect(creditsToYuanAmount('abc')).toBe('')
    expect(creditsToYuanAmount(undefined)).toBe('')
    expect(creditsYuanHint(0)).toBe('')
    expect(creditsYuanSuffix(null)).toBe('')
  })

  it('提示与后缀文案可直接拼接在「X 积分」后', () => {
    expect(creditsYuanHint(12)).toBe('约0.24元')
    expect(creditsYuanSuffix(12)).toBe('（约0.24元）')
    // 字符串数字同样可用（后端字段偶尔以字符串返回）
    expect(creditsYuanSuffix('50')).toBe('（约1元）')
  })

  it('label 永远有内容可展示，额度不足文案统一', () => {
    expect(creditsYuanLabel(1500)).toBe('约30元')
    expect(creditsYuanLabel(0)).toBe('约0元')
    expect(creditsYuanLabel(undefined)).toBe('约0元')
    expect(INSUFFICIENT_CREDITS_TEXT).toBe('积分不足，请充值积分')
  })
})
