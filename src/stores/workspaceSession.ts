/**
 * Zustand Store: 工作空间会话
 * 管理登录态、用户信息、工作空间列表、当前空间切换、成员/钱包/计费状态、应用初始化流程。
 *
 * 由 Vue/Pinia 的 composition store 移植而来。原 `computed` 派生值在此实现为纯函数
 * （derive*）+ selector hooks，`ref` 状态为 store 字段，`let` 闭包变量保留为模块级变量。
 */
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import {
  createWorkspace,
  extractPageItems,
  getBusinessErrorMessage,
  getSubscription,
  getWallet,
  leaveWorkspace,
  listBillingPlans,
  listWorkspaces,
  redeemWorkspaceInvitation,
  transferWorkspaceOwnership,
} from '../api/business'
import { listWorkspaceMembers } from '../api/auth'
import {
  buildModelPlanCandidatesFromBillingPlans,
  buildModelPlanCandidatesFromSession,
  normalizePlanCandidates,
} from '../utils/modelPlans'

const toId = (value: any): number => Number(value) || 0
const findById = (list: any[], id: number) => list.find((w) => toId(w?.id) === id) || null
const pickWorkspaceId = (payload: any): number => {
  const candidates = [
    payload?.workspace?.id,
    payload?.currentWorkspace?.id,
    payload?.current_workspace?.id,
    payload?.workspace_id,
    payload?.current_workspace_id,
    payload?.id,
  ]
  return toId(candidates.find((value) => toId(value) > 0))
}
const pickCurrentWorkspaceIdFromSession = (session: any): number => {
  const candidates = [
    session?.workspace?.id,
    session?.currentWorkspace?.id,
    session?.current_workspace?.id,
    session?.workspace_id,
    session?.current_workspace_id,
  ]
  return toId(candidates.find((value) => toId(value) > 0))
}

// 非响应式闭包变量（原 pinia store 内 `let`）。
let billingPlansPromise: Promise<void> | null = null
let billingPlansLoadedWorkspaceId = 0

export interface WorkspaceSessionState {
  authSession: any
  userWorkspaces: any[]
  activeWorkspaceOverrideId: number
  currentSubscription: any
  currentWallet: any
  billingPlans: any[]
  billingPlanCandidates: any[]

  setAuthSession: (session: any) => void
  loadSubscriptionLabel: () => Promise<void>
  ensureModelPlanCandidatesLoaded: () => Promise<void>
  loadWorkspaces: () => Promise<void>
  switchWorkspace: (id: any) => void
  createTeam: (name: string) => Promise<any>
  joinTeam: (inviteCode: string) => Promise<any>
  deleteTeam: (id: any) => Promise<void>
}

// ---- 派生值（纯函数，对应原 computed）---------------------------------------
type S = WorkspaceSessionState

export const deriveSessionWorkspaceId = (s: S) => pickCurrentWorkspaceIdFromSession(s.authSession)

// 用户名下的真实空间，冷启动前回退到会话里的列表。
export const deriveAllWorkspaces = (s: S): any[] =>
  s.userWorkspaces.length ? s.userWorkspaces : s.authSession?.workspaces || []

// 当前活跃空间：override → session 当前空间 → 列表首项。
export const deriveCurrentWorkspace = (s: S): any => {
  const list = deriveAllWorkspaces(s)
  const preferredId = toId(s.activeWorkspaceOverrideId) || deriveSessionWorkspaceId(s)
  if (preferredId > 0) {
    return findById(list, preferredId) || null
  }
  return list[0] || null
}

export const deriveCurrentUser = (s: S): any => s.authSession?.user || null
export const deriveWorkspaceId = (s: S): number => toId(deriveCurrentWorkspace(s)?.id)

export const deriveCurrentMember = (s: S): any => {
  const member = s.authSession?.currentMember || null
  if (!member) return null

  const memberWorkspaceId = toId(
    member?.workspace_id ??
      member?.workspaceId ??
      member?.workspace?.id ??
      member?.current_workspace_id ??
      member?.currentWorkspaceId,
  )
  const activeId = deriveWorkspaceId(s)
  const sessionWsId = deriveSessionWorkspaceId(s)

  if (memberWorkspaceId > 0 && activeId > 0) {
    return memberWorkspaceId === activeId ? member : null
  }
  if (activeId > 0 && sessionWsId > 0) {
    return activeId === sessionWsId ? member : null
  }
  return member
}

export const deriveActiveSubscription = (s: S): any =>
  s.currentSubscription?.active ? s.currentSubscription : null
export const deriveCurrentPlanName = (s: S): string => deriveActiveSubscription(s)?.plan_name || ''
export const deriveCurrentPlanExpiresAt = (s: S): string =>
  deriveActiveSubscription(s)?.current_period_end || ''
export const deriveWalletCredits = (s: S): number => Number(s.currentWallet?.available ?? 0)

const findPlanByCode = (s: S, code: any) => (code && s.billingPlans.find((p) => p.code === code)) || null

export const derivePlanBaseCredits = (s: S): number =>
  Number(
    deriveActiveSubscription(s)?.base_credits ??
      findPlanByCode(s, deriveActiveSubscription(s)?.plan_code)?.base_credits ??
      0,
  )

export const deriveCurrentConcurrencyLimit = (s: S): number => {
  const limit = Number(
    deriveActiveSubscription(s)?.concurrency ??
      findPlanByCode(s, deriveActiveSubscription(s)?.plan_code)?.entitlements_json?.concurrency ??
      0,
  )
  return limit > 0 ? limit : 1
}

export const deriveCurrentBillingPeriod = (s: S): string => String(deriveActiveSubscription(s)?.period || '')
export const deriveCurrentMaxMembers = (s: S): number => Number(deriveActiveSubscription(s)?.max_members ?? 0)
export const deriveCurrentMemberCount = (s: S): number =>
  Number(deriveActiveSubscription(s)?.current_member_count ?? 0)

export const deriveModelPlanCandidates = (s: S): any[] => {
  const sessionCandidates = buildModelPlanCandidatesFromSession(
    s.authSession,
    deriveCurrentWorkspace(s),
    deriveCurrentMember(s),
    { fallback: [] },
  )
  return normalizePlanCandidates([...sessionCandidates, ...s.billingPlanCandidates])
}

// ---- Store ------------------------------------------------------------------
export const useWorkspaceSessionStore = create<WorkspaceSessionState>((set, get) => {
  const clearWorkspaceScopedState = () => {
    billingPlansLoadedWorkspaceId = 0
    set({
      currentSubscription: null,
      currentWallet: null,
      billingPlans: [],
      billingPlanCandidates: [],
    })
  }

  const loadWorkspaceBillingPlanCandidates = async (targetWorkspaceId: number) => {
    try {
      const planItems = extractPageItems(await listBillingPlans())
      if (deriveWorkspaceId(get()) !== targetWorkspaceId) return
      set({
        billingPlans: planItems,
        billingPlanCandidates: buildModelPlanCandidatesFromBillingPlans(planItems).filter(
          (plan: any) => plan !== 'free',
        ),
      })
      billingPlansLoadedWorkspaceId = targetWorkspaceId
    } catch {
      if (deriveWorkspaceId(get()) === targetWorkspaceId) set({ billingPlanCandidates: [] })
    }
  }

  return {
    authSession: null,
    userWorkspaces: [],
    activeWorkspaceOverrideId: 0,
    currentSubscription: null,
    currentWallet: null,
    billingPlans: [],
    billingPlanCandidates: [],

    setAuthSession: (session) => {
      clearWorkspaceScopedState()
      if (!session) {
        set({ authSession: null, activeWorkspaceOverrideId: 0, userWorkspaces: [] })
        return
      }
      set({ authSession: session })

      const nextWorkspaceId = pickCurrentWorkspaceIdFromSession(session)
      if (nextWorkspaceId > 0) {
        set({ activeWorkspaceOverrideId: nextWorkspaceId })
      } else if (!findById(deriveAllWorkspaces(get()), get().activeWorkspaceOverrideId)) {
        set({ activeWorkspaceOverrideId: 0 })
      }
    },

    // 订阅 + 钱包并行：个人中心弹窗的套餐标签、到期、积分剩余都依赖这两项。
    loadSubscriptionLabel: async () => {
      const id = deriveWorkspaceId(get())
      if (!id) {
        clearWorkspaceScopedState()
        return
      }
      set({ currentSubscription: null, currentWallet: null })
      const [sub, wal] = await Promise.all([
        getSubscription(id).catch(() => null),
        getWallet(id).catch(() => null),
      ])
      if (deriveWorkspaceId(get()) !== id) return
      set({ currentSubscription: sub, currentWallet: wal })
      await get().ensureModelPlanCandidatesLoaded()
    },

    ensureModelPlanCandidatesLoaded: async () => {
      // 等待过程中工作空间可能再次切换，循环直到加载结果与当前空间一致。
      let id = deriveWorkspaceId(get())
      while (id && billingPlansLoadedWorkspaceId !== id) {
        if (!billingPlansPromise) {
          billingPlansPromise = loadWorkspaceBillingPlanCandidates(id).finally(() => {
            billingPlansPromise = null
          })
        }
        await billingPlansPromise
        id = deriveWorkspaceId(get())
      }
      if (!id) {
        billingPlansLoadedWorkspaceId = 0
        set({ billingPlanCandidates: [] })
      }
    },

    // 拉取真实空间列表（侧边栏团队组）。
    loadWorkspaces: async () => {
      try {
        const items = extractPageItems(await listWorkspaces())
        set({ userWorkspaces: items })
        const s = get()
        const preferredId = toId(s.activeWorkspaceOverrideId) || deriveSessionWorkspaceId(s)
        if (preferredId && !findById(items, preferredId) && s.activeWorkspaceOverrideId) {
          set({ activeWorkspaceOverrideId: 0 })
        }
      } catch {
        return
      }
    },

    // 切换活跃空间：只改 override，workspaceId 变化由调用方的 effect 统一触发刷新。
    switchWorkspace: (id) => {
      const target = toId(id)
      if (!target || target === deriveWorkspaceId(get())) return
      clearWorkspaceScopedState()
      set({ activeWorkspaceOverrideId: target })
    },

    // 创建团队：返回新建结果（toast/错误处理交给调用方）。
    createTeam: async (name) => {
      const created = await createWorkspace({ name })
      await get().loadWorkspaces()
      if (created?.id) get().switchWorkspace(created.id)
      return created
    },

    joinTeam: async (inviteCode) => {
      const redeemed = await redeemWorkspaceInvitation({ inviteCode })
      await get().loadWorkspaces()
      const joinedWorkspaceId = pickWorkspaceId(redeemed)
      if (joinedWorkspaceId) {
        clearWorkspaceScopedState()
        set({ activeWorkspaceOverrideId: joinedWorkspaceId })
      }
      return redeemed
    },

    deleteTeam: async (id) => {
      const targetId = toId(id)
      if (!targetId) throw new Error('团队 ID 无效')
      const target = findById(deriveAllWorkspaces(get()), targetId)
      const targetType = String(target?.type || '').toLowerCase()
      if (targetType === 'personal') {
        throw new Error('个人空间不支持删除')
      }

      // Owner 需要先转让所有权再离开
      const userId = toId(get().authSession?.user?.id)
      const ownerUserId = toId(target?.owner_user_id || target?.ownerUserId)
      if (userId && ownerUserId && userId === ownerUserId) {
        let membersList: any[] = []
        try {
          const raw: any = await listWorkspaceMembers(targetId)
          membersList = Array.isArray(raw)
            ? raw
            : Array.isArray(raw?.list)
              ? raw.list
              : Array.isArray(raw?.members)
                ? raw.members
                : Array.isArray(raw?.items)
                  ? raw.items
                  : []
        } catch {
          throw new Error('无法获取团队成员列表，请稍后重试')
        }
        const otherMember = membersList.find((m) => {
          const mid = toId(m?.user_id || m?.userId || m?.id)
          return mid > 0 && mid !== userId
        })
        if (!otherMember) {
          throw new Error('你是团队唯一成员，无法退出。如需删除团队请联系管理员。')
        }
        const otherUserId = toId(otherMember?.user_id || otherMember?.userId || otherMember?.id)
        await transferWorkspaceOwnership({ workspaceId: targetId, userId: otherUserId })
      }

      try {
        await leaveWorkspace({ workspaceId: targetId })
      } catch (error: any) {
        const status = Number(error?.status || 0)
        const code = Number(error?.code || 0)
        const codeString = String(error?.response?.code_string || '').toUpperCase()
        const message = String(error?.response?.message || error?.message || '').trim()
        const isNotFound =
          status === 404 ||
          codeString === 'NOT_FOUND' ||
          code === 10031 ||
          /NOT_FOUND/i.test(String(error?.code || ''))
        if (!isNotFound || !/不是该\s*workspace\s*成员|not\s+a\s*member/i.test(message)) {
          throw error
        }
      }

      const s = get()
      if (Array.isArray(s.userWorkspaces) && s.userWorkspaces.length) {
        set({ userWorkspaces: s.userWorkspaces.filter((item) => toId(item?.id) !== targetId) })
      }
      if (Array.isArray(s.authSession?.workspaces)) {
        set({
          authSession: {
            ...s.authSession,
            workspaces: s.authSession.workspaces.filter((item: any) => toId(item?.id) !== targetId),
          },
        })
      }
      if (toId(get().activeWorkspaceOverrideId) === targetId) {
        set({ activeWorkspaceOverrideId: 0 })
      }

      await get().loadWorkspaces()

      const next = get()
      const nextList = deriveAllWorkspaces(next)
      const desiredId = toId(next.activeWorkspaceOverrideId) || deriveSessionWorkspaceId(next)
      if (desiredId === targetId || !findById(nextList, desiredId)) {
        const fallback =
          nextList.find((item) => String(item?.type || '').toLowerCase() === 'personal') || nextList[0] || null
        clearWorkspaceScopedState()
        set({ activeWorkspaceOverrideId: toId(fallback?.id) })
      }
    },
  }
})

export { getBusinessErrorMessage }

// ---- Selector hooks（组件侧便捷读取派生值，保持响应式订阅）------------------
export const useCurrentWorkspace = () => useWorkspaceSessionStore(deriveCurrentWorkspace)
export const useCurrentUser = () => useWorkspaceSessionStore(deriveCurrentUser)
export const useCurrentMember = () => useWorkspaceSessionStore(deriveCurrentMember)
export const useWorkspaceId = () => useWorkspaceSessionStore(deriveWorkspaceId)
export const useAllWorkspaces = () => useWorkspaceSessionStore(deriveAllWorkspaces)
export const useActiveSubscription = () => useWorkspaceSessionStore(deriveActiveSubscription)
export const useCurrentPlanName = () => useWorkspaceSessionStore(deriveCurrentPlanName)
export const useCurrentPlanExpiresAt = () => useWorkspaceSessionStore(deriveCurrentPlanExpiresAt)
export const useWalletCredits = () => useWorkspaceSessionStore(deriveWalletCredits)
export const usePlanBaseCredits = () => useWorkspaceSessionStore(derivePlanBaseCredits)
export const useCurrentConcurrencyLimit = () => useWorkspaceSessionStore(deriveCurrentConcurrencyLimit)
export const useCurrentBillingPeriod = () => useWorkspaceSessionStore(deriveCurrentBillingPeriod)
export const useCurrentMaxMembers = () => useWorkspaceSessionStore(deriveCurrentMaxMembers)
export const useCurrentMemberCount = () => useWorkspaceSessionStore(deriveCurrentMemberCount)
export const useModelPlanCandidates = () =>
  useWorkspaceSessionStore(useShallow(deriveModelPlanCandidates))
