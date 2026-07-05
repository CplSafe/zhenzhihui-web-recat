/**
 * Zustand Store: 全局 UI（Toast + Confirm/Prompt 对话框 + 脏状态）
 *
 * 对应原 Vue 的 useToast / useConfirmDialog 模块级共享状态（sharedConfirmState /
 * sharedDirtyState）。React 侧统一为全局 store：任意组件调用 showToast / requestConfirm，
 * 由顶层挂载的 <AppToast/> 与 <AppConfirmDialog/> 单例渲染。
 */
import { create } from 'zustand'

export type ToastType = 'info' | 'success' | 'error'

export interface ToastState {
  visible: boolean
  message: string
  type: ToastType
}

export type ConfirmResolve = (value: boolean | string | null) => void

export interface ConfirmState {
  visible: boolean
  id: number
  title: string
  message: string
  inputEnabled: boolean
  inputValue: string
  inputLabel: string
  inputPlaceholder: string
  confirmLabel: string
  cancelLabel: string
  danger: boolean
  resolve: ConfirmResolve | null
}

export interface ConfirmOptions {
  title?: string
  inputEnabled?: boolean
  inputValue?: string
  inputLabel?: string
  inputPlaceholder?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

export interface UiState {
  toast: ToastState
  confirm: ConfirmState
  dirty: boolean
  workspaceSwitchLocked: boolean
  workspaceSwitchLockReason: string
  // 会员中心:全局单例弹窗开关(取代原 /membership 路由页),由顶层 <MemberCenterModal/> 渲染。
  memberCenterOpen: boolean
  // 团队管理:全局单例弹窗开关(邀请成员 / 成员管理 / 团队数据),由顶层 <TeamManagementModal/> 渲染。
  teamManageOpen: boolean
  // 打开时初始 tab:'members'(成员管理,默认)/ 'data'(团队数据,点团队空间名进入)
  teamManageTab: 'members' | 'data'
  // 加入空间:全局单例弹窗开关(输入邀请码加入团队),由顶层 <GlobalJoinTeamDialog/> 渲染。
  joinTeamOpen: boolean
  // 「功能待开放」全局单例弹窗:任意页面点未上线项时弹出,由顶层 <ComingSoonDialog/> 渲染。
  comingSoonOpen: boolean
  // 左侧主侧栏(AppSidebar)桌面端是否收起(窄图标轨)。跨页面保持,故放全局 store。
  sidebarCollapsed: boolean

  showToast: (message: string, type?: ToastType, duration?: number) => void
  clearToast: () => void

  requestConfirm: (message: string, options?: ConfirmOptions) => Promise<boolean | string | null>
  resolveConfirm: (value: boolean | string | null) => void
  setConfirmInput: (value: string) => void

  setDirty: (dirty: boolean) => void
  setWorkspaceSwitchLock: (locked: boolean, reason?: string) => void

  openMemberCenter: () => void
  closeMemberCenter: () => void

  openTeamManage: (tab?: 'members' | 'data') => void
  closeTeamManage: () => void

  openJoinTeam: () => void
  closeJoinTeam: () => void

  openComingSoon: () => void
  closeComingSoon: () => void

  toggleSidebarCollapsed: () => void
  setSidebarCollapsed: (collapsed: boolean) => void
}

const DEFAULT_TOAST_DURATION = 5000

let toastTimer: ReturnType<typeof setTimeout> | null = null
let confirmIdCounter = 0

const initialConfirm: ConfirmState = {
  visible: false,
  id: 0,
  title: '',
  message: '',
  inputEnabled: false,
  inputValue: '',
  inputLabel: '',
  inputPlaceholder: '',
  confirmLabel: '确认',
  cancelLabel: '取消',
  danger: false,
  resolve: null,
}

export const useUiStore = create<UiState>((set, get) => ({
  toast: { visible: false, message: '', type: 'info' },
  confirm: { ...initialConfirm },
  dirty: false,
  workspaceSwitchLocked: false,
  workspaceSwitchLockReason: '',
  memberCenterOpen: false,
  teamManageOpen: false,
  teamManageTab: 'members',
  joinTeamOpen: false,
  comingSoonOpen: false,
  sidebarCollapsed: false,

  showToast: (message, type = 'info', duration = DEFAULT_TOAST_DURATION) => {
    if (!message) {
      get().clearToast()
      return
    }
    if (toastTimer) clearTimeout(toastTimer)
    set({ toast: { visible: true, message, type } })
    if (duration > 0) {
      toastTimer = setTimeout(() => get().clearToast(), duration)
    }
  },

  clearToast: () => {
    if (toastTimer) {
      clearTimeout(toastTimer)
      toastTimer = null
    }
    set({ toast: { visible: false, message: '', type: 'info' } })
  },

  requestConfirm: (message, options = {}) => {
    // Resolve any pending request first (guard against overlap).
    const pending = get().confirm.resolve
    if (pending) pending(get().confirm.inputEnabled ? null : false)

    return new Promise<boolean | string | null>((resolve) => {
      confirmIdCounter += 1
      set({
        confirm: {
          visible: true,
          id: confirmIdCounter,
          title: options.title || '确认操作',
          message: message || '',
          inputEnabled: Boolean(options.inputEnabled),
          inputValue: options.inputValue || '',
          inputLabel: options.inputLabel || '',
          inputPlaceholder: options.inputPlaceholder || '请输入',
          confirmLabel: options.confirmLabel || '确认',
          cancelLabel: options.cancelLabel || '取消',
          danger: Boolean(options.danger),
          resolve,
        },
      })
    })
  },

  resolveConfirm: (value) => {
    const { resolve } = get().confirm
    resolve?.(value)
    set({ confirm: { ...get().confirm, visible: false, resolve: null } })
  },

  setConfirmInput: (value) => set({ confirm: { ...get().confirm, inputValue: value } }),

  setDirty: (dirty) => set({ dirty }),
  setWorkspaceSwitchLock: (locked, reason = '') =>
    set({
      workspaceSwitchLocked: Boolean(locked),
      workspaceSwitchLockReason: locked ? String(reason || '').trim() : '',
    }),

  openMemberCenter: () => set({ memberCenterOpen: true }),
  closeMemberCenter: () => set({ memberCenterOpen: false }),

  openTeamManage: (tab: 'members' | 'data' = 'members') => set({ teamManageOpen: true, teamManageTab: tab }),
  closeTeamManage: () => set({ teamManageOpen: false }),

  openJoinTeam: () => set({ joinTeamOpen: true }),
  closeJoinTeam: () => set({ joinTeamOpen: false }),

  openComingSoon: () => set({ comingSoonOpen: true }),
  closeComingSoon: () => set({ comingSoonOpen: false }),

  toggleSidebarCollapsed: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
}))

// ---- 便捷取值（在非组件上下文中直接调用）-----------------------------------
export const showToast = (message: string, type?: ToastType, duration?: number) =>
  useUiStore.getState().showToast(message, type, duration)

export const requestConfirm = (message: string, options?: ConfirmOptions) =>
  useUiStore.getState().requestConfirm(message, options)

/** 弹出全局「功能待开放」弹窗(任意上下文可调用)。 */
export const openComingSoon = () => useUiStore.getState().openComingSoon()

/** 弹出全局「会员中心」弹窗(含积分充值;任意上下文可调用)。 */
export const openMemberCenter = () => useUiStore.getState().openMemberCenter()
export const openTeamManage = (tab?: 'members' | 'data') => useUiStore.getState().openTeamManage(tab)
export const openJoinTeam = () => useUiStore.getState().openJoinTeam()
