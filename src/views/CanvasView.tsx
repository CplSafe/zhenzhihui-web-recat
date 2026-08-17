/**
 * 无限画布（/canvas/:id）
 *
 * 页面职责：提供无限画布，通过节点+连线方式组织 AI 生成管线。
 */
import { createContext, useCallback, useContext, useRef, useState, useEffect, useMemo, type CSSProperties } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
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

/**
 * 连线箭头仅属于画布展示层，不写入元素持久化数据。
 * 这样历史画布与新建画布都能统一显示方向，同时不会制造无意义的云端 revision。
 *
 * 取值是 CanvasEdgeArrowDefs 里那份常驻定义的 id，而不是 marker 对象——原因见该文件。
 */
const CANVAS_EDGE_END_MARKER = CANVAS_EDGE_ARROW_ID
import CanvasEdgeArrowDefs, { CANVAS_EDGE_ARROW_ID } from '@/components/canvas/CanvasEdgeArrowDefs'
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
import CanvasVideoPreviewModal from '@/components/canvas/CanvasVideoPreviewModal'
import { formatVideoDurationLabel, formatVideoTimeLabel } from '@/utils/videoDuration'
import { saveCanvasDraft, loadCanvasDraft, readDraftBoundCanvasId } from '@/utils/canvasDraft'
import { loadLastSelectedNodeId, saveLastSelectedNodeId } from '@/utils/canvasSelection'
import { useCurrentUser, useWorkspaceId } from '@/stores/workspaceSession'
import { resolveUserId } from '@/utils/creativeDraftMetadata'
import { useGenerationModelCatalog } from '@/composables/useGenerationModelCatalog'
import { buildCanvasModelBuckets } from '@/utils/canvasModelBuckets'
import { findFreeNodePosition } from '@/utils/canvasNodePlacement'
import { fetchAllCanvasElements, saveCanvasElementsBatched } from '@/api/canvasApi'
import {
  cancelAiTask,
  createAiTask,
  extractTaskText,
  getAiTask,
  getAiTaskId,
  normalizeAiTaskStatus,
  uploadAssetFile,
} from '@/api/business'
import { polishText } from '@/api/aiPolish'
import { assetStreamUrl } from '@/utils/assetUrl'
import { acquireSeekableSource, type SeekableSourceHandle } from '@/utils/seekableMediaSource'
import { readVideoDurationSecExact } from '@/utils/videoDuration'
import { captureVideoFrame, type VideoFramePosition } from '@/utils/videoFrameCapture'
import { resolveGeneratedMediaUrls, resolveVerifiedResultAssetId } from '@/utils/taskMedia'
import { resolveModelInputAssetRole } from '@/utils/modelInputAssetRole'
import { buildDownloadName, downloadToDisk } from '@/utils/downloadToDisk'
import { isCanvasStoryboardText, parseCanvasStructuredText } from '@/utils/canvasStructuredText'
import {
  buildCanvasInputAssets,
  inferCanvasConnectionRole,
  validateCanvasVideoInputs,
  type CanvasVideoMode,
} from '@/utils/canvasGeneration'
import { getCanvasTaskPresentation } from '@/utils/canvasTaskState'
import { resolveInheritedNodeRatio } from '@/utils/canvasNodeDefaults'
import CanvasTimelineEditor from '@/components/canvas/CanvasTimelineEditor'
import CanvasTimelinePlayer from '@/components/canvas/CanvasTimelinePlayer'
import CanvasTimelineNodeBody from '@/components/canvas/CanvasTimelineNodeBody'
import CanvasTimelineNodeActions, { type CanvasTimelineSource } from '@/components/canvas/CanvasTimelineNodeActions'
import {
  MAX_TIMELINE_CLIPS,
  attachClipSourceDuration,
  attachTimelineSource,
  buildTimelineCutlist,
  extractTimelineRange,
  removeTimelineClip,
  getClipDuration,
  getClipOffsets,
  getTimelineDuration,
  isSameTimelineClips,
  parseTimelineState,
  syncTimelineClipsFromSources,
  type TimelineClip,
  type TimelineCutlist,
  type TimelineState,
} from '@/utils/timelineClips'
import type { ConcatSource } from '@/utils/videoConcat'
import { applyCanvasRealPersonIdentity, resolveCanvasRealPersonReference } from '@/utils/canvasRealPerson'
import { isRealPersonReferenceStillAuthorized, type SmartRealPersonReference } from '@/utils/smartRealPerson'
import { listRealPeople } from '@/api/realPeople'
import {
  LOCAL_IMAGE_IMPORT_LIMIT,
  extractImageFiles,
  hasFileDrag,
  pickImageFiles,
  readImageNaturalSize,
  snapImageRatio,
} from '@/utils/canvasLocalImage'
import { openMemberCenterTab, requestConfirm, showToast } from '@/stores/ui'
import {
  buildEdgeId,
  applyCanvasElementMutations,
  comparableEdge,
  comparableNode,
  diffCanvasMutations,
  elementsToGraph,
  collectCanvasSourceRefs,
  isCanvasProvenanceEdge,
  type ComparableNode,
  type ComparableEdge,
} from '@/utils/canvasElements'
import './CanvasView.css'

/** 节点素材回显地址归一化：blob:（本地上传的会话级临时地址）或缺失但 assetId 存在时，用同源流式地址重建。 */
export function resolveNodeMediaUrl(data: Record<string, unknown> | undefined, workspaceId: number): string {
  const record = data || {}
  const resultUrl = String(record.resultUrl || '')
  const assetId = Number(record.assetId || 0)
  if (resultUrl && !resultUrl.startsWith('blob:')) return resultUrl
  if (Number.isSafeInteger(assetId) && assetId > 0) return assetStreamUrl(assetId, workspaceId)
  return resultUrl
}

/** 归一化节点素材：把 blob: 临时地址替换为可持久回显的同源流式地址（旧数据兜底）。 */
export function normalizeNodeMedia(node: Node, workspaceId: number): Node {
  const data = (node.data || {}) as Record<string, unknown>
  const resultUrl = String(data.resultUrl || '')
  const assetId = Number(data.assetId || 0)
  const nextData =
    resultUrl.startsWith('blob:') && Number.isSafeInteger(assetId) && assetId > 0
      ? { ...data, resultUrl: assetStreamUrl(assetId, workspaceId) }
      : data
  const currentWidth = Number((node.style as Record<string, unknown> | undefined)?.width || 0)
  const shouldExpandStoryboard = data.kind === 'text' && isCanvasStoryboardText(data.text) && currentWidth <= 300
  return {
    ...node,
    data: nextData,
    style: shouldExpandStoryboard ? { ...node.style, width: 420, height: 480 } : node.style,
  }
}

function isInsufficientCreditsError(error: any): boolean {
  const code = String(error?.code || error?.response?.code || error?.response?.data?.code || '').toUpperCase()
  const message = String(
    error?.message ||
      error?.response?.message ||
      error?.response?.error?.message ||
      error?.response?.data?.message ||
      '',
  )
  return code === 'INSUFFICIENT_CREDITS' || code === '10402' || /insufficient credits|积分不足/i.test(message)
}

/**
 * 由来源引用组装 input_assets（文档 6.3 约定）：
 * - image.image_to_image → role: reference_image
 * - 其余（video.generate / video.edit 等）→ role: image
 * - 文本来源不传素材（内容已拼入 prompt）；无 assetId 的来源跳过。
 */
export { buildCanvasInputAssets, validateCanvasVideoInputs } from '@/utils/canvasGeneration'

/** 视频文件首帧 poster（压缩 dataURL，随节点持久化）；失败静默返回空串。 */
function captureVideoPoster(file: File): Promise<string> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'metadata'
    const cleanup = () => {
      URL.revokeObjectURL(url)
      video.removeAttribute('src')
      video.load?.()
    }
    const fail = () => {
      cleanup()
      resolve('')
    }
    video.onerror = fail
    video.onloadeddata = () => {
      try {
        video.currentTime = 0
      } catch {
        fail()
      }
    }
    video.onseeked = () => {
      try {
        const sw = video.videoWidth
        const sh = video.videoHeight
        if (!sw || !sh) return fail()
        const scale = Math.min(1, 1280 / Math.max(sw, sh))
        const w = Math.max(1, Math.round(sw * scale))
        const h = Math.max(1, Math.round(sh * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) return fail()
        ctx.drawImage(video, 0, 0, w, h)
        const poster = canvas.toDataURL('image/jpeg', 0.85)
        cleanup()
        resolve(poster)
      } catch {
        fail()
      }
    }
    video.src = url
  })
}

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
/**
 * 合成在浏览器本地完成（见 utils/videoConcat）：不解码不重编码，画质与源片一致。
 * 代价是裁剪点只能落在关键帧上，这一点必须提前告诉用户，而不是等出片后才发现对不上。
 */
const TIMELINE_COMPOSE_NOTE = '本地无损合成：画质与源片一致，裁剪点会吸附到最近的关键帧'

/**
 * 时间线节点尺寸。
 *
 * 比其他节点高一截：卡片上直接放预览 + 片段条 + 添加/合成，常用操作不必先双击进弹窗。
 * 弹窗编辑器保留给逐帧裁剪与分割这类精修动作。
 */
const TIMELINE_NODE_SIZE = { width: 460, height: 400 }
// 浏览器本地合成需要同时持有源文件和输出文件；超过该体积改由后端合成更安全。
const MAX_LOCAL_TIMELINE_SOURCE_BYTES = 512 * 1024 * 1024

/**
 * 节点 → 画布的动作通道。
 *
 * 节点组件由 React Flow 渲染，只拿得到 data，够不到 setNodes / 上传 / 历史栈。
 * 截帧这类「在节点里取素材、由画布落地成新节点」的动作走这个 context 交回上层，
 * 而不是把回调塞进节点 data（data 会被持久化，放不了函数）。
 */
interface CanvasNodeActions {
  /** 把视频节点当前画面截成一张图，交给画布上传并落成图片节点。 */
  onCaptureFrame?: (nodeId: string, frameDataUrl: string) => void
  /** 该节点是否正在截帧上传中。 */
  capturingNodeId?: string
  /**
   * 剪辑时间线的常用操作，直接在节点卡片上完成。
   *
   * 双击进弹窗才能加片段太重了——挑素材、删片段、合成都是高频动作，
   * 应当在当前这一步就地可做；弹窗只留给逐帧裁剪与分割这类精修。
   */
  timeline?: {
    /** 点开下拉时才调用：挂进 context 值里会让任何节点变动都触发全体重渲染。 */
    getAddableSources: (timelineNodeId: string) => CanvasTimelineSource[]
    onAddClip: (timelineNodeId: string, sourceNodeId: string) => void
    onRemoveClip: (timelineNodeId: string, clipId: string) => void
    onCompose: (timelineNodeId: string) => void
    onOpenEditor: (timelineNodeId: string) => void
    composingNodeId: string
    composeProgress: string
  }
}

const CanvasNodeActionsContext = createContext<CanvasNodeActions>({})

/** 截帧位置及其文案：首帧接续上一个镜头，尾帧给下一个镜头当起点。 */
const CAPTURE_POSITIONS: Array<{ position: VideoFramePosition; label: string }> = [
  { position: 'first', label: '首帧' },
  { position: 'current', label: '当前帧' },
  { position: 'last', label: '尾帧' },
]

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

/** 打开抽屉前，左侧工具栏收起动画的时长（毫秒） */
const TOOLBAR_LEAVE_MS = 220

/** 新节点渐入动画时长（毫秒），与 CSS 动画时长保持一致 */
const NODE_ENTER_MS = 350

/** 本地图片预览地址的释放延迟（毫秒）：等正式地址加载完再释放，避免画面闪断 */
const LOCAL_PREVIEW_REVOKE_MS = 5000

/** 编辑面板与选中节点之间的间距（像素），同时用作面板与视口边缘的安全距离 */
const NODE_PANEL_GAP = 16

/**
 * 面板左边缘要为左侧浮动工具栏让出的宽度。
 *
 * 工具栏在 left:46px、宽约 68px（见 CanvasFloatingToolbar.module.css），z-index:10，
 * 而面板是 z-index:50——两者一重叠，工具栏底部的按钮就被面板压住点不到
 * （实测「历史记录」被面板的参考图行完全遮住）。夹取时把这条竖带让出来。
 */
const NODE_PANEL_LEFT_SAFE = 128

/**
 * 模型版本 ID → 展示名。
 *
 * 节点渲染在 React Flow 内部，拿不到 CanvasInner 里的模型目录；放大预览要显示模型名，
 * 与其让每个节点各自去拉一次目录，不如由 CanvasInner 在目录就绪后写入这份共享映射。
 * 与本文件既有的 __canvasTextContents 同一思路。
 */
let canvasModelNameByVersion: Record<number, string> = {}

/** 判断 params 里的字段名是否表示「生成音频」；后端各模型命名不一。 */
function isAudioParamKey(key: string): boolean {
  return ['generateaudio', 'audio', 'withaudio', 'enableaudio'].includes(
    String(key || '')
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/g, ''),
  )
}

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
const CONTEXT_MENU_HEIGHT = 314

/** 历史快照：nodes/edges + 文本内容（文本独立于 nodes 存储，必须一并快照才能正确撤销） */
interface CanvasHistorySnapshot {
  nodes: Node[]
  edges: Edge[]
  textContents: Record<string, string>
}

interface CanvasGenerationRequest {
  kind: string
  prompt: string
  modelVersionId: number
  operationCode: string
  params: Record<string, unknown>
  sourceRefs: CanvasSourceRef[]
  ratio?: string
  videoMode?: CanvasVideoMode
  /** 视频生视频的源视频（节点自己已有的那条）；为 0/缺省表示从头生成。 */
  selfVideoAssetId?: number
}

const ACTIVE_TASK_STATUSES = new Set([
  'submitting',
  'queued',
  'pending',
  'processing',
  'running',
  'reconnecting',
  'status_query_failed',
  'result_pending',
])

function isGeneratingVideoNode(node: Node): boolean {
  const data = (node.data || {}) as Record<string, unknown>
  const kind = String(data.kind || node.type || '')
  return kind === 'video' && ACTIVE_TASK_STATUSES.has(normalizeAiTaskStatus(data.taskStatus))
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

/** Handle 图标固定在节点侧边，随节点一起移动。 */
function HandleIcon({ nodeId, side, visible }: { nodeId: string; side: 'left' | 'right'; visible: boolean }) {
  const handleNextStep = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    ;(window as any).__canvasOpenNextStep?.(nodeId, event.clientX, event.clientY)
  }

  return (
    <div className={`canvas-handle-mover canvas-handle-mover--${side}`}>
      <button
        type="button"
        className={`canvas-handle-icon canvas-handle-icon--${side} nodrag nopan`}
        data-visible={visible}
        aria-label="添加下一步"
        title="添加下一步"
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={handleNextStep}
      >
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
      </button>
    </div>
  )
}

/**
 * 画布缩放范围。
 *
 * 下限比 React Flow 默认的 0.5 低得多：后期节点一多，0.5 根本装不下整张图。
 * 上限保持 2，与节点内文字反向补偿的上限一致（见 readableTextScale）。
 */
const MIN_CANVAS_ZOOM = 0.02
const MAX_CANVAS_ZOOM = 2

/** 自定义画布节点 */
function CanvasDefaultNode({ id, data, selected }: NodeProps<Node>) {
  const canvasZoom = useStore((state) => state.transform[2])
  // 画布负责节点的位置和尺寸缩放；文字做反向补偿，使屏幕上的阅读字号保持稳定。
  // React Flow 默认缩放范围内为精确补偿，极端倍率做保护，避免产生异常字号。
  const readableTextScale = 1 / Math.min(2.5, Math.max(0.4, canvasZoom || 1))
  const [leftHovered, setLeftHovered] = useState(false)
  const [rightHovered, setRightHovered] = useState(false)
  const [topHovered, setTopHovered] = useState(false)
  const [editing, setEditing] = useState(false)
  const [textContent, setTextContent] = useState(
    () => ((window as any).__canvasTextContents?.get(id) as string) || String((data as any)?.text || ''),
  )
  useEffect(() => {
    const remoteText = String((data as any)?.text || '')
    if (!editing && remoteText && remoteText !== textContent) {
      setTextContent(remoteText)
      if (!(window as any).__canvasTextContents) (window as any).__canvasTextContents = new Map()
      ;(window as any).__canvasTextContents.set(id, remoteText)
    }
  }, [data, editing, id, textContent])
  // 视频播放态：默认暂停，点击播放按钮后播放，播放中显示暂停按钮
  const [playing, setPlaying] = useState(false)
  // 视频时长（秒）：由 <video> 元数据回填（preload="metadata" 已足够拿到 duration）
  const [videoDurationSec, setVideoDurationSec] = useState(0)
  // 播放进度（秒）：驱动进度条与时间读数，拖动进度条时同步回写 video.currentTime
  const [videoCurrentSec, setVideoCurrentSec] = useState(0)
  const [videoScrubbing, setVideoScrubbing] = useState(false)
  // 放大查看：全屏预览弹窗开关
  const [videoPreviewOpen, setVideoPreviewOpen] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const videoTrackRef = useRef<HTMLDivElement>(null)
  // 目标进度（秒）：用户拖动/按键设定的位置。
  // 部分媒体源在起播或重新拉流时会把 currentTime 抹回 0（典型是上游不支持 Range 分段请求），
  // 表现为「拖到 22 秒却从头开始播」。这里记住目标位置，在元数据就绪与起播时补一次 seek。
  const pendingSeekRef = useRef(0)
  const pendingSeekTriesRef = useRef(0)
  // 用户真正开始看这个视频后才升级 preload：让浏览器把数据缓冲下来，
  // 跳转就能落在已缓冲区间内（源不支持分段请求时也能跳）。默认 metadata，避免画布上每个视频都整片预载。
  const [videoPreload, setVideoPreload] = useState<'metadata' | 'auto'>('metadata')
  // 兜底可跳转源：整片抓到本地后的 object URL（见 ensureSeekableSource）
  const [videoLocalSrc, setVideoLocalSrc] = useState('')
  const [videoPreparing, setVideoPreparing] = useState(false)
  const videoLocalSrcRef = useRef('')
  const videoSeekableHandleRef = useRef<SeekableSourceHandle | null>(null)
  const videoPreparingRef = useRef(false)
  const resumeAfterSwapRef = useRef(false)
  const seekCheckTimerRef = useRef(0)
  const placeholder = '双击开始编辑...'
  // 素材回显地址：blob: 临时地址或缺失但 assetId 存在时，用同源流式地址重建（刷新后不丢）
  const workspaceId = useWorkspaceId()
  // 本地导入的图片在上传完成前先用会话级预览地址显示；previewUrl/uploading 均不在持久化白名单内
  const uploadingLocalFile = Boolean((data as any)?.uploading)
  const localPreviewUrl = String((data as any)?.previewUrl || '')
  const mediaUrl = resolveNodeMediaUrl(data as Record<string, unknown> | undefined, workspaceId) || localPreviewUrl
  const mediaUrlRef = useRef(mediaUrl)
  mediaUrlRef.current = mediaUrl
  // 视频地址变化（应用新素材）时重置播放态与时长，避免旧视频继续播放或残留旧时长角标
  const videoUrl = mediaUrl
  useEffect(() => {
    setPlaying(false)
    setVideoDurationSec(0)
    setVideoCurrentSec(0)
    setVideoScrubbing(false)
    setVideoPreviewOpen(false)
    setVideoPreload('metadata')
    setVideoLocalSrc('')
    pendingSeekRef.current = 0
    pendingSeekTriesRef.current = 0
    return () => {
      // 换素材/卸载时释放本地整片，避免 blob 常驻内存。
      // blob 归 seekableMediaSource 所有（可能还被别处共用），这里只还引用，不自己 revoke
      window.clearTimeout(seekCheckTimerRef.current)
      videoSeekableHandleRef.current?.release()
      videoSeekableHandleRef.current = null
      videoLocalSrcRef.current = ''
    }
  }, [videoUrl])
  // 实际播放地址：优先本地整片（可任意跳转），否则用流式地址
  const videoPlaybackSrc = videoLocalSrc || mediaUrl

  const videoDurationLabel = formatVideoDurationLabel(videoDurationSec)
  const videoProgressPercent =
    videoDurationSec > 0 ? Math.min(100, Math.max(0, (videoCurrentSec / videoDurationSec) * 100)) : 0

  /**
   * 让视频变得可跳转：把整片抓到本地，改用 object URL 播放。
   * 源不支持 Range 分段请求时，浏览器停不住 currentTime——设完就被抹回 0，表现为「拖到 15 秒仍从头播」。
   * 本地 blob 的跳转完全在内存里完成，不依赖服务端。只在跳转确实失败的那个节点触发，不整片预载画布。
   *
   * 抓取走全站共用的 seekableMediaSource：同一条素材在放大预览、时间线、抽帧里只下载一次。
   */
  const ensureSeekableSource = async () => {
    if (videoLocalSrcRef.current || videoPreparingRef.current) return
    const url = mediaUrl
    if (!url || url.startsWith('blob:') || url.startsWith('data:')) return
    videoPreparingRef.current = true
    setVideoPreparing(true)
    resumeAfterSwapRef.current = !videoRef.current?.paused
    const handle = acquireSeekableSource(url)
    try {
      const ready = await handle.ready
      // 抓取期间换了素材，或压根没抓下来（鉴权/跨域/网络）：丢弃这次，
      // 继续用流式地址，跳转能力取决于源是否支持分段请求
      if (mediaUrlRef.current !== url || !ready.local) {
        handle.release()
        resumeAfterSwapRef.current = false
        return
      }
      videoSeekableHandleRef.current?.release()
      videoSeekableHandleRef.current = handle
      videoLocalSrcRef.current = ready.url
      pendingSeekTriesRef.current = 0
      setVideoLocalSrc(ready.url)
    } finally {
      videoPreparingRef.current = false
      setVideoPreparing(false)
    }
  }

  /**
   * 校验跳转是否真的落住。只有 currentTime 被抹回目标之前才算失败——
   * 正常播放会向后走，不能当成失败，否则会平白触发整片下载。
   */
  const verifySeekLanded = () => {
    window.clearTimeout(seekCheckTimerRef.current)
    seekCheckTimerRef.current = window.setTimeout(() => {
      const video = videoRef.current
      const target = pendingSeekRef.current
      if (!video || !(target > 0) || videoLocalSrcRef.current) return
      if (video.currentTime >= target - 0.5) return
      void ensureSeekableSource()
    }, 600)
  }

  /** 跳转到指定秒，并记下目标位置供起播时补偿 */
  const seekVideoTo = (seconds: number) => {
    const video = videoRef.current
    if (!video || !(videoDurationSec > 0)) return
    const clamped = Math.min(videoDurationSec, Math.max(0, seconds))
    pendingSeekRef.current = clamped
    pendingSeekTriesRef.current = 0
    setVideoPreload('auto')
    video.currentTime = clamped
    setVideoCurrentSec(clamped)
    verifySeekLanded()
  }

  /**
   * 起播 / 重新拉流时把进度补回用户拖到的位置。
   * 容差 0.35s：已经停在目标位置就不动它；补两次仍回不去说明这个源真的跳不动，
   * 放弃补偿让位给用户，避免和播放器来回抢控制权。
   */
  const applyPendingSeek = (video: HTMLVideoElement) => {
    const target = pendingSeekRef.current
    if (!(target > 0)) return
    const duration = Number(video.duration)
    if (!Number.isFinite(duration) || target >= duration) return
    if (Math.abs(video.currentTime - target) <= 0.35) return
    if (pendingSeekTriesRef.current >= 2) return
    pendingSeekTriesRef.current += 1
    video.currentTime = target
  }

  /** 按指针横坐标跳转到对应秒：轨道 rect 已含画布缩放，无需再按 zoom 换算 */
  const seekVideoToClientX = (clientX: number) => {
    const track = videoTrackRef.current
    if (!track || !(videoDurationSec > 0)) return
    const rect = track.getBoundingClientRect()
    if (!(rect.width > 0)) return
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    seekVideoTo(ratio * videoDurationSec)
  }

  /** 拖动进度条：指针按下即跳转，捕获指针后允许拖出轨道继续拖动 */
  const handleTrackPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.stopPropagation()
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setVideoScrubbing(true)
    seekVideoToClientX(event.clientX)
  }

  const handleTrackPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!videoScrubbing) return
    event.stopPropagation()
    seekVideoToClientX(event.clientX)
  }

  const handleTrackPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!videoScrubbing) return
    event.stopPropagation()
    setVideoScrubbing(false)
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  /** 键盘调帧：左右（Shift 加速）逐秒跳转，Home/End 跳到首尾；阻止冒泡避免画布接管方向键 */
  const handleTrackKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const video = videoRef.current
    if (!video || !(videoDurationSec > 0)) return
    const step = event.shiftKey ? 5 : 1
    let next: number | null = null
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = videoCurrentSec - step
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = videoCurrentSec + step
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = videoDurationSec
    if (next === null) return
    event.preventDefault()
    event.stopPropagation()
    seekVideoTo(next)
  }

  /** 播放/暂停切换：由用户点击按钮触发，非自动播放 */
  const toggleVideoPlay = () => {
    const v = videoRef.current
    if (!v) return
    // 用户手动接管后不再算「悬停自动播放」，移出画面时不该被自动暂停
    hoverAutoPlayedRef.current = false
    if (v.paused) {
      // 悬停预览是静音起播的；用户主动点播放时要把声音还回来
      v.muted = false
      setVideoPreload('auto')
      // 起播前先把进度对回目标位置：暂停态是最可靠的补 seek 时机
      applyPendingSeek(v)
      v.play().catch(() => setPlaying(false))
      setPlaying(true)
      // 起播后再验一次：被抹回 0 就切本地整片
      verifySeekLanded()
    } else {
      v.pause()
      setPlaying(false)
    }
  }

  /**
   * 悬停预览：鼠标移入自动播放、移出暂停。
   *
   * 静音起播——浏览器只允许静音视频自动播放，带声音的 play() 会被拒绝。
   * 移出时只暂停不回到开头，鼠标再移回来能接着看；用户已用播放条手动播放的
   * 不受影响（移出时不停），否则会打断正在看的人。
   */
  const hoverAutoPlayedRef = useRef(false)
  const handleVideoHoverEnter = () => {
    const v = videoRef.current
    if (!v || !videoUrl || videoPreviewOpen || !v.paused) return
    setVideoPreload('auto')
    v.muted = true
    applyPendingSeek(v)
    void v
      .play()
      .then(() => {
        hoverAutoPlayedRef.current = true
        setPlaying(true)
      })
      .catch(() => {
        // 自动播放被拒（策略或素材未就绪）：保持暂停态，用户仍可点播放按钮
        hoverAutoPlayedRef.current = false
      })
  }
  const handleVideoHoverLeave = () => {
    const v = videoRef.current
    if (!v || !hoverAutoPlayedRef.current) return
    hoverAutoPlayedRef.current = false
    v.pause()
    setPlaying(false)
  }

  /**
   * 放大预览右侧的视频信息：只取节点上已有的数据，缺失字段不展示。
   * 文件大小、分辨率、创建者需要另查资产接口，这里不做。
   */
  const videoPreviewInfo = useMemo(() => {
    const record = (data || {}) as Record<string, unknown>
    const params = (record.params || {}) as Record<string, unknown>
    const audioKey = Object.keys(params).find(isAudioParamKey)
    const ratioValue = String(record.ratio || '')
    const createdRaw = String(record.taskUpdatedAt || record.taskStartedAt || '')
    const createdAt = createdRaw ? new Date(createdRaw) : null
    return {
      modelName: canvasModelNameByVersion[Number(record.modelVersionId || 0)] || '',
      // auto 是「跟随输入」的占位，不是真实比例，不展示
      ratio: isAutoRatio(ratioValue) ? '' : ratioValue,
      durationLabel: videoDurationLabel,
      ...(audioKey ? { generateAudio: Boolean(params[audioKey]) } : {}),
      createdAt: createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt.toLocaleString('zh-CN') : '',
    }
  }, [data, videoDurationLabel])

  /** 放大查看：先暂停节点内的视频，避免与弹窗里的播放重叠出声 */
  const openVideoPreview = () => {
    videoRef.current?.pause()
    setPlaying(false)
    setVideoPreviewOpen(true)
  }

  const handleDoubleClick = () => {
    // 视频：双击画面直接放大查看，与右下角的放大按钮同一入口。
    // 看大图是这个节点最高频的诉求，不该要求先找到那个悬停才显眼的小图标。
    if (kind === 'video' && mediaUrl) {
      openVideoPreview()
      return
    }
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

  const kind = (data.kind as string) || 'text'
  const structuredText = useMemo(() => parseCanvasStructuredText(textContent), [textContent])
  // 截帧动作由画布提供：节点只负责取出画面，上传与建节点在上层做
  const { onCaptureFrame, capturingNodeId, timeline: timelineActions } = useContext(CanvasNodeActionsContext)
  const capturing = capturingNodeId === id
  // 截帧位置选择（首帧/当前帧/尾帧）的展开态
  const [captureMenuOpen, setCaptureMenuOpen] = useState(false)
  // 点到别处收起，避免菜单一直盖在画面上
  useEffect(() => {
    if (!captureMenuOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if ((event.target as HTMLElement)?.closest?.('.canvas-node-video-capture-wrap')) return
      setCaptureMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [captureMenuOpen])

  // 时间线节点：卡片内直接渲染可操作的编辑面，弹窗只用于精修
  const nodeWorkspaceId = useWorkspaceId()
  const timelineSummary = useMemo(() => {
    if (kind !== 'timeline') return { clips: [] as TimelineClip[], totalSec: 0 }
    const timeline = parseTimelineState((data as Record<string, unknown>)?.timeline)
    return { clips: timeline.clips, totalSec: getTimelineDuration(timeline) }
  }, [kind, data])
  /**
   * 连进来但素材还没就绪的视频数量。
   *
   * 直接从 React Flow store 读，而不是让上层算好写进节点 data——
   * data 会被持久化，这类派生的瞬时值不该混进去。选择器返回标量，值不变就不会重渲染。
   */
  const timelinePendingSourceCount = useStore((state) => {
    if (kind !== 'timeline') return 0
    let count = 0
    for (const edge of state.edges) {
      if (edge.target !== id) continue
      const source = state.nodeLookup.get(edge.source)
      if (!(Number((source?.data as Record<string, unknown> | undefined)?.assetId || 0) > 0)) count += 1
    }
    return count
  })
  const leftVisible = selected || leftHovered
  const rightVisible = selected || rightHovered

  // 顶部操作胶囊：图片/视频节点专属
  // - 图片：无内容 → 「上传」；有内容 → 「替换」+「下载」
  // - 视频：无内容 → 「上传」；有内容 → 「下载」（视频有内容时不再隐藏，改为可下载）
  const nodeResultUrl = mediaUrl
  const isImageNode = kind === 'image'
  const isVideoNode = kind === 'video'
  const hasContent = Boolean(nodeResultUrl)
  const taskStatus = normalizeAiTaskStatus((data as any)?.taskStatus)
  const taskProgress = Math.max(0, Math.min(100, Number((data as any)?.taskProgress || 0)))
  const taskError = String((data as any)?.taskError || '')
  const taskHasResult = kind === 'text' ? Boolean(textContent.trim()) : Boolean(mediaUrl)
  const taskPresentation = getCanvasTaskPresentation({
    status: taskStatus,
    progress: taskProgress,
    hasResult: taskHasResult,
    error: taskError,
  })
  const taskRunning = taskPresentation.running
  const taskFailed = taskPresentation.failed
  // 本地图片上传中：素材尚未落库，替换/下载都拿不到 assetId，先隐藏这两个动作
  const showUploadAction = isImageNode || isVideoNode ? !(isVideoNode && hasContent) && !uploadingLocalFile : false
  const uploadLabel = isImageNode && hasContent ? '替换' : '上传'
  const showDownloadAction = (isImageNode || isVideoNode) && hasContent && !uploadingLocalFile
  // 删除属于所有节点的基础操作，因此文本、图片和视频节点都保留顶部操作组。
  const showTopActions = true

  /** 下载节点素材：优先按 assetId 走素材下载接口（/api/v1/assets/{id}/download），无 assetId 时退回 resultUrl。 */
  const handleDownloadMedia = () => {
    const assetId = Number((data as any)?.assetId || 0) || 0
    const fileName = buildDownloadName(
      kind === 'image' ? '画布图片' : '画布视频',
      new Date(),
      kind === 'image' ? 'jpg' : 'mp4',
    )
    void downloadToDisk({
      fileName,
      mimeType: kind === 'image' ? 'image/jpeg' : 'video/mp4',
      preserveResponseMediaType: kind === 'image',
      resolveUrl: () => {
        if (assetId > 0) return assetStreamUrl(assetId, workspaceId)
        return mediaUrl
      },
    }).catch((error: any) => {
      // 不能静默：另存为对话框已经在磁盘上建好了空文件，用户看到的是一个 0 字节的成品，
      // 不给原因就会以为下载功能坏了。'started' 等浏览器接管的情况不会走到这里。
      showToast(String(error?.message || '下载失败，请稍后重试'), 'error')
    })
  }

  const labelMap: Record<string, string> = {
    text: '文本',
    image: '图片',
    video: '视频',
    timeline: '视频剪辑',
  }

  return (
    <div className="canvas-default-node" style={{ '--canvas-readable-text-scale': readableTextScale } as CSSProperties}>
      {/* 头部：类型图标 + 标签，浮在节点上方 */}
      <div className="canvas-node-header">
        <span className="canvas-node-header__icon">{getTypeIcon(kind)}</span>
        <span className="canvas-node-header__label">{labelMap[kind] || kind}</span>
      </div>

      {/* 顶部操作胶囊：上传/替换 + 下载（图片/视频节点专属，与左右侧连接点图标同款交互：选中/悬停出现） */}
      {showTopActions && (
        <div
          className="canvas-node-upload-group"
          data-visible={selected || topHovered}
          onMouseEnter={() => setTopHovered(true)}
          onMouseLeave={() => setTopHovered(false)}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {showUploadAction && (
            <button
              type="button"
              className="canvas-node-upload-btn"
              title={uploadLabel}
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
          {/* 时间线：添加视频 / 精修 / 合成 与「删除」同处这一组，卡片内只留预览与片段条 */}
          {kind === 'timeline' && timelineActions && (
            <CanvasTimelineNodeActions
              nodeId={id}
              clipCount={timelineSummary.clips.length}
              composing={timelineActions.composingNodeId === id}
              composeProgress={timelineActions.composeProgress}
              onCompose={timelineActions.onCompose}
              onOpenEditor={timelineActions.onOpenEditor}
            />
          )}
          {showDownloadAction && (
            <button
              type="button"
              className="canvas-node-upload-btn"
              title="下载"
              onClick={(e) => {
                e.stopPropagation()
                handleDownloadMedia()
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
                <path d="M12 4v12" />
                <path d="m6 10 6 6 6-6" />
                <path d="M4 20h16" />
              </svg>
              <span className="canvas-node-upload-btn__label">下载</span>
            </button>
          )}
          <button
            type="button"
            className="canvas-node-upload-btn canvas-node-delete-btn"
            title={`删除${labelMap[kind] || '节点'}`}
            aria-label={`删除${labelMap[kind] || '节点'}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              ;(window as any).__canvasDeleteNode?.(id)
            }}
          >
            <svg
              viewBox="0 0 24 24"
              width="13"
              height="13"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 6h18" />
              <path d="M8 6V4h8v2" />
              <path d="m19 6-1 14H6L5 6" />
              <path d="M10 11v5" />
              <path d="M14 11v5" />
            </svg>
            <span className="canvas-node-upload-btn__label">删除</span>
          </button>
        </div>
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
          ) : structuredText.kind === 'storyboard' ? (
            <div className="canvas-storyboard" aria-label={`分镜脚本，共 ${structuredText.items.length} 个镜头`}>
              <div className="canvas-storyboard__summary">
                <div>
                  <span className="canvas-storyboard__eyebrow">分镜脚本</span>
                  <strong>{structuredText.items.length} 个镜头</strong>
                </div>
                <span className="canvas-storyboard__edit-hint">双击编辑</span>
              </div>
              <div className="canvas-storyboard__list">
                {structuredText.items.map((item, index) => (
                  <article className="canvas-storyboard__item" key={`${item.title}-${index}`}>
                    <span className="canvas-storyboard__index">{String(index + 1).padStart(2, '0')}</span>
                    <div className="canvas-storyboard__content">
                      <div className="canvas-storyboard__title-row">
                        <strong>{item.title}</strong>
                        {(item.duration || item.shot) && (
                          <span className="canvas-storyboard__meta">
                            {[
                              item.shot,
                              item.duration && `${item.duration}${/^\d+(\.\d+)?$/.test(item.duration) ? 's' : ''}`,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        )}
                      </div>
                      <p>{item.prompt}</p>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ) : (
            <div className={`canvas-node-prompt${textContent.trim() ? '' : ' is-placeholder'}`}>
              {structuredText.text || placeholder}
            </div>
          )
        ) : kind === 'video' && mediaUrl ? (
          <div
            /*
             * nopan 不是为了禁止平移，而是为了让双击落在这里时 React Flow 放行：
             * zoomOnDoubleClick 默认开启，画面上的双击会被 d3-zoom 当成「放大一级画布」，
             * 于是放大弹窗打开的同时画布也被拉近。React Flow 的手势过滤只认 nopan 这个类名
             * （见 @xyflow/system createFilter），而 d3 的原生监听在祖先节点上先于 React 合成事件触发，
             * 在这里 stopPropagation 是拦不住的。
             * 代价仅限于「关掉节点拖拽后，从视频画面上拖不动画布」，其余位置照常。
             */
            className="canvas-node-video-wrap nopan"
            onMouseEnter={handleVideoHoverEnter}
            onMouseLeave={handleVideoHoverLeave}
          >
            {/* 悬停自动静音播放、移出暂停；也可点播放按钮手动控制（手动播放不会因移出而暂停） */}
            <video
              ref={videoRef}
              className="canvas-node-media"
              src={videoPlaybackSrc}
              poster={(data as any).poster}
              playsInline
              preload={videoPreload}
              onLoadedMetadata={(event) => {
                const el = event.currentTarget
                setVideoDurationSec(el.duration)
                const clipStart = Math.max(0, Number((data as any).clipInSec) || 0)
                if (Number((data as any).clipOutSec) > clipStart) {
                  try {
                    el.currentTime = Math.min(clipStart, el.duration || clipStart)
                  } catch {
                    /* 元数据尚未完全就绪时由浏览器稍后完成 seek */
                  }
                }
                // 媒体重新拉流（含切到本地整片、被抹回 0 的情况）后把进度补回目标位置
                applyPendingSeek(el)
                if (resumeAfterSwapRef.current) {
                  // 换源前正在播 → 换源后接着播，不让用户重按一次播放
                  resumeAfterSwapRef.current = false
                  el.play().catch(() => setPlaying(false))
                }
              }}
              onSeeked={(event) => {
                // 以元素实际落点为准回填，进度条不谎报位置
                if (!videoScrubbing) setVideoCurrentSec(event.currentTarget.currentTime)
              }}
              onTimeUpdate={(event) => {
                // 拖动过程中以指针位置为准，避免元素回报的旧时间把滑块拽回去
                if (videoScrubbing) return
                const el = event.currentTarget
                const clipStart = Math.max(0, Number((data as any).clipInSec) || 0)
                const clipEnd = Number((data as any).clipOutSec) || 0
                if (clipEnd > clipStart && el.currentTime >= clipEnd - 0.03) {
                  el.pause()
                  try {
                    el.currentTime = clipEnd
                  } catch {
                    /* ignore seek race */
                  }
                  setVideoCurrentSec(clipEnd)
                  return
                }
                setVideoCurrentSec(el.currentTime)
                // 已经播过目标位置说明用户在正常往下看，撤掉补偿，避免下次播放被拉回去
                if (pendingSeekRef.current > 0 && el.currentTime > pendingSeekRef.current + 0.5) {
                  pendingSeekRef.current = 0
                }
              }}
              onSeeking={(event) => {
                const clipStart = Math.max(0, Number((data as any).clipInSec) || 0)
                const clipEnd = Number((data as any).clipOutSec) || 0
                if (clipEnd <= clipStart) return
                const el = event.currentTarget
                if (el.currentTime < clipStart) el.currentTime = clipStart
                if (el.currentTime > clipEnd) el.currentTime = clipEnd
              }}
              onPlay={(event) => {
                applyPendingSeek(event.currentTarget)
                setPlaying(true)
                verifySeekLanded()
              }}
              onPlaying={(event) => applyPendingSeek(event.currentTarget)}
              onPause={() => setPlaying(false)}
              onEnded={() => {
                // 播完后回到自然行为：下次点播放从头开始
                pendingSeekRef.current = 0
                pendingSeekTriesRef.current = 0
                setPlaying(false)
              }}
            />
            {videoDurationLabel ? (
              <div
                className="canvas-node-video-bar nodrag nopan"
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
              >
                <span className="canvas-node-video-time">
                  {formatVideoTimeLabel(videoCurrentSec)} / {videoDurationLabel}
                </span>
                {videoPreparing ? (
                  <span className="canvas-node-video-hint" role="status">
                    缓冲中…
                  </span>
                ) : null}
                <div
                  ref={videoTrackRef}
                  className="canvas-node-video-track"
                  data-scrubbing={videoScrubbing}
                  role="slider"
                  tabIndex={0}
                  aria-label="视频进度"
                  aria-valuemin={0}
                  aria-valuemax={Math.round(videoDurationSec)}
                  aria-valuenow={Math.floor(videoCurrentSec)}
                  aria-valuetext={`${formatVideoTimeLabel(videoCurrentSec)} / ${videoDurationLabel}`}
                  onPointerDown={handleTrackPointerDown}
                  onPointerMove={handleTrackPointerMove}
                  onPointerUp={handleTrackPointerEnd}
                  onPointerCancel={handleTrackPointerEnd}
                  onKeyDown={handleTrackKeyDown}
                >
                  <div className="canvas-node-video-track__fill" style={{ width: `${videoProgressPercent}%` }}>
                    <span className="canvas-node-video-track__thumb" />
                  </div>
                </div>
              </div>
            ) : null}
            {/* 截帧：把某一帧存成图片节点，可直接拿去做图生图。首尾帧是最常用的两张 */}
            {onCaptureFrame ? (
              <div
                className="canvas-node-video-capture-wrap nodrag nopan"
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  className="canvas-node-video-capture"
                  title={capturing ? '正在截帧…' : '截取画面为图片'}
                  aria-label="截帧"
                  aria-expanded={captureMenuOpen}
                  disabled={capturing}
                  onClick={(event) => {
                    event.stopPropagation()
                    setCaptureMenuOpen((open) => !open)
                  }}
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="17"
                    height="17"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M4 7h3l1.5-2h7L17 7h3v12H4z" />
                    <circle cx="12" cy="13" r="3.4" />
                  </svg>
                  <span className="canvas-node-video-capture__label">截帧</span>
                </button>
                {captureMenuOpen ? (
                  <div className="canvas-node-capture-menu" role="menu" aria-label="截帧位置">
                    {CAPTURE_POSITIONS.map((item) => (
                      <button
                        key={item.position}
                        type="button"
                        role="menuitem"
                        onClick={(event) => {
                          event.stopPropagation()
                          setCaptureMenuOpen(false)
                          void (async () => {
                            const frame = await captureVideoFrame(videoRef.current, item.position)
                            if (!frame) {
                              showToast('画面还没准备好，稍后再试', 'info')
                              return
                            }
                            onCaptureFrame(id, frame)
                          })()
                        }}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            <button
              type="button"
              className="canvas-node-video-expand nodrag nopan"
              title="放大查看"
              aria-label="放大查看视频"
              onPointerDown={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                openVideoPreview()
              }}
            >
              <svg
                viewBox="0 0 24 24"
                width="15"
                height="15"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M15 3h6v6" />
                <path d="M9 21H3v-6" />
                <path d="M21 3l-7 7" />
                <path d="M3 21l7-7" />
              </svg>
            </button>
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
        ) : kind === 'image' && mediaUrl ? (
          <img className="canvas-node-media" src={mediaUrl} alt={kind} loading="lazy" />
        ) : kind === 'timeline' ? (
          // 卡片本身就是编辑面：预览 + 片段条 + 添加/合成，常用操作不必先双击进弹窗
          <div className="canvas-node-timeline">
            {timelineActions ? (
              <CanvasTimelineNodeBody
                nodeId={id}
                clips={timelineSummary.clips}
                workspaceId={nodeWorkspaceId}
                composedUrl={mediaUrl}
                pendingSourceCount={timelinePendingSourceCount}
                onRemoveClip={timelineActions.onRemoveClip}
                getAddableSources={timelineActions.getAddableSources}
                onAddSource={timelineActions.onAddClip}
              />
            ) : (
              <CanvasTimelinePlayer clips={timelineSummary.clips} workspaceId={nodeWorkspaceId} compact />
            )}
          </div>
        ) : (
          getTypePlaceholder(kind)
        )}
      </div>

      {uploadingLocalFile && (
        <div className="canvas-node-generation-mask" role="status" aria-live="polite">
          <span className="canvas-node-generation-spinner" aria-hidden="true" />
          <strong>正在上传</strong>
          <span>本地图片上传中，请稍候</span>
        </div>
      )}

      {taskRunning && !uploadingLocalFile && (
        <div className="canvas-node-generation-mask" role="status" aria-live="polite">
          <span className="canvas-node-generation-spinner" aria-hidden="true" />
          <strong>{taskPresentation.title}</strong>
          <span>{taskPresentation.detail}</span>
        </div>
      )}

      {(taskRunning || taskFailed) && (
        <div className={`canvas-node-task${taskFailed ? ' is-failed' : ''}`} role="status">
          <span>{taskFailed ? taskError || '生成失败，请重试' : '正在生成'}</span>
          {taskRunning && taskProgress > 0 ? <strong>{Math.round(taskProgress)}%</strong> : null}
        </div>
      )}

      {/* 放大查看弹窗：portal 到 body，不受画布 transform 影响 */}
      {videoPreviewOpen && kind === 'video' && mediaUrl ? (
        <CanvasVideoPreviewModal
          // 已抓到本地整片时预览也复用它：省一次下载，且弹窗里的原生进度条同样能任意跳转
          src={videoPlaybackSrc}
          poster={(data as any).poster}
          durationLabel={videoDurationLabel}
          startTime={videoCurrentSec}
          info={videoPreviewInfo}
          onClose={() => setVideoPreviewOpen(false)}
        />
      ) : null}

      {/* 所有节点（含首个/画布源头）都保留左右两个连接点：可从左侧被连线、向右连接下游 */}
      <Handle
        id={`${id}-left-target`}
        type="target"
        position={Position.Left}
        onMouseEnter={() => setLeftHovered(true)}
        onMouseLeave={() => setLeftHovered(false)}
      >
        <HandleIcon nodeId={id} side="left" visible={leftVisible} />
      </Handle>

      <Handle
        id={`${id}-right-source`}
        type="source"
        position={Position.Right}
        onMouseEnter={() => setRightHovered(true)}
        onMouseLeave={() => setRightHovered(false)}
      >
        <HandleIcon nodeId={id} side="right" visible={rightVisible} />
      </Handle>
    </div>
  )
}

const nodeTypes: NodeTypes = {
  text: CanvasDefaultNode,
  image: CanvasDefaultNode,
  video: CanvasDefaultNode,
  timeline: CanvasDefaultNode,
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
  const { fitView, screenToFlowPosition, setViewport } = useReactFlow()
  // 正在编辑剪辑时间线的节点 id；空串表示编辑器关闭
  const [timelineEditorNodeId, setTimelineEditorNodeId] = useState('')
  // 合成进行中（下载素材 → 无损拼接 → 上传成片），期间禁止重复触发
  const [timelineComposing, setTimelineComposing] = useState(false)
  // 正在合成的时间线节点 id：卡片按钮据此显示进度，其余节点不受影响
  const [composingNodeId, setComposingNodeId] = useState('')
  // 拖拽视频节点时命中的时间线节点 id，用于高亮「松手就会放进这里」
  const [timelineDropTargetId, setTimelineDropTargetId] = useState('')
  // 拖拽起点：放进时间线后要把视频节点弹回原位
  const dragOriginRef = useRef<{ id: string; position: { x: number; y: number } } | null>(null)
  const [composeProgress, setComposeProgress] = useState('')
  // 已量过时长的片段（node:clip），避免同一条素材被反复探测
  const measuredClipAssetsRef = useRef<Set<string>>(new Set())
  const clipDurationAttemptsRef = useRef<Map<string, number>>(new Map())
  const clipDurationRetryTimersRef = useRef<Set<number>>(new Set())
  const [clipDurationRetryTick, setClipDurationRetryTick] = useState(0)
  // 正在截帧上传的视频节点 id；同一时刻只允许一个，避免连点建出一堆重复图片节点
  const [capturingNodeId, setCapturingNodeId] = useState('')
  const workspaceId = useWorkspaceId()
  // 当前用户：收藏 tab 按用户隔离读取
  const currentUser = useCurrentUser()
  const currentUserId = resolveUserId(currentUser)
  // 模型目录：来自 /api/v1/ai/models
  const { groups, loading: modelsLoading } = useGenerationModelCatalog(workspaceId)
  // 按节点类型提取模型列表；分组键 → 节点类型的映射与「视频必须合并两组」的原因见 canvasModelBuckets。
  const canvasModels = useMemo(() => buildCanvasModelBuckets(groups), [groups])
  // 把模型名共享给节点：节点在 React Flow 内部，拿不到这里的目录，放大预览要显示模型名。
  useEffect(() => {
    const next: Record<number, string> = {}
    for (const list of [canvasModels.text, canvasModels.image, canvasModels.video]) {
      for (const model of list) {
        const versionId = Number(model.modelVersionId || 0)
        if (versionId > 0 && model.displayName) next[versionId] = model.displayName
      }
    }
    canvasModelNameByVersion = next
  }, [canvasModels])
  const [addMenu, setAddMenu] = useState<{ x: number; y: number; sourceId: string } | null>(null)
  // 节点两侧的“+”表示继续当前流程：点击后打开下一步节点类型菜单，
  // 选中类型后复用 handleMenuSelect 自动创建节点并连接当前节点。
  // 工具栏模式开关（独立、初始均开启，按钮默认高亮）：
  // - moveEnabled：画布平移开关（panOnDrag），关闭后画布不能移动
  // - dragEnabled：节点拖拽开关（nodesDraggable），关闭后节点不能拖拽
  const [moveEnabled, setMoveEnabled] = useState(true)
  const [dragEnabled, setDragEnabled] = useState(true)
  const handleMoveToggle = useCallback(() => setMoveEnabled((v) => !v), [])
  const handleDragToggle = useCallback(() => setDragEnabled((v) => !v), [])
  const [selectedNode, setSelectedNode] = useState<CanvasNodeInfo | null>(null)
  const [saveStatus, setSaveStatus] = useState<DraftSaveStatus>('saved')
  /**
   * 供轮询循环读取的保存状态。
   *
   * saveStatus 每次编辑都会走 dirty → saving → saved 三态；若把它放进同步 effect 的依赖数组，
   * 整个循环会被反复销毁重建、每次都从最短间隔重新起步——编辑越频繁，轮询反而越密。
   */
  const saveStatusRef = useRef<DraftSaveStatus>('saved')
  saveStatusRef.current = saveStatus
  const [cloudStatus, setCloudStatus] = useState<'loading' | 'online' | 'offline' | 'error'>('loading')
  const [cloudMessage, setCloudMessage] = useState('正在读取云端画布')
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
  // 本地图片导入：隐藏的多选 file input，供工具栏 / 右键菜单「本地图片」触发
  const localImageInputRef = useRef<HTMLInputElement>(null)
  // 选择文件前记录的落点（视口坐标）：右键菜单从菜单位置落点，工具栏落在视口中心
  const localImageAnchorRef = useRef<{ x: number; y: number } | null>(null)
  // 是否有文件正拖到画布上方（显示拖放提示遮罩）
  const [fileDragActive, setFileDragActive] = useState(false)
  // dragenter/dragleave 会随子元素冒泡反复触发，用计数抵消，避免提示闪烁
  const fileDragDepthRef = useRef(0)
  // 最近一次鼠标位置（视口坐标）：粘贴图片时作为落点
  const pointerRef = useRef<{ x: number; y: number } | null>(null)
  // 撤销/重做历史栈：存储 nodes/edges + 文本内容快照
  const historyRef = useRef<{ undo: CanvasHistorySnapshot[]; redo: CanvasHistorySnapshot[] }>({
    undo: [],
    redo: [],
  })
  const cancelledTasksRef = useRef(new Map<string, CanvasGenerationRequest>())
  const restartGenerationRef = useRef<(nodeId: string, request: CanvasGenerationRequest) => void>(() => undefined)
  // 能否撤销/重做的状态（ref 变化不触发渲染，需显式同步）
  const [historyFlags, setHistoryFlags] = useState({ canUndo: false, canRedo: false })
  // 最新 nodes/edges 引用：供历史快照在任何回调里读取当前状态
  const latestRef = useRef<{ nodes: Node[]; edges: Edge[] }>({ nodes: [], edges: [] })
  latestRef.current = { nodes, edges }
  useEffect(() => {
    ;(window as any).__canvasOpenNextStep = (sourceId: string, clientX: number, clientY: number) => {
      if (!latestRef.current.nodes.some((node) => node.id === sourceId)) return
      setContextMenu(null)
      setAddMenu({ x: clientX, y: clientY, sourceId })
    }
    return () => {
      delete (window as any).__canvasOpenNextStep
    }
  }, [])
  const transform = useStore((s) => s.transform)

  // 编辑面板尺寸：算锚点要用它做居中与边界夹取，面板内容随节点类型变化，用 ResizeObserver 跟踪。
  const panelRef = useRef<HTMLDivElement>(null)
  const [panelSize, setPanelSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const el = panelRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      setPanelSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [selectedNode?.id])

  /**
   * 选中节点下方的面板位置（视口坐标）。
   *
   * 节点位置是画布坐标，必须经 transform 换算成屏幕坐标，面板才会跟着缩放/平移一起动 ——
   * 面板是 position: fixed，渲染在画布容器之外，直接用画布坐标会跑偏。
   * 下方放不下就翻到节点上方；左右做夹取，保证面板始终完整可见。
   */
  const panelAnchor = useMemo(() => {
    if (!selectedNode) return null
    const node = nodes.find((item) => item.id === selectedNode.id)
    if (!node) return null
    const [tx, ty, tz] = transform
    const style = (node.style || {}) as Record<string, unknown>
    const nodeWidth = Number(node.measured?.width ?? style.width ?? 250) || 250
    const nodeHeight = Number(node.measured?.height ?? style.height ?? 250) || 250
    const centerX = (node.position.x + nodeWidth / 2) * tz + tx
    const bottomY = (node.position.y + nodeHeight) * tz + ty
    const topY = node.position.y * tz + ty

    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const halfWidth = (panelSize.width || 0) / 2
    const height = panelSize.height || 0
    const below = bottomY + NODE_PANEL_GAP
    const above = topY - NODE_PANEL_GAP - height
    const fitsBelow = below + height + NODE_PANEL_GAP <= viewportHeight
    const fitsAbove = above >= NODE_PANEL_GAP

    /*
     * 纵向只在选定的那一侧取值，绝不做「拉回视口内」的夹取。
     *
     * 之前那一版把 top 夹到 [GAP, viewportHeight - height - GAP]：面板一旦比节点下方的
     * 空间还高，夹取就把它往上拽，正好压在它自己正在编辑的那个节点上——用户看不见刚生成的东西。
     * 现在放不下就让它先溢出视口，由下面的「腾位置」副作用平移画布来解决，而不是牺牲节点。
     */
    const top = fitsBelow || !fitsAbove ? below : above

    // 左界为工具栏让出竖带；面板宽到放不下时右界优先，此时仍会压住工具栏（窄屏遗留限制）
    const minCenterX = halfWidth + NODE_PANEL_LEFT_SAFE
    const maxCenterX = viewportWidth - halfWidth - NODE_PANEL_GAP
    return {
      left: Math.min(Math.max(centerX, minCenterX), Math.max(minCenterX, maxCenterX)),
      top,
    }
  }, [selectedNode, nodes, transform, panelSize.width, panelSize.height])

  /**
   * 面板在节点下方放不下时，把画布上移腾出位置。
   *
   * 不能靠夹取把面板拉回视口——那等于用「盖住正在编辑的节点」换「面板完整可见」，
   * 而节点上正是刚生成的结果，挡住它比面板露出视口更糟。
   * 平移量不会超过节点到视口顶部的距离，保证节点本身始终留在画面里。
   *
   * 每个 (节点, 面板高度) 只调整一次：transform 变化会让本副作用重跑，
   * 不设这个闸门就会出现「平移 → 重算 → 再平移」的自激。
   */
  const panelPanRef = useRef('')
  useEffect(() => {
    const height = panelSize.height
    if (!selectedNode || !(height > 0)) return
    const key = `${selectedNode.id}:${Math.round(height)}`
    if (panelPanRef.current === key) return
    panelPanRef.current = key

    const node = latestRef.current.nodes.find((item) => item.id === selectedNode.id)
    if (!node) return
    const [tx, ty, tz] = transform
    const style = (node.style || {}) as Record<string, unknown>
    const nodeHeight = Number(node.measured?.height ?? style.height ?? 250) || 250
    const bottomY = (node.position.y + nodeHeight) * tz + ty
    const topY = node.position.y * tz + ty

    const deficit = bottomY + NODE_PANEL_GAP * 2 + height - window.innerHeight
    if (deficit <= 0) return
    // 节点顶部到视口顶的余量就是可平移的上限，再多节点自己就被推出去了
    const shift = Math.min(deficit, Math.max(0, topY - NODE_PANEL_GAP))
    if (shift <= 1) return
    setViewport({ x: tx, y: ty - shift, zoom: tz }, { duration: 200 })
  }, [selectedNode, panelSize.height, transform, setViewport])

  // 记住最后选中的节点：退出画布再进来时恢复选中态与编辑面板（含输入框内容）。
  useEffect(() => {
    saveLastSelectedNodeId(routeProjectId, selectedNode?.id || '')
  }, [routeProjectId, selectedNode?.id])

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
      return collectCanvasSourceRefs(nodeId, nodes, edges)
    },
    [edges, nodes],
  )

  // 点击节点时使用去重后的 sourceRefs
  const getSourceRefs = useCallback((nodeId: string): CanvasSourceRef[] => deriveSourceRefs(nodeId), [deriveSourceRefs])

  /**
   * 文本内容的版本号，用来把「文本节点被改了」这件事传导给编辑面板。
   *
   * 文本内容刻意不走 nodes/edges（每敲一个字都 setNodes 会让整块画布重渲染），而是存在
   * window.__canvasTextContents 这个可变 Map 里——代价是它不是响应式的，下游读了也不会重渲染。
   * 所以这里用一个计数器做信号：改文本时 bump 一次，依赖它的 memo 重新从 Map 取值。
   * bump 走 60ms 防抖，连续打字不会一个字一次重渲染。
   */
  const [textRevision, setTextRevision] = useState(0)
  const textRevisionTimerRef = useRef(0)
  const bumpTextRevisionRef = useRef<() => void>(() => undefined)
  bumpTextRevisionRef.current = () => {
    window.clearTimeout(textRevisionTimerRef.current)
    textRevisionTimerRef.current = window.setTimeout(() => setTextRevision((value) => value + 1), 60)
  }
  useEffect(() => () => window.clearTimeout(textRevisionTimerRef.current), [])

  /**
   * 选中节点从上游文本节点继承来的提示词内容。
   *
   * 之所以要把它交给面板显示：这段文本本来就会在提交时被前置进 prompt，但界面上一点痕迹都没有，
   * 用户看到输入框还是空的，只会认为「文本没跟过去」。面板拿到同一份数据既用于显示也用于拼接，
   * 显示的和发出去的就必然是同一个东西。
   */
  const inheritedPromptTexts = useMemo(() => {
    const map = (window as any).__canvasTextContents as Map<string, string> | undefined
    return (selectedNode?.sourceRefs || [])
      .filter((ref) => ref.kind === 'text')
      .map((ref) => ({
        sourceId: ref.sourceId,
        edgeId: ref.edgeId,
        text: String(map?.get(ref.sourceId) || '').trim(),
      }))
      .filter((item) => item.text)
    // textRevision 不出现在函数体里，但它正是「Map 变了」的唯一信号，必须留在依赖里
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNode?.sourceRefs, textRevision])

  /**
   * 首次载入节点后恢复上次选中的节点，连同编辑面板与输入框内容一起回到用户离开时的样子。
   *
   * 只做一次：之后用户主动取消选中是明确意图，不能被这里再选回来。
   * 记录可能指向已被删除的节点，找不到就跳过。
   */
  const selectionRestoredRef = useRef(false)
  useEffect(() => {
    if (selectionRestoredRef.current || !nodes.length) return
    selectionRestoredRef.current = true
    const savedId = loadLastSelectedNodeId(routeProjectId)
    if (!savedId) return
    const node = nodes.find((item) => item.id === savedId)
    if (!node) return
    setSelectedNode({
      id: node.id,
      kind: String((node.data as any)?.kind || node.type || 'text'),
      sourceRefs: getSourceRefs(node.id),
      ratio: (node.data as any)?.ratio,
      videoMode: (node.data as any)?.videoMode,
      modelVersionId: (node.data as any)?.modelVersionId,
      resultUrl: (node.data as any)?.resultUrl,
      assetId: (node.data as any)?.assetId,
      text: (node.data as any)?.text,
      prompt: (node.data as any)?.prompt,
      operationCode: (node.data as any)?.operationCode,
      params: (node.data as any)?.params,
      taskId: (node.data as any)?.taskId,
      taskStatus: (node.data as any)?.taskStatus,
      taskProgress: (node.data as any)?.taskProgress,
      taskError: (node.data as any)?.taskError,
      generationIntent: (node.data as any)?.generationIntent,
    })
  }, [nodes, routeProjectId, getSourceRefs])

  const realHistoryItems = useMemo<HistoryItem[]>(() => {
    let imageIndex = 0
    let videoIndex = 0
    return nodes.flatMap((node) => {
      const kind = String((node.data as any)?.kind || node.type || '')
      if (kind !== 'image' && kind !== 'video') return []
      const src = resolveNodeMediaUrl(node.data as Record<string, unknown>, workspaceId)
      if (!src) return []
      const sequence = kind === 'image' ? ++imageIndex : ++videoIndex
      return [
        {
          id: `canvas-history-${node.id}`,
          nodeId: node.id,
          title: String((node.data as any)?.title || `${kind === 'image' ? '图片' : '视频'} ${sequence}`),
          type: kind,
          src,
          ...(kind === 'video' ? { poster: String((node.data as any)?.poster || '') } : {}),
        } as HistoryItem,
      ]
    })
  }, [nodes, workspaceId])

  /**
   * 参考选择：目标节点种类对应的允许来源种类。
   *
   * 图片节点同时接受文本与图片来源：接入图片即为「图生图」，面板会把 operation 切到
   * image.image_to_image，该图以 role=reference_image 进入 input_assets。
   * 图片节点不接受视频来源——后端图片 operation 没有以视频为参考的契约。
   */
  const allowedSourceKinds: Record<string, string[]> = {
    // 合成后的时间线节点自身就是一条视频素材，可以继续作为下游节点的输入
    video: ['image', 'video', 'timeline'],
    image: ['text', 'image'],
    text: ['text', 'image', 'video', 'timeline'],
    // 剪辑时间线只接视频：连进来的每条视频自动成为一个片段
    timeline: ['video', 'timeline'],
  }

  /** 校验连线是否合法：重复（基于最新状态）、类型匹配、数量上限。返回错误信息，合法返回 null */
  const validateConnection = useCallback(
    (sourceId: string, targetId: string): string | null => {
      if (hasEdgeBetween(sourceId, targetId)) return '已存在相同连线'
      const targetNode = latestRef.current.nodes.find((n) => n.id === targetId)
      const targetKind = (targetNode?.data?.kind as string) || 'text'
      const sourceKind = (latestRef.current.nodes.find((n) => n.id === sourceId)?.data?.kind as string) || 'text'
      const allowed = allowedSourceKinds[targetKind] || []
      if (!allowed.includes(sourceKind)) return '该节点类型不能作为此节点的参考来源'
      // 数量上限只统计素材类来源（图片/视频）；文本来源不计入（其内容拼入 prompt，可无限连接）。
      // 血缘边（截帧图 ← 源视频）同样不计入：它不参与生成，占掉参考名额纯属误伤
      const existingRefs = latestRef.current.edges.filter((e) => {
        if (e.target !== targetId) return false
        if (isCanvasProvenanceEdge(e)) return false
        const src = latestRef.current.nodes.find((n) => n.id === e.source)
        return (src?.data?.kind as string) !== 'text'
      }).length
      // 视频节点：全能参考最多 5 个素材参考（与面板顶部 5 槽一致）；首尾帧模式 2 个（首帧+尾帧）
      // 其他节点：最多 5 个素材来源（与对话框缩略图最多显示 5 个一致）
      const maxRefs =
        targetKind === 'timeline'
          ? MAX_TIMELINE_CLIPS
          : targetKind === 'video'
            ? (targetNode?.data?.videoMode as string) === 'first-last'
              ? 2
              : 5
            : 5
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
  // 素材库/历史记录入口统一通过左侧工具栏打开。
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
    const restoredNodes = prev.nodes.map((node) => {
      if (!cancelledTasksRef.current.has(node.id)) return node
      return {
        ...node,
        data: {
          ...node.data,
          taskId: undefined,
          taskStatus: '',
          taskProgress: 0,
          taskError: '',
          resultSyncAttempts: 0,
        },
      }
    })
    const generationsToRestart = restoredNodes
      .map((node) => ({ nodeId: node.id, request: cancelledTasksRef.current.get(node.id) }))
      .filter((item): item is { nodeId: string; request: CanvasGenerationRequest } => Boolean(item.request))
    generationsToRestart.forEach(({ nodeId }) => cancelledTasksRef.current.delete(nodeId))
    setNodes(restoredNodes as Node[])
    setEdges(prev.edges as Edge[])
    // 同步恢复文本内容，保证文本节点与结构状态一致
    restoreTextContents(prev.textContents)
    setSelectedNode(null)
    setSaveStatus('dirty')
    setContextMenu(null)
    setHistoryFlags({ canUndo: undoStack.length > 0, canRedo: true })
    generationsToRestart.forEach(({ nodeId, request }) => {
      window.setTimeout(() => restartGenerationRef.current(nodeId, request), 0)
    })
  }, [setNodes, setEdges])

  const confirmAndCancelGeneratingVideos = useCallback(
    async (nodesToDelete: Node[]): Promise<boolean> => {
      const generatingVideos = nodesToDelete.filter(isGeneratingVideoNode)
      if (!generatingVideos.length) return true

      const confirmed = await requestConfirm('当前视频正在生成，是否删除？删除后将停止本次生成。', {
        title: '删除生成中的视频',
        confirmLabel: '删除并停止生成',
        cancelLabel: '暂不删除',
        danger: true,
      })
      if (!confirmed) return false

      // 任务还没拿到 task_id：此刻删掉节点会留下一个无人认领的付费任务，只能等提交完成。
      if (generatingVideos.some((node) => Number((node.data as any)?.taskId || 0) <= 0)) {
        showToast('视频任务正在提交，请稍后再删除', 'info')
        return false
      }

      // 逐个取消，互不影响：用 Promise.all 时一个失败会让其余已成功的任务漏记 cancelledTasksRef。
      const results = await Promise.allSettled(
        generatingVideos.map(async (node) => {
          const taskId = Number((node.data as any)?.taskId || 0)
          await cancelAiTask({ workspaceId, taskId })
          const request = (node.data as any)?.generationRequest as CanvasGenerationRequest | undefined
          if (request) cancelledTasksRef.current.set(node.id, request)
        }),
      )

      const failed = results.filter((result) => result.status === 'rejected')
      if (!failed.length) return true

      // 取消失败不代表用户不能删这个节点：任务可能已经交给模型、或刚好已经跑完，
      // 后端拒绝取消是正常的。这时把选择权交回用户，并如实说明后果，而不是把节点扣在画布上。
      const reason = String((failed[0] as PromiseRejectedResult).reason?.message || '').trim()
      return Boolean(
        await requestConfirm(
          `有 ${failed.length} 个视频任务未能停止${reason ? `（${reason}）` : ''}。仍要从画布删除吗？` +
            '删除后这些任务可能继续在服务端执行并照常计费。',
          {
            title: '任务未能停止',
            confirmLabel: '仍然删除',
            cancelLabel: '保留节点',
            danger: true,
          },
        ),
      )
    },
    [workspaceId],
  )

  const handleBeforeDelete = useCallback(
    async ({ nodes: nodesToDelete }: { nodes: Node[]; edges: Edge[] }) =>
      confirmAndCancelGeneratingVideos(nodesToDelete),
    [confirmAndCancelGeneratingVideos],
  )

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

  /**
   * 节点顶部删除按钮入口。
   * React Flow 的 onNodesDelete 只会在其内部删除动作后触发；按钮删除是受控状态更新，
   * 因此在这里完整处理节点、连线、文本缓存和编辑态，并保留一次可撤销快照。
   */
  const deleteNodeById = useCallback(
    async (nodeId: string) => {
      const node = latestRef.current.nodes.find((candidate) => candidate.id === nodeId)
      if (!node) return
      if (!(await confirmAndCancelGeneratingVideos([node]))) return

      commitHistory()
      setNodes((current) => current.filter((candidate) => candidate.id !== nodeId))
      setEdges((current) => current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId))

      const textMap = (window as any).__canvasTextContents as Map<string, string> | undefined
      textMap?.delete(nodeId)
      setSelectedNode((current) => (current?.id === nodeId ? null : current))
      setAddMenu((current) => (current?.sourceId === nodeId ? null : current))
      if (pickingTargetId === nodeId) {
        setPickingTargetId(null)
        setPickingSlotIndex(null)
        setIsPickingRef(false)
        setPickError('')
      }
      setSaveStatus('dirty')
    },
    [commitHistory, confirmAndCancelGeneratingVideos, pickingTargetId, setEdges, setNodes],
  )

  useEffect(() => {
    ;(window as any).__canvasDeleteNode = deleteNodeById
    return () => {
      delete (window as any).__canvasDeleteNode
    }
  }, [deleteNodeById])

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

  /**
   * 把继承来的文本落成本节点自己的提示词，并断开这些文本连线。
   *
   * 「继承」和「自己的副本」只能有一个：留着连线又把内容复制进输入框，同一段文字会被拼两遍，
   * 而且之后改文本节点，用户会困惑于「为什么改了没生效」。所以这里是一次性的转移动作。
   * 全程只提交一次历史，撤销能一步回到继承状态。
   */
  const handleAdoptInheritedText = useCallback(() => {
    const targetNodeId = selectedNode?.id
    if (!targetNodeId) return
    const inherited = inheritedPromptTexts
    if (!inherited.length) return
    const droppedEdgeIds = new Set(inherited.map((item) => item.edgeId))
    const currentPrompt = String(
      (latestRef.current.nodes.find((node) => node.id === targetNodeId)?.data as Record<string, unknown> | undefined)
        ?.prompt || '',
    )
    const merged = [...inherited.map((item) => item.text), currentPrompt.trim()].filter(Boolean).join('\n\n')

    commitHistory()
    setEdges((items) => items.filter((edge) => !droppedEdgeIds.has(edge.id)))
    setNodes((items) =>
      items.map((item) => (item.id === targetNodeId ? { ...item, data: { ...item.data, prompt: merged } } : item)),
    )
    setSelectedNode((current) =>
      current?.id === targetNodeId
        ? {
            ...current,
            prompt: merged,
            sourceRefs: (current.sourceRefs || []).filter((ref) => !droppedEdgeIds.has(ref.edgeId)),
          }
        : current,
    )
    setSaveStatus('dirty')
  }, [selectedNode?.id, inheritedPromptTexts, commitHistory, setEdges, setNodes, setSaveStatus])

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
      // 创建连线（带 slotIndex）；显式生成短 id，避免 React Flow 自动 id 超过后端 128 bytes 上限
      const newEdgeId = buildEdgeId(sourceNode.id, pickingTargetId, slotIndex)
      const newEdge: Edge = {
        id: newEdgeId,
        source: sourceNode.id,
        sourceHandle: null,
        target: pickingTargetId,
        targetHandle: null,
        data: {
          slotIndex,
          role: inferCanvasConnectionRole({
            targetKind: String(latestRef.current.nodes.find((n) => n.id === pickingTargetId)?.data?.kind || 'text'),
            sourceKind,
            videoMode: String(latestRef.current.nodes.find((n) => n.id === pickingTargetId)?.data?.videoMode || 'auto'),
            slotIndex,
          }),
        },
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
          // 视频来源单独带封面：mp4 地址当图片渲染只会得到碎图
          ...((sourceNode.data as any)?.poster ? { posterUrl: (sourceNode.data as any).poster as string } : {}),
          // 来源节点有素材 asset_id 时带上，供组装 input_assets
          ...(Number((sourceNode.data as any)?.assetId) > 0
            ? { assetId: Number((sourceNode.data as any).assetId) }
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
      // 显式传短 id：React Flow addEdge 自动生成的 id（xy-edge__…）会把 node id 拼接 4 次，
      // 超过后端 element_id 128 bytes 上限，导致保存失败
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            id: buildEdgeId(connection.source, connection.target, slotIndex),
            data: {
              slotIndex,
              role: inferCanvasConnectionRole({
                targetKind: String(
                  latestRef.current.nodes.find((n) => n.id === connection.target)?.data?.kind || 'text',
                ),
                sourceKind: String(
                  latestRef.current.nodes.find((n) => n.id === connection.source)?.data?.kind || 'text',
                ),
                videoMode: String(
                  latestRef.current.nodes.find((n) => n.id === connection.target)?.data?.videoMode || 'auto',
                ),
                slotIndex,
              }),
            },
          },
          eds,
        ),
      )
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

        // 目标节点左侧 target handle 中心（节点外 30px）
        const leftCX = rect.left - 30 * tz
        // 目标节点右侧 source handle 中心（节点外 30px）
        const rightCX = rect.right + 30 * tz

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
          // 显式传短 id（同 onConnect）：避免 React Flow 自动 id 超长
          setEdges((eds) =>
            addEdge(
              {
                id: buildEdgeId(sourceId, node.id, slotIndex),
                source: sourceId,
                sourceHandle: connectionState.fromHandle?.id || null,
                target: node.id,
                targetHandle,
                data: {
                  slotIndex,
                  role: inferCanvasConnectionRole({
                    targetKind: String(node.data?.kind || 'text'),
                    sourceKind: String(
                      latestRef.current.nodes.find((item) => item.id === sourceId)?.data?.kind || 'text',
                    ),
                    videoMode: String(node.data?.videoMode || 'auto'),
                    slotIndex,
                  }),
                },
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

  /**
   * 新节点的默认比例：沿用画布上「上一个同类节点」的选择。
   *
   * 连着做几个节点时比例通常一致，每次重选是纯重复劳动。从现有节点推导而不是记在内存里，
   * 刷新页面或换标签页继续编辑时继承关系依然成立。文本节点没有比例概念，返回 undefined。
   */
  const inheritNodeRatio = useCallback((type: string): string | undefined => {
    if (type !== 'video' && type !== 'image') return undefined
    const fallback = type === 'video' ? AUTO_RATIO : '1:1'
    return resolveInheritedNodeRatio(latestRef.current.nodes, type, fallback)
  }, [])

  // 统一创建新节点：默认选中 + 渐入动画；动画结束后移除动画类，避免草稿恢复/重进页面时重复播放
  const appendNewNode = useCallback(
    (
      type: string,
      position: { x: number; y: number },
      options?: {
        ratio?: string
        extraData?: Record<string, unknown>
        /** 显式节点尺寸（本地图片按原图比例创建时使用），缺省按类型取默认值 */
        size?: { width: number; height: number }
        /** 跳过历史快照：批量创建（一次导入多张图片）时由调用方先统一记录一次，撤销才是一步到位 */
        skipHistory?: boolean
      },
    ) => {
      // 结构变更前记录历史，供撤销使用
      if (!options?.skipHistory) commitHistory()
      const nodeW = options?.size?.width || (type === 'video' ? 444 : 250)
      const nodeH = options?.size?.height || (type === 'video' ? 250 : 250)
      const id = createNodeId(type)
      const ratio = options?.ratio
      const newNode: Node = {
        id,
        type,
        position,
        data: {
          kind: type,
          ratio,
          videoMode: type === 'video' ? 'auto' : undefined,
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
        videoMode: type === 'video' ? 'auto' : undefined,
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
        { ratio: inheritNodeRatio(type) },
      )
      // 自动连线：拖线源节点 → 新节点（来源限制已在菜单项过滤时校验，新节点参考数不会超限）
      const sourceNode = latestRef.current.nodes.find((n) => n.id === addMenu.sourceId)
      if (newNodeId && sourceNode) {
        setEdges((eds) => [
          ...eds,
          {
            id: buildEdgeId(addMenu.sourceId, newNodeId, 0),
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
    [addMenu, transform, appendNewNode, setEdges, inheritNodeRatio],
  )

  // edges 变化时同步 selectedNode.sourceRefs（用去重派生，兜底清理历史重复边）
  useEffect(() => {
    if (!selectedNode) return
    const refs: CanvasSourceRef[] = deriveSourceRefs(selectedNode.id)
    const prevRefs = selectedNode.sourceRefs || []
    // 对比必须包含 thumbnailUrl：来源节点素材变化时（应用新素材）缩略图也要同步更新
    if (
      JSON.stringify(
        prevRefs.map((r) => ({ k: r.kind, e: r.edgeId, s: r.slotIndex, t: r.thumbnailUrl || '', a: r.assetId || 0 })),
      ) !==
      JSON.stringify(
        refs.map((r) => ({ k: r.kind, e: r.edgeId, s: r.slotIndex, t: r.thumbnailUrl || '', a: r.assetId || 0 })),
      )
    ) {
      setSelectedNode((prev) => (prev ? { ...prev, sourceRefs: refs } : prev))
    }
  }, [selectedNode, deriveSourceRefs])

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
  const syncRetryTimerRef = useRef<number | null>(null)
  const syncRetryAttemptRef = useRef(0)

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
          setCloudStatus('online')
          setCloudMessage('已同步到云端')
          syncRetryAttemptRef.current = 0
          if (syncRetryTimerRef.current) {
            window.clearTimeout(syncRetryTimerRef.current)
            syncRetryTimerRef.current = null
          }
        } catch (error: any) {
          const isConflict = Number(error?.status || error?.response?.status || 0) === 409
          // 只有乐观锁冲突才拉远端合并。网络/服务异常直接进入退避重试，避免制造额外请求。
          try {
            if (!isConflict) throw error
            const page = await fetchAllCanvasElements({ workspaceId, canvasId, afterRevision: 0 })
            syncRevisionRef.current = page.sync_revision || syncRevisionRef.current
            const { nodes: remoteNodes, edges: remoteEdges } = elementsToGraph(page.elements || [])
            // 三方合并：以最新远端为底，只重放本次真正发生的本地 mutation。
            // 这样既不会删除其他成员刚新增的元素，也不会丢掉本地刚创建的节点。
            const merged = applyCanvasElementMutations(
              { nodes: remoteNodes.map((node) => normalizeNodeMedia(node, workspaceId)), edges: remoteEdges },
              mutations,
            )
            restoreTextContents(
              Object.fromEntries(
                merged.nodes
                  .map((node) => [node.id, String((node.data as any)?.text || '')])
                  .filter(([, text]) => Boolean(text)),
              ),
            )
            const result = await saveCanvasElementsBatched({
              workspaceId,
              canvasId,
              baseRevision: syncRevisionRef.current,
              mutations,
            })
            syncRevisionRef.current = result.sync_revision
            setNodes(merged.nodes)
            setEdges(merged.edges)
            latestRef.current = merged
            const mergedTextMap = (window as any).__canvasTextContents as Map<string, string> | undefined
            syncRef.current = {
              nodes: merged.nodes.map((node) => comparableNode(node, mergedTextMap)),
              edges: merged.edges.map(comparableEdge),
            }
            setSaveStatus('saved')
            setCloudStatus('online')
            setCloudMessage('冲突已合并并同步')
            syncRetryAttemptRef.current = 0
            if (syncRetryTimerRef.current) {
              window.clearTimeout(syncRetryTimerRef.current)
              syncRetryTimerRef.current = null
            }
          } catch {
            // 仍失败：保留 dirty 状态并真正安排退避重试；本地草稿继续兜底。
            setSaveStatus('dirty')
            setCloudStatus(navigator.onLine ? 'error' : 'offline')
            setCloudMessage(navigator.onLine ? '云端同步失败，将自动重试' : '网络已断开，内容已保存在本机')
            if (!syncRetryTimerRef.current) {
              const delay = navigator.onLine
                ? Math.min(30000, 1500 * 2 ** Math.min(syncRetryAttemptRef.current++, 4))
                : 3000
              syncRetryTimerRef.current = window.setTimeout(() => {
                syncRetryTimerRef.current = null
                scheduleSyncRef.current(true)
              }, delay)
            }
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
  }, [setEdges, setNodes, workspaceId])
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
        const restoredNodes = (draft.nodes as Node[]).map((n) => {
          const cleaned = String(n.className || '').includes('is-node-entering') ? { ...n, className: undefined } : n
          // 旧草稿可能存了会话级 blob: 地址：有 assetId 时重建为持久同源地址
          return normalizeNodeMedia(cleaned, workspaceId)
        })
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
        // 1) 全量加载元素；只有全部分页成功后才推进 revision，避免大画布被截断。
        const page = await fetchAllCanvasElements({ workspaceId, canvasId, afterRevision: 0 })
        syncRevisionRef.current = page.sync_revision || syncRevisionRef.current
        const { nodes: rawCloudNodes, edges: cloudEdges } = elementsToGraph(page.elements)
        // 旧数据可能存了会话级 blob: 地址：有 assetId 时重建为持久同源地址，避免刷新后破图
        const cloudNodes = rawCloudNodes.map((n) => normalizeNodeMedia(n, workspaceId))
        if (cloudNodes.length > 0 || cloudEdges.length > 0) {
          setNodes(cloudNodes)
          setEdges(cloudEdges)
          // 还原文本内容：云端节点 data 中的 text 字段写回全局 Map（渲染期由节点组件读取）
          restoreTextContents(
            Object.fromEntries(
              cloudNodes
                .map((node) => [node.id, String((node.data as any)?.text || '')])
                .filter(([, text]) => Boolean(text)),
            ),
          )
          const map = (window as any).__canvasTextContents as Map<string, string>
          // 建立已同步快照：云加载的内容视为已同步，避免首次渲染被 diff 误判为「删除」
          syncRef.current = {
            nodes: cloudNodes.map((n) => comparableNode(n, map)),
            edges: cloudEdges.map((e) => comparableEdge(e)),
          }
          cloudLoadedRef.current = true
          setCloudStatus('online')
          setCloudMessage('已连接云端')
          fitCanvasView()
        } else {
          // 云端空画布：仅当本地草稿绑定当前画布时才恢复并上传（保证画布唯一，防止把其他画布内容复制进来）
          const draft = loadCanvasDraft(routeProjectId)
          const draftBoundId = readDraftBoundCanvasId(routeProjectId)
          if (draft && draft.nodes.length > 0 && draftBoundId === canvasId) {
            const restoredNodes = (draft.nodes as Node[]).map((n) => {
              const cleaned = String(n.className || '').includes('is-node-entering')
                ? { ...n, className: undefined }
                : n
              // 旧草稿可能存了会话级 blob: 地址：有 assetId 时重建为持久同源地址
              return normalizeNodeMedia(cleaned, workspaceId)
            })
            setNodes(restoredNodes)
            setEdges(draft.edges as Edge[])
            if (draft.textContents) {
              if (!(window as any).__canvasTextContents) (window as any).__canvasTextContents = new Map()
              const map = (window as any).__canvasTextContents as Map<string, string>
              Object.entries(draft.textContents).forEach(([k, v]) => map.set(k, v))
            }
            // 云加载完成后，把本地草稿内容推送到云端（云端当前为空，diff 会全量 upsert）
            cloudLoadedRef.current = true
            setCloudStatus('online')
            setCloudMessage('已连接云端')
            syncRef.current = { nodes: [], edges: [] }
            scheduleSyncRef.current(true)
          } else {
            // 草稿不匹配当前画布（或为空）：不恢复不上传，云端以空画布呈现，保证画布内容唯一。
            // 新画布保持完全空白，不自动创建或选中任何节点。
            // 用户可通过左侧工具栏自行添加文本、图片或视频；已有画布仍按上方逻辑恢复云端/本地内容。
            setNodes([])
            setEdges([])
            setSelectedNode(null)
            cloudLoadedRef.current = true
            setCloudStatus('online')
            setCloudMessage('已连接云端')
            syncRef.current = { nodes: [], edges: [] }
          }
          fitCanvasView()
        }
      } catch (error: any) {
        // 云端不可用时静默回退本地草稿，保证画布可用
        cloudErrorRef.current = String(error?.message || '云端画布加载失败')
        setCloudStatus(navigator.onLine ? 'error' : 'offline')
        setCloudMessage(navigator.onLine ? '云端读取失败，当前使用本机草稿' : '网络已断开，当前使用本机草稿')
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
      bumpTextRevisionRef.current()
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

  // 切到后台时浏览器通常仍允许普通请求完成，比 unload 阶段才提交可靠得多。
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden) flushOnUnload()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [flushOnUnload])

  useEffect(() => {
    return () => {
      if (syncRetryTimerRef.current) window.clearTimeout(syncRetryTimerRef.current)
    }
  }, [])

  // 定时拉取服务端 revision 后的增量，保证同一画布在其他标签页/成员修改后能自动合并。
  // 本地存在未保存变更时暂缓应用远端，先让保存队列完成，避免覆盖用户正在编辑的内容。
  useEffect(() => {
    let disposed = false
    let timer = 0
    // 连续拉到空增量的轮次：画布闲置时逐步拉长间隔，一有变化立刻回到基础频率。
    // 上限刻意压在 10 秒（而不是 30 秒）：这条循环同时承担多人协作的变更合并，
    // 退避过久会让「别人改了我这边多久能看到」变得难以接受。
    let idleRounds = 0
    const BASE_DELAY = 4000
    const MAX_IDLE_DELAY = 10000
    const nextIdleDelay = () => Math.min(MAX_IDLE_DELAY, BASE_DELAY * Math.pow(1.5, Math.min(idleRounds, 4)))
    const schedule = (delay = nextIdleDelay()) => {
      if (!disposed) timer = window.setTimeout(pullRemoteChanges, delay)
    }
    const pullRemoteChanges = async () => {
      const canvasId = canvasIdRef.current
      if (!canvasId || !cloudLoadedRef.current || document.hidden) return schedule()
      if (!navigator.onLine) {
        setCloudStatus('offline')
        setCloudMessage('网络已断开，内容已保存在本机')
        return schedule(3000)
      }
      // 保存失败留下 dirty 状态时，主动重新驱动保存，不能只等待状态自行变化。
      if (!syncInFlightRef.current && !syncPendingRef.current && saveStatusRef.current !== 'saved') {
        pushCanvasMutations()
        idleRounds = 0
        return schedule(1500)
      }
      // 本地有未落盘的改动：先让保存队列跑完，短间隔重试，并把闲置计数清零
      if (syncInFlightRef.current || syncPendingRef.current || saveStatusRef.current !== 'saved') {
        idleRounds = 0
        return schedule(1500)
      }
      try {
        const knownRevision = syncRevisionRef.current
        const page = await fetchAllCanvasElements({ workspaceId, canvasId, afterRevision: knownRevision })
        if (disposed) return
        if (page.history_floor_revision > knownRevision && knownRevision > 0) {
          // 增量历史已被服务端清理：下一轮用全量基线恢复，避免永久停在旧 revision。
          const full = await fetchAllCanvasElements({ workspaceId, canvasId, afterRevision: 0 })
          const graph = elementsToGraph(full.elements).nodes.map((node) => normalizeNodeMedia(node, workspaceId))
          const fullGraph = { nodes: graph, edges: elementsToGraph(full.elements).edges }
          restoreTextContents(
            Object.fromEntries(
              fullGraph.nodes
                .map((node) => [node.id, String((node.data as any)?.text || '')])
                .filter(([, text]) => Boolean(text)),
            ),
          )
          setNodes(fullGraph.nodes)
          setEdges(fullGraph.edges)
          latestRef.current = fullGraph
          syncRevisionRef.current = full.sync_revision
          const textMap = (window as any).__canvasTextContents as Map<string, string> | undefined
          syncRef.current = {
            nodes: fullGraph.nodes.map((node) => comparableNode(node, textMap)),
            edges: fullGraph.edges.map(comparableEdge),
          }
        } else if (page.elements.length > 0) {
          idleRounds = 0
          const merged = applyCanvasElementMutations(latestRef.current, page.elements)
          merged.nodes = merged.nodes.map((node) => normalizeNodeMedia(node, workspaceId))
          restoreTextContents(
            Object.fromEntries(
              merged.nodes
                .map((node) => [node.id, String((node.data as any)?.text || '')])
                .filter(([, text]) => Boolean(text)),
            ),
          )
          setNodes(merged.nodes)
          setEdges(merged.edges)
          latestRef.current = merged
          syncRevisionRef.current = page.sync_revision || knownRevision
          const textMap = (window as any).__canvasTextContents as Map<string, string> | undefined
          syncRef.current = {
            nodes: merged.nodes.map((node) => comparableNode(node, textMap)),
            edges: merged.edges.map(comparableEdge),
          }
        } else {
          // 空增量：画布闲置，下一轮拉长间隔
          idleRounds += 1
          syncRevisionRef.current = page.sync_revision || knownRevision
        }
        setCloudStatus('online')
        setCloudMessage('已同步到云端')
      } catch {
        if (!disposed) {
          setCloudStatus(navigator.onLine ? 'error' : 'offline')
          setCloudMessage(navigator.onLine ? '云端连接不稳定，将自动重试' : '网络已断开，内容已保存在本机')
        }
      }
      schedule()
    }
    schedule(1500)
    const onOnline = () => {
      setCloudStatus('loading')
      setCloudMessage('正在重新连接云端')
    }
    const onOffline = () => {
      setCloudStatus('offline')
      setCloudMessage('网络已断开，内容已保存在本机')
    }
    // 切回本页时立刻同步一次并重置退避：隐藏期间别人可能已经改过，不该让用户再等一个周期
    const onVisible = () => {
      if (document.hidden) return
      idleRounds = 0
      window.clearTimeout(timer)
      schedule(0)
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      disposed = true
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
    // 不依赖 saveStatus：它每次编辑都会三态翻转，进依赖数组会让整个循环反复重建、
    // 每次都从最短间隔重新起步（编辑越频繁轮询越密）。循环内改用 saveStatusRef 读取。
  }, [pushCanvasMutations, setEdges, setNodes, workspaceId])

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

  // 视频生成方式变更：保留兼容的参考连线，避免用户切换方式时丢失已选素材。
  const handleVideoModeChange = useCallback(
    (mode: CanvasVideoMode) => {
      if (!selectedNode) return
      const baseSize = 250
      // 视频模式变更前记录历史，供撤销使用
      commitHistory()
      setEdges((eds) =>
        eds.map((edge) => {
          if (edge.target !== selectedNode.id) return edge
          const sourceKind = String(
            latestRef.current.nodes.find((node) => node.id === edge.source)?.data?.kind || 'text',
          )
          const slotIndex = Number(edge.data?.slotIndex || 0)
          return {
            ...edge,
            data: {
              ...edge.data,
              role: inferCanvasConnectionRole({ targetKind: 'video', sourceKind, videoMode: mode, slotIndex }),
            },
          }
        }),
      )
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
      // 首尾帧 → auto；全能参考下原为无比例/自适应 → 默认 16:9；参考连线已清除
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
    [selectedNode, setNodes, setEdges, commitHistory],
  )

  // 应用素材：优先应用到已选中的节点（类型匹配时替换素材内容），否则创建新节点
  const handleApplyMaterial = useCallback(
    (material: {
      assetId: number
      type: string
      src: string
      name?: string
      realPerson?: SmartRealPersonReference
    }) => {
      const type = material.type === 'video' ? 'video' : 'image'
      // 已选中节点且类型匹配（图片素材可应用到图片/文本节点，视频素材应用到视频节点）
      const targetNode = selectedNode
      if (targetNode) {
        const isVideoTarget = targetNode.kind === 'video'
        if (type === 'video' ? isVideoTarget : true) {
          const assetId = Number(material.assetId || 0)
          // 素材库 src 为同源流式地址；缺失或为 blob: 时按 assetId 重建，保证持久回显
          const resultUrl = resolveNodeMediaUrl({ assetId, resultUrl: material.src }, workspaceId)
          // 替换素材前记录历史，供撤销使用
          commitHistory()
          // 真人素材的身份引用随节点一起保存；换成普通素材时必须清掉，否则旧身份约束会残留
          const realPerson = material.realPerson ?? null
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
                      realPerson,
                    },
                  }
                : n,
            ),
          )
          // 同步选中态回显
          setSelectedNode((prev) =>
            prev && prev.id === targetNode.id ? { ...prev, assetId, resultUrl, realPerson } : prev,
          )
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
          ratio: inheritNodeRatio(type),
          // 素材来源：assetId + 同源流式地址，供节点渲染/后续生成任务使用
          extraData: {
            assetId: Number(material.assetId || 0),
            resultUrl: resolveNodeMediaUrl(
              { assetId: Number(material.assetId || 0), resultUrl: material.src },
              workspaceId,
            ),
            ...(material.realPerson ? { realPerson: material.realPerson } : {}),
          },
        },
      )
    },
    [selectedNode, transform, appendNewNode, commitHistory, workspaceId, setNodes, inheritNodeRatio],
  )

  /**
   * 从「我的素材」带素材进入画布：落成一个新节点，省去用户先下载再上传。
   *
   * 与智能成片/爆款复制的 carryImages / carryVideo 同一套路由 state 约定。
   * 只消费一次：节点建好后清掉 history state，否则刷新或返回会重复插入同一素材。
   * 等节点数据加载完再落点，避免与云端拉取的节点同时 setNodes 造成互相覆盖。
   */
  const location = useLocation()
  const carriedMaterialRef = useRef(false)
  useEffect(() => {
    if (carriedMaterialRef.current) return
    const carried = (location.state as any)?.carryMaterial
    const assetId = Number(carried?.assetId || 0) || 0
    if (!carried || (!assetId && !carried.url)) return
    if (cloudStatus === 'loading') return
    carriedMaterialRef.current = true
    handleApplyMaterial({
      assetId,
      type: String(carried.type || 'image'),
      src: String(carried.url || ''),
      name: String(carried.name || ''),
    })
    navigate(location.pathname, { replace: true, state: null })
  }, [location.state, location.pathname, cloudStatus, handleApplyMaterial, navigate])

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
        assetId: (node.data as any)?.assetId,
        text: (node.data as any)?.text,
        prompt: (node.data as any)?.prompt,
        operationCode: (node.data as any)?.operationCode,
        params: (node.data as any)?.params,
        taskId: (node.data as any)?.taskId,
        taskStatus: (node.data as any)?.taskStatus,
        taskProgress: (node.data as any)?.taskProgress,
        taskError: (node.data as any)?.taskError,
        generationIntent: (node.data as any)?.generationIntent,
      })
      uploadInputRef.current?.click()
    }
    return () => {
      delete (window as any).__canvasRequestUpload
    }
  }, [getSourceRefs])

  // 文件选择后：上传到素材中心拿 asset_id，节点存持久地址（刷新后可回显），视频同时生成首帧 poster
  const handleUploadFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file || !selectedNode) return
      const isImage = file.type.startsWith('image/')
      const isVideo = file.type.startsWith('video/')
      const nodeKind = selectedNode.kind
      // 图片节点只接受图片；视频节点只接受视频
      if (nodeKind === 'image' && !isImage) {
        showToast('图片节点仅支持上传图片文件', 'error')
        return
      }
      if (nodeKind === 'video' && !isVideo) {
        showToast('视频节点仅支持上传视频文件', 'error')
        return
      }
      try {
        // 上传到素材中心，取得持久 asset_id（刷新后可经 /download 回显，不再依赖会话级 objectURL）
        const out: any = await uploadAssetFile({ workspaceId, file })
        const assetId = Number(out?.asset?.id || 0)
        if (!assetId) throw new Error('上传素材失败，请稍后重试')
        const resultUrl = assetStreamUrl(assetId, workspaceId)
        // 视频节点生成首帧 poster（dataURL 随节点持久化，回显时直接显示封面帧）
        const poster = isVideo ? await captureVideoPoster(file) : ''
        // 替换内容前记录历史，供撤销使用
        commitHistory()
        const nextData: Record<string, unknown> = {
          assetId,
          resultUrl,
          ...(poster ? { poster } : {}),
        }
        setNodes((nds) => nds.map((n) => (n.id === selectedNode.id ? { ...n, data: { ...n.data, ...nextData } } : n)))
        // 同步选中态回显（视频节点一旦有内容，顶部上传按钮自动隐藏 → video.edit 模型）
        setSelectedNode((prev) => (prev && prev.id === selectedNode.id ? { ...prev, ...nextData } : prev))
        setSaveStatus('dirty')
      } catch (error: any) {
        showToast(String(error?.message || '上传素材失败，请稍后重试'), 'error')
      }
    },
    [selectedNode, workspaceId, commitHistory, setSaveStatus, setNodes],
  )

  // ===== 本地图片导入：工具栏「本地图片」/ 粘贴（Ctrl+V）/ 拖拽文件到画布，三个入口共用 =====

  /** 本次会话创建的预览地址集合：页面卸载时统一释放，避免 objectURL 泄漏 */
  const localPreviewUrlsRef = useRef(new Set<string>())
  useEffect(
    () => () => {
      for (const url of localPreviewUrlsRef.current) URL.revokeObjectURL(url)
      localPreviewUrlsRef.current.clear()
    },
    [],
  )

  /** 释放预览地址：延迟到正式地址加载完成之后，避免图片出现短暂空白 */
  const releasePreviewUrl = useCallback((url: string) => {
    if (!url) return
    window.setTimeout(() => {
      if (!localPreviewUrlsRef.current.has(url)) return
      URL.revokeObjectURL(url)
      localPreviewUrlsRef.current.delete(url)
    }, LOCAL_PREVIEW_REVOKE_MS)
  }, [])

  /**
   * 导入本地图片：先按原图比例落一个带本地预览的占位节点，再上传素材中心换成持久地址。
   *
   * 预览地址只存在 previewUrl（不在持久化白名单内），因此不会有 blob: 地址被写进云端；
   * 上传失败的占位节点直接移除，不留下永远空白的图片节点。
   * anchor 为视口坐标（拖拽落点 / 鼠标位置 / 右键位置），缺省落在视口中心。
   */
  const importLocalImages = useCallback(
    async (files: File[], anchor?: { x: number; y: number }) => {
      const images = pickImageFiles(files)
      if (images.length === 0) {
        showToast('仅支持导入图片文件', 'error')
        return
      }
      const accepted = images.slice(0, LOCAL_IMAGE_IMPORT_LIMIT)
      const skipped = images.length - accepted.length
      const origin = anchor || { x: window.innerWidth / 2, y: window.innerHeight / 2 }
      // 整批只记一次历史：一次撤销即可撤掉本次导入的全部节点
      commitHistory()
      const created = await Promise.all(
        accepted.map(async (file, index) => {
          // 原图长宽比就近吸附到节点可选比例，导入后不再需要手动调比例
          const natural = await readImageNaturalSize(file)
          const ratio = natural ? snapImageRatio(natural.width, natural.height) : '1:1'
          const size = calcNodeSize(ratio, 250)
          const previewUrl = URL.createObjectURL(file)
          localPreviewUrlsRef.current.add(previewUrl)
          // 多张图片沿对角线错开，避免完全重叠
          const offset = index * 36
          const point = screenToFlowPosition({ x: origin.x + offset, y: origin.y + offset })
          const nodeId = appendNewNode(
            'image',
            { x: point.x - size.width / 2, y: point.y - size.height / 2 },
            { ratio, size, skipHistory: true, extraData: { previewUrl, uploading: true } },
          )
          return { nodeId, file, previewUrl }
        }),
      )
      const failures: string[] = []
      await Promise.all(
        created.map(async ({ nodeId, file, previewUrl }) => {
          try {
            // 上传到素材中心，取得持久 asset_id（刷新后经同源流式地址回显）
            const out: any = await uploadAssetFile({ workspaceId, file })
            const assetId = Number(out?.asset?.id || 0)
            if (!assetId) throw new Error('上传素材失败，请稍后重试')
            const nextData: Record<string, unknown> = {
              assetId,
              resultUrl: assetStreamUrl(assetId, workspaceId),
              uploading: false,
              previewUrl: '',
            }
            setNodes((nds) => nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...nextData } } : n)))
            setSelectedNode((prev) => (prev && prev.id === nodeId ? { ...prev, ...nextData } : prev))
          } catch (error: any) {
            failures.push(String(error?.message || '上传素材失败，请稍后重试'))
            setNodes((nds) => nds.filter((n) => n.id !== nodeId))
            setSelectedNode((prev) => (prev && prev.id === nodeId ? null : prev))
          } finally {
            releasePreviewUrl(previewUrl)
          }
        }),
      )
      setSaveStatus('dirty')
      if (failures.length > 0) {
        showToast(failures.length > 1 ? `${failures.length} 张图片上传失败：${failures[0]}` : failures[0], 'error')
      } else if (skipped > 0) {
        // 其余图片已成功导入，这里只是数量提醒，不按错误呈现
        showToast(`一次最多导入 ${LOCAL_IMAGE_IMPORT_LIMIT} 张图片，其余 ${skipped} 张已忽略`, 'info')
      }
    },
    [appendNewNode, commitHistory, releasePreviewUrl, screenToFlowPosition, setNodes, setSaveStatus, workspaceId],
  )

  /** 打开本地图片选择框；anchor 为落点（视口坐标），缺省落在视口中心 */
  const openLocalImagePicker = useCallback((anchor?: { x: number; y: number }) => {
    const input = localImageInputRef.current
    if (!input) return
    localImageAnchorRef.current = anchor || null
    input.value = ''
    input.click()
  }, [])

  const handleLocalImageInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || [])
      event.target.value = ''
      const anchor = localImageAnchorRef.current
      localImageAnchorRef.current = null
      if (files.length === 0) return
      void importLocalImages(files, anchor || undefined)
    },
    [importLocalImages],
  )

  // 记录鼠标位置：粘贴的图片落在鼠标处，更贴近「粘到我看的地方」的预期
  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      pointerRef.current = { x: event.clientX, y: event.clientY }
    }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  // 粘贴导入：Ctrl+V 把剪贴板里的图片（截图或复制的图片文件）落到画布
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      // 文本编辑中保留浏览器默认粘贴；素材库弹窗、参考选择模式下不接管
      const active = document.activeElement as HTMLElement | null
      if (active?.closest?.('textarea, input, [contenteditable="true"]')) return
      if (drawerPanel || isPickingRef) return
      const files = extractImageFiles(event.clipboardData)
      if (files.length === 0) return
      event.preventDefault()
      void importLocalImages(files, pointerRef.current || undefined)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [drawerPanel, isPickingRef, importLocalImages])

  const handleFileDragEnter = useCallback((event: React.DragEvent) => {
    if (!hasFileDrag(event.dataTransfer)) return
    event.preventDefault()
    fileDragDepthRef.current += 1
    setFileDragActive(true)
  }, [])

  const handleFileDragOver = useCallback((event: React.DragEvent) => {
    if (!hasFileDrag(event.dataTransfer)) return
    // 必须阻止默认行为，否则浏览器会直接打开被拖入的图片文件
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }, [])

  const handleFileDragLeave = useCallback((event: React.DragEvent) => {
    if (!hasFileDrag(event.dataTransfer)) return
    fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1)
    if (fileDragDepthRef.current === 0) setFileDragActive(false)
  }, [])

  const handleFileDrop = useCallback(
    (event: React.DragEvent) => {
      if (!hasFileDrag(event.dataTransfer)) return
      event.preventDefault()
      fileDragDepthRef.current = 0
      setFileDragActive(false)
      // 参考选择模式下画布正在等待点选来源节点，此时不接受导入
      if (isPickingRef) return
      void importLocalImages(extractImageFiles(event.dataTransfer), { x: event.clientX, y: event.clientY })
    },
    [importLocalImages, isPickingRef],
  )

  // 模型变更：保存 modelVersionId 到节点数据并回显
  const handleModelChange = useCallback(
    (modelVersionId: number) => {
      if (!selectedNode) return
      // 模型变更前记录历史，供撤销使用
      commitHistory()
      setNodes((nds) =>
        nds.map((n) =>
          n.id === selectedNode.id
            ? {
                ...n,
                data: {
                  ...(n.data as Record<string, unknown>),
                  modelVersionId,
                  ...(selectedNode.kind === 'video' && selectedNode.resultUrl ? { generationIntent: 'new-model' } : {}),
                },
              }
            : n,
        ),
      )
      setSelectedNode((prev) =>
        prev
          ? {
              ...prev,
              modelVersionId,
              ...(prev.kind === 'video' && prev.resultUrl ? { generationIntent: 'new-model' as const } : {}),
            }
          : prev,
      )
    },
    [selectedNode, setNodes, commitHistory],
  )

  /** 文本节点只保存用户原文，不创建 AI 任务；下游图片/视频会直接读取这段文本。 */
  const handleSaveNodeText = useCallback(
    (text: string) => {
      if (!selectedNode || selectedNode.kind !== 'text') return
      const value = String(text || '').trim()
      if (!value) return
      const targetNodeId = selectedNode.id
      commitHistory()
      if (!(window as any).__canvasTextContents) (window as any).__canvasTextContents = new Map<string, string>()
      ;((window as any).__canvasTextContents as Map<string, string>).set(targetNodeId, value)
      const nextData = {
        text: value,
        taskId: undefined,
        taskStatus: '',
        taskProgress: 0,
        taskError: '',
        resultSyncAttempts: 0,
      }
      setNodes((items) =>
        items.map((item) => (item.id === targetNodeId ? { ...item, data: { ...item.data, ...nextData } } : item)),
      )
      setSelectedNode((current) => (current?.id === targetNodeId ? { ...current, ...nextData } : current))
      setSaveStatus('dirty')
      scheduleSyncRef.current(true)
    },
    [selectedNode, commitHistory, setNodes, setSaveStatus],
  )

  /**
   * 图片/视频节点输入框内容随节点持久化：切到别的节点再切回、以及退出画布重进都要回显。
   *
   * 不进历史栈：逐字输入若每次都记快照，撤销会变成一个字一个字地退。
   * prompt 已在 canvasElements 的持久化白名单内，标脏后由既有增量同步带上云端。
   */
  const handleNodePromptChange = useCallback(
    (prompt: string) => {
      const targetNodeId = selectedNode?.id
      if (!targetNodeId || selectedNode?.kind === 'text') return
      setNodes((items) =>
        items.map((item) => (item.id === targetNodeId ? { ...item, data: { ...item.data, prompt } } : item)),
      )
      setSelectedNode((current) => (current?.id === targetNodeId ? { ...current, prompt } : current))
      setSaveStatus('dirty')
    },
    [selectedNode?.id, selectedNode?.kind, setNodes, setSaveStatus],
  )

  /**
   * 面板里改动的生成参数即时落到节点。
   *
   * 参数原本只在「发送生成」时才写进节点（configData.params），于是调好的分辨率、时长
   * 刷新一下就退回模型默认值——而提示词是即时持久化的，同一个面板里两种行为不一致，
   * 用户只会当成丢数据。面板读取侧本来就从 node.params 回显（见 CanvasNodePanel 里
   * fieldValues 的初始化），缺的一直是写入侧。
   */
  const handleNodeParamsChange = useCallback(
    (params: Record<string, unknown>) => {
      const targetNodeId = selectedNode?.id
      if (!targetNodeId) return
      setNodes((items) =>
        items.map((item) => (item.id === targetNodeId ? { ...item, data: { ...item.data, params } } : item)),
      )
      setSelectedNode((current) => (current?.id === targetNodeId ? { ...current, params } : current))
      setSaveStatus('dirty')
    },
    [selectedNode?.id, setNodes, setSaveStatus],
  )

  /**
   * AI 润色是显式的可选动作：只返回润色结果，仍需用户确认并保存。
   *
   * 节点已连线的参考图会一并送进润色模型。缺图时润色只能凭字面凭空补出主体和场景，
   * 那段描述随后与参考图一起提交给图生图/图生视频模型并压过参考图，主体就被换掉了；
   * 因此有图时改用「保持图中主体不变」的上下文，只补镜头与光影表达。
   */
  const handlePolishNodeText = useCallback(
    async ({
      prompt,
      kind,
      images,
      imageAssetIds,
    }: {
      prompt: string
      kind: string
      images?: string[]
      imageAssetIds?: number[]
    }): Promise<string> => {
      const theme = String(prompt || '').trim()
      if (!theme) throw new Error('请先输入一个主题或提示词')
      const polishModel = canvasModels.text.find((model) => model.operationCodes.includes('responses.multimodal'))
      if (!polishModel) throw new Error('暂无可用的 AI 润色模型，请稍后重试')
      const targetLabel = kind === 'video' ? '视频' : '图片'
      const hasReferenceImages = Boolean(images?.length || imageAssetIds?.length)
      const polishContext = hasReferenceImages
        ? kind === 'video'
          ? `目标是 AI ${targetLabel}生成提示词，且已连接参考图。请保持参考图中的主体不变，只补充镜头运动、光线、节奏和画面风格，不要替换主体或增加无关主体。`
          : `目标是 AI ${targetLabel}生成提示词，且已连接参考图。请保持参考图中的主体不变，只补充构图、视角、光线、材质和画面风格，不要替换主体或增加无关主体。`
        : kind === 'video'
          ? `目标是 AI ${targetLabel}生成提示词。请补充场景、构图、镜头运动、主体动作、光线、节奏和画面风格，不要增加无关主体。`
          : `目标是 AI ${targetLabel}生成提示词。请补充场景、构图、视角、光线、材质和画面风格，不要增加无关主体。`
      const polished = String(
        await polishText(theme, {
          kind: 'generic',
          context: polishContext,
          images,
          imageAssetIds,
          modelVersionId: polishModel.modelVersionId,
          requestContext: {
            workspaceId,
            modelVersionId: polishModel.modelVersionId,
            modelVersion: polishModel.source,
          },
          maxTokens: kind === 'video' ? 420 : 320,
        }),
      ).trim()
      if (!polished) throw new Error('AI 未返回可用的润色内容，请稍后重试')
      return polished
    },
    [canvasModels.text, workspaceId],
  )

  /**
   * 节点「生成」按钮接线：组装 input_assets → 持久化 operationCode/params → 创建 AI 任务 → 回写 task_id/status。
   * 参考图片通过 input_assets 数组传递（文档 6.3），role 按 operation 约定：
   * - video.generate / video.edit → image（首尾帧、参考图统一）
   * - image.image_to_image → reference_image
   * 文本来源节点不传素材（其内容已拼入 prompt）。
   */
  /**
   * 提交前按最新真人列表复核授权。
   *
   * 画布节点里的引用是选素材当时的快照，之后这个人可能被删除、认证被撤销、素材被下架。
   * 接口异常时放行：真人素材本身已通过认证，不能因为一次网络抖动就拦住用户的付费生成。
   */
  const isRealPersonReferenceAuthorizedNow = useCallback(
    async (reference: SmartRealPersonReference): Promise<boolean> => {
      try {
        const people = await listRealPeople({ workspaceId })
        return isRealPersonReferenceStillAuthorized(reference, people)
      } catch {
        return true
      }
    },
    [workspaceId],
  )

  const handleInsufficientCredits = useCallback(async () => {
    const shouldRecharge = await requestConfirm('当前用户积分不足，请先去充值积分', {
      title: '积分不足',
      confirmLabel: '去充值',
      cancelLabel: '暂不充值',
    })
    if (shouldRecharge) openMemberCenterTab('recharge')
  }, [])

  const submitNodeGeneration = useCallback(
    async (targetNodeId: string, generate: CanvasGenerationRequest) => {
      if (!generate || !latestRef.current.nodes.some((node) => node.id === targetNodeId)) return
      if (generate.kind === 'text') {
        if (selectedNode?.id === targetNodeId) handleSaveNodeText(generate.prompt)
        return
      }
      if (generate.kind === 'video') {
        const validationError = validateCanvasVideoInputs({
          operationCode: generate.operationCode,
          videoMode: generate.videoMode,
          sourceRefs: generate.sourceRefs || [],
        })
        if (validationError) {
          showToast(validationError, 'error')
          return
        }
      }
      // 真人素材：一次生成只允许一个身份基准；连入两个不同真人时无法判断该保谁的脸。
      const realPerson = resolveCanvasRealPersonReference(generate.sourceRefs || [])
      if (realPerson.error) {
        showToast(realPerson.error, 'error')
        return
      }
      // 授权是会变的（人被删、认证被撤销、素材失效），必须在扣费提交前按最新列表复核一次。
      if (realPerson.reference) {
        const stillAuthorized = await isRealPersonReferenceAuthorizedNow(realPerson.reference)
        if (!stillAuthorized) {
          showToast('该真人素材已失效或未通过认证，请重新选择真人素材', 'error')
          return
        }
      }
      // 素材角色以模型 schema 为准，与智能成片同口径；模型查不到时退回历史默认值。
      const submitModel = (canvasModels[generate.kind as 'text' | 'image' | 'video'] || []).find(
        (model) => Number(model.modelVersionId || 0) === Number(generate.modelVersionId || 0),
      )
      // 身份约束必须在这里注入：润色只改用户提示词，约束由提交环节兜底，避免被润色覆盖。
      const identity = applyCanvasRealPersonIdentity({
        kind: generate.kind,
        videoMode: generate.videoMode,
        prompt: generate.prompt,
        inputAssets: buildCanvasInputAssets(
          generate.sourceRefs || [],
          generate.operationCode,
          generate.selfVideoAssetId,
          submitModel ? resolveModelInputAssetRole(submitModel.source) : '',
        ),
        reference: realPerson.reference,
      })
      const inputAssets = identity.inputAssets
      const taskRunId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
      try {
        const taskStartedAt = new Date().toISOString()
        // 1) 先把当前配置（operationCode + params）持久化到节点，保证刷新后配置不丢
        const configData: Record<string, unknown> = {
          operationCode: generate.operationCode,
          params: generate.params || {},
          generationRequest: generate,
          taskRunId,
          taskStatus: 'submitting',
          taskProgress: 0,
          taskError: '',
          taskStartedAt,
          taskUpdatedAt: taskStartedAt,
        }
        setNodes((nds) => nds.map((n) => (n.id === targetNodeId ? { ...n, data: { ...n.data, ...configData } } : n)))
        setSelectedNode((prev) => (prev && prev.id === targetNodeId ? { ...prev, ...configData } : prev))
        setSaveStatus('dirty')
        // 2) 创建 AI 任务（同幂等键重试可复用同一任务；网络失败不静默换模型）
        const task = await createAiTask({
          workspaceId,
          capability: generate.kind,
          operationCode: generate.operationCode,
          // 已注入真人身份约束的提示词；无真人素材时与用户原文一致。
          prompt: identity.prompt,
          params: generate.params,
          inputAssets,
          modelVersionId: generate.modelVersionId,
        })
        const taskId = getAiTaskId(task)
        if (!taskId) throw new Error('任务创建后未返回任务 ID')
        // 3) 回写 task_id/task_status 到节点
        const createdStatus = normalizeAiTaskStatus(task?.status) || 'pending'
        // 创建接口可能直接返回 succeeded，但完整 outputs 通常仍需从任务详情读取。
        // 在结果真正落到节点前保持可见的等待态，并让恢复轮询继续读取详情。
        const taskData: Record<string, unknown> = {
          taskId,
          taskStatus: ['succeeded', 'completed', 'success'].includes(createdStatus) ? 'result_pending' : createdStatus,
          taskUpdatedAt: new Date().toISOString(),
        }
        setNodes((nds) =>
          nds.map((n) =>
            n.id === targetNodeId && (n.data as any)?.taskRunId === taskRunId
              ? { ...n, data: { ...n.data, ...taskData } }
              : n,
          ),
        )
        setSelectedNode((prev) => (prev && prev.id === targetNodeId ? { ...prev, ...taskData } : prev))
        setSaveStatus('dirty')
        scheduleSyncRef.current(true)
      } catch (error: any) {
        if (isInsufficientCreditsError(error)) {
          const taskData = {
            taskStatus: 'submit_failed',
            taskProgress: 0,
            taskError: '积分不足',
            taskUpdatedAt: new Date().toISOString(),
          }
          setNodes((nds) =>
            nds.map((node) =>
              node.id === targetNodeId && (node.data as any)?.taskRunId === taskRunId
                ? { ...node, data: { ...node.data, ...taskData } }
                : node,
            ),
          )
          setSelectedNode((prev) => (prev && prev.id === targetNodeId ? { ...prev, ...taskData } : prev))
          setSaveStatus('dirty')
          await handleInsufficientCredits()
          return
        }
        const taskData = {
          taskStatus: 'submit_failed',
          taskProgress: 0,
          taskError: String(error?.message || '任务创建失败，请稍后重试'),
          taskUpdatedAt: new Date().toISOString(),
        }
        setNodes((nds) =>
          nds.map((n) =>
            n.id === targetNodeId && (n.data as any)?.taskRunId === taskRunId
              ? { ...n, data: { ...n.data, ...taskData } }
              : n,
          ),
        )
        setSelectedNode((prev) => (prev && prev.id === targetNodeId ? { ...prev, ...taskData } : prev))
        setSaveStatus('dirty')
        showToast(String(error?.message || '任务创建失败，请稍后重试'), 'error')
      }
    },
    [
      canvasModels,
      handleInsufficientCredits,
      handleSaveNodeText,
      isRealPersonReferenceAuthorizedNow,
      selectedNode,
      workspaceId,
      setNodes,
      setSaveStatus,
    ],
  )

  restartGenerationRef.current = (nodeId, request) => {
    void submitNodeGeneration(nodeId, request)
  }

  const handleNodeGenerate = useCallback(
    async (generate: CanvasGenerationRequest) => {
      if (!selectedNode) return
      await submitNodeGeneration(selectedNode.id, generate)
    },
    [selectedNode, submitNodeGeneration],
  )

  // 恢复并轮询画布中的在途任务：刷新页面后仍能继续读取真实状态，成功后把文本/图片/视频结果回填节点。
  useEffect(() => {
    let disposed = false
    let timer = 0
    const polling = new Set<number>()
    const successStatuses = new Set(['succeeded', 'completed', 'success'])
    const failedStatuses = new Set(['failed', 'error', 'payment_failed', 'cancelled', 'expired'])

    const taskProgressOf = (task: any): number => {
      const raw = Number(task?.progress ?? task?.progress_percent ?? task?.percentage ?? 0)
      if (!Number.isFinite(raw) || raw <= 0) return 0
      return Math.max(0, Math.min(100, raw <= 1 ? raw * 100 : raw))
    }
    const taskErrorOf = (task: any): string =>
      String(task?.error_message || task?.error?.message || task?.message || '生成失败，请重试')

    const tick = async () => {
      // 页面在后台时不拉任务状态：与画布增量同步保持同一策略，切回来会立即补一次。
      if (document.hidden) {
        if (!disposed) timer = window.setTimeout(tick, 6000)
        return
      }
      const candidates = latestRef.current.nodes.filter((node) => {
        const taskId = Number((node.data as any)?.taskId || 0)
        const status = normalizeAiTaskStatus((node.data as any)?.taskStatus)
        const taskError = String((node.data as any)?.taskError || '')
        const isRecoverableResultSyncFailure =
          status === 'failed' && (taskError.includes('结果同步超时') || taskError.includes('未返回可用'))
        if (
          taskId <= 0 ||
          (failedStatuses.has(status) && !isRecoverableResultSyncFailure) ||
          status === 'submit_failed'
        )
          return false
        if (!successStatuses.has(status)) return true
        const kind = String((node.data as any)?.kind || node.type || 'text')
        const hasResult =
          kind === 'text'
            ? Boolean(String((node.data as any)?.text || '').trim())
            : Boolean((node.data as any)?.resultUrl || Number((node.data as any)?.assetId || 0) > 0)
        return !hasResult
      })
      await Promise.all(
        candidates.map(async (node) => {
          const taskId = Number((node.data as any)?.taskId || 0)
          if (!taskId || polling.has(taskId)) return
          polling.add(taskId)
          try {
            const task = await getAiTask({ workspaceId, taskId })
            if (disposed) return
            const status = normalizeAiTaskStatus(task?.status) || 'pending'
            const progress = taskProgressOf(task)
            const nextData: Record<string, unknown> = {
              taskStatus: status,
              taskProgress: progress,
              taskError: '',
              taskStatusQueryFailures: 0,
              taskUpdatedAt: new Date().toISOString(),
            }
            if (successStatuses.has(status)) {
              const kind = String((node.data as any)?.kind || node.type || 'text')
              if (kind === 'text') {
                const text = String(extractTaskText(task) || '')
                if (text) {
                  nextData.text = text
                  nextData.resultSyncAttempts = 0
                  if (!(window as any).__canvasTextContents) (window as any).__canvasTextContents = new Map()
                  ;(window as any).__canvasTextContents.set(node.id, text)
                } else {
                  const resultSyncAttempts = Number((node.data as any)?.resultSyncAttempts || 0) + 1
                  nextData.resultSyncAttempts = resultSyncAttempts
                  if (resultSyncAttempts < 24) {
                    nextData.taskStatus = 'result_pending'
                    nextData.taskError = '任务已完成，正在同步生成结果…'
                  } else {
                    nextData.taskStatus = 'failed'
                    nextData.taskError = '任务已完成，但结果同步超时，请重试'
                  }
                }
              } else {
                // 只把「验证过确实存在」的资产写进节点：这个 assetId 会被下一次生成当作
                // input_assets 提交（视频生视频尤其依赖它），存一个未经确认的 id 进去，
                // 后端到时候只会回「参考素材不可用」，而且已经追不回是哪一步写坏的。
                const assetId = await resolveVerifiedResultAssetId({
                  workspaceId,
                  task,
                  type: kind === 'video' ? 'video' : 'image',
                  fallbackTaskId: taskId,
                })
                const urls = await resolveGeneratedMediaUrls({ workspaceId, task, type: kind })
                if (assetId > 0) nextData.assetId = assetId
                if (assetId > 0 || urls[0])
                  nextData.resultUrl = assetId > 0 ? assetStreamUrl(assetId, workspaceId) : urls[0]
                if (!nextData.resultUrl) {
                  const resultSyncAttempts = Number((node.data as any)?.resultSyncAttempts || 0) + 1
                  nextData.resultSyncAttempts = resultSyncAttempts
                  if (resultSyncAttempts < 24) {
                    nextData.taskStatus = 'result_pending'
                    nextData.taskError = '任务已完成，正在同步生成结果…'
                  } else {
                    nextData.taskStatus = 'failed'
                    nextData.taskError = '任务已完成，但结果同步超时，请重试'
                  }
                } else {
                  nextData.resultSyncAttempts = 0
                  nextData.generationIntent = 'edit'
                }
              }
              if (nextData.taskStatus !== 'result_pending') nextData.taskProgress = 100
            } else if (failedStatuses.has(status)) {
              nextData.taskError = taskErrorOf(task)
            }
            setNodes((items) =>
              items.map((item) =>
                item.id === node.id && Number((item.data as any)?.taskId || 0) === taskId
                  ? {
                      ...item,
                      data: { ...item.data, ...nextData },
                      style:
                        typeof nextData.text === 'string' && isCanvasStoryboardText(nextData.text)
                          ? { ...item.style, width: 420, height: 480 }
                          : item.style,
                    }
                  : item,
              ),
            )
            setSelectedNode((current) => (current?.id === node.id ? { ...current, ...nextData } : current))
            setSaveStatus('dirty')
          } catch (error: any) {
            // 短暂网络错误不把任务误判为失败，保留任务 ID 供下一轮继续恢复。
            if (!disposed && !navigator.onLine) {
              setCloudStatus('offline')
              setCloudMessage('网络已断开，任务状态将在恢复联网后继续刷新')
            }
            if (!disposed && navigator.onLine) {
              setNodes((items) =>
                items.map((item) => {
                  if (item.id !== node.id || Number((item.data as any)?.taskId || 0) !== taskId) return item
                  const failures = Number((item.data as any)?.taskStatusQueryFailures || 0) + 1
                  return {
                    ...item,
                    data: {
                      ...item.data,
                      taskStatusQueryFailures: failures,
                      ...(failures >= 6
                        ? {
                            taskStatus: 'status_query_failed',
                            taskError: `任务状态暂时无法查询，将继续自动重试${error?.message ? `：${error.message}` : ''}`,
                          }
                        : {}),
                    },
                  }
                }),
              )
            }
          } finally {
            polling.delete(taskId)
          }
        }),
      )
      if (!disposed) timer = window.setTimeout(tick, candidates.length > 0 ? 2500 : 6000)
    }
    timer = window.setTimeout(tick, 800)
    // 切回本页立即补一次：后台期间没拉状态，不该让用户再等一个周期才看到结果
    const onVisible = () => {
      if (document.hidden || disposed) return
      window.clearTimeout(timer)
      timer = window.setTimeout(tick, 0)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      disposed = true
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [setNodes, workspaceId])

  // 当前被编辑的时间线节点及其状态；节点被删除时编辑器自然关闭
  const timelineEditorNode = timelineEditorNodeId
    ? nodes.find((node) => node.id === timelineEditorNodeId) || null
    : null
  const timelineEditorState = useMemo(
    () => parseTimelineState((timelineEditorNode?.data as Record<string, unknown> | undefined)?.timeline),
    [timelineEditorNode],
  )

  /**
   * 编辑器里「已连线、但来源视频还没有素材」的数量。
   *
   * 这类连线不会产生片段（没有 assetId 就没有可拼的内容），此前是完全静默的——
   * 用户连上线却什么都没发生，只能以为功能坏了。数出来如实说明。
   * 节点卡片上的同一提示直接从 React Flow store 读，不走这里。
   */
  const timelineEditorPendingCount = useMemo(() => {
    if (!timelineEditorNodeId) return 0
    return edges.filter((edge) => {
      if (edge.target !== timelineEditorNodeId) return false
      const source = nodes.find((item) => item.id === edge.source)
      return !(Number((source?.data as Record<string, unknown> | undefined)?.assetId || 0) > 0)
    }).length
  }, [timelineEditorNodeId, edges, nodes])

  /** 编辑器打开时可加入的画布视频（编辑器是模态，这里按当前状态算一次即可）。 */
  const editorAddableSources = useMemo<CanvasTimelineSource[]>(() => {
    if (!timelineEditorNodeId) return []
    const used = new Set(timelineEditorState.clips.map((clip) => clip.sourceNodeId).filter(Boolean))
    return nodes
      .filter((node) => {
        const data = node.data as Record<string, unknown> | undefined
        if (data?.kind !== 'video') return false
        if (node.id === timelineEditorNodeId || used.has(node.id)) return false
        return Number(data?.assetId || 0) > 0
      })
      .map((node, index) => {
        const data = node.data as Record<string, unknown>
        return {
          nodeId: node.id,
          assetId: Number(data.assetId || 0),
          label: `画布视频 ${index + 1}`,
          thumbnailUrl: resolveNodeMediaUrl(data, workspaceId) || '',
        }
      })
  }, [timelineEditorNodeId, timelineEditorState, nodes, workspaceId])

  /**
   * 连线 → 片段：视频节点连到时间线节点即成为一个片段，断开连线即移除对应片段。
   *
   * 只增删，不重排：用户在编辑器里排好的顺序与裁剪必须原样保留。
   * 素材尚未就绪（没有 assetId）的视频节点先不产生片段，等它生成/上传完成后本副作用会补上。
   */
  useEffect(() => {
    const updates = new Map<string, TimelineState>()
    for (const node of nodes) {
      if ((node.data as Record<string, unknown> | undefined)?.kind !== 'timeline') continue
      const sources = edges
        .filter((edge) => edge.target === node.id)
        .slice()
        .sort((left, right) => Number(left.data?.slotIndex ?? 0) - Number(right.data?.slotIndex ?? 0))
        .map((edge) => {
          const source = nodes.find((item) => item.id === edge.source)
          return {
            sourceNodeId: edge.source,
            assetId: Number((source?.data as Record<string, unknown> | undefined)?.assetId || 0),
          }
        })
      const current = parseTimelineState((node.data as Record<string, unknown> | undefined)?.timeline)
      const synced = syncTimelineClipsFromSources(current, sources)
      if (!isSameTimelineClips(current.clips, synced.clips)) updates.set(node.id, synced)
    }
    if (!updates.size) return
    setNodes((items) =>
      items.map((node) =>
        updates.has(node.id) ? { ...node, data: { ...node.data, timeline: updates.get(node.id) } } : node,
      ),
    )
    setSaveStatus('dirty')
  }, [nodes, edges, setNodes, setSaveStatus])

  /**
   * 把早期建的时间线节点抬到当前尺寸。
   *
   * 卡片以前只放摘要，320×168 够用；现在要放预览 + 片段条 + 操作行，那个高度会挤成一团。
   * 只放大不缩小，已经够大的节点原样不动，因此正常情况下只会触发一次保存。
   */
  useEffect(() => {
    const undersized = nodes.filter((node) => {
      if ((node.data as Record<string, unknown> | undefined)?.kind !== 'timeline') return false
      const style = (node.style || {}) as CSSProperties
      return (
        (Number(style.width) || 0) < TIMELINE_NODE_SIZE.width || (Number(style.height) || 0) < TIMELINE_NODE_SIZE.height
      )
    })
    if (!undersized.length) return
    const ids = new Set(undersized.map((node) => node.id))
    setNodes((items) =>
      items.map((node) => {
        if (!ids.has(node.id)) return node
        const style = (node.style || {}) as CSSProperties
        return {
          ...node,
          style: {
            ...style,
            width: Math.max(Number(style.width) || 0, TIMELINE_NODE_SIZE.width),
            height: Math.max(Number(style.height) || 0, TIMELINE_NODE_SIZE.height),
          },
        }
      }),
    )
    setSaveStatus('dirty')
  }, [nodes, setNodes, setSaveStatus])

  /**
   * 量出片段的源片真实时长。
   *
   * 连线自动生成的片段初始只是「整段待测量」的占位区间，不量出真实时长的话，
   * 播放器只会各放 0.2 秒——看起来完全不像一条连续的片子。
   * 同一条素材同时只量一次；失败后移除占用标记，让后续轮次可以重试。
   *
   * 刻意不做「取消」：本副作用依赖 nodes，而它自己写回时长又会改 nodes，
   * 于是测量期间必然触发一次 cleanup。此前用 cancelled 标志会把已经量出的结果丢掉，
   * 而对应 key 已经记进已测集合，那条片段就永远停在 0.2 秒占位区间——
   * 用户看到的就是「加了两段视频，一段 10 秒一段 0.2 秒」。
   * setNodes 用函数式更新且按 id 定位，节点已被删除时自然是空操作，无需取消。
   */
  useEffect(() => {
    const pending: Array<{ nodeId: string; clipId: string; assetId: number }> = []
    for (const node of nodes) {
      if ((node.data as Record<string, unknown> | undefined)?.kind !== 'timeline') continue
      const timeline = parseTimelineState((node.data as Record<string, unknown> | undefined)?.timeline)
      for (const clip of timeline.clips) {
        if (clip.sourceDurationSec > 0 || !(clip.assetId > 0)) continue
        // key 必须带 assetId：来源节点换素材后片段 id 不变、时长被重置为待测量，
        // 只按 node:clip 记的话会命中旧标记，片段永远卡在 0.2 秒占位区间。
        if (measuredClipAssetsRef.current.has(`${node.id}:${clip.id}:${clip.assetId}`)) continue
        pending.push({ nodeId: node.id, clipId: clip.id, assetId: clip.assetId })
      }
    }
    if (!pending.length) return

    // 并行测量：串行时前一条的写回会改 nodes，后面几条要多等好几轮才轮得到
    const retryMeasurement = (measurementKey: string) => {
      measuredClipAssetsRef.current.delete(measurementKey)
      const attempts = (clipDurationAttemptsRef.current.get(measurementKey) || 0) + 1
      clipDurationAttemptsRef.current.set(measurementKey, attempts)
      if (attempts >= 3) return
      const timer = window.setTimeout(
        () => {
          clipDurationRetryTimersRef.current.delete(timer)
          setClipDurationRetryTick((value) => value + 1)
        },
        1200 * 2 ** (attempts - 1),
      )
      clipDurationRetryTimersRef.current.add(timer)
    }

    pending.forEach((item) => {
      measuredClipAssetsRef.current.add(`${item.nodeId}:${item.clipId}:${item.assetId}`)
      // 用不取整的时长：按秒取整会把 5.4 秒的片子当成 5 秒，末尾 0.4 秒直接丢掉
      const measurementKey = `${item.nodeId}:${item.clipId}:${item.assetId}`
      void readVideoDurationSecExact(assetStreamUrl(item.assetId, Number(workspaceId || 0)))
        .then((duration) => {
          if (!(duration > 0)) {
            retryMeasurement(measurementKey)
            return
          }
          clipDurationAttemptsRef.current.delete(measurementKey)
          setNodes((items) =>
            items.map((node) => {
              if (node.id !== item.nodeId) return node
              const current = parseTimelineState((node.data as Record<string, unknown> | undefined)?.timeline)
              const next = attachClipSourceDuration(current, item.clipId, duration)
              if (isSameTimelineClips(current.clips, next.clips)) return node
              return { ...node, data: { ...node.data, timeline: next } }
            }),
          )
          setSaveStatus('dirty')
        })
        .catch(() => {
          retryMeasurement(measurementKey)
        })
    })
  }, [clipDurationRetryTick, nodes, workspaceId, setNodes, setSaveStatus])

  useEffect(() => {
    const retryTimers = clipDurationRetryTimersRef.current
    return () => {
      retryTimers.forEach((timer) => window.clearTimeout(timer))
      retryTimers.clear()
    }
  }, [])

  /**
   * 把截出来的图连回它的源视频。
   *
   * 不连线时这张图落在画布上就是一座孤岛：看不出它截自哪条视频，
   * 画布上视频一多就只能靠位置猜，而位置是会被拖散的。
   *
   * 这条边标成血缘边（provenance）：方向是「视频 → 图」，表示图是视频的产物。
   * 它绝不能被当成生成输入——image 节点本来就不接受 video 来源
   * （allowedSourceKinds.image 只有 text/image），真按输入发出去，
   * 后端收到的会是「拿一整条视频当图片模型的素材」。
   * 样式上用虚线与真正的输入边区分开。
   */
  const linkCapturedFrame = useCallback(
    (videoNodeId: string, imageNodeId: string) => {
      if (!videoNodeId || !imageNodeId) return
      const edgeId = buildEdgeId(videoNodeId, imageNodeId, 0)
      setEdges((current) =>
        current.some((edge) => edge.id === edgeId)
          ? current
          : [
              ...current,
              {
                id: edgeId,
                source: videoNodeId,
                sourceHandle: null,
                target: imageNodeId,
                targetHandle: null,
                data: { slotIndex: 0, provenance: true },
                style: { stroke: '#b6bdcb', strokeWidth: 1.5, strokeDasharray: '6 5' },
              },
            ],
      )
    },
    [setEdges],
  )

  /**
   * 截帧：把视频节点当前画面落成一个图片节点。
   *
   * 先上传成正式素材再建节点——只留 dataURL 的话，这张图既不能作为 input_assets 参与下游生成，
   * 也会把几百 KB 的 base64 写进画布草稿。上传失败就不建节点，不留一个点不动的空壳。
   */
  const handleCaptureFrame = useCallback(
    async (nodeId: string, frameDataUrl: string) => {
      const ws = Number(workspaceId || 0)
      if (!ws || capturingNodeId) return
      const sourceNode = latestRef.current.nodes.find((node) => node.id === nodeId)
      if (!sourceNode) return

      setCapturingNodeId(nodeId)
      try {
        const blob = await (await fetch(frameDataUrl)).blob()
        const file = new File([blob], `canvas-frame-${Date.now()}.jpg`, { type: 'image/jpeg' })
        const uploaded: any = await uploadAssetFile({ workspaceId: ws, file, source: 'canvas-capture' })
        const assetId = Number(uploaded?.asset?.id || 0)
        if (!assetId) throw new Error('截帧上传失败，请重试')

        // 放在源视频节点右侧，避免叠在它上面
        const width = Number((sourceNode.style as CSSProperties | undefined)?.width || 250) || 250
        const imageNodeId = appendNewNode(
          'image',
          { x: sourceNode.position.x + width + 40, y: sourceNode.position.y },
          {
            ratio: AUTO_RATIO,
            extraData: { assetId, resultUrl: assetStreamUrl(assetId, ws) },
          },
        )
        linkCapturedFrame(nodeId, imageNodeId)
        showToast('已截帧并生成图片节点', 'success')
      } catch (error: any) {
        showToast(String(error?.message || '截帧失败，请重试'), 'error')
      } finally {
        setCapturingNodeId('')
      }
    },
    [workspaceId, capturingNodeId, appendNewNode, linkCapturedFrame],
  )

  /** 时间线改动写回节点 data，并标记草稿待保存（同步由既有的防抖保存链路负责）。 */
  const handleTimelineChange = useCallback(
    (next: TimelineState) => {
      if (!timelineEditorNodeId) return
      // 改动前记一次历史：否则 Ctrl+Z 会越过整段剪辑，直接跳回更早的画布状态
      commitHistory()
      setNodes((items) =>
        items.map((node) =>
          node.id === timelineEditorNodeId ? { ...node, data: { ...node.data, timeline: next } } : node,
        ),
      )
      setSaveStatus('dirty')
    },
    [timelineEditorNodeId, setNodes, setSaveStatus, commitHistory],
  )

  /**
   * 画布上可以加进指定时间线的视频节点。
   *
   * 只列已经有素材的（没有 assetId 就没有可拼的内容），并排除已经在时间线里的，
   * 避免用户挑了一条什么都没发生。
   *
   * 做成「按需调用」而不是 useMemo：节点卡片上的下拉是点开才需要这份列表，
   * 若挂进 context 的值里，任何节点变动都会让所有节点重渲染。
   */
  const getTimelineAddableSources = useCallback(
    (timelineNodeId: string) => {
      if (!timelineNodeId) return []
      const current = latestRef.current.nodes.find((node) => node.id === timelineNodeId)
      const timeline = parseTimelineState((current?.data as Record<string, unknown> | undefined)?.timeline)
      const used = new Set(timeline.clips.map((clip) => clip.sourceNodeId).filter(Boolean))
      return latestRef.current.nodes
        .filter((node) => {
          const data = node.data as Record<string, unknown> | undefined
          if (data?.kind !== 'video') return false
          if (node.id === timelineNodeId || used.has(node.id)) return false
          return Number(data?.assetId || 0) > 0
        })
        .map((node, index) => {
          const data = node.data as Record<string, unknown>
          return {
            nodeId: node.id,
            assetId: Number(data.assetId || 0),
            label: `画布视频 ${index + 1}`,
            thumbnailUrl: resolveNodeMediaUrl(data, workspaceId) || '',
          }
        })
    },
    [workspaceId],
  )

  /**
   * 把画布上的某个视频节点加成时间线片段，并补上对应连线。
   *
   * 走连线模型而不是「游离片段」：画布上看得见哪些节点在喂这条时间线，
   * 和用户手动拉线的结果完全一致，后续断线移除等行为也统一。
   * 时长留 0，交给既有的测量副作用补齐。
   */
  const handleAddTimelineClip = useCallback(
    (targetId: string, sourceNodeId: string) => {
      if (!targetId || !sourceNodeId) return
      const source = latestRef.current.nodes.find((node) => node.id === sourceNodeId)
      const assetId = Number((source?.data as Record<string, unknown> | undefined)?.assetId || 0)
      if (!(assetId > 0)) {
        showToast('该视频还没有生成完成，暂时不能加入时间线', 'error')
        return
      }

      commitHistory()
      setNodes((items) =>
        items.map((node) => {
          if (node.id !== targetId) return node
          const current = parseTimelineState((node.data as Record<string, unknown> | undefined)?.timeline)
          if (current.clips.length >= MAX_TIMELINE_CLIPS) return node
          return { ...node, data: { ...node.data, timeline: attachTimelineSource(current, { sourceNodeId, assetId }) } }
        }),
      )

      // 连线可能已经存在（用户先拉了线、视频后生成完），这时只补片段不重复建边
      setEdges((items) => {
        if (items.some((edge) => edge.source === sourceNodeId && edge.target === targetId)) return items
        const slotIndex = items.filter((edge) => edge.target === targetId).length
        return [
          ...items,
          {
            id: buildEdgeId(sourceNodeId, targetId, slotIndex),
            source: sourceNodeId,
            sourceHandle: null,
            target: targetId,
            targetHandle: null,
            data: { slotIndex },
          },
        ]
      })
      setSaveStatus('dirty')
    },
    [setNodes, setEdges, setSaveStatus, commitHistory],
  )

  /**
   * 拖到哪个时间线节点上了。
   *
   * 用被拖节点的中心点判定：按矩形相交会让「刚碰到边角」也算命中，误触很多。
   * 只接受已经有素材的视频节点——空节点拖进去不会产生片段，高亮就成了假承诺。
   */
  const findTimelineDropTarget = useCallback((dragged: Node): string => {
    const data = dragged.data as Record<string, unknown> | undefined
    if (data?.kind !== 'video' || !(Number(data?.assetId || 0) > 0)) return ''
    const size = (dragged.style || {}) as CSSProperties
    const width = Number(size.width) || dragged.measured?.width || 250
    const height = Number(size.height) || dragged.measured?.height || 250
    const centerX = dragged.position.x + width / 2
    const centerY = dragged.position.y + height / 2

    for (const node of latestRef.current.nodes) {
      if ((node.data as Record<string, unknown> | undefined)?.kind !== 'timeline') continue
      const style = (node.style || {}) as CSSProperties
      const nodeWidth = Number(style.width) || node.measured?.width || TIMELINE_NODE_SIZE.width
      const nodeHeight = Number(style.height) || node.measured?.height || TIMELINE_NODE_SIZE.height
      const withinX = centerX >= node.position.x && centerX <= node.position.x + nodeWidth
      const withinY = centerY >= node.position.y && centerY <= node.position.y + nodeHeight
      if (withinX && withinY) return node.id
    }
    return ''
  }, [])

  /** 从时间线移除一个片段（节点卡片上的 × 与编辑器共用）。 */
  const handleRemoveTimelineClip = useCallback(
    (targetId: string, clipId: string) => {
      if (!targetId || !clipId) return
      commitHistory()
      setNodes((items) =>
        items.map((node) => {
          if (node.id !== targetId) return node
          const current = parseTimelineState((node.data as Record<string, unknown> | undefined)?.timeline)
          return { ...node, data: { ...node.data, timeline: removeTimelineClip(current, clipId) } }
        }),
      )
      setSaveStatus('dirty')
    },
    [setNodes, setSaveStatus, commitHistory],
  )

  /**
   * 合成成片：把时间线的各段在浏览器里无损拼成一条 MP4，再落成素材。
   *
   * 全程不解码不重编码——样本字节原样搬运，因此画质与源片一致，几秒就能出片。
   * 代价是裁剪点会吸附到关键帧，合成后把真实生效的区间写回时间线，
   * 让编辑器显示的和成片里的是同一回事。
   *
   * 合成引擎按需 import()：它只在点「合成」时才用得到，不该压在画布首屏的包里。
   */
  /**
   * 把时间线产出的节点连回时间线本身。
   *
   * 不连线时，剪出/合成的成片落在画布上是一座孤岛：看不出它从哪条时间线来，
   * 隔天再打开只能靠位置猜。连线还是唯一会被持久化的血缘——
   * composedFromNodeId 不在 PERSISTED_NODE_DATA_FIELDS 里，刷新一次就没了，而边是存的。
   *
   * 方向是「时间线 → 成片」：成片是下游产物，同时 timeline 本来就被当作一条视频素材
   * （isCanvasVideoSourceKind），这条边天然是 source_video，不需要为它开特例。
   *
   * 必须定义在两个产出回调之前：useCallback 的依赖数组在渲染时就求值，
   * 定义在后面会直接撞上 const 的暂时性死区，整块画布崩掉。
   */
  const linkTimelineOutput = useCallback(
    (timelineNodeId: string, outputNodeId: string) => {
      const slotIndex = 0
      const edgeId = buildEdgeId(timelineNodeId, outputNodeId, slotIndex)
      setEdges((current) =>
        current.some((edge) => edge.id === edgeId)
          ? current
          : [
              ...current,
              {
                id: edgeId,
                source: timelineNodeId,
                sourceHandle: null,
                target: outputNodeId,
                targetHandle: null,
                data: {
                  slotIndex,
                  role: inferCanvasConnectionRole({
                    targetKind: 'video',
                    sourceKind: 'timeline',
                    videoMode: 'auto',
                    slotIndex,
                  }),
                },
              },
            ],
      )
    },
    [setEdges],
  )

  const handleTimelineCompose = useCallback(
    async (nodeId: string) => {
      if (!nodeId || timelineComposing) return
      const wsId = Number(workspaceId || 0)
      if (!wsId) {
        showToast('workspace_id 缺失，无法合成', 'error')
        return
      }

      const target = latestRef.current.nodes.find((node) => node.id === nodeId)
      let cutlist: TimelineCutlist
      try {
        // 校验不通过时 buildTimelineCutlist 会抛出第一条问题，直接透出给用户
        cutlist = buildTimelineCutlist(
          parseTimelineState((target?.data as Record<string, unknown> | undefined)?.timeline),
        )
      } catch (error) {
        showToast(String((error as Error)?.message || '时间线还不能合成'), 'error')
        return
      }

      setComposingNodeId(nodeId)
      setTimelineComposing(true)
      try {
        const sources: ConcatSource[] = []
        let totalSourceBytes = 0
        for (let index = 0; index < cutlist.clips.length; index += 1) {
          const item = cutlist.clips[index]
          setComposeProgress(`正在读取素材 ${index + 1}/${cutlist.clips.length}`)
          // 无损拼接要读样本表，而 moov 可能在文件尾部，因此必须取完整文件
          const response = await fetch(assetStreamUrl(item.asset_id, wsId), { credentials: 'include' })
          if (!response.ok) throw new Error(`片段 ${index + 1} 素材下载失败（HTTP ${response.status}）`)
          const declaredBytes = Number(response.headers.get('content-length') || 0)
          if (declaredBytes > 0 && totalSourceBytes + declaredBytes > MAX_LOCAL_TIMELINE_SOURCE_BYTES) {
            throw new Error('时间线源视频超过 512MB，浏览器无法安全合成，请减少片段或缩短视频')
          }
          const buffer = await response.arrayBuffer()
          totalSourceBytes += buffer.byteLength
          if (totalSourceBytes > MAX_LOCAL_TIMELINE_SOURCE_BYTES) {
            throw new Error('时间线源视频超过 512MB，浏览器无法安全合成，请减少片段或缩短视频')
          }
          sources.push({
            buffer,
            inSec: item.in_sec,
            outSec: item.out_sec,
            muted: item.muted,
            label: `片段 ${index + 1}`,
          })
        }

        setComposeProgress('正在合成成片…')
        const { concatMp4SourcesAsync } = await import('@/utils/videoConcat')
        // 规格一致时仍是逐字节无损拼接；只有对不上时才重编码，并把进度如实回显——
        // 重编码要逐帧解码再编码，长片可能几十秒，不给进度用户会以为卡死。
        const composed = await concatMp4SourcesAsync(sources, {
          allowTranscode: true,
          onTranscodeProgress: (done, total) => {
            const percent = total > 0 ? Math.min(99, Math.round((done / total) * 100)) : 0
            setComposeProgress(`片段规格不一致，正在重编码 ${percent}%`)
          },
        })

        setComposeProgress('正在保存成片…')
        const file = new File([composed.blob], `时间线成片-${Date.now()}.mp4`, { type: 'video/mp4' })
        const uploaded: any = await uploadAssetFile({ workspaceId: wsId, file })
        const assetId = Number(uploaded?.asset?.id || 0)
        if (!assetId) throw new Error('成片上传失败，未拿到素材 ID')

        // 只回写裁剪点，不动时间线节点自己的素材：
        // 时间线是编辑台，成片是产出物。把成片盖到它身上会顶掉原来的内容，
        // 而且再合成一次就再顶一次，用户拿不回上一版。
        setNodes((items) =>
          items.map((node) => {
            if (node.id !== nodeId) return node
            // 裁剪点回写成吸附后的真实值，编辑器与成片从此一致
            const current = parseTimelineState((node.data as Record<string, unknown> | undefined)?.timeline)
            const clips = current.clips.map((clip, index) => {
              const segment = composed.segments[index]
              if (!segment) return clip
              return { ...clip, inSec: segment.actualInSec, outSec: segment.actualOutSec }
            })
            return { ...node, data: { ...node.data, timeline: { ...current, clips } } }
          }),
        )
        // 成片落成一个独立的视频节点：它能连出去做下一步生成、能单独预览和下载，
        // 而时间线节点保持原样，随时可以改片段再合成一版。
        const timelineNode = latestRef.current.nodes.find((node) => node.id === nodeId)
        if (timelineNode) {
          // 同一条时间线反复合成会产出多个版本，依次向下错开，不互相盖住也不覆盖上一版
          const previousOutputs = latestRef.current.nodes.filter(
            (node) => (node.data as Record<string, unknown> | undefined)?.composedFromNodeId === nodeId,
          ).length
          const timelineWidth = Number((timelineNode.style as CSSProperties | undefined)?.width || 320) || 320
          const outputId = appendNewNode(
            'video',
            {
              x: timelineNode.position.x + timelineWidth + 60,
              y: timelineNode.position.y + previousOutputs * 260,
            },
            {
              ratio: AUTO_RATIO,
              extraData: { assetId, resultUrl: assetStreamUrl(assetId, wsId), composedFromNodeId: nodeId },
            },
          )
          linkTimelineOutput(nodeId, outputId)
        }

        setSaveStatus('dirty')
        // 降级信息要全部说出来，不能只报第一条：丢音和重编码同时发生时，
        // 只显示其中一条会让另一条变成用户永远查不到的「怎么没声音了」
        showToast(
          composed.warnings.length ? `合成完成：${composed.warnings.join('；')}` : '合成完成，成片已添加到画布',
          composed.warnings.length ? 'info' : 'success',
        )
      } catch (error) {
        // 拼接失败的原因是用户可操作的（规格不一致 / 逐段静音），必须原样透出，不要吞成通用文案
        showToast(String((error as Error)?.message || '合成失败，请稍后重试'), 'error')
      } finally {
        setTimelineComposing(false)
        setComposingNodeId('')
        setComposeProgress('')
      }
    },
    [timelineComposing, workspaceId, appendNewNode, linkTimelineOutput, setNodes, setSaveStatus],
  )

  /**
   * 把时间线上选中的一段剪出来：时间线去掉这段，剪出的内容落成画布上的视频节点。
   *
   * 剪出的片段是「某条素材的一个子区间」，不能直接拿 assetId 建节点——那样节点会播放整条素材。
   * 因此每段都走一次单源拼接导出成新素材：单源的规格天然一致，永远是无损的，不会重编码。
   */
  const handleTimelineExtract = useCallback(
    async (nodeId: string, fromSec: number, toSec: number) => {
      const wsId = Number(workspaceId || 0)
      if (!wsId || timelineComposing) return
      const target = latestRef.current.nodes.find((node) => node.id === nodeId)
      if (!target) return

      const current = parseTimelineState((target.data as Record<string, unknown> | undefined)?.timeline)
      const { state: nextState, extracted } = extractTimelineRange(current, fromSec, toSec)
      if (!extracted.length) {
        showToast('所选区间太短，没有可剪出的内容', 'error')
        return
      }

      setComposingNodeId(nodeId)
      setTimelineComposing(true)
      try {
        const { concatMp4Sources } = await import('@/utils/videoConcat')
        const created: Array<{ assetId: number }> = []

        for (let index = 0; index < extracted.length; index += 1) {
          const clip = extracted[index]
          setComposeProgress(`正在导出剪出的片段 ${index + 1}/${extracted.length}`)
          const response = await fetch(assetStreamUrl(clip.assetId, wsId), { credentials: 'include' })
          if (!response.ok) throw new Error(`剪出片段 ${index + 1} 的素材下载失败（HTTP ${response.status}）`)
          const buffer = await response.arrayBuffer()
          if (buffer.byteLength > MAX_LOCAL_TIMELINE_SOURCE_BYTES) {
            throw new Error('源视频超过 512MB，浏览器无法安全导出，请先缩短这段素材')
          }
          // 单源拼接 = 纯裁剪：规格必然一致，走无损路径，画质与源片逐字节相同
          const trimmed = concatMp4Sources([
            { buffer, inSec: clip.inSec, outSec: clip.outSec, muted: clip.muted, label: `剪出片段 ${index + 1}` },
          ])
          const file = new File([trimmed.blob], `剪辑片段-${Date.now()}-${index + 1}.mp4`, { type: 'video/mp4' })
          const uploaded: any = await uploadAssetFile({ workspaceId: wsId, file })
          const assetId = Number(uploaded?.asset?.id || 0)
          if (!assetId) throw new Error(`剪出片段 ${index + 1} 上传失败，未拿到素材 ID`)
          created.push({ assetId })
        }

        // 时间线先更新，再落节点：两步都成功才算剪辑完成，中途失败不会留下半个状态
        setNodes((items) =>
          items.map((node) => (node.id === nodeId ? { ...node, data: { ...node.data, timeline: nextState } } : node)),
        )

        const timelineWidth = Number((target.style as CSSProperties | undefined)?.width || 320) || 320
        const existingOutputs = latestRef.current.nodes.filter(
          (node) => (node.data as Record<string, unknown> | undefined)?.composedFromNodeId === nodeId,
        ).length
        created.forEach((item, index) => {
          const outputId = appendNewNode(
            'video',
            {
              x: target.position.x + timelineWidth + 60,
              y: target.position.y + (existingOutputs + index) * 260,
            },
            {
              ratio: AUTO_RATIO,
              extraData: {
                assetId: item.assetId,
                resultUrl: assetStreamUrl(item.assetId, wsId),
                composedFromNodeId: nodeId,
              },
            },
          )
          linkTimelineOutput(nodeId, outputId)
        })

        setSaveStatus('dirty')
        showToast(created.length > 1 ? `已剪出 ${created.length} 段并添加到画布` : '已剪出选区并添加到画布', 'success')
      } catch (error) {
        showToast(String((error as Error)?.message || '剪辑失败，请稍后重试'), 'error')
      } finally {
        setTimelineComposing(false)
        setComposingNodeId('')
        setComposeProgress('')
      }
    },
    [timelineComposing, workspaceId, appendNewNode, linkTimelineOutput, setNodes, setSaveStatus],
  )

  /**
   * 交给节点卡片的动作集合。
   *
   * 必须声明在上面这些 handler 之后：依赖数组是就地求值的，提前声明会撞上 TDZ。
   */
  const nodeActions = useMemo<CanvasNodeActions>(
    () => ({
      onCaptureFrame: handleCaptureFrame,
      capturingNodeId,
      timeline: {
        getAddableSources: getTimelineAddableSources,
        onAddClip: handleAddTimelineClip,
        onRemoveClip: handleRemoveTimelineClip,
        onCompose: handleTimelineCompose,
        onOpenEditor: setTimelineEditorNodeId,
        composingNodeId,
        composeProgress,
      },
    }),
    [
      handleCaptureFrame,
      capturingNodeId,
      getTimelineAddableSources,
      handleAddTimelineClip,
      handleRemoveTimelineClip,
      handleTimelineCompose,
      composingNodeId,
      composeProgress,
    ],
  )

  const handleAddNode = useCallback(
    (type: string) => {
      // 时间线卡片是可直接操作的编辑面（预览 + 片段条 + 操作行），要给足高度
      const size = type === 'timeline' ? TIMELINE_NODE_SIZE : { width: type === 'video' ? 444 : 250, height: 250 }
      /*
       * 落点：视口中心，再避开已有节点。
       *
       * 这里原本是 { x: 300 + random*200, y: 200 + random*200 } —— 画布固定坐标，
       * 既与当前视口无关（平移过就落到屏幕外），也完全不看已有节点。
       * 于是新节点经常正好压在旧节点上，而 React Flow 会把选中节点抬到 z-index:1000，
       * 被盖住的那个连按钮都点不到：新建的时间线节点播放/精修/合成全部失效。
       */
      const center = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
      const position = findFreeNodePosition({
        anchor: { x: center.x - size.width / 2, y: center.y - size.height / 2 },
        size,
        occupied: latestRef.current.nodes.map((node) => {
          const style = (node.style || {}) as CSSProperties
          return {
            x: node.position.x,
            y: node.position.y,
            width: Number(style.width) || node.measured?.width || 250,
            height: Number(style.height) || node.measured?.height || 250,
          }
        }),
      })
      appendNewNode(type, position, {
        ratio: inheritNodeRatio(type),
        ...(type === 'timeline' ? { size: TIMELINE_NODE_SIZE } : {}),
      })
    },
    [appendNewNode, inheritNodeRatio, screenToFlowPosition],
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
      appendNewNode(type, { x: flowX - nodeW / 2, y: flowY - nodeH / 2 }, { ratio: inheritNodeRatio(type) })
      setContextMenu(null)
    },
    [contextMenu, transform, appendNewNode, inheritNodeRatio],
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
        assetId: (node.data as any)?.assetId,
        text: (node.data as any)?.text,
        prompt: (node.data as any)?.prompt,
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
        : // 拖着视频节点悬在时间线上：高亮该时间线，让「松手会放进这里」在松手前就看得见
          timelineDropTargetId
          ? nodes.map((n) =>
              n.id === timelineDropTargetId
                ? { ...n, className: n.className ? `${n.className} is-timeline-drop` : 'is-timeline-drop' }
                : n,
            )
          : nodes

  // 为所有来源的连线补上方向箭头：包含历史恢复、协作增量同步和本次新建的连线。
  // 保留边自身显式配置，便于未来为特殊边型定义不同的起止标记。
  const displayEdges = useMemo(
    () =>
      edges.map((edge) => ({
        ...edge,
        markerEnd: edge.markerEnd ?? CANVAS_EDGE_END_MARKER,
      })),
    [edges],
  )

  return (
    <CanvasNodeActionsContext.Provider value={nodeActions}>
      <div
        className="canvas-view"
        onDragEnter={handleFileDragEnter}
        onDragOver={handleFileDragOver}
        onDragLeave={handleFileDragLeave}
        onDrop={handleFileDrop}
      >
        <div className="canvas-brand">
          <img src={brandLogo} alt="帧智汇" className="canvas-brand-logo" />
          <div className="canvas-brand-text">
            <span className="canvas-brand-name">帧智汇</span>
            <DraftSaveIndicator status={saveStatus} />
            {cloudStatus !== 'online' && (
              <span className={`canvas-cloud-status is-${cloudStatus}`} title={cloudMessage}>
                {cloudMessage}
              </span>
            )}
          </div>
        </div>

        {/* 独立返回按钮：始终显示，不随工具栏/抽屉隐藏或消失 */}
        <button
          className="canvas-back-btn"
          onClick={() => navigate('/canvas')}
          title="返回画布列表"
          aria-label="返回画布列表"
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M19 12H5" />
            <path d="m12 19-7-7 7-7" />
          </svg>
        </button>

        {/* 抽屉未打开（或正在播放收起动画）时渲染工具栏 */}
        {!drawerPanel && (
          <CanvasFloatingToolbar
            leaving={toolbarLeaving}
            onAddNode={handleAddNode}
            moveEnabled={moveEnabled}
            onMoveToggle={handleMoveToggle}
            dragEnabled={dragEnabled}
            onDragToggle={handleDragToggle}
            onAddLocalImage={() => openLocalImagePicker()}
            onOpenAssets={() => openDrawerPanel('assets')}
            onOpenHistory={() => openDrawerPanel('history')}
          />
        )}

        {/* 剪辑时间线编辑器：节点上的「精修」或双击打开，用于逐帧裁剪与分割；
          加片段/删片段/合成在节点卡片上就能做，不必进这里 */}
        {timelineEditorNode && (
          <CanvasTimelineEditor
            open
            workspaceId={Number(workspaceId || 0)}
            state={timelineEditorState}
            onChange={handleTimelineChange}
            onClose={() => setTimelineEditorNodeId('')}
            onCompose={() => void handleTimelineCompose(timelineEditorNodeId)}
            onAddClip={(sourceNodeId) => handleAddTimelineClip(timelineEditorNodeId, sourceNodeId)}
            addableSources={editorAddableSources}
            pendingSourceCount={timelineEditorPendingCount}
            composing={timelineComposing}
            composeProgress={composeProgress}
            compatibilityNote={TIMELINE_COMPOSE_NOTE}
            // 剪出选中片段：按它在成片时间轴上的起止换算成区间，交给同一套剪出逻辑
            onAddClipToCanvas={(clip) => {
              const offsets = getClipOffsets(timelineEditorState)
              const index = (timelineEditorState.clips || []).findIndex((item) => item.id === clip.id)
              if (index < 0) return
              const fromSec = offsets[index]
              void handleTimelineExtract(timelineEditorNodeId, fromSec, fromSec + getClipDuration(clip))
            }}
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

        {/* 隐藏文件选择：由工具栏 / 右键菜单「本地图片」触发，支持一次选择多张 */}
        <input
          ref={localImageInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={handleLocalImageInputChange}
        />

        {/* 拖拽文件到画布时的提示遮罩 */}
        {fileDragActive && (
          <div className="canvas-drop-overlay">
            <div className="canvas-drop-overlay__card">
              <svg
                width="34"
                height="34"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 16V4" />
                <path d="m6 10 6-6 6 6" />
                <path d="M4 20h16" />
              </svg>
              <strong>松开即可添加到画布</strong>
              <span>支持拖入本地图片，也可以直接 Ctrl+V 粘贴</span>
            </div>
          </div>
        )}

        {/* 参考选择横幅 */}
        {isPickingRef && (
          <div className="canvas-pick-banner">
            <span className="canvas-pick-banner__text">{pickError || '从画布选择参考'}</span>
            <button className="canvas-pick-banner__exit" onClick={stopPickRef}>
              退出
            </button>
          </div>
        )}

        {/* 箭头定义必须常驻、且先于任何连线存在于文档中，否则新建的第一条线要刷新才有箭头 */}
        <CanvasEdgeArrowDefs />

        {/* 节点内的动作（截帧、时间线增删与合成）经 context 交回这里执行：
          回调不能塞进节点 data——data 会被持久化，放不了函数 */}
        <CanvasNodeActionsContext.Provider value={nodeActions}>
          <ReactFlow
            nodes={displayNodes}
            edges={displayEdges}
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
            onBeforeDelete={handleBeforeDelete}
            onNodesDelete={handleNodesDelete}
            onEdgesDelete={handleEdgesDelete}
            connectionMode={ConnectionMode.Loose}
            connectionRadius={60}
            /* 禁用多选：任何情况下都只允许同时选中一个节点 */
            multiSelectionKeyCode={null}
            /* 双击时间线节点打开剪辑编辑器（其余节点保持原行为） */
            onNodeDoubleClick={(_e, node) => {
              if ((node.data as Record<string, unknown> | undefined)?.kind === 'timeline') {
                setTimelineEditorNodeId(node.id)
              }
            }}
            /* 拖动开始前记录历史：撤销可还原节点位置 */
            onNodeDragStart={(_e, node) => {
              commitHistory()
              // 节点按下后轻微移动（>拖拽阈值）会被判定为拖拽而非点击，onNodeClick 不触发，
              // 导致首次点击有概率选不中；拖拽开始同样立即选中，保证稳定响应
              handleSelectNodeOnDown(node as unknown as Node)
              // 记下起点：拖到时间线上时要把节点弹回原位，不能让它压在时间线底下
              dragOriginRef.current = { id: node.id, position: { ...node.position } }
            }}
            /* 拖动中高亮可接收的时间线节点，让「能不能放进去」在松手前就看得见 */
            onNodeDrag={(_e, node) => setTimelineDropTargetId(findTimelineDropTarget(node))}
            onNodeDragStop={(_e, node) => {
              const targetId = findTimelineDropTarget(node)
              setTimelineDropTargetId('')
              if (!targetId) return
              handleAddTimelineClip(targetId, node.id)
              // 弹回原位：视频节点是被「拖进」时间线的，本身不该留在时间线的位置上
              const origin = dragOriginRef.current
              if (origin?.id === node.id) {
                setNodes((items) =>
                  items.map((item) => (item.id === node.id ? { ...item, position: origin.position } : item)),
                )
              }
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
                assetId: (node.data as any)?.assetId,
                text: (node.data as any)?.text,
                prompt: (node.data as any)?.prompt,
                operationCode: (node.data as any)?.operationCode,
                params: (node.data as any)?.params,
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
            /*
             * 缩放范围。
             *
             * React Flow 默认 minZoom 是 0.5，节点一多就会「缩到一半再也缩不动」，
             * 复位视图同样受此限制——画布装不下时 fitView 也只能停在 0.5，看不到全貌。
             * 放到 0.02（50 倍）足以俯瞰几百个节点，且仍是有限值：
             * 真的做成无下限会让视口在极小倍率下失去精度，反而拖不动、点不中。
             */
            minZoom={MIN_CANVAS_ZOOM}
            maxZoom={MAX_CANVAS_ZOOM}
            defaultViewport={{ x: 0, y: 0, zoom: 0.8 }}
            fitView
            fitViewOptions={{ padding: 0.2, minZoom: MIN_CANVAS_ZOOM, maxZoom: MAX_CANVAS_ZOOM }}
            proOptions={{ hideAttribution: true }}
          >
            <Background />
          </ReactFlow>
        </CanvasNodeActionsContext.Provider>

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
            <button
              type="button"
              className="canvas-context-menu__item"
              onClick={() => {
                const anchor = { x: contextMenu.x, y: contextMenu.y }
                setContextMenu(null)
                openLocalImagePicker(anchor)
              }}
            >
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
                  <path d="M12 16V4" />
                  <path d="m6 10 6-6 6 6" />
                  <path d="M4 20h16" />
                </svg>
              </span>
              本地图片
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
          items={realHistoryItems}
          onClose={closeDrawerPanel}
          onSelect={(item: HistoryItem) => {
            const node = nodes.find((candidate) => candidate.id === item.nodeId)
            if (!node) return
            setNodes((current) => current.map((candidate) => ({ ...candidate, selected: candidate.id === node.id })))
            setSelectedNode({
              id: node.id,
              kind: String((node.data as any)?.kind || node.type || 'image'),
              sourceRefs: getSourceRefs(node.id),
              ratio: (node.data as any)?.ratio,
              videoMode: (node.data as any)?.videoMode,
              modelVersionId: (node.data as any)?.modelVersionId,
              resultUrl: (node.data as any)?.resultUrl,
              assetId: (node.data as any)?.assetId,
              text: (node.data as any)?.text,
              prompt: (node.data as any)?.prompt,
              operationCode: (node.data as any)?.operationCode,
              params: (node.data as any)?.params,
            })
            void fitView({ nodes: [node], padding: 0.5, duration: 300 })
            closeDrawerPanel()
          }}
        />

        {/* 节点编辑面板 — 跟随选中节点显示在其下方；算不出锚点时回落到底部居中。
          时间线节点没有模型/提示词的概念，编辑入口是双击打开的剪辑编辑器，这里不渲染面板。 */}
        {selectedNode && selectedNode.kind !== 'timeline' && (
          <div
            ref={panelRef}
            className={`canvas-panel-area${panelAnchor ? ' is-anchored' : ''}`}
            style={panelAnchor ? { left: panelAnchor.left, top: panelAnchor.top } : undefined}
          >
            <CanvasNodePanel
              node={selectedNode}
              workspaceId={workspaceId}
              onStartPickRef={(slotIndex) => selectedNode && startPickRef(selectedNode.id, slotIndex)}
              onRemoveRef={handleRemoveRef}
              onRatioChange={handleRatioChange}
              onVideoModeChange={handleVideoModeChange}
              onModelChange={handleModelChange}
              onGenerate={handleNodeGenerate}
              onInsufficientCredits={handleInsufficientCredits}
              onSaveText={handleSaveNodeText}
              onPromptChange={handleNodePromptChange}
              onParamsChange={handleNodeParamsChange}
              inheritedTexts={inheritedPromptTexts}
              onAdoptInheritedText={handleAdoptInheritedText}
              onPolishText={handlePolishNodeText}
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
    </CanvasNodeActionsContext.Provider>
  )
}
