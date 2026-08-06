/**
 * 无限画布（/canvas/:id）
 *
 * 页面职责：提供无限画布，通过节点+连线方式组织 AI 生成管线。
 */
import { useCallback, useRef, useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
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
  AUTO_RATIO,
  calcNodeSize,
  isAutoRatio,
} from '@/components/canvas/CanvasNodePanel'
import CanvasMaterialPicker from '@/components/canvas/CanvasMaterialPicker'
import CanvasHistoryPanel, { type HistoryItem } from '@/components/canvas/CanvasHistoryPanel'
import { saveCanvasDraft, loadCanvasDraft, readDraftBoundCanvasId } from '@/utils/canvasDraft'
import { useCurrentUser, useWorkspaceId } from '@/stores/workspaceSession'
import { resolveUserId } from '@/utils/creativeDraftMetadata'
import { useGenerationModelCatalog } from '@/composables/useGenerationModelCatalog'
import type { GenerationModelOption } from '@/utils/generationModelCatalog'
import { fetchCanvasElements, saveCanvasElementsBatched, type CanvasElementMutation } from '@/api/canvasApi'
import {
  comparableEdge,
  comparableNode,
  diffCanvasMutations,
  elementsToGraph,
  type ComparableNode,
  type ComparableEdge,
} from '@/utils/canvasElements'
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

/** 连线拖至画布空白处弹出的「添加节点」菜单项（按来源限制过滤可用性） */
const ADD_MENU_ITEMS: ReadonlyArray<{ type: string; label: string; desc: string }> = [
  { type: 'text', label: '文本节点', desc: '脚本、广告词、品牌文案' },
  { type: 'image', label: '图片节点', desc: '宣传图、海报、封面' },
  { type: 'video', label: '视频节点', desc: '宣传视频、动画、电影' },
]

/** 节点类型中文名（菜单禁用提示用） */
const KIND_LABELS: Record<string, string> = { text: '文本', image: '图片', video: '视频' }

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
  const [topHovered, setTopHovered] = useState(false)
  const [editing, setEditing] = useState(false)
  const [textContent, setTextContent] = useState(() => ((window as any).__canvasTextContents?.get(id) as string) || '')
  // 视频播放态：默认暂停，点击播放按钮后播放，播放中显示暂停按钮
  const [playing, setPlaying] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const placeholder = '双击开始编辑...'
  // 视频地址变化（应用新素材）时重置播放态，避免旧视频继续播放
  const videoUrl = (data as any)?.resultUrl
  useEffect(() => {
    setPlaying(false)
  }, [videoUrl])

  /** 播放/暂停切换：由用户点击按钮触发，非自动播放 */
  const toggleVideoPlay = () => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) {
      v.play().catch(() => setPlaying(false))
      setPlaying(true)
    } else {
      v.pause()
      setPlaying(false)
    }
  }

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

  // 顶部上传按钮：图片/视频节点显示；视频节点已有内容（生成结果/上传）时隐藏
  // 图片节点无内容显示「上传」，有内容显示「替换」——与左右侧加号 handle 同款交互（选中/悬停出现）
  const nodeResultUrl = (data as any)?.resultUrl as string | undefined
  const showUploadBtn = (kind === 'image' || kind === 'video') && !(kind === 'video' && !!nodeResultUrl)
  const uploadLabel = kind === 'image' && nodeResultUrl ? '替换' : '上传'

  const labelMap: Record<string, string> = { text: '文本', image: '图片', video: '视频' }

  return (
    <div ref={elRef} className="canvas-default-node" onMouseLeave={resetMouse} onMouseMove={handleMouseMove}>
      {/* 头部：类型图标 + 标签，浮在节点上方 */}
      <div className="canvas-node-header">
        <span className="canvas-node-header__icon">{getTypeIcon(kind)}</span>
        <span className="canvas-node-header__label">{labelMap[kind] || kind}</span>
      </div>

      {/* 顶部上传按钮：图片/视频节点专属，样式与左右侧连接点图标一致（圆形胶囊，选中/悬停出现） */}
      {showUploadBtn && (
        <button
          type="button"
          className="canvas-node-upload-btn"
          title={uploadLabel}
          data-visible={selected || topHovered}
          onMouseEnter={() => setTopHovered(true)}
          onMouseLeave={() => setTopHovered(false)}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            ;(window as any).__canvasRequestUpload?.(id)
          }}
        >
          <svg
            viewBox="0 0 24 24"
            width="13"
            height="13"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 16V4" />
            <path d="m6 10 6-6 6 6" />
            <path d="M4 20h16" />
          </svg>
          <span className="canvas-node-upload-btn__label">{uploadLabel}</span>
        </button>
      )}

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
        ) : kind === 'video' && (data as any)?.resultUrl ? (
          <div className="canvas-node-video-wrap">
            {/* 非自动播放：默认暂停，仅显示封面帧；点击播放按钮后才播放 */}
            <video
              ref={videoRef}
              className="canvas-node-media"
              src={(data as any).resultUrl}
              poster={(data as any).poster}
              playsInline
              preload="metadata"
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
            />
            {!playing ? (
              <button className="canvas-node-play-btn" onClick={toggleVideoPlay} aria-label="播放视频">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
                  <path d="M8 5.14v13.72a1 1 0 0 0 1.52.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14z" />
                </svg>
              </button>
            ) : (
              <button className="canvas-node-pause-btn" onClick={toggleVideoPlay} aria-label="暂停视频">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
                  <rect x="6" y="5" width="4" height="14" rx="1.2" />
                  <rect x="14" y="5" width="4" height="14" rx="1.2" />
                </svg>
              </button>
            )}
          </div>
        ) : kind === 'image' && (data as any)?.resultUrl ? (
          <img className="canvas-node-media" src={(data as any).resultUrl} alt={kind} loading="lazy" />
        ) : (
          getTypePlaceholder(kind)
        )}
      </div>

      {/* 所有节点（含首个/画布源头）都保留左右两个连接点：可从左侧被连线、向右连接下游 */}
      <Handle
        id={`${id}-left-target`}
        type="target"
        position={Position.Left}
        onMouseEnter={() => setLeftHovered(true)}
        onMouseLeave={() => setLeftHovered(false)}
      >
        <HandleIcon side="left" visible={leftVisible} mouseOffset={leftPos} zoom={zoom} onMouseMove={handleMouseMove} />
      </Handle>

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

/** 无限画布入口页（提供 ReactFlowProvider 上下文） */
export default function CanvasView() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  )
}

/** 画布主体逻辑 */
function CanvasInner() {
  // 路由参数中的项目 id：画布 ID 的唯一真相源（只接受合法数字 id）
  const { id: routeProjectId } = useParams()
  const navigate = useNavigate()
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const { fitView } = useReactFlow()
  const workspaceId = useWorkspaceId()
  // 当前用户：收藏 tab 按用户隔离读取
  const currentUser = useCurrentUser()
  const currentUserId = resolveUserId(currentUser)
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
  // 工具栏模式开关（独立、初始均开启，按钮默认高亮）：
  // - moveEnabled：画布平移开关（panOnDrag），关闭后画布不能移动
  // - dragEnabled：节点拖拽开关（nodesDraggable），关闭后节点不能拖拽
  const [moveEnabled, setMoveEnabled] = useState(true)
  const [dragEnabled, setDragEnabled] = useState(true)
  const handleMoveToggle = useCallback(() => setMoveEnabled((v) => !v), [])
  const handleDragToggle = useCallback(() => setDragEnabled((v) => !v), [])
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
  // 图片/视频节点上传：隐藏的 file input，供顶部胶囊上传按钮触发
  const uploadInputRef = useRef<HTMLInputElement>(null)
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
  // 拖线中（从 handle 拖出连线）的起始源节点 id；结束/取消时为 null。用于对连线目标做来源限制的视觉提示
  const connectSourceId = useStore((s) =>
    s.connection.inProgress && s.connection.fromHandle?.type === 'source' ? s.connection.fromNode.id : null,
  )

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
          sourceId: e.source,
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
    // 捕获阶段监听：window 捕获最先触发，即使 ReactFlow 内部对 mousedown 调用了
    // stopPropagation（冒泡阶段事件到不了 window），点击外部仍能可靠关闭菜单
    const close = (e: MouseEvent) => {
      if ((e.target as HTMLElement)?.closest?.('.canvas-context-menu')) return
      setContextMenu(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null)
    }
    // 延迟挂载，避免触发本次右键的 mousedown 立即关闭菜单
    const timer = window.setTimeout(() => {
      window.addEventListener('mousedown', close, true)
      window.addEventListener('keydown', onKey, true)
    }, 0)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('mousedown', close, true)
      window.removeEventListener('keydown', onKey, true)
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
          sourceId: sourceNode.id,
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
      // 同步选中态回显：新节点默认选中，立即显示节点编辑面板（首个节点同样弹出）
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
      // 返回新节点 id，供调用方（如连线创建）建立后续关系
      return id
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
      const newNodeId = appendNewNode(
        type,
        { x: flowX - nodeW / 2, y: flowY - nodeH / 2 },
        { ratio: type === 'video' ? AUTO_RATIO : type === 'image' ? '1:1' : undefined },
      )
      // 自动连线：拖线源节点 → 新节点（来源限制已在菜单项过滤时校验，新节点参考数不会超限）
      const sourceNode = latestRef.current.nodes.find((n) => n.id === addMenu.sourceId)
      if (newNodeId && sourceNode) {
        setEdges((eds) => [
          ...eds,
          {
            id: `e-${addMenu.sourceId}-${newNodeId}-0`,
            source: addMenu.sourceId,
            sourceHandle: null,
            target: newNodeId,
            targetHandle: null,
            data: { slotIndex: 0 },
          },
        ])
      }
      setAddMenu(null)
    },
    [addMenu, transform, appendNewNode, setEdges],
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

  // ===== 云端画布：创建/加载 + 增量保存（对齐 /api/v1/canvases 契约）=====
  // 画布 ID：路由带数字 id 时复用已有画布；否则进入后自动创建新画布
  const canvasIdRef = useRef<number | null>(null)
  // 服务端同步 revision：保存时作为 base_revision 做乐观锁
  const syncRevisionRef = useRef(0)
  // 首次云加载完成标记：加载后第一次 nodes/edges 变化不应触发保存
  const cloudLoadedRef = useRef(false)
  // 云端加载失败时回退 localStorage 的标记（仅提示，不阻断画布使用）
  const cloudErrorRef = useRef('')

  /**
   * 增量保存到云端（对齐 5.6「只提交变化元素」）：
   * 对比 syncedRef 快照与当前状态 → upsert 新增/变更 + delete 消失。
   * 通过队列串行化所有保存请求，避免并发保存竞态（旧状态覆盖新状态）。
   * 409 冲突：拉远端增量 → 合并本地未提交变更 → 用最新 revision 重试（真合并，非全量覆盖）。
   */
  const syncRef = useRef<{ nodes: ComparableNode[]; edges: ComparableEdge[] }>({ nodes: [], edges: [] })
  // 保存队列：串行执行，保证同一时刻只有一个保存请求在途，杜绝并发 409 竞态
  const syncQueueRef = useRef<Promise<void>>(Promise.resolve())
  // 请求在途期间节点是否又发生了变化（变化后再补一次保存）
  const syncPendingRef = useRef(false)
  const syncInFlightRef = useRef(false)

  // 增量保存到云端：对比 syncRef 快照与最新状态 → upsert/delete；内部串行 + 冲突合并重试
  const pushCanvasMutations = useCallback(() => {
    const canvasId = canvasIdRef.current
    if (!canvasId || !cloudLoadedRef.current) return
    syncPendingRef.current = true
    // 若已有请求在途，标记待补即可，避免重复入队
    if (syncInFlightRef.current) return
    syncInFlightRef.current = true
    syncQueueRef.current = syncQueueRef.current.then(async () => {
      // 循环处理：执行期间若有新变化（syncPendingRef），继续以最新状态补存
      while (syncPendingRef.current) {
        syncPendingRef.current = false
        const latest = latestRef.current
        const textMap = (window as any).__canvasTextContents as Map<string, string> | undefined
        const mutations = diffCanvasMutations(syncRef.current, latest, textMap)
        if (mutations.length === 0) continue
        try {
          const { sync_revision } = await saveCanvasElementsBatched({
            workspaceId,
            canvasId,
            baseRevision: syncRevisionRef.current,
            mutations,
          })
          syncRevisionRef.current = sync_revision
          // 成功基线重建必须用「本次提交的内容」（latest 即当时的最新状态），
          // 且以请求时刻为准；若期间又变化，循环会继续补存
          syncRef.current = {
            nodes: latest.nodes.map((n) => comparableNode(n, textMap)),
            edges: latest.edges.map((e) => comparableEdge(e)),
          }
          setSaveStatus('saved')
        } catch {
          // 乐观锁冲突或网络失败：拉取远端全量，把本地状态合并重放（非全量覆盖，避免覆盖他人修改）
          try {
            const page = await fetchCanvasElements({ workspaceId, canvasId, afterRevision: 0 })
            syncRevisionRef.current = page.sync_revision || syncRevisionRef.current
            const latest2 = latestRef.current
            const textMap2 = (window as any).__canvasTextContents as Map<string, string> | undefined
            // 重拉后：远端已同步的内容并入基线，本地与远端差异用 diff 生成（保留他人修改）
            const { nodes: remoteNodes, edges: remoteEdges } = elementsToGraph(page.elements || [])
            const textMap3 = (window as any).__canvasTextContents as Map<string, string> | undefined
            const mergedSync: { nodes: ComparableNode[]; edges: ComparableEdge[] } = {
              nodes: [
                ...remoteNodes.map((n) => comparableNode(n, textMap3)),
                // 本地有而远端没有的节点（刚新增未同步）也加入基线，避免误判为 delete
                ...latest2.nodes
                  .filter((n) => !remoteNodes.some((rn) => rn.id === n.id))
                  .map((n) => comparableNode(n, textMap2)),
              ],
              edges: [
                ...remoteEdges.map((e) => comparableEdge(e)),
                ...latest2.edges.filter((e) => !remoteEdges.some((re) => re.id === e.id)).map((e) => comparableEdge(e)),
              ],
            }
            syncRef.current = mergedSync
            // 用 diff 重试（保留远端 + 本地差异），而非全量覆盖
            const retryMutations = diffCanvasMutations(syncRef.current, latest2, textMap2)
            if (retryMutations.length === 0) continue
            const result = await saveCanvasElementsBatched({
              workspaceId,
              canvasId,
              baseRevision: syncRevisionRef.current,
              mutations: retryMutations,
            })
            syncRevisionRef.current = result.sync_revision
            // 重试成功后：以「远端 + 本地最新」合并状态为基线
            syncRef.current = {
              nodes: [
                ...remoteNodes.map((n) => comparableNode(n, textMap3)),
                ...latest2.nodes
                  .filter((n) => !remoteNodes.some((rn) => rn.id === n.id))
                  .map((n) => comparableNode(n, textMap2)),
              ],
              edges: [
                ...remoteEdges.map((e) => comparableEdge(e)),
                ...latest2.edges.filter((e) => !remoteEdges.some((re) => re.id === e.id)).map((e) => comparableEdge(e)),
              ],
            }
            setSaveStatus('saved')
          } catch {
            // 仍失败：保留 dirty 状态，下次变化再试；本地草稿兜底
            setSaveStatus('dirty')
          }
        }
      }
    })
    // 队列尾部挂 catch，防止未处理 rejection 影响后续任务；随后释放在途标记
    syncQueueRef.current = syncQueueRef.current
      .catch(() => undefined)
      .then(() => {
        syncInFlightRef.current = false
      })
  }, [workspaceId])
  // 初始化：云端优先（复用画布或新建），失败回退 localStorage 草稿
  const draftLoadedRef = useRef(false)
  useEffect(() => {
    if (draftLoadedRef.current) return
    draftLoadedRef.current = true
    // 画布 ID 唯一真相源 = 路由参数；缺失或非合法数字 → 跳回列表页，杜绝隐式新建造成画布重复
    const projectIdNum = Number(routeProjectId)
    const hasProjectId = Number.isSafeInteger(projectIdNum) && projectIdNum > 0
    if (!hasProjectId) {
      navigate('/canvas', { replace: true })
      return
    }
    const canvasId = projectIdNum
    canvasIdRef.current = canvasId

    const applyLocalDraft = () => {
      // 云端失败回退本地草稿：同样校验草稿绑定当前画布，防止展示/上传其他画布的内容
      const draft = loadCanvasDraft(routeProjectId)
      const draftBoundId = readDraftBoundCanvasId(routeProjectId)
      if (draft && draft.nodes.length > 0 && draftBoundId === canvasId) {
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
      }
      fitCanvasView()
    }

    const fitCanvasView = () => {
      // 节点渲染完成后适配视图，让恢复的画布落在可视区域内
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          fitView({ padding: 0.2, duration: 300 })
        })
      })
    }

    ;(async () => {
      try {
        // 1) 全量加载元素（after_revision=0，循环取完所有分页）
        const allElements: CanvasElementMutation[] = []
        let cursor = ''
        let pageCount = 0
        const MAX_PAGES = 50
        let page: Awaited<ReturnType<typeof fetchCanvasElements>>
        do {
          // 分页保护：防止后端异常返回相同 cursor 时无限循环
          if (++pageCount > MAX_PAGES) break
          page = await fetchCanvasElements({
            workspaceId,
            canvasId,
            afterRevision: 0,
            cursor,
          })
          syncRevisionRef.current = page.sync_revision || syncRevisionRef.current
          allElements.push(...(page.elements || []))
          cursor = page.next_cursor || ''
        } while (page.has_more && cursor)
        const { nodes: cloudNodes, edges: cloudEdges } = elementsToGraph(allElements)
        if (cloudNodes.length > 0 || cloudEdges.length > 0) {
          setNodes(cloudNodes)
          setEdges(cloudEdges)
          // 还原文本内容：云端节点 data 中的 text 字段写回全局 Map（渲染期由节点组件读取）
          if (!(window as any).__canvasTextContents) (window as any).__canvasTextContents = new Map()
          const map = (window as any).__canvasTextContents as Map<string, string>
          cloudNodes.forEach((n) => {
            const text = (n.data as any)?.text
            if (typeof text === 'string' && text.trim()) map.set(n.id, text)
          })
          // 建立已同步快照：云加载的内容视为已同步，避免首次渲染被 diff 误判为「删除」
          syncRef.current = {
            nodes: cloudNodes.map((n) => comparableNode(n, map)),
            edges: cloudEdges.map((e) => comparableEdge(e)),
          }
          cloudLoadedRef.current = true
          fitCanvasView()
        } else {
          // 云端空画布：仅当本地草稿绑定当前画布时才恢复并上传（保证画布唯一，防止把其他画布内容复制进来）
          const draft = loadCanvasDraft(routeProjectId)
          const draftBoundId = readDraftBoundCanvasId(routeProjectId)
          if (draft && draft.nodes.length > 0 && draftBoundId === canvasId) {
            const restoredNodes = (draft.nodes as Node[]).map((n) =>
              String(n.className || '').includes('is-node-entering') ? { ...n, className: undefined } : n,
            )
            setNodes(restoredNodes)
            setEdges(draft.edges as Edge[])
            if (draft.textContents) {
              if (!(window as any).__canvasTextContents) (window as any).__canvasTextContents = new Map()
              const map = (window as any).__canvasTextContents as Map<string, string>
              Object.entries(draft.textContents).forEach(([k, v]) => map.set(k, v))
            }
            // 云加载完成后，把本地草稿内容推送到云端（云端当前为空，diff 会全量 upsert）
            cloudLoadedRef.current = true
            syncRef.current = { nodes: [], edges: [] }
            scheduleSyncRef.current(true)
          } else {
            // 草稿不匹配当前画布（或为空）：不恢复不上传，云端以空画布呈现，保证画布内容唯一。
            // 初始项目预置一个默认文本节点作为画布起点，避免用户面对空白画布无从下手；
            // 默认选中并弹出编辑面板，用户可直接输入提示词开始创作
            const seedNode: Node = {
              id: createNodeId('text'),
              type: 'text',
              position: { x: 0, y: 0 },
              data: { kind: 'text' },
              style: { width: 250, height: 250 },
              selected: true,
            }
            setNodes([seedNode])
            setEdges([])
            setSelectedNode({
              id: seedNode.id,
              kind: 'text',
              sourceRefs: [],
              ratio: undefined,
              videoMode: undefined,
              modelVersionId: undefined,
            })
            // 预置节点也会同步到云端（本地草稿同样落盘绑定当前画布）
            cloudLoadedRef.current = true
            syncRef.current = { nodes: [], edges: [] }
            scheduleSyncRef.current(true)
          }
          fitCanvasView()
        }
      } catch (error: any) {
        // 云端不可用时静默回退本地草稿，保证画布可用
        cloudErrorRef.current = String(error?.message || '云端画布加载失败')
        applyLocalDraft()
      }
    })()
  }, [setNodes, setEdges, setSelectedNode, fitView, routeProjectId, navigate, workspaceId])

  // 增量保存调度：防抖 1 秒后统一执行（本地草稿 + 云端），支持立即 flush
  const saveTimerRef = useRef<number | null>(null)
  const scheduleSyncRef = useRef<(immediate?: boolean) => void>(() => undefined)
  scheduleSyncRef.current = (immediate?: boolean) => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    // 草稿必须绑定当前画布 id：所有数据保存都对应画布，防止串画布
    const boundId = canvasIdRef.current ?? 0
    if (immediate) {
      const latest = latestRef.current
      saveCanvasDraft(latest.nodes, latest.edges, routeProjectId, boundId)
      pushCanvasMutations()
      return
    }
    if (!cloudLoadedRef.current) return
    saveTimerRef.current = window.setTimeout(() => {
      const latest = latestRef.current
      // 本地草稿同步落盘兜底（云端失败时仍可恢复）
      saveCanvasDraft(latest.nodes, latest.edges, routeProjectId, boundId)
      pushCanvasMutations()
    }, 1000)
  }

  // nodes/edges 变化 → 防抖调度保存
  useEffect(() => {
    if (!cloudLoadedRef.current) return
    scheduleSyncRef.current()
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    }
  }, [nodes, edges, routeProjectId, workspaceId])

  // 文本编辑时标记「未保存」并触发保存（文本内容不经过 nodes/edges，需显式驱动）
  useEffect(() => {
    ;(window as any).__canvasMarkDirty = () => {
      setSaveStatus('dirty')
      scheduleSyncRef.current()
    }
    return () => {
      delete (window as any).__canvasMarkDirty
    }
  }, [routeProjectId, workspaceId])

  // 卸载/切页前 flush 未保存的防抖任务（同步本地草稿 + 云端），避免丢最近 1 秒改动
  const flushOnUnload = useCallback(() => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    scheduleSyncRef.current(true)
  }, [])
  // 路由切换（组件卸载）时 flush
  useEffect(() => {
    return () => {
      flushOnUnload()
    }
  }, [flushOnUnload])
  // 页面关闭/刷新/切后台时 flush（beforeunload / pagehide 兜底）
  useEffect(() => {
    const onHide = () => flushOnUnload()
    window.addEventListener('beforeunload', onHide)
    window.addEventListener('pagehide', onHide)
    return () => {
      window.removeEventListener('beforeunload', onHide)
      window.removeEventListener('pagehide', onHide)
    }
  }, [flushOnUnload])

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
            data.ratio = AUTO_RATIO
            return { ...n, data, style: { ...(n.style as Record<string, unknown>), width: 444, height: 250 } }
          }
          // 全能参考：无比例或自适应时默认 16:9
          if (!data.ratio || isAutoRatio(data.ratio as string)) {
            data.ratio = '16:9'
            const { width, height } = calcNodeSize('16:9', baseSize)
            return { ...n, data, style: { ...(n.style as Record<string, unknown>), width, height } }
          }
          return { ...n, data }
        }),
      )
      // 同步选中态回显（与 setNodes 同一套归一化逻辑）：
      // 首尾帧 → auto；全能参考下原为无比例/自适应 → 默认 16:9
      setSelectedNode((prev) => {
        if (!prev) return null
        let ratio = prev.ratio
        if (mode === 'first-last') {
          ratio = AUTO_RATIO
        } else if (!ratio || isAutoRatio(ratio)) {
          ratio = '16:9'
        }
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
          ratio: type === 'video' ? AUTO_RATIO : '1:1',
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

  // 节点顶部上传按钮通过全局钩子触发：确保该节点先被选中（其内容将作为上传目标）
  useEffect(() => {
    ;(window as any).__canvasRequestUpload = (nodeId: string) => {
      const node = latestRef.current.nodes.find((n) => n.id === nodeId)
      if (!node) return
      // 同步选中态，上传文件将应用到该节点
      setSelectedNode({
        id: node.id,
        kind: (node.data?.kind as string) || 'text',
        sourceRefs: getSourceRefs(node.id),
        ratio: (node.data as any)?.ratio,
        videoMode: (node.data as any)?.videoMode,
        modelVersionId: (node.data as any)?.modelVersionId,
        resultUrl: (node.data as any)?.resultUrl,
      })
      uploadInputRef.current?.click()
    }
    return () => {
      delete (window as any).__canvasRequestUpload
    }
  }, [getSourceRefs])

  // 文件选择后：将本地文件转为对象 URL 作为节点内容（resultUrl），并同步画布节点与选中态
  const handleUploadFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file || !selectedNode) return
      const isImage = file.type.startsWith('image/')
      const isVideo = file.type.startsWith('video/')
      const nodeKind = selectedNode.kind
      // 图片节点只接受图片；视频节点只接受视频
      if (nodeKind === 'image' && !isImage) {
        window.alert('图片节点仅支持上传图片文件')
        return
      }
      if (nodeKind === 'video' && !isVideo) {
        window.alert('视频节点仅支持上传视频文件')
        return
      }
      const objectUrl = URL.createObjectURL(file)
      // 替换内容前记录历史，供撤销使用
      commitHistory()
      setNodes((nds) =>
        nds.map((n) =>
          n.id === selectedNode.id
            ? { ...n, data: { ...(n.data as Record<string, unknown>), resultUrl: objectUrl } }
            : n,
        ),
      )
      // 同步选中态回显（视频节点一旦有内容，顶部上传按钮自动隐藏 → video.edit 模型）
      setSelectedNode((prev) => (prev && prev.id === selectedNode.id ? { ...prev, resultUrl: objectUrl } : prev))
      setSaveStatus('dirty')
    },
    [selectedNode, commitHistory, setSaveStatus],
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
          ratio: type === 'video' ? AUTO_RATIO : type === 'image' ? '1:1' : undefined,
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
        { ratio: type === 'video' ? AUTO_RATIO : type === 'image' ? '1:1' : undefined },
      )
      setContextMenu(null)
    },
    [contextMenu, transform, appendNewNode],
  )

  // 按下节点即选中（不依赖 ReactFlow 的 click 判定）：
  // 节点可拖拽时，鼠标按下后轻微移动（>阈值）会被判定为拖拽，onNodeClick 不触发，
  // 导致首次点击有概率选不中；改为 mousedown 立即选中，任何点击/拖拽都稳定响应。
  // 参考选择模式仍由 click 确认触发（避免 mousedown+click 双触发创建重复连线）。
  const handleSelectNodeOnDown = useCallback(
    (node: Node) => {
      if (isPickingRef) return
      // 首个节点（画布源头）与其他节点一致：选中即弹出编辑面板
      setSelectedNode({
        id: node.id,
        kind: (node.data?.kind as string) || 'text',
        sourceRefs: getSourceRefs(node.id),
        ratio: (node.data as any)?.ratio,
        videoMode: (node.data as any)?.videoMode,
        modelVersionId: (node.data as any)?.modelVersionId,
        resultUrl: (node.data as any)?.resultUrl,
      })
    },
    [isPickingRef, getSourceRefs],
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
      : // 拖线中（从 handle 拖出连线）：不能作为连线目标的节点灰化，与参考选择模式视觉一致
        connectSourceId
        ? nodes.map((n) => {
            // 源节点自身保持正常
            if (n.id === connectSourceId) return n
            // 校验：类型不匹配 / 已存在同源连线 / 目标参考数达上限 → 不可连接
            const invalid = validateConnection(connectSourceId, n.id) !== null
            return invalid
              ? { ...n, className: n.className ? `${n.className} is-connect-disabled` : 'is-connect-disabled' }
              : n
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
          moveEnabled={moveEnabled}
          onMoveToggle={handleMoveToggle}
          dragEnabled={dragEnabled}
          onDragToggle={handleDragToggle}
          onOpenAssets={() => openDrawerPanel('assets')}
          onOpenHistory={() => openDrawerPanel('history')}
        />
      )}

      {/* 隐藏文件选择：由节点顶部上传按钮触发，接收本地图片/视频文件 */}
      <input
        ref={uploadInputRef}
        type="file"
        accept={selectedNode?.kind === 'video' ? 'video/*' : 'image/*'}
        style={{ display: 'none' }}
        onChange={handleUploadFile}
      />

      {/* 参考选择横幅 */}
      {isPickingRef && (
        <div className="canvas-pick-banner">
          <span className="canvas-pick-banner__text">{pickError || '从画布选择参考'}</span>
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
        /* 连线预览/建立统一走来源限制校验：不可连的 handle 不显示预览连线 */
        isValidConnection={(connection) => {
          if (!connection.source || !connection.target) return false
          return !validateConnection(connection.source, connection.target)
        }}
        /* 键盘删除节点/连线：统一走受控清理（关联连线 + 撤销栈 + 选中态同步） */
        onNodesDelete={handleNodesDelete}
        onEdgesDelete={handleEdgesDelete}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={60}
        /* 禁用多选：任何情况下都只允许同时选中一个节点 */
        multiSelectionKeyCode={null}
        /* 拖动开始前记录历史：撤销可还原节点位置 */
        onNodeDragStart={(_e, node) => {
          commitHistory()
          // 节点按下后轻微移动（>拖拽阈值）会被判定为拖拽而非点击，onNodeClick 不触发，
          // 导致首次点击有概率选不中；拖拽开始同样立即选中，保证稳定响应
          handleSelectNodeOnDown(node as unknown as Node)
        }}
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
          // 首个节点（画布源头）与其他节点一致：点击弹出编辑面板
          setSelectedNode({
            id: node.id,
            kind: (node.data?.kind as string) || 'text',
            sourceRefs: getSourceRefs(node.id),
            ratio: (node.data as any)?.ratio,
            videoMode: (node.data as any)?.videoMode,
            modelVersionId: (node.data as any)?.modelVersionId,
            resultUrl: (node.data as any)?.resultUrl,
          })
        }}
        onPaneClick={() => {
          if (isPickingRef) {
            // 参考选择模式下点击空白不退出：只能通过「退出」按钮退出
            return
          }
          setAddMenu(null)
          setSelectedNode(null)
        }}
        /* 工具栏开关：移动=画布平移（panOnDrag），拖拽=节点拖拽（nodesDraggable） */
        nodesDraggable={dragEnabled}
        panOnDrag={moveEnabled}
        elementsSelectable
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

      {/* 素材库弹窗（Figma "添加素材" 模态样式，5 个 tab 参考「我的素材」页面） */}
      <CanvasMaterialPicker
        workspaceId={workspaceId}
        userId={currentUserId}
        visible={drawerPanel === 'assets'}
        variant="modal"
        onClose={closeDrawerPanel}
        onApply={(material) => {
          // 应用素材 → 创建对应类型的图片/视频节点到画布（弹窗保持打开，可连续应用）
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
            workspaceId={workspaceId}
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

      {/* 空连线弹出菜单 — 菜单项按「拖线源节点能否作为新节点来源」过滤，不可选禁用灰显 */}
      {addMenu && (
        <div className="canvas-add-menu" style={{ left: addMenu.x, top: addMenu.y }}>
          {ADD_MENU_ITEMS.map((item) => {
            const sourceNode = nodes.find((n) => n.id === addMenu.sourceId)
            const sourceKind = (sourceNode?.data?.kind as string) || 'text'
            const allowed = (allowedSourceKinds[item.type] || []).includes(sourceKind)
            return (
              <button
                key={item.type}
                className={`canvas-add-menu__item${allowed ? '' : ' is-disabled'}`}
                disabled={!allowed}
                title={
                  allowed ? undefined : `「${KIND_LABELS[sourceKind] || sourceKind}」不能作为「${item.label}」的来源`
                }
                onClick={() => handleMenuSelect(item.type)}
              >
                <span className="canvas-add-menu__icon">{getTypeIcon(item.type)}</span>
                <div className="canvas-add-menu__text">
                  <span className="canvas-add-menu__label">{item.label}</span>
                  <span className="canvas-add-menu__desc">
                    {allowed ? item.desc : `「${KIND_LABELS[sourceKind] || sourceKind}」不能作为此节点来源`}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
