import type { StudioRun } from './studio'

export type DoudouState = 'idle' | 'thinking' | 'generating' | 'waiting' | 'complete' | 'paused' | 'error' | 'offline'

export const doudouLabels: Record<DoudouState, string> = {
  idle: '豆豆准备好了',
  thinking: '豆豆正在思考',
  generating: '豆豆正在制作素材',
  waiting: '豆豆在等你确认',
  complete: '豆豆已完成本轮创作',
  paused: '豆豆已暂停',
  error: '豆豆需要你的帮助',
  offline: '豆豆在等待实时连接',
}

/** Presentation only: use task receipts, never infer progress from assistant prose. */
export function doudouState(run?: StudioRun | null, disconnected = false): DoudouState {
  if (!run) return 'idle'
  if (run.status === 'error') return 'error'
  if (run.status === 'paused' || run.stop) return 'paused'
  if (run.status === 'waiting') return 'waiting'
  if (run.status === 'complete') return 'complete'
  if (disconnected) return 'offline'
  if (
    run.batches?.some(
      (batch) =>
        !batch.cancelled && Object.values(batch.nodes).some((node) => ['submitting', 'running'].includes(node.status)),
    )
  )
    return 'generating'

  // Later receipts supersede earlier pending receipts for the same task.
  const tasks = new Map<string, { tool?: string; status: string; merge: boolean; at?: number }>()
  for (const event of run.events) {
    const data = event.data
    const key =
      event.kind === 'merge' && data?.merge_id != null
        ? `merge:${data.merge_id}`
        : data?.task_id != null
          ? `task:${data.task_id}`
          : null
    if (key && data && typeof data.status === 'string') {
      const previous = tasks.get(key)
      // Event upserts retain their original list position, but update their timestamp.
      if (previous?.at != null && event.at != null && previous.at > event.at) continue
      tasks.set(key, {
        tool: data.tool || previous?.tool,
        status: data.status,
        merge: event.kind === 'merge' || !!previous?.merge,
        at: event.at,
      })
    }
  }
  const active = ['pending', 'queued', 'submitted', 'submitting', 'running', 'processing']
  return [...tasks.values()].some(
    (task) =>
      active.includes(task.status) &&
      (task.merge || ['model.generate_image', 'model.generate_video'].includes(task.tool || '')),
  )
    ? 'generating'
    : 'thinking'
}
