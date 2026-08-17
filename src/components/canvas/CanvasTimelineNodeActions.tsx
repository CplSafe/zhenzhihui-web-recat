/**
 * 剪辑时间线节点的顶部操作胶囊：精修 / 合成。
 *
 * 与「删除」同处节点上方那一组，用同一套 canvas-node-upload-btn 外观。
 * 这两个是针对整条时间线的动作；「添加视频」在轨道末尾的「+」上，
 * 紧挨着被添加的东西，比放在这里更直觉。
 *
 * 只负责交互，状态由上层持有；按钮上的 stopPropagation 是必须的，
 * 否则点击会冒泡成 React Flow 的节点拖拽。
 */
import styles from './CanvasTimelineNodeActions.module.css'

/** 画布上可加入时间线的一个视频节点。 */
export interface CanvasTimelineSource {
  nodeId: string
  assetId: number
  label: string
  thumbnailUrl: string
}

interface CanvasTimelineNodeActionsProps {
  nodeId: string
  clipCount: number
  composing?: boolean
  composeProgress?: string
  onCompose: (timelineNodeId: string) => void
  onOpenEditor: (timelineNodeId: string) => void
}

export default function CanvasTimelineNodeActions({
  nodeId,
  clipCount,
  composing = false,
  composeProgress = '',
  onCompose,
  onOpenEditor,
}: CanvasTimelineNodeActionsProps) {
  const canCompose = clipCount >= 2 && !composing

  return (
    <>
      <button
        type="button"
        className="canvas-node-upload-btn"
        title="打开编辑器做精细裁剪"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          onOpenEditor(nodeId)
        }}
      >
        <span className="canvas-node-upload-btn__label">精修</span>
      </button>

      <button
        type="button"
        className={`canvas-node-upload-btn ${styles.compose}`}
        disabled={!canCompose}
        title={clipCount < 2 ? '至少需要 2 个片段才能合成' : '把各段无损拼成一条视频'}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          onCompose(nodeId)
        }}
      >
        <span className="canvas-node-upload-btn__label">{composing ? composeProgress || '合成中…' : '合成'}</span>
      </button>
    </>
  )
}
