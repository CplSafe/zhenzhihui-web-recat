/** 首页 IP 创作者与需求市场接口。 */

/** 创作者绑定的外部平台（后端暂未建模，字段名做多种兼容，缺省为空数组）。 */
export interface CommunityIpPlatform {
  name: string
  followers: number
}

export interface CommunityIpProfile {
  id: number
  name: string
  category: string
  contentType: string
  followers: number
  averageOrderValue: number
  avatar: string
  bio: string
  platforms: CommunityIpPlatform[]
  followingCount: number
  publishedWorkCount: number
  openDemandCount: number
}

export interface CommunityIpPage {
  items: CommunityIpProfile[]
  total: number
}

function text(...values: unknown[]): string {
  for (const value of values) {
    const normalized = String(value ?? '').trim()
    if (normalized) return normalized
  }
  return ''
}

function number(...values: unknown[]): number {
  for (const value of values) {
    const normalized = Number(value)
    if (Number.isFinite(normalized) && normalized >= 0) return normalized
  }
  return 0
}

function unwrapItems(payload: any): any[] {
  const data = payload?.data
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.items)) return data.items
  return []
}

/** 兼容多种平台字段形态：[{name/platform, followers/follower_count}] 或 {抖音: 22000} 映射。 */
function normalizePlatforms(raw: any): CommunityIpPlatform[] {
  const source = raw?.platforms ?? raw?.platform_list ?? raw?.social_platforms
  if (Array.isArray(source)) {
    return source
      .map((item: any) => ({
        name: text(item?.name, item?.platform, item?.title),
        followers: number(item?.followers, item?.follower_count, item?.fans),
      }))
      .filter((item) => item.name)
  }
  if (source && typeof source === 'object') {
    return Object.entries(source)
      .map(([name, followers]) => ({ name: name.trim(), followers: number(followers) }))
      .filter((item) => item.name)
  }
  return []
}

/** 兼容社区公开主页当前及后续可能扩展的字段名。 */
export function normalizeCommunityIp(raw: any): CommunityIpProfile {
  const user = raw?.user && typeof raw.user === 'object' ? raw.user : raw
  const profile = raw?.profile && typeof raw.profile === 'object' ? raw.profile : raw
  return {
    id: number(raw?.user_id, raw?.userId, user?.id, raw?.id),
    name: text(raw?.nickname, user?.nickname, raw?.name, user?.name, '未命名创作者'),
    category: text(raw?.main_category, raw?.category, profile?.category, '暂未设置'),
    contentType: text(raw?.content_type, raw?.contentType, profile?.content_type, '综合'),
    followers: number(raw?.follower_count, raw?.followers_count, raw?.followers, profile?.follower_count),
    averageOrderValue: number(
      raw?.average_order_value,
      raw?.average_order_value_cents ? Number(raw.average_order_value_cents) / 100 : undefined,
      raw?.avg_order_price,
      profile?.average_order_value,
    ),
    avatar: text(raw?.avatar_url, raw?.avatar, user?.avatar_url, user?.avatar),
    bio: text(raw?.bio, profile?.bio, raw?.introduction, raw?.description),
    platforms: normalizePlatforms(raw).length ? normalizePlatforms(raw) : normalizePlatforms(profile),
    followingCount: number(raw?.following_count, profile?.following_count),
    publishedWorkCount: number(raw?.published_work_count, profile?.published_work_count),
    openDemandCount: number(raw?.open_demand_count, profile?.open_demand_count),
  }
}

async function readPayload(response: Response): Promise<any> {
  const payload = await response.json().catch(() => null)
  if (!response.ok || (typeof payload?.code === 'number' && payload.code !== 0)) {
    throw new Error(payload?.message || `请求失败 (${response.status})`)
  }
  return payload
}

/** GET /api/v1/community/users：公开创作者列表。 */
export async function listCommunityIps({
  query = '',
  sort = 'popular',
  limit = 100,
  offset = 0,
  signal,
}: {
  query?: string
  sort?: 'popular' | 'latest'
  limit?: number
  offset?: number
  signal?: AbortSignal
} = {}): Promise<CommunityIpPage> {
  const params = new URLSearchParams({
    sort,
    limit: String(Math.min(100, Math.max(1, limit))),
    offset: String(Math.max(0, offset)),
  })
  if (query.trim()) params.set('q', query.trim())
  const response = await fetch(`/api/v1/community/users?${params}`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
    signal,
  })
  const payload = await readPayload(response)
  const items = unwrapItems(payload)
    .map(normalizeCommunityIp)
    .filter((item) => item.id > 0)
  return { items, total: number(payload?.data?.total, items.length) }
}

/** GET /api/v1/community/users/{userId}：公开主页详情。 */
export async function getCommunityIp(userId: number, signal?: AbortSignal): Promise<CommunityIpProfile> {
  const response = await fetch(`/api/v1/community/users/${Math.floor(userId)}`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
    signal,
  })
  const payload = await readPayload(response)
  return normalizeCommunityIp(payload?.data)
}

/** IP 详情页作品展示用的公开作品条目。 */
export interface CommunityWorkItem {
  id: number
  title: string
  description: string
  coverUrl: string
  mediaUrl: string
  mediaType: 'image' | 'video'
  status: string
  visibility: string
  createdAt: string
  authorId: number
  authorName: string
  authorAvatar: string
  category: string
  content: string
  assetIds: number[]
  coverAssetId: number
}

export interface CommunityWorkInput {
  title: string
  summary?: string
  content?: string
  category?: string
  assetIds: number[]
  coverAssetId?: number
}

/** 从作品的 cover_asset / assets 里挑出可展示的封面与媒体地址。 */
export function normalizeCommunityWork(raw: any): CommunityWorkItem {
  const assets: any[] = Array.isArray(raw?.assets) ? raw.assets : []
  const cover = raw?.cover_asset && typeof raw.cover_asset === 'object' ? raw.cover_asset : null
  const isVideo = (asset: any) =>
    String(asset?.type || '').includes('video') || String(asset?.mime_type || '').startsWith('video/')
  const media = assets.find((asset) => text(asset?.url)) || cover
  const imageCover = cover && !isVideo(cover) ? cover : assets.find((asset) => !isVideo(asset) && text(asset?.url))
  return {
    id: number(raw?.id),
    title: text(raw?.title, '未命名作品'),
    description: text(raw?.description, raw?.content, raw?.summary),
    // 后端允许视频资产本身作为 cover_asset。视频 URL 不能交给 <img>，否则加载失败后卡片会塌成 0 高度。
    coverUrl: text(imageCover?.url),
    mediaUrl: text(media?.url),
    mediaType: media && isVideo(media) ? 'video' : 'image',
    status: text(raw?.status, raw?.publish_status),
    visibility: text(
      raw?.visibility,
      raw?.is_public === true ? 'public' : '',
      raw?.is_public === false ? 'private' : '',
    ),
    createdAt: text(raw?.created_at, raw?.createdAt, raw?.published_at),
    authorId: number(raw?.user_id, raw?.userId, raw?.author?.id, raw?.user?.id),
    authorName: text(raw?.author?.nickname, raw?.user?.nickname, raw?.nickname, raw?.author_name),
    authorAvatar: text(raw?.author?.avatar_url, raw?.user?.avatar_url, raw?.avatar_url),
    category: text(raw?.category),
    content: text(raw?.content),
    assetIds: assets.map((asset) => number(asset?.id, asset?.asset_id)).filter((id) => id > 0),
    coverAssetId: number(cover?.id, cover?.asset_id, raw?.cover_asset_id),
  }
}

function normalizeWorkPayload(payload: any): CommunityWorkItem {
  return normalizeCommunityWork(payload?.data?.work ?? payload?.data)
}

/** GET /api/v1/community/works：某位创作者的公开作品（IP 详情页作品展示）。 */
export async function listCommunityWorks({
  userId,
  limit = 60,
  offset = 0,
  signal,
}: {
  userId: number
  limit?: number
  offset?: number
  signal?: AbortSignal
}): Promise<{ items: CommunityWorkItem[]; total: number }> {
  const params = new URLSearchParams({
    user_id: String(Math.floor(userId)),
    limit: String(Math.min(100, Math.max(1, limit))),
    offset: String(Math.max(0, offset)),
  })
  const response = await fetch(`/api/v1/community/works?${params}`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
    signal,
  })
  const payload = await readPayload(response)
  const items = unwrapItems(payload)
    .map(normalizeCommunityWork)
    .filter((item) => item.id > 0)
  return { items, total: number(payload?.data?.total, items.length) }
}

/** GET /api/v1/community/me/works：当前用户的作品（包含未公开作品）。 */
export async function listMyCommunityWorks({
  limit = 60,
  offset = 0,
  signal,
}: {
  limit?: number
  offset?: number
  signal?: AbortSignal
} = {}): Promise<{ items: CommunityWorkItem[]; total: number }> {
  const params = new URLSearchParams({
    limit: String(Math.min(100, Math.max(1, limit))),
    offset: String(Math.max(0, offset)),
  })
  const response = await fetch(`/api/v1/community/me/works?${params}`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
    signal,
  })
  const payload = await readPayload(response)
  const items = unwrapItems(payload)
    .map(normalizeCommunityWork)
    .filter((item) => item.id > 0)
  return { items, total: number(payload?.data?.total, items.length) }
}

/** GET /api/v1/community/works/{id}：游客可访问的公开作品详情。 */
export async function getCommunityWork(workId: number, signal?: AbortSignal): Promise<CommunityWorkItem> {
  const response = await fetch(`/api/v1/community/works/${Math.floor(workId)}`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
    signal,
  })
  return normalizeWorkPayload(await readPayload(response))
}

/** GET /api/v1/community/works/{id}/manage：作者本人的管理视角详情。 */
export async function getCommunityWorkManage(workId: number, signal?: AbortSignal): Promise<CommunityWorkItem> {
  const response = await fetch(`/api/v1/community/works/${Math.floor(workId)}/manage`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
    signal,
  })
  return normalizeWorkPayload(await readPayload(response))
}

function communityWorkBody(input: CommunityWorkInput): string {
  return JSON.stringify({
    title: input.title.trim(),
    summary: String(input.summary || '').trim(),
    content: String(input.content || '').trim(),
    category: String(input.category || '').trim(),
    asset_ids: input.assetIds.map(Number).filter((id) => Number.isInteger(id) && id > 0),
    cover_asset_id: Number(input.coverAssetId || input.assetIds[0] || 0) || undefined,
  })
}

async function mutateCommunityWork(path: string, options: RequestInit): Promise<CommunityWorkItem> {
  const response = await fetch(path, {
    credentials: 'include',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...options.headers },
    ...options,
  })
  return normalizeWorkPayload(await readPayload(response))
}

/** 创建可继续编辑的作品草稿。 */
export function createCommunityWork(input: CommunityWorkInput): Promise<CommunityWorkItem> {
  return mutateCommunityWork('/api/v1/community/works', { method: 'POST', body: communityWorkBody(input) })
}

/** 完整更新作者自己的作品信息。 */
export function updateCommunityWork(workId: number, input: CommunityWorkInput): Promise<CommunityWorkItem> {
  return mutateCommunityWork(`/api/v1/community/works/${Math.floor(workId)}`, {
    method: 'PUT',
    body: communityWorkBody(input),
  })
}

/** 将草稿公开发布到创作者主页。 */
export function publishCommunityWork(workId: number): Promise<CommunityWorkItem> {
  return mutateCommunityWork(`/api/v1/community/works/${Math.floor(workId)}/publish`, { method: 'POST' })
}

/** 下架公开作品，保留在作者的作品管理中。 */
export function archiveCommunityWork(workId: number): Promise<CommunityWorkItem> {
  return mutateCommunityWork(`/api/v1/community/works/${Math.floor(workId)}/archive`, { method: 'POST' })
}
