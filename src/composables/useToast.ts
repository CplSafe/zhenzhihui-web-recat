/**
 * 兼容原 Vue composable 命名的 React hooks 封装。
 * 底层为全局 useUiStore（src/stores/ui.ts）。
 */
import { useUiStore } from '../stores/ui'
import type { ToastType, ConfirmOptions } from '../stores/ui'

/** 返回 { showToast, clearToast }，对应原 useToast。 */
export function useToast() {
  const showToast = useUiStore((s) => s.showToast)
  const clearToast = useUiStore((s) => s.clearToast)
  return { showToast, clearToast }
}

/** 返回 { requestConfirm }，对应原 useConfirmDialog。 */
export function useConfirmDialog() {
  const requestConfirm = useUiStore((s) => s.requestConfirm)
  return { requestConfirm }
}

/** 向调用方转出全局提示与确认框的公共类型。 */
export type { ToastType, ConfirmOptions }
