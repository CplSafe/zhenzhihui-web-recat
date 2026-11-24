import { describe, expect, it } from 'vitest'
import { redirectFailedAuthCallback, rewriteBusinessAuthCallback } from '@/build/authCallbackProxy'

const origins = new Set(['http://backend.test:9000', 'https://business.test'])
describe('OAuth dev callback proxy', () => {
  it.each(['http://backend.test:9000', 'https://business.test'])(
    'keeps the callback from %s on the local cookie origin',
    (origin) => {
      expect(
        rewriteBusinessAuthCallback(`${origin}/auth/callback?code=opaque%2Bcode&state=state-1#done`, origins),
      ).toBe('/auth/callback?code=opaque%2Bcode&state=state-1#done')
    },
  )
  it.each([
    undefined,
    '',
    '/auth/callback?code=1',
    'https://untrusted.test/auth/callback?code=1',
    'https://business.test.evil.test/auth/callback',
    'https://business.test/auth/callback-evil',
    'https://user:password@business.test/auth/callback',
    'https://business.test/home',
    'javascript:alert(1)',
    'not a url',
  ])('does not rewrite untrusted or unrelated destinations: %s', (location) => {
    expect(rewriteBusinessAuthCallback(location, origins)).toBeUndefined()
  })
  it('does not rewrite the registered redirect_uri inside the authorization request', () => {
    expect(
      rewriteBusinessAuthCallback(
        'https://auth.test/oauth2/authorize?redirect_uri=https%3A%2F%2Fbusiness.test%2Fauth%2Fcallback',
        origins,
      ),
    ).toBeUndefined()
  })

  describe('failed OAuth callback documents', () => {
    const documentRequest = {
      method: 'GET',
      url: '/auth/callback?code=opaque-code&state=opaque-state',
      headers: { 'sec-fetch-dest': 'document' },
    }

    it.each([400, 500])('redirects an upstream %s response to login and preserves cookie headers', (status) => {
      const cookies = ['oauth_state=; Max-Age=0; Path=/']
      const response = {
        statusCode: status,
        statusMessage: 'Upstream error',
        headers: { 'set-cookie': cookies, 'cache-control': 'max-age=100', location: 'https://business.test/error' },
      }

      expect(redirectFailedAuthCallback(documentRequest, response)).toBe(true)
      expect(response).toEqual({
        statusCode: 303,
        statusMessage: 'See Other',
        headers: { 'set-cookie': cookies, 'cache-control': 'no-store', location: '/login?oauth_callback=failed' },
      })
    })

    it.each([
      { headers: { 'sec-fetch-dest': 'iframe' } },
      { headers: { 'sec-fetch-dest': 'empty' } },
      { headers: {} },
      { method: 'POST' },
      { url: '/auth/callback-other?code=opaque-code' },
      { url: '/auth/session' },
    ])('lets other requests receive the original callback response: %j', (request) => {
      const response = { statusCode: 400, headers: { 'content-type': 'application/json' } }

      expect(redirectFailedAuthCallback({ ...documentRequest, ...request }, response)).toBe(false)
      expect(response).toEqual({ statusCode: 400, headers: { 'content-type': 'application/json' } })
    })

    it.each([undefined, 200, 302, 600])('keeps the original response for status %s', (statusCode) => {
      const response = { statusCode, headers: { location: '/home' } }

      expect(redirectFailedAuthCallback(documentRequest, response)).toBe(false)
      expect(response).toEqual({ statusCode, headers: { location: '/home' } })
    })
  })
})
