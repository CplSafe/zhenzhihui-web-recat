import { describe, expect, it } from 'vitest'
import { resolveProxyTarget } from '@/build/proxyTarget'

describe('Vite proxy target validation', () => {
  it('trims a pure origin and returns its normalized origin', () => {
    expect(resolveProxyTarget('  HTTPS://Example.COM:443/  ', 'http://localhost:9000', 'BACKEND_ORIGIN')).toBe(
      'https://example.com',
    )
  })

  it.each([undefined, '', '   '])('uses the fallback for an empty configured value: %j', (value) => {
    expect(resolveProxyTarget(value, ' http://localhost:9000/ ', 'BACKEND_ORIGIN')).toBe('http://localhost:9000')
  })

  it.each([
    'http://localhost:80013',
    'https://user@example.com',
    'https://user:password@example.com',
    'https://example.com/api',
    'https://example.com/?workspace=1',
    'https://example.com/#callback',
    'https://exa mple.com',
  ])('rejects a value that is not a credential-free pure HTTP(S) origin: %s', (value) => {
    expect(() => resolveProxyTarget(value, 'http://localhost:9000', 'BACKEND_ORIGIN')).toThrow(/BACKEND_ORIGIN/)
  })
})
