import { describe, expect, it } from 'vitest'
import { createLoginBridgeDiagnostic } from '@/utils/loginObservability'

describe('loginObservability', () => {
  it('keeps authentication payloads and the SSO URL out of remote log context', () => {
    const oauthStart = {
      authorize_url: 'https://sso.example.com/authorize?state=oauth-state-secret',
      state: 'oauth-state-secret',
    }
    const authResult = {
      access_token: 'access-token-secret',
      refresh_token: 'refresh-token-secret',
      redirect_to: 'https://app.example.com/callback?code=authorization-code-secret',
    }

    const diagnostic = createLoginBridgeDiagnostic({
      reason: 'silent_bridge_unavailable',
      oauthStart,
      authResult,
      navigationUrl: authResult.redirect_to,
    })

    expect(diagnostic).toEqual({
      reason: 'silent_bridge_unavailable',
      hasOauthStart: true,
      hasAuthResult: true,
      navigationTarget: 'available',
    })

    const serialized = JSON.stringify(diagnostic)
    expect(serialized).not.toContain('access-token-secret')
    expect(serialized).not.toContain('refresh-token-secret')
    expect(serialized).not.toContain('authorization-code-secret')
    expect(serialized).not.toContain('oauth-state-secret')
    expect(serialized).not.toContain('https://')
  })

  it.each([
    [undefined, 'missing'],
    ['', 'missing'],
    ['/', 'root'],
    ['https://sso.example.com/authorize?code=secret', 'available'],
  ] as const)('reports only a fixed navigation state for %s', (navigationUrl, navigationTarget) => {
    expect(
      createLoginBridgeDiagnostic({
        reason: 'navigation_url_missing',
        navigationUrl,
      }),
    ).toEqual({
      reason: 'navigation_url_missing',
      hasOauthStart: false,
      hasAuthResult: false,
      navigationTarget,
    })
  })
})
