/*
  GlobalJoinTeamDialog — 加入空间弹窗的全局单例包装。
  由 ui store 的 joinTeamOpen 驱动(侧栏「加入空间」openJoinTeam() 唤出),
  提交邀请码走 store.joinTeam(redeemWorkspaceInvitation → 刷新空间 → 切到加入的团队空间)。
*/
import { useEffect, useRef, useState } from 'react'
import JoinTeamDialog from '@/components/layout/JoinTeamDialog'
import { useUiStore } from '@/stores/ui'
import { useWorkspaceSessionStore } from '@/stores/workspaceSession'
import { useToast } from '@/composables/useToast'
import { getBusinessErrorMessage } from '@/api/business'
import { useSafeWorkspaceSwitch } from '@/composables/useSafeWorkspaceSwitch'

/**
 * 连接全局弹窗状态、加入团队接口与安全空间切换；用提交 epoch 防止关闭后旧响应回写新弹窗。
 */
export default function GlobalJoinTeamDialog() {
  const open = useUiStore((s) => s.joinTeamOpen)
  const close = useUiStore((s) => s.closeJoinTeam)
  const workspaceSwitchLocked = useUiStore((s) => s.workspaceSwitchLocked)
  const workspaceSwitchLockReason = useUiStore((s) => s.workspaceSwitchLockReason)
  const joinTeam = useWorkspaceSessionStore((s) => s.joinTeam)
  const switchWorkspaceSafely = useSafeWorkspaceSwitch()
  const { showToast } = useToast()
  const [loading, setLoading] = useState(false)
  const submissionEpochRef = useRef(0)
  const openRef = useRef(open)
  openRef.current = open

  useEffect(() => {
    if (open) return
    submissionEpochRef.current += 1
    setLoading(false)
  }, [open])

  const handleSubmit = async ({ inviteCode }: { inviteCode: string }) => {
    const code = String(inviteCode || '').trim()
    if (!code || loading) return
    if (workspaceSwitchLocked) {
      showToast(workspaceSwitchLockReason || '当前视频处理中，暂不支持切换团队', 'info')
      return
    }
    const submissionEpoch = ++submissionEpochRef.current
    const isCurrentSubmission = () => openRef.current && submissionEpochRef.current === submissionEpoch
    setLoading(true)
    try {
      const transition = await joinTeam(code)
      if (!isCurrentSubmission()) return
      if (transition.workspaceId) {
        const switched = switchWorkspaceSafely(transition.workspaceId, {
          sourceWorkspace: transition.sourceWorkspace,
        })
        if (!switched) throw new Error(workspaceSwitchLockReason || '当前暂不支持切换团队')
      }
      if (!isCurrentSubmission()) return
      showToast('已加入团队空间', 'success')
      close()
    } catch (e: any) {
      if (isCurrentSubmission()) {
        showToast(getBusinessErrorMessage(e, '加入失败,请确认邀请码是否正确/有效'), 'error')
      }
    } finally {
      if (isCurrentSubmission()) setLoading(false)
    }
  }

  return <JoinTeamDialog open={open} loading={loading} onClose={close} onSubmit={handleSubmit} />
}
