import { requestBusinessJson } from './business'

export interface ManualVideoInput {
  workspace_id: number
  model_version_id: number
  operation_code: string
  prompt: string
  params: { duration: number; [key: string]: unknown }
  input_assets: Array<{ asset_id: number; role: 'image' | 'video' | 'audio' }>
}

export interface ManualVideoTask {
  id: number
  operation_code?: string
  status: string
  poll_after_ms?: number
  estimated_cost?: number
  actual_cost?: number
  created_at?: string
  deadline_at?: string | null
  parent_task_id?: number | null
  outputs?: Array<{ type: string; asset_id?: number; url?: string }>
  error_message?: string
}

export interface ManualVideoEstimate {
  estimated_cost: number
  balance: number
  frozen: number
  can_afford: boolean
}

export interface ManualVideoModel {
  id: number
  provider?: string
  model?: string
  enabled?: boolean
  display_name?: string
  operation_codes?: string[]
  params_schema?: unknown
}

/** video.t1 可能是目录模型名，也可能是操作码；提交操作必须由目录明确声明。 */
export function getManualVideoOperation(model: ManualVideoModel): string | null {
  if (!Number.isSafeInteger(model.id) || model.id <= 0 || model.enabled === false) return null
  const operations = Array.isArray(model.operation_codes) ? model.operation_codes : []
  if (operations.includes('video.t1')) return 'video.t1'
  if (model.model === 'video.t1' && operations.includes('video.generate')) return 'video.generate'
  return null
}

const json = (body: unknown, signal?: AbortSignal): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
  signal,
})

/** 原样返回目录，具体可用性和 schema 由调用方按后端响应处理。 */
export function listVideoModels(workspaceId: number, signal?: AbortSignal) {
  const query = new URLSearchParams({ workspace_id: String(workspaceId), capability: 'video' })
  return requestBusinessJson<unknown>(`/api/v1/ai/models?${query}`, { signal })
}

export function listManualVideoHistory(workspaceId: number, signal?: AbortSignal, offset = 0) {
  const query = new URLSearchParams({
    workspace_id: String(workspaceId),
    mine: 'true',
    operation_code: 'video.t1',
    limit: '20',
    offset: String(offset),
  })
  // 此列表是混合任务，不能根据状态推断是否人工视频。
  return requestBusinessJson<{ items: ManualVideoTask[]; total?: number }>(`/api/v1/ai/tasks?${query}`, { signal })
}

export function getManualVideoDownloadUrl(workspaceId: number, assetId: number, signal?: AbortSignal) {
  const query = new URLSearchParams({ workspace_id: String(workspaceId) })
  return requestBusinessJson<{ download_url: string }>(`/api/v1/assets/${assetId}/download-url?${query}`, { signal })
}

/** 保留调用方的请求快照与幂等键；不在网络失败时隐式生成新键。 */
export function createManualVideoTask(input: ManualVideoInput & { idempotency_key: string }, signal?: AbortSignal) {
  return requestBusinessJson<ManualVideoTask>('/api/v1/ai/tasks', json(input, signal))
}

export function estimateManualVideoTask(input: ManualVideoInput, signal?: AbortSignal) {
  return requestBusinessJson<ManualVideoEstimate>('/api/v1/ai/tasks/estimate-cost', json(input, signal))
}

export function getManualVideoTask(workspaceId: number, taskId: number, signal?: AbortSignal) {
  const query = new URLSearchParams({ workspace_id: String(workspaceId) })
  return requestBusinessJson<ManualVideoTask>(`/api/v1/ai/tasks/${taskId}?${query}`, { signal })
}

export function reviseManualVideoTask(
  taskId: number,
  input: { workspace_id: number; idempotency_key: string; instruction: string },
  signal?: AbortSignal,
) {
  return requestBusinessJson<ManualVideoTask>(`/api/v1/ai/tasks/${taskId}/revisions`, json(input, signal))
}

export function cancelManualVideoTask(workspaceId: number, taskId: number, signal?: AbortSignal) {
  const query = new URLSearchParams({ workspace_id: String(workspaceId) })
  return requestBusinessJson<ManualVideoTask>(`/api/v1/ai/tasks/${taskId}/cancel?${query}`, {
    method: 'POST',
    signal,
  })
}

export function manualVideoPollDelay(task: ManualVideoTask): number | null {
  if (['succeeded', 'failed', 'cancelled'].includes(task.status) || task.poll_after_ms === 0) return null
  return typeof task.poll_after_ms === 'number' && Number.isFinite(task.poll_after_ms) && task.poll_after_ms > 0
    ? task.poll_after_ms
    : null
}
