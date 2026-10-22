import { useLayoutEffect, useRef, type HTMLAttributes, type RefObject } from 'react'
import { createPortal } from 'react-dom'

/** 页面层浮层使用屏幕坐标，避免编辑器滚动区域和画布缩放裁切菜单。 */
export default function ViewportFloatingPanel({
  panelRef,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  panelRef?: RefObject<HTMLDivElement>
}) {
  const anchor = useRef<HTMLSpanElement>(null)
  const localRef = useRef<HTMLDivElement>(null)
  const ref = panelRef || localRef
  useLayoutEffect(() => {
    const element = ref.current
    const target = anchor.current?.parentElement
    if (!element || !target) return
    let frame = 0
    const update = () => {
      const bounds = target.getBoundingClientRect()
      const width = element.offsetWidth
      const height = element.offsetHeight
      const left = Math.max(12, Math.min(bounds.left, window.innerWidth - width - 12))
      const above = bounds.top - height - 6
      const top = Math.max(12, Math.min(above >= 12 ? above : bounds.bottom + 6, window.innerHeight - height - 12))
      element.style.left = `${left}px`
      element.style.top = `${top}px`
      element.style.visibility = getComputedStyle(target).visibility
      frame = requestAnimationFrame(update)
    }
    update()
    return () => cancelAnimationFrame(frame)
  }, [ref])
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
