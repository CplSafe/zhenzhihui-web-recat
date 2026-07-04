/**
 * useAssetPreview — 素材预览 hook
 *
 * 模块级共享单例：页面中只有一个预览弹窗，遵循项目 useConfirmDialog 的共享状态模式。
 * 挂载 <AssetPreviewModal state={previewState} /> 到页面层级即可使用。
 *
 * Usage:
 *   const { openPreview, closePreview, previewState } = useAssetPreview()
 *   openPreview(cards, 3)  // 从第 4 张卡片开始预览
 */
import { useEffect, useState } from 'react'

export interface AssetPreviewState {
  visible: boolean
  /** 当前预览的素材卡片列表 */
  items: any[]
  /** 当前高亮的素材索引（从 0 开始） */
  activeIndex: number
}

// ============================================================================
// 模块级共享状态（单例模式）—— 用一个可订阅的 store 替代 Vue reactive。
// ============================================================================

let sharedPreviewState: AssetPreviewState = {
  visible: false,
  items: [],
  activeIndex: 0,
}

const subscribers = new Set<() => void>()

function notify() {
  subscribers.forEach((fn) => fn())
}

function setState(next: AssetPreviewState) {
  sharedPreviewState = next
  notify()
}

// ============================================================================
// 静默状态变更（供键盘处理器使用，不依赖组件实例）
// ============================================================================

function closePreviewSilent() {
  setState({ visible: false, items: [], activeIndex: 0 })
}

function goPrevSilent() {
  if (sharedPreviewState.activeIndex > 0) {
    setState({ ...sharedPreviewState, activeIndex: sharedPreviewState.activeIndex - 1 })
  }
}

function goNextSilent() {
  if (sharedPreviewState.activeIndex < sharedPreviewState.items.length - 1) {
    setState({ ...sharedPreviewState, activeIndex: sharedPreviewState.activeIndex + 1 })
  }
}

// ============================================================================
// 键盘事件处理器（模块级，只注册一次）
// ============================================================================

let globalKeyHandler: ((e: KeyboardEvent) => void) | null = null
let handlerCount = 0

function ensureGlobalKeyboard() {
  handlerCount += 1
  if (globalKeyHandler) return
  globalKeyHandler = (e: KeyboardEvent) => {
    if (!sharedPreviewState.visible) return
    if (e.key === 'Escape') {
      closePreviewSilent()
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      goPrevSilent()
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      goNextSilent()
    }
  }
  window.addEventListener('keydown', globalKeyHandler)
}

function teardownGlobalKeyboard() {
  handlerCount = Math.max(0, handlerCount - 1)
  if (handlerCount > 0 || !globalKeyHandler) return
  window.removeEventListener('keydown', globalKeyHandler)
  globalKeyHandler = null
}

// ============================================================================
// Hook 入口
// ============================================================================

export function useAssetPreview() {
  // 订阅模块级共享状态，使组件随状态变化重渲染。
  const [, forceRender] = useState(0)

  useEffect(() => {
    const sub = () => forceRender((n) => n + 1)
    subscribers.add(sub)
    ensureGlobalKeyboard()
    return () => {
      subscribers.delete(sub)
      teardownGlobalKeyboard()
    }
  }, [])

  // ---- 派生值 ----
  const activeItem = sharedPreviewState.items[sharedPreviewState.activeIndex] || null
  const hasPrev = sharedPreviewState.activeIndex > 0
  const hasNext = sharedPreviewState.activeIndex < sharedPreviewState.items.length - 1
  const totalCount = sharedPreviewState.items.length

  // ---- methods ----

  /**
   * 打开预览。
   * @param items       同 displayedResourceCards 格式的卡片数组
   * @param startIndex  初始高亮的卡片索引（默认 0）
   */
  function openPreview(items: any[], startIndex = 0) {
    const list = Array.isArray(items) ? items : []
    if (!list.length) return
    const idx = Math.max(0, Math.min(startIndex, list.length - 1))
    setState({ items: list, activeIndex: idx, visible: true })
  }

  /** 关闭预览 */
  function closePreview() {
    closePreviewSilent()
  }

  /** 切换到上一张 */
  function goPrev() {
    goPrevSilent()
  }

  /** 切换到下一张 */
  function goNext() {
    goNextSilent()
  }

  return {
    /** 只读的模块级状态（传递给弹窗组件） */
    previewState: sharedPreviewState,
    activeItem,
    hasPrev,
    hasNext,
    totalCount,
    openPreview,
    closePreview,
    goPrev,
    goNext,
  }
}
