/**
 * AI 模型套餐计划候选解析
 * 从 auth session 中提取用户当前套餐信息，构建 model plan candidates 列表（free / pro / max 等），
 * 用于 submitWithPlanCandidates 的逐级降级请求。
 */
export const DEFAULT_MODEL_PLAN_CANDIDATES = ['free']

export function buildModelPlanCandidatesFromSession(
  authSession,
  workspace,
  member,
  { fallback = DEFAULT_MODEL_PLAN_CANDIDATES } = {},
) {
  const workspaceFromSession = workspace || authSession?.workspaces?.[0] || null
  const memberFromSession = member || authSession?.currentMember || null
  const candidates = [
    authSession?.plan,
    authSession?.plan_code,
    authSession?.current_plan,
    authSession?.current_plan_code,
    authSession?.subscription?.plan,
    authSession?.subscription?.plan_code,
    authSession?.active_subscription?.plan,
    authSession?.active_subscription?.plan_code,
    authSession?.activeSubscription?.plan,
    authSession?.activeSubscription?.plan_code,
    workspaceFromSession?.plan,
    workspaceFromSession?.plan_code,
    workspaceFromSession?.subscription?.plan,
    workspaceFromSession?.subscription?.plan_code,
    memberFromSession?.plan,
    memberFromSession?.plan_code,
  ]
    .flatMap(normalizeModelPlanCandidate)
    .filter(Boolean)

  return normalizePlanCandidates(candidates, fallback)
}

export function buildModelPlanCandidatesFromBilling({ subscriptions = [], plans = [] } = {}) {
  const planCodeById = new Map(
    (Array.isArray(plans) ? plans : [])
      .map((plan): [string, any] => [
        String(plan?.id ?? plan?.plan_id ?? ''),
        plan?.code || plan?.name || plan?.plan_code,
      ])
      .filter(([id, code]) => id && code),
  )

  const candidates = (Array.isArray(subscriptions) ? subscriptions : [])
    .filter(isCurrentActiveSubscription)
    .flatMap((subscription) => {
      const planId = String(subscription?.plan_id ?? subscription?.planId ?? subscription?.plan?.id ?? '')

      return normalizeModelPlanCandidate([
        subscription?.plan,
        subscription?.plan_code,
        subscription?.planCode,
        planCodeById.get(planId),
      ])
    })
    .filter(Boolean)

  return normalizePlanCandidates(candidates)
}

export function buildModelPlanCandidatesFromBillingPlans(plans = []) {
  const candidates = (Array.isArray(plans) ? plans : [])
    .flatMap((plan) => [plan?.code, plan?.plan_code, plan?.planCode, plan?.name])
    .filter(Boolean)

  return normalizePlanCandidates(candidates)
}

export function normalizePlanCandidates(planCandidates, fallback = DEFAULT_MODEL_PLAN_CANDIDATES) {
  const rawCandidates = Array.isArray(planCandidates) ? planCandidates : [planCandidates]
  const normalized = rawCandidates.flatMap(normalizeModelPlanCandidate).filter(Boolean)
  const candidates = normalized.length ? [...normalized, ...fallback] : fallback

  return [...new Set(candidates)]
}

export function normalizeModelPlanCandidate(value) {
  if (!value) {
    return []
  }

  if (Array.isArray(value)) {
    return value.flatMap(normalizeModelPlanCandidate)
  }

  if (typeof value === 'object') {
    return normalizeModelPlanCandidate(value.code || value.name || value.plan_code)
  }

  const plan = String(value).trim().toLowerCase()

  if (!plan) {
    return []
  }

  if (plan.includes('enterprise')) {
    return ['enterprise']
  }

  if (plan.includes('team') || plan.includes('团队')) {
    return ['team']
  }

  if (plan.includes('pro') || plan.includes('专业')) {
    return ['pro']
  }

  if (plan.includes('free') || plan.includes('starter')) {
    return ['free']
  }

  return [plan]
}

function isCurrentActiveSubscription(subscription) {
  if (String(subscription?.status || '').toLowerCase() !== 'active') {
    return false
  }

  const currentPeriodEnd = subscription?.current_period_end || subscription?.currentPeriodEnd

  if (!currentPeriodEnd) {
    return true
  }

  const expiresAt = new Date(currentPeriodEnd).getTime()

  return Number.isNaN(expiresAt) || expiresAt > Date.now()
}
