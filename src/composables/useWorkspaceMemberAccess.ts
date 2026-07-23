/**
 * 模块职责：加载当前工作空间成员，并解析当前用户在该空间中的实际角色。
 * 请求结果会绑定 workspaceId，防止切换空间后旧响应覆盖新空间权限。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { listWorkspaceMembers } from '@/api/auth'
import { resolveUserId, resolveWorkspaceRole } from '@/utils/creativeDraftMetadata'

/** 未加载或空间不匹配时复用的稳定空数组，避免无效重渲染。 */
const EMPTY_WORKSPACE_MEMBERS: any[] = []

/** 返回当前空间的成员列表及当前用户角色，供项目查看、下载和删除权限判断复用。 */
export function useWorkspaceMemberAccess({
  workspaceId,
  currentUserId,
  currentWorkspace,
}: {
  workspaceId: number
  currentUserId: number
  currentWorkspace: any
}): {
  workspaceMembers: any[]
  currentWorkspaceRole: string
} {
  const [workspaceMembers, setWorkspaceMembers] = useState<any[]>([])
  const [membersWorkspaceId, setMembersWorkspaceId] = useState(0)
  const activeWorkspaceId = Number(workspaceId || 0)
  const effectiveWorkspaceMembers =
    membersWorkspaceId === activeWorkspaceId ? workspaceMembers : EMPTY_WORKSPACE_MEMBERS
  // 优先读取成员记录中的角色；成员接口尚未返回时才使用当前空间对象上的角色兜底。
  const currentWorkspaceRole = useMemo(() => {
    const member = effectiveWorkspaceMembers.find((item: any) => resolveUserId(item) === currentUserId)
    const currentWorkspaceId = Number(currentWorkspace?.id ?? currentWorkspace?.workspace_id ?? 0)
    return (
      resolveWorkspaceRole(member) ||
      (currentWorkspaceId > 0 && currentWorkspaceId === activeWorkspaceId ? resolveWorkspaceRole(currentWorkspace) : '')
    )
  }, [effectiveWorkspaceMembers, currentUserId, currentWorkspace, activeWorkspaceId])
  const workspaceIdRef = useRef(0)

  useEffect(() => {
    workspaceIdRef.current = activeWorkspaceId
  }, [activeWorkspaceId])

  useEffect(() => {
    // 每次切换空间先清空旧成员；异步响应还要再次核对 ref 中的最新空间。
    setWorkspaceMembers([])
    setMembersWorkspaceId(0)
    if (!activeWorkspaceId) return

    let cancelled = false
    listWorkspaceMembers(activeWorkspaceId)
      .then((result: any) => {
        if (!cancelled && workspaceIdRef.current === activeWorkspaceId) {
          setWorkspaceMembers(Array.isArray(result) ? result : [])
          setMembersWorkspaceId(activeWorkspaceId)
        }
      })
      .catch(() => {
        if (!cancelled && workspaceIdRef.current === activeWorkspaceId) {
          setWorkspaceMembers([])
          setMembersWorkspaceId(activeWorkspaceId)
        }
      })
    return () => {
      cancelled = true
    }
  }, [activeWorkspaceId])

  return {
    workspaceMembers: effectiveWorkspaceMembers,
    currentWorkspaceRole,
  }
}
