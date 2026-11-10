import { describe, expect, it } from 'vitest'
import { deliveryDeadline, deliveryTimeParts, formatDeliveryTime } from '@/utils/deliveryCountdown'

describe('交付倒计时', () => {
  const created = '2026-11-10T15:30:00+08:00'
  const t1 = Date.parse('2026-11-11T15:30:00+08:00')
  const t5 = Date.parse('2026-11-15T15:30:00+08:00')

  it('按服务端创建时间计算 T+1 和北京时间五个自然日', () => {
    expect(deliveryDeadline('t1', created)).toBe(t1)
    expect(deliveryDeadline('t5', created, null, '2026-11-15')).toBe(t5)
    expect(deliveryDeadline('t5', created, '2026-11-15T07:30:00Z', '2026-11-15')).toBe(t5)
  })

  it('对缺失、无时区或存在冲突的时间不猜测截止时间', () => {
    expect(deliveryDeadline('t5')).toBeNull()
    expect(deliveryDeadline('t1', '2026-11-10T15:30:00')).toBeNull()
    expect(deliveryDeadline('t1', created, 'invalid')).toBeNull()
    expect(deliveryDeadline('t1', created, '2026-11-12T07:30:00Z')).toBeNull()
    expect(deliveryDeadline('t5', created, null, '2026-11-16')).toBeNull()
  })

  it('按一小时、一日边界切换格式，逾期继续计时', () => {
    const display = (kind: 't1' | 't5', seconds: number) =>
      formatDeliveryTime(kind, deliveryTimeParts(t5, t5 - seconds * 1000)).join('')
    expect(display('t1', 86400)).toBe('24:00')
    expect(display('t1', 3600)).toBe('01:00')
    expect(display('t1', 3599)).toBe('00:59:59')
    expect(display('t5', 86400)).toBe('01天00')
    expect(display('t5', 86399)).toBe('23:59')
    expect(display('t5', 3600)).toBe('01:00')
    expect(display('t5', 3599)).toBe('00:59:59')
    const overdue = deliveryTimeParts(t5, t5 + 61000)
    expect(overdue.overdue).toBe(true)
    expect(formatDeliveryTime('t5', overdue).join('')).toBe('00:01:01')
    expect(deliveryTimeParts(t5, t5).overdue).toBe(true)
  })
})
