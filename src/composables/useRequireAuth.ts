/**
 * useRequireAuth — 需要登录的操作守卫
 * 已登录 → 返回 true 并执行回调
 * 未登录 → 弹窗确认，用户同意后跳转登录页
 */
import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { useConfirmDialog } from '@/composables/useToast'

/** 返回“需要登录才能执行”的异步动作守卫。 */
export function useRequireAuth() {
  const navigate = useNavigate()
  const { isAuthenticated } = useAuth()
  const { requestConfirm } = useConfirmDialog()

  // 返回稳定的动作守卫，调用方可在登录成功分支内直接执行原操作。
  const requireAuth = useCallback(
    async (onAuthenticated?: () => void): Promise<boolean> => {
      if (isAuthenticated) {
        onAuthenticated?.()
        return true
      }

      const result = await requestConfirm('登录后即可使用此功能', {
        title: '需要登录',
        confirmLabel: '去登录',
        cancelLabel: '取消',
      })

      if (result) {
        navigate('/login')
      }

      return false
    },
    [isAuthenticated, navigate, requestConfirm],
  )

  return requireAuth
}
