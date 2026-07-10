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
  disbandWorkspace,
  extractPageItems,
  getSubscription,
  getWallet,
  leaveWorkspace,
  listBillingPlans,
  listWorkspaces,
  redeemWorkspaceInvitation,
  setActiveWorkspaceId,
  updateWorkspace,
} from '../api/business'
import { listWorkspaceMembers } from '../api/auth'
import { setHotCopyDraftUserScope } from '../utils/hotCopyDraft'
import { setSmartDraftUserScope, setSmartDraftWorkspaceScope } from '../utils/smartDraft'
import {
  buildModelPlanCandidatesFromBillingPlans,
  buildModelPlanCandidatesFromSession,
  normalizePlanCandidates,
} from '../utils/modelPlans'

const toId = (value: any): number => Number(value) || 0
const findById = (list: any[], id: number) => list.find((w) => toId(w?.id) === id) || null
const dedupeWorkspaces = (...groups: any[]): any[] => {
  const merged = new Map<number, any>()
  groups.forEach((group) => {
    const items = Array.isArray(group) ? group : group ? [group] : []
    items.forEach((item) => {
      const id = toId(item?.id)
      if (!id) return
      if (!merged.has(id)) {
        merged.set(id, item)
        return
      }
      const prev = merged.get(id)
      merged.set(id, prev === item ? prev : { ...prev, ...item })
    })
  })
  return [...merged.values()]
}
const normalizeWorkspaceStatus = (workspace: any): string =>
  String(workspace?.status || workspace?.workspace_status || workspace?.workspaceStatus || '')
    .trim()
    .toLowerCase()
const isVisibleWorkspace = (workspace: any): boolean => {
  if (toId(workspace?.id) <= 0) return false
  const status = normalizeWorkspaceStatus(workspace)
  if (!status) return true
  return !/(^invited$|invite_pending|pending_invite|member_pending|join_pending|pending_join|not_joined|left|removed|disbanded|deleted|inactive|disabled)/.test(
    status,
  )
}
const sanitizeWorkspaceList = (list: any[]): any[] =>
  dedupeWorkspaces((Array.isArray(list) ? list : []).filter(isVisibleWorkspace))
const deriveSessionWorkspaces = (session: any): any[] =>
  sanitizeWorkspaceList(
    dedupeWorkspaces(session?.workspaces, session?.workspace, session?.currentWorkspace, session?.current_workspace),
  )
const pickWorkspaceId = (payload: any): number => {
  const candidates = [
    // 兑换邀请码的返回体 data 是 Go RedeemResult(无 json tag)→ 字段大写 Workspace/Member,
    // 内层 domain.Workspace 才是小写 id。不认大写这层,加入团队后拿不到 id → 不会自动切入团队空间。
    payload?.Workspace?.id,
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

// 记住「上次选中的工作空间」(UI 选择,非项目数据),按用户隔离,刷新后恢复——
// 否则刷新会被会话默认空间(个人)覆盖,导致「一刷新就回个人空间」。
const ACTIVE_WS_KEY = (uid: any) => `zzh_active_ws_u${toId(uid) || 'anon'}`
const readSavedActiveWs = (uid: any): number => {
  try {
    return toId(window.localStorage.getItem(ACTIVE_WS_KEY(uid)))
  } catch {
    return 0
  }
}
const saveActiveWs = (uid: any, id: any): void => {
  try {
    window.localStorage.setItem(ACTIVE_WS_KEY(uid), String(toId(id)))
  } catch {
    /* 忽略(隐私模式等) */
  }
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
  currentWorkspaceMember: any

  setAuthSession: (session: any) => void
  loadSubscriptionLabel: () => Promise<void>
  ensureModelPlanCandidatesLoaded: () => Promise<void>
  loadWorkspaces: () => Promise<void>
  loadCurrentWorkspaceMember: (workspaceId?: any) => Promise<any>
  switchWorkspace: (id: any) => void
  createTeam: (name: string) => Promise<any>
  renameTeam: (id: any, name: string) => Promise<any>
  joinTeam: (inviteCode: string) => Promise<any>
  deleteTeam: (id: any) => Promise<void>
  disbandTeam: (id: any) => Promise<void>
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
  const activeMember = s.currentWorkspaceMember || null
  if (activeMember) return activeMember

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

export const deriveActiveSubscription = (s: S): any => (s.currentSubscription?.active ? s.currentSubscription : null)
export const deriveCurrentPlanName = (s: S): string => deriveActiveSubscription(s)?.plan_name || ''
export const deriveCurrentPlanExpiresAt = (s: S): string => deriveActiveSubscription(s)?.current_period_end || ''
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
      // 失败也标记「已尝试」:否则 ensureModelPlanCandidatesLoaded 的 while 会无限重试 →
      // 疯狂刷 /billing/plans、且 resolvePlanCandidates 永不返回(视频一直卡"生成中")。
      billingPlansLoadedWorkspaceId = targetWorkspaceId
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
    currentWorkspaceMember: null,

    setAuthSession: (session) => {
      clearWorkspaceScopedState()
      if (!session) {
        set({ authSession: null, activeWorkspaceOverrideId: 0, userWorkspaces: [], currentWorkspaceMember: null })
        return
      }
      const normalizedSession = {
        ...session,
        workspaces: deriveSessionWorkspaces(session),
      }
      set({
        authSession: normalizedSession,
        userWorkspaces: normalizedSession.workspaces || [],
        currentWorkspaceMember: normalizedSession.currentMember || null,
      })

      const savedWs = readSavedActiveWs(toId(session?.user?.id))
      const nextWorkspaceId = pickCurrentWorkspaceIdFromSession(normalizedSession)
      const allWs = deriveAllWorkspaces(get())
      // 尊重用户上次手动选择的空间。不要因为账号下存在团队空间，就在刷新后强制切到团队。
      if (savedWs > 0 && findById(allWs, savedWs)) {
        set({ activeWorkspaceOverrideId: savedWs })
      } else if (nextWorkspaceId > 0) {
        set({ activeWorkspaceOverrideId: nextWorkspaceId })
      } else if (!findById(allWs, get().activeWorkspaceOverrideId)) {
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
        get()
          .loadCurrentWorkspaceMember(id)
          .catch(() => null),
      ])
      if (deriveWorkspaceId(get()) !== id) return
      set({ currentSubscription: sub, currentWallet: wal })
      await get().ensureModelPlanCandidatesLoaded()
    },

    loadCurrentWorkspaceMember: async (workspaceId) => {
      const targetId = toId(workspaceId) || deriveWorkspaceId(get())
      const userId = toId(get().authSession?.user?.id)
      if (!targetId || !userId) {
        set({ currentWorkspaceMember: null })
        return null
      }
      try {
        const members = await listWorkspaceMembers(targetId)
        const list = Array.isArray(members) ? members : []
        const nextMember = list.find((member: any) => toId(member?.user_id || member?.userId) === userId) || null
        if (deriveWorkspaceId(get()) === targetId) {
          set({ currentWorkspaceMember: nextMember })
        }
        return nextMember
      } catch {
        if (deriveWorkspaceId(get()) === targetId) {
          set({ currentWorkspaceMember: null })
        }
        return null
      }
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
        const raw = await listWorkspaces()
        const items = sanitizeWorkspaceList(extractPageItems(raw))
        const fallbackWorkspaces = deriveSessionWorkspaces(get().authSession)
        const nextWorkspaces = items.length ? items : fallbackWorkspaces
        set({ userWorkspaces: nextWorkspaces })
        const s = get()
        const preferredId = toId(s.activeWorkspaceOverrideId) || deriveSessionWorkspaceId(s)
        if (preferredId && !findById(nextWorkspaces, preferredId) && s.activeWorkspaceOverrideId) {
          // 存档指向的空间已不属于你(被移出/解散)→ 清 override 并清存档,回落默认空间
          set({ activeWorkspaceOverrideId: 0 })
          saveActiveWs(toId(s.authSession?.user?.id), 0)
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
      saveActiveWs(toId(get().authSession?.user?.id), target) // 持久化,刷新后恢复
      void get().loadCurrentWorkspaceMember(target)
    },

    // 创建团队：返回新建结果（toast/错误处理交给调用方）。
    createTeam: async (name) => {
      const created = await createWorkspace({ name })
      await get().loadWorkspaces()
      if (created?.id) get().switchWorkspace(created.id)
      return created
    },

    // 重命名空间(仅团队空间）：改名后刷新列表，让侧栏/顶栏/弹窗同步新名称。
    // 名称的安全校验/查重由调用方(UI)先行处理;此处仅做基本防线。
    renameTeam: async (id, name) => {
      const targetId = toId(id)
      if (!targetId) throw new Error('空间 ID 无效')
      const nextName = String(name || '').trim()
      if (!nextName) throw new Error('空间名称不能为空')
      const target = findById(deriveAllWorkspaces(get()), targetId)
      if (String(target?.type || '').toLowerCase() === 'personal') {
        throw new Error('个人空间不支持重命名')
      }
      const updated = await updateWorkspace({ workspaceId: targetId, name: nextName })
      await get().loadWorkspaces()
      return updated
    },

    joinTeam: async (inviteCode) => {
      const redeemed = await redeemWorkspaceInvitation({ inviteCode })
      await get().loadWorkspaces()
      const joinedWorkspaceId = pickWorkspaceId(redeemed)
      // 只有确认加入的空间已在刷新后的列表里才切过去。loadWorkspaces 内部吞错(失败静默返回),
      // 若不校验就设 override,会把 active 指向列表里不存在的空间 → 停在空态。失败则不切,列表恢复后用户可自选。
      if (joinedWorkspaceId && findById(deriveAllWorkspaces(get()), joinedWorkspaceId)) {
        clearWorkspaceScopedState()
        set({ activeWorkspaceOverrideId: joinedWorkspaceId })
        saveActiveWs(toId(get().authSession?.user?.id), joinedWorkspaceId) // 持久化,刷新后恢复
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

      // 主账号(所有者)退出:必须【先手动转让主账号权限】给其他成员,这里不再自动转让(防绕过)。
      // 单人团队所有者的引导(转让/解散)由 UI 层按成员数给出;此处仅作后端调用前的防线。
      const userId = toId(get().authSession?.user?.id)
      const ownerUserId = toId(target?.owner_user_id || target?.ownerUserId)
      if (userId && ownerUserId && userId === ownerUserId) {
        throw new Error('你是主账号,退出前请先把主账号权限转让给其他成员;若要删除空间请用「解散该空间」。')
      }

      try {
        await leaveWorkspace({ workspaceId: targetId })
      } catch (error: any) {
        const status = Number(error?.status || 0)
        const code = Number(error?.code || 0)
        const codeString = String(error?.response?.code_string || '').toUpperCase()
        const message = String(error?.response?.message || error?.message || '').trim()
        const isNotFound =
          status === 404 || codeString === 'NOT_FOUND' || code === 10031 || /NOT_FOUND/i.test(String(error?.code || ''))
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

      // 兜底:loadWorkspaces 会用后端结果覆盖 userWorkspaces,若后端 leave 有延迟/仍返回该空间,
      // 会把刚退出的空间又加回来 → 这里再过滤一次,确保退出后列表里不再出现该空间。
      const afterLoad = get()
      if (Array.isArray(afterLoad.userWorkspaces) && findById(afterLoad.userWorkspaces, targetId)) {
        set({ userWorkspaces: afterLoad.userWorkspaces.filter((item) => toId(item?.id) !== targetId) })
      }

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

    // 解散空间(仅所有者):真删空间及其素材/项目/数据(POST /workspaces/{id}/disband)。
    // 与 deleteTeam(退出语义)不同:disband 是所有者销毁整个空间,单人团队也能删。
    disbandTeam: async (id) => {
      const targetId = toId(id)
      if (!targetId) throw new Error('团队 ID 无效')
      const target = findById(deriveAllWorkspaces(get()), targetId)
      // 必须是明确的团队空间才允许解散:type 非空且非 personal(空 type 也拒绝,避免绕过守卫误删个人空间)
      const targetType = String(target?.type || '').toLowerCase()
      if (!(targetType && targetType !== 'personal')) {
        throw new Error('仅团队空间支持解散')
      }
      const userId = toId(get().authSession?.user?.id)
      const ownerUserId = toId(target?.owner_user_id || target?.ownerUserId)
      if (userId && ownerUserId && userId !== ownerUserId) {
        throw new Error('只有空间超级管理员可以解散空间')
      }
      await disbandWorkspace({ workspaceId: targetId })
      // 收尾:从本地列表移除 + 若删的是当前空间则切回个人空间兜底(同 deleteTeam)
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
      // 兜底:同 deleteTeam,防 loadWorkspaces 把刚解散的空间又拉回来
      const afterLoad = get()
      if (Array.isArray(afterLoad.userWorkspaces) && findById(afterLoad.userWorkspaces, targetId)) {
        set({ userWorkspaces: afterLoad.userWorkspaces.filter((item) => toId(item?.id) !== targetId) })
      }
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

// 把"当前活跃 workspace id"同步给 api 层(business.listAiModels 查模型时必须带 workspace_id,
// 否则后端按订阅返回空模型列表 → 出片/出图/预估全查不到模型)。初始 + 每次变化都推一次。
// 智能成片本地草稿按【当前用户】隔离:同一浏览器换账号时各存各的,避免草稿串台
// (新用户读到上个用户的 projectId → 空白 /smart 误跳 → 别人的项目 403/404 → 每次报「项目加载失败」)。
const deriveDraftUserScope = (s: S): string => {
  const u = deriveCurrentUser(s) || {}
  return String(u.id ?? u.user_id ?? u.userId ?? u.account_id ?? u.uid ?? '')
}
setActiveWorkspaceId(deriveWorkspaceId(useWorkspaceSessionStore.getState()))
setSmartDraftUserScope(deriveDraftUserScope(useWorkspaceSessionStore.getState()))
setSmartDraftWorkspaceScope(deriveWorkspaceId(useWorkspaceSessionStore.getState()))
setHotCopyDraftUserScope(deriveDraftUserScope(useWorkspaceSessionStore.getState()))
useWorkspaceSessionStore.subscribe((state) => {
  setActiveWorkspaceId(deriveWorkspaceId(state))
  setSmartDraftUserScope(deriveDraftUserScope(state))
  setSmartDraftWorkspaceScope(deriveWorkspaceId(state))
  setHotCopyDraftUserScope(deriveDraftUserScope(state))
})

// ---- Selector hooks（组件侧便捷读取派生值，保持响应式订阅）------------------
export const useCurrentWorkspace = () => useWorkspaceSessionStore(deriveCurrentWorkspace)
export const useCurrentUser = () => useWorkspaceSessionStore(deriveCurrentUser)
export const useCurrentMember = () => useWorkspaceSessionStore(deriveCurrentMember)
export const useWorkspaceId = () => useWorkspaceSessionStore(deriveWorkspaceId)
export const useAllWorkspaces = () => useWorkspaceSessionStore(useShallow(deriveAllWorkspaces))
export const useCurrentPlanName = () => useWorkspaceSessionStore(deriveCurrentPlanName)
export const useCurrentPlanExpiresAt = () => useWorkspaceSessionStore(deriveCurrentPlanExpiresAt)
export const useWalletCredits = () => useWorkspaceSessionStore(deriveWalletCredits)
export const usePlanBaseCredits = () => useWorkspaceSessionStore(derivePlanBaseCredits)
export const useCurrentConcurrencyLimit = () => useWorkspaceSessionStore(deriveCurrentConcurrencyLimit)
export const useModelPlanCandidates = () => useWorkspaceSessionStore(useShallow(deriveModelPlanCandidates))
