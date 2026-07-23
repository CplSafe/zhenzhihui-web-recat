/**
 * 模块职责：安全切换工作空间，并在必要时先卸载创作页，防止旧页面把草稿写进新空间。
 */
import { useCallback, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  deriveAllWorkspaces,
  deriveCurrentWorkspace,
  deriveWorkspaceId,
  useWorkspaceSessionStore,
} from '@/stores/workspaceSession'
import { useUiStore } from '@/stores/ui'

/** 工作空间切换时使用的中转路由。 */
export const WORKSPACE_SWITCH_BRIDGE_PATH = '/workspace-switch'

/** 兼容不同后端字段，判断一个工作空间是否为个人空间。 */
export const isPersonalWorkspace = (workspace: any): boolean => {
  const type = String(workspace?.type || workspace?.workspace_type || workspace?.workspaceType || '')
    .trim()
    .toLowerCase()
  if (type) return type === 'personal'
  if (typeof workspace?.is_personal === 'boolean') return workspace.is_personal
  if (typeof workspace?.isPersonal === 'boolean') return workspace.isPersonal
  return String(workspace?.name || '').trim() === '个人空间'
}

/**
 * 根据当前路径及个人/团队边界，决定切换空间后是否要回到空白创作入口。
 */
export const resolveWorkspaceSwitchResetPath = (
  pathname: string,
  currentWorkspace: any,
  targetWorkspace: any,
): '/smart' | '/hot-copy' | null => {
  const path = String(pathname || '')
  const inSmartProject = /^\/smart\/[^/]+/.test(path)
  const inSmartBlank = path === '/smart'
  const inHotCopy = path === '/hot-copy' || path.startsWith('/hot-copy/')
  const crossesPersonalBoundary =
    Boolean(currentWorkspace) &&
    Boolean(targetWorkspace) &&
    isPersonalWorkspace(currentWorkspace) !== isPersonalWorkspace(targetWorkspace)

  if ((inSmartProject && crossesPersonalBoundary) || inSmartBlank) return '/smart'
  if (inHotCopy) return '/hot-copy'
  return null
}

/** 安全切换空间时的源空间与锁处理选项。 */
export interface SafeWorkspaceSwitchOptions {
  /**
   * 退出/解散操作从 store 删除空间前捕获的源空间，用于保留个人/团队边界判断。
   */
  sourceWorkspace?: any
  /**
   * 仅在退出/解散等后端操作已经成功、当前空间已不再有效时允许越过切换锁。
   */
  allowLockedTransition?: boolean
  /** 后台恢复循环等待时不重复弹出提示。 */
  suppressLockedToast?: boolean
}

/**
 * 在错误工作空间挂载创作页之前完成安全切换。
 * 中转页会在源空间仍有效时同步卸载旧创作页，让它先保存自己的草稿；清理完成后才更新空间并挂载目标入口。
 */
export function useSafeWorkspaceSwitch() {
  const navigate = useNavigate()
  const location = useLocation()
  const pathnameRef = useRef(location.pathname)
  pathnameRef.current = location.pathname

  return useCallback(
    (workspaceId: number, options?: SafeWorkspaceSwitchOptions) => {
      // 视频处理等关键阶段会加全局切换锁，普通切换必须尊重该锁。
      const ui = useUiStore.getState()
      if (ui.workspaceSwitchLocked && !options?.allowLockedTransition) {
        if (!options?.suppressLockedToast) {
          ui.showToast(ui.workspaceSwitchLockReason || '当前视频处理中，暂不支持切换团队', 'info')
        }
        return false
      }
      const targetId = Number(workspaceId || 0)
      const store = useWorkspaceSessionStore.getState()
      const activeWorkspaceId = deriveWorkspaceId(store)
      const workspaces = deriveAllWorkspaces(store)
      const currentWorkspace = options?.sourceWorkspace || deriveCurrentWorkspace(store)
      const sourceWorkspaceId = Number(currentWorkspace?.id || 0)
      if (!targetId || (targetId === activeWorkspaceId && sourceWorkspaceId === targetId)) return false
      const targetWorkspace = (workspaces as any[]).find((workspace) => Number(workspace?.id || 0) === targetId)
      const resetPath = resolveWorkspaceSwitchResetPath(pathnameRef.current, currentWorkspace, targetWorkspace)

      // 创作页先进入桥接路由触发卸载保存，再真正切换 store 中的工作空间。
      if (resetPath) {
        navigate(WORKSPACE_SWITCH_BRIDGE_PATH, {
          replace: true,
          flushSync: true,
          state: { workspaceSwitchInProgress: true },
        })
      }

      useWorkspaceSessionStore
        .getState()
        .switchWorkspace(targetId, { forceMemberReload: sourceWorkspaceId > 0 && sourceWorkspaceId !== targetId })

      if (resetPath) {
        navigate(resetPath, {
          replace: true,
          flushSync: true,
          state: { workspaceSwitchReset: true, workspaceSwitchNonce: Date.now() },
        })
      }
      return true
    },
    [navigate],
  )
}
