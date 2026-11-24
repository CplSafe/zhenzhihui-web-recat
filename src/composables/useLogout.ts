/**
 * useLogout — 退出登录的共享逻辑(顶栏头像下拉与侧栏「设置」菜单复用同一实现)。
 * 未接入业务后端的开发环境使用本地登出，有业务后端时由服务端注销会话。
 */
import { useRef, useState } from 'react'
import { getAccountSwitchId } from '@/api/accountSwitch'
import { logoutSession, getAuthErrorMessage, isUnauthorizedAuthError } from '@/api/auth'
import { leaveAccountSwitch } from '@/api/viewAsUser'
import { useAuth } from '@/auth/AuthContext'
import { useToast } from '@/composables/useToast'
import { markDevLogout } from '@/utils/devAuth'
import { hasConfiguredDevBackend } from '@/utils/devBackend'

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

    const accountSwitchId = getAccountSwitchId()
    if (accountSwitchId) {
      try {
        await leaveAccountSwitch(accountSwitchId)
      } catch {
        showToast('暂时无法退出切换，请重试。', 'error')
        loggingOutRef.current = false
        setIsLoggingOut(false)
      }
      return
    }

    if (import.meta.env.DEV && !hasConfiguredDevBackend()) {
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
      if (isUnauthorizedAuthError(error)) {
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
