import { requestBusinessJson } from './business'
import { isAllowedUploadUrl } from '@/utils/uploadUrlSafety'

export interface PromoMaterial {
  id: number
  status: string
  role?: 'footage' | 'logo' | 'supplement'
  low_resolution?: boolean
  name?: string
  mime_type?: string
  size_bytes?: number
}

export interface PromoConfig {
  enabled: boolean
  entry_name: string
  duration_options_seconds: number[]
  ratio_options: string[]
  resolution_options: string[]
  allowed_mime: string[]
  max_file_bytes: number
  max_total_bytes: number
  max_files: number
  footage_min_count: number
  offline_fallback: boolean
  price_show: boolean
  manual_quote_required: boolean
  service_tel: string
  sla_days?: number
  rework_days?: number
  rework_window_days?: number
  authorization_text: string
  acknowledgement_text: string
  authorization_version: string
}

export interface PromoOrder {
  id: number
  task_id: number
  company?: string
  workspace_id?: number
  delivered_at?: string | null
  duration_seconds?: number
  resolution?: string
  status: string
  billing_status: string
  promised_date?: string | null
  is_overdue: boolean
  first_delivered_at: string | null
  delivered_material_id?: number | null
  can_rework: boolean
  rework_status?: string | null
  rework_text?: string | null
  rework_reply?: string | null
}

export interface PromoQuoteInput {
  intake_token: string
  duration_seconds: number
  ratio: string
  resolution: string
}

export interface PromoQuote {
  base_cost: number
  service_cost: number
  total_cost: number
  promised_date?: string | null
  config_hash: string
  price_show?: boolean
  manual_quote_required?: boolean
}

export interface PromoOrderInput extends PromoQuoteInput {
  idempotency_key: string
  config_hash: string
  company: string
  contact: string
  phone: string
  scenario: 'government_corporate' | 'product_launch' | 'investment_financing'
  narration: 'both' | 'subtitles' | 'narration' | 'none'
  brief: string
  reference_url: string
  authorized: boolean
  acknowledged: boolean
  authorization_version: string
}

export interface PromoUploadTicket {
  material: PromoMaterial
  url: string
  form_fields: Record<string, string>
  expires_at: string
}

const json = (body: unknown, signal?: AbortSignal): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
  signal,
})

export const getPromoConfig = (signal?: AbortSignal) =>
  requestBusinessJson<PromoConfig>('/api/v1/promo/config', { signal })
export const createPromoIntake = (workspaceId: number, signal?: AbortSignal) =>
  requestBusinessJson<{ token: string }>('/api/v1/promo/intakes', json({ workspace_id: workspaceId }, signal))
export const getPromoIntake = (token: string, signal?: AbortSignal) =>
  requestBusinessJson<{ intake: unknown; materials: PromoMaterial[] }>(
    `/api/v1/promo/intakes/${encodeURIComponent(token)}`,
    { signal },
  )
export const registerPromoOffline = (token: string, signal?: AbortSignal) =>
  requestBusinessJson(`/api/v1/promo/intakes/${encodeURIComponent(token)}/offline`, { method: 'POST', signal })
export const createPromoUpload = (
  input: {
    intake_token: string
    role: 'footage' | 'logo' | 'supplement'
    name: string
    mime_type: string
    size_bytes: number
  },
  signal?: AbortSignal,
) => requestBusinessJson<PromoUploadTicket>('/api/v1/promo/uploads', json(input, signal))
export const retryPromoUpload = (id: number, signal?: AbortSignal) =>
  requestBusinessJson<PromoUploadTicket>(`/api/v1/promo/materials/${id}/retry`, { method: 'POST', signal })
export const completePromoUpload = (id: number, signal?: AbortSignal) =>
  requestBusinessJson<PromoMaterial>(`/api/v1/promo/materials/${id}/complete`, { method: 'POST', signal })
export const deletePromoMaterial = (id: number, signal?: AbortSignal) =>
  requestBusinessJson(`/api/v1/promo/materials/${id}`, { method: 'DELETE', signal })
export const getPromoMaterialDownload = (id: number, signal?: AbortSignal) =>
  requestBusinessJson<{ download_url: string }>(`/api/v1/promo/materials/${id}/download`, { signal })
export const quotePromo = (input: PromoQuoteInput, signal?: AbortSignal) =>
  requestBusinessJson<PromoQuote>('/api/v1/promo/quote', json(input, signal))
export const createPromoOrder = (input: PromoOrderInput, signal?: AbortSignal) =>
  requestBusinessJson<PromoOrder>('/api/v1/promo/orders', json(input, signal))
export const listPromoOrders = (limit = 20, offset = 0, signal?: AbortSignal) => {
  const query = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  return requestBusinessJson<{
    items: PromoOrder[]
    total: number
    limit: number
    offset: number
    has_unfinished: boolean
  }>(`/api/v1/promo/orders?${query}`, { signal })
}
export const listPromoTasks = (workspaceId: number, signal?: AbortSignal, offset = 0) => {
  const query = new URLSearchParams({
    workspace_id: String(workspaceId),
    task_type: 'promo_t5',
    mine: 'true',
    limit: '100',
    offset: String(offset),
  })
  return requestBusinessJson<{ items: Array<{ order_type?: string; promo_order_id?: number }>; total?: number }>(
    `/api/v1/ai/tasks?${query}`,
    { signal },
  )
}

/** 订单列表按用户返回，缺少空间标识时通过当前空间任务验证归属。 */
export async function getWorkspacePromoOrderIds(workspaceId: number, signal?: AbortSignal): Promise<Set<number>> {
  const ids = new Set<number>()
  let offset = 0
  while (true) {
    const page = await listPromoTasks(workspaceId, signal, offset)
    if (!Array.isArray(page.items)) throw new Error('无法确认宣传片订单所属空间')
    for (const task of page.items) {
      if (task.order_type === 'promo_t5' && Number.isSafeInteger(task.promo_order_id)) ids.add(task.promo_order_id!)
    }
    offset += page.items.length
    if (!page.items.length || (typeof page.total === 'number' ? offset >= page.total : page.items.length < 100)) break
  }
  return ids
}

export function promoOrderBelongsToWorkspace(order: PromoOrder, workspaceId: number, ids: Set<number>): boolean {
  return order.workspace_id != null ? order.workspace_id === workspaceId : ids.has(order.id)
}
export const getPromoOrder = (id: number, signal?: AbortSignal) =>
  requestBusinessJson<{ order: PromoOrder; materials: PromoMaterial[] }>(`/api/v1/promo/orders/${id}`, { signal })
export const reworkPromoOrder = (id: number, text: string, signal?: AbortSignal) =>
  requestBusinessJson(`/api/v1/promo/orders/${id}/rework`, json({ text }, signal))
export const refundPromoOrder = (id: number, signal?: AbortSignal) =>
  requestBusinessJson(`/api/v1/promo/orders/${id}/refund`, json({ confirmed: true }, signal))

export function canRefundPromoOrder(order: PromoOrder): boolean {
  return order.is_overdue === true && order.first_delivered_at === null && order.billing_status === 'frozen'
}

/** 只发送存储表单，不携带业务认证；拒绝不受信任地址及重定向。 */
export async function uploadPromoFile(ticket: PromoUploadTicket, file: File, signal?: AbortSignal): Promise<void> {
  const allowedHostPatterns = [
    /\.aliyuncs\.com$/i,
    /\.myqcloud\.com$/i,
    /\.amazonaws\.com$/i,
    /\.tos-cn-[a-z0-9-]+\.volces\.com$/i,
  ]
  const extraAllowedOrigins = String(import.meta.env.VITE_ZZH_ALLOWED_UPLOAD_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  if (
    !isAllowedUploadUrl(ticket.url, {
      pageOrigin: globalThis.location?.origin || '',
      allowAnyHttp: import.meta.env.DEV,
      allowedHostPatterns: [...allowedHostPatterns, ...extraAllowedOrigins],
    })
  ) {
    throw new Error('素材上传地址不在受信任的存储域名列表中')
  }
  const body = new FormData()
  for (const [key, value] of Object.entries(ticket.form_fields)) body.append(key, value)
  body.append('file', file)
  const response = await fetch(ticket.url, { method: 'POST', body, credentials: 'omit', redirect: 'error', signal })
  if (!response.ok) throw new Error(`素材上传失败 (${response.status})`)
}
