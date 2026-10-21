import { describe, expect, it } from 'vitest'
import { rewriteBusinessAuthCallback } from '@/build/authCallbackProxy'

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
})
