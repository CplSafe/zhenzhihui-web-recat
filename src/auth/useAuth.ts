import { useContext } from 'react'
import { AuthContext, type AuthContextValue } from './authContextValue'

/** 必须从同一个认证 Context 读取，不用空对象掩盖 Provider 缺失。 */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth 必须在 <AuthProvider> 内使用')
  return context
}
