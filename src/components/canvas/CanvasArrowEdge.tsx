/**
 * 自带箭头的画布连线。
 *
 * 为什么不用 SVG marker：
 * marker 是「定义在别处、由 <path> 用 url(#id) 去引用」的资源，箭头能不能出现取决于
 * 引用发生时该 id 在不在文档里。React Flow 的 MarkerDefinitions 只按当前 store 里的边
 * 派生定义（空画布上 `if (!markers.length) return null`），于是新建第一条连线时定义与
 * 引用它的 <path> 会在同一次提交里一起进 DOM，浏览器解析不到 id 就按「无箭头」定稿：
 * 表现是新连的线是光杆，刷新一次（整棵子树一次性挂载）箭头才出现。
 *
 * 这里改为把箭头当作边自身的一部分直接画出来。没有 id、没有跨节点引用，也就没有
 * 「引用时定义在不在」这个时序问题——无论边是新建、历史恢复还是增量同步进来的，
 * 它渲染出来的那一刻箭头就在。
 */
import { useLayoutEffect, useRef, useState } from 'react'
import { BaseEdge, getBezierPath, Position, useStore, useStoreApi, type EdgeProps } from '@xyflow/react'
import type { CanvasConnectionRole } from '@/utils/canvasGeneration'

/** 箭头配色，与画布连线同色系；边自带 stroke 时以边为准。 */
const CANVAS_EDGE_ARROW_COLOR = '#66717f'

/**
 * 箭头朝向由「连到目标节点的哪一侧」决定。
 *
 * 基础形状的尖端朝 +x（即向右）。target handle 在左侧 => 线从左边过来 => 箭头朝右（0°）；
 * SVG 的 +y 向下，所以从上方过来（Top）要转 +90° 朝下，从下方过来转 -90° 朝上。
 */
const ARROW_ROTATION: Record<Position, number> = {
  [Position.Left]: 0,
  [Position.Right]: 180,
  [Position.Top]: 90,
  [Position.Bottom]: -90,
}

/** 尖端落在 (0,0)，尾部向后张开；尺寸与 React Flow 的 ArrowClosed 观感一致。 */
const ARROW_POINTS = '0,0 -9,-4.5 -9,4.5'

/** 按连线中点向两端查找空白位置；标签与节点间额外保留 8px。 */
export function findCanvasEdgeLabelPosition(
  candidates: Array<{ x: number; y: number }>,
  obstacles: Array<{ x: number; y: number; width: number; height: number }>,
  width: number,
  height: number,
) {
  return candidates.find((point) =>
    obstacles.every(
      (node) =>
        point.x + width / 2 + 8 < node.x ||
        point.x - width / 2 - 8 > node.x + node.width ||
        point.y + height / 2 + 8 < node.y ||
        point.y - height / 2 - 8 > node.y + node.height,
    ),
  )
}

function CanvasEdgeRoleLabel({ path, label }: { path: string; label: string }) {
  const pathRef = useRef<SVGPathElement>(null)
  const textRef = useRef<SVGTextElement>(null)
  const nodes = useStore((state) => state.nodes)
  const store = useStoreApi()
  const [placement, setPlacement] = useState<{ x: number; y: number; width: number } | null>(null)
  useLayoutEffect(() => {
    const curve = pathRef.current
    if (!curve?.getTotalLength || !curve.getPointAtLength) return
    const width = Math.max(label.length * 10, textRef.current?.getComputedTextLength?.() || 0) + 16
    const length = curve.getTotalLength()
    const candidates = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8].map((fraction) => curve.getPointAtLength(length * fraction))
    const obstacles = Array.from(store.getState().nodeLookup.values())
      .filter((node) => !node.hidden)
      .map((node) => ({
        ...node.internals.positionAbsolute,
        width: node.measured.width || node.width || 0,
        height: node.measured.height || node.height || 0,
      }))
    const point = findCanvasEdgeLabelPosition(candidates, obstacles, width, 22)
    setPlacement(point ? { x: point.x, y: point.y, width } : null)
  }, [path, label, nodes, store])
  return (
    <g className="canvas-edge-role-label" aria-hidden="true" pointerEvents="none">
      <path ref={pathRef} d={path} fill="none" stroke="none" />
      <g
        visibility={placement ? 'visible' : 'hidden'}
        transform={`translate(${placement?.x || 0} ${placement?.y || 0})`}
      >
        <rect x={-(placement?.width || 0) / 2} y={-11} width={placement?.width || 0} height={22} rx={5} />
        <text ref={textRef} textAnchor="middle" dominantBaseline="central">
          {label}
        </text>
      </g>
    </g>
  )
}

export function canvasConnectionRoleLabel(role: unknown): string {
  // 参考素材已经在来源节点中可见，不再在线上重复显示「参考图」「源视频」。
  if (role === 'reference_image' || role === 'source_video') return ''
  const labels: Partial<Record<CanvasConnectionRole, string>> = {
    prompt: '提示词',
    visual_context: '视觉理解',
    first_frame: '首帧',
    last_frame: '尾帧',
  }
  const audioLabels: Record<string, string> = {
    audio_track: '音轨',
    video_clip: '画面片段',
    audio_reference: '声音参考',
    audio_model_reference: '模型参考音频',
  }
  if (audioLabels[String(role || '')]) return audioLabels[String(role || '')]
  return labels[String(role || '') as CanvasConnectionRole] || ''
}

/** 连线标签说明实际用途；不改变提交给模型的 input_assets role。 */
export function canvasConnectionDisplayRole(sourceKind: string, targetKind: string): string | undefined {
  if (targetKind === 'timeline' && sourceKind === 'audio') return 'audio_track'
  if (targetKind === 'timeline' && (sourceKind === 'video' || sourceKind === 'timeline')) return 'video_clip'
  if (sourceKind === 'audio' && targetKind === 'audio') return 'audio_reference'
  if (sourceKind === 'audio' && targetKind === 'video') return 'audio_model_reference'
  return undefined
}

export default function CanvasArrowEdge({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  style,
  markerStart,
  interactionWidth,
  data,
  selected,
}: EdgeProps) {
  const [hovered, setHovered] = useState(false)
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })
  const color = (style?.stroke as string) || CANVAS_EDGE_ARROW_COLOR
  const rotation = ARROW_ROTATION[targetPosition] ?? 0
  const roleLabel = data?.hdLineage ? '高清处理' : canvasConnectionRoleLabel(data?.displayRole || data?.role)

  return (
    <g onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <BaseEdge id={id} path={path} style={style} markerStart={markerStart} interactionWidth={interactionWidth} />
      {/* 只描边会得到一个空心的「>」，看着不像箭头：填充与描边同色，边缘才是实心的 */}
      <polygon
        className="canvas-edge-arrow"
        points={ARROW_POINTS}
        fill={color}
        stroke={color}
        strokeWidth={1}
        strokeLinejoin="round"
        transform={`translate(${targetX} ${targetY}) rotate(${rotation})`}
      />
      {roleLabel && (hovered || selected) ? <CanvasEdgeRoleLabel path={path} label={roleLabel} /> : null}
    </g>
  )
}
