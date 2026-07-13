const BEFORE_WORKSPACE_SWITCH_EVENT = 'zzh:before-workspace-switch'
let workspaceSwitchIssuedSequence = 0
let currentWorkspaceSwitchToken = 0

export interface WorkspaceSwitchPreparationDetail {
  targetWorkspaceId: number
  /** 本次全局空间切换序号；任意页面发起下一次切换后，旧后台结果立即失效。 */
  switchToken: number
  /** 当前编辑器实际绑定的空间（可能与全局高亮空间不同）。 */
  sourceWorkspaceId?: number
  waitUntil: Promise<unknown>[]
  /** Editor-specific route to open after the target draft has been created. */
  destinationPath?: string
}

export interface WorkspaceSwitchPreparation {
  /** Synchronously available routing information collected from active editors. */
  detail: WorkspaceSwitchPreparationDetail
  /** Background persistence/recovery work. It never needs to block the workspace switch. */
  done: Promise<void>
}

/**
 * Notifies the active editor before the workspace store changes. Listeners
 * synchronously snapshot local state and may register background cloud work.
 */
export function prepareForWorkspaceSwitch(targetWorkspaceId: number): WorkspaceSwitchPreparation {
  const detail: WorkspaceSwitchPreparationDetail = {
    targetWorkspaceId: Number(targetWorkspaceId || 0),
    switchToken: ++workspaceSwitchIssuedSequence,
    waitUntil: [],
  }
  window.dispatchEvent(new CustomEvent<WorkspaceSwitchPreparationDetail>(BEFORE_WORKSPACE_SWITCH_EVENT, { detail }))
  // Smart 编辑器会在同步事件里回填实际 source。重复点击当前空间只是 no-op，
  // 不能因此淘汰上一轮仍在进行的合法后台恢复。
  if (!detail.sourceWorkspaceId || Number(detail.sourceWorkspaceId) !== detail.targetWorkspaceId) {
    currentWorkspaceSwitchToken = detail.switchToken
  }
  return {
    detail,
    done: Promise.all(detail.waitUntil).then(() => undefined),
  }
}

export function isCurrentWorkspaceSwitch(switchToken: number): boolean {
  return Number(switchToken || 0) > 0 && Number(switchToken) === currentWorkspaceSwitchToken
}

export function onBeforeWorkspaceSwitch(listener: (detail: WorkspaceSwitchPreparationDetail) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<WorkspaceSwitchPreparationDetail>).detail)
  window.addEventListener(BEFORE_WORKSPACE_SWITCH_EVENT, handler)
  return () => window.removeEventListener(BEFORE_WORKSPACE_SWITCH_EVENT, handler)
}
