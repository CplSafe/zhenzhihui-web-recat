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
  writeProfileOverride(uid, { ...current, avatar: nextAvatar })
}

/** 在服务端头像为空时把本地覆盖应用到用户对象。 */
export function applyUserProfileOverrides(user: any): any {
  if (!user || typeof user !== 'object') return user
  const uid = pickUserProfileId(user)
  if (!uid) return user
  const override = readProfileOverride(uid)
  const cachedAvatar = String(override?.avatar || '').trim()
  const serverAvatar = String(user?.avatar || user?.avatar_url || user?.avatarUrl || '').trim()
  if (!cachedAvatar || serverAvatar) return user
  return { ...user, avatar: cachedAvatar }
}
