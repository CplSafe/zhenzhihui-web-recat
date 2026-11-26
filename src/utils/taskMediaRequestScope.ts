import { getAuthRequestScope, isAuthRequestScopeCurrent } from '@/api/authRequestScope'

export interface TaskMediaRequestScope {
  authScope: number
  signal?: AbortSignal
}

export function captureTaskMediaRequestScope(signal?: AbortSignal): TaskMediaRequestScope {
  return { authScope: getAuthRequestScope(), signal }
}

export function assertTaskMediaRequestScope(scope?: TaskMediaRequestScope): void {
  if (scope?.signal?.aborted || (scope && !isAuthRequestScopeCurrent(scope.authScope))) {
    throw Object.assign(new Error('任务产物查询已中止'), { cause: 'aborted' })
  }
}
