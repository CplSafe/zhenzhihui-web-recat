import { describe, expect, it } from 'vitest'
import { pickCanvasCover } from '@/utils/canvasCover'

const node = (kind: string, data: Record<string, unknown>, op?: 'upsert' | 'delete') => ({
  element_id: `${kind}-${JSON.stringify(data)}`,
  kind: 'node',
  ...(op ? { op } : {}),
  payload: { type: kind, data: { kind, ...data } },
})

describe('pickCanvasCover', () => {
  it('takes the last media node, because elements come back in revision order', () => {
    const cover = pickCanvasCover(
      [node('image', { assetId: 11 }), node('text', { text: '足球主题' }), node('video', { assetId: 22 })] as never,
      2,
    )
    expect(cover).toEqual({ kind: 'video', url: '/api/v1/assets/22/download?workspace_id=2' })
  })

  it('rebuilds the url from assetId instead of trusting a stored resultUrl', () => {
    // 节点里存的可能是会过期的签名地址或刷新即失效的 blob:，不能拿来当列表封面
    const cover = pickCanvasCover([node('image', { assetId: 31, resultUrl: 'blob:http://localhost/abc' })] as never, 7)
    expect(cover).toEqual({ kind: 'image', url: '/api/v1/assets/31/download?workspace_id=7' })
  })

  it('falls back to an http result url when there is no assetId', () => {
    const cover = pickCanvasCover([node('image', { resultUrl: 'https://cdn.example.com/a.png' })] as never, 2)
    expect(cover).toEqual({ kind: 'image', url: 'https://cdn.example.com/a.png' })
  })

  it('skips blob/relative urls that cannot survive a reload', () => {
    expect(pickCanvasCover([node('image', { resultUrl: 'blob:http://localhost/abc' })] as never, 2)).toBeNull()
    expect(pickCanvasCover([node('video', { resultUrl: '/tmp/local.mp4' })] as never, 2)).toBeNull()
  })

  it('ignores deleted nodes and falls through to the previous usable one', () => {
    const cover = pickCanvasCover(
      [node('image', { assetId: 11 }), node('video', { assetId: 22 }, 'delete')] as never,
      2,
    )
    expect(cover).toEqual({ kind: 'image', url: '/api/v1/assets/11/download?workspace_id=2' })
  })

  it('returns null for empty canvases, text-only canvases and missing input', () => {
    expect(pickCanvasCover([], 2)).toBeNull()
    expect(pickCanvasCover(undefined, 2)).toBeNull()
    expect(pickCanvasCover([node('text', { text: '只有文本' })] as never, 2)).toBeNull()
  })

  it('returns null when the workspace id is invalid, rather than a broken url', () => {
    expect(pickCanvasCover([node('image', { assetId: 11 })] as never, 0)).toBeNull()
  })
})
