import { memo, type ReactNode } from 'react'

/** 拖动时外层随节点移动，面板内容跳过逐帧更新，松手后同步最新数据。 */
const CanvasDragStablePanel = memo(
  ({ children }: { dragging: boolean; nodeId: string; children: ReactNode }) => children,
  (previous, next) => previous.dragging && next.dragging && previous.nodeId === next.nodeId,
)

export default CanvasDragStablePanel
