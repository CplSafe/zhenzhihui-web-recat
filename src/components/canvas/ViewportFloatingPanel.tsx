import { useLayoutEffect, useRef, type HTMLAttributes, type RefObject } from 'react'
import { createPortal } from 'react-dom'

/** 页面层浮层使用屏幕坐标，避免编辑器滚动区域和画布缩放裁切菜单。 */
export default function ViewportFloatingPanel({
  panelRef,
  expansionSpace = 0,
  anchorPoint,
  anchorElement,
  layer = 1400,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  panelRef?: RefObject<HTMLDivElement>
  /** Prefer the actual trigger over the hidden portal marker when positioning a menu. */
  anchorElement?: HTMLElement | null
  /** 显式屏幕坐标锚点；用于节点工具条等不在 DOM 常规流里的触发点。 */
  anchorPoint?: { x: number; y: number } | null
  /** 为可展开选项预留空间，避免行展开后改变浮层位置。其他菜单保持原有行为。 */
  expansionSpace?: number
  /** 默认浮层层级；需要压过节点提示时由调用方提高。 */
  layer?: number
}) {
  const anchor = useRef<HTMLSpanElement>(null)
  const localRef = useRef<HTMLDivElement>(null)
  const ref = panelRef || localRef
  const anchorX = anchorPoint?.x
  const anchorY = anchorPoint?.y
  useLayoutEffect(() => {
    const element = ref.current
    const target = anchorElement || anchor.current?.parentElement
    if (!element || (!target && (anchorX === undefined || anchorY === undefined))) return
    const reservedHeight = expansionSpace ? element.getBoundingClientRect().height + expansionSpace : 0
    let frame = 0
    const update = () => {
      if (anchorX !== undefined && anchorY !== undefined) {
        const { width, height } = element.getBoundingClientRect()
        const left = Math.max(12, Math.min(anchorX - width / 2, window.innerWidth - width - 12))
        const below = anchorY + 8
        const top =
          below + height <= window.innerHeight - 12
            ? below
            : Math.max(12, Math.min(anchorY - height - 8, window.innerHeight - height - 12))
        element.style.left = `${left}px`
        element.style.top = `${top}px`
        element.style.visibility = 'visible'
        return
      }
      if (!target) return
      const bounds = target.getBoundingClientRect()
      let placeAbove = false
      if (reservedHeight) {
        const requestedHeight = Math.min(reservedHeight, 700, window.innerHeight - 24)
        const roomAbove = Math.max(0, bounds.top - 18)
        const roomBelow = Math.max(0, window.innerHeight - bounds.bottom - 18)
        // 优先放在触发器上方，避免长模型菜单盖住节点里的生成/参数按钮。
        // 屏幕空间不足时缩短菜单并在内部滚动；只有上方几乎无空间时才改放下方。
        placeAbove = roomAbove >= Math.min(requestedHeight, 220) || roomAbove >= roomBelow
        const availableHeight = placeAbove ? roomAbove : roomBelow
        element.style.height = `${Math.max(120, Math.min(requestedHeight, availableHeight))}px`
      }
      // 文案换行后高度可能含小数，offsetHeight 取整会使菜单越过视口留白。
      const { width, height } = element.getBoundingClientRect()
      const left = Math.max(12, Math.min(bounds.left, window.innerWidth - width - 12))
      const above = bounds.top - height - 6
      const top = Math.max(
        12,
        Math.min(
          (reservedHeight ? placeAbove : above >= 12) ? above : bounds.bottom + 6,
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
  }, [ref, expansionSpace, anchorElement, anchorX, anchorY])
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
            zIndex: layer,
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
