import { memo, type ReactNode } from 'react'

/** 拖动时面板已隐藏，保持组件挂载但跳过每帧的父组件更新；松手后同步最新数据。 */
const CanvasDragStablePanel = memo(
  ({ children }: { dragging: boolean; nodeId: string; children: ReactNode }) => children,
  (previous, next) => previous.dragging && next.dragging && previous.nodeId === next.nodeId,
)

export default CanvasDragStablePanel
