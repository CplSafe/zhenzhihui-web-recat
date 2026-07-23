import { describe, expect, it } from 'vitest'
import { getAuthNavigationUrl } from '@/api/auth'

describe('OAuth navigation URL validation', () => {
  const authStart = {
    authorize_url: 'https://auth.example.com/oauth2/authorize?client_id=web',
    return_to: 'https://auth.example.com/oauth2/callback',
  }

  it.each([
    '//evil.example/path',
    '///evil.example/path',
    '/%2f%2fevil.example/path',
    '/%252f%252fevil.example/path',
    '/\\evil.example/path',
    '/%5c%5cevil.example/path',
    '/safe\u0000/evil',
    '/safe%0d%0aLocation:%20https://evil.example',
    'https:\\evil.example\\oauth2\\authorize',
  ])('rejects protocol-relative or obfuscated navigation target: %s', (redirectTo) => {
    expect(getAuthNavigationUrl(authStart, { redirect_to: redirectTo })).toBe('/')
  })

  it('keeps legitimate same-origin relative navigation', () => {
    expect(getAuthNavigationUrl(authStart, { redirect_to: '/home?from=oauth' })).toBe('/home?from=oauth')
  })

  it('proxies legitimate OAuth paths and the trusted auth-start origin', () => {
    expect(getAuthNavigationUrl(authStart, { redirect_to: '/oauth2/callback?code=ok' })).toBe(
      '/deepauth/oauth2/callback?code=ok',
    )
    expect(
      getAuthNavigationUrl(authStart, {
        redirect_to: 'https://auth.example.com/oauth2/callback?code=ok',
      }),
    ).toBe('/deepauth/oauth2/callback?code=ok')
  })

  it('rejects credentials even when the parsed host matches the trusted OAuth origin', () => {
    expect(
      getAuthNavigationUrl(authStart, {
        redirect_to: 'https://attacker@auth.example.com/oauth2/callback',
      }),
    ).toBe('/')
  })
})
