import { isLogoutDraftWriteBlocked } from './logoutBarrier'

const PREFIX = 'zzh.refine-comment.v1:'
const keyFor = (ownerId: number, workspaceId: number, taskId: string) => `${PREFIX}${ownerId}:${workspaceId}:${taskId}`

export function loadRefineCommentDraft(ownerId: number, workspaceId: number, taskId: string): string {
  if (!ownerId || !workspaceId || !taskId) return ''
  try {
    return sessionStorage.getItem(keyFor(ownerId, workspaceId, taskId)) || ''
  } catch {
    return ''
  }
}

export function saveRefineCommentDraft(ownerId: number, workspaceId: number, taskId: string, value: string): boolean {
  if (!ownerId || !workspaceId || !taskId || isLogoutDraftWriteBlocked(ownerId)) return false
  try {
    const key = keyFor(ownerId, workspaceId, taskId)
    if (value) sessionStorage.setItem(key, value)
    else sessionStorage.removeItem(key)
    return true
  } catch {
    return false
  }
}

export function clearRefineCommentDraftsForUser(ownerId: string): void {
  const prefix = `${PREFIX}${ownerId}:`
  for (let index = sessionStorage.length - 1; index >= 0; index--) {
    const key = sessionStorage.key(index)
    if (key?.startsWith(prefix)) sessionStorage.removeItem(key)
  }
}
