/** 首页 IP 创作者与需求市场接口。 */

export interface CommunityIpProfile {
  id: number
  name: string
  category: string
  contentType: string
  followers: number
  averageOrderValue: number
  avatar: string
  bio: string
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

/** POST /api/v1/market/demands：为所选 IP 创建一条视频制作需求草稿。 */
export async function createIpDemand(profile: CommunityIpProfile, requirement: string): Promise<number> {
  const description = [`目标创作者：${profile.name}（用户ID：${profile.id}）`, requirement.trim()]
    .filter(Boolean)
    .join('\n\n')
  const response = await fetch('/api/v1/market/demands', {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: `与 ${profile.name} 合作制作视频`,
      description,
      category: 'video',
      budget_type: 'negotiable',
      budget_cents: 0,
      currency: 'CNY',
    }),
  })
  const payload = await readPayload(response)
  return number(payload?.data?.id, payload?.data?.demand_id)
}
