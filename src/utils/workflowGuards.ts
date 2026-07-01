/**
 * 会话守卫纯函数(从 Vue 版原样迁移)。
 * 说明:此前还有分镜/时间线步骤守卫(canStartXxx / getXxxBlockReason),随旧流程下线后已无任何调用,已删除。
 */
export function shouldRequestAuthenticatedSession(hasSessionMarker) {
  return hasSessionMarker === true
}

export function shouldClearSessionAfterLogoutFailure(error) {
  return Number(error?.status || 0) === 401
}
