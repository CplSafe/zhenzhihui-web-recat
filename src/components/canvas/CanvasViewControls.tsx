import { Tooltip, type TooltipProps } from 'antd'
import type { ReactNode } from 'react'
import styles from './CanvasViewControls.module.css'
import {
  ArrangeIcon,
  MiniMapIcon,
  EdgeIcon,
  MagnetIcon,
  ZoomInIcon,
  ZoomOutIcon,
  FitViewIcon,
} from './CanvasControlIcons'

interface ViewScaleProps {
  zoom: number
  onZoomReset: () => void
}

export interface CanvasViewControlsProps extends ViewScaleProps {
  readOnly?: false
  onArrange: () => void
  snapEnabled: boolean
  onSnapToggle: () => void
  edgesHidden: boolean
  onEdgesToggle: () => void
  minimapVisible: boolean
  onMinimapToggle: () => void
}

interface CanvasReadOnlyViewControlsProps extends ViewScaleProps {
  readOnly: true
  onZoomIn: () => void
  onZoomOut: () => void
  onFitView: () => void
  canResetLayout: boolean
  onResetLayout: () => void
}

const tooltipProps: TooltipProps = {
  placement: 'top',
  trigger: ['hover', 'focus'],
  mouseEnterDelay: 0.12,
  destroyOnHidden: true,
  color: '#262626',
  classNames: { root: styles.tooltip },
}

function ViewControl({
  label,
  hint = label,
  onClick,
  pressed,
  children,
}: {
  label: string
  hint?: string
  onClick: () => void
  pressed?: boolean
  children: ReactNode
}) {
  return (
    <Tooltip {...tooltipProps} title={hint}>
      <button
        type="button"
        className={`${styles.btn} ${pressed ? styles.active : ''}`}
        onClick={onClick}
        aria-label={label}
        aria-pressed={pressed}
      >
        {children}
      </button>
    </Tooltip>
  )
}

/** 公用画布视图控制栏，访客可调整视口和恢复本地布局。 */
export default function CanvasViewControls(props: CanvasViewControlsProps | CanvasReadOnlyViewControlsProps) {
  const percent = Math.max(1, Math.round((Number(props.zoom) || 1) * 100))
  return (
    <div className={`${styles.bar} nodrag nopan`} role="toolbar" aria-label="画布视图控制">
      {props.readOnly === true ? (
        <>
          <ViewControl label="放大画布" onClick={props.onZoomIn}>
            <ZoomInIcon />
          </ViewControl>
          <ViewControl label="缩小画布" onClick={props.onZoomOut}>
            <ZoomOutIcon />
          </ViewControl>
          <ViewControl label="适应画布" onClick={props.onFitView}>
            <FitViewIcon />
          </ViewControl>
        </>
      ) : (
        <>
          <ViewControl label="整理画布" onClick={props.onArrange}>
            <ArrangeIcon />
          </ViewControl>
          <ViewControl
            label="小地图"
            hint={props.minimapVisible ? '隐藏小地图' : '显示小地图'}
            onClick={props.onMinimapToggle}
            pressed={props.minimapVisible}
          >
            <MiniMapIcon />
          </ViewControl>
          <ViewControl
            label="隐藏连线"
            hint={props.edgesHidden ? '显示节点连线' : '隐藏节点连线'}
            onClick={props.onEdgesToggle}
            pressed={props.edgesHidden}
          >
            <EdgeIcon />
          </ViewControl>
          <ViewControl
            label="网格吸附"
            hint={props.snapEnabled ? '关闭网格吸附' : '开启网格吸附'}
            onClick={props.onSnapToggle}
            pressed={props.snapEnabled}
          >
            <MagnetIcon />
          </ViewControl>
        </>
      )}
      <Tooltip {...tooltipProps} title="回到 100%">
        <button
          type="button"
          className={styles.zoomValue}
          onClick={props.onZoomReset}
          aria-label={`当前缩放 ${percent}%，点击回到 100%`}
        >
          {percent}%
        </button>
      </Tooltip>
      {props.readOnly === true && (
        <button
          type="button"
          className={`${styles.btn} ${styles.layoutReset}`}
          disabled={!props.canResetLayout}
          onClick={props.onResetLayout}
        >
          恢复原布局
        </button>
      )}
    </div>
  )
}
