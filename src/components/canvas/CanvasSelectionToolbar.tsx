/**
 * 多选后浮在选区上方的批量操作条。
 *
 * 单选时的操作挂在节点自己身上（节点顶部的操作胶囊 + 下方的编辑面板），
 * 多选时那套用不了——它们都以「唯一的那个节点」为前提。这里承接只有多选才成立的动作。
 *
 * 位置由调用方按选区包围盒算好后传入（视口坐标），组件本身不关心画布变换。
 */
import styles from './CanvasSelectionToolbar.module.css'

export interface CanvasSelectionToolbarProps {
  /** 选中的节点总数，用于文案 */
  count: number
  /** 其中可加入时间线的视频数量（已生成出素材的）；为 0 时隐藏该动作 */
  timelineReadyCount: number
  /** 视口坐标：工具条的水平中心与底边位置 */
  anchor: { centerX: number; bottom: number }
  /** 选中的正好是某个分组的全部成员时为 true，此时给「解组」而不是「打组」 */
  isGroup: boolean
  onGroup: () => void
  onUngroup: () => void
  onCreateTimeline: () => void
  onDelete: () => void
  onClear: () => void
}

export default function CanvasSelectionToolbar({
  count,
  timelineReadyCount,
  anchor,
  isGroup,
  onGroup,
  onUngroup,
  onCreateTimeline,
  onDelete,
  onClear,
}: CanvasSelectionToolbarProps) {
  return (
    <div
      className={`${styles.bar} nodrag nopan`}
      style={{ left: anchor.centerX, bottom: anchor.bottom }}
      role="toolbar"
      aria-label={`已选中 ${count} 个节点`}
      // 画布在捕获阶段处理指针事件，不拦住会连带触发框选与取消选中
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <span className={styles.count}>已选 {count}</span>

      <span className={styles.divider} aria-hidden="true" />

      {/* 同一个位置给「打组」或「解组」：两者互斥，并排放会让人先判断该点哪个 */}
      {isGroup ? (
        <button type="button" className={styles.action} onClick={onUngroup} title="解散这个分组，节点位置不变">
          <UngroupIcon />
          解组
        </button>
      ) : (
        <button type="button" className={styles.action} onClick={onGroup} title="编为一组，之后选中其一即选中整组">
          <GroupIcon />
          打组
        </button>
      )}

      {timelineReadyCount > 0 && (
        <button
          type="button"
          className={styles.action}
          onClick={onCreateTimeline}
          title={`把选中的 ${timelineReadyCount} 个视频按当前顺序串成一条时间线`}
        >
          <TimelineIcon />
          创建剪辑时间线
          {/* 选中里混着图片/文本或未生成完的视频时说清楚会带走几个，避免用户以为全都进去了 */}
          {timelineReadyCount !== count && <em className={styles.hint}>{timelineReadyCount} 个视频</em>}
        </button>
      )}

      <button type="button" className={`${styles.action} ${styles.danger}`} onClick={onDelete} title="删除选中的节点">
        <TrashIcon />
        删除
      </button>

      <span className={styles.divider} aria-hidden="true" />

      <button type="button" className={styles.plain} onClick={onClear} title="取消选择">
        取消
      </button>
    </div>
  )
}

function GroupIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="8" height="8" rx="1.5" />
      <rect x="13" y="13" width="8" height="8" rx="1.5" />
      <path d="M13 7h4a4 4 0 0 1 4 4v0" strokeLinecap="round" />
    </svg>
  )
}

function UngroupIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="8" height="8" rx="1.5" />
      <rect x="13" y="13" width="8" height="8" rx="1.5" />
      <path d="M13 8.5l7-4" strokeLinecap="round" strokeDasharray="2.5 2.5" />
    </svg>
  )
}

function TimelineIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M3 10h18M8 6v12M16 6v12" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 7h16M10 7V5h4v2M6 7l1 12h10l1-12" />
    </svg>
  )
}
