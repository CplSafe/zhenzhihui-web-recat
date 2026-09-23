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
  /** 小地图当前是否显示；开关就放在这条控制条上（它本就是「怎么看画布」的一部分） */
  minimapVisible: boolean
  onMinimapToggle: () => void
  /** 打开画布设置（滚轮行为、辅助线、通知…）；不传则不显示按钮 */
  onOpenSettings?: () => void
  /** 打开快捷键速查；不传则不显示按钮 */
  onOpenHelp?: () => void
  /**
   * 画布规模读数：节点 / 连线 / 失败数。
   * 几百个节点的画布里「有几个生成失败了」靠肉眼扫不出来，这里给个数，失败数不为零就红。
   */
  stats?: { nodes: number; edges: number; failed: number }
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
  minimapVisible,
  onMinimapToggle,
  onOpenSettings,
  onOpenHelp,
  stats,
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

      {/*
       * 小地图开关。它本来只能一直占着左下角那 190×130，
       * 画布内容靠近左下时挡视线也关不掉——开关放这里最顺手，
       * 因为这条控制条本就是「怎么看这张画布」的集合。
       */}
      <button
        type="button"
        className={`${styles.btn} ${styles.minimapToggle} ${minimapVisible ? styles.btnActive : ''}`}
        onClick={onMinimapToggle}
        title={minimapVisible ? '隐藏小地图' : '显示小地图'}
        aria-label="小地图"
        aria-pressed={minimapVisible}
      >
        <MiniMapIcon />
      </button>

      {(onOpenSettings || onOpenHelp) && <span className={styles.divider} aria-hidden="true" />}

      {onOpenSettings && (
        <button type="button" className={styles.btn} onClick={onOpenSettings} title="画布设置" aria-label="画布设置">
          <GearIcon />
        </button>
      )}

      {onOpenHelp && (
        <button
          type="button"
          className={styles.btn}
          onClick={onOpenHelp}
          title="快捷键速查（Shift + ?）"
          aria-label="快捷键速查"
        >
          <HelpIcon />
        </button>
      )}

      {stats && (
        <>
          <span className={styles.divider} aria-hidden="true" />
          <span
            className={styles.stats}
            title={`节点 ${stats.nodes} · 连线 ${stats.edges}${stats.failed > 0 ? ` · ${stats.failed} 个生成失败` : ''}`}
            aria-label={`画布共 ${stats.nodes} 个节点、${stats.edges} 条连线${stats.failed > 0 ? `，${stats.failed} 个生成失败` : ''}`}
          >
            <span className={styles.stat}>
              <NodeCountIcon />
              {stats.nodes}
            </span>
            <span className={styles.stat}>
              <EdgeCountIcon />
              {stats.edges}
            </span>
            {stats.failed > 0 && (
              <span className={`${styles.stat} ${styles.statFailed}`}>
                <WarnIcon />
                {stats.failed}
              </span>
            )}
          </span>
        </>
      )}
    </div>
  )
}

function GearIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  )
}

function HelpIcon() {
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
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7" />
      <circle cx="12" cy="17" r="0.6" fill="currentColor" />
    </svg>
  )
}

function NodeCountIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <rect x="4" y="4" width="16" height="16" rx="3" />
    </svg>
  )
}

function EdgeCountIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="5" cy="6" r="2" />
      <circle cx="19" cy="18" r="2" />
      <path d="M7 7.5C11 10 13 14 17 16.5" />
    </svg>
  )
}

function WarnIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3 2.5 20h19L12 3z" />
      <path d="M12 10v4M12 17.5v.5" />
    </svg>
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

/** 小地图图标：一个外框 + 右下角的视口方块，正是小地图本身的样子。 */
function MiniMapIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <rect x="12.5" y="12" width="6" height="5" rx="1" fill="currentColor" stroke="none" />
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
