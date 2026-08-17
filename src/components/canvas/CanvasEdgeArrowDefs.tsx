/**
 * 画布连线箭头的常驻 SVG 定义。
 *
 * 为什么要自己提供、而不是给边传 marker 对象让 React Flow 生成：
 * React Flow 的 MarkerDefinitions 只按当前 store 里的边派生定义，并且
 * `if (!markers.length) return null`——空画布上压根没有 <marker> 节点。
 * 于是新建第一条连线时，marker 定义与引用它的 <path> 会在同一次提交里一起插入 DOM，
 * 浏览器解析不到该 id 就按「无箭头」定稿、之后也不会回头重新解析：
 * 表现是新连的线是光杆，刷新一次（整棵子树一次性挂载）箭头才出现。
 *
 * 把定义常驻在画布里，路径插入时 id 必然已经在文档中，这个时序问题不复存在。
 */

/**
 * 箭头定义的 DOM id，同时作为边的 markerEnd 取值。
 *
 * React Flow 的 getMarkerId 对字符串原样返回，最终渲染成 marker-end="url('#此id')"；
 * 而 createMarkerIds 只收集对象类型的 marker，因此它不会再生成一份重复定义。
 */
export const CANVAS_EDGE_ARROW_ID = 'canvas-edge-arrow'

/** 箭头配色，与画布连线同色系。 */
const CANVAS_EDGE_ARROW_COLOR = '#66717f'

/** 几何与配色照抄 React Flow 的 ArrowClosed，保证外观与其它画布一致。 */
export default function CanvasEdgeArrowDefs() {
  return (
    <svg className="react-flow__marker" aria-hidden="true">
      <defs>
        <marker
          className="react-flow__arrowhead"
          id={CANVAS_EDGE_ARROW_ID}
          markerWidth="26"
          markerHeight="26"
          viewBox="-10 -10 20 20"
          markerUnits="strokeWidth"
          orient="auto-start-reverse"
          refX="0"
          refY="0"
        >
          <polyline
            className="arrowclosed"
            style={{ stroke: CANVAS_EDGE_ARROW_COLOR, fill: CANVAS_EDGE_ARROW_COLOR, strokeWidth: 1 }}
            strokeLinecap="round"
            strokeLinejoin="round"
            points="-5,-4 0,0 -5,4 -5,-4"
          />
        </marker>
      </defs>
    </svg>
  )
}
