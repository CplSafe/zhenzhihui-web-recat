import { afterEach, describe, expect, it, vi } from 'vitest'
import { getSession, registerAccount, sendAuthSms, startOAuth } from '@/api/auth'
import { getReferralInviteCodes, getReferralMyCode, listWorkspaces } from '@/api/business'

function success(data: unknown = { ok: true }): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('same-origin client API routing', () => {
  it('keeps business and OAuth requests on relative proxy paths', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => success())
    vi.stubGlobal('fetch', fetchMock)

    await getSession()
    await startOAuth({ redirectTo: 'https://app.example/home' })
    await listWorkspaces()

    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      '/api/v1/auth/session',
      '/api/v1/auth/oauth-start?redirect_to=https%3A%2F%2Fapp.example%2Fhome',
      '/api/v1/workspaces',
    ])
  })

  it('routes public authentication calls through the same-origin DeepAuth proxy', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => success())
    vi.stubGlobal('fetch', fetchMock)

    await sendAuthSms({
      authStart: null,
      mobile: '17633125265',
      purpose: 'login',
      captchaId: '',
      captchaAnswer: '',
    })

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/deepauth/api/v1/public/auth/sms/send')
  })

  it('keeps invitation attribution on the OAuth start context', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => success())
    vi.stubGlobal('fetch', fetchMock)

    await startOAuth({ redirectTo: '/home', inviteCode: 'DIST-001' })

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      '/api/v1/auth/oauth-start?redirect_to=%2Fhome&invite_code=DIST-001',
    )
  })

  it('passes the channel invitation type through OAuth and registration', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => success())
    vi.stubGlobal('fetch', fetchMock)

    await startOAuth({ redirectTo: '/home', inviteCode: 'DIST-CHANNEL-001', inviteType: 'channel' })
    await registerAccount({
      authStart: { return_to: '/home' },
      mobile: '17633125265',
      password: 'Safe-Password-1!',
      smsCode: '592442',
      termsAccepted: true,
      inviteCode: 'DIST-CHANNEL-001',
      inviteType: 'channel',
    })

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      '/api/v1/auth/oauth-start?redirect_to=%2Fhome&invite_code=DIST-CHANNEL-001&invite_type=channel',
    )
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({
      invite_code: 'DIST-CHANNEL-001',
      invite_type: 'channel',
    })
  })

  it('reads customer and channel invitation codes from the dedicated referral endpoint', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      success({
        code: 'ZZH-CUSTOMER-001',
        distributor_code: 'ZZH-D-CHANNEL-001',
        distributor_status: 'active',
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(getReferralInviteCodes()).resolves.toEqual({
      customerCode: 'ZZH-CUSTOMER-001',
      channelCode: 'ZZH-D-CHANNEL-001',
      distributorStatus: 'active',
    })
    await expect(getReferralMyCode()).resolves.toBe('ZZH-CUSTOMER-001')

    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      '/api/v1/referral/my-code',
      '/api/v1/referral/my-code',
    ])
  })
})
