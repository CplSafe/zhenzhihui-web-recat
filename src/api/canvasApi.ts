/**
 * 无限画布 API 客户端（/api/v1/canvases）
 *
 * 对应后端 Swagger「无限画布」模块：
 * - GET/POST  /canvases                    画布列表 / 新建（revision=0 空画布）
 * - GET/PATCH/DELETE /canvases/{id}        详情 / 更新元信息 / 删除
 * - GET/PATCH /canvases/{id}/elements      增量同步 / 增量保存（revision 乐观锁）
 * - GET       /canvases/{id}/events        协同事件订阅（团队版）
 *
 * 元素模型：{ element_id, kind, op, payload }，op 为 upsert/delete，
 * payload 为自由对象（服务端不校验结构），节点/连线的业务数据直接放入 payload。
 * 保存请求：{ base_revision, mutations[], state, schema_version }，
 * base_revision 冲突返回 409，客户端需重拉 after_revision 合并。
 *
 * 复用 business.ts 的统一鉴权（cookie）、超时、401 单飞续期与错误处理。
 */
import { BusinessApiError, requestBusinessJson } from './business'

/** 画布元素 mutation：upsert 新增/更新，delete 删除（服务端生成 tombstone）。 */
export interface CanvasElementMutation {
  element_id: string
  /** 元素类别：node / edge / state 等，服务端仅透传。 */
  kind: string
  /** upsert | delete */
  op: 'upsert' | 'delete'
  /** 节点/连线的业务数据（自由对象）。 */
  payload?: Record<string, unknown>
  /** 经服务端校验的私有查看素材引用，仅查看会话的节点读取返回。 */
  preview_media?: { asset_id?: number; poster_asset_id?: number; image_asset_ids?: number[] }
}

/** 增量保存请求体（对齐 httpapi.saveCanvasElementsRequest）。 */
export interface SaveCanvasElementsRequest {
  /** 客户端已知的最新 revision，服务端做乐观锁校验。 */
  base_revision: number
  /** 最多 500 个元素原子 upsert/delete。 */
  mutations: CanvasElementMutation[]
  /** 全局画布 state（视图变换、选中态等），首轮同步时随第一页返回。 */
  state?: Record<string, unknown>
  /** 客户端数据 schema 版本。 */
  schema_version?: number
}

/** 画布元素增量同步响应（服务端 response.Response.data）。 */
export interface CanvasElementsPage {
  image_model_version_ids?: number[]
  image_model_version_id?: number
  video_model_version_ids?: number[]
  video_model_version_id?: number
  /** 元素列表：op=upsert 的活元素；after_revision>0 时含 op=delete 的 tombstone。 */
  elements: CanvasElementMutation[]
  /** 服务端当前 revision，客户端保存时作为 base_revision。 */
  sync_revision: number
  /** 低于该 revision 的增量不可用，需全量重拉。 */
  history_floor_revision: number
  /** 全局 state（仅每轮第一页返回）。 */
  state?: Record<string, unknown>
  schema_version?: number
  /** 服务端不透明游标，仅可用于相同 after_revision 的下一页。 */
  next_cursor?: string
  has_more?: boolean
}

export type CanvasModelSelection = { image_model_version_ids: number[]; video_model_version_ids: number[] }
export function pageModelDefaults(page: CanvasElementsPage): CanvasModelDefaults {
  return {
    imageModelVersionId: page.image_model_version_id,
    videoModelVersionId: page.video_model_version_id,
    imageModelVersionIds: page.image_model_version_ids,
    videoModelVersionIds: page.video_model_version_ids,
  }
}
export interface CanvasModelDefaults {
  imageModelVersionIds?: number[]
  imageModelVersionId?: number
  videoModelVersionIds?: number[]
  videoModelVersionId?: number
}

export interface CanvasCreateOptions extends CanvasModelDefaults {
  /** 省略为工作空间全员，空数组为仅创建者。 */
  memberUserIds?: number[]
}

/** 画布元信息（列表/详情）。 */
export interface CanvasSummary extends CanvasModelDefaults {
  usedCredits?: number
  membersRestricted?: boolean
  id: number
  title?: string
  status?: 'active' | 'archived'
  created_at?: string
  updated_at?: string
  /** 当前元素 revision，未同步过时为 0。 */
  revision?: number
  /** 画布创建者（后端 user_id）；团队空间里用来区分自己和其他成员的画布。 */
  userId?: number
}

/**
 * 归一化画布对象：Swagger 未定义画布响应结构，后端不同接口返回的字段名可能不统一
 * （id/canvas_id、title/name 等），统一映射为 CanvasSummary，避免列表/详情字段取不到。
 */
function normalizeCanvas(raw: unknown): CanvasSummary {
  if (!raw || typeof raw !== 'object') return { id: 0 }
  const o = raw as Record<string, unknown>
  const inner = o.data && typeof o.data === 'object' ? (o.data as Record<string, unknown>) : undefined
  const id = Number(o.id ?? o.canvas_id ?? o.canvasId ?? o.canvasID ?? inner?.id ?? 0) || 0
  const title = String(o.title ?? o.name ?? o.canvas_name ?? o.canvasName ?? inner?.title ?? '').trim()
  const status = String(o.status ?? inner?.status ?? '') as CanvasSummary['status']
  const created_at = String(o.created_at ?? o.createdAt ?? o.create_time ?? inner?.created_at ?? '') || undefined
  const updated_at = String(o.updated_at ?? o.updatedAt ?? o.update_time ?? inner?.updated_at ?? '') || undefined
  const revision = Number(o.revision ?? o.sync_revision ?? inner?.revision ?? 0) || 0
  const userId = Number(o.user_id ?? o.userId ?? o.created_by ?? inner?.user_id ?? 0) || 0
  return {
    id,
    ...(typeof o.used_credits === 'number' ? { usedCredits: o.used_credits } : {}),
    ...(title ? { title } : {}),
    ...(status === 'active' || status === 'archived' ? { status } : {}),
    ...(created_at ? { created_at } : {}),
    ...(updated_at ? { updated_at } : {}),
    ...(revision ? { revision } : {}),
    ...(userId ? { userId } : {}),
    ...(typeof o.members_restricted === 'boolean' ? { membersRestricted: o.members_restricted } : {}),
    ...(Array.isArray(o.image_model_version_ids)
      ? { imageModelVersionIds: o.image_model_version_ids.map(Number) }
      : {}),
    ...(Number(o.image_model_version_id) > 0 ? { imageModelVersionId: Number(o.image_model_version_id) } : {}),
    ...(Array.isArray(o.video_model_version_ids)
      ? { videoModelVersionIds: o.video_model_version_ids.map(Number) }
      : {}),
    ...(Number(o.video_model_version_id) > 0 ? { videoModelVersionId: Number(o.video_model_version_id) } : {}),
  }
}

/** 把响应中的数组归一化为 CanvasSummary[]（兼容 items/list/直接数组三种形态）。 */
function normalizeCanvasList(data: unknown): CanvasSummary[] {
  if (!data || typeof data !== 'object') return []
  const o = data as Record<string, unknown>
  const raw = Array.isArray(data)
    ? (data as unknown[])
    : Array.isArray(o.items)
      ? (o.items as unknown[])
      : Array.isArray(o.list)
        ? (o.list as unknown[])
        : []
  return raw.map(normalizeCanvas).filter((c) => c.id > 0)
}

/** 统一对业务返回做一次 data 解包并容忍 null。 */
function unwrap<T>(payload: unknown): T | null {
  if (payload && typeof payload === 'object' && 'data' in (payload as object)) {
    return (payload as { data: T | null }).data
  }
  return payload as T | null
}

/** 校验正整数 ID，非法时抛出统一业务异常（对齐 business.ts requirePositiveInteger）。 */
function requirePositiveInteger(value: unknown, message: string): number {
  const normalized = Number(value)
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw new BusinessApiError(message)
  }
  return normalized
}

/**
 * 新建无限画布（POST /canvases）。
 * 返回服务端创建的画布 ID；title 缺省时为空画布标题。
 */
export async function createCanvas({
  workspaceId,
  title = '',
  imageModelVersionIds,
  imageModelVersionId,
  videoModelVersionIds,
  videoModelVersionId,
  memberUserIds,
}: CanvasCreateOptions & {
  workspaceId: number
  title?: string
}): Promise<CanvasSummary> {
  const wsId = requirePositiveInteger(workspaceId, '工作空间 ID 无效')
  const payload = await requestBusinessJson<unknown>(`/api/v1/canvases?workspace_id=${wsId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: String(title || ''),
      image_model_version_ids: imageModelVersionIds,
      image_model_version_id: imageModelVersionId,
      video_model_version_ids: videoModelVersionIds,
      video_model_version_id: videoModelVersionId,
      member_user_ids: memberUserIds,
    }),
  })
  return normalizeCanvas(unwrap<unknown>(payload))
}

export interface CanvasMembers {
  creator_id?: number
  members_restricted: boolean
  member_user_ids: number[]
  can_manage: boolean
}

export async function getCanvasMembers(workspaceId: number, canvasId: number): Promise<CanvasMembers> {
  const response = await requestBusinessJson(`/api/v1/canvases/${canvasId}/members?workspace_id=${workspaceId}`)
  return unwrap<CanvasMembers>(response)
}

export async function changeCanvasMembers(
  workspaceId: number,
  canvasId: number,
  memberUserIds: number[],
  removeUserIds: number[],
): Promise<CanvasMembers> {
  const response = await requestBusinessJson(`/api/v1/canvases/${canvasId}/members?workspace_id=${workspaceId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ member_user_ids: memberUserIds, remove_user_ids: removeUserIds }),
  })
  return unwrap<CanvasMembers>(response)
}

/** 分页列出工作空间画布（GET /canvases）。 */
export async function listCanvases({
  workspaceId,
  includeArchived = false,
  limit = 50,
  offset = 0,
}: {
  workspaceId: number
  includeArchived?: boolean
  limit?: number
  offset?: number
}): Promise<CanvasSummary[]> {
  const wsId = requirePositiveInteger(workspaceId, '工作空间 ID 无效')
  const query = new URLSearchParams({
    workspace_id: String(wsId),
    limit: String(Math.max(1, Math.min(Number(limit) || 50, 100))),
    offset: String(Math.max(0, Number(offset) || 0)),
  })
  if (includeArchived) query.set('include_archived', 'true')
  const payload = await requestBusinessJson<unknown>(`/api/v1/canvases?${query}`)
  return normalizeCanvasList(unwrap<unknown>(payload))
}

/** 读取画布详情（GET /canvases/{id}）。 */
export async function getCanvas({
  workspaceId,
  canvasId,
}: {
  workspaceId: number
  canvasId: number
}): Promise<CanvasSummary | null> {
  const wsId = requirePositiveInteger(workspaceId, '工作空间 ID 无效')
  const id = requirePositiveInteger(canvasId, '画布 ID 无效')
  const payload = await requestBusinessJson<unknown>(`/api/v1/canvases/${id}?workspace_id=${wsId}`)
  const data = unwrap<unknown>(payload)
  return data ? normalizeCanvas(data) : null
}

/** 更新画布元信息（PATCH /canvases/{id}）：标题或状态 active/archived。 */
export async function patchCanvas({
  workspaceId,
  canvasId,
  title,
  status,
  models,
  expectedModels,
}: {
  workspaceId: number
  canvasId: number
  models?: CanvasModelSelection
  expectedModels?: CanvasModelSelection
  title?: string
  status?: 'active' | 'archived'
}): Promise<CanvasSummary | null> {
  const wsId = requirePositiveInteger(workspaceId, '工作空间 ID 无效')
  const id = requirePositiveInteger(canvasId, '画布 ID 无效')
  const body: Record<string, unknown> = {}
  if (title !== undefined) body.title = String(title)
  if (status) body.status = status
  if (models) body.models = models
  if (expectedModels) body.expected_models = expectedModels
  const payload = await requestBusinessJson<unknown>(`/api/v1/canvases/${id}?workspace_id=${wsId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = unwrap<unknown>(payload)
  return data ? normalizeCanvas(data) : null
}

/** 删除画布（DELETE /canvases/{id}）。 */
export async function deleteCanvas({
  workspaceId,
  canvasId,
}: {
  workspaceId: number
  canvasId: number
}): Promise<void> {
  const wsId = requirePositiveInteger(workspaceId, '工作空间 ID 无效')
  const id = requirePositiveInteger(canvasId, '画布 ID 无效')
  await requestBusinessJson(`/api/v1/canvases/${id}?workspace_id=${wsId}`, { method: 'DELETE' })
}

/**
 * 增量同步画布元素（GET /canvases/{id}/elements）。
 * after_revision=0 初次分页；>0 返回该 revision 后的变化（含删除 tombstone）。
 * 低于 history_floor_revision 时服务端返回 CANVAS_FULL_SYNC_REQUIRED，需以 after_revision=0 全量重拉。
 */
interface CanvasElementsReader {
  read: (path: string, options: { signal?: AbortSignal }) => Promise<unknown>
  signal?: AbortSignal
}

export async function fetchCanvasElements(
  {
    workspaceId,
    canvasId,
    afterRevision = 0,
    cursor = '',
    limit = 500,
  }: {
    workspaceId: number
    canvasId: number
    afterRevision?: number
    cursor?: string
    limit?: number
  },
  reader?: CanvasElementsReader,
): Promise<CanvasElementsPage> {
  const wsId = requirePositiveInteger(workspaceId, '工作空间 ID 无效')
  const id = requirePositiveInteger(canvasId, '画布 ID 无效')
  const query = new URLSearchParams({
    workspace_id: String(wsId),
    after_revision: String(Math.max(0, Math.floor(Number(afterRevision) || 0))),
    limit: String(Math.max(1, Math.min(Number(limit) || 500, 1000))),
  })
  if (cursor) query.set('cursor', String(cursor))
  const path = `/api/v1/canvases/${id}/elements?${query}`
  const payload = reader ? await reader.read(path, { signal: reader.signal }) : await requestBusinessJson(path)
  // 后端实际返回 data.items（对齐 GET 契约）；兼容 data.elements 两种字段名，避免云端元素无法解析
  const page =
    unwrap<CanvasElementsPage & { items?: CanvasElementMutation[] }>(payload) ||
    ({} as CanvasElementsPage & { items?: CanvasElementMutation[] })
  const rawElements = Array.isArray(page.elements) ? page.elements : Array.isArray(page.items) ? page.items : []
  return {
    elements: rawElements.map((row: CanvasElementMutation & { deleted?: boolean }) => ({
      ...row,
      op: row.deleted === true || row.op === 'delete' ? 'delete' : 'upsert',
    })),
    image_model_version_ids: page.image_model_version_ids ?? undefined,
    image_model_version_id: page.image_model_version_id ?? undefined,
    video_model_version_ids: page.video_model_version_ids ?? undefined,
    video_model_version_id: page.video_model_version_id ?? undefined,
    sync_revision: Number(page.sync_revision) || 0,
    history_floor_revision: Number(page.history_floor_revision) || 0,
    state: page.state || undefined,
    schema_version: page.schema_version,
    next_cursor: page.next_cursor,
    has_more: Boolean(page.has_more),
  }
}

/**
 * 拉取同一 revision 范围内的全部画布元素分页。
 *
 * 服务端游标只允许与最初的 after_revision 配套使用；调用方不能在分页过程中推进
 * revision，否则会跳过尚未读取的 mutation。遇到异常游标时直接失败，避免把不完整
 * 的页面误当成完整基线写入画布。
 */
export async function fetchAllCanvasElements(
  {
    workspaceId,
    canvasId,
    afterRevision = 0,
    /*
     * 游标分页只能串行（下一页的 cursor 来自上一页响应），所以减少往返次数的唯一办法
     * 是把每页取大一些。1000 让绝大多数画布一次拉完，首屏少等一个完整 RTT。
     */
    limit = 1000,
    maxPages = 200,
  }: {
    workspaceId: number
    canvasId: number
    afterRevision?: number
    limit?: number
    maxPages?: number
  },
  reader?: CanvasElementsReader,
): Promise<CanvasElementsPage> {
  const elements: CanvasElementMutation[] = []
  const seenCursors = new Set<string>()
  let cursor = ''
  let firstPage: CanvasElementsPage | null = null
  let lastPage: CanvasElementsPage | null = null

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const page = await fetchCanvasElements({ workspaceId, canvasId, afterRevision, cursor, limit }, reader)
    firstPage ||= page
    lastPage = page
    elements.push(...page.elements)

    if (!page.has_more) {
      return {
        ...firstPage,
        elements,
        history_floor_revision: Math.max(firstPage.history_floor_revision, page.history_floor_revision),
        next_cursor: undefined,
        has_more: false,
      }
    }

    const nextCursor = String(page.next_cursor || '')
    if (!nextCursor || seenCursors.has(nextCursor)) {
      throw new BusinessApiError('画布分页游标异常，已停止同步以避免数据不完整')
    }
    seenCursors.add(nextCursor)
    cursor = nextCursor
  }

  throw new BusinessApiError(`画布元素超过 ${maxPages} 页，已停止同步以避免数据不完整`, {
    response: lastPage,
  })
}

/** 临时占用、限流和登录续期均允许原草稿稍后重试。 */
export function isPermanentCanvasSaveError(status: number, code: string, revisionConflict = false): boolean {
  if (code === 'CANVAS_SAVE_ACK_UNKNOWN') return false
  if (code === 'CANVAS_INVALID_INPUT' || code === '10001' || code === 'CANVAS_LOCAL_PAYLOAD_TOO_LARGE') return true
  if (revisionConflict || (status === 423 && code === 'CANVAS_AGENT_LOCKED')) return false
  return status >= 400 && status < 500 && status !== 401 && status !== 429
}

/**
 * 增量保存画布元素（PATCH /canvases/{id}/elements）。
 * 乐观锁：base_revision 与服务端不一致返回 409；调用方应拉增量、应用远端、重放本地后重试。
 * mutations 可为空（仅提交 state）；返回服务端最新 revision（data.revision）。
 */
export async function saveCanvasElements({
  workspaceId,
  canvasId,
  baseRevision,
  mutations,
  state,
  schemaVersion = 1,
}: {
  workspaceId: number
  canvasId: number
  baseRevision: number
  mutations?: CanvasElementMutation[]
  state?: Record<string, unknown>
  schemaVersion?: number
}): Promise<{ sync_revision: number }> {
  const wsId = requirePositiveInteger(workspaceId, '工作空间 ID 无效')
  const id = requirePositiveInteger(canvasId, '画布 ID 无效')
  const baseRev = Number(baseRevision)
  if (!Number.isFinite(baseRev) || baseRev < 0) {
    throw new BusinessApiError('base_revision 无效')
  }
  const normalizedMutations = Array.isArray(mutations) ? mutations : []
  if (normalizedMutations.length > 500) {
    throw new BusinessApiError('单次保存元素数不能超过 500')
  }
  if (normalizedMutations.length === 0 && !state) {
    throw new BusinessApiError('mutations 与 state 至少提交一项')
  }
  const payload = await requestBusinessJson<unknown>(`/api/v1/canvases/${id}/elements?workspace_id=${wsId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      base_revision: Math.floor(baseRev),
      ...(normalizedMutations.length > 0 ? { mutations: normalizedMutations } : {}),
      ...(state ? { state } : {}),
      ...(schemaVersion !== undefined ? { schema_version: schemaVersion } : {}),
    }),
  })
  const data = unwrap<{ sync_revision?: number | string; revision?: number | string }>(payload)
  const value = data?.sync_revision ?? data?.revision
  const revision = typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value)) ? Number(value) : NaN
  if (!Number.isSafeInteger(revision) || revision <= 0 || revision < Math.floor(baseRev)) {
    throw new BusinessApiError('云端保存结果待确认，正在重新读取画布', { code: 'CANVAS_SAVE_ACK_UNKNOWN' })
  }
  return { sync_revision: revision }
}

/**
 * 按批次增量保存画布元素（对齐 5.6：一批最多 500 个 mutation）。
 * 超限时拆批串行提交，每批使用上一批返回的新 revision，最后返回最终 revision。
 */
export async function saveCanvasElementsBatched({
  workspaceId,
  canvasId,
  baseRevision,
  mutations,
  state,
  schemaVersion = 1,
}: {
  workspaceId: number
  canvasId: number
  baseRevision: number
  mutations: CanvasElementMutation[]
  state?: Record<string, unknown>
  schemaVersion?: number
}): Promise<{ sync_revision: number }> {
  let currentRevision = Number(baseRevision) || 0
  const BATCH_LIMIT = 500
  // 留出余量以适应服务端默认 1 MiB 的 JSON 请求体限制。按 UTF-8 字节计算，不能用字符串长度。
  const BODY_LIMIT = 1000 * 1024
  const encoder = new TextEncoder()
  const byteLength = (value: string) => encoder.encode(value).byteLength
  // 用最大安全整数计算固定开销，确保后续服务端 revision 增长也不会使请求超限。
  const overhead = (batchState?: Record<string, unknown>) =>
    byteLength(
      JSON.stringify({
        base_revision: Number.MAX_SAFE_INTEGER,
        mutations: [],
        ...(batchState ? { state: batchState } : {}),
        schema_version: schemaVersion,
      }),
    )
  const oversized = (message: string) => new BusinessApiError(message, { code: 'CANVAS_LOCAL_PAYLOAD_TOO_LARGE' })
  const batches: Array<{ mutations: CanvasElementMutation[]; state?: Record<string, unknown> }> = []
  let batch: CanvasElementMutation[] = []
  let batchState = state
  let bytes = overhead(batchState)
  if (bytes > BODY_LIMIT) throw oversized('画布设置数据过大，无法保存；修改仍保留在本机')
  for (const mutation of mutations) {
    const size = byteLength(JSON.stringify(mutation))
    if (size + overhead() > BODY_LIMIT) {
      throw oversized(`画布元素 ${mutation.element_id} 的内容过大，无法保存；请检查该节点的文本或参数`)
    }
    if (batch.length >= BATCH_LIMIT || bytes + size + (batch.length ? 1 : 0) > BODY_LIMIT) {
      if (batch.length || batchState) batches.push({ mutations: batch, state: batchState })
      batch = []
      batchState = undefined
      bytes = overhead()
    }
    bytes += size + (batch.length ? 1 : 0)
    batch.push(mutation)
  }
  if (batch.length || batchState) batches.push({ mutations: batch, state: batchState })
  // 完成所有大小检查后再提交，避免单个超大元素导致前面的批次先被写入。
  for (const item of batches) {
    const result = await saveCanvasElements({
      workspaceId,
      canvasId,
      baseRevision: currentRevision,
      mutations: item.mutations,
      state: item.state,
      schemaVersion,
    })
    currentRevision = result.sync_revision
  }
  return { sync_revision: currentRevision }
}

/**
 * 创建画布副本。后端没有复制接口，由前端组合完成：
 * 新建画布 → 全量拉取源画布元素（after_revision=0，只含活元素）→ 原 element_id 批量写入新画布。
 * element_id 原样保留，连线对节点的引用才不会断；全局 state（视图变换等）一并复制。
 * 元素写入失败时尽力删掉刚建的空画布，避免列表里留下一个残缺副本。
 */
export async function duplicateCanvas({
  workspaceId,
  sourceCanvasId,
  title,
  ...options
}: CanvasCreateOptions & {
  workspaceId: number
  sourceCanvasId: number
  title: string
}): Promise<CanvasSummary> {
  const wsId = requirePositiveInteger(workspaceId, '工作空间 ID 无效')
  const sourceId = requirePositiveInteger(sourceCanvasId, '画布 ID 无效')
  // 先读源画布再建新画布：读失败时不会凭空多出一张空画布
  const source = await fetchAllCanvasElements({ workspaceId: wsId, canvasId: sourceId, afterRevision: 0 })
  const created = await createCanvas({ workspaceId: wsId, title, ...options })
  const newId = requirePositiveInteger(created?.id, '创建画布副本失败')
  const mutations: CanvasElementMutation[] = source.elements
    .filter((element) => element?.op !== 'delete' && element?.element_id)
    .map((element) => ({
      element_id: element.element_id,
      kind: element.kind,
      op: 'upsert',
      payload: element.payload || {},
    }))
  if (!mutations.length && !source.state) return created
  try {
    await saveCanvasElementsBatched({
      workspaceId: wsId,
      canvasId: newId,
      baseRevision: 0,
      mutations,
      state: source.state,
      schemaVersion: source.schema_version ?? 1,
    })
  } catch (error) {
    await deleteCanvas({ workspaceId: wsId, canvasId: newId }).catch(() => {})
    throw error
  }
  return created
}

/**
 * 订阅画布协同事件（GET /canvases/{id}/events）。
 * 仅团队版 + ≥2 启用成员可用；非团队 workspace 由服务端返回 403。
 * after_revision 表示客户端已应用到本地的版本。
 */
export function subscribeCanvasEvents({
  workspaceId,
  canvasId,
  afterRevision = 0,
  onRevision,
  onDeleted,
}: {
  workspaceId: number
  canvasId: number
  afterRevision?: number
  onRevision: (revision: number) => void
  onDeleted: () => void
}): () => void {
  const wsId = requirePositiveInteger(workspaceId, '工作空间 ID 无效')
  const id = requirePositiveInteger(canvasId, '画布 ID 无效')
  const query = new URLSearchParams({
    workspace_id: String(wsId),
    after_revision: String(Math.max(0, Math.floor(afterRevision))),
  })
  const stream = new EventSource(`/api/v1/canvases/${id}/events?${query}`, { withCredentials: true })
  const close = () => stream.close()
  const handleRevision = (event: MessageEvent<string>) => {
    const revision = Number(JSON.parse(event.data).revision)
    if (Number.isSafeInteger(revision) && revision >= 0) onRevision(revision)
  }
  stream.addEventListener('canvas.connected', handleRevision)
  stream.addEventListener('canvas.revision', handleRevision)
  stream.addEventListener('canvas.deleted', () => {
    close()
    onDeleted()
  })
  stream.addEventListener('canvas.collaboration_disabled', close)
  // EventSource reconnects on a transient disconnect or the server's stream-age limit.
  return close
}

export interface CanvasNodeUsage {
  historical_allocated_credits?: number
  node_id: string
  title: string
  deleted: boolean
  used_credits: number
  members: { user_id: number; display_name: string; used_credits: number; historical_allocated_credits?: number }[]
}
export interface CanvasStatisticsFilters {
  query?: string
  user_id?: string
  state?: string
  date_from?: string
  date_to?: string
}
export interface WorkspaceCanvasUsageSummary {
  workspace_total_used_credits?: number
  total_used_credits: number
  unassigned_used_credits?: number
}
export interface CanvasStatistics {
  workspace_usage?: WorkspaceCanvasUsageSummary
  historical_allocated_credits?: number
  trend: { date: string; used_credits: number }[]
  member_totals: CanvasNodeUsage['members']
  member_choices: CanvasNodeUsage['members']
  top_nodes: CanvasNodeUsage[]
  items: CanvasNodeUsage[]
  total: number
  total_used_credits: number
}
export async function getCanvasStatistics(
  workspaceId: number,
  canvasId: number,
  page = 1,
  filters: CanvasStatisticsFilters = {},
): Promise<CanvasStatistics> {
  const ws = requirePositiveInteger(workspaceId, '工作空间 ID 无效')
  const id = requirePositiveInteger(canvasId, '画布 ID 无效')
  const query = new URLSearchParams({
    workspace_id: String(ws),
    limit: '50',
    offset: String((Math.max(1, page) - 1) * 50),
  })
  for (const [name, value] of Object.entries(filters)) {
    if (value) query.set(name, value)
  }
  const payload = await requestBusinessJson<unknown>(`/api/v1/canvases/${id}/statistics?${query}`)
  const data = unwrap<CanvasStatistics>(payload)
  if (!data || !Array.isArray(data.items)) throw new BusinessApiError('统计数据暂不可用')
  return data
}
