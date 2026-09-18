/**
 * 会话续期全局单飞:AuthContext 的主动续期与业务请求 401 重放必须共用同一个在途 refresh。
 * 否则长时间挂后台后切回页面,两条路径并发打出两个 refresh,轮换式刷新令牌会让后到的那个被拒。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { refreshSession } from '@/api/auth'
import { getAiTask } from '@/api/business'
import { resetSharedSessionRefreshForTests, runSharedSessionRefresh } from '@/api/sessionRefresh'

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
}

function requestPath(input: RequestInfo | URL) {
  return new URL(String(input), window.location.origin).pathname
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

describe('shared session refresh single-flight', () => {
  beforeEach(() => {
    resetSharedSessionRefreshForTests()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    resetSharedSessionRefreshForTests()
  })

  it('merges a timer refresh and a 401-triggered refresh into one POST /auth/refresh', async () => {
    const refreshGate = deferred<Response>()
    let taskCalls = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const path = requestPath(input)
      if (path === '/api/v1/auth/refresh') return refreshGate.promise
      if (path === '/api/v1/ai/tasks/77') {
        taskCalls += 1
        // 第一次 401(access token 过期),续期后重放成功
        return taskCalls === 1
          ? jsonResponse({ code_string: 'UNAUTHORIZED' }, 401)
          : jsonResponse({ data: { id: 77, status: 'succeeded' } })
      }
      throw new Error(`Unexpected request: ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    // 模拟「回到页面」:AuthContext 主动续期与任务中心轮询(401 → 静默续期)同时发生
    const timerRefresh = refreshSession()
    const taskPoll = getAiTask({ workspaceId: 1, taskId: 77 })
    await Promise.resolve()
    await Promise.resolve()

    refreshGate.resolve(jsonResponse({ data: { expires_in: 120 } }))

    await expect(timerRefresh).resolves.toEqual({ expires_in: 120 })
    await expect(taskPoll).resolves.toMatchObject({ id: 77, status: 'succeeded' })
    const refreshCalls = fetchMock.mock.calls.filter(([input]) => requestPath(input) === '/api/v1/auth/refresh')
    expect(refreshCalls).toHaveLength(1)
    expect(refreshCalls[0]![1]).toMatchObject({ method: 'POST', credentials: 'include' })
  })

  it('allows a new refresh once the previous one settled', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: { ok: true } }))
    vi.stubGlobal('fetch', fetchMock)

    await runSharedSessionRefresh()
    await runSharedSessionRefresh()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('surfaces a rejected refresh as an unauthorized AuthApiError without throwing from the shared layer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ code_string: 'UNAUTHORIZED', message: 'refresh token revoked' }, 401)),
    )

    await expect(runSharedSessionRefresh()).resolves.toMatchObject({ ok: false, status: 401 })
    await expect(refreshSession()).rejects.toMatchObject({
      name: 'AuthApiError',
      status: 401,
      message: 'refresh token revoked',
    })
  })

  it('turns a network failure into a non-unauthorized AuthApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )

    await expect(refreshSession()).rejects.toMatchObject({
      name: 'AuthApiError',
      status: 0,
      message: '网络请求失败，请检查接口服务或本地代理配置',
    })
  })

  it('rejects with "cancelled" when the caller aborted, without cancelling the shared request', async () => {
    const controller = new AbortController()
    const refreshGate = deferred<Response>()
    const fetchMock = vi.fn(async () => refreshGate.promise)
    vi.stubGlobal('fetch', fetchMock)

    const aborted = refreshSession({ signal: controller.signal })
    const other = runSharedSessionRefresh()
    controller.abort()
    refreshGate.resolve(jsonResponse({ data: { ok: true } }))

    await expect(aborted).rejects.toMatchObject({ name: 'AuthApiError', cause: 'aborted' })
    await expect(other).resolves.toMatchObject({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
