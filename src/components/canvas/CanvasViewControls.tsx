import { Tooltip, type TooltipProps } from 'antd'
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
  const tooltipProps: TooltipProps = {
    placement: 'top' as const,
    trigger: ['hover', 'focus'],
    mouseEnterDelay: 0.12,
    destroyOnHidden: true,
    color: '#262626',
    classNames: { root: styles.tooltip },
  }
  const percent = Math.max(1, Math.round((Number(zoom) || 1) * 100))
  return (
    <div className={`${styles.bar} nodrag nopan`} role="toolbar" aria-label="画布视图控制">
      <Tooltip {...tooltipProps} title="整理画布">
        <button type="button" className={styles.btn} onClick={onArrange} aria-label="整理画布">
          <ArrangeIcon />
        </button>
      </Tooltip>
      <Tooltip {...tooltipProps} title={minimapVisible ? '隐藏小地图' : '显示小地图'}>
        <button
          type="button"
          className={`${styles.btn} ${minimapVisible ? styles.active : ''}`}
          onClick={onMinimapToggle}
          aria-label="小地图"
          aria-pressed={minimapVisible}
        >
          <MiniMapIcon />
        </button>
      </Tooltip>
      <Tooltip {...tooltipProps} title={edgesHidden ? '显示节点连线' : '隐藏节点连线'}>
        <button
          type="button"
          className={`${styles.btn} ${edgesHidden ? styles.active : ''}`}
          onClick={onEdgesToggle}
          aria-label="隐藏连线"
          aria-pressed={edgesHidden}
        >
          <EdgeIcon />
        </button>
      </Tooltip>
      <Tooltip {...tooltipProps} title={snapEnabled ? '关闭网格吸附' : '开启网格吸附'}>
        <button
          type="button"
          className={`${styles.btn} ${snapEnabled ? styles.active : ''}`}
          onClick={onSnapToggle}
          aria-label="网格吸附"
          aria-pressed={snapEnabled}
        >
          <MagnetIcon />
        </button>
      </Tooltip>
      <Tooltip {...tooltipProps} title="回到 100%">
        <button
          type="button"
          className={styles.zoomValue}
          onClick={onZoomReset}
          aria-label={`当前缩放 ${percent}%，点击回到 100%`}
        >
          {percent}%
        </button>
      </Tooltip>
    </div>
  )
}
