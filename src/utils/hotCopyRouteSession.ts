export interface HotCopyRouteState {
  hotCopyCreationBindProjectId?: number | string
  hotCopyCreationBindSessionToken?: string
  hotCopyCreationBindWorkspaceId?: number | string
  taskCenterNewSession?: boolean
  workspaceSwitchReset?: boolean
  restartProjectId?: number | string
}

export interface HotCopyRouteSession {
  workspaceId: number
  projectId: string
  version: number
  locationKey: string
  mountNonce: string
}

export function getHotCopyRouteSessionToken(session: HotCopyRouteSession): string {
  return `${session.mountNonce}:${session.version}`
}

/**
 * Keep the current editor mounted while a newly-created project is first bound
 * to /hot-copy/:id. Real project/workspace/new-session switches still get a
 * fresh editor instance so state cannot leak between creative sessions.
 */
export function resolveHotCopyRouteSession(
  current: HotCopyRouteSession,
  input: {
    workspaceId: number
    projectId: string
    locationKey: string
    routeState: HotCopyRouteState
  },
): HotCopyRouteSession {
  const { workspaceId, projectId, locationKey, routeState } = input
  const creationBindProjectId = String(routeState.hotCopyCreationBindProjectId || '')
  const creationBindSessionToken = String(routeState.hotCopyCreationBindSessionToken || '')
  const creationBindWorkspaceId = Number(routeState.hotCopyCreationBindWorkspaceId || 0)
  const isCurrentCreationBinding =
    !current.projectId &&
    !!projectId &&
    creationBindProjectId === projectId &&
    creationBindWorkspaceId === workspaceId &&
    creationBindSessionToken === getHotCopyRouteSessionToken(current)
  const isExplicitNewSessionNavigation =
    !current.projectId &&
    !projectId &&
    current.locationKey !== locationKey &&
    !!(routeState.taskCenterNewSession || routeState.workspaceSwitchReset || routeState.restartProjectId)

  if (
    current.workspaceId !== workspaceId ||
    (current.projectId !== projectId && !isCurrentCreationBinding) ||
    isExplicitNewSessionNavigation
  ) {
    return {
      ...current,
      workspaceId,
      projectId,
      version: current.version + 1,
      locationKey,
    }
  }
  if (isCurrentCreationBinding) return { ...current, projectId, locationKey }
  if (current.locationKey !== locationKey) return { ...current, locationKey }
  return current
}
