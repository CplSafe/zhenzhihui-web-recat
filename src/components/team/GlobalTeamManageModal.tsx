/*
  GlobalTeamManageModal — 团队管理弹窗的全局单例包装。
  由 ui store 的 teamManageOpen 开关驱动(侧栏「邀请成员」等处 openTeamManage() 唤出),
  空间 / 当前成员 / toast 从全局 store 读取,挂在 AppShell 一次,任意 2.1 页面可弹出。
*/
import TeamManagementModal from './TeamManagementModal'
import { useUiStore } from '@/stores/ui'
import { useCurrentWorkspace, useWorkspaceId, useCurrentMember } from '@/stores/workspaceSession'
import { useToast } from '@/composables/useToast'

export default function GlobalTeamManageModal() {
  const open = useUiStore((s) => s.teamManageOpen)
  const initialTab = useUiStore((s) => s.teamManageTab)
  const close = useUiStore((s) => s.closeTeamManage)
  const workspace = useCurrentWorkspace()
  const workspaceId = useWorkspaceId()
  const currentMember = useCurrentMember()
  const { showToast } = useToast()

  return (
    <TeamManagementModal
      open={open}
      initialTab={initialTab}
      workspaceId={workspaceId}
      workspace={workspace}
      currentMember={currentMember}
      onClose={close}
      onToast={showToast}
    />
  )
}
