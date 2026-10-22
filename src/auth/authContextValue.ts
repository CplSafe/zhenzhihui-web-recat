import { createContext, type Context } from 'react'

export interface AuthContextValue {
  authSession: any
  isAuthenticated: boolean
  isCheckingSession: boolean
  authCheckError: string
  loadAuthSession: () => Promise<void>
  /** 登录成功;returnTo 为登录前被守卫拦下的站内路径(已校验),缺省落首页。 */
  handleLoginSuccess: (session?: any, returnTo?: string) => void
  handleLogoutStart: () => void
  handleLogoutCancelled: () => void
  handleLogoutSuccess: () => void
}

// 热更新保留 Context 对象身份；不在此保存会话值，也不绕过未挂载 Provider 的检查。
const hotData = import.meta.hot?.data
export const AuthContext: Context<AuthContextValue | null> =
  hotData?.authContext || createContext<AuthContextValue | null>(null)
if (hotData) hotData.authContext = AuthContext
