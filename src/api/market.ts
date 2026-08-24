/**
 * 需求市场接口（/api/v1/market/**）。
 *
 * 后端 v1 的需求模型只有 title/description/category/budget/delivery_deadline 等基础字段，
 * 设计稿要求的视频时长、比例、数量、报名截止时间、产品素材等扩展信息没有独立字段，
 * 统一编码进 description 末尾的元数据块（encodeDemandDescription / splitDemandDescription）。
 * 素材里的签名 URL 会过期，展示端必须容忍加载失败并回退占位（见 DemandMaterial 注释）。
 */

export type DemandStatus = 'draft' | 'open' | 'in_progress' | 'completed' | 'cancelled' | string
export type DemandApplicationStatus = 'pending' | 'accepted' | 'rejected' | 'withdrawn' | string

export interface MarketUser {
  id: number
  nickname: string
  avatar: string
}

/**
 * 需求附带的产品素材。url 是上传时的签名地址（会过期，仅作最近期的最佳展示，
 * 过期后由界面回退到文件名占位）；assetId 供发布者自己的工作空间刷新地址。
 */
export interface DemandMaterial {
  name: string
  url?: string
  assetId?: number
}

/** 设计稿扩展字段：全部编码在 description 的元数据块里。 */
export interface DemandExtras {
  /** 视频时长，如 "30S" */
  duration?: string
  /** 视频比例，如 "9:16" */
  ratio?: string
  /** 视频数量（条） */
  quantity?: number
  /** 报名截止时间 YYYY/MM/DD */
  applyDeadline?: string
  /** 交付时间 YYYY/MM/DD（同时也尽力写入后端 delivery_deadline） */
  deliveryDeadline?: string
  materials?: DemandMaterial[]
  /** 从 IP 卡片「发送需求」发起时记录目标创作者 */
  targetIpId?: number
  targetIpName?: string
}

export interface MarketDemand {
  id: number
  title: string
  /** 纯文本描述（已剥离元数据块） */
  description: string
  status: DemandStatus
  budgetCents: number
  budgetType: string
  currency: string
  category: string
  publisher: MarketUser
  assignee: MarketUser | null
  createdAt: string
  publishedAt: string
  completedAt: string
  deliveryDeadline: string
  extras: DemandExtras
}

export interface MarketDemandPage {
  items: MarketDemand[]
  total: number
}

export interface DemandApplication {
  id: number
  demandId: number
  demand: MarketDemand | null
  applicant: MarketUser
  message: string
  quoteCents: number
  estimatedDays: number
  status: DemandApplicationStatus
  createdAt: string
  respondedAt: string
}

export interface DemandApplicationPage {
  items: DemandApplication[]
  total: number
}

/* ---------- description 元数据块 ---------- */

const DEMAND_META_MARKER = '\n\n[ZZH-DEMAND-META]'

/** 把纯文本描述与扩展字段编码为提交给后端的 description。 */
export function encodeDemandDescription(text: string, extras: DemandExtras): string {
  const plain = String(text || '').trim()
  const meaningful = Object.entries(extras).some(([, value]) =>
    Array.isArray(value) ? value.length > 0 : value !== undefined && value !== '' && value !== null,
  )
  if (!meaningful) return plain
  return `${plain}${DEMAND_META_MARKER}${JSON.stringify(extras)}`
}

/** 从后端 description 中拆出纯文本与扩展字段；无元数据块时 extras 为空对象。 */
export function splitDemandDescription(raw: unknown): { text: string; extras: DemandExtras } {
  const value = String(raw ?? '')
  const markerAt = value.lastIndexOf(DEMAND_META_MARKER)
  if (markerAt < 0) return { text: value.trim(), extras: {} }
  const text = value.slice(0, markerAt).trim()
  const payload = value.slice(markerAt + DEMAND_META_MARKER.length).trim()
  try {
    const parsed = JSON.parse(payload)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { text, extras: normalizeExtras(parsed) }
    }
  } catch {
    /* 元数据损坏时按纯文本处理，不阻断展示 */
  }
  return { text: value.trim(), extras: {} }
}

function normalizeExtras(raw: any): DemandExtras {
  const extras: DemandExtras = {}
  if (raw.duration) extras.duration = String(raw.duration)
  if (raw.ratio) extras.ratio = String(raw.ratio)
  const quantity = Number(raw.quantity)
  if (Number.isFinite(quantity) && quantity > 0) extras.quantity = Math.floor(quantity)
  if (raw.applyDeadline) extras.applyDeadline = String(raw.applyDeadline)
  if (raw.deliveryDeadline) extras.deliveryDeadline = String(raw.deliveryDeadline)
  if (Array.isArray(raw.materials)) {
    const materials = raw.materials
      .map((item: any): DemandMaterial | null => {
        const name = String(item?.name || '').trim()
        if (!name) return null
        const material: DemandMaterial = { name }
        if (item?.url) material.url = String(item.url)
        const assetId = Number(item?.assetId)
        if (Number.isFinite(assetId) && assetId > 0) material.assetId = assetId
        return material
      })
      .filter(Boolean) as DemandMaterial[]
    if (materials.length) extras.materials = materials
  }
  const targetIpId = Number(raw.targetIpId)
  if (Number.isFinite(targetIpId) && targetIpId > 0) extras.targetIpId = targetIpId
  if (raw.targetIpName) extras.targetIpName = String(raw.targetIpName)
  return extras
}

/* ---------- 归一化 ---------- */

function toText(...values: unknown[]): string {
  for (const value of values) {
    const normalized = String(value ?? '').trim()
    if (normalized) return normalized
  }
  return ''
}

function toNumber(...values: unknown[]): number {
  for (const value of values) {
    const normalized = Number(value)
    if (Number.isFinite(normalized)) return normalized
  }
  return 0
}

function normalizeUser(raw: any): MarketUser {
  return {
    id: toNumber(raw?.id, raw?.user_id),
    nickname: toText(raw?.nickname, raw?.name, '用户'),
    avatar: toText(raw?.avatar_url, raw?.avatar),
  }
}

/** 兼容需求接口字段并拆出元数据块。 */
export function normalizeMarketDemand(raw: any): MarketDemand {
  const { text, extras } = splitDemandDescription(raw?.description)
  return {
    id: toNumber(raw?.id, raw?.demand_id),
    title: toText(raw?.title, '未命名需求'),
    description: text,
    status: toText(raw?.status, 'draft'),
    budgetCents: toNumber(raw?.budget_cents),
    budgetType: toText(raw?.budget_type, 'negotiable'),
    currency: toText(raw?.currency, 'CNY'),
    category: toText(raw?.category, 'video'),
    publisher: normalizeUser(raw?.publisher),
    assignee: raw?.assignee ? normalizeUser(raw.assignee) : null,
    createdAt: toText(raw?.created_at),
    publishedAt: toText(raw?.published_at),
    completedAt: toText(raw?.completed_at),
    deliveryDeadline: toText(raw?.delivery_deadline, extras.deliveryDeadline),
    extras,
  }
}

export function normalizeDemandApplication(raw: any): DemandApplication {
  return {
    id: toNumber(raw?.id),
    demandId: toNumber(raw?.demand_id, raw?.demand?.id),
    demand: raw?.demand ? normalizeMarketDemand(raw.demand) : null,
    applicant: normalizeUser(raw?.applicant),
    message: toText(raw?.message),
    quoteCents: toNumber(raw?.quote_cents),
    estimatedDays: toNumber(raw?.estimated_days),
    status: toText(raw?.status, 'pending'),
    createdAt: toText(raw?.created_at),
    respondedAt: toText(raw?.responded_at),
  }
}

/* ---------- 展示格式化 ---------- */

/** "200元/条"；无固定预算显示 "面议"。 */
export function formatDemandPrice(demand: Pick<MarketDemand, 'budgetCents' | 'budgetType'>): string {
  if (!demand.budgetCents || demand.budgetType === 'unpaid') {
    return demand.budgetType === 'unpaid' ? '免费' : '面议'
  }
  const yuan = demand.budgetCents / 100
  const rendered = Number.isInteger(yuan) ? String(yuan) : yuan.toFixed(2)
  return `${rendered}元`
}

/** 时间戳/日期串 → "2026/8/25"；无值返回空串。 */
export function formatDemandDate(value: unknown): string {
  const text = String(value ?? '').trim()
  if (!text) return ''
  // 已是 YYYY/MM/DD 或 YYYY/M/D 的直接返回
  if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(text)) return text
  const date = new Date(text)
  if (Number.isNaN(date.getTime())) return text
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
}

export const DEMAND_STATUS_LABELS: Readonly<Record<string, string>> = Object.freeze({
  draft: '草稿',
  open: '报名中',
  in_progress: '制作中',
  completed: '已完成',
  cancelled: '已取消',
})

export function demandStatusLabel(status: string): string {
  return DEMAND_STATUS_LABELS[status] || status || '未知'
}

export const APPLICATION_STATUS_LABELS: Readonly<Record<string, string>> = Object.freeze({
  pending: '待处理',
  accepted: '已接受',
  rejected: '已拒绝',
  withdrawn: '已撤回',
})

export function applicationStatusLabel(status: string): string {
  return APPLICATION_STATUS_LABELS[status] || status || '未知'
}

/* ---------- 请求 ---------- */

async function readPayload(response: Response): Promise<any> {
  const payload = await response.json().catch(() => null)
  if (!response.ok || (typeof payload?.code === 'number' && payload.code !== 0)) {
    const error: any = new Error(payload?.message || `请求失败 (${response.status})`)
    error.status = response.status
    throw error
  }
  return payload
}

function unwrapPage(payload: any): { items: any[]; total: number } {
  const data = payload?.data
  const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : []
  return { items, total: toNumber(data?.total, items.length) }
}

async function requestMarket(path: string, init?: RequestInit): Promise<any> {
  const response = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  return readPayload(response)
}

/** GET /api/v1/market/demands：浏览需求市场（公开）。 */
export async function listMarketDemands({
  query = '',
  status = '',
  category = '',
  userId = 0,
  limit = 100,
  offset = 0,
  signal,
}: {
  query?: string
  status?: string
  category?: string
  userId?: number
  limit?: number
  offset?: number
  signal?: AbortSignal
} = {}): Promise<MarketDemandPage> {
  const params = new URLSearchParams({
    limit: String(Math.min(100, Math.max(1, limit))),
    offset: String(Math.max(0, offset)),
  })
  if (query.trim()) params.set('q', query.trim())
  if (status) params.set('status', status)
  if (category) params.set('category', category)
  if (userId > 0) params.set('user_id', String(Math.floor(userId)))
  const payload = await requestMarket(`/api/v1/market/demands?${params}`, { signal })
  const { items, total } = unwrapPage(payload)
  const demands = items.map(normalizeMarketDemand).filter((item) => item.id > 0)
  return { items: demands, total }
}

/** GET /api/v1/market/demands/{id}：公开需求详情。 */
export async function getMarketDemand(id: number, signal?: AbortSignal): Promise<MarketDemand> {
  const payload = await requestMarket(`/api/v1/market/demands/${Math.floor(id)}`, { signal })
  return normalizeMarketDemand(payload?.data)
}

export interface CreateDemandInput {
  title: string
  description: string
  /** 单条价格（元）；0 表示面议 */
  pricePerItemYuan: number
  extras: DemandExtras
}

/**
 * POST /api/v1/market/demands：创建需求草稿。
 * delivery_deadline 的后端格式未在文档约定，解析失败（400）时自动降级为不带该字段重试，
 * 交付时间仍会保留在 extras 元数据里，展示不受影响。
 */
export async function createMarketDemand(input: CreateDemandInput): Promise<MarketDemand> {
  const body: Record<string, unknown> = {
    title: input.title.trim(),
    description: encodeDemandDescription(input.description, input.extras),
    category: 'video',
    budget_type: input.pricePerItemYuan > 0 ? 'fixed' : 'negotiable',
    budget_cents: Math.max(0, Math.round(input.pricePerItemYuan * 100)),
    currency: 'CNY',
  }
  const deadline = input.extras.deliveryDeadline
  if (deadline) {
    const date = new Date(deadline.replace(/\//g, '-'))
    if (!Number.isNaN(date.getTime())) body.delivery_deadline = date.toISOString()
  }
  try {
    const payload = await requestMarket('/api/v1/market/demands', { method: 'POST', body: JSON.stringify(body) })
    return normalizeMarketDemand(payload?.data)
  } catch (error: any) {
    if (error?.status === 400 && body.delivery_deadline) {
      delete body.delivery_deadline
      const payload = await requestMarket('/api/v1/market/demands', { method: 'POST', body: JSON.stringify(body) })
      return normalizeMarketDemand(payload?.data)
    }
    throw error
  }
}

/** POST /api/v1/market/demands/{id}/publish：发布需求，让它出现在需求市场。 */
export async function publishMarketDemand(id: number): Promise<MarketDemand> {
  const payload = await requestMarket(`/api/v1/market/demands/${Math.floor(id)}/publish`, { method: 'POST' })
  return normalizeMarketDemand(payload?.data)
}

/** POST /api/v1/market/demands/{id}/cancel：取消需求。 */
export async function cancelMarketDemand(id: number): Promise<MarketDemand> {
  const payload = await requestMarket(`/api/v1/market/demands/${Math.floor(id)}/cancel`, { method: 'POST' })
  return normalizeMarketDemand(payload?.data)
}

/** POST /api/v1/market/demands/{id}/complete：完成需求。 */
export async function completeMarketDemand(id: number): Promise<MarketDemand> {
  const payload = await requestMarket(`/api/v1/market/demands/${Math.floor(id)}/complete`, { method: 'POST' })
  return normalizeMarketDemand(payload?.data)
}

/** GET /api/v1/market/demands/{id}/applications：需求的接单申请（发布者视角）。 */
export async function listDemandApplications(
  demandId: number,
  { limit = 100, offset = 0, signal }: { limit?: number; offset?: number; signal?: AbortSignal } = {},
): Promise<DemandApplicationPage> {
  const params = new URLSearchParams({
    limit: String(Math.min(100, Math.max(1, limit))),
    offset: String(Math.max(0, offset)),
  })
  const payload = await requestMarket(`/api/v1/market/demands/${Math.floor(demandId)}/applications?${params}`, {
    signal,
  })
  const { items, total } = unwrapPage(payload)
  return { items: items.map(normalizeDemandApplication).filter((item) => item.id > 0), total }
}

/** POST /api/v1/market/demands/{id}/applications：提交接单申请。 */
export async function applyToDemand(
  demandId: number,
  { message = '', quoteYuan = 0, estimatedDays = 0 }: { message?: string; quoteYuan?: number; estimatedDays?: number },
): Promise<DemandApplication> {
  const payload = await requestMarket(`/api/v1/market/demands/${Math.floor(demandId)}/applications`, {
    method: 'POST',
    body: JSON.stringify({
      message: message.trim(),
      quote_cents: Math.max(0, Math.round(quoteYuan * 100)),
      estimated_days: Math.max(0, Math.floor(estimatedDays)),
    }),
  })
  return normalizeDemandApplication(payload?.data)
}

/** POST /api/v1/market/applications/{id}/accept：接受接单申请，返回更新后的需求。 */
export async function acceptDemandApplication(applicationId: number): Promise<MarketDemand> {
  const payload = await requestMarket(`/api/v1/market/applications/${Math.floor(applicationId)}/accept`, {
    method: 'POST',
  })
  return normalizeMarketDemand(payload?.data)
}

/** POST /api/v1/market/applications/{id}/reject：拒绝接单申请，返回更新后的申请。 */
export async function rejectDemandApplication(applicationId: number): Promise<DemandApplication> {
  const payload = await requestMarket(`/api/v1/market/applications/${Math.floor(applicationId)}/reject`, {
    method: 'POST',
  })
  return normalizeDemandApplication(payload?.data)
}

/** POST /api/v1/market/applications/{id}/withdraw：撤回自己的接单申请。 */
export async function withdrawDemandApplication(applicationId: number): Promise<DemandApplication> {
  const payload = await requestMarket(`/api/v1/market/applications/${Math.floor(applicationId)}/withdraw`, {
    method: 'POST',
  })
  return normalizeDemandApplication(payload?.data)
}

/** GET /api/v1/market/me/demands：我发布的需求。 */
export async function listMyDemands({
  limit = 100,
  offset = 0,
  signal,
}: { limit?: number; offset?: number; signal?: AbortSignal } = {}): Promise<MarketDemandPage> {
  const params = new URLSearchParams({
    limit: String(Math.min(100, Math.max(1, limit))),
    offset: String(Math.max(0, offset)),
  })
  const payload = await requestMarket(`/api/v1/market/me/demands?${params}`, { signal })
  const { items, total } = unwrapPage(payload)
  return { items: items.map(normalizeMarketDemand).filter((item) => item.id > 0), total }
}

/** GET /api/v1/market/me/applications：我提交的接单申请。 */
export async function listMyApplications({
  limit = 100,
  offset = 0,
  signal,
}: { limit?: number; offset?: number; signal?: AbortSignal } = {}): Promise<DemandApplicationPage> {
  const params = new URLSearchParams({
    limit: String(Math.min(100, Math.max(1, limit))),
    offset: String(Math.max(0, offset)),
  })
  const payload = await requestMarket(`/api/v1/market/me/applications?${params}`, { signal })
  const { items, total } = unwrapPage(payload)
  return { items: items.map(normalizeDemandApplication).filter((item) => item.id > 0), total }
}
