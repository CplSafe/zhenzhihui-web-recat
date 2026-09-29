/**
 * 列表页「先显示上次数据、后台再刷新」的内存缓存。
 *
 * 项目管理、画布列表、我的素材这些页面每次进入都要等接口回来才有内容。这里把最近一次
 * 拉到的列表留在内存里：再进这一页时先用它把页面画出来，同时照常请求最新数据覆盖。
 *
 * 刻意只放内存、不进 sessionStorage：列表项里可能带着签名媒体地址（封面、预览），
 * 签名地址会过期，不能落成持久状态（见 CLAUDE.md「Signed media URLs expire」）。
 * 同样的原因加了最长保留时间：超过 MAX_AGE_MS 的缓存直接视为没有，宁可多转一次圈，
 * 也不拿一批可能已经过期的地址去渲染。
 *
 * 键必须带上工作空间和用户：切空间 / 换账号时绝不能先闪出别人的数据。
 */

const MAX_AGE_MS = 10 * 60_000

interface Entry {
  value: unknown
  ts: number
}

const cache = new Map<string, Entry>()

/** 拼缓存键：页面名 + 工作空间 + 用户 + 可选的额外维度（筛选条件等） */
export function pageCacheKey(page: string, workspaceId: unknown, userId: unknown, ...extra: unknown[]): string {
  return [page, Number(workspaceId || 0), Number(userId || 0), ...extra.map((part) => String(part ?? ''))].join('|')
}

/** 读缓存；没有、过期、或工作空间为空时返回 undefined */
export function readPageCache<T>(key: string): T | undefined {
  const entry = cache.get(key)
  if (!entry) return undefined
  if (Date.now() - entry.ts > MAX_AGE_MS) {
    cache.delete(key)
    return undefined
  }
  return entry.value as T
}

/** 写缓存（每次拿到最新列表、或本地增删改后调用） */
export function writePageCache<T>(key: string, value: T): void {
  cache.set(key, { value, ts: Date.now() })
}

/** 退出登录 / 切账号时清空 */
export function clearPageCache(): void {
  cache.clear()
}
