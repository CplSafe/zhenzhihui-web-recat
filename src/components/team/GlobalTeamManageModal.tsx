/*
  GlobalTeamManageModal — 团队管理弹窗的全局单例包装。
  由 ui store 的 teamManageOpen 开关驱动(侧栏「邀请成员」等处 openTeamManage() 唤出),
  空间 / 当前成员 / toast 从全局 store 读取,挂在 AppShell 一次,任意 2.1 页面可弹出。
*/
import TeamManagementModal from './TeamManagementModal'
import { useUiStore } from '@/stores/ui'
import { useCurrentWorkspace, useWorkspaceId, useCurrentMember, useCurrentUser } from '@/stores/workspaceSession'
import { useToast } from '@/composables/useToast'

/** 从当前会话注入真实空间、成员和用户身份，统一挂载团队管理弹窗。 */
export default function GlobalTeamManageModal() {
  const open = useUiStore((s) => s.teamManageOpen)
  const close = useUiStore((s) => s.closeTeamManage)
  const workspace = useCurrentWorkspace()
  const workspaceId = useWorkspaceId()
  const currentMember = useCurrentMember()
  const currentUser = useCurrentUser()
  const { showToast } = useToast()

  // 会话级用户 id(不随切换空间失效),供弹窗在成员列表里定位「我」→ 取当前空间下的真实角色。
  const sessionUserId = Number(currentUser?.id ?? currentUser?.user_id ?? currentUser?.userId ?? 0) || 0

  return (
    <TeamManagementModal
      open={open}
      workspaceId={workspaceId}
      workspace={workspace}
      currentMember={currentMember}
      sessionUserId={sessionUserId}
      onClose={close}
      onToast={showToast}
    />
  )
}
