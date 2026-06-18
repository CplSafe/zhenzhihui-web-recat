import { useCallback, useEffect, useRef, useState } from 'react'
import { sleep } from '@/utils/common'

/**
 * 生成任务轮询 + 假进度条 hook
 *
 * 使用方式：
 *   const { progress, phase, result, error, start, cancel } = useTaskPolling({
 *     fetchTask: (taskId) => getAiTask({ workspaceId, taskId }),
 *     onComplete: (res) => { ... },
 *   })
 *   await start(taskId)
 *
 * 进度策略：
 *   - 创建任务后根据 id 轮询状态接口
 *   - 轮询间隔优先使用接口返回的 poll_after_ms，默认 2000ms
 *   - status 为 queued/pending/running 且 outputs 为空 → 假进度自动平滑增长，最大 99%
 *   - outputs.length > 0 或 status 变为 success/succeeded/completed → 进度补到 100%
 *   - status 变为 failed/error → 停止轮询并暴露 error
 *   - 最终结果不在中途透出，只在终态时统一赋值给 result
 */

// ============================================================
// 纯函数工具
// ============================================================

/** 判断是否为终态（成功） */
function isSuccessStatus(status: any): boolean {
  const s = String(status || '').toLowerCase()
  return ['success', 'succeeded', 'completed'].includes(s)
}

/** 判断是否为终态（失败） */
function isFailedStatus(status: any): boolean {
  const s = String(status || '').toLowerCase()
  return ['failed', 'error', 'payment_failed', 'cancelled', 'expired'].includes(s)
}

/** 判断是否为进行中状态 */
function isRunningStatus(status: any): boolean {
  const s = String(status || '').toLowerCase()
  return ['queued', 'pending', 'running', 'processing', 'submitted', 'submitting'].includes(s)
}

/** 假进度引擎：每次前进 1% */
function tickProgress(current: number): number {
  return Math.min(99, current + 1)
}

/** 每次 tick 之间额外轮询的次数（2-3 次，含主轮询共 2-3 次请求） */
function extraPollCount(): number {
  return 1 + Math.floor(Math.random() * 2) // 1 or 2 extra → 2-3 total
}

/** 返回一个在 ms 毫秒后 resolve 的 Promise */
// sleep imported from @/utils/common

// ============================================================
// 类型
// ============================================================

export interface TaskPollingOptions {
  /** (taskId: string) => Promise<{ id, status, outputs?, poll_after_ms?, error_message? }> */
  fetchTask?: (taskId: string) => Promise<any>
  /** 默认轮询间隔（当接口未返回 poll_after_ms 时使用） */
  defaultIntervalMs?: number
  /** 快速起步阶段时长（ms），此阶段以 500ms 间隔高频 tick */
  fastTickDuration?: number
  /** 快速起步阶段每次 tick 间隔 */
  fastTickInterval?: number
  /** 超时时间，默认 5 分钟 */
  timeoutMs?: number
  /** 进度更新回调 (progress: number) */
  onProgress?: (progress: number) => void
  /** 每次轮询成功回调 (task: object) */
  onPoll?: (task: any) => void
  /** 完成回调 (result: object) */
  onComplete?: (result: any) => void
  /** 失败回调 (error: string) */
  onError?: (error: string) => void
}

export interface TaskPollingResult {
  success: boolean
  result?: any
  error?: string
  cancelled?: boolean
}

export type TaskPollingPhase = 'idle' | 'polling' | 'success' | 'failed'

// ============================================================
// hook
// ============================================================

export function useTaskPolling(options: TaskPollingOptions = {}) {
  // 用 ref 保存最新 options，避免 start/cancel 闭包读到过期回调
  const optionsRef = useRef(options)
  optionsRef.current = options

  // ---- 响应式状态 ----
  const [progress, setProgress] = useState(0)
  const [phase, setPhase] = useState<TaskPollingPhase>('idle') // 'idle' | 'polling' | 'success' | 'failed'
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  // ---- 内部变量 ----
  const controllerRef = useRef<AbortController | null>(null)
  const animFrameIdRef = useRef<number | null>(null)
  const animTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ---- 取消机制 ----
  const cancelAnimationFrames = useCallback(() => {
    if (animFrameIdRef.current != null) {
      cancelAnimationFrame(animFrameIdRef.current)
      animFrameIdRef.current = null
    }
    if (animTimeoutRef.current != null) {
      clearTimeout(animTimeoutRef.current)
      animTimeoutRef.current = null
    }
  }, [])

  const cancel = useCallback(() => {
    controllerRef.current?.abort()
    cancelAnimationFrames()
  }, [cancelAnimationFrames])

  // ---- 收口动画：从当前进度平滑过渡到 100% ----
  const animateTo100 = useCallback(
    (fromInput: number) => {
      cancelAnimationFrames()
      let from = fromInput
      return new Promise<void>((resolve) => {
        function step() {
          const remaining = 100 - from
          if (remaining <= 0.5) {
            setProgress(100)
            resolve()
            return
          }
          from += Math.ceil(remaining * 0.35)
          if (from > 99.5) from = 100
          setProgress(Math.round(from))
          animFrameIdRef.current = requestAnimationFrame(() => {
            animTimeoutRef.current = setTimeout(step, 60)
          })
        }
        animFrameIdRef.current = requestAnimationFrame(() => {
          animTimeoutRef.current = setTimeout(step, 20)
        })
      })
    },
    [cancelAnimationFrames],
  )

  // ---- 主轮询循环 ----
  const start = useCallback(
    async (taskId: string): Promise<TaskPollingResult> => {
      const {
        fetchTask,
        defaultIntervalMs = 2000,
        fastTickDuration = 3000,
        fastTickInterval = 500,
        timeoutMs = 300000,
        onProgress,
        onPoll,
        onComplete,
        onError,
      } = optionsRef.current

      if (!taskId) {
        setError('缺少任务 ID')
        setPhase('failed')
        return { success: false, error: '缺少任务 ID' }
      }

      if (typeof fetchTask !== 'function') {
        setError('未提供 fetchTask 函数')
        setPhase('failed')
        return { success: false, error: '未提供 fetchTask 函数' }
      }

      // 重置状态
      controllerRef.current?.abort()
      const controller = new AbortController()
      controllerRef.current = controller
      cancelAnimationFrames()
      setProgress(0)
      setPhase('polling')
      setResult(null)
      setError(null)

      const signal = controller.signal
      const startedAt = Date.now()
      let pollAfterMs = defaultIntervalMs
      let currentProgress = 0

      try {
        while (true) {
          // 超时检查
          if (Date.now() - startedAt > timeoutMs) {
            throw new Error('任务生成超时，请稍后重试')
          }

          // 取消检查
          if (signal.aborted) {
            return { success: false, cancelled: true }
          }

          // ---- 轮询 ----
          let res: any
          try {
            res = await fetchTask(taskId)
          } catch (err) {
            // 网络错误不中断，等下一次轮询
            await sleep(Math.min(pollAfterMs, 5000))
            continue
          }

          if (!res || signal.aborted) {
            return { success: false, cancelled: signal.aborted }
          }

          // 更新轮询间隔
          pollAfterMs = Number(res.poll_after_ms) || defaultIntervalMs

          // 通知外层（用于同步更新 generatedVideoTask 等）
          onPoll?.(res)

          // ---- 状态判断 ----
          if (isFailedStatus(res.status)) {
            const errMsg = res.error_message || '任务生成失败'
            setPhase('failed')
            setError(errMsg)
            onError?.(errMsg)
            return { success: false, error: errMsg }
          }

          if (isSuccessStatus(res.status)) {
            // 收口到 100%
            await animateTo100(currentProgress)
            setPhase('success')
            setResult(res)
            onProgress?.(100)
            onComplete?.(res)
            return { success: true, result: res }
          }

          if (isRunningStatus(res.status)) {
            const hasOutputs = Array.isArray(res.outputs) && res.outputs.length > 0

            if (hasOutputs) {
              currentProgress = Math.max(currentProgress, 90)
            }

            // 每 1% 进度之间走 2-3 次额外轮询请求
            const isNearComplete = currentProgress >= 99
            if (!isNearComplete) {
              const extras = extraPollCount()
              for (let i = 0; i < extras; i++) {
                await sleep(200)
                if (signal.aborted) return { success: false, cancelled: true }

                let extraRes: any
                try {
                  extraRes = await fetchTask(taskId)
                } catch {
                  continue
                }
                if (!extraRes || signal.aborted) continue

                onPoll?.(extraRes)
                pollAfterMs = Number(extraRes.poll_after_ms) || defaultIntervalMs

                if (isFailedStatus(extraRes.status)) {
                  const errMsg = extraRes.error_message || '任务生成失败'
                  setPhase('failed')
                  setError(errMsg)
                  onError?.(errMsg)
                  return { success: false, error: errMsg }
                }

                if (isSuccessStatus(extraRes.status)) {
                  await animateTo100(currentProgress)
                  setPhase('success')
                  setResult(extraRes)
                  onProgress?.(100)
                  onComplete?.(extraRes)
                  return { success: true, result: extraRes }
                }

                const extraHasOutputs = Array.isArray(extraRes.outputs) && extraRes.outputs.length > 0
                if (extraHasOutputs) {
                  currentProgress = Math.max(currentProgress, 90)
                }
              }
            }

            // 进度前进 1%
            currentProgress = tickProgress(currentProgress)
            setProgress(currentProgress)
            onProgress?.(currentProgress)

            // 99% 后快速轮询，尽快收口
            const elapsed = Date.now() - startedAt
            const normalInterval = elapsed < fastTickDuration ? fastTickInterval : pollAfterMs
            const nextWait = isNearComplete ? 100 : normalInterval
            await sleep(nextWait)
          } else {
            // 未知状态，按轮询间隔等待
            await sleep(pollAfterMs)
          }
        }
      } catch (err: any) {
        if (signal.aborted) {
          return { success: false, cancelled: true }
        }
        const errMsg = err?.message || '未知错误'
        setPhase('failed')
        setError(errMsg)
        onError?.(errMsg)
        return { success: false, error: errMsg }
      }
    },
    [animateTo100, cancelAnimationFrames],
  )

  // ---- 生命周期清理 ----
  useEffect(() => {
    return () => {
      controllerRef.current?.abort()
      cancelAnimationFrames()
    }
  }, [cancelAnimationFrames])

  // ---- 导出 ----
  return {
    /** 进度 0–100 */
    progress,
    /** 阶段：'idle' | 'polling' | 'success' | 'failed' */
    phase,
    /** 完成后为接口返回的完整响应对象，否则为 null */
    result,
    /** 失败时为错误信息字符串，否则为 null */
    error,
    /** 开始轮询 (taskId: string) => Promise<{ success, result?, error?, cancelled? }> */
    start,
    /** 取消当前轮询 */
    cancel,
  }
}
