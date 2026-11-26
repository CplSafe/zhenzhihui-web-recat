/**
 * 创作台历史流的数据源：分页拉取本工作空间的 AI 生成任务。
 *
 * 走 GET /api/v1/ai/tasks（offset 分页，固定 created_at DESC）。只取创作台会产出的
 * operation：图片文生图/图生图与视频生成，避免把人脸检测、脚本改写这类中间任务
 * 也铺到用户的创作历史里。
 *
 * 后端一次只接受一个 operation_code，所以这里按 operation 并行拉取后在前端合并排序。
 */
import { listAiTasks } from './business'
import type { StudioHistoryTask } from '@/utils/studioHistory'

/** 创作台会产出、且应当出现在历史流里的 operation。 */
export const STUDIO_OPERATIONS = ['image.text_to_image', 'image.image_to_image', 'video.generate'] as const
export type StudioOperation = (typeof STUDIO_OPERATIONS)[number]
export type StudioHistoryOffsets = Partial<Record<StudioOperation, number>>

export const FIRST_STUDIO_HISTORY_OFFSETS: StudioHistoryOffsets = {
  'image.text_to_image': 0,
  'image.image_to_image': 0,
  'video.generate': 0,
}

/** 一页历史任务。 */
export interface StudioHistoryPage {
  /** 本页任务，按 created_at 倒序（新 → 旧），与后端一致。 */
  items: StudioHistoryTask[]
  /** 只包含未结束或本次失败的流，各自从下一条尚未读取的位置继续。 */
  nextOffsets: StudioHistoryOffsets
  failedOperations: StudioOperation[]
}

/** 从后端分页响应中稳妥读出 items 数组。 */
function readItems(payload: any): StudioHistoryTask[] {
  const items = payload?.items ?? payload?.data?.items
  return Array.isArray(items) ? items : []
}

/**
 * 拉取一页历史任务。
 *
 * 各流独立分页。成功才推进该流的偏移，失败保留原位置供重试。
 */
export async function fetchStudioHistoryPage({
  workspaceId,
  offsets = FIRST_STUDIO_HISTORY_OFFSETS,
  limit = 12,
  signal,
}: {
  workspaceId: number
  offsets?: StudioHistoryOffsets
  limit?: number
  signal?: AbortSignal
}): Promise<StudioHistoryPage> {
  const pages = await Promise.all(
    STUDIO_OPERATIONS.flatMap((operationCode) => {
      const offset = offsets[operationCode]
      if (offset === undefined) return []
      return [fetchStream(operationCode, offset)]
    }),
  )

  async function fetchStream(operationCode: StudioOperation, offset: number) {
    try {
      const payload = await listAiTasks({ workspaceId, operationCode, limit, offset, signal })
      const items = readItems(payload)
      return { operationCode, items, nextOffset: items.length >= limit ? offset + limit : undefined, failed: false }
    } catch {
      return { operationCode, items: [], nextOffset: offset, failed: true }
    }
  }

  const nextOffsets: StudioHistoryOffsets = {}
  const failedOperations: StudioOperation[] = []
  for (const { operationCode, nextOffset, failed } of pages) {
    if (nextOffset !== undefined) nextOffsets[operationCode] = nextOffset
    if (failed) failedOperations.push(operationCode)
  }
  const merged = pages
    .flatMap(({ items }) => items)
    .sort((a, b) => (Date.parse(String(b.created_at || '')) || 0) - (Date.parse(String(a.created_at || '')) || 0))

  return { items: merged, nextOffsets, failedOperations }
}
