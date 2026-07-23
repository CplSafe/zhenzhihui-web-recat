/**
 * 登录桥接诊断信息构建：仅记录跳转阶段与缺失能力，不包含认证对象、令牌或完整 URL。
 * 输出用于生产可观测平台定位静默登录失败，同时遵循最小化采集原则。
 */
/** 登录桥接可能产生的安全诊断原因。 */
export type LoginBridgeWarningReason = 'navigation_url_missing' | 'silent_bridge_unavailable'

/** 构建登录桥接诊断所需的非敏感输入。 */
export interface LoginBridgeDiagnosticInput {
  reason: LoginBridgeWarningReason
  oauthStart?: unknown
  authResult?: unknown
  navigationUrl?: unknown
}

/** 可安全写入日志平台的登录桥接诊断结构。 */
export interface LoginBridgeDiagnostic {
  reason: LoginBridgeWarningReason
  hasOauthStart: boolean
  hasAuthResult: boolean
  navigationTarget: 'missing' | 'root' | 'available'
}

/** 构建可安全上传的登录诊断，仅暴露存在性标记和固定枚举，不记录认证对象或跳转 URL。 */
export function createLoginBridgeDiagnostic({
  reason,
  oauthStart,
  authResult,
  navigationUrl,
}: LoginBridgeDiagnosticInput): LoginBridgeDiagnostic {
  const navigationTarget =
    typeof navigationUrl !== 'string' || navigationUrl.length === 0
      ? 'missing'
      : navigationUrl === '/'
        ? 'root'
        : 'available'

  return {
    reason,
    hasOauthStart: oauthStart !== null && oauthStart !== undefined,
    hasAuthResult: authResult !== null && authResult !== undefined,
    navigationTarget,
  }
}
