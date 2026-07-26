import { useCallback, useEffect, useMemo, useState } from 'react'
import { getDistributionOverview } from '@/api/business'
import { useCurrentUser, useWorkspaceId } from '@/stores/workspaceSession'

export type DistributionAccessStatus = 'idle' | 'checking' | 'allowed' | 'denied' | 'error'

interface AccessCacheEntry {
  status: Exclude<DistributionAccessStatus, 'idle' | 'checking'>
  overview: any
  error: unknown
}

const accessCache = new Map<string, AccessCacheEntry>()
const accessRequests = new Map<string, Promise<AccessCacheEntry>>()

function unwrapOverview(overview: any): any {
  return overview?.data && typeof overview.data === 'object' && !Array.isArray(overview.data) ? overview.data : overview
}

/** 兼容后端以 HTTP 200 返回“不是分销人员”的业务响应。 */
export function isDistributionAccessGranted(overview: any): boolean {
  const source = unwrapOverview(overview)
  if (!source || typeof source !== 'object' || Array.isArray(source)) return false

  const explicitFlags = [
    source.is_distributor,
    source.isDistributor,
    source.is_marketer,
    source.isMarketer,
    source.distributor_enabled,
    source.distributorEnabled,
    source.can_view_distribution,
    source.canViewDistribution,
  ].filter((value) => value !== undefined && value !== null)
  if (explicitFlags.length) {
    return explicitFlags.some((value) => value === true || value === 1 || String(value).toLowerCase() === 'true')
  }

  const status = String(
    source.distributor_status ?? source.distributorStatus ?? source.status ?? source.account_status ?? '',
  )
    .trim()
    .toLowerCase()
  if (status) {
    if (['active', 'approved', 'enabled', 'normal', 'verified'].includes(status)) return true
    if (
      ['inactive', 'disabled', 'rejected', 'pending', 'none', 'not_distributor', 'non_distributor'].includes(status)
    ) {
      return false
    }
  }

  const roles = [
    ...(Array.isArray(source.roles) ? source.roles : []),
    source.role,
    source.user_role,
    source.userRole,
    source.distributor_role,
  ]
    .filter(Boolean)
    .map((value) => String(value).trim().toLowerCase())
  if (roles.length) {
    return roles.some((role) => ['distributor', 'sales', 'marketing', 'marketer'].includes(role))
  }

  // 兼容旧版概览：没有权限字段，但确实返回了分销账户或收益指标。
  return [
    source.distributor_id,
    source.distributorId,
    source.invite_code,
    source.inviteCode,
    source.total_commission,
    source.total_commission_amount,
    source.withdrawable_amount,
    source.pending_amount,
  ].some((value) => value !== undefined && value !== null)
}

function isDistributionDeniedError(error: any): boolean {
  if (Number(error?.status || 0) === 403) return true
  const message = String(error?.message || error?.response?.message || error?.response?.msg || '').toLowerCase()
  return /不是.*分销|非分销|无分销权限|not[\s_-]*(a[\s_-]*)?distributor|non[\s_-]*distributor/.test(message)
}

function getUserKey(user: any): string {
  return String(user?.id ?? user?.user_id ?? user?.userId ?? user?.uid ?? '').trim()
}

function requestAccess(userKey: string, revalidate = false): Promise<AccessCacheEntry> {
  const cached = revalidate ? null : accessCache.get(userKey)
  if (cached) return Promise.resolve(cached)
  const pending = accessRequests.get(userKey)
  if (pending) return pending

  const request = getDistributionOverview()
    .then((overview) => {
      const allowed = isDistributionAccessGranted(overview)
      return {
        status: allowed ? 'allowed' : 'denied',
        overview: allowed ? overview : null,
        error: null,
      } as AccessCacheEntry
    })
    .catch(
      (error: any) =>
        ({
          status: isDistributionDeniedError(error) ? 'denied' : 'error',
          overview: null,
          error,
        }) as AccessCacheEntry,
    )
    .then((entry) => {
      accessCache.set(userKey, entry)
      accessRequests.delete(userKey)
      return entry
    })

  accessRequests.set(userKey, request)
  return request
}

/** 用分销概览接口同时完成营销身份识别与首屏概览预取。 */
export function useDistributionAccess() {
  const user = useCurrentUser()
  const workspaceId = useWorkspaceId()
  const userKey = useMemo(() => {
    const identity = getUserKey(user)
    return identity ? `${identity}:${Number(workspaceId || 0) || 'account'}` : ''
  }, [user, workspaceId])
  const [state, setState] = useState<{
    status: DistributionAccessStatus
    overview: any
    error: unknown
  }>(() => {
    const cached = userKey ? accessCache.get(userKey) : null
    return cached || { status: userKey ? 'checking' : 'idle', overview: null, error: null }
  })

  useEffect(() => {
    let active = true
    if (!userKey) {
      setState({ status: 'idle', overview: null, error: null })
      return () => {
        active = false
      }
    }
    const cached = accessCache.get(userKey)
    if (cached) {
      setState(cached)
    } else {
      setState({ status: 'checking', overview: null, error: null })
    }
    // 缓存只用于避免入口闪烁；每次组件挂载都后台重取概览，确保邀请人数和金额不会长期陈旧。
    void requestAccess(userKey, Boolean(cached)).then((entry) => {
      if (active) setState(entry)
    })
    return () => {
      active = false
    }
  }, [userKey])

  const retry = useCallback(() => {
    if (!userKey) return
    accessCache.delete(userKey)
    void requestAccess(userKey, true).then(setState)
  }, [userKey])

  return { ...state, retry, isDistributor: state.status === 'allowed' }
}
