/** 高清处理待接入协议。当前 Swagger 未提供这些路由；404/501 必须阻断下单。 */
import { requestBusinessJson } from './business'

export type HdKind = 'video' | 'image'
export type HdStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled'
export interface HdSource {
  node_id: string
  asset_id: number
  kind: HdKind
  name: string
}
export interface HdItem extends HdSource {
  eligible: boolean
  reason?: string
  source_spec: string
  /** 已按源件规格、模型和格式过滤，仅包含真正可以提升的目标。 */
  resolutions: string[]
  frame_rates: number[]
}
export interface HdTarget {
  resolution: string
  fps: number
}
export interface HdQuote {
  quote_id: string
  expires_at: string
  items: Array<{ node_id: string; asset_id: number; credits: number }>
  total_credits: number
  balance: number
  can_afford: boolean
  estimated_time?: string
  fps_multiplier?: number
}
export interface HdTask {
  id: string
  workspace_id: number
  canvas_id: number
  canvas_name: string
  source: HdSource
  source_spec: string
  target: HdTarget
  status: HdStatus
  stage?: string
  submitted_at: string
  started_at?: string
  completed_at?: string
  credits: number
  refund_status: 'none' | 'pending' | 'refunded'
  refunded_credits: number
  error?: string
  result?: {
    asset_id: number
    name: string
    spec: string
    width: number
    height: number
    review_policy: string
    canvas_delivery?: 'pending' | 'attached' | 'removed'
  }
}
export interface HdTaskPage {
  items: HdTask[]
  total: number
  stats: { total: number; active: number; completed: number; failed: number; refunded_credits: number }
  canvases: Array<{ id: number; name: string }>
}
const ROOT = '/api/v1/ai/hd'

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const raw = await requestBusinessJson(`${ROOT}${path}`, options)
  const value = raw && typeof raw === 'object' && 'data' in raw ? raw.data : raw
  if (!value || typeof value !== 'object') throw new Error('高清处理服务返回数据不完整，请稍后重试')
  return value as T
}
function post<T>(path: string, body: unknown, signal?: AbortSignal) {
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
}
export function preflightHd(workspaceId: number, canvasId: number, sources: HdSource[], signal?: AbortSignal) {
  return post<{ items: HdItem[] }>('/preflight', { workspace_id: workspaceId, canvas_id: canvasId, sources }, signal)
}
export function quoteHd(
  workspaceId: number,
  canvasId: number,
  items: HdSource[],
  target: HdTarget,
  signal?: AbortSignal,
) {
  return post<HdQuote>('/quotes', { workspace_id: workspaceId, canvas_id: canvasId, sources: items, target }, signal)
}
export function submitHd(workspaceId: number, canvasId: number, quoteId: string, idempotencyKey: string) {
  return post<{ tasks: HdTask[] }>('/batches', {
    workspace_id: workspaceId,
    canvas_id: canvasId,
    quote_id: quoteId,
    idempotency_key: idempotencyKey,
  })
}
export function listHdTasks(
  workspaceId: number,
  filters: { status?: string; kind?: string; canvas_id?: number; keyword?: string; page?: number } = {},
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({
    workspace_id: String(workspaceId),
    limit: '50',
    offset: String(((filters.page || 1) - 1) * 50),
  })
  for (const [key, value] of Object.entries(filters)) if (key !== 'page' && value) query.set(key, String(value))
  return request<HdTaskPage>(`/tasks?${query}`, { signal })
}
export function cancelHdTask(workspaceId: number, taskId: string) {
  return post<{ task: HdTask }>(`/tasks/${encodeURIComponent(taskId)}/cancel`, { workspace_id: workspaceId })
}
export function hdServiceError(error: unknown): string {
  const status = Number((error as { status?: number })?.status)
  if (status === 404 || status === 501) return '高清处理服务暂未接入，请联系管理员开通后重试'
  return error instanceof Error ? error.message : '高清处理请求失败，请稍后重试'
}
