/**
 * 元素尺寸监听工具：优先使用 ResizeObserver，并为不支持它的旧版 Safari 提供安全降级。
 * 返回统一的取消函数，避免组件卸载后继续触发回调。
 */
export function observeElementResize(element: Element, callback: () => void): () => void {
  callback()

  const ResizeObserverCtor = globalThis.ResizeObserver
  if (typeof ResizeObserverCtor === 'function') {
    const observer = new ResizeObserverCtor(callback)
    observer.observe(element)
    return () => observer.disconnect()
  }

  const view = element.ownerDocument?.defaultView
  if (!view) return () => undefined

  view.addEventListener('resize', callback)
  view.addEventListener('orientationchange', callback)
  return () => {
    view.removeEventListener('resize', callback)
    view.removeEventListener('orientationchange', callback)
  }
}
