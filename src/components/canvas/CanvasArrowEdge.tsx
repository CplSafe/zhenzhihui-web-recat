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
import { BaseEdge, getBezierPath, Position, type EdgeProps } from '@xyflow/react'

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
}: EdgeProps) {
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

  return (
    <>
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
    </>
  )
}
