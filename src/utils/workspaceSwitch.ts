const BEFORE_WORKSPACE_SWITCH_EVENT = 'zzh:before-workspace-switch'

export interface WorkspaceSwitchPreparationDetail {
  targetWorkspaceId: number
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
    waitUntil: [],
  }
  window.dispatchEvent(new CustomEvent<WorkspaceSwitchPreparationDetail>(BEFORE_WORKSPACE_SWITCH_EVENT, { detail }))
  return {
    detail,
    done: Promise.all(detail.waitUntil).then(() => undefined),
  }
}

export function onBeforeWorkspaceSwitch(listener: (detail: WorkspaceSwitchPreparationDetail) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<WorkspaceSwitchPreparationDetail>).detail)
  window.addEventListener(BEFORE_WORKSPACE_SWITCH_EVENT, handler)
  return () => window.removeEventListener(BEFORE_WORKSPACE_SWITCH_EVENT, handler)
}
