/**
 * 创意画布（/canvas, /canvas/:id）
 *
 * 页面职责：提供无限画布，通过节点+连线方式组织 AI 生成管线。
 */
import { useCallback, useRef, useState, useEffect, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import brandLogo from '@/img/image copy 7.png'
import DraftSaveIndicator from '@/components/common/DraftSaveIndicator'
import type { DraftSaveStatus } from '@/utils/creativeDraftPersistence'
import {
  ReactFlow,
  Background,
  Handle,
  Position,
  type Node,
  type Edge,
  type Connection,
  type NodeTypes,
  type NodeProps,
  ConnectionMode,
  addEdge,
  useNodesState,
  useEdgesState,
  useStore,
  useReactFlow,
  ReactFlowProvider,
  EdgeLabelRenderer,
  getBezierPath,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import CanvasFloatingToolbar from '@/components/canvas/CanvasFloatingToolbar'
import CanvasNodePanel, {
  type CanvasNodeInfo,
  type CanvasSourceRef,
  calcNodeSize,
} from '@/components/canvas/CanvasNodePanel'
import CanvasMaterialPicker from '@/components/canvas/CanvasMaterialPicker'
import CanvasHistoryPanel, { type HistoryItem } from '@/components/canvas/CanvasHistoryPanel'
import { saveCanvasDraft, loadCanvasDraft } from '@/utils/canvasDraft'
import { useWorkspaceId } from '@/stores/workspaceSession'
import { useGenerationModelCatalog } from '@/composables/useGenerationModelCatalog'
import type { GenerationModelOption } from '@/utils/generationModelCatalog'
import './CanvasView.css'

/** 类型小图标（头部用，12×12） */
function getTypeIcon(kind: string) {
  if (kind === 'image') {
    return (
      <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
        <rect x="1" y="1" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.2" />
        <circle cx="5" cy="5" r="1.2" fill="currentColor" />
        <path
          d="M1 10l3.5-3.5 2.5 2.5 2-2L13 10"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  if (kind === 'video') {
    return (
      <svg width="12" height="12" viewBox="0 0 48 48" fill="none">
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M31.8 3C33.7 3 35.3 3 36.6 3.1c1.3.1 2.4.3 3.5.9 1.7.8 3 2.2 3.9 3.9.6 1 .8 2.2.9 3.5.1 1.3.1 2.9.1 4.8v15.6c0 2-.1 3.5-.1 4.8-.1 1.3-.3 2.4-.9 3.5a8 8 0 01-3.9 3.9c-1 .6-2.2.8-3.5.9-1.3.1-2.8.1-4.8.1H16.2c-2 0-3.5 0-4.8-.1-1.3-.1-2.4-.3-3.5-.9a8 8 0 01-3.9-3.9c-.6-1-.8-2.2-.9-3.5C3 33.5 3 32 3 30V16.2c0-2 0-3.5.1-4.8.1-1.3.3-2.4.9-3.5a8 8 0 013.9-3.9c1-.6 2.2-.8 3.5-.9C12.7 3 14.3 3 16.2 3h15.6zM16.2 7c-2 0-3.3 0-4.4.1-1 .1-1.6.3-2 .5a4 4 0 00-2.2 2.2c-.2.4-.3 1-.4 2-.1 1.1-.1 2.5-.1 4.4v15.6c0 2 0 3.3.1 4.4.1 1 .3 1.6.5 2a4 4 0 002.2 2.2c.4.2 1 .3 2 .4 1.1.1 2.5.1 4.4.1h15.6c2 0 3.3 0 4.4-.1 1-.1 1.6-.3 2-.5a4 4 0 002.2-2.2c.2-.4.3-1 .4-2 .1-1.1.1-2.5.1-4.4V16.2c0-2 0-3.3-.1-4.4-.1-1-.3-1.6-.5-2a4 4 0 00-2.2-2.2c-.4-.2-1-.3-2-.4-1.1-.1-2.5-.1-4.4-.1H16.2zm2.4 12.6c0-1.7 1.9-2.7 3.4-1.8l7.8 4.4c1.4.8 1.4 2.8 0 3.6l-7.8 4.4c-1.5.8-3.4-.2-3.4-1.8v-8.8z"
          fill="currentColor"
        />
      </svg>
    )
  }
  // text
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
      <path
        d="M9.7 10.3c.3 0 .6.2.6.6 0 .3-.2.6-.6.6H2c-.3 0-.6-.3-.6-.6 0-.3.3-.6.6-.6h7.7zM7.8 6.4c.3 0 .6.3.6.6 0 .3-.3.6-.6.6H2c-.3 0-.6-.3-.6-.6 0-.3.3-.6.6-.6h5.8zm4.2-3.8c.3 0 .5.3.5.6s-.2.6-.5.6H2c-.3 0-.6-.3-.6-.6s.3-.6.6-.6h9.9z"
        fill="currentColor"
      />
    </svg>
  )
}

/** 类型大占位图标（主体用） */
function getTypePlaceholder(kind: string) {
  const size = 48
  if (kind === 'image') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" opacity="0.15">
        <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" />
        <path
          d="M3 16l5-5 4 4 3-3 6 6"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  if (kind === 'video') {
    return (
      <svg width={size} height={size} viewBox="0 0 48 48" fill="none" opacity="0.15">
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M31.8 3C33.7 3 35.3 3 36.6 3.1c1.3.1 2.4.3 3.5.9 1.7.8 3 2.2 3.9 3.9.6 1 .8 2.2.9 3.5.1 1.3.1 2.9.1 4.8v15.6c0 2-.1 3.5-.1 4.8-.1 1.3-.3 2.4-.9 3.5a8 8 0 01-3.9 3.9c-1 .6-2.2.8-3.5.9-1.3.1-2.8.1-4.8.1H16.2c-2 0-3.5 0-4.8-.1-1.3-.1-2.4-.3-3.5-.9a8 8 0 01-3.9-3.9c-.6-1-.8-2.2-.9-3.5C3 33.5 3 32 3 30V16.2c0-2 0-3.5.1-4.8.1-1.3.3-2.4.9-3.5a8 8 0 013.9-3.9c1-.6 2.2-.8 3.5-.9C12.7 3 14.3 3 16.2 3h15.6zM16.2 7c-2 0-3.3 0-4.4.1-1 .1-1.6.3-2 .5a4 4 0 00-2.2 2.2c-.2.4-.3 1-.4 2-.1 1.1-.1 2.5-.1 4.4v15.6c0 2 0 3.3.1 4.4.1 1 .3 1.6.5 2a4 4 0 002.2 2.2c.4.2 1 .3 2 .4 1.1.1 2.5.1 4.4.1h15.6c2 0 3.3 0 4.4-.1 1-.1 1.6-.3 2-.5a4 4 0 002.2-2.2c.2-.4.3-1 .4-2 .1-1.1.1-2.5.1-4.4V16.2c0-2 0-3.3-.1-4.4-.1-1-.3-1.6-.5-2a4 4 0 00-2.2-2.2c-.4-.2-1-.3-2-.4-1.1-.1-2.5-.1-4.4-.1H16.2zm2.4 12.6c0-1.7 1.9-2.7 3.4-1.8l7.8 4.4c1.4.8 1.4 2.8 0 3.6l-7.8 4.4c-1.5.8-3.4-.2-3.4-1.8v-8.8z"
          fill="currentColor"
        />
      </svg>
    )
  }
  // text
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" opacity="0.15">
      <path
        d="M9.7 10.3c.3 0 .6.2.6.6 0 .3-.2.6-.6.6H2c-.3 0-.6-.3-.6-.6 0-.3.3-.6.6-.6h7.7zM7.8 6.4c.3 0 .6.3.6.6 0 .3-.3.6-.6.6H2c-.3 0-.6-.3-.6-.6 0-.3.3-.6.6-.6h5.8zm4.2-3.8c.3 0 .5.3.5.6s-.2.6-.5.6H2c-.3 0-.6-.3-.6-.6s.3-.6.6-.6h9.9z"
        fill="currentColor"
      />
    </svg>
  )
}

/** 击打区半径 = 130/2 */
const HANDLE_RADIUS = 65

/** 打开抽屉前，左侧工具栏收起动画的时长（毫秒） */
const TOOLBAR_LEAVE_MS = 220

/** 新节点渐入动画时长（毫秒），与 CSS 动画时长保持一致 */
const NODE_ENTER_MS = 350

/** 生成防冲突的节点唯一 id（时间戳 + 计数器 + 随机串），避免同毫秒内重复创建导致 id 冲突 */
let nodeIdSequence = 0
function createNodeId(type: string): string {
  nodeIdSequence = (nodeIdSequence + 1) % 1000
  const rand = Math.random().toString(36).slice(2, 7)
  return `${type}-${Date.now()}-${nodeIdSequence}-${rand}`
}

/** 历史快照保留的最大步数，防止无界增长 */
const HISTORY_LIMIT = 50

/** 右键浮动菜单的宽高（用于防止菜单溢出视口） */
const CONTEXT_MENU_WIDTH = 184
const CONTEXT_MENU_HEIGHT = 276

/** 历史快照：nodes/edges + 文本内容（文本独立于 nodes 存储，必须一并快照才能正确撤销） */
interface CanvasHistorySnapshot {
  nodes: Node[]
  edges: Edge[]
  textContents: Record<string, string>
}

/** 从全局 Map 收集文本内容快照 */
function collectTextContents(): Record<string, string> {
  const map = (window as any).__canvasTextContents as Map<string, string> | undefined
  const result: Record<string, string> = {}
  if (map) {
    map.forEach((v, k) => {
      if (v) result[k] = v
    })
  }
  return result
}

/** 把文本快照写回全局 Map */
function restoreTextContents(snapshot: Record<string, string>) {
  if (!(window as any).__canvasTextContents) (window as any).__canvasTextContents = new Map()
  const map = (window as any).__canvasTextContents as Map<string, string>
  map.clear()
  Object.entries(snapshot || {}).forEach(([k, v]) => map.set(k, v))
}

/** 快照只保留可序列化字段，剔除 React Flow 运行时字段（measured 等） */
function sanitizeSnapshotNodes(nodes: Node[]): Node[] {
  return nodes.map((n) => ({
    id: n.id,
    type: n.type,
    position: { ...n.position },
    data: JSON.parse(JSON.stringify(n.data || {})),
    ...(n.style ? { style: { ...n.style } } : {}),
    ...(n.className ? { className: n.className } : {}),
  }))
}

function sanitizeSnapshotEdges(edges: Edge[]): Edge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    ...(e.sourceHandle != null ? { sourceHandle: e.sourceHandle } : {}),
    ...(e.targetHandle != null ? { targetHandle: e.targetHandle } : {}),
    ...(e.data ? { data: JSON.parse(JSON.stringify(e.data)) } : {}),
  }))
}

function calcHandleOffset(
  mouseClientX: number,
  mouseClientY: number,
  centerX: number,
  centerY: number,
): { x: number; y: number } | null {
  const dx = mouseClientX - centerX
  const dy = mouseClientY - centerY
  if (Math.abs(dx) > HANDLE_RADIUS || Math.abs(dy) > HANDLE_RADIUS) return null
  return { x: dx, y: dy }
}

/** Handle 图标 — 两层结构：外层负责移动追踪，内层负责视觉效果 */
function HandleIcon({
  side,
  visible,
  mouseOffset,
  zoom,
  onMouseMove,
}: {
  side: 'left' | 'right'
  visible: boolean
  mouseOffset: { x: number; y: number }
  zoom: number
  onMouseMove: (e: React.MouseEvent) => void
}) {
  const z = zoom || 1
  return (
    <div
      className={`canvas-handle-mover canvas-handle-mover--${side}`}
      style={{ transform: `translate(${mouseOffset.x / z}px, ${mouseOffset.y / z}px)` }}
      onMouseMove={onMouseMove}
    >
      <div className={`canvas-handle-icon canvas-handle-icon--${side}`} data-visible={visible}>
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
      </div>
    </div>
  )
}

/** 自定义画布节点 */
function CanvasDefaultNode({ id, data, selected }: NodeProps<Node>) {
  const [leftOffset, setLeftOffset] = useState<{ x: number; y: number } | null>(null)
  const [rightOffset, setRightOffset] = useState<{ x: number; y: number } | null>(null)
  const [leftHovered, setLeftHovered] = useState(false)
  const [rightHovered, setRightHovered] = useState(false)
  const [editing, setEditing] = useState(false)
  const [textContent, setTextContent] = useState(() => ((window as any).__canvasTextContents?.get(id) as string) || '')
  const placeholder = '双击开始编辑...'

  const handleDoubleClick = () => {
    if (kind !== 'text') return
    if (!textContent.trim()) setTextContent('')
    setEditing(true)
  }

  // 输入过程中实时写入全局文本 Map，并标记画布待保存（避免仅 blur 才落盘导致刷新丢内容）
  const handleEditChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setTextContent(value)
    if (!(window as any).__canvasTextContents) (window as any).__canvasTextContents = new Map()
    ;(window as any).__canvasTextContents.set(id, value)
    ;(window as any).__canvasMarkDirty?.()
  }

  const handleEditBlur = () => {
    setEditing(false)
    const trimmed = textContent.trim()
    setTextContent(trimmed)
    if (!(window as any).__canvasTextContents) (window as any).__canvasTextContents = new Map()
    ;(window as any).__canvasTextContents.set(id, trimmed)
    ;(window as any).__canvasMarkDirty?.()
  }

  const elRef = useRef<HTMLDivElement>(null)
  const zoom = useStore((s) => s.transform[2])

  const allNodes = (window as any).__canvasNodes || []
  const isFirst = allNodes.length > 0 && allNodes[0]?.id === id
  const kind = (data.kind as string) || 'text'

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!elRef.current) return
    const rect = elRef.current.getBoundingClientRect()
    const z = zoom || 1
    const cy = rect.top + rect.height / 2
    // 图标中心在节点外 30px
    setLeftOffset(calcHandleOffset(e.clientX, e.clientY, rect.left - 45 * z, cy))
    setRightOffset(calcHandleOffset(e.clientX, e.clientY, rect.right + 45 * z, cy))
  }

  const resetMouse = () => {
    setLeftOffset(null)
    setRightOffset(null)
    setLeftHovered(false)
    setRightHovered(false)
  }

  const leftPos = leftOffset || { x: 0, y: 0 }
  const rightPos = rightOffset || { x: 0, y: 0 }
  const leftVisible = selected || leftHovered
  const rightVisible = selected || rightHovered

  const labelMap: Record<string, string> = { text: '文本', image: '图片', video: '视频' }

  return (
    <div ref={elRef} className="canvas-default-node" onMouseLeave={resetMouse} onMouseMove={handleMouseMove}>
      {/* 头部：类型图标 + 标签，浮在节点上方 */}
      <div className="canvas-node-header">
        <span className="canvas-node-header__icon">{getTypeIcon(kind)}</span>
        <span className="canvas-node-header__label">{labelMap[kind] || kind}</span>
      </div>

      {/* 主体：文本节点可编辑；图片/视频显示素材内容或占位图标 */}
      <div className="canvas-node-body" onDoubleClick={handleDoubleClick}>
        {kind === 'text' ? (
          editing ? (
            <textarea
              className="canvas-node-editor"
              value={textContent}
              onChange={handleEditChange}
              onBlur={handleEditBlur}
              autoFocus
            />
          ) : (
            <div className={`canvas-node-prompt${textContent.trim() ? '' : ' is-placeholder'}`}>
              {textContent.trim() || placeholder}
            </div>
          )
        ) : (data as any)?.resultUrl ? (
          kind === 'video' ? (
            <video
              className="canvas-node-media"
              src={(data as any).resultUrl}
              poster={(data as any).poster}
              muted
              playsInline
              preload="metadata"
            />
          ) : (
            <img className="canvas-node-media" src={(data as any).resultUrl} alt={kind} loading="lazy" />
          )
        ) : (
          getTypePlaceholder(kind)
        )}
      </div>

      {!isFirst && (
        <Handle
          id={`${id}-left-target`}
          type="target"
          position={Position.Left}
          onMouseEnter={() => setLeftHovered(true)}
          onMouseLeave={() => setLeftHovered(false)}
        >
          <HandleIcon
            side="left"
            visible={leftVisible}
            mouseOffset={leftPos}
            zoom={zoom}
            onMouseMove={handleMouseMove}
          />
        </Handle>
      )}

      <Handle
        id={`${id}-right-source`}
        type="source"
        position={Position.Right}
        onMouseEnter={() => setRightHovered(true)}
        onMouseLeave={() => setRightHovered(false)}
      >
        <HandleIcon
          side="right"
          visible={rightVisible}
          mouseOffset={rightPos}
          zoom={zoom}
          onMouseMove={handleMouseMove}
        />
      </Handle>
    </div>
  )
}

const nodeTypes: NodeTypes = {
  text: CanvasDefaultNode,
  image: CanvasDefaultNode,
  video: CanvasDefaultNode,
}

/** 创意画布入口页（提供 ReactFlowProvider 上下文） */
export default function CanvasView() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  )
}

/** 画布主体逻辑 */
function CanvasInner() {
  // 路由参数中的项目 id：用于草稿按项目隔离，避免不同画布项目互相覆盖
  const { id: routeProjectId } = useParams()
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const { fitView } = useReactFlow()
  const workspaceId = useWorkspaceId()
  // 模型目录：来自 /api/v1/ai/models
  const { groups, loading: modelsLoading } = useGenerationModelCatalog(workspaceId)
  // 按节点类型提取模型列表
  const canvasModels = useMemo(() => {
    const scriptGroup = groups.find((g) => g.key === 'script')
    const imageGroup = groups.find((g) => g.key === 'image')
    const videoGroup = groups.find((g) => g.key === 'video')
    const imageTextModels =
      imageGroup?.operationGroups.find((og) => og.operationCode === 'image.text_to_image')?.models || []
    return {
      text: scriptGroup?.models || ([] as GenerationModelOption[]),
      image: imageTextModels,
      video: videoGroup?.models || ([] as GenerationModelOption[]),
    }
  }, [groups])
  const [addMenu, setAddMenu] = useState<{ x: number; y: number; sourceId: string } | null>(null)
  const [selectMode, setSelectMode] = useState(false)
  const [panMode, setPanMode] = useState(false)
  // 选中/拖拽模式互斥：开启其一自动关闭另一个，避免「拖拽模式下节点不可选中」且无感知
  const handleSelectModeChange = useCallback((v: boolean) => {
    setSelectMode(v)
    if (v) setPanMode(false)
  }, [])
  const handlePanModeChange = useCallback((v: boolean) => {
    setPanMode(v)
    if (v) setSelectMode(false)
  }, [])
  const [selectedNode, setSelectedNode] = useState<CanvasNodeInfo | null>(null)
  const [saveStatus, setSaveStatus] = useState<DraftSaveStatus>('saved')
  const [isPickingRef, setIsPickingRef] = useState(false)
  const [pickingTargetId, setPickingTargetId] = useState<string | null>(null)
  const [pickingSlotIndex, setPickingSlotIndex] = useState<number | null>(null)
  const [pickError, setPickError] = useState('')
  const [drawerPanel, setDrawerPanel] = useState<'assets' | 'history' | null>(null)
  // 工具栏收起动画期间为 true：先播放收起动画，动画结束再挂载抽屉
  const [toolbarLeaving, setToolbarLeaving] = useState(false)
  const toolbarLeaveTimerRef = useRef<number | null>(null)
  // 右键浮动菜单
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  // 撤销/重做历史栈：存储 nodes/edges + 文本内容快照
  const historyRef = useRef<{ undo: CanvasHistorySnapshot[]; redo: CanvasHistorySnapshot[] }>({
    undo: [],
    redo: [],
  })
  // 能否撤销/重做的状态（ref 变化不触发渲染，需显式同步）
  const [historyFlags, setHistoryFlags] = useState({ canUndo: false, canRedo: false })
  // 最新 nodes/edges 引用：供历史快照在任何回调里读取当前状态
  const latestRef = useRef<{ nodes: Node[]; edges: Edge[] }>({ nodes: [], edges: [] })
  latestRef.current = { nodes, edges }
  const transform = useStore((s) => s.transform)

  ;(window as any).__canvasNodes = nodes
  ;(window as any).__canvasEdges = edges

  // 基于最新 edges 状态判断是否已存在同源连线（防重检查必须用最新状态，避免闭包过期导致重复插入）
  const hasEdgeBetween = useCallback((sourceId: string, targetId: string, slotIndex?: number): boolean => {
    const latest = latestRef.current.edges
    return latest.some(
      (e) =>
        e.source === sourceId &&
        e.target === targetId &&
        // 指定 slot 时按 slot 精确匹配；未指定时同源同目标即视为重复
        (slotIndex === undefined || (e.data?.slotIndex as number) === slotIndex),
    )
  }, [])

  /** 从 edges 派生 sourceRefs，按 edgeId 去重兜底（防止历史重复边造成重复缩略图） */
  const deriveSourceRefs = useCallback(
    (nodeId: string): CanvasSourceRef[] => {
      const seenEdgeIds = new Set<string>()
      const refs: CanvasSourceRef[] = []
      for (const e of edges) {
        if (e.target !== nodeId) continue
        if (seenEdgeIds.has(e.id)) continue
        seenEdgeIds.add(e.id)
        const src = nodes.find((n) => n.id === e.source)
        refs.push({
          kind: (src?.data?.kind as string) || 'text',
          edgeId: e.id,
          slotIndex: (e.data?.slotIndex as number) ?? 0,
          // 来源节点有实际素材内容（图片/视频）时带缩略图地址
          ...((src?.data as any)?.resultUrl ? { thumbnailUrl: (src.data as any).resultUrl as string } : {}),
        })
      }
      return refs.sort((a, b) => a.slotIndex - b.slotIndex)
    },
    [edges, nodes],
  )

  // 点击节点时使用去重后的 sourceRefs
  const getSourceRefs = useCallback((nodeId: string): CanvasSourceRef[] => deriveSourceRefs(nodeId), [deriveSourceRefs])

  /** 参考选择：目标节点种类对应的允许来源种类 */
  const allowedSourceKinds: Record<string, string[]> = {
    video: ['image', 'video'],
    image: ['text'],
    text: ['text', 'image', 'video'],
  }

  /** 校验连线是否合法：重复（基于最新状态）、类型匹配、数量上限。返回错误信息，合法返回 null */
  const validateConnection = useCallback(
    (sourceId: string, targetId: string): string | null => {
      if (hasEdgeBetween(sourceId, targetId)) return '已存在相同连线'
      const targetKind = (latestRef.current.nodes.find((n) => n.id === targetId)?.data?.kind as string) || 'text'
      const sourceKind = (latestRef.current.nodes.find((n) => n.id === sourceId)?.data?.kind as string) || 'text'
      const allowed = allowedSourceKinds[targetKind] || []
      if (!allowed.includes(sourceKind)) return '该节点类型不能作为此节点的参考来源'
      const existingRefs = latestRef.current.edges.filter((e) => e.target === targetId).length
      const maxRefs = targetKind === 'video' ? 2 : 3
      if (existingRefs >= maxRefs) return `参考数量已达上限（${maxRefs} 个）`
      return null
    },
    // allowedSourceKinds 为模块常量，引用不会随渲染变化；显式声明以消除 exhaustive-deps 提示
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hasEdgeBetween],
  )

  const startPickRef = useCallback((targetId: string, slotIndex?: number) => {
    setPickingTargetId(targetId)
    setPickingSlotIndex(slotIndex ?? null)
    setIsPickingRef(true)
  }, [])

  const stopPickRef = useCallback(() => {
    setIsPickingRef(false)
    setPickingTargetId(null)
    setPickingSlotIndex(null)
    setPickError('')
  }, [])

  const closeDrawerPanel = useCallback(() => {
    setDrawerPanel(null)
  }, [])

  // 打开抽屉的时序动效：先播放工具栏收起动画，动画结束后再卸载工具栏并挂载抽屉
  const openDrawerPanel = useCallback(
    (type: 'assets' | 'history') => {
      // 已在目标抽屉中：无需重复动画
      if (drawerPanel === type) return
      setAddMenu(null)
      setToolbarLeaving(true)
      if (toolbarLeaveTimerRef.current) window.clearTimeout(toolbarLeaveTimerRef.current)
      toolbarLeaveTimerRef.current = window.setTimeout(() => {
        toolbarLeaveTimerRef.current = null
        setToolbarLeaving(false)
        setDrawerPanel(type)
      }, TOOLBAR_LEAVE_MS)
    },
    [drawerPanel],
  )

  // 组件卸载时清理定时器，避免切页后触发 setState
  useEffect(() => {
    return () => {
      if (toolbarLeaveTimerRef.current) window.clearTimeout(toolbarLeaveTimerRef.current)
    }
  }, [])

  // ── 撤销 / 重做 ────────────────────────────────────────────
  // 记录一次「当前状态」到撤销栈（在结构性变更发生前调用）
  const commitHistory = useCallback(() => {
    const { undo } = historyRef.current
    undo.push({
      nodes: sanitizeSnapshotNodes(latestRef.current.nodes),
      edges: sanitizeSnapshotEdges(latestRef.current.edges),
      textContents: collectTextContents(),
    })
    if (undo.length > HISTORY_LIMIT) undo.shift()
    historyRef.current.redo.length = 0
    setHistoryFlags({ canUndo: true, canRedo: false })
  }, [])

  // 撤销：当前状态入重做栈，恢复撤销栈顶
  const undo = useCallback(() => {
    const { undo: undoStack, redo: redoStack } = historyRef.current
    const prev = undoStack.pop()
    if (!prev) return
    redoStack.push({
      nodes: sanitizeSnapshotNodes(latestRef.current.nodes),
      edges: sanitizeSnapshotEdges(latestRef.current.edges),
      textContents: collectTextContents(),
    })
    setNodes(prev.nodes as Node[])
    setEdges(prev.edges as Edge[])
    // 同步恢复文本内容，保证文本节点与结构状态一致
    restoreTextContents(prev.textContents)
    setSelectedNode(null)
    setSaveStatus('dirty')
    setContextMenu(null)
    setHistoryFlags({ canUndo: undoStack.length > 0, canRedo: true })
  }, [setNodes, setEdges])

  // 重做：当前状态入撤销栈，恢复重做栈顶
  const redo = useCallback(() => {
    const { undo: undoStack, redo: redoStack } = historyRef.current
    const next = redoStack.pop()
    if (!next) return
    undoStack.push({
      nodes: sanitizeSnapshotNodes(latestRef.current.nodes),
      edges: sanitizeSnapshotEdges(latestRef.current.edges),
      textContents: collectTextContents(),
    })
    setNodes(next.nodes as Node[])
    setEdges(next.edges as Edge[])
    // 同步恢复文本内容
    restoreTextContents(next.textContents)
    setSelectedNode(null)
    setSaveStatus('dirty')
    setContextMenu(null)
    setHistoryFlags({ canUndo: true, canRedo: redoStack.length > 0 })
  }, [setNodes, setEdges])

  // 键盘 Delete/Backspace 删除节点：清理关联连线 + 同步选中态 + 入撤销栈
  const handleNodesDelete = useCallback(
    (deleted: Node[]) => {
      if (!deleted.length) return
      // 删除前记录历史，供撤销使用
      commitHistory()
      const deletedIds = new Set(deleted.map((n) => n.id))
      setEdges((eds) => eds.filter((e) => !deletedIds.has(e.source) && !deletedIds.has(e.target)))
      // 若删除的是当前选中节点，清空编辑面板
      setSelectedNode((prev) => (prev && deletedIds.has(prev.id) ? null : prev))
      setSaveStatus('dirty')
    },
    [commitHistory, setEdges],
  )

  // 键盘 Delete/Backspace 删除连线（选中连线时）：入撤销栈
  const handleEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      if (!deleted.length) return
      commitHistory()
      setSelectedNode((prev) => {
        if (!prev) return prev
        const deletedIds = new Set(deleted.map((e) => e.id))
        const newRefs = (prev.sourceRefs || []).filter((r) => !deletedIds.has(r.edgeId))
        return { ...prev, sourceRefs: newRefs }
      })
      setSaveStatus('dirty')
    },
    [commitHistory, setSelectedNode],
  )

  // 右键菜单：点击外部 / Esc 关闭
  useEffect(() => {
    if (!contextMenu) return
    const close = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('.canvas-context-menu')) return
      setContextMenu(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null)
    }
    // 延迟挂载，避免触发本次右键的 mousedown 立即关闭菜单
    const timer = window.setTimeout(() => {
      window.addEventListener('mousedown', close)
      window.addEventListener('keydown', onKey)
    }, 0)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [contextMenu])

  // 快捷键：Ctrl/Cmd+Z 撤销，Ctrl/Cmd+Shift+Z / Ctrl/Cmd+Y 重做
  // 输入框/文本域/可编辑区域内不拦截（保留浏览器原生撤销），避免破坏文本编辑
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const target = e.target as HTMLElement | null
      if (target?.closest('textarea, input, [contenteditable="true"]')) return
      const key = e.key.toLowerCase()
      if (key === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if (key === 'y') {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  useEffect(() => {
    if (!drawerPanel) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerPanel(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [drawerPanel])

  const handleRemoveRef = useCallback(
    (edgeId: string) => {
      // 删除连线前记录历史，供撤销使用
      commitHistory()
      setEdges((eds) => eds.filter((e) => e.id !== edgeId))
      // 立即更新 selectedNode 以消除闪烁
      if (selectedNode) {
        const newRefs = (selectedNode.sourceRefs || []).filter((r) => r.edgeId !== edgeId)
        setSelectedNode({ ...selectedNode, sourceRefs: newRefs })
      }
    },
    [selectedNode, setEdges, commitHistory],
  )

  // ESC 退出参考选择模式
  useEffect(() => {
    if (!isPickingRef) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') stopPickRef()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isPickingRef, stopPickRef])

  const handlePickRefNode = useCallback(
    (sourceNode: Node) => {
      if (!pickingTargetId) return
      // 非法选择给出明确提示，避免用户以为节点点击失效
      const failWith = (message: string) => {
        setPickError(message)
        window.setTimeout(() => setPickError(''), 2000)
      }
      if (sourceNode.id === pickingTargetId) {
        failWith('不能选择节点自身作为参考')
        return
      }
      // 统一校验：重复（基于最新状态）、类型匹配、数量上限
      const validationError = validateConnection(sourceNode.id, pickingTargetId)
      if (validationError) {
        failWith(validationError)
        return
      }
      const sourceKind = (sourceNode.data?.kind as string) || 'text'
      // 确定 slotIndex：优先使用传入值，否则自动分配
      const existingSlots = latestRef.current.edges
        .filter((e) => e.target === pickingTargetId)
        .map((e) => (e.data?.slotIndex as number) ?? 0)
      let slotIndex = pickingSlotIndex
      if (slotIndex === null) {
        slotIndex = 0
        while (existingSlots.includes(slotIndex)) slotIndex++
      }
      // 创建连线（带 slotIndex）
      const newEdgeId = `e-${sourceNode.id}-${pickingTargetId}-${slotIndex}`
      const newEdge: Edge = {
        id: newEdgeId,
        source: sourceNode.id,
        sourceHandle: null,
        target: pickingTargetId,
        targetHandle: null,
        data: { slotIndex },
      }
      // 添加参考连线前记录历史，供撤销使用
      commitHistory()
      setEdges((eds) => [...eds, newEdge])
      // 退出选择模式
      setIsPickingRef(false)
      setPickingTargetId(null)
      setPickingSlotIndex(null)
      // 刷新 selectedNode 的 sourceRefs（按 edgeId 去重，防止重复缩略图）
      setSelectedNode((prev) => {
        if (!prev) return null
        const newRef = {
          kind: sourceKind,
          edgeId: newEdgeId,
          slotIndex,
          // 来源节点有实际素材内容（图片/视频）时带缩略图地址
          ...((sourceNode.data as any)?.resultUrl
            ? { thumbnailUrl: (sourceNode.data as any).resultUrl as string }
            : {}),
        }
        const next = [...(prev.sourceRefs || []).filter((r) => r.edgeId !== newEdgeId), newRef].sort(
          (a, b) => a.slotIndex - b.slotIndex,
        )
        return { ...prev, sourceRefs: next }
      })
    },
    [pickingTargetId, pickingSlotIndex, setEdges, commitHistory, validateConnection],
  )

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return
      // 统一校验：重复（基于最新状态）、类型匹配、数量上限
      if (validateConnection(connection.source, connection.target)) return
      // 自动分配 slotIndex
      const existingSlots = latestRef.current.edges
        .filter((e) => e.target === connection.target)
        .map((e) => (e.data?.slotIndex as number) ?? 0)
      let slotIndex = 0
      while (existingSlots.includes(slotIndex)) slotIndex++
      // 添加连线前记录历史，供撤销使用
      commitHistory()
      setEdges((eds) => addEdge({ ...connection, data: { slotIndex } }, eds))
    },
    [setEdges, commitHistory, validateConnection],
  )

  /** 剪刀点击删除连线，同步清理缩略图 */
  const handleEdgeDelete = useCallback(
    (edgeId: string) => {
      // 删除连线前记录历史，供撤销使用
      commitHistory()
      setEdges((eds) => eds.filter((ed) => ed.id !== edgeId))
      if (selectedNode) {
        const newRefs = (selectedNode.sourceRefs || []).filter((r) => r.edgeId !== edgeId)
        setSelectedNode({ ...selectedNode, sourceRefs: newRefs })
      }
    },
    [selectedNode, setEdges, commitHistory],
  )

  /**
   * 连线结束：如鼠标在目标节点图标区域内，自动连接；否则弹出创建菜单
   */
  const onConnectEnd = useCallback(
    (_event: any, connectionState: any) => {
      const sourceId = connectionState.fromNode?.id
      if (!sourceId || connectionState.toHandle) return

      const mx = (_event as MouseEvent).clientX
      const my = (_event as MouseEvent).clientY
      const [, , tz] = transform

      // 检查鼠标是否在某个节点（非自身）的 handle 区域内
      for (const node of nodes) {
        if (node.id === sourceId) continue
        const nodeEl = document.querySelector(`[data-id="${node.id}"]`)
        if (!nodeEl) continue
        const rect = nodeEl.getBoundingClientRect()
        const cy = rect.top + rect.height / 2

        // 目标节点左侧 target handle 中心（节点外 45px）
        const leftCX = rect.left - 45 * tz
        // 目标节点右侧 source handle 中心（节点外 45px）
        const rightCX = rect.right + 45 * tz

        const nearLeft = Math.abs(mx - leftCX) < 65 * tz && Math.abs(my - cy) < 65 * tz
        const nearRight = Math.abs(mx - rightCX) < 65 * tz && Math.abs(my - cy) < 65 * tz

        if (nearLeft || nearRight) {
          // 统一校验：重复（基于最新状态）、类型匹配、数量上限
          if (validateConnection(sourceId, node.id)) return
          // 自动分配 slotIndex
          const existingSlots = latestRef.current.edges
            .filter((e) => e.target === node.id)
            .map((e) => (e.data?.slotIndex as number) ?? 0)
          let slotIndex = 0
          while (existingSlots.includes(slotIndex)) slotIndex++
          // 自动连线
          const targetHandle = nearRight ? `${node.id}-right-source` : `${node.id}-left-target`
          // 自动连线前记录历史，供撤销使用
          commitHistory()
          setEdges((eds) =>
            addEdge(
              {
                source: sourceId,
                sourceHandle: connectionState.fromHandle?.id || null,
                target: node.id,
                targetHandle,
                data: { slotIndex },
              },
              eds,
            ),
          )
          return
        }
      }

      // 未命中任何节点 → 弹出创建菜单
      setAddMenu({ x: mx, y: my, sourceId })
    },
    [nodes, transform, setEdges, commitHistory, validateConnection],
  )

  // 统一创建新节点：默认选中 + 渐入动画；动画结束后移除动画类，避免草稿恢复/重进页面时重复播放
  const appendNewNode = useCallback(
    (
      type: string,
      position: { x: number; y: number },
      options?: { ratio?: string; extraData?: Record<string, unknown> },
    ) => {
      // 结构变更前记录历史，供撤销使用
      commitHistory()
      const nodeW = type === 'video' ? 444 : 250
      const nodeH = type === 'video' ? 250 : 250
      const id = createNodeId(type)
      const ratio = options?.ratio
      const newNode: Node = {
        id,
        type,
        position,
        data: {
          kind: type,
          ratio,
          videoMode: type === 'video' ? 'first-last' : undefined,
          ...options?.extraData,
        },
        style: { width: nodeW, height: nodeH },
        selected: true,
        className: 'is-node-entering',
      }
      setNodes((nds) => [
        // 清除其他节点的选中态，保证同一时刻只有一个节点被选中
        ...nds.map((n) => (n.selected ? { ...n, selected: false } : n)),
        newNode,
      ])
      // 同步选中态回显：新节点默认选中，立即显示节点编辑面板
      setSelectedNode({
        id,
        kind: type,
        sourceRefs: [],
        ratio,
        videoMode: type === 'video' ? 'first-last' : undefined,
        modelVersionId: undefined,
      })
      setSaveStatus('dirty')
      // 动画结束后移除渐入类，避免节点被持久化后再恢复时重复播放动画
      window.setTimeout(() => {
        setNodes((nds) =>
          nds.map((n) =>
            n.id === id && String(n.className || '').includes('is-node-entering') ? { ...n, className: undefined } : n,
          ),
        )
      }, NODE_ENTER_MS)
    },
    [setNodes, commitHistory],
  )

  const handleMenuSelect = useCallback(
    (type: string) => {
      if (!addMenu) return
      // 视口坐标转画布坐标
      const [tx, ty, tz] = transform
      const flowX = (addMenu.x - tx) / tz
      const flowY = (addMenu.y - ty) / tz
      const nodeW = type === 'video' ? 444 : 250
      const nodeH = type === 'video' ? 250 : 250
      appendNewNode(
        type,
        { x: flowX - nodeW / 2, y: flowY - nodeH / 2 },
        { ratio: type === 'video' ? '自适应' : type === 'image' ? '1:1' : undefined },
      )
      setAddMenu(null)
    },
    [addMenu, transform, appendNewNode],
  )

  // edges 变化时同步 selectedNode.sourceRefs（用去重派生，兜底清理历史重复边）
  useEffect(() => {
    if (!selectedNode) return
    const refs: CanvasSourceRef[] = deriveSourceRefs(selectedNode.id)
    const prevRefs = selectedNode.sourceRefs || []
    // 对比必须包含 thumbnailUrl：来源节点素材变化时（应用新素材）缩略图也要同步更新
    if (
      JSON.stringify(prevRefs.map((r) => ({ k: r.kind, e: r.edgeId, s: r.slotIndex, t: r.thumbnailUrl || '' }))) !==
      JSON.stringify(refs.map((r) => ({ k: r.kind, e: r.edgeId, s: r.slotIndex, t: r.thumbnailUrl || '' })))
    ) {
      setSelectedNode((prev) => (prev ? { ...prev, sourceRefs: refs } : prev))
    }
  }, [selectedNode?.id, deriveSourceRefs])

  // 初始化：从 localStorage 恢复草稿（draftLoadedRef 保证只执行一次，切换项目后需重挂载组件）
  const draftLoadedRef = useRef(false)
  useEffect(() => {
    if (draftLoadedRef.current) return
    draftLoadedRef.current = true
    const draft = loadCanvasDraft(routeProjectId)
    if (draft && draft.nodes.length > 0) {
      // 恢复时移除渐入标记类，避免已持久化的新节点重播渐入动画
      const restoredNodes = (draft.nodes as Node[]).map((n) =>
        String(n.className || '').includes('is-node-entering') ? { ...n, className: undefined } : n,
      )
      setNodes(restoredNodes)
      setEdges(draft.edges as Edge[])
      // 恢复文本内容
      if (draft.textContents) {
        if (!(window as any).__canvasTextContents) (window as any).__canvasTextContents = new Map()
        const map = (window as any).__canvasTextContents as Map<string, string>
        Object.entries(draft.textContents).forEach(([k, v]) => map.set(k, v))
      }
      // 节点渲染完成后适配视图，让恢复的画布落在可视区域内
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          fitView({ padding: 0.2, duration: 300 })
        })
      })
    }
  }, [setNodes, setEdges, fitView, routeProjectId])

  // 自动保存：nodes/edges 变化后防抖 1 秒落盘（按项目 id 隔离草稿）
  useEffect(() => {
    const timer = setTimeout(() => {
      saveCanvasDraft(nodes, edges, routeProjectId)
    }, 1000)
    return () => clearTimeout(timer)
  }, [nodes, edges, routeProjectId])

  // 文本编辑时标记「未保存」并触发保存（文本内容不经过 nodes/edges，需显式驱动）
  useEffect(() => {
    ;(window as any).__canvasMarkDirty = () => {
      setSaveStatus('dirty')
      // 读取最新节点/边并立即落盘，确保文本与结构一并持久化
      saveCanvasDraft(latestRef.current.nodes, latestRef.current.edges, routeProjectId)
    }
    return () => {
      delete (window as any).__canvasMarkDirty
    }
  }, [routeProjectId])

  // 比例变更时同步更新节点宽高与数据
  const handleRatioChange = useCallback(
    (ratio: string) => {
      if (!selectedNode) return
      const baseSize = 250
      const { width, height } = calcNodeSize(ratio, baseSize)
      // 节点尺寸/数据变更前记录历史，供撤销使用
      commitHistory()
      setNodes((nds) =>
        nds.map((n) =>
          n.id === selectedNode.id
            ? {
                ...n,
                data: { ...(n.data as Record<string, unknown>), ratio },
                style: { ...(n.style as Record<string, unknown>), width, height },
              }
            : n,
        ),
      )
      // 同步选中态回显
      setSelectedNode((prev) => (prev ? { ...prev, ratio } : prev))
    },
    [selectedNode, setNodes, commitHistory],
  )

  // 视频生成方式变更：同步模式与比例
  const handleVideoModeChange = useCallback(
    (mode: 'first-last' | 'full-ref') => {
      if (!selectedNode) return
      const baseSize = 250
      // 视频模式变更前记录历史，供撤销使用
      commitHistory()
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== selectedNode.id) return n
          const data: Record<string, unknown> = { ...(n.data as Record<string, unknown>), videoMode: mode }
          if (mode === 'first-last') {
            // 首尾帧：强制自适应 444×250
            data.ratio = '自适应'
            return { ...n, data, style: { ...(n.style as Record<string, unknown>), width: 444, height: 250 } }
          }
          // 全能参考：无比例或自适应时默认 16:9
          if (!data.ratio || data.ratio === '自适应') {
            data.ratio = '16:9'
            const { width, height } = calcNodeSize('16:9', baseSize)
            return { ...n, data, style: { ...(n.style as Record<string, unknown>), width, height } }
          }
          return { ...n, data }
        }),
      )
      // 同步选中态回显
      setSelectedNode((prev) => {
        if (!prev) return null
        const ratio = mode === 'first-last' ? '自适应' : prev.ratio || '16:9'
        return { ...prev, videoMode: mode, ratio }
      })
    },
    [selectedNode, setNodes, commitHistory],
  )

  // 应用素材：优先应用到已选中的节点（类型匹配时替换素材内容），否则创建新节点
  const handleApplyMaterial = useCallback(
    (material: { assetId: number; type: string; src: string; name?: string }) => {
      const type = material.type === 'video' ? 'video' : 'image'
      // 已选中节点且类型匹配（图片素材可应用到图片/文本节点，视频素材应用到视频节点）
      const targetNode = selectedNode
      if (targetNode) {
        const isVideoTarget = targetNode.kind === 'video'
        if (type === 'video' ? isVideoTarget : true) {
          const assetId = Number(material.assetId || 0)
          const resultUrl = String(material.src || '')
          // 替换素材前记录历史，供撤销使用
          commitHistory()
          // 更新画布节点数据
          setNodes((nds) =>
            nds.map((n) =>
              n.id === targetNode.id
                ? {
                    ...n,
                    data: {
                      ...(n.data as Record<string, unknown>),
                      assetId,
                      resultUrl,
                    },
                  }
                : n,
            ),
          )
          // 同步选中态回显
          setSelectedNode((prev) => (prev && prev.id === targetNode.id ? { ...prev, assetId, resultUrl } : prev))
          setSaveStatus('dirty')
          return
        }
      }
      // 无选中节点或类型不匹配 → 在画布视口中心附近创建对应类型的新节点
      const nodeW = type === 'video' ? 444 : 250
      const nodeH = type === 'video' ? 250 : 250
      // 视口中心附近的画布坐标
      const [tx, ty, tz] = transform
      const flowX = (window.innerWidth / 2 - tx) / tz - nodeW / 2 + (Math.random() * 80 - 40)
      const flowY = (window.innerHeight / 2 - ty) / tz - nodeH / 2 + (Math.random() * 80 - 40)
      appendNewNode(
        type,
        { x: flowX, y: flowY },
        {
          ratio: type === 'video' ? '自适应' : '1:1',
          // 素材来源：assetId + 同源流式地址，供节点渲染/后续生成任务使用
          extraData: {
            assetId: Number(material.assetId || 0),
            resultUrl: String(material.src || ''),
          },
        },
      )
    },
    [selectedNode, transform, appendNewNode, commitHistory],
  )

  // 模型变更：保存 modelVersionId 到节点数据并回显
  const handleModelChange = useCallback(
    (modelVersionId: number) => {
      if (!selectedNode) return
      // 模型变更前记录历史，供撤销使用
      commitHistory()
      setNodes((nds) =>
        nds.map((n) =>
          n.id === selectedNode.id ? { ...n, data: { ...(n.data as Record<string, unknown>), modelVersionId } } : n,
        ),
      )
      setSelectedNode((prev) => (prev ? { ...prev, modelVersionId } : prev))
    },
    [selectedNode, setNodes, commitHistory],
  )

  const handleAddNode = useCallback(
    (type: string) => {
      appendNewNode(
        type,
        { x: 300 + Math.random() * 200, y: 200 + Math.random() * 200 },
        {
          ratio: type === 'video' ? '自适应' : type === 'image' ? '2:3' : undefined,
        },
      )
    },
    [appendNewNode],
  )

  // 右键菜单「添加节点」：菜单坐标转画布坐标后创建（默认选中 + 渐入）
  const handleContextAddNode = useCallback(
    (type: string) => {
      if (!contextMenu) return
      const [tx, ty, tz] = transform
      const flowX = (contextMenu.x - tx) / tz
      const flowY = (contextMenu.y - ty) / tz
      const nodeW = type === 'video' ? 444 : 250
      const nodeH = type === 'video' ? 250 : 250
      appendNewNode(
        type,
        { x: flowX - nodeW / 2, y: flowY - nodeH / 2 },
        { ratio: type === 'video' ? '自适应' : type === 'image' ? '1:1' : undefined },
      )
      setContextMenu(null)
    },
    [contextMenu, transform, appendNewNode],
  )

  // 参考选择模式下，标记不可选节点
  const displayNodes =
    isPickingRef && pickingTargetId
      ? nodes.map((n) => {
          if (n.id === pickingTargetId) {
            return { ...n, selectable: false, draggable: false, className: 'is-ref-disabled' }
          }
          const targetKind = (nodes.find((x) => x.id === pickingTargetId)?.data?.kind as string) || 'text'
          const sourceKind = (n.data?.kind as string) || 'text'
          const allowed = allowedSourceKinds[targetKind] || []
          const alreadyConnected = edges.some((e) => e.source === n.id && e.target === pickingTargetId)
          if (!allowed.includes(sourceKind) || alreadyConnected) {
            return { ...n, selectable: false, draggable: false, className: 'is-ref-disabled' }
          }
          return { ...n, selectable: true, draggable: false, className: 'is-ref-pickable' }
        })
      : nodes

  return (
    <div className="canvas-view">
      <div className="canvas-brand">
        <img src={brandLogo} alt="帧智汇" className="canvas-brand-logo" />
        <div className="canvas-brand-text">
          <span className="canvas-brand-name">帧智汇</span>
          <DraftSaveIndicator status={saveStatus} />
        </div>
      </div>

      {/* 抽屉未打开（或正在播放收起动画）时渲染工具栏 */}
      {!drawerPanel && (
        <CanvasFloatingToolbar
          leaving={toolbarLeaving}
          onAddNode={handleAddNode}
          selectMode={selectMode}
          onSelectModeChange={handleSelectModeChange}
          panMode={panMode}
          onPanModeChange={handlePanModeChange}
          onOpenAssets={() => openDrawerPanel('assets')}
          onOpenHistory={() => openDrawerPanel('history')}
        />
      )}

      {/* 参考选择横幅 */}
      {isPickingRef && (
        <div className="canvas-pick-banner">
          <span className="canvas-pick-banner__text">{pickError || '从画布选择参考（点击空白处退出）'}</span>
          <button className="canvas-pick-banner__exit" onClick={stopPickRef}>
            退出
          </button>
        </div>
      )}

      <ReactFlow
        nodes={displayNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        /* 键盘删除节点/连线：统一走受控清理（关联连线 + 撤销栈 + 选中态同步） */
        onNodesDelete={handleNodesDelete}
        onEdgesDelete={handleEdgesDelete}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={60}
        /* 禁用多选：任何情况下都只允许同时选中一个节点 */
        multiSelectionKeyCode={null}
        /* 拖动开始前记录历史：撤销可还原节点位置 */
        onNodeDragStart={() => commitHistory()}
        /* 劫持右键：空白区域 / 节点 / 连线统一弹出浮动菜单 */
        onPaneContextMenu={(e) => {
          e.preventDefault()
          setAddMenu(null)
          setContextMenu({ x: e.clientX, y: e.clientY })
        }}
        onNodeContextMenu={(e) => {
          // 文本编辑框内保留默认菜单（复制/粘贴）
          const target = e.target as HTMLElement
          if (target.closest('textarea, input, [contenteditable="true"]')) return
          e.preventDefault()
          setAddMenu(null)
          setContextMenu({ x: e.clientX, y: e.clientY })
        }}
        onEdgeContextMenu={(e) => {
          e.preventDefault()
          setAddMenu(null)
          setContextMenu({ x: e.clientX, y: e.clientY })
        }}
        onNodeClick={(_e, node) => {
          if (isPickingRef) {
            handlePickRefNode(node as unknown as Node)
            return
          }
          setSelectedNode({
            id: node.id,
            kind: (node.data?.kind as string) || 'text',
            sourceRefs: getSourceRefs(node.id),
            ratio: (node.data as any)?.ratio,
            videoMode: (node.data as any)?.videoMode,
            modelVersionId: (node.data as any)?.modelVersionId,
          })
        }}
        onPaneClick={() => {
          if (isPickingRef) {
            // 点击空白处退出参考选择模式，避免模式残留导致节点无法选中
            stopPickRef()
            return
          }
          setAddMenu(null)
          setSelectedNode(null)
        }}
        nodesDraggable={!selectMode}
        elementsSelectable={!panMode}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
      </ReactFlow>

      {/* 左下角复位视图按钮 */}
      <button className="canvas-reset-btn" title="复位视图" onClick={() => fitView({ padding: 0.2, duration: 300 })}>
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
          <line x1="12" y1="8" x2="12" y2="16" />
          <line x1="8" y1="12" x2="16" y2="12" />
        </svg>
      </button>

      {/* 连线剪刀图标层 — 选中连线时显示 */}
      <EdgeLabelRenderer>
        {edges
          .filter((e) => e.selected)
          .map((edge) => {
            const source = nodes.find((n) => n.id === edge.source)
            const target = nodes.find((n) => n.id === edge.target)
            if (!source || !target) return null

            const sx = source.position.x + (source.measured?.width || (source.style?.width as number) || 250) / 2
            const sy = source.position.y + (source.measured?.height || (source.style?.height as number) || 250) / 2
            const tx = target.position.x + (target.measured?.width || (target.style?.width as number) || 250) / 2
            const ty = target.position.y + (target.measured?.height || (target.style?.height as number) || 250) / 2

            const [_, labelX, labelY] = getBezierPath({
              sourceX: sx,
              sourceY: sy,
              targetX: tx,
              targetY: ty,
            })

            return (
              <div
                key={edge.id}
                style={{
                  position: 'absolute',
                  transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
                  pointerEvents: 'all',
                  zIndex: 100,
                }}
              >
                <button
                  className="canvas-edge-delete"
                  title="删除连线"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleEdgeDelete(edge.id)
                  }}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 14 14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  >
                    <path d="M4 4l6 6M10 4l-6 6" />
                    <circle cx="7" cy="7" r="5" />
                  </svg>
                </button>
              </div>
            )
          })}
      </EdgeLabelRenderer>

      {/* 右键浮动菜单：添加节点 / 撤销 / 重做 */}
      {contextMenu && (
        <div
          className="canvas-context-menu"
          style={{
            left: Math.min(contextMenu.x, window.innerWidth - CONTEXT_MENU_WIDTH),
            top: Math.min(contextMenu.y, window.innerHeight - CONTEXT_MENU_HEIGHT),
          }}
        >
          <div className="canvas-context-menu__label">添加节点</div>
          <button type="button" className="canvas-context-menu__item" onClick={() => handleContextAddNode('text')}>
            <span className="canvas-context-menu__icon">{getTypeIcon('text')}</span>
            文本节点
          </button>
          <button type="button" className="canvas-context-menu__item" onClick={() => handleContextAddNode('image')}>
            <span className="canvas-context-menu__icon">{getTypeIcon('image')}</span>
            图片节点
          </button>
          <button type="button" className="canvas-context-menu__item" onClick={() => handleContextAddNode('video')}>
            <span className="canvas-context-menu__icon">{getTypeIcon('video')}</span>
            视频节点
          </button>
          <div className="canvas-context-menu__divider" />
          <button type="button" className="canvas-context-menu__item" disabled={!historyFlags.canUndo} onClick={undo}>
            <span className="canvas-context-menu__icon">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 14 4 9l5-5" />
                <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
              </svg>
            </span>
            撤销
            <span className="canvas-context-menu__kbd">Ctrl+Z</span>
          </button>
          <button type="button" className="canvas-context-menu__item" disabled={!historyFlags.canRedo} onClick={redo}>
            <span className="canvas-context-menu__icon">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m15 14 5-5-5-5" />
                <path d="M20 9H10a6 6 0 0 0 0 12h3" />
              </svg>
            </span>
            重做
            <span className="canvas-context-menu__kbd">Ctrl+Shift+Z</span>
          </button>
        </div>
      )}

      {/* 素材库抽屉 */}
      <CanvasMaterialPicker
        workspaceId={workspaceId}
        visible={drawerPanel === 'assets'}
        variant="drawer"
        onClose={closeDrawerPanel}
        onApply={(material) => {
          // 应用素材 → 创建对应类型的图片/视频节点到画布（抽屉保持打开，可连续应用）
          handleApplyMaterial(material)
        }}
      />

      {/* 历史记录抽屉 */}
      <CanvasHistoryPanel
        visible={drawerPanel === 'history'}
        variant="drawer"
        onClose={closeDrawerPanel}
        onSelect={(item: HistoryItem) => {
          console.log('选择历史项目:', item)
          // TODO: 恢复历史画布项目
          setDrawerPanel(null)
        }}
      />

      {/* 节点编辑面板 — 选中节点时显示 */}
      {selectedNode && (
        <div className="canvas-panel-area">
          <CanvasNodePanel
            node={selectedNode}
            onStartPickRef={(slotIndex) => selectedNode && startPickRef(selectedNode.id, slotIndex)}
            onRemoveRef={handleRemoveRef}
            onRatioChange={handleRatioChange}
            onVideoModeChange={handleVideoModeChange}
            onModelChange={handleModelChange}
            models={canvasModels}
            modelsLoading={modelsLoading}
          />
        </div>
      )}

      {/* 空连线弹出菜单 */}
      {addMenu && (
        <div className="canvas-add-menu" style={{ left: addMenu.x, top: addMenu.y }}>
          <button className="canvas-add-menu__item" onClick={() => handleMenuSelect('text')}>
            <span className="canvas-add-menu__icon">{getTypeIcon('text')}</span>
            <div className="canvas-add-menu__text">
              <span className="canvas-add-menu__label">文本节点</span>
              <span className="canvas-add-menu__desc">脚本、广告词、品牌文案</span>
            </div>
          </button>
          <button className="canvas-add-menu__item" onClick={() => handleMenuSelect('image')}>
            <span className="canvas-add-menu__icon">{getTypeIcon('image')}</span>
            <div className="canvas-add-menu__text">
              <span className="canvas-add-menu__label">图片节点</span>
              <span className="canvas-add-menu__desc">宣传图、海报、封面</span>
            </div>
          </button>
          <button className="canvas-add-menu__item" onClick={() => handleMenuSelect('video')}>
            <span className="canvas-add-menu__icon">{getTypeIcon('video')}</span>
            <div className="canvas-add-menu__text">
              <span className="canvas-add-menu__label">视频节点</span>
              <span className="canvas-add-menu__desc">宣传视频、动画、电影</span>
            </div>
          </button>
        </div>
      )}
    </div>
  )
}
