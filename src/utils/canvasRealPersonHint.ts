const PREFIX = 'zzh.canvas.real-person-hint.v1:'
const seen = new Set<string>()

/** Shared across canvas instances and tabs; refreshed only at a login boundary. */
export function claimCanvasRealPersonHint(userId: string): boolean {
  if (!userId || seen.has(userId)) return false
  try {
    if (localStorage.getItem(PREFIX + userId)) return false
    localStorage.setItem(PREFIX + userId, '1')
  } catch {
    // Still deduplicate in memory when browser storage is unavailable.
  }
  seen.add(userId)
  return true
}

export function resetCanvasRealPersonHint(userId: string): void {
  seen.delete(userId)
  try {
    localStorage.removeItem(PREFIX + userId)
  } catch {
    // Storage may be unavailable.
  }
}
