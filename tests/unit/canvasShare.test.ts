import { describe, expect, it } from 'vitest'
import { buildCanvasShareUrl, parseCanvasShareState } from '@/api/canvasShare'

/**
 * 分享状态的响应体在 swagger 里是通用的 response.Response（data 未展开），
 * 因此字段按候选键名容错解析。唯一不可缺的是 token——没有它就没有可分享的链接。
 */
describe('parseCanvasShareState', () => {
  it('从 data 层读出 token、链接与过期时间', () => {
    const state = parseCanvasShareState({
      code: 0,
      data: { token: 'abc123', url: 'https://zzh.example.com/c/abc123', expires_at: '2026-09-01T00:00:00Z' },
    })
    expect(state).toEqual({
      token: 'abc123',
      url: 'https://zzh.example.com/c/abc123',
      expiresAt: '2026-09-01T00:00:00Z',
      status: '',
    })
  })

  it('兼容 share 嵌套层与驼峰/别名字段', () => {
    expect(parseCanvasShareState({ data: { share: { shareToken: 'T1', status: 'active' } } })).toMatchObject({
      token: 'T1',
      status: 'active',
    })
    expect(parseCanvasShareState({ share_token: 'T2' }).token).toBe('T2')
  })

  it('读不到 token 时视作未分享，不返回半个状态', () => {
    // 猜一个 token 拼出来的链接会被用户发给别人，打不开时的排查成本远高于这里显示「未开启」
    expect(parseCanvasShareState({ data: {} }).token).toBe('')
    expect(parseCanvasShareState(null).token).toBe('')
  })
})

describe('buildCanvasShareUrl', () => {
  it('后端给了完整链接就以后端为准', () => {
    const url = buildCanvasShareUrl(
      { token: 'abc', url: 'https://short.example/x', expiresAt: '', status: '' },
      'https://app.example.com',
    )
    expect(url).toBe('https://short.example/x')
  })

  it('后端只给 token 时按当前站点拼查看页地址', () => {
    const url = buildCanvasShareUrl(
      { token: 'abc 123', url: '', expiresAt: '', status: '' },
      'https://app.example.com/',
    )
    expect(url).toBe('https://app.example.com/canvas/share/abc%20123')
  })

  it('未开启分享时不给出任何链接', () => {
    expect(buildCanvasShareUrl({ token: '', url: '', expiresAt: '', status: '' }, 'https://app.example.com')).toBe('')
  })
})
