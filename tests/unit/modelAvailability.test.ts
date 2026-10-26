import { describe, expect, it } from 'vitest'
import { emptyModelMessage, membershipAction, teamModelMessage } from '@/utils/modelAvailability'

describe('model availability guidance', () => {
  const now = Date.parse('2026-10-23T00:00:00Z')
  it.each(['current_period_end', 'currentPeriodEnd', 'expire_at', 'expires_at', 'expired_at', 'end_at', 'end_time'])(
    'recognizes expiry via %s without requiring active=true',
    (field) => {
      const message = emptyModelMessage(
        '图生图模型',
        { plan_id: 1, active: false, [field]: '2026-10-22T00:00:00Z' },
        now,
      )
      expect(membershipAction(message)).toBe('renew')
      expect(teamModelMessage(message, false)).toContain('请联系团队所有者')
      expect(teamModelMessage(message, true)).toBe(message)
    },
  )
  it.each([now / 1000, now])('accepts numeric expiry %s at the boundary', (expiry) => {
    expect(membershipAction(emptyModelMessage('模型', { plan_name: '会员', expires_at: expiry }, now))).toBe('renew')
  })
  it('distinguishes no membership, lookup failure, cancellation and an active subscription', () => {
    const notPurchased = emptyModelMessage('模型', null, now)
    expect(membershipAction(notPurchased)).toBe('purchase')
    expect(teamModelMessage(notPurchased, false)).toContain('联系团队所有者购买')
    for (const subscription of [
      undefined,
      { plan_id: 1, active: false },
      { plan_id: 1, expires_at: 'invalid' },
      { plan_id: 1, expires_at: now + 1000 },
      { active: true },
    ]) {
      const message = emptyModelMessage('图生图模型', subscription, now)
      expect(message).toContain('平台管理员')
      expect(membershipAction(message)).toBeNull()
    }
    expect(teamModelMessage('模型加载失败，请重新加载', false)).toBe('模型加载失败，请重新加载')
    expect(membershipAction('暂无可用模型，请联系平台管理员')).toBeNull()
    expect(membershipAction('模型参数配置错误，请联系管理员')).toBeNull()
  })
})
