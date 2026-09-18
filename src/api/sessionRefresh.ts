/**
 * 会话续期(POST /api/v1/auth/refresh)的全局单飞。
 *
 * 续期有两条触发路径:AuthContext 的定时/回到页面主动续期(auth.ts refreshSession),
 * 以及业务请求 401 后的静默续期重放(business.ts)。两条路径以前各自单飞、互不感知,
 * 长时间挂后台再切回来时会同时打出两个 refresh:若后端刷新令牌是一次性轮换的,
 * 后到的那一个会被拒绝 → 业务请求随机报「登录失效」、任务中心显示「登录状态已变化」。
 * 这里把两条路径合并成一个在途请求,任何时刻最多只有一个 refresh 在飞。
 */
import { DEFAULT_API_REQUEST_TIMEOUT_MS, RequestAbortError, withRequestTimeout } from './requestTimeout'

/** 业务后端的续期端点(同源代理)。 */
export const AUTH_REFRESH_PATH = '/api/v1/auth/refresh'

/** 一次续期的结果:HTTP 层面是否成功、状态码、解析后的响应体,以及网络层错误。 */
export interface SessionRefreshOutcome {
  ok: boolean
  status: number
  payload: any
  /** 网络失败 / 超时时的原始错误;HTTP 已返回(无论状态码)时为 null。 */
  error: unknown
  /** 请求因超时被中断时为 'timeout';正常返回或网络错误为 null。 */
  abortCause: 'timeout' | null
}

let inFlight: Promise<SessionRefreshOutcome> | null = null

/** 与 auth.ts / business.ts 相同的响应体读取:空体为 null,非 JSON 原样返回文本。 */
async function readJsonResponse(response: Response): Promise<any> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/**
 * 执行一次续期;已有在途请求时直接复用。
 * 这里不接受调用方的 AbortSignal:共享请求不能被任一调用方取消,需要「取消」语义的调用方
 * (AuthContext 登出)在拿到结果后自行按 signal / epoch 丢弃即可。
 */
export function runSharedSessionRefresh(): Promise<SessionRefreshOutcome> {
  if (inFlight) return inFlight
  const request = withRequestTimeout(
    async (signal) => {
      const response = await fetch(AUTH_REFRESH_PATH, {
        method: 'POST',
        credentials: 'include',
        ...(signal ? { signal } : {}),
      })
      const payload = await readJsonResponse(response)
      return { ok: response.ok, status: response.status, payload, error: null, abortCause: null }
    },
    { defaultTimeoutMs: DEFAULT_API_REQUEST_TIMEOUT_MS },
  ).catch(
    (error): SessionRefreshOutcome => ({
      ok: false,
      status: 0,
      payload: null,
      error,
      abortCause: error instanceof RequestAbortError && error.abortCause === 'timeout' ? 'timeout' : null,
    }),
  )
  inFlight = request
  // 结束后清空,后续再需要续期可再次发起
  void request.finally(() => {
    if (inFlight === request) inFlight = null
  })
  return request
}

/** 仅供测试:丢弃在途请求引用。 */
export function resetSharedSessionRefreshForTests(): void {
  inFlight = null
}
