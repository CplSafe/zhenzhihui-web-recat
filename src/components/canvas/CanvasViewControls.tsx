/**
 * 画布左下角的视图控制条。
 *
 * 把「怎么看这张画布」的开关收在一处：缩放、复位、网格吸附、隐藏连线。
 * 之前这里只有一个孤立的复位按钮，缩放全靠滚轮——没有当前倍率的读数，
 * 也没法回到 100%，用户只能一直滚到「看着差不多」。
 *
 * 与小地图同处左下角是有意的：它们同属「视图导航」，分散在两角会让人来回找。
 */
import styles from './CanvasViewControls.module.css'

export interface CanvasViewControlsProps {
  /** 当前缩放倍率（1 = 100%） */
  zoom: number
  onZoomIn: () => void
  onZoomOut: () => void
  /** 点击倍率读数回到 100% */
  onZoomReset: () => void
  /** 复位视图：缩放到刚好装下全部节点 */
  onFitView: () => void
  snapEnabled: boolean
  onSnapToggle: () => void
  edgesHidden: boolean
  onEdgesToggle: () => void
}

export default function CanvasViewControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onFitView,
  snapEnabled,
  onSnapToggle,
  edgesHidden,
  onEdgesToggle,
}: CanvasViewControlsProps) {
  // 极小倍率下 1% 的精度已经没有意义，但读数不能显示成 0%——那看起来像坏了
  const percent = Math.max(1, Math.round((Number(zoom) || 1) * 100))

  return (
    <div className={`${styles.bar} nodrag nopan`} role="toolbar" aria-label="画布视图控制">
      <button type="button" className={styles.btn} onClick={onZoomOut} title="缩小" aria-label="缩小">
        <MinusIcon />
      </button>

      {/* 读数本身可点：这是回到 100% 最直觉的入口，比再加一个按钮省地方 */}
      <button
        type="button"
        className={styles.zoomValue}
        onClick={onZoomReset}
        title="点击回到 100%"
        aria-label={`当前缩放 ${percent}%，点击回到 100%`}
      >
        {percent}%
      </button>

      <button type="button" className={styles.btn} onClick={onZoomIn} title="放大" aria-label="放大">
        <PlusIcon />
      </button>

      <span className={styles.divider} aria-hidden="true" />

      <button type="button" className={styles.btn} onClick={onFitView} title="复位视图" aria-label="复位视图">
        <FitIcon />
      </button>

      <button
        type="button"
        className={`${styles.btn} ${snapEnabled ? styles.btnActive : ''}`}
        onClick={onSnapToggle}
        title={snapEnabled ? '关闭网格吸附' : '开启网格吸附'}
        aria-label="网格吸附"
        aria-pressed={snapEnabled}
      >
        <GridIcon />
      </button>

      <button
        type="button"
        className={`${styles.btn} ${edgesHidden ? styles.btnActive : ''}`}
        onClick={onEdgesToggle}
        title={edgesHidden ? '显示连线' : '隐藏连线'}
        aria-label="隐藏连线"
        aria-pressed={edgesHidden}
      >
        <EdgeIcon hidden={edgesHidden} />
      </button>
    </div>
  )
}

function MinusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function FitIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
    </svg>
  )
}

function GridIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
    </svg>
  )
}

function EdgeIcon({ hidden }: { hidden: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    >
      <circle cx="5" cy="6" r="2.2" />
      <circle cx="19" cy="18" r="2.2" />
      <path d="M7 7.6C11 10 13 14 17 16.4" />
      {/* 隐藏态加一道斜杠，光靠高亮分不出「开着」还是「关着」 */}
      {hidden && <line x1="4" y1="20" x2="20" y2="4" strokeWidth="1.8" />}
    </svg>
  )
}
