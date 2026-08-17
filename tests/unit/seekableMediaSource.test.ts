import { HttpResponse, http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '../mocks/server'
import { acquireSeekableSource, clearSeekableSourceCache, getSeekableSource } from '@/utils/seekableMediaSource'

const REMOTE = '/api/v1/assets/77/download?workspace_id=3'

/** jsdom 没有 object URL，桩成可辨认的假地址，顺便记下 revoke 次数。 */
let created = 0
const revoked: string[] = []

beforeEach(() => {
  created = 0
  revoked.length = 0
  // 只替换这两个静态方法：整个 URL 换成普通对象会连带弄丢构造函数，
  // 而 fetch 与 msw 都要用 new URL() 解析相对地址，请求会在发出去之前就失败
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => `blob:local-${++created}`),
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn((url: string) => revoked.push(url)),
  })
})

afterEach(() => {
  clearSeekableSourceCache()
})

function serveVideo(bytes = 8, headers: Record<string, string> = {}) {
  server.use(
    http.get('/api/v1/assets/77/download', () =>
      HttpResponse.arrayBuffer(new Uint8Array(bytes).buffer, {
        headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(bytes), ...headers },
      }),
    ),
  )
}

describe('seekableMediaSource', () => {
  it('抓成本地副本，并把原地址登记进缓存', async () => {
    serveVideo()
    const handle = acquireSeekableSource(REMOTE)
    const ready = await handle.ready

    expect(ready.local).toBe(true)
    expect(ready.url).toBe('blob:local-1')
    expect(getSeekableSource(REMOTE)).toBe('blob:local-1')

    handle.release()
    expect(revoked).toEqual(['blob:local-1'])
    expect(getSeekableSource(REMOTE)).toBe('')
  })

  it('同一地址只下载一次，最后一个使用者退出才回收', async () => {
    let hits = 0
    server.use(
      http.get('/api/v1/assets/77/download', () => {
        hits += 1
        return HttpResponse.arrayBuffer(new Uint8Array(8).buffer, { headers: { 'Content-Type': 'video/mp4' } })
      }),
    )

    const first = acquireSeekableSource(REMOTE)
    const second = acquireSeekableSource(REMOTE)
    const [a, b] = await Promise.all([first.ready, second.ready])

    expect(hits).toBe(1)
    expect(a.url).toBe(b.url)

    first.release()
    expect(revoked).toEqual([]) // 还有人在用
    second.release()
    expect(revoked).toEqual(['blob:local-1'])
  })

  it('重复 release 不会把别人的引用一起减掉', async () => {
    serveVideo()
    const first = acquireSeekableSource(REMOTE)
    const second = acquireSeekableSource(REMOTE)
    await Promise.all([first.ready, second.ready])

    first.release()
    first.release()
    first.release()
    expect(revoked).toEqual([])

    second.release()
    expect(revoked).toEqual(['blob:local-1'])
  })

  it('关掉又立刻重开时，先来的句柄不会回收后来者的副本', async () => {
    serveVideo()
    const first = acquireSeekableSource(REMOTE)
    await first.ready
    first.release()
    expect(revoked).toEqual(['blob:local-1'])

    // 同一地址上新建的 entry：先来的那个句柄再怎么 release 也不该动它
    const second = acquireSeekableSource(REMOTE)
    const ready = await second.ready
    expect(ready.url).toBe('blob:local-2')

    first.release()
    expect(getSeekableSource(REMOTE)).toBe('blob:local-2')
    expect(revoked).toEqual(['blob:local-1'])
  })

  it('抓取失败时回落到原地址，而不是让预览整个不可用', async () => {
    server.use(http.get('/api/v1/assets/77/download', () => new HttpResponse(null, { status: 403 })))
    const ready = await acquireSeekableSource(REMOTE).ready

    expect(ready.local).toBe(false)
    expect(ready.url).toBe(REMOTE)
    expect(getSeekableSource(REMOTE)).toBe('')
  })

  it('200 但回的是 HTML（会话过期/网关拦截）时判失败，不把登录页当视频塞给播放器', async () => {
    server.use(
      http.get('/api/v1/assets/77/download', () =>
        HttpResponse.text('<!doctype html><title>登录</title>', { headers: { 'Content-Type': 'text/html' } }),
      ),
    )
    const ready = await acquireSeekableSource(REMOTE).ready

    expect(ready.local).toBe(false)
    expect(ready.url).toBe(REMOTE)
    expect(created).toBe(0) // 压根没建 object URL
  })

  it('octet-stream 照收：后端不给正确 MIME 是常事，按 mp4 兜底', async () => {
    serveVideo(8, { 'Content-Type': 'application/octet-stream' })
    const ready = await acquireSeekableSource(REMOTE).ready
    expect(ready.local).toBe(true)
  })

  it('上报下载进度，中途加入的订阅者先收到当前进度', async () => {
    serveVideo(16)
    const first: Array<[number, number]> = []
    const handle = acquireSeekableSource(REMOTE, {
      onProgress: ({ loadedBytes, totalBytes }) => first.push([loadedBytes, totalBytes]),
    })
    await handle.ready

    expect(first.length).toBeGreaterThan(0)
    const lastProgress = first[first.length - 1]
    expect(lastProgress[0]).toBe(16)
    expect(lastProgress[1]).toBe(16)

    // 下载已经结束：后来者不该停在 0，而是立刻拿到最终进度
    const late: Array<[number, number]> = []
    const second = acquireSeekableSource(REMOTE, {
      onProgress: ({ loadedBytes, totalBytes }) => late.push([loadedBytes, totalBytes]),
    })
    await second.ready
    expect(late).toEqual([[16, 16]])

    handle.release()
    second.release()
  })

  it('本地地址与空地址直接原样返回，不触发任何请求', async () => {
    // 没有注册 /download 处理器：一旦发起请求就会因 onUnhandledRequest: 'error' 失败
    const blob = await acquireSeekableSource('blob:already-local').ready
    expect(blob).toEqual({ url: 'blob:already-local', local: false })
    const empty = await acquireSeekableSource('').ready
    expect(empty).toEqual({ url: '', local: false })
  })
})
