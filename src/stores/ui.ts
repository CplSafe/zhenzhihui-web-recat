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

  showToast: (message: string, type?: ToastType, duration?: number) => void
  clearToast: () => void

  requestConfirm: (message: string, options?: ConfirmOptions) => Promise<boolean | string | null>
  resolveConfirm: (value: boolean | string | null) => void
  setConfirmInput: (value: string) => void

  setDirty: (dirty: boolean) => void
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
}))

// ---- 便捷取值（在非组件上下文中直接调用）-----------------------------------
export const showToast = (message: string, type?: ToastType, duration?: number) =>
  useUiStore.getState().showToast(message, type, duration)

export const requestConfirm = (message: string, options?: ConfirmOptions) =>
  useUiStore.getState().requestConfirm(message, options)
