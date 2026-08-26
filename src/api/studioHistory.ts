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

/** 一页历史任务。 */
export interface StudioHistoryPage {
  /** 本页任务，按 created_at 倒序（新 → 旧），与后端一致。 */
  items: StudioHistoryTask[]
  /** 是否还有更早的历史。 */
  hasMore: boolean
}

/** 从后端分页响应中稳妥读出 items 数组。 */
function readItems(payload: any): StudioHistoryTask[] {
  const items = payload?.items ?? payload?.data?.items
  return Array.isArray(items) ? items : []
}

/**
 * 拉取一页历史任务。
 *
 * offset 对每个 operation 各自独立：三条流按同一 offset 取同样多的条数，
 * 合并后按创建时间倒序。这样「继续往前翻」在每条流上都不会漏记录。
 */
export async function fetchStudioHistoryPage({
  workspaceId,
  offset = 0,
  limit = 12,
  signal,
}: {
  workspaceId: number
  offset?: number
  limit?: number
  signal?: AbortSignal
}): Promise<StudioHistoryPage> {
  const pages = await Promise.all(
    STUDIO_OPERATIONS.map(async (operationCode) => {
      try {
        const payload = await listAiTasks({ workspaceId, operationCode, limit, offset, signal })
        return readItems(payload)
      } catch {
        // 单条 operation 拉取失败不该让整页历史空掉：其余 operation 的结果照常展示。
        return [] as StudioHistoryTask[]
      }
    }),
  )

  // 任一 operation 还能满页返回，就说明历史没到底。
  const hasMore = pages.some((items) => items.length >= limit)
  const merged = pages
    .flat()
    .sort((a, b) => (Date.parse(String(b.created_at || '')) || 0) - (Date.parse(String(a.created_at || '')) || 0))

  return { items: merged, hasMore }
}
