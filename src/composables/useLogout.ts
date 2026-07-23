/**
 * useLogout — 退出登录的共享逻辑(顶栏头像下拉与侧栏「设置」菜单复用同一实现)。
 * DEV 下走本地登出快捷路径;线上调 logoutSession,失败按 workflowGuards 决定是否仍清会话。
 */
import { useRef, useState } from 'react'
import { logoutSession, getAuthErrorMessage } from '@/api/auth'
import { useAuth } from '@/auth/AuthContext'
import { useToast } from '@/composables/useToast'
import { shouldClearSessionAfterLogoutFailure } from '@/utils/workflowGuards'
import { markDevLogout } from '@/App'

/** 返回统一的登出动作及进行中状态。 */
export function useLogout() {
  const { handleLogoutStart, handleLogoutCancelled, handleLogoutSuccess } = useAuth()
  const { showToast } = useToast()
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const loggingOutRef = useRef(false)

  /** 串行执行登出，防止用户连续点击产生并发会话清理。 */
  async function logout() {
    if (loggingOutRef.current) return
    loggingOutRef.current = true
    setIsLoggingOut(true)

    if (import.meta.env.DEV) {
      loggingOutRef.current = false
      setIsLoggingOut(false)
      markDevLogout()
      handleLogoutSuccess()
      return
    }

    handleLogoutStart()
    try {
      await logoutSession()
      showToast('已退出登录', 'success')
      loggingOutRef.current = false
      setIsLoggingOut(false)
      handleLogoutSuccess()
    } catch (error) {
      if (shouldClearSessionAfterLogoutFailure(error)) {
        loggingOutRef.current = false
        setIsLoggingOut(false)
        handleLogoutSuccess()
        return
      }
      handleLogoutCancelled()
      showToast(getAuthErrorMessage(error, '退出登录失败，请稍后重试'), 'error')
      loggingOutRef.current = false
      setIsLoggingOut(false)
    }
  }

  return { logout, isLoggingOut }
}
