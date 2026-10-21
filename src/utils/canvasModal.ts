/** Ant Design 保留关闭后的 DOM，不能只凭 aria-modal 判断是否仍打开。 */
export function hasOpenCanvasModal(): boolean {
  return Array.from(document.querySelectorAll<HTMLElement>('[aria-modal="true"]')).some((dialog) => {
    // rc-dialog 的 modalRender 内容位于 aria-modal 容器内，手写 Portal 也可能把标记放在外层。
    if (dialog.closest('[data-canvas-nonmodal="true"]') || dialog.querySelector('[data-canvas-nonmodal="true"]'))
      return false
    let current: HTMLElement | null = dialog
    while (current) {
      const style = getComputedStyle(current)
      if (current.hidden || current.getAttribute('aria-hidden') === 'true' || style.display === 'none') return false
      current = current.parentElement
    }
    return getComputedStyle(dialog).visibility !== 'hidden'
  })
}
