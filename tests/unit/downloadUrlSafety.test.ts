import { describe, expect, it } from 'vitest'
import { resolveSafeDownloadUrl } from '@/utils/downloadUrlSafety'

const PAGE_ORIGIN = 'https://app.example.com'

describe('downloadUrlSafety', () => {
  it.each([
    ['/api/v1/assets/42/download?workspace_id=7', { kind: 'http', isCrossOrigin: false }],
    ['https://app.example.com/download/video.mp4', { kind: 'http', isCrossOrigin: false }],
    ['https://cdn.example.com/video.mp4?signature=abc', { kind: 'http', isCrossOrigin: true }],
    ['http://cdn.example.com/video.mp4', { kind: 'http', isCrossOrigin: true }],
    ['blob:https://app.example.com/object-id', { kind: 'blob', isCrossOrigin: false }],
  ])('accepts supported download URL %s', (url, expected) => {
    expect(resolveSafeDownloadUrl(url, PAGE_ORIGIN)).toMatchObject(expected)
  })

  it.each([
    '',
    '   ',
    'video.mp4',
    './video.mp4',
    '../video.mp4',
    '//evil.example/video.mp4',
    '///evil.example/video.mp4',
    '/\\\\evil.example/video.mp4',
    '\\\\evil.example/video.mp4',
    '/\n/evil.example/video.mp4',
    'javascript:parent.alert(1)',
    'JaVaScRiPt:parent.alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///tmp/video.mp4',
    'ftp://cdn.example.com/video.mp4',
    'about:blank',
    'filesystem:https://app.example.com/video.mp4',
    'blob:https://evil.example/object-id',
    'blob:null/object-id',
    'https://user:password@cdn.example.com/video.mp4',
    'https://trusted.example\\@evil.example/video.mp4',
    'https://cdn.example.com/\u0000video.mp4',
  ])('rejects unsafe download URL %s', (url) => {
    expect(resolveSafeDownloadUrl(url, PAGE_ORIGIN)).toBeNull()
  })

  it('fails closed when the current page origin is unavailable or invalid', () => {
    expect(resolveSafeDownloadUrl('/api/download', '')).toBeNull()
    expect(resolveSafeDownloadUrl('https://cdn.example.com/video.mp4', 'not-an-origin')).toBeNull()
    expect(resolveSafeDownloadUrl(null, PAGE_ORIGIN)).toBeNull()
  })

  it('keeps encoded path separators under the same origin', () => {
    expect(resolveSafeDownloadUrl('/%2F%2Fevil.example/video.mp4', PAGE_ORIGIN)).toEqual({
      href: '/%2F%2Fevil.example/video.mp4',
      kind: 'http',
      isCrossOrigin: false,
    })
  })
})
