import { describe, expect, it } from 'vitest'
import { isValidUploadUrl } from '@/utils/uploadUrlSafety'

const origin = 'https://app.example.com'
describe('backend-issued uploads without an origin allowlist', () => {
  it.each([
    '/api/upload',
    '/%2F%2Fstorage.example/object',
    'https://s3oss-yy.youliangads.com/goujie/',
    'https://s30ss-yy.youliangads.com/goujie/',
    'https://new-storage.example.net/upload',
    'https://s3.amazonaws.com.other.example/upload',
    'https://app.example.com:9443/upload',
    'http://app.example.com/upload',
    'http://127.0.0.1:9000/upload',
    'https://10.0.0.2:9443/upload',
  ])('accepts any HTTP(S) storage origin, independent of build-time config: %s', (url) => {
    expect(isValidUploadUrl(url, origin)).toBe(true)
  })
  it.each([
    '',
    ' ',
    'bad-url',
    'relative/upload',
    './upload',
    '../upload',
    '//storage.example/upload',
    '///storage.example/upload',
    '/\\evil.example/upload',
    '/\n/storage.example/upload',
    'https:\\storage.example/upload',
    'javascript:alert(1)',
    'data:text/plain,upload',
    'blob:https://app.example/id',
    'file:///tmp/upload',
    'https://user:password@storage.example/upload',
    null,
  ])('rejects malformed URLs and non-HTTP transports: %s', (url) => {
    expect(isValidUploadUrl(url, origin)).toBe(false)
  })
  it('absolute storage URLs do not need page origin configuration', () => {
    expect(isValidUploadUrl('https://any-storage.example/upload', '')).toBe(true)
    expect(isValidUploadUrl('/api/upload', '')).toBe(false)
  })
})
