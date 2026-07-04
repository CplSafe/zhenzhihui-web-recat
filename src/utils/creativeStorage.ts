/**
 * 创意工作流状态持久化（localStorage）
 * 读写完整工作流快照（creativeStoryboards / storyboardItems / timelineState 等），
 * 以及最近编辑项目的 workspaceId → projectId 映射。
 */
const STORAGE_KEY = 'zhenzhihui:creative-workflow:v1'
const LAST_PROJECT_PREFIX = 'zhenzhihui:last-creative-project:v1:'

function withStorage(fn, fallback?) {
  if (typeof window === 'undefined') return fallback
  try {
    const storage = window.localStorage
    if (!storage) return fallback
    return fn(storage)
  } catch {
    return fallback
  }
}

export function loadCreativeWorkflowState() {
  return withStorage((storage) => {
    const raw = storage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  }, null)
}

export function saveCreativeWorkflowState(state) {
  if (typeof window === 'undefined') return false
  try {
    window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(state))
    return true
  } catch (error) {
    // 配额超限/隐私模式导致本地草稿写入失败：后端草稿才是主存储，这里仅告警不阻塞流程。
    console.warn('[creativeStorage] 工作流快照写入 localStorage 失败（可能超出配额）', error)
    return false
  }
}

export function clearCreativeWorkflowState() {
  withStorage((storage) => storage.removeItem(STORAGE_KEY))
}

export function loadLastCreativeProjectId(workspaceId) {
  const ws = Number(workspaceId || 0)
  if (!Number.isFinite(ws) || ws <= 0) return 0
  return withStorage((storage) => {
    const raw = storage.getItem(`${LAST_PROJECT_PREFIX}${ws}`)
    const id = Number(raw || 0)
    return Number.isFinite(id) && id > 0 ? Math.floor(id) : 0
  }, 0)
}

export function saveLastCreativeProjectId(workspaceId, projectId) {
  const ws = Number(workspaceId || 0)
  const pid = Number(projectId || 0)
  if (!Number.isFinite(ws) || ws <= 0) return
  if (!Number.isFinite(pid) || pid <= 0) return
  withStorage((storage) => storage.setItem(`${LAST_PROJECT_PREFIX}${ws}`, String(Math.floor(pid))))
}

export function clearLastCreativeProjectId(workspaceId) {
  const ws = Number(workspaceId || 0)
  if (!Number.isFinite(ws) || ws <= 0) return
  withStorage((storage) => storage.removeItem(`${LAST_PROJECT_PREFIX}${ws}`))
}
