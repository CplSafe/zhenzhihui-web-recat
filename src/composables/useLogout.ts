/**
 * useLogout — 退出登录的共享逻辑(顶栏头像下拉与侧栏「设置」菜单复用同一实现)。
 * DEV 下走本地登出快捷路径;线上调 logoutSession,失败按 workflowGuards 决定是否仍清会话。
 */
import { useState } from 'react'
import { logoutSession, getAuthErrorMessage } from '@/api/auth'
import { useAuth } from '@/auth/AuthContext'
import { useToast } from '@/composables/useToast'
import { shouldClearSessionAfterLogoutFailure } from '@/utils/workflowGuards'
import { markDevLogout } from '@/App'

export function useLogout() {
  const { handleLogoutSuccess } = useAuth()
  const { showToast } = useToast()
  const [isLoggingOut, setIsLoggingOut] = useState(false)

  async function logout() {
    if (isLoggingOut) return
    setIsLoggingOut(true)

    if (import.meta.env.DEV) {
      setIsLoggingOut(false)
      markDevLogout()
      handleLogoutSuccess()
      return
    }

    try {
      await logoutSession()
      showToast('已退出登录', 'success')
      setIsLoggingOut(false)
      handleLogoutSuccess()
    } catch (error) {
      if (shouldClearSessionAfterLogoutFailure(error)) {
        setIsLoggingOut(false)
        handleLogoutSuccess()
        return
      }
      showToast(getAuthErrorMessage(error, '退出登录失败，请稍后重试'), 'error')
      setIsLoggingOut(false)
    }
  }

  return { logout, isLoggingOut }
}
