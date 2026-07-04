const toId = (value: any): number => Number(value) || 0
const PROFILE_OVERRIDE_KEY = (uid: any) => `zzh_profile_override_u${toId(uid) || 'anon'}`

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

export function pickUserProfileId(user: any): number {
  return toId(user?.id || user?.user_id || user?.userId)
}

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
