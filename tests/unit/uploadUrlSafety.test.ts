import { describe, expect, it } from 'vitest'
import { isAllowedUploadUrl, type UploadUrlPolicy } from '@/utils/uploadUrlSafety'

const productionPolicy: UploadUrlPolicy = {
  pageOrigin: 'https://app.example.com',
  allowAnyHttp: false,
  allowedHostPatterns: ['https://storage.example.com', /\.amazonaws\.com$/i],
}

describe('uploadUrlSafety', () => {
  it.each([
    ['/api/v1/assets/upload', true],
    ['/api/upload?token=abc#part', true],
    ['https://app.example.com/upload', true],
    ['https://storage.example.com/presigned/upload', true],
    ['https://bucket.s3.amazonaws.com/object', true],
    ['upload/object', false],
    ['./upload/object', false],
    ['../upload/object', false],
    ['https://untrusted.example.com/upload', false],
    ['https://s3.amazonaws.com.evil.test/upload', false],
    ['http://app.example.com/upload', false],
    ['https://app.example.com:444/upload', false],
    ['javascript:alert(1)', false],
    ['data:text/plain,upload', false],
    ['blob:https://app.example.com/id', false],
    ['file:///tmp/upload', false],
    ['', false],
    ['   ', false],
  ])('validates %s against the production policy', (url, expected) => {
    expect(isAllowedUploadUrl(url, productionPolicy)).toBe(expected)
  })

  it.each([
    '//evil.example/upload',
    '///evil.example/upload',
    '//app.example.com/upload',
    '/\\\\evil.example/upload',
    '\\\\evil.example/upload',
    'https:\\\\evil.example\\upload',
    '/\n/evil.example/upload',
  ])('rejects browser-normalized cross-origin forms: %s', (url) => {
    expect(isAllowedUploadUrl(url, productionPolicy)).toBe(false)
  })

  it('uses the parsed origin instead of decoding the path manually', () => {
    expect(isAllowedUploadUrl('/%2F%2Fevil.example/object', productionPolicy)).toBe(true)
    expect(isAllowedUploadUrl('/%5C%5Cevil.example/object', productionPolicy)).toBe(true)
  })

  it('allows arbitrary absolute http(s) URLs only when the development policy requests it', () => {
    expect(isAllowedUploadUrl('http://127.0.0.1:9000/upload', productionPolicy)).toBe(false)
    expect(
      isAllowedUploadUrl('http://127.0.0.1:9000/upload', {
        ...productionPolicy,
        allowAnyHttp: true,
      }),
    ).toBe(true)
    expect(
      isAllowedUploadUrl('//127.0.0.1:9000/upload', {
        ...productionPolicy,
        allowAnyHttp: true,
      }),
    ).toBe(false)
  })

  it('fails closed when the page origin is unavailable or invalid', () => {
    expect(isAllowedUploadUrl('/api/upload', { ...productionPolicy, pageOrigin: '' })).toBe(false)
    expect(isAllowedUploadUrl('/api/upload', { ...productionPolicy, pageOrigin: 'not-an-origin' })).toBe(false)
    expect(isAllowedUploadUrl(null, productionPolicy)).toBe(false)
  })
})
