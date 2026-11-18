export const DEFAULT_TEAM_INVITATION_DAYS = 7

function storageKey(userId: string | number, workspaceId: number) {
  return `zzh_team_initial_invitation:${userId}:${workspaceId}`
}

export function markInitialTeamInvitation(userId: string | number, workspaceId: number) {
  if (!Number(userId) || !workspaceId) return
  try {
    const key = storageKey(userId, workspaceId)
    if (localStorage.getItem(key) === null) localStorage.setItem(key, 'pending')
  } catch {
    // 浏览器禁用本地存储时，仍可手动生成。
  }
}

export function consumeInitialTeamInvitation(userId: number, workspaceId: number) {
  try {
    const key = storageKey(userId, workspaceId)
    if (localStorage.getItem(key) !== 'pending') return false
    localStorage.setItem(key, 'handled')
    return true
  } catch {
    return false
  }
}
