import styles from './CanvasViewControls.module.css'
import { ArrangeIcon, MiniMapIcon, EdgeIcon, MagnetIcon } from './CanvasControlIcons'

export interface CanvasViewControlsProps {
  zoom: number
  onArrange: () => void
  onZoomReset: () => void
  snapEnabled: boolean
  onSnapToggle: () => void
  edgesHidden: boolean
  onEdgesToggle: () => void
  minimapVisible: boolean
  onMinimapToggle: () => void
}

/** Only the five persistent controls shown beside the canvas. */
export default function CanvasViewControls({
  zoom,
  onArrange,
  onZoomReset,
  snapEnabled,
  onSnapToggle,
  edgesHidden,
  onEdgesToggle,
  minimapVisible,
  onMinimapToggle,
}: CanvasViewControlsProps) {
  const percent = Math.max(1, Math.round((Number(zoom) || 1) * 100))
  return (
    <div className={`${styles.bar} nodrag nopan`} role="toolbar" aria-label="画布视图控制">
      <button type="button" className={styles.btn} onClick={onArrange} title="整理画布" aria-label="整理画布">
        <ArrangeIcon />
      </button>
      <button
        type="button"
        className={`${styles.btn} ${minimapVisible ? styles.active : ''}`}
        onClick={onMinimapToggle}
        title={minimapVisible ? '隐藏小地图' : '显示小地图'}
        aria-label="小地图"
        aria-pressed={minimapVisible}
      >
        <MiniMapIcon />
      </button>
      <button
        type="button"
        className={`${styles.btn} ${edgesHidden ? styles.active : ''}`}
        onClick={onEdgesToggle}
        title={edgesHidden ? '显示连线' : '隐藏连线'}
        aria-label="隐藏连线"
        aria-pressed={edgesHidden}
      >
        <EdgeIcon />
      </button>
      <button
        type="button"
        className={`${styles.btn} ${snapEnabled ? styles.active : ''}`}
        onClick={onSnapToggle}
        title={snapEnabled ? '关闭网格吸附' : '开启网格吸附'}
        aria-label="网格吸附"
        aria-pressed={snapEnabled}
      >
        <MagnetIcon />
      </button>
      <button
        type="button"
        className={styles.zoomValue}
        onClick={onZoomReset}
        title="回到 100%"
        aria-label={`当前缩放 ${percent}%，点击回到 100%`}
      >
        {percent}%
      </button>
    </div>
  )
}
