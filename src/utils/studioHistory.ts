/**
 * 创作台历史流的纯逻辑层：把后端 AI 任务转成右侧结果流的批次结构。
 *
 * 不发请求、不读全局状态，只做形状转换与分页合并，便于单测覆盖。
 *
 * 方向约定（用户决策 2026-08-26）：页面按「聊天式」排列——旧的在上、新的在下，
 * 往上滚动加载更早的历史。后端 GET /api/v1/ai/tasks 固定按 created_at DESC 返回，
 * 所以每页都要反转后再拼到已有列表的**前面**。
 */
import type { StudioResultBatch, StudioResultItem } from '@/components/studio/StudioResultFeed/StudioResultFeed'
import type { StudioMode } from './studioParams'

/** 后端 taskPublicView 中历史流用得到的字段。 */
export interface StudioHistoryTask {
  id: number
  status: string
  outputs?: { type?: string; asset_id?: number; url?: string; mime_type?: string }[]
  error_message?: string
  poll_after_ms?: number
  prompt?: string
  operation_code?: string
  params?: { ratio?: string; resolution?: string; duration_sec?: number }
  created_at?: string
}

/** 后端认定的终态；与 ai.IsFinalStatus 对齐。 */
const FINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled', 'canceled', 'expired', 'payment_failed'])
const SUCCESS_STATUS = 'succeeded'

/** 任务是否已到终态（终态不再轮询）。 */
export function isFinalTaskStatus(status: string): boolean {
  return FINAL_STATUSES.has(
    String(status || '')
      .trim()
      .toLowerCase(),
  )
}

/**
 * 判定这条任务属于图片还是视频。
 *
 * 优先看产物类型（最准，直接反映拿到的是什么），没有产物（生成中/失败）时退回
 * operation_code 前缀。两者都缺失时按图片处理——图片是更保守的占位形态。
 */
export function taskMode(task: StudioHistoryTask): StudioMode {
  const outputType = task.outputs?.find((output) => output.type === 'video' || output.type === 'image')?.type
  if (outputType === 'video' || outputType === 'image') return outputType
  return String(task.operation_code || '').startsWith('video.') ? 'video' : 'image'
}

/** 把后端产物解析成可渲染地址：优先用稳定的素材中心地址，其次才是会过期的 provider URL。 */
function outputUrl(output: { asset_id?: number; url?: string }, workspaceId: number): string {
  const assetId = Number(output.asset_id || 0)
  if (assetId > 0 && workspaceId > 0) return `/api/v1/assets/${assetId}/download?workspace_id=${workspaceId}`
  return String(output.url || '')
}

/** 展示用的参数摘要，如「1080p · 5s · 16:9」；缺失项自动略过。 */
export function formatHistorySummary(params: StudioHistoryTask['params']): string {
  if (!params) return ''
  return [params.resolution, params.duration_sec ? `${params.duration_sec}s` : '', params.ratio]
    .filter(Boolean)
    .join(' · ')
}

/**
 * 单个历史任务 → 结果流批次。
 *
 * 一个任务对应一个批次：失败任务没有产物，仍要造一条 failed 产物占位，
 * 否则批次里空无一物，用户看不出这次生成发生过什么。
 */
export function toHistoryBatch(task: StudioHistoryTask, workspaceId: number): StudioResultBatch {
  const mode = taskMode(task)
  const status = String(task.status || '')
    .trim()
    .toLowerCase()
  const createdAt = Date.parse(String(task.created_at || '')) || 0

  const urls = (task.outputs || []).map((output) => outputUrl(output, workspaceId)).filter(Boolean)
  let items: StudioResultItem[]
  if (urls.length) {
    items = urls.map((url, index) => ({
      id: `task-${task.id}-out-${index}`,
      status: 'done' as const,
      url,
    }))
  } else if (isFinalTaskStatus(status)) {
    // 终态但没有产物：失败、取消或过期，用一条失败占位说明原因。
    items = [
      {
        id: `task-${task.id}-out-0`,
        status: 'failed' as const,
        error: task.error_message || (status === SUCCESS_STATUS ? '产物已失效' : '生成失败'),
      },
    ]
  } else {
    // 未完成的任务：把 task_id 带到产物上，页面据此续轮询到终态。
    items = [{ id: `task-${task.id}-out-0`, status: 'pending' as const, taskId: task.id }]
  }

  return {
    // 批次 id 由 task_id 派生，历史翻页据此去重。
    id: `task-${task.id}`,
    mode,
    prompt: String(task.prompt || ''),
    summary: formatHistorySummary(task.params),
    ratio: String(task.params?.ratio || ''),
    createdAt,
    items,
  }
}

/**
 * 把一页任务转成批次并按「旧 → 新」排列。
 *
 * 后端返回 created_at DESC（新 → 旧），页面要旧在上，所以整页反转。
 */
export function toHistoryBatches(tasks: readonly StudioHistoryTask[], workspaceId: number): StudioResultBatch[] {
  return tasks
    .filter((task) => Number(task?.id || 0) > 0)
    .map((task) => toHistoryBatch(task, workspaceId))
    .reverse()
}

/** 一条待续轮询的产物：定位到具体批次内的具体产物。 */
export interface ResumableItem {
  batchId: string
  itemId: string
  taskId: number
}

/**
 * 找出需要续轮询的视频产物。
 *
 * 逐条产物而非逐个批次：一次生成 N 个视频会并发创建 N 个独立任务，
 * 按批次找只会认领其中一个，其余产物刷新后永远停在「生成中」。
 * claimed 里的任务已被认领（本次会话正在轮询，或上一轮已接手），跳过以免重复轮询。
 */
export function findResumableItems(
  batches: readonly StudioResultBatch[],
  claimed: ReadonlySet<number>,
): ResumableItem[] {
  const resumable: ResumableItem[] = []
  batches.forEach((batch) => {
    if (batch.mode !== 'video') return
    batch.items.forEach((item) => {
      const taskId = Number(item.taskId || 0)
      if (item.status !== 'pending' || taskId <= 0 || claimed.has(taskId)) return
      resumable.push({ batchId: batch.id, itemId: item.id, taskId })
    })
  })
  return resumable
}

/**
 * 把更早的一页拼到已有列表前面，按批次 id 去重。
 *
 * 去重是必需的：offset 分页在「有新任务插到头部」时会把同一条记录推到下一页，
 * 不去重就会出现重复条目。已在列表里的条目保留现状（可能带着本地更新的进度），
 * 不被历史快照覆盖。
 */
export function prependHistoryBatches(
  current: readonly StudioResultBatch[],
  older: readonly StudioResultBatch[],
): StudioResultBatch[] {
  const seen = new Set(current.map((batch) => batch.id))
  const fresh = older.filter((batch) => !seen.has(batch.id))
  return fresh.length ? [...fresh, ...current] : [...current]
}
