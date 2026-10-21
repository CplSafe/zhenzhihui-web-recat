import type { ReactNode } from 'react'

/** Portal 仍沿 React 组件树冒泡，避免弹窗按钮触发底层节点的选中/拖动。 */
export default function CanvasPortalBoundary({
  children,
  floating = false,
}: {
  children: ReactNode
  floating?: boolean
}) {
  return (
    <div
      data-canvas-nonmodal={floating ? 'true' : undefined}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  )
}
