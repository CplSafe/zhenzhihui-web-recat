import { useLayoutEffect, useRef, type HTMLAttributes, type RefObject } from 'react'
import { createPortal } from 'react-dom'

/** 页面层浮层使用屏幕坐标，避免编辑器滚动区域和画布缩放裁切菜单。 */
export default function ViewportFloatingPanel({
  panelRef,
  expansionSpace = 0,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  panelRef?: RefObject<HTMLDivElement>
  /** 为可展开选项预留空间，避免行展开后改变浮层位置。其他菜单保持原有行为。 */
  expansionSpace?: number
}) {
  const anchor = useRef<HTMLSpanElement>(null)
  const localRef = useRef<HTMLDivElement>(null)
  const ref = panelRef || localRef
  useLayoutEffect(() => {
    const element = ref.current
    const target = anchor.current?.parentElement
    if (!element || !target) return
    const reservedHeight = expansionSpace ? element.getBoundingClientRect().height + expansionSpace : 0
    const preferAbove = target.getBoundingClientRect().top >= Math.min(reservedHeight, 320) + 18
    let frame = 0
    const update = () => {
      if (reservedHeight) element.style.height = `${Math.min(reservedHeight, 320, window.innerHeight - 24)}px`
      const bounds = target.getBoundingClientRect()
      // 文案换行后高度可能含小数，offsetHeight 取整会使菜单越过视口留白。
      const { width, height } = element.getBoundingClientRect()
      const left = Math.max(12, Math.min(bounds.left, window.innerWidth - width - 12))
      const above = bounds.top - height - 6
      const top = Math.max(
        12,
        Math.min(
          (reservedHeight ? preferAbove : above >= 12) ? above : bounds.bottom + 6,
          window.innerHeight - height - 12,
        ),
      )
      element.style.left = `${left}px`
      element.style.top = `${top}px`
      element.style.visibility = getComputedStyle(target).visibility
      frame = requestAnimationFrame(update)
    }
    update()
    return () => cancelAnimationFrame(frame)
  }, [ref, expansionSpace])
  return (
    <>
      <span ref={anchor} hidden />
      {createPortal(
        <div
          {...props}
          ref={ref}
          style={{
            ...props.style,
            position: 'fixed',
            bottom: 'auto',
            width: 320,
            minWidth: 0,
            zIndex: 1400,
            boxSizing: 'border-box',
            maxWidth: 'calc(100vw - 24px)',
            maxHeight: 'min(var(--floating-max-height, 320px), calc(100dvh - 24px))',
          }}
        />,
        document.body,
      )}
    </>
  )
}
