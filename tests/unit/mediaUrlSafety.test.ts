import { describe, expect, it } from 'vitest'
import { assetStreamUrl } from '@/utils/assetUrl'
import { isSafeMediaUrl, isSafeNavigationUrl, sanitizeMediaUrl, sanitizeNavigationUrl } from '@/utils/urlSafety'

describe('media URL safety', () => {
  it.each([
    'https://cdn.example.com/video.mp4',
    'HTTP://cdn.example.com/image.png',
    'blob:https://app.example.com/id',
    'blob:null/id',
    '/api/v1/assets/1/download',
  ])('allows supported media URL %s', (url) => {
    expect(isSafeMediaUrl(url)).toBe(true)
    expect(sanitizeMediaUrl(url, '/fallback')).toBe(url)
  })

  it.each([
    '',
    '   ',
    '//evil.example.com/video.mp4',
    'javascript:alert(1)',
    'data:image/svg+xml,<svg onload=alert(1)>',
    'file:///etc/passwd',
    'ftp://example.com/file',
    'blob:javascript:alert(1)',
    'blob:data:text/plain,unsafe',
    'blob:file:///etc/passwd',
    '\\evil.example.com\\share',
    '/\\evil.example.com/video.mp4',
    'https://',
    'https://@example.com/video.mp4',
    'https://user:secret@example.com/video.mp4',
    '/safe\u0000evil',
    'https://example.com/line\nbreak.mp4',
    ' https://example.com/leading-space.mp4',
    'https://example.com/trailing-space.mp4 ',
  ])('rejects unsupported or ambiguous media URL %s', (url) => {
    expect(isSafeMediaUrl(url)).toBe(false)
    expect(sanitizeMediaUrl(url, '/fallback')).toBe('/fallback')
  })

  it('rejects non-string values', () => {
    for (const value of [null, undefined, 0, {}, []]) {
      expect(isSafeMediaUrl(value)).toBe(false)
    }
  })
})

describe('navigation URL safety', () => {
  it.each([
    'https://example.com/detail?id=1#video',
    'HTTP://example.com/path',
    '/templates',
    '/templates?category=video#featured',
  ])('allows supported navigation URL %s', (url) => {
    expect(isSafeNavigationUrl(url)).toBe(true)
    expect(sanitizeNavigationUrl(url, '/fallback')).toBe(url)
  })

  it.each([
    '',
    '   ',
    '//evil.example.com/path',
    '/\\evil.example.com/path',
    '\\evil.example.com\\path',
    'https://',
    'https://@example.com/path',
    'https://user@example.com/path',
    'https://:secret@example.com/path',
    'https://example.com/path\u0000suffix',
    '/path\r\nSet-Cookie: unsafe=1',
    'blob:https://example.com/id',
    'javascript:alert(1)',
  ])('rejects unsupported or ambiguous navigation URL %s', (url) => {
    expect(isSafeNavigationUrl(url)).toBe(false)
    expect(sanitizeNavigationUrl(url, '/fallback')).toBe('/fallback')
  })

  it('rejects non-string navigation values', () => {
    for (const value of [null, undefined, 0, {}, []]) {
      expect(isSafeNavigationUrl(value)).toBe(false)
    }
  })
})

describe('authenticated asset stream URLs', () => {
  it('builds an exact tenant-scoped URL for positive safe integer IDs', () => {
    expect(assetStreamUrl(23, 7)).toBe('/api/v1/assets/23/download?workspace_id=7')
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'fails closed for invalid asset ID %s',
    (assetId) => {
      expect(assetStreamUrl(assetId, 7)).toBe('')
    },
  )

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'fails closed for invalid workspace ID %s',
    (workspaceId) => {
      expect(assetStreamUrl(23, workspaceId)).toBe('')
    },
  )
})
