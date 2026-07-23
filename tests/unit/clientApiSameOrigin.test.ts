import { afterEach, describe, expect, it, vi } from 'vitest'
import { getSession, sendAuthSms, startOAuth } from '@/api/auth'
import { listWorkspaces } from '@/api/business'

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
})
