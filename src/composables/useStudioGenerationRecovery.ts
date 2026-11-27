import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { getAiTaskId, getBusinessErrorMessage, listAiTasks, replayAiTaskSubmission } from '@/api/business'
import { getAuthRequestScope, isAuthRequestScopeCurrent } from '@/api/authRequestScope'
import { resumeShotImageGeneration } from '@/api/smartShotImage'
import { resumeFullVideo } from '@/api/smartVideo'
import type { StudioOperation } from '@/api/studioHistory'
import type { StudioResultBatch, StudioResultItem } from '@/components/studio/StudioResultFeed/StudioResultFeed'
import {
  isStudioGenerationRejected,
  isStudioMediaPending,
  isSameStudioGenerationIntent,
  readStudioGenerationIntent,
  readStudioGenerationIntents,
  readStudioErrorReceipt,
  readStudioSubmissionIdentity,
  STUDIO_TASK_SYNCING,
  STUDIO_MEDIA_PENDING,
  studioGenerationStorageKey,
  updateStudioGenerationIntent,
  type StudioGenerationIntent,
} from '@/utils/studioGenerationRecovery'
import { findResumableItems, preferLocalStudioBatches } from '@/utils/studioHistory'

const RECONCILE_INTERVAL_MS = 5_000
const MEDIA_RETRY_DELAY_MS = 30_000

export function useStudioGenerationRecovery(
  workspaceId: number,
  userId: number,
  batches: StudioResultBatch[],
  setBatches: Dispatch<SetStateAction<StudioResultBatch[]>>,
) {
  const key = studioGenerationStorageKey(workspaceId, userId)
  const [snapshot, setSnapshot] = useState<{ key: string; items: StudioGenerationIntent[] }>()
  const [retryingItems, setRetryingItems] = useState<ReadonlySet<string>>(() => new Set())
  const localItems = useRef(new Set<string>())
  const activeScope = useRef<{ key: string; signal: AbortSignal }>()
  const currentBatches = useRef(batches)
  useEffect(() => {
    currentBatches.current = batches
  }, [batches])

  const write = useCallback(
    (itemId: string, intent?: StudioGenerationIntent, expected?: StudioGenerationIntent) => {
      const items = updateStudioGenerationIntent(key, itemId, intent, expected)
      if (!items) return false
      if (activeScope.current?.key === key && !activeScope.current.signal.aborted) setSnapshot({ key, items })
      return true
    },
    [key],
  )

  const patchItem = useCallback(
    (batchId: string, itemId: string, patch: Partial<StudioResultItem>) => {
      setBatches((current) =>
        current.map((batch) =>
          batch.id === batchId
            ? { ...batch, items: batch.items.map((item) => (item.id === itemId ? { ...item, ...patch } : item)) }
            : batch,
        ),
      )
    },
    [setBatches],
  )

  const retry = useCallback(
    async (itemId: string, onError: (message: string) => void) => {
      const scope = activeScope.current
      if (scope?.key !== key || scope.signal.aborted || localItems.current.has(itemId)) return
      const { signal } = scope
      const authScope = getAuthRequestScope()
      localItems.current.add(itemId)
      setRetryingItems((previous) => new Set(previous).add(itemId))
      try {
        const pending = readStudioGenerationIntent(key, itemId)
        if (!pending?.submission || pending.taskId) return
        const resend = async () => {
          if (signal.aborted || !isAuthRequestScopeCurrent(authScope)) return
          const intent = readStudioGenerationIntent(key, itemId)
          if (!intent?.submission || intent.taskId || intent.idempotencyKey !== pending.idempotencyKey) return
          const { operation, idempotencyKey } = readStudioSubmissionIdentity(intent.submission, workspaceId)
          if (operation !== intent.operation || idempotencyKey !== intent.idempotencyKey) {
            throw new Error('原任务记录不匹配，无法重试')
          }
          let current = intent
          const accept = (task: unknown) => {
            if (signal.aborted || !isAuthRequestScopeCurrent(authScope)) return false
            const taskId = getAiTaskId(task)
            if (!taskId || (current.taskId && current.taskId !== taskId)) return false
            if (current.taskId === taskId) return true
            const next = { ...current, taskId, submission: undefined }
            if (!write(itemId, next, current)) return false
            current = next
            patchItem(intent.batch.id, itemId, { taskId, error: undefined })
            return true
          }
          try {
            accept(await replayAiTaskSubmission(intent.submission, signal, accept))
          } catch (error: unknown) {
            const receipt = readStudioErrorReceipt(error)
            if (!receipt || !accept(receipt)) throw error
            if (isStudioGenerationRejected(error, 2, receipt.taskId) && write(itemId, undefined, current)) {
              patchItem(intent.batch.id, itemId, {
                status: 'failed',
                error: getBusinessErrorMessage(error, '生成失败'),
              })
            }
          }
        }
        if (navigator.locks) {
          await navigator.locks.request(`${key}:${pending.operation}`, { ifAvailable: true }, async (lock) => {
            if (lock) await resend()
          })
        } else await resend()
      } catch (error: unknown) {
        if (!signal.aborted && isAuthRequestScopeCurrent(authScope)) {
          onError(getBusinessErrorMessage(error, '原请求尚未确认，请稍后再试'))
        }
      } finally {
        localItems.current.delete(itemId)
        if (!signal.aborted)
          setRetryingItems((previous) => {
            const next = new Set(previous)
            next.delete(itemId)
            return next
          })
      }
    },
    [key, patchItem, workspaceId, write],
  )

  useEffect(() => {
    if (!key) return
    const controller = new AbortController()
    const signal = controller.signal
    activeScope.current = { key, signal }
    const polling = new Set<number>()
    const mediaRetryAfter = new Map<number, number>()
    let lookingUp = false

    const load = () => {
      try {
        const records = readStudioGenerationIntents(key)
        setSnapshot({ key, items: records })
        if (!records.length) return records
        setBatches((current) => {
          const restored = new Map<string, StudioResultBatch>()
          for (const record of records) {
            const original = restored.get(record.batch.id) ?? current.find(({ id }) => id === record.batch.id)
            const items = [...(original?.items || [])]
            const index = items.findIndex(({ id }) => id === record.itemId)
            const previous = items[index]
            const message = record.mediaPending ? STUDIO_MEDIA_PENDING : STUDIO_TASK_SYNCING
            if (previous) {
              if (previous.status !== 'pending') continue
              if (previous.taskId === record.taskId && (!record.mediaPending || previous.error === message)) continue
              items[index] = { ...previous, taskId: record.taskId, error: message }
            } else
              items.push({
                id: record.itemId,
                status: 'pending',
                taskId: record.taskId,
                error: message,
              })
            restored.set(record.batch.id, { ...record.batch, items })
          }
          if (!restored.size) return current
          return [...current.filter((batch) => !restored.has(batch.id)), ...restored.values()].sort(
            (a, b) => a.createdAt - b.createdAt,
          )
        })
        return records
      } catch {
        return []
      }
    }

    const checkUnidentified = async (records: StudioGenerationIntent[]) => {
      if (lookingUp) return
      const unknown = records.filter((record) => !record.taskId && !localItems.current.has(record.itemId))
      if (!unknown.length) return
      lookingUp = true
      const authScope = getAuthRequestScope()
      try {
        await Promise.all(
          unknown.map(async (record) => {
            try {
              const response = await listAiTasks({
                workspaceId,
                operationCode: record.operation,
                idempotencyKey: record.idempotencyKey,
                limit: 1,
                signal,
              })
              if (signal.aborted || !isAuthRequestScopeCurrent(authScope) || localItems.current.has(record.itemId))
                return
              // Older servers ignore unknown filters and return an ordinary task page.
              if (
                response?.idempotency_lookup !== true ||
                !Array.isArray(response.items) ||
                response.items.length !== 1
              )
                return
              const taskId = getAiTaskId(response.items[0])
              if (!taskId) return
              if (write(record.itemId, { ...record, taskId, submission: undefined }, record))
                patchItem(record.batch.id, record.itemId, { taskId })
            } catch {
              // 查询失败或尚未建单时，保留原任务的幂等记录。
            }
          }),
        )
      } finally {
        lookingUp = false
      }
    }

    const tick = () => {
      const authScope = getAuthRequestScope()
      if (!isAuthRequestScopeCurrent(authScope)) return
      const pending = load()
      void checkUnidentified(pending)
      const current = preferLocalStudioBatches(currentBatches.current)
      const intentsByItem = new Map(pending.map((item) => [item.itemId, item]))
      const intentTaskIds = new Set(pending.map((intent) => intent.taskId).filter(Boolean))
      for (const item of findResumableItems(current, polling)) {
        const { batchId, itemId, taskId } = item
        const intent = intentsByItem.get(itemId)
        if (localItems.current.has(itemId) || (intent ? intent.taskId !== taskId : intentTaskIds.has(taskId))) continue
        if (polling.has(taskId) || (mediaRetryAfter.get(taskId) || 0) > Date.now()) continue
        polling.add(taskId)
        const batch = current.find(({ id }) => id === batchId)
        const isCurrent = () => {
          if (signal.aborted || !isAuthRequestScopeCurrent(authScope)) return false
          try {
            const latest = readStudioGenerationIntent(key, itemId)
            return intent ? isSameStudioGenerationIntent(latest, intent) : !latest
          } catch {
            return false
          }
        }
        const settle = (patch: Partial<StudioResultItem>) => {
          if (!isCurrent()) return
          try {
            if (intent && !write(itemId, undefined, intent)) return
          } catch {
            patchItem(batchId, itemId, { error: STUDIO_TASK_SYNCING })
            return
          }
          mediaRetryAfter.delete(taskId)
          patchItem(batchId, itemId, patch)
        }
        const promise =
          batch?.mode === 'image'
            ? resumeShotImageGeneration({ workspaceId, taskId, signal })
            : resumeFullVideo({
                workspaceId,
                taskId,
                signal,
                onProgress: (progress) => {
                  if (isCurrent()) patchItem(batchId, itemId, { progress })
                },
              })
        void promise
          .then(
            (result) => settle({ status: 'done', url: result.url, error: undefined }),
            (error: unknown) => {
              if (!isCurrent()) return
              if (isStudioMediaPending(error, taskId)) {
                mediaRetryAfter.set(taskId, Date.now() + MEDIA_RETRY_DELAY_MS)
                const next = intent && { ...intent, mediaPending: true as const, submission: undefined }
                try {
                  if (!intent || intent.mediaPending || write(itemId, next, intent)) {
                    patchItem(batchId, itemId, { error: STUDIO_MEDIA_PENDING })
                  }
                } catch {
                  patchItem(batchId, itemId, { error: STUDIO_MEDIA_PENDING })
                }
              } else if (isStudioGenerationRejected(error, 1, taskId)) {
                settle({ status: 'failed', error: getBusinessErrorMessage(error) || '生成失败' })
              } else {
                patchItem(batchId, itemId, { error: intent?.mediaPending ? STUDIO_MEDIA_PENDING : STUDIO_TASK_SYNCING })
              }
            },
          )
          .finally(() => polling.delete(taskId))
      }
    }

    const syncStorage = (event: StorageEvent) => {
      if (!event.key || event.key.startsWith(`${key}:`)) load()
    }
    window.addEventListener('storage', syncStorage)
    const timer = window.setInterval(tick, RECONCILE_INTERVAL_MS)
    tick()
    return () => {
      controller.abort()
      window.removeEventListener('storage', syncStorage)
      window.clearInterval(timer)
    }
  }, [key, patchItem, setBatches, workspaceId, write])

  const lockedOperations = new Set<StudioOperation>(
    snapshot?.key === key ? snapshot.items.filter((item) => !item.mediaPending).map((item) => item.operation) : [],
  )
  const retryableItems = new Set(
    snapshot?.key === key
      ? snapshot.items.flatMap((item) =>
          !item.taskId && item.submission && (!localItems.current.has(item.itemId) || retryingItems.has(item.itemId))
            ? [item.itemId]
            : [],
        )
      : [],
  )
  return { key, localItems, write, lockedOperations, retry, retryableItems, retryingItems }
}
