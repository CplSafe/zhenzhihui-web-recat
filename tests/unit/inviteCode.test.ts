import { beforeEach, describe, expect, it } from 'vitest'
import { captureInviteCode, clearInviteCode, getInviteCode, getInviteType } from '@/utils/inviteCode'

describe('invite code context', () => {
  beforeEach(() => {
    sessionStorage.clear()
    window.history.replaceState({}, '', '/login')
  })

  it('keeps old invite links compatible as customer invitations', () => {
    window.history.replaceState({}, '', '/login?invite_code=ZZH-OLD-001')
    captureInviteCode()

    expect(getInviteCode()).toBe('ZZH-OLD-001')
    expect(getInviteType()).toBe('customer')
  })

  it('captures a channel invitation using the same referral code', () => {
    window.history.replaceState({}, '', '/login?invite_code=ZZH-CHANNEL-001&invite_type=channel')
    captureInviteCode()
    window.history.replaceState({}, '', '/login')

    expect(getInviteCode()).toBe('ZZH-CHANNEL-001')
    expect(getInviteType()).toBe('channel')
  })

  it('does not accept arbitrary roles from a shared link', () => {
    window.history.replaceState({}, '', '/login?invite_code=ZZH-001&invite_type=admin')
    captureInviteCode()

    expect(getInviteType()).toBe('customer')
  })

  it('clears both the code and invitation type after registration', () => {
    window.history.replaceState({}, '', '/login?invite_code=ZZH-CHANNEL-001&invite_type=channel')
    captureInviteCode()
    window.history.replaceState({}, '', '/login')
    clearInviteCode()

    expect(getInviteCode()).toBe('')
    expect(getInviteType()).toBe('customer')
  })
})
