import { describe, expect, it } from 'vitest'
import { isDistributionAccessDisabled, isDistributionAccessGranted } from '@/composables/useDistributionAccess'

describe('isDistributionAccessGranted', () => {
  it('denies an HTTP 200 payload that explicitly says the user is not a distributor', () => {
    expect(isDistributionAccessGranted({ is_distributor: false, message: '您不是分销人员' })).toBe(false)
    expect(isDistributionAccessGranted({ data: { distributor_status: 'not_distributor' } })).toBe(false)
  })

  it('allows only explicit sales and distributor identities', () => {
    expect(isDistributionAccessGranted({ is_distributor: true })).toBe(true)
    expect(isDistributionAccessGranted({ data: { role: 'sales' } })).toBe(true)
    expect(isDistributionAccessGranted({ code: 'ZZH-CUSTOMER-001', distributor_code: 'ZZH-D-CHANNEL-001' })).toBe(true)
    expect(isDistributionAccessGranted({ code: 'ZZH-CUSTOMER-001' })).toBe(false)
    expect(isDistributionAccessGranted({ distributor_status: 'active' })).toBe(false)
  })

  it('does not infer access from distribution metrics', () => {
    expect(isDistributionAccessGranted({ total_commission: 0, pending_amount: 0 })).toBe(false)
    expect(isDistributionAccessGranted({ message: 'ok' })).toBe(false)
  })

  it('recognizes a disabled distributor identity', () => {
    expect(isDistributionAccessDisabled({ is_distributor: true, distributor_status: 'disabled' })).toBe(true)
    expect(isDistributionAccessDisabled({ data: { sales_status: 'suspended' } })).toBe(true)
    expect(isDistributionAccessDisabled({ distributor_status: 'active' })).toBe(false)
  })
})
