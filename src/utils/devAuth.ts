/** 开发环境主动登出的标记；独立于 App 以避免认证工具反向加载根组件。 */
export const DEV_LOGOUT_FLAG = '__zzh_dev_logout__'
export function markDevLogout(): void {
  ;(window as any)[DEV_LOGOUT_FLAG] = true
}
