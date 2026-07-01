/*
  GlobalJoinTeamDialog — 加入空间弹窗的全局单例包装。
  由 ui store 的 joinTeamOpen 驱动(侧栏「加入空间」openJoinTeam() 唤出),
  提交邀请码走 store.joinTeam(redeemWorkspaceInvitation → 刷新空间 → 切到加入的团队空间)。
*/
import { useState } from 'react'
import JoinTeamDialog from '@/components/layout/JoinTeamDialog'
import { useUiStore } from '@/stores/ui'
import { useWorkspaceSessionStore } from '@/stores/workspaceSession'
import { useToast } from '@/composables/useToast'
import { getBusinessErrorMessage } from '@/api/business'

export default function GlobalJoinTeamDialog() {
  const open = useUiStore((s) => s.joinTeamOpen)
  const close = useUiStore((s) => s.closeJoinTeam)
  const joinTeam = useWorkspaceSessionStore((s) => s.joinTeam)
  const { showToast } = useToast()
  const [loading, setLoading] = useState(false)

  const handleSubmit = async ({ inviteCode }: { inviteCode: string }) => {
    const code = String(inviteCode || '').trim()
    if (!code || loading) return
    setLoading(true)
    try {
      await joinTeam(code)
      showToast('已加入团队空间', 'success')
      close()
    } catch (e: any) {
      showToast(getBusinessErrorMessage(e, '加入失败,请确认邀请码是否正确/有效'), 'error')
    } finally {
      setLoading(false)
    }
  }

  return <JoinTeamDialog open={open} loading={loading} onClose={close} onSubmit={handleSubmit} />
}
