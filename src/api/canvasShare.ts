/**
 * 无限画布分享 API 客户端。
 *
 * 对齐后端 swagger 的三组接口：
 *   GET/POST/DELETE /api/v1/canvases/{id}/share   —— 画布所有者查询 / 开启（重新生成）/ 关闭分享
 *   GET /api/v1/canvas-shares/{token}             —— 匿名读取公开画布
 *   GET /api/v1/canvas-shares/{token}/elements    —— 匿名分页读取公开画布元素
 *
 * 前两组的响应体在 swagger 里是通用的 response.Response（data 未展开），
 * 因此 token / 过期时间这些字段按候选键名容错解析，读不到就当作「未分享」，
 * 而不是把一个猜出来的 URL 交给用户去发给别人。
 */
import { requestBusinessJson } from './business'

/** 画布的分享状态。未开启分享时 token 为空串。 */
export interface CanvasShareState {
  /** 分享口令；空串表示当前未开启分享。 */
  token: string
  /** 后端直接给出的完整分享链接；没给时由前端按当前站点拼。 */
  url: string
  /** 过期时间（ISO 字符串）；空串表示长期有效。 */
  expiresAt: string
  /** 后端返回的状态字段，原样保留用于展示与排查。 */
  status: string
}

/** 公开画布的基本信息（对齐 httpapi.publicCanvasShareView）。 */
export interface PublicCanvasShare {
  title: string
  status: string
  revision: number
  schemaVersion: number
  coverUrl: string
  previewUrl: string
  createdAt: string
  updatedAt: string
  lastSavedAt: string
}

/** 匿名读取到的一页画布元素。 */
export interface PublicCanvasElementsPage {
  elements: unknown[]
  nextCursor: string
  hasMore: boolean
  schemaVersion?: number
  state?: unknown
}

function requirePositiveInteger(value: unknown, message: string): number {
  const num = Math.floor(Number(value))
  if (!Number.isSafeInteger(num) || num <= 0) throw new Error(message)
  return num
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** 取出 data 层；后端有时把负载直接放在顶层，两种都认。 */
function unwrap(payload: unknown): Record<string, unknown> {
  if (!isRecord(payload)) return {}
  const data = payload.data
  return isRecord(data) ? data : payload
}

function readText(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return ''
}

/**
 * 把响应解析成分享状态。
 *
 * token 是这套功能唯一不可缺的字段：没有它就没有可分享的链接。
 * 解析不到时返回空状态（视作未分享），绝不用一个猜出来的值拼链接——
 * 用户会把那个链接发给别人，打不开时排查成本远高于这里直接显示「未开启」。
 */
export function parseCanvasShareState(payload: unknown): CanvasShareState {
  const data = unwrap(payload)
  const share = isRecord(data.share) ? data.share : data
  const token = readText(share, 'token', 'share_token', 'shareToken', 'code', 'share_code')
  const url = readText(share, 'url', 'share_url', 'shareUrl', 'link', 'share_link')
  const expiresAt = readText(share, 'expires_at', 'expiresAt', 'expire_at', 'expired_at')
  const status = readText(share, 'status', 'state')
  return { token, url, expiresAt, status }
}

/** 查询画布当前的分享状态；未开启分享时返回空 token。 */
export async function getCanvasShare({
  workspaceId,
  canvasId,
}: {
  workspaceId: number
  canvasId: number
}): Promise<CanvasShareState> {
  const wsId = requirePositiveInteger(workspaceId, '工作空间 ID 无效')
  const id = requirePositiveInteger(canvasId, '画布 ID 无效')
  const payload = await requestBusinessJson<unknown>(`/api/v1/canvases/${id}/share?workspace_id=${wsId}`)
  return parseCanvasShareState(payload)
}

/**
 * 开启分享，或对已分享的画布重新生成口令。
 *
 * @param expiresAt 过期时间（ISO 字符串）。留空表示长期有效——
 *   后端 createCanvasShareRequest 里 expires_at 非必填，不传即由后端决定默认策略，
 *   前端不替它编一个默认有效期。
 */
export async function createCanvasShare({
  workspaceId,
  canvasId,
  expiresAt = '',
}: {
  workspaceId: number
  canvasId: number
  expiresAt?: string
}): Promise<CanvasShareState> {
  const wsId = requirePositiveInteger(workspaceId, '工作空间 ID 无效')
  const id = requirePositiveInteger(canvasId, '画布 ID 无效')
  const payload = await requestBusinessJson<unknown>(`/api/v1/canvases/${id}/share?workspace_id=${wsId}`, {
    method: 'POST',
    body: JSON.stringify(expiresAt ? { expires_at: expiresAt } : {}),
  })
  return parseCanvasShareState(payload)
}

/** 关闭分享：原口令随即失效。 */
export async function deleteCanvasShare({
  workspaceId,
  canvasId,
}: {
  workspaceId: number
  canvasId: number
}): Promise<void> {
  const wsId = requirePositiveInteger(workspaceId, '工作空间 ID 无效')
  const id = requirePositiveInteger(canvasId, '画布 ID 无效')
  await requestBusinessJson(`/api/v1/canvases/${id}/share?workspace_id=${wsId}`, { method: 'DELETE' })
}

function requireToken(token: string): string {
  const text = String(token || '').trim()
  if (!text) throw new Error('分享口令无效')
  return text
}

/** 匿名读取公开画布的基本信息。无需登录。 */
export async function fetchPublicCanvas(token: string): Promise<PublicCanvasShare> {
  const payload = await requestBusinessJson<unknown>(`/api/v1/canvas-shares/${encodeURIComponent(requireToken(token))}`)
  const data = unwrap(payload)
  return {
    title: readText(data, 'title', 'name'),
    status: readText(data, 'status'),
    revision: Number(data.revision) || 0,
    schemaVersion: Number(data.schema_version ?? data.schemaVersion) || 0,
    coverUrl: readText(data, 'cover_url', 'coverUrl'),
    previewUrl: readText(data, 'preview_url', 'previewUrl'),
    createdAt: readText(data, 'created_at', 'createdAt'),
    updatedAt: readText(data, 'updated_at', 'updatedAt'),
    lastSavedAt: readText(data, 'last_saved_at', 'lastSavedAt'),
  }
}

/**
 * 匿名分页读取公开画布元素。
 *
 * 字段名与登录态的 /canvases/{id}/elements 保持同一套兼容口径（items / elements 都认）：
 * 两条通道取的是同一批数据，解析规则分家迟早会出现「登录能看、分享打不开」。
 */
export async function fetchPublicCanvasElements({
  token,
  cursor = '',
  limit = 500,
}: {
  token: string
  cursor?: string
  limit?: number
}): Promise<PublicCanvasElementsPage> {
  const query = new URLSearchParams({ limit: String(Math.max(1, Math.min(Number(limit) || 500, 1000))) })
  if (cursor) query.set('cursor', String(cursor))
  const payload = await requestBusinessJson<unknown>(
    `/api/v1/canvas-shares/${encodeURIComponent(requireToken(token))}/elements?${query}`,
  )
  const data = unwrap(payload)
  const elements = Array.isArray(data.elements) ? data.elements : Array.isArray(data.items) ? data.items : []
  return {
    elements,
    nextCursor: readText(data, 'next_cursor', 'nextCursor'),
    hasMore: Boolean(data.has_more ?? data.hasMore),
    ...(data.schema_version !== undefined ? { schemaVersion: Number(data.schema_version) || 0 } : {}),
    ...(data.state !== undefined ? { state: data.state } : {}),
  }
}

/** 拉全部分页，供只读查看页一次性装载画布。 */
export async function fetchAllPublicCanvasElements(token: string): Promise<unknown[]> {
  const all: unknown[] = []
  let cursor = ''
  // 与登录态同款上限：分享的画布同样可能很大，但不能让异常游标把这里拖成死循环
  for (let page = 0; page < 200; page += 1) {
    const result = await fetchPublicCanvasElements({ token, cursor })
    all.push(...result.elements)
    if (!result.hasMore || !result.nextCursor || result.nextCursor === cursor) break
    cursor = result.nextCursor
  }
  return all
}

/** 由口令拼出可复制的分享链接；后端已给完整 URL 时以后端为准。 */
export function buildCanvasShareUrl(state: CanvasShareState, origin = window.location.origin): string {
  if (state.url) return state.url
  if (!state.token) return ''
  return `${origin.replace(/\/$/, '')}/canvas/share/${encodeURIComponent(state.token)}`
}
