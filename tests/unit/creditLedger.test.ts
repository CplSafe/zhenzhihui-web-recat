import { describe, expect, it } from 'vitest'
import {
  creditLedgerDirection,
  creditLedgerKindLabel,
  extractCreditLedgerPage,
  formatCreditDelta,
  normalizeCreditLedgerRecord,
} from '@/utils/creditLedger'

describe('creditLedger 归一化', () => {
  it('按 kind 判定方向，未知 kind 按金额符号兜底', () => {
    expect(creditLedgerDirection('settle', -800)).toBe('out')
    expect(creditLedgerDirection('freeze', 800)).toBe('out') // 冻结即使金额为正也算占用
    expect(creditLedgerDirection('release', -900)).toBe('in') // 退回即使金额为负也算入账
    expect(creditLedgerDirection('recharge', 10000)).toBe('in')
    expect(creditLedgerDirection('mystery', -5)).toBe('out') // 未知 kind 看符号
    expect(creditLedgerDirection('mystery', 5)).toBe('in')
  })

  it('kind 标签已知直译，未知按方向兜底', () => {
    expect(creditLedgerKindLabel('settle', 'out')).toBe('消费')
    expect(creditLedgerKindLabel('release', 'in')).toBe('退回')
    expect(creditLedgerKindLabel('unknown', 'in')).toBe('入账')
    expect(creditLedgerKindLabel('unknown', 'out')).toBe('支出')
  })

  it('金额恒取绝对值，展示按方向加正负号', () => {
    const settle = normalizeCreditLedgerRecord({ id: 1, kind: 'settle', amount: -800, balance_after: 8640 })
    expect(settle.amount).toBe(800)
    expect(settle.direction).toBe('out')
    expect(formatCreditDelta(settle)).toBe('-800')

    const recharge = normalizeCreditLedgerRecord({ id: 2, kind: 'recharge', amount: 10000, balance_after: 9700 })
    expect(formatCreditDelta(recharge)).toBe('+10,000')
  })

  it('兼容 snake_case / camelCase 字段名与缺失余额', () => {
    const rec = normalizeCreditLedgerRecord({
      ledger_id: 'L9',
      type: 'settle',
      delta: 540,
      description: '爆款成片 · 确认修改',
      createdAt: '2026-09-10T11:07:00Z',
      user_id: 4,
    })
    expect(rec.id).toBe('L9')
    expect(rec.kind).toBe('settle')
    expect(rec.reason).toBe('爆款成片 · 确认修改')
    expect(rec.createdAt).toBe('2026-09-10T11:07:00Z')
    expect(rec.userId).toBe(4)
    expect(rec.balanceAfter).toBeNull() // 未给 balance_after → null
  })

  it('分页信封兼容 items/total，缺 id 用下标兜底', () => {
    const page = extractCreditLedgerPage(
      {
        items: [
          { kind: 'settle', amount: -100 },
          { id: 7, kind: 'release', amount: 100 },
        ],
        total: 42,
      },
      20,
    )
    expect(page.total).toBe(42)
    expect(page.records).toHaveLength(2)
    expect(page.records[0].id).toBe('offset-20') // 缺 id → 下标兜底
    expect(page.records[1].id).toBe('7')
  })

  it('无 total 字段时返回 null（交由调用方按满页推断）', () => {
    const page = extractCreditLedgerPage({ list: [{ id: 1, kind: 'settle', amount: -1 }] })
    expect(page.total).toBeNull()
    expect(page.records).toHaveLength(1)
  })
})
