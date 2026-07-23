/**
 * API 请求超时与取消工具。
 * 将调用方的 AbortSignal 与本地超时合并，并用可区分原因的错误对象统一上抛。
 */

/** 普通 API 请求的默认超时时间（毫秒）。 */
export const DEFAULT_API_REQUEST_TIMEOUT_MS = 30_000

/** 请求中断的归一化原因。 */
export type RequestAbortCause = 'timeout' | 'aborted'

/** 区分“超时”与“调用方取消”的请求中断错误。 */
export class RequestAbortError extends Error {
  readonly abortCause: RequestAbortCause
  readonly originalError: unknown

  constructor(abortCause: RequestAbortCause, originalError: unknown = null) {
    super(abortCause === 'timeout' ? 'Request timed out' : 'Request was aborted')
    this.name = 'RequestAbortError'
    this.abortCause = abortCause
    this.originalError = originalError
  }
}

/** 单次请求的超时和外部取消配置。 */
interface RequestTimeoutOptions {
  /** 调用方持有的信号；本工具只监听，不会修改它。 */
  signal?: AbortSignal | null
  /** 单次请求超时值；0 表示显式关闭超时。 */
  timeoutMs?: number
  /** timeoutMs 未传入时使用的默认值。 */
  defaultTimeoutMs?: number
}

/** 将未知超时值归一化为非负整数，非法值回退到默认值。 */
function normalizeTimeoutMs(value: unknown, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return Math.max(0, Math.floor(fallback))
  }
  return Math.max(0, Math.floor(parsed))
}

/**
 * 在同一超时窗口内执行完整请求，并合并可选的外部 AbortSignal。
 * 无论成功或失败都会清理计时器与事件监听，避免长生命周期页面泄漏。
 */
export async function withRequestTimeout<T>(
  execute: (signal: AbortSignal | undefined) => Promise<T>,
  options: RequestTimeoutOptions = {},
): Promise<T> {
  const defaultTimeoutMs = normalizeTimeoutMs(options.defaultTimeoutMs, DEFAULT_API_REQUEST_TIMEOUT_MS)
  const timeoutMs =
    options.timeoutMs === undefined ? defaultTimeoutMs : normalizeTimeoutMs(options.timeoutMs, defaultTimeoutMs)
  const externalSignal = options.signal || null

  if (timeoutMs <= 0 && !externalSignal) {
    return execute(undefined)
  }

  const controller = new AbortController()
  let abortCause: RequestAbortCause | null = null
  let timeoutId: number | null = null
  let externalListenerAttached = false

  const abort = (cause: RequestAbortCause) => {
    if (abortCause) return
    abortCause = cause
    controller.abort()
  }
  const abortByExternalSignal = () => abort('aborted')

  if (externalSignal) {
    if (externalSignal.aborted) {
      abort('aborted')
    } else {
      externalSignal.addEventListener('abort', abortByExternalSignal, { once: true })
      externalListenerAttached = true
    }
  }

  if (timeoutMs > 0 && !abortCause) {
    timeoutId = globalThis.setTimeout(() => abort('timeout'), timeoutMs)
  }

  try {
    if (abortCause) {
      throw new RequestAbortError(abortCause, externalSignal?.reason)
    }
    return await execute(controller.signal)
  } catch (error) {
    if (error instanceof RequestAbortError) {
      throw error
    }
    if (abortCause) {
      throw new RequestAbortError(abortCause, error)
    }
    throw error
  } finally {
    if (timeoutId !== null) {
      globalThis.clearTimeout(timeoutId)
    }
    if (externalSignal && externalListenerAttached) {
      externalSignal.removeEventListener('abort', abortByExternalSignal)
    }
  }
}
