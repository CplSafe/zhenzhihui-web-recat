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
import { setFavoriteVideoUserScope } from '../utils/favoriteVideos'
import { setHotCopyDraftUserScope } from '../utils/hotCopyDraft'
import { setSmartEntryDraftScope } from '../utils/smartEntryDraft'
import { setSmartDraftUserScope, setSmartDraftWorkspaceScope } from '../utils/smartDraft'
import { setVideoGenOwnerScope } from '../utils/videoGenRegistry'
import {
  buildModelPlanCandidatesFromBillingPlans,
  buildModelPlanCandidatesFromSession,
  normalizePlanCandidates,
} from '../utils/modelPlans'

/** 把后端可能返回的字符串/数字主键统一为数值 id。 */
const toId = (value: any): number => Number(value) || 0
/** 按规范化 id 从工作空间数组中查找记录。 */
const findById = (list: any[], id: number) => list.find((w) => toId(w?.id) === id) || null
/** 合并多个空间来源，同 id 后出现的数据补齐先前记录。 */
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
/** 兼容多种字段名并规范化空间状态。 */
const normalizeWorkspaceStatus = (workspace: any): string =>
  String(workspace?.status || workspace?.workspace_status || workspace?.workspaceStatus || '')
    .trim()
    .toLowerCase()
/** 排除待邀请、已退出、已解散等当前用户不可进入的空间。 */
const isVisibleWorkspace = (workspace: any): boolean => {
  if (toId(workspace?.id) <= 0) return false
  const status = normalizeWorkspaceStatus(workspace)
  if (!status) return true
  return !/(^invited$|invite_pending|pending_invite|member_pending|join_pending|pending_join|not_joined|left|removed|disbanded|deleted|inactive|disabled)/.test(
    status,
  )
}
/** 对空间列表去重并过滤不可见记录。 */
const sanitizeWorkspaceList = (list: any[]): any[] =>
  dedupeWorkspaces((Array.isArray(list) ? list : []).filter(isVisibleWorkspace))
/** 从会话对象的多种兼容字段收集工作空间。 */
const deriveSessionWorkspaces = (session: any): any[] =>
  sanitizeWorkspaceList(
    dedupeWorkspaces(session?.workspaces, session?.workspace, session?.currentWorkspace, session?.current_workspace),
  )
/** 从创建、加入等接口的兼容返回体中提取空间 id。 */
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
/** 从接口返回体中取得完整空间对象。 */
const pickWorkspaceFromPayload = (payload: any): any | null => {
  const candidates = [payload?.Workspace, payload?.workspace, payload?.currentWorkspace, payload?.current_workspace]
  return candidates.find((workspace) => workspace && typeof workspace === 'object' && toId(workspace.id) > 0) || null
}
/** 从认证会话中解析服务端当前空间 id。 */
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
/** 从成员记录中解析其所属空间 id。 */
const pickMemberWorkspaceId = (member: any): number =>
  toId(
    member?.workspace_id ??
      member?.workspaceId ??
      member?.workspace?.id ??
      member?.current_workspace_id ??
      member?.currentWorkspaceId,
  )

/** 提取用于隔离浏览器本地数据的用户作用域。 */
const getSessionUserScope = (session: any): string =>
  String(
    session?.user?.id ??
      session?.user?.user_id ??
      session?.user?.userId ??
      session?.user?.account_id ??
      session?.user?.uid ??
      '',
  ).trim()

/** 兼容列表、分页和嵌套 data 返回体，提取工作空间成员数组。 */
export const extractWorkspaceMemberItems = (payload: any): any[] => {
  if (Array.isArray(payload)) return payload
  const directCandidates = [payload?.members, payload?.items, payload?.list, payload?.records, payload?.data]
  const direct = directCandidates.find(Array.isArray)
  if (Array.isArray(direct)) return direct
  const nested = payload?.data
  if (!nested || typeof nested !== 'object') return []
  const nestedCandidates = [nested.members, nested.items, nested.list, nested.records, nested.data]
  const nestedList = nestedCandidates.find(Array.isArray)
  return Array.isArray(nestedList) ? nestedList : []
}

// 记住「上次选中的工作空间」(UI 选择,非项目数据),按用户隔离,刷新后恢复——
// 否则刷新会被会话默认空间(个人)覆盖,导致「一刷新就回个人空间」。
/** 为空用户生成匿名本地存储作用域。 */
const normalizeUserStorageScope = (uid: any): string => String(uid ?? '').trim() || 'anon'
/** 生成按账号隔离的“最近使用空间”缓存键。 */
const ACTIVE_WS_KEY = (uid: any) => `zzh_active_ws_u${encodeURIComponent(normalizeUserStorageScope(uid))}`
/** 读取当前账号上次选中的工作空间。 */
const readSavedActiveWs = (uid: any): number => {
  try {
    return toId(window.localStorage.getItem(ACTIVE_WS_KEY(uid)))
  } catch {
    return 0
  }
}
/** 保存当前账号最近选择的工作空间。 */
const saveActiveWs = (uid: any, id: any): void => {
  try {
    window.localStorage.setItem(ACTIVE_WS_KEY(uid), String(toId(id)))
  } catch {
    /* 忽略(隐私模式等) */
  }
}

// 非响应式闭包变量（原 pinia store 内 `let`）。
let billingPlansPromise: Promise<void> | null = null
/** 最近一次已加载计费方案的工作空间 id。 */
let billingPlansLoadedWorkspaceId = 0
/** 套餐名称等轻量展示信息的短缓存时间。 */
const SUBSCRIPTION_LABEL_CACHE_TTL_MS = 30_000
/** 当前共享的订阅展示信息请求。 */
let subscriptionLabelPromise: Promise<void> | null = null
/** 共享订阅请求所绑定的工作空间 id。 */
let subscriptionLabelPromiseWorkspaceId = 0
/** 最近一次成功加载订阅展示信息的工作空间 id。 */
let subscriptionLabelLoadedWorkspaceId = 0
/** 最近一次订阅展示信息加载成功时间。 */
let subscriptionLabelLoadedAt = 0
/** 空间级状态版本，用于让旧异步响应失效。 */
let workspaceScopeVersion = 0
/** 空间列表请求序号，用于仅接纳最后一次响应。 */
let workspaceListRequestSeq = 0
/** 认证会话世代号，账号变化后使旧请求失效。 */
let authSessionEpoch = 0

/** 离开/解散空间后供安全切换使用的目标与源空间。 */
export interface WorkspaceTransitionResult {
  workspaceId: number
  sourceWorkspace: any | null
}

/** 等待根布局完成卸载和移除的空间切换任务。 */
export interface PendingWorkspaceTransition extends WorkspaceTransitionResult {
  removedWorkspaceId: number
}

/** 加入空间后的切换信息及原始接口返回体。 */
export interface JoinWorkspaceResult extends WorkspaceTransitionResult {
  payload: any
}

/** 工作空间、套餐、成员和钱包的全局会话状态。 */
export interface WorkspaceSessionState {
  authSession: any
  userWorkspaces: any[]
  activeWorkspaceOverrideId: number
  pendingWorkspaceTransition: PendingWorkspaceTransition | null
  currentSubscription: any
  currentWallet: any
  billingPlans: any[]
  billingPlanCandidates: any[]
  currentWorkspaceMember: any
  currentWorkspaceMemberWorkspaceId: number

  setAuthSession: (session: any) => void
  loadSubscriptionLabel: (options?: { force?: boolean }) => Promise<void>
  ensureModelPlanCandidatesLoaded: () => Promise<void>
  loadWorkspaces: () => Promise<boolean>
  loadCurrentWorkspaceMember: (workspaceId?: any) => Promise<any>
  switchWorkspace: (id: any, options?: { forceMemberReload?: boolean }) => void
  createTeam: (name: string) => Promise<any>
  renameTeam: (id: any, name: string) => Promise<any>
  joinTeam: (inviteCode: string) => Promise<JoinWorkspaceResult>
  deleteTeam: (id: any) => Promise<WorkspaceTransitionResult>
  disbandTeam: (id: any) => Promise<WorkspaceTransitionResult>
  consumePendingWorkspaceTransition: (removedWorkspaceId: any) => PendingWorkspaceTransition | null
  finalizeWorkspaceRemoval: (id: any) => Promise<void>
}

// ---- 派生值（纯函数，对应原 computed）---------------------------------------
type S = WorkspaceSessionState

/** 取得服务端会话声明的当前空间 id。 */
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

/** 取得当前登录用户。 */
export const deriveCurrentUser = (s: S): any => s.authSession?.user || null
/** 取得当前前端实际使用的工作空间 id。 */
export const deriveWorkspaceId = (s: S): number => toId(deriveCurrentWorkspace(s)?.id)

/** 取得与当前空间严格匹配的成员记录，避免沿用上一空间角色。 */
export const deriveCurrentMember = (s: S): any => {
  const activeId = deriveWorkspaceId(s)
  const activeMember = s.currentWorkspaceMember || null
  const activeMemberWorkspaceId = toId(s.currentWorkspaceMemberWorkspaceId) || pickMemberWorkspaceId(activeMember)
  if (activeMember && activeId > 0 && activeMemberWorkspaceId === activeId) return activeMember

  const member = s.authSession?.currentMember || null
  if (!member) return null

  const memberWorkspaceId = pickMemberWorkspaceId(member)
  const sessionWsId = deriveSessionWorkspaceId(s)

  if (memberWorkspaceId > 0 && activeId > 0) {
    return memberWorkspaceId === activeId ? member : null
  }
  if (activeId > 0 && sessionWsId > 0) {
    return activeId === sessionWsId ? member : null
  }
  return member
}

/** 仅返回当前仍生效的订阅。 */
export const deriveActiveSubscription = (s: S): any => (s.currentSubscription?.active ? s.currentSubscription : null)
/** 取得当前套餐展示名称。 */
export const deriveCurrentPlanName = (s: S): string => deriveActiveSubscription(s)?.plan_name || ''
/** 取得当前套餐到期时间。 */
export const deriveCurrentPlanExpiresAt = (s: S): string => deriveActiveSubscription(s)?.current_period_end || ''
/** 取得钱包可用积分。 */
export const deriveWalletCredits = (s: S): number => Number(s.currentWallet?.available ?? 0)

/** 按套餐代码查找已加载的计费方案。 */
const findPlanByCode = (s: S, code: any) => (code && s.billingPlans.find((p) => p.code === code)) || null

/** 取得当前套餐包含的基础积分额度。 */
export const derivePlanBaseCredits = (s: S): number =>
  Number(
    deriveActiveSubscription(s)?.base_credits ??
      findPlanByCode(s, deriveActiveSubscription(s)?.plan_code)?.base_credits ??
      0,
  )

/** 合并会话与计费接口中的模型套餐候选，供生成前选择可用模型。 */
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
/** 工作空间会话全局 Store。 */
export const useWorkspaceSessionStore = create<WorkspaceSessionState>((set, get) => {
  /** 切换空间时清空所有空间级套餐、钱包和成员缓存。 */
  const clearWorkspaceScopedState = () => {
    workspaceScopeVersion += 1
    billingPlansLoadedWorkspaceId = 0
    subscriptionLabelPromise = null
    subscriptionLabelPromiseWorkspaceId = 0
    subscriptionLabelLoadedWorkspaceId = 0
    subscriptionLabelLoadedAt = 0
    set({
      currentSubscription: null,
      currentWallet: null,
      billingPlans: [],
      billingPlanCandidates: [],
      currentWorkspaceMember: null,
      currentWorkspaceMemberWorkspaceId: 0,
    })
  }

  /** 在 store 内激活目标空间并触发所需的成员/计费刷新。 */
  const activateWorkspace = (workspaceId: any, options?: { forceMemberReload?: boolean }): boolean => {
    const targetId = toId(workspaceId)
    if (!targetId) return false
    const currentId = deriveWorkspaceId(get())
    if (targetId === currentId && !options?.forceMemberReload) return false

    clearWorkspaceScopedState()
    set({ activeWorkspaceOverrideId: targetId })
    saveActiveWs(getSessionUserScope(get().authSession), targetId)
    void get().loadCurrentWorkspaceMember(targetId)
    return true
  }

  /** 加载指定空间可用的计费方案并转换为模型候选。 */
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
    pendingWorkspaceTransition: null,
    currentSubscription: null,
    currentWallet: null,
    billingPlans: [],
    billingPlanCandidates: [],
    currentWorkspaceMember: null,
    currentWorkspaceMemberWorkspaceId: 0,

    setAuthSession: (session) => {
      authSessionEpoch += 1
      workspaceListRequestSeq += 1
      clearWorkspaceScopedState()
      if (!session) {
        set({
          authSession: null,
          activeWorkspaceOverrideId: 0,
          userWorkspaces: [],
          pendingWorkspaceTransition: null,
          currentWorkspaceMember: null,
          currentWorkspaceMemberWorkspaceId: 0,
        })
        return
      }
      const normalizedSession = {
        ...session,
        workspaces: deriveSessionWorkspaces(session),
      }
      set({
        authSession: normalizedSession,
        userWorkspaces: normalizedSession.workspaces || [],
        pendingWorkspaceTransition: null,
        currentWorkspaceMember: normalizedSession.currentMember || null,
        currentWorkspaceMemberWorkspaceId:
          pickMemberWorkspaceId(normalizedSession.currentMember) ||
          pickCurrentWorkspaceIdFromSession(normalizedSession),
      })

      const savedWs = readSavedActiveWs(getSessionUserScope(session))
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

      const activeId = deriveWorkspaceId(get())
      const loadedMemberId =
        toId(get().currentWorkspaceMemberWorkspaceId) || pickMemberWorkspaceId(get().currentWorkspaceMember)
      if (activeId > 0 && loadedMemberId !== activeId) {
        set({ currentWorkspaceMember: null, currentWorkspaceMemberWorkspaceId: 0 })
      }
      if (activeId > 0) void get().loadCurrentWorkspaceMember(activeId)
    },

    // 订阅 + 钱包并行：个人中心弹窗的套餐标签、到期、积分剩余都依赖这两项。
    loadSubscriptionLabel: (options) => {
      const id = deriveWorkspaceId(get())
      if (!id) {
        clearWorkspaceScopedState()
        return Promise.resolve()
      }
      const now = Date.now()
      if (
        !options?.force &&
        subscriptionLabelLoadedWorkspaceId === id &&
        now - subscriptionLabelLoadedAt < SUBSCRIPTION_LABEL_CACHE_TTL_MS
      ) {
        return Promise.resolve()
      }
      if (subscriptionLabelPromise && subscriptionLabelPromiseWorkspaceId === id) {
        return subscriptionLabelPromise
      }

      const requestScopeVersion = workspaceScopeVersion
      const request = (async () => {
        const [sub, wal] = await Promise.all([
          getSubscription(id).catch(() => null),
          getWallet(id).catch(() => null),
          get()
            .loadCurrentWorkspaceMember(id)
            .catch(() => null),
        ])
        if (workspaceScopeVersion !== requestScopeVersion || deriveWorkspaceId(get()) !== id) return
        // 保留上一份值直到新请求完成，避免普通路由切换时套餐/积分先闪空再回填。
        set({ currentSubscription: sub, currentWallet: wal })
        await get().ensureModelPlanCandidatesLoaded()
        if (workspaceScopeVersion !== requestScopeVersion || deriveWorkspaceId(get()) !== id) return
        subscriptionLabelLoadedWorkspaceId = id
        subscriptionLabelLoadedAt = Date.now()
      })()
      const tracked = request.finally(() => {
        if (subscriptionLabelPromise === tracked) {
          subscriptionLabelPromise = null
          subscriptionLabelPromiseWorkspaceId = 0
        }
      })
      subscriptionLabelPromise = tracked
      subscriptionLabelPromiseWorkspaceId = id
      return tracked
    },

    loadCurrentWorkspaceMember: async (workspaceId) => {
      const targetId = toId(workspaceId) || deriveWorkspaceId(get())
      const userId = getSessionUserScope(get().authSession)
      if (!targetId || !userId) {
        set({ currentWorkspaceMember: null, currentWorkspaceMemberWorkspaceId: 0 })
        return null
      }
      const requestScopeVersion = workspaceScopeVersion
      try {
        const members = await listWorkspaceMembers(targetId)
        const list = extractWorkspaceMemberItems(members)
        const nextMember =
          list.find(
            (member: any) => String(member?.user_id ?? member?.userId ?? member?.user?.id ?? '').trim() === userId,
          ) || null
        if (workspaceScopeVersion === requestScopeVersion && deriveWorkspaceId(get()) === targetId) {
          set({
            currentWorkspaceMember: nextMember,
            currentWorkspaceMemberWorkspaceId: nextMember ? targetId : 0,
          })
        }
        return nextMember
      } catch {
        if (workspaceScopeVersion === requestScopeVersion && deriveWorkspaceId(get()) === targetId) {
          set({ currentWorkspaceMember: null, currentWorkspaceMemberWorkspaceId: 0 })
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
      const requestSeq = ++workspaceListRequestSeq
      const requestUserScope = getSessionUserScope(get().authSession)
      const isStaleRequest = () =>
        requestSeq !== workspaceListRequestSeq || getSessionUserScope(get().authSession) !== requestUserScope
      try {
        const raw = await listWorkspaces()
        if (isStaleRequest()) return false
        const items = sanitizeWorkspaceList(extractPageItems(raw))
        const fallbackWorkspaces = deriveSessionWorkspaces(get().authSession)
        const nextWorkspaces = items.length ? items : fallbackWorkspaces
        const stateBeforeUpdate = get()
        const preferredId =
          toId(stateBeforeUpdate.activeWorkspaceOverrideId) || deriveSessionWorkspaceId(stateBeforeUpdate)
        if (preferredId && !findById(nextWorkspaces, preferredId) && stateBeforeUpdate.activeWorkspaceOverrideId) {
          // 当前空间可能已被其他标签页或管理员移除。此时不能直接 activateWorkspace：
          // 创作页必须先在源 workspace 下卸载并保存草稿，再由 App 顶层安全桥切换。
          const sourceWorkspace =
            findById(deriveAllWorkspaces(stateBeforeUpdate), preferredId) ||
            deriveCurrentWorkspace(stateBeforeUpdate) ||
            null
          const fallback =
            nextWorkspaces.find((item) => String(item?.type || '').toLowerCase() === 'personal') ||
            nextWorkspaces[0] ||
            null
          const fallbackId = toId(fallback?.id)
          if (fallbackId && sourceWorkspace) {
            set({
              // 暂时保留已失效的源空间，确保 deriveWorkspaceId 及草稿 scope 在路由桥
              // 完成切换前都不变化；finalizeWorkspaceRemoval 会在切换后移除它。
              userWorkspaces: dedupeWorkspaces(nextWorkspaces, sourceWorkspace),
              pendingWorkspaceTransition: {
                removedWorkspaceId: preferredId,
                workspaceId: fallbackId,
                sourceWorkspace,
              },
            })
          } else {
            clearWorkspaceScopedState()
            set({
              userWorkspaces: nextWorkspaces,
              activeWorkspaceOverrideId: 0,
              pendingWorkspaceTransition: null,
            })
            saveActiveWs(getSessionUserScope(stateBeforeUpdate.authSession), 0)
          }
        } else {
          set({ userWorkspaces: nextWorkspaces, pendingWorkspaceTransition: null })
        }
        return true
      } catch {
        return false
      }
    },

    // 切换活跃空间：只改 override，workspaceId 变化由调用方的 effect 统一触发刷新。
    switchWorkspace: (id, options) => {
      activateWorkspace(id, options)
    },

    // 创建团队：返回新建结果（toast/错误处理交给调用方）。
    createTeam: async (name) => {
      const created = await createWorkspace({ name })
      await get().loadWorkspaces()
      const createdWorkspaceId = toId(created?.id)
      if (createdWorkspaceId) {
        if (!findById(deriveAllWorkspaces(get()), createdWorkspaceId)) {
          set({ userWorkspaces: sanitizeWorkspaceList([...deriveAllWorkspaces(get()), created]) })
        }
        get().switchWorkspace(createdWorkspaceId)
      }
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
      const sourceWorkspace = deriveCurrentWorkspace(get())
      const beforeIds = new Set(
        deriveAllWorkspaces(get())
          .map((workspace) => toId(workspace?.id))
          .filter(Boolean),
      )
      const redeemed = await redeemWorkspaceInvitation({ inviteCode })
      await get().loadWorkspaces()
      const joinedWorkspaceId = pickWorkspaceId(redeemed)
      let currentList = deriveAllWorkspaces(get())
      if (joinedWorkspaceId && !findById(currentList, joinedWorkspaceId)) {
        const payloadWorkspace = pickWorkspaceFromPayload(redeemed) || {
          id: joinedWorkspaceId,
          type: 'team',
          name: '团队空间',
        }
        const nextWorkspaces = sanitizeWorkspaceList([...currentList, payloadWorkspace])
        set({ userWorkspaces: nextWorkspaces })
        currentList = nextWorkspaces
      }
      const inferredNewTeams = currentList.filter(
        (workspace) =>
          !beforeIds.has(toId(workspace?.id)) && String(workspace?.type || '').toLowerCase() !== 'personal',
      )
      const targetWorkspaceId =
        (joinedWorkspaceId && findById(currentList, joinedWorkspaceId) ? joinedWorkspaceId : 0) ||
        (inferredNewTeams.length === 1 ? toId(inferredNewTeams[0]?.id) : 0)
      if (!targetWorkspaceId) {
        throw new Error('已加入团队，但空间列表尚未同步，请刷新后重试')
      }
      return { payload: redeemed, workspaceId: targetWorkspaceId, sourceWorkspace }
    },

    deleteTeam: async (id) => {
      const targetId = toId(id)
      if (!targetId) throw new Error('团队 ID 无效')
      const target = findById(deriveAllWorkspaces(get()), targetId)
      const sourceWorkspace = deriveCurrentWorkspace(get())
      const targetType = String(target?.type || '').toLowerCase()
      if (targetType === 'personal') {
        throw new Error('个人空间不支持删除')
      }

      // 主账号(所有者)退出:必须【先手动转让主账号权限】给其他成员,这里不再自动转让(防绕过)。
      // 单人团队所有者的引导(转让/解散)由 UI 层按成员数给出;此处仅作后端调用前的防线。
      const userId = getSessionUserScope(get().authSession)
      const ownerUserId = String(target?.owner_user_id ?? target?.ownerUserId ?? '').trim()
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

      const stateAfterLeave = get()
      const removedActiveWorkspace = deriveWorkspaceId(stateAfterLeave) === targetId
      const remainingWorkspaces = deriveAllWorkspaces(stateAfterLeave).filter(
        (workspace) => toId(workspace?.id) !== targetId,
      )
      const fallback =
        remainingWorkspaces.find((workspace) => String(workspace?.type || '').toLowerCase() === 'personal') ||
        remainingWorkspaces[0] ||
        null

      // 当前创作页必须仍绑定源 workspace，直到 UI 先导航到桥接页并同步调用
      // switchWorkspace。这里提前改列表/override 会让旧组件在 workspace 0 或个人
      // scope 下执行卸载保存，重新制造“切换后显示旧草稿”。
      if (removedActiveWorkspace) {
        return { workspaceId: toId(fallback?.id), sourceWorkspace }
      }

      await get().finalizeWorkspaceRemoval(targetId)
      return { workspaceId: 0, sourceWorkspace: null }
    },

    // 解散空间(仅所有者):真删空间及其素材/项目/数据(POST /workspaces/{id}/disband)。
    // 与 deleteTeam(退出语义)不同:disband 是所有者销毁整个空间,单人团队也能删。
    disbandTeam: async (id) => {
      const targetId = toId(id)
      if (!targetId) throw new Error('团队 ID 无效')
      const target = findById(deriveAllWorkspaces(get()), targetId)
      const sourceWorkspace = deriveCurrentWorkspace(get())
      // 必须是明确的团队空间才允许解散:type 非空且非 personal(空 type 也拒绝,避免绕过守卫误删个人空间)
      const targetType = String(target?.type || '').toLowerCase()
      if (!(targetType && targetType !== 'personal')) {
        throw new Error('仅团队空间支持解散')
      }
      const userId = getSessionUserScope(get().authSession)
      const ownerUserId = String(target?.owner_user_id ?? target?.ownerUserId ?? '').trim()
      if (userId && ownerUserId && userId !== ownerUserId) {
        throw new Error('只有空间超级管理员可以解散空间')
      }
      await disbandWorkspace({ workspaceId: targetId })
      const stateAfterDisband = get()
      const removedActiveWorkspace = deriveWorkspaceId(stateAfterDisband) === targetId
      const remainingWorkspaces = deriveAllWorkspaces(stateAfterDisband).filter(
        (workspace) => toId(workspace?.id) !== targetId,
      )
      const fallback =
        remainingWorkspaces.find((workspace) => String(workspace?.type || '').toLowerCase() === 'personal') ||
        remainingWorkspaces[0] ||
        null

      if (removedActiveWorkspace) {
        return { workspaceId: toId(fallback?.id), sourceWorkspace }
      }

      await get().finalizeWorkspaceRemoval(targetId)
      return { workspaceId: 0, sourceWorkspace: null }
    },

    consumePendingWorkspaceTransition: (removedWorkspaceId) => {
      const targetId = toId(removedWorkspaceId)
      const pending = get().pendingWorkspaceTransition
      if (!pending || !targetId || pending.removedWorkspaceId !== targetId) return null
      set({ pendingWorkspaceTransition: null })
      return pending
    },

    finalizeWorkspaceRemoval: async (id) => {
      const targetId = toId(id)
      if (!targetId) return
      const finalizeUserScope = getSessionUserScope(get().authSession)
      const finalizeSessionEpoch = authSessionEpoch
      await get().loadWorkspaces()
      const current = get()
      // loadWorkspaces 会拒绝旧账号的列表响应，但 finalize 也必须停止：
      // 否则登出/换号发生在 await 期间时，会按相同数字 ID 误删新账号的空间。
      if (authSessionEpoch !== finalizeSessionEpoch || getSessionUserScope(current.authSession) !== finalizeUserScope) {
        return
      }
      const nextUserWorkspaces = current.userWorkspaces.filter((workspace) => toId(workspace?.id) !== targetId)
      const sessionWorkspaces = Array.isArray(current.authSession?.workspaces)
        ? current.authSession.workspaces.filter((workspace: any) => toId(workspace?.id) !== targetId)
        : current.authSession?.workspaces
      set({
        userWorkspaces: nextUserWorkspaces,
        ...(Array.isArray(current.authSession?.workspaces)
          ? { authSession: { ...current.authSession, workspaces: sessionWorkspaces } }
          : {}),
      })
    },
  }
})

// 把"当前活跃 workspace id"同步给 api 层(business.listAiModels 查模型时必须带 workspace_id,
// 否则后端按订阅返回空模型列表 → 出片/出图/预估全查不到模型)。初始 + 每次变化都推一次。
// 智能成片本地草稿按【当前用户】隔离:同一浏览器换账号时各存各的,避免草稿串台
// (新用户读到上个用户的 projectId → 空白 /smart 误跳 → 别人的项目 403/404 → 每次报「项目加载失败」)。
/** 为各类本地草稿和任务登记表计算统一账号作用域。 */
const deriveDraftUserScope = (s: S): string => {
  return getSessionUserScope(s.authSession)
}
setActiveWorkspaceId(deriveWorkspaceId(useWorkspaceSessionStore.getState()))
setVideoGenOwnerScope(deriveDraftUserScope(useWorkspaceSessionStore.getState()))
setSmartDraftUserScope(deriveDraftUserScope(useWorkspaceSessionStore.getState()))
setSmartDraftWorkspaceScope(deriveWorkspaceId(useWorkspaceSessionStore.getState()))
setHotCopyDraftUserScope(deriveDraftUserScope(useWorkspaceSessionStore.getState()))
setFavoriteVideoUserScope(deriveDraftUserScope(useWorkspaceSessionStore.getState()))
setSmartEntryDraftScope(
  deriveDraftUserScope(useWorkspaceSessionStore.getState()),
  deriveWorkspaceId(useWorkspaceSessionStore.getState()),
)
useWorkspaceSessionStore.subscribe((state) => {
  setActiveWorkspaceId(deriveWorkspaceId(state))
  setVideoGenOwnerScope(deriveDraftUserScope(state))
  setSmartDraftUserScope(deriveDraftUserScope(state))
  setSmartDraftWorkspaceScope(deriveWorkspaceId(state))
  setHotCopyDraftUserScope(deriveDraftUserScope(state))
  setFavoriteVideoUserScope(deriveDraftUserScope(state))
  setSmartEntryDraftScope(deriveDraftUserScope(state), deriveWorkspaceId(state))
})

// ---- Selector hooks（组件侧便捷读取派生值，保持响应式订阅）------------------
/** 订阅当前工作空间对象。 */
export const useCurrentWorkspace = () => useWorkspaceSessionStore(deriveCurrentWorkspace)
/** 订阅当前登录用户。 */
export const useCurrentUser = () => useWorkspaceSessionStore(deriveCurrentUser)
/** 订阅当前空间中的成员身份。 */
export const useCurrentMember = () => useWorkspaceSessionStore(deriveCurrentMember)
/** 订阅当前工作空间 id。 */
export const useWorkspaceId = () => useWorkspaceSessionStore(deriveWorkspaceId)
/** 浅比较订阅用户可见的全部工作空间。 */
export const useAllWorkspaces = () => useWorkspaceSessionStore(useShallow(deriveAllWorkspaces))
/** 订阅当前套餐名称。 */
export const useCurrentPlanName = () => useWorkspaceSessionStore(deriveCurrentPlanName)
/** 订阅当前套餐到期时间。 */
export const useCurrentPlanExpiresAt = () => useWorkspaceSessionStore(deriveCurrentPlanExpiresAt)
/** 订阅钱包可用积分。 */
export const useWalletCredits = () => useWorkspaceSessionStore(deriveWalletCredits)
/** 订阅套餐基础积分额度。 */
export const usePlanBaseCredits = () => useWorkspaceSessionStore(derivePlanBaseCredits)
/** 浅比较订阅当前可用的模型套餐候选。 */
export const useModelPlanCandidates = () => useWorkspaceSessionStore(useShallow(deriveModelPlanCandidates))
