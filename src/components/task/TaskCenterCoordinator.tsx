/**
 * TaskCenterCoordinator — 全局生成任务轮询与终态持久化协调器。
 * 组件本身不渲染界面；它按用户和工作空间轮询活动任务，将结果写回对应草稿，并只发送一次终态通知。
 */
import { useEffect } from 'react'
import { getAiTask, getBusinessErrorMessage } from '@/api/business'
import { useAuth } from '@/auth/AuthContext'
import {
  getTaskCenterExpirationReason,
  isTaskCenterImageTask,
  isTaskCenterActiveStatus,
  isTaskCenterTerminalStatus,
  type TaskCenterStatus,
  type TaskCenterTask,
  useTaskCenterStore,
} from '@/stores/taskCenter'
import { useUiStore } from '@/stores/ui'
import { useCurrentUser, useWorkspaceId } from '@/stores/workspaceSession'
import { resolveTaskVideoResult } from '@/utils/taskMedia'
import { isVideoGenRunning } from '@/utils/videoGenRegistry'
import { persistVideoResultToBackend, persistVideoTerminalStateToBackend } from '@/utils/persistVideoResult'
import { persistHotCopyResultToBackend, persistHotCopyTerminalStateToBackend } from '@/utils/persistHotCopyResult'
import { readAiTaskProgress } from '@/utils/taskProgress'

/** 后台任务状态的轮询间隔。 */
const POLL_INTERVAL_MS = 4000

/** 单轮最多并行查询的不同后端任务数。 */
const TASK_POLL_CONCURRENCY = 3

/** 后端任务状态别名集合，用于统一终态判断。 */
const SUCCEEDED_STATUSES = new Set(['succeeded', 'completed', 'success'])

/** 归一化为失败终态的后端状态别名。 */
const FAILED_STATUSES = new Set(['failed', 'error', 'payment_failed', 'expired'])

/** 归一化为取消终态的后端状态别名。 */
const CANCELLED_STATUSES = new Set(['cancelled', 'canceled'])

/** 以固定 worker 数量处理任务，避免恢复大量历史任务时瞬间打满后端。 */
export async function runWithConcurrencyLimit<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const workerCount = Math.min(items.length, Math.max(1, Math.floor(concurrency || 1)))
  let nextIndex = 0
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      for (;;) {
        const index = nextIndex
        nextIndex += 1
        if (index >= items.length) return
        await worker(items[index])
      }
    }),
  )
}

/** 兼容多种 API 包装层，取出实际任务对象。 */
function unwrapTask(payload: any): any {
  if (payload?.data?.task && typeof payload.data.task === 'object') return payload.data.task
  if (payload?.task && typeof payload.task === 'object') return payload.task
  if (payload?.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) return payload.data
  return payload || {}
}

/** 把后端各版本状态别名统一为任务中心状态。 */
function normalizeRemoteStatus(remote: any, fallback: TaskCenterStatus): TaskCenterStatus {
  const status = String(remote?.status ?? remote?.state ?? '')
    .trim()
    .toLowerCase()
  if (SUCCEEDED_STATUSES.has(status)) return 'succeeded'
  if (FAILED_STATUSES.has(status)) return 'failed'
  if (CANCELLED_STATUSES.has(status)) return 'cancelled'
  if (status === 'submitting' || status === 'created' || status === 'preparing') return 'preparing'
  if (status === 'queued' || status === 'pending') return 'queued'
  if (status === 'processing' || status === 'running') return 'processing'
  if (status === 'reconnecting') return 'reconnecting'
  return fallback
}

/** 解析远端任务更新时间，兼容秒/毫秒时间戳和日期字符串。 */
function readRemoteTimestamp(remote: any): number | undefined {
  const raw = remote?.updated_at ?? remote?.updatedAt ?? remote?.finished_at ?? remote?.finishedAt
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw < 1_000_000_000_000 ? raw * 1000 : raw
  const parsed = Date.parse(String(raw || ''))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

/** 从常见错误字段中提取可展示详情，复杂对象安全序列化失败时使用稳定回退文案。 */
function readRemoteError(remote: any, fallback: string): string {
  const value =
    remote?.error_message ??
    remote?.errorMessage ??
    remote?.failure_reason ??
    remote?.failureReason ??
    remote?.error?.message ??
    remote?.error ??
    remote?.message
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (value && typeof value === 'object') {
    try {
      const serialized = JSON.stringify(value)
      if (serialized && serialized !== '{}') return serialized
    } catch {
      // 序列化失败时继续使用稳定的用户可读回退文案。
    }
  }
  return fallback
}

/** 图片任务由独立恢复链负责；这里只查询视频登记表中的智能成片/爆款复制任务。 */
function isLocallyManagedVideoTask(task: TaskCenterTask): boolean {
  if (isTaskCenterImageTask(task)) return false
  const scope = task.scope === 'hot-copy' ? 'hot-copy' : 'smart'
  return isVideoGenRunning(scope, task.workspaceId, task.projectId)
}

/**
 * 用快照重新核对 store 中的最新任务身份和活动状态。
 * 页面内主生成链仍运行时跳过全局恢复轮询，避免两个轮询器同时写同一项目。
 */
function getLatestEligibleTask(snapshot: TaskCenterTask): TaskCenterTask | null {
  const store = useTaskCenterStore.getState()
  const current = store.tasks.find((task) => task.id === snapshot.id)
  if (
    !current ||
    isTaskCenterImageTask(current) ||
    current.taskId !== snapshot.taskId ||
    current.workspaceId !== snapshot.workspaceId ||
    current.projectId !== snapshot.projectId ||
    current.scope !== snapshot.scope ||
    !isTaskCenterActiveStatus(current.status) ||
    isLocallyManagedVideoTask(current)
  ) {
    return null
  }
  return current
}

/** 只更新仍与快照同一归属且可由协调器接管的最新任务。 */
function patchLatestEligibleTask(snapshot: TaskCenterTask, patch: Partial<TaskCenterTask>): TaskCenterTask | null {
  const current = getLatestEligibleTask(snapshot)
  if (!current) return null
  const changed = Object.entries(patch).some(([key, value]) => current[key as keyof TaskCenterTask] !== value)
  if (changed) useTaskCenterStore.getState().patchTask(current.id, patch)
  return useTaskCenterStore.getState().tasks.find((task) => task.id === current.id) || null
}

/** 为任务终态生成长度受控的全局通知。 */
function notificationMessage(task: TaskCenterTask): { message: string; type: 'success' | 'error' | 'info' } {
  const title = task.title.trim() || '视频'
  if (task.status === 'succeeded') return { message: `${title}生成完成`, type: 'success' }
  if (task.status === 'cancelled') return { message: `${title}已取消`, type: 'info' }
  const detail = String(task.error || '')
    .trim()
    .slice(0, 80)
  return { message: `${title}生成失败${detail ? `：${detail}` : ''}`, type: 'error' }
}

/** 每个终态任务只通知一次；用户已在对应详情页时由页面自行反馈，避免重复 Toast。 */
function notifyTerminalTask(snapshot: TaskCenterTask): void {
  const latest = useTaskCenterStore.getState().tasks.find((task) => task.id === snapshot.id)
  if (!latest || latest.notifiedAt || !isTaskCenterTerminalStatus(latest.status)) return
  const expectedPath = `/${latest.scope === 'hot-copy' ? 'hot-copy' : 'smart'}/${latest.projectId}`
  if (window.location.pathname.replace(/\/$/, '') === expectedPath) {
    // 当前正停留在该项目，页面本身会展示结果/错误；记为已通知，避免与页面 toast 重复。
    useTaskCenterStore.getState().patchTask(latest.id, { notifiedAt: Date.now() })
    return
  }
  const notification = notificationMessage(latest)
  useUiStore.getState().showToast(notification.message, notification.type)
  useTaskCenterStore.getState().patchTask(latest.id, { notifiedAt: Date.now() })
}

/**
 * 页面内已有 promise/轮询继续作为主链；仅在对应项目不在 videoGenRegistry 中时，
 * 对持久化的 task_id 做一次集中轮询恢复与终态对账。
 */
export default function TaskCenterCoordinator() {
  const { isAuthenticated, isCheckingSession } = useAuth()
  const workspaceId = Number(useWorkspaceId() || 0)
  const currentUser = useCurrentUser() as any
  const ownerUserId = Number(
    currentUser?.id ?? currentUser?.user_id ?? currentUser?.userId ?? currentUser?.account_id ?? currentUser?.uid ?? 0,
  )

  useEffect(() => {
    if (isCheckingSession) return
    useTaskCenterStore.getState().setOwnerUserId(isAuthenticated ? ownerUserId : 0)
  }, [isAuthenticated, isCheckingSession, ownerUserId])

  useEffect(() => {
    if (!isAuthenticated || !workspaceId || !ownerUserId) return
    return useTaskCenterStore.subscribe((state, previousState) => {
      const previousById = new Map(previousState.tasks.map((task) => [task.id, task]))
      state.tasks.forEach((task) => {
        if (
          task.workspaceId !== workspaceId ||
          Number(task.ownerUserId || 0) !== ownerUserId ||
          task.notifiedAt ||
          !isTaskCenterTerminalStatus(task.status)
        ) {
          return
        }
        const previous = previousById.get(task.id)
        if (previous && isTaskCenterActiveStatus(previous.status)) notifyTerminalTask(task)
      })
    })
  }, [isAuthenticated, ownerUserId, workspaceId])

  useEffect(() => {
    if (!isAuthenticated || !workspaceId || !ownerUserId) return

    let disposed = false
    let polling = false
    const terminalSyncAttempts = new Map<string, number>()

    const persistTerminalState = (task: TaskCenterTask, status: 'failed' | 'cancelled', error = '') =>
      task.scope === 'hot-copy'
        ? persistHotCopyTerminalStateToBackend({
            projectId: task.projectId,
            workspaceId,
            taskId: task.taskId,
            generationId: task.generationId,
            status,
            error,
          })
        : persistVideoTerminalStateToBackend({
            projectId: task.projectId,
            workspaceId,
            taskId: task.taskId,
            genId: task.generationId,
            status,
            error,
          })

    const handleStructuralSyncFailure = (task: TaskCenterTask, message: string, keepStatusWhileRetry = false) => {
      const attempts = (terminalSyncAttempts.get(task.id) || 0) + 1
      terminalSyncAttempts.set(task.id, attempts)
      // false 仅表示项目草稿没有接受该任务归属，并不能证明远端任务失败；继续对账而不误设终态。
      patchLatestEligibleTask(task, {
        status: keepStatusWhileRetry ? task.status : 'reconnecting',
        error: `${message}；将持续重试（第 ${attempts} 次）`,
        ...(keepStatusWhileRetry ? { updatedAt: task.updatedAt } : {}),
      })
    }

    // 单轮先处理无 task_id 的本地过期项，再按 task_id 分组轮询；同一 task_id 只请求一次。
    const pollOnce = async () => {
      if (disposed || polling) return
      polling = true
      try {
        useTaskCenterStore.getState().pruneExpiredTasks()
        const expiredTasks = useTaskCenterStore
          .getState()
          .tasks.filter(
            (task) =>
              !isTaskCenterImageTask(task) &&
              task.workspaceId === workspaceId &&
              Number(task.ownerUserId || 0) === ownerUserId &&
              task.taskId <= 0 &&
              Boolean(getTaskCenterExpirationReason(task)) &&
              !isLocallyManagedVideoTask(task),
          )
        for (const task of expiredTasks) {
          const reason = getTaskCenterExpirationReason(task)
          if (!reason || !getLatestEligibleTask(task)) continue
          try {
            const persisted = await persistTerminalState(task, 'failed', reason)
            if (!persisted) {
              handleStructuralSyncFailure(task, `${reason}（项目状态同步失败）`, true)
              continue
            }
            terminalSyncAttempts.delete(task.id)
            const updated = patchLatestEligibleTask(task, {
              status: 'failed',
              error: reason,
              updatedAt: Date.now(),
            })
            if (updated) notifyTerminalTask(updated)
          } catch {
            patchLatestEligibleTask(task, {
              status: task.status,
              error: `${reason}，正在同步项目状态`,
              updatedAt: task.updatedAt,
            })
          }
        }
        const candidates = useTaskCenterStore
          .getState()
          .tasks.filter(
            (task) =>
              !isTaskCenterImageTask(task) &&
              task.workspaceId === workspaceId &&
              Number(task.ownerUserId || 0) === ownerUserId &&
              task.taskId > 0 &&
              isTaskCenterActiveStatus(task.status) &&
              !isLocallyManagedVideoTask(task),
          )

        const groups = new Map<number, TaskCenterTask[]>()
        candidates.forEach((task) => groups.set(task.taskId, [...(groups.get(task.taskId) || []), task]))

        await runWithConcurrencyLimit([...groups], TASK_POLL_CONCURRENCY, async ([taskId, storedTasks]) => {
          if (disposed) return
          const eligibleTasks = storedTasks
            .map((task) => getLatestEligibleTask(task))
            .filter((task): task is TaskCenterTask => Boolean(task))
          if (!eligibleTasks.length) return

          // 同一后端 task_id 不应归属多个本地项目。遇到损坏/陈旧缓存时停止自动落库，避免串项目。
          if (eligibleTasks.length > 1) {
            eligibleTasks.forEach((task) => {
              const updated = patchLatestEligibleTask(task, {
                status: 'failed',
                error: '任务关联冲突，请进入原项目确认生成结果',
                updatedAt: Date.now(),
              })
              if (updated) notifyTerminalTask(updated)
            })
            return
          }
          const task = eligibleTasks[0]

          try {
            const payload = await getAiTask({ workspaceId, taskId })
            if (disposed) return
            const remote = unwrapTask(payload)
            const remoteTaskId = Number(remote?.id ?? remote?.task_id ?? remote?.taskId ?? 0) || 0
            const remoteOperationCode = String(remote?.operation_code ?? remote?.operationCode ?? '').trim()
            if (
              (remoteTaskId > 0 && remoteTaskId !== taskId) ||
              (remoteOperationCode && task.operationCode && remoteOperationCode !== task.operationCode)
            ) {
              const updated = patchLatestEligibleTask(task, {
                status: 'failed',
                error: '任务身份校验失败，请进入原项目确认',
                updatedAt: Date.now(),
              })
              if (updated) notifyTerminalTask(updated)
              return
            }
            const status = normalizeRemoteStatus(remote, task.status)
            const progress = readAiTaskProgress(remote)
            const rawRemoteUpdatedAt = readRemoteTimestamp(remote)
            const remoteUpdatedAt =
              rawRemoteUpdatedAt && rawRemoteUpdatedAt > task.updatedAt ? rawRemoteUpdatedAt : undefined

            if (status === 'succeeded') {
              let result: { url: string; assetId: number }
              try {
                result = await resolveTaskVideoResult(workspaceId, remote, taskId)
              } catch (error) {
                patchLatestEligibleTask(task, {
                  status: 'reconnecting',
                  progress: 99,
                  error: getBusinessErrorMessage(error, '视频已生成，媒体结果同步失败，正在重试'),
                })
                return
              }
              if (disposed) return
              if (!result.url && !result.assetId) {
                patchLatestEligibleTask(task, {
                  status: 'reconnecting',
                  progress: 99,
                  error: '视频已生成，正在同步媒体结果',
                  ...(remoteUpdatedAt === undefined ? {} : { updatedAt: remoteUpdatedAt }),
                })
                return
              }

              if (!getLatestEligibleTask(task)) return
              let persisted = false
              try {
                persisted =
                  task.scope === 'hot-copy'
                    ? await persistHotCopyResultToBackend({
                        projectId: task.projectId,
                        workspaceId,
                        url: result.url,
                        assetId: result.assetId,
                        taskId,
                        generationId: task.generationId,
                      })
                    : await persistVideoResultToBackend({
                        projectId: task.projectId,
                        workspaceId,
                        url: result.url,
                        assetId: result.assetId,
                        taskId,
                        genId: task.generationId,
                      })
              } catch (error) {
                patchLatestEligibleTask(task, {
                  status: 'reconnecting',
                  progress: 99,
                  error: getBusinessErrorMessage(error, '视频已生成，保存到项目失败，正在重试'),
                })
                return
              }
              if (disposed) return
              if (!persisted) {
                handleStructuralSyncFailure(task, '视频已生成，但无法写入当前项目')
                return
              }
              terminalSyncAttempts.delete(task.id)
              const updated = patchLatestEligibleTask(task, {
                status,
                progress: 100,
                resultUrl: result.url || task.resultUrl,
                resultAssetId: result.assetId || task.resultAssetId,
                error: undefined,
                updatedAt: Date.now(),
              })
              if (updated) notifyTerminalTask(updated)
              return
            }

            if (status === 'failed') {
              const error = readRemoteError(remote, '视频生成失败')
              if (!getLatestEligibleTask(task)) return
              let persisted = false
              try {
                persisted = await persistTerminalState(task, status, error)
              } catch (persistError) {
                patchLatestEligibleTask(task, {
                  status: 'reconnecting',
                  error: getBusinessErrorMessage(persistError, '任务已失败，正在同步项目状态'),
                })
                return
              }
              if (!persisted) {
                handleStructuralSyncFailure(task, `${error}（项目状态同步失败）`)
                return
              }
              terminalSyncAttempts.delete(task.id)
              const updated = patchLatestEligibleTask(task, {
                status,
                ...(progress === undefined ? {} : { progress }),
                error,
                updatedAt: remoteUpdatedAt || Date.now(),
              })
              if (updated) notifyTerminalTask(updated)
              return
            }

            if (status === 'cancelled') {
              if (!getLatestEligibleTask(task)) return
              let persisted = false
              try {
                persisted = await persistTerminalState(task, status)
              } catch (persistError) {
                patchLatestEligibleTask(task, {
                  status: 'reconnecting',
                  error: getBusinessErrorMessage(persistError, '任务已取消，正在同步项目状态'),
                })
                return
              }
              if (!persisted) {
                handleStructuralSyncFailure(task, '任务已取消，但项目状态同步失败')
                return
              }
              terminalSyncAttempts.delete(task.id)
              const updated = patchLatestEligibleTask(task, {
                status,
                ...(progress === undefined ? {} : { progress }),
                error: undefined,
                updatedAt: remoteUpdatedAt || Date.now(),
              })
              if (updated) notifyTerminalTask(updated)
              return
            }

            patchLatestEligibleTask(task, {
              status,
              ...(progress === undefined ? {} : { progress }),
              error: undefined,
              ...(remoteUpdatedAt === undefined ? {} : { updatedAt: remoteUpdatedAt }),
            })
          } catch (error) {
            if (disposed) return
            const message = getBusinessErrorMessage(error, '任务状态同步失败，正在重试')
            const httpStatus = Number((error as any)?.status ?? (error as any)?.response?.status ?? 0) || 0
            if (httpStatus === 401) {
              patchLatestEligibleTask(task, { status: 'reconnecting', error: '登录状态已变化，正在等待会话恢复' })
            } else if ([400, 403, 404, 410].includes(httpStatus)) {
              const terminalError = httpStatus === 404 || httpStatus === 410 ? '生成任务已失效' : message
              let persisted = false
              try {
                persisted = await persistTerminalState(task, 'failed', terminalError)
              } catch (persistError) {
                patchLatestEligibleTask(task, {
                  status: 'reconnecting',
                  error: getBusinessErrorMessage(persistError, `${terminalError}，正在同步项目状态`),
                })
                return
              }
              if (!persisted) {
                handleStructuralSyncFailure(task, `${terminalError}（项目状态同步失败）`)
                return
              }
              terminalSyncAttempts.delete(task.id)
              const updated = patchLatestEligibleTask(task, {
                status: 'failed',
                error: terminalError,
                updatedAt: Date.now(),
              })
              if (updated) notifyTerminalTask(updated)
            } else {
              patchLatestEligibleTask(task, { status: 'reconnecting', error: message })
            }
          }
        })
      } finally {
        polling = false
      }
    }

    const onFocus = () => void pollOnce()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void pollOnce()
    }

    void pollOnce()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void pollOnce()
    }, POLL_INTERVAL_MS)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      disposed = true
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [isAuthenticated, ownerUserId, workspaceId])

  return null
}
