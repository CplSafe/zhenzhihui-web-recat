import { useEffect, useState } from 'react'
import { getManualVideoTask, listManualVideoHistory, type ManualVideoTask } from '@/api/manualVideo'
import styles from './ManualVideoFlow.module.css'

/** 混合任务列表中只展示服务端明确标识为 video.t1 的记录。 */
export default function ManualVideoHistory({
  ownerId,
  workspaceId,
  onOpen,
  includeLocal = false,
}: {
  ownerId: number
  workspaceId: number
  onOpen: (id: number) => void
  includeLocal?: boolean
}) {
  const [tasks, setTasks] = useState<ManualVideoTask[]>([])
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!ownerId || !workspaceId) return
    const controller = new AbortController()
    if (offset === 0) setTasks([])
    setError('')
    setLoading(true)
    if (includeLocal && offset === 0) {
      try {
        const ids: unknown = JSON.parse(localStorage.getItem(`zzh.manual.tasks.${ownerId}.${workspaceId}`) || '[]')
        if (Array.isArray(ids)) {
          const valid = ids.filter((id): id is number => Number.isSafeInteger(id) && id > 0)
          setTasks(valid.map((id) => ({ id, status: '查看状态' })))
          void Promise.allSettled(valid.map((id) => getManualVideoTask(workspaceId, id, controller.signal))).then(
            (results) => {
              if (controller.signal.aborted) return
              setTasks((old) =>
                old.map((task) => {
                  const index = valid.indexOf(task.id)
                  const result = results[index]
                  return result?.status === 'fulfilled' ? result.value : task
                }),
              )
            },
          )
        }
      } catch {
        /* ignore invalid cache */
      }
    }
    void listManualVideoHistory(workspaceId, controller.signal, offset)
      .then((result) => {
        if (!controller.signal.aborted)
          setTasks((old) => {
            const remote = (Array.isArray(result?.items) ? result.items : []).filter(
              (item) => item.operation_code === 'video.t1' && Number.isSafeInteger(item.id) && item.id > 0,
            )
            return [...old, ...remote.filter((item) => !old.some((entry) => entry.id === item.id))]
          })
        if (!controller.signal.aborted) {
          const count = Array.isArray(result?.items) ? result.items.length : 0
          setHasMore(typeof result.total === 'number' ? offset + count < result.total && count > 0 : count >= 20)
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '历史任务加载失败')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [ownerId, workspaceId, attempt, includeLocal, offset])
  if (!tasks.length && !error && !loading && !hasMore) return null
  return (
    <div className={styles.knownTasks}>
      <b>历史精制任务</b>
      {loading && <span role="status">正在加载历史任务…</span>}
      {error && (
        <span role="alert">
          历史任务加载失败：{error}{' '}
          <button type="button" onClick={() => setAttempt((v) => v + 1)}>
            重试
          </button>
        </span>
      )}
      {tasks.map((task) => (
        <button key={task.id} type="button" onClick={() => onOpen(task.id)}>
          任务 #{task.id} ·{' '}
          {(
            {
              awaiting_manual: '待制作',
              manual_processing: '精制中',
              succeeded: '已交付',
              failed: '制作失败',
              cancelled: '已取消',
            } as Record<string, string>
          )[task.status] || task.status}
        </button>
      ))}
      {hasMore && (
        <button type="button" disabled={loading || !!error} onClick={() => setOffset((v) => v + 20)}>
          加载更多精制任务
        </button>
      )}
    </div>
  )
}
