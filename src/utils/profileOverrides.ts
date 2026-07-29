/**
 * 用户资料本地覆盖工具：在服务端资料接口尚未返回新值时保留头像更新结果。
 * 覆盖按用户 ID 隔离；一旦服务端已有头像便以服务端数据为准。
 */
/** 将用户标识规范化为数字。 */
const toId = (value: any): number => Number(value) || 0
/** 构建按用户隔离的资料覆盖存储键。 */
const PROFILE_OVERRIDE_KEY = (uid: any) => `zzh_profile_override_u${toId(uid) || 'anon'}`

/** 读取指定用户的本地资料覆盖。 */
function readProfileOverride(uid: any): Record<string, any> {
  const id = toId(uid)
  if (!id) return {}
  try {
    const raw = window.localStorage.getItem(PROFILE_OVERRIDE_KEY(id))
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** 写入资料覆盖；空对象会删除存储项。 */
function writeProfileOverride(uid: any, payload: Record<string, any>) {
  const id = toId(uid)
  if (!id) return
  try {
    const next = payload && typeof payload === 'object' ? payload : {}
    if (!Object.keys(next).length) {
      window.localStorage.removeItem(PROFILE_OVERRIDE_KEY(id))
      return
    }
    window.localStorage.setItem(PROFILE_OVERRIDE_KEY(id), JSON.stringify(next))
  } catch {
    /* ignore storage failures */
  }
}

/** 从兼容的用户字段中选择稳定用户 ID。 */
export function pickUserProfileId(user: any): number {
  return toId(user?.id || user?.user_id || user?.userId)
}

/** 保存或清除当前用户的本地头像覆盖。 */
export function saveUserAvatarOverride(user: any, avatar: string) {
  const uid = pickUserProfileId(user)
  if (!uid) return
  const nextAvatar = String(avatar || '').trim()
  const current = readProfileOverride(uid)
  if (!nextAvatar) {
    const { avatar: _avatar, ...rest } = current
    writeProfileOverride(uid, rest)
    return
  }
  writeProfileOverride(uid, { ...current, avatar: nextAvatar, avatarUpdatedAt: Date.now() })
}

/** 去除仅用于刷新浏览器图片缓存的版本参数，便于比较是否仍是同一个头像资源。 */
function avatarIdentity(value: string): string {
  const raw = String(value || '').trim()
  if (!raw || /^data:|^blob:/i.test(raw)) return raw
  try {
    const url = new URL(raw, window.location.origin)
    url.searchParams.delete('_profile_v')
    return `${url.origin}${url.pathname}${url.search}`
  } catch {
    return raw.replace(/([?&])_profile_v=\d+(&|$)/, '$1').replace(/[?&]$/, '')
  }
}

/** 给非签名头像地址追加版本参数，避免保存成功后浏览器继续显示旧缓存。 */
export function bustUserAvatarCache(avatar: string): string {
  const raw = String(avatar || '').trim()
  if (!raw || /^data:|^blob:/i.test(raw) || /X-Amz-(?:Signature|Credential)/i.test(raw)) return raw
  try {
    const url = new URL(raw, window.location.origin)
    url.searchParams.set('_profile_v', String(Date.now()))
    if (/^https?:/i.test(raw)) return url.toString()
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return raw
  }
}

/** 在服务端未返回新头像或仍返回同一资源地址时应用带缓存版本的本地覆盖。 */
export function applyUserProfileOverrides(user: any): any {
  if (!user || typeof user !== 'object') return user
  const uid = pickUserProfileId(user)
  if (!uid) return user
  const override = readProfileOverride(uid)
  const cachedAvatar = String(override?.avatar || '').trim()
  const serverAvatar = String(user?.avatar || user?.avatar_url || user?.avatarUrl || '').trim()
  if (!cachedAvatar) return user
  if (serverAvatar && avatarIdentity(serverAvatar) !== avatarIdentity(cachedAvatar)) return user
  return { ...user, avatar: cachedAvatar, avatar_url: cachedAvatar, avatarUrl: cachedAvatar }
}
