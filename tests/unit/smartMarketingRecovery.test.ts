import { describe, expect, it } from 'vitest'
import { getSmartMarketingRecoveryKey, type SmartMarketingRecoveryState } from '@/utils/smartMarketingRecovery'

const recoverableState: SmartMarketingRecoveryState = {
  applied: true,
  started: true,
  marketingOpen: true,
  marketingLoading: false,
  hasMarketingData: false,
  hasMarketingError: false,
  workspaceId: 21,
  projectId: 916,
  routeSessionToken: 'session-1',
  skill: '电商广告',
  requirement: '推广新品',
  imageCount: 0,
}

describe('smart marketing recovery', () => {
  it('recovers a blank SKILL step after the new project route is bound', () => {
    expect(getSmartMarketingRecoveryKey(recoverableState)).toContain('21:916:session-1:电商广告:推广新品')
  })

  it('also recovers image-only SKILL input', () => {
    expect(getSmartMarketingRecoveryKey({ ...recoverableState, requirement: '', imageCount: 2 })).not.toBe('')
  })

  it.each([
    { marketingOpen: false },
    { marketingLoading: true },
    { hasMarketingData: true },
    { hasMarketingError: true },
    { projectId: 0 },
    { skill: '' },
    { requirement: '', imageCount: 0 },
  ])('does not duplicate a non-recoverable request: %o', (patch) => {
    expect(getSmartMarketingRecoveryKey({ ...recoverableState, ...patch })).toBe('')
  })
})
