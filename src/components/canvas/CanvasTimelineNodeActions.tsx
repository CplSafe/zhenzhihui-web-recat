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
    <div className={styles.actions} role="toolbar" aria-label="视频剪辑操作">
      <button
        type="button"
        className={`${styles.action} ${styles.refine}`}
        title="打开编辑器做精细裁剪"
        aria-label="精修"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          onOpenEditor(nodeId)
        }}
      >
        <EditIcon />
        <span className={styles.label}>精修</span>
      </button>

      <button
        type="button"
        className={`${styles.action} ${styles.compose}`}
        disabled={!canCompose}
        title={clipCount < 2 ? '至少需要 2 个片段才能合成' : '把各段无损拼成一条视频'}
        aria-label={composing ? composeProgress || '合成中…' : '合成'}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          onCompose(nodeId)
        }}
      >
        {composing ? <span className={styles.spinner} aria-hidden="true" /> : <MergeIcon />}
        <span className={styles.label}>{composing ? composeProgress || '合成中…' : '合成'}</span>
      </button>
    </div>
  )
}

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M4 20h4l10.7-10.7a2.1 2.1 0 0 0-3-3L5 17v3Z" strokeLinejoin="round" />
      <path d="m13.8 8.2 3 3" />
    </svg>
  )
}

function MergeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M5 6h4a3 3 0 0 1 3 3v6a3 3 0 0 0 3 3h4" strokeLinecap="round" />
      <path d="m16 15 3 3-3 3M5 18h4a3 3 0 0 0 3-3V9a3 3 0 0 1 3-3h4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m16 3 3 3-3 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
