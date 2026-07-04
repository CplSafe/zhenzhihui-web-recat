/*
  StoryboardGenerationPanel — 分镜图生成面板（大组件）
  管理分镜图批量生成全流程：图片网格展示、拖拽排序、单张编辑/替换/插入、版本历史切换、
  人物脱敏开关、AI 建议插入分镜。与 creativeStoryboards 状态双向同步。

  React 迁移说明：原组件用自定义 pointer 事件做堆叠卡片的拖拽排序（非 HTML5 native drag，
  也非 sortable list），与舞台缩放/堆叠位移强耦合，因此忠实保留 pointer 编排逻辑，
  用 useRef 持有可变拖拽中间态、useState 持有触发渲染的展示态。
*/
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { CSSProperties } from 'react'
import './StoryboardGenerationPanel.css'

// 与分镜舞台布局相关的基础常量。
const PLACEHOLDER_ID = '__placeholder__'
const MAX_STORYBOARD_IMAGES = 9
const STACK_CARD_HEIGHT_PX = 376
const STACK_REVEAL_PX = 30
const EXPANDED_GAP_PX = 8
const STAGE_BASE_WIDTH = 1264

const PREVIEW_STACK_SHIFT_PX = 12
const PREVIEW_STACK_EXPANDED_GAP_PX = 12
const PREVIEW_STACK_CARD_SIZE_PX = 84

export interface StoryboardPanelItem {
  id: string
  title?: string
  src?: string
  status?: string
  versionHistory?: any[]
  currentVersionIndex?: number
  historyImages?: string[]
  [key: string]: any
}

export interface StoryboardGenerationPanelProps {
  panelStyle: CSSProperties
  isLibraryOpen?: boolean
  selectedRatio?: string
  items: StoryboardPanelItem[]
  total: number
  generatedCount: number
  isGenerating?: boolean
  nextTitle?: string
  canGenerateTimeline?: boolean
  historyItems?: any[]
  isSubmittingEdit?: boolean
  insertIdeaText?: string
  insertIdeaLoading?: boolean
  selectedMaterials?: any[]
  // events
  onPreview?: (...args: any[]) => void
  onRemove?: (id: string) => void
  onReorder?: (payload: { fromId: string; toId: string }) => void
  onRegenerate?: () => void
  onGenerateStoryboard?: () => void
  onGenerateTimeline?: () => void
  onSelectItem?: (id: string) => void
  onModifyImage?: (payload: { itemId: string; prompt: string }) => void
  onStepImageVersion?: (payload: any) => void
  onSetImageVersion?: (payload: { itemId: string; index: number }) => void
  onRemoveImageVersion?: (payload: { itemId: string; index: number }) => void
  onInsertItem?: (payload: any) => void
  onSuggestInsertIdea?: (payload: any) => void
  onResetInsertIdea?: () => void
  onOpenLibrary?: () => void
  onRemoveMaterial?: (materialId: string | number) => void
  onUploadInsertStoryboard?: (payload: { file: File; anchorId: string; side: string }) => void
  onUploadReplaceStoryboard?: (file: File) => void
  onAnalyzeReferenceImage?: (material: any) => void
  onCancelAiAnalyze?: () => void
}

function ratioToCssAspect(value: any) {
  const text = String(value || '').trim()
  const match = text.match(/^(\d+)\s*:\s*(\d+)$/)
  if (!match) return '9 / 16'
  const w = Number.parseInt(match[1], 10)
  const h = Number.parseInt(match[2], 10)
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return '9 / 16'
  return `${w} / ${h}`
}

function parseRatioNumbers(value: any) {
  const text = String(value || '').trim()
  const match = text.match(/^(\d+)\s*:\s*(\d+)$/)
  if (!match) return null
  const w = Number.parseInt(match[1], 10)
  const h = Number.parseInt(match[2], 10)
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null
  return { w, h }
}

function clampNumber(value: any, min: number, max: number) {
  const v = Number(value)
  if (!Number.isFinite(v)) return min
  return Math.min(Math.max(v, min), max)
}

export default function StoryboardGenerationPanel(props: StoryboardGenerationPanelProps) {
  const {
    panelStyle,
    selectedRatio = '9:16',
    items,
    total,
    generatedCount,
    isGenerating = false,
    isSubmittingEdit = false,
    insertIdeaText = '',
    insertIdeaLoading = false,
    selectedMaterials = [],
    onRemove,
    onReorder,
    onRegenerate,
    onGenerateStoryboard,
    onSelectItem,
    onModifyImage,
    onSetImageVersion,
    onRemoveImageVersion,
    onInsertItem,
    onResetInsertIdea,
    onOpenLibrary,
    onRemoveMaterial,
    onUploadInsertStoryboard,
    onUploadReplaceStoryboard,
    onAnalyzeReferenceImage,
    onCancelAiAnalyze,
  } = props

  // —— DOM refs ——
  const trackRef = useRef<HTMLDivElement | null>(null)
  const containerRef = useRef<HTMLElement | null>(null)
  const viewRef = useRef<HTMLDivElement | null>(null)
  const insertComposerRef = useRef<HTMLElement | null>(null)

  // —— 展示态（触发渲染）——
  const [dragOverId, setDragOverId] = useState('')
  const [pointerDraggingId, setPointerDraggingId] = useState('')
  const [dragDeltaX, setDragDeltaX] = useState(0)
  const [dragDeltaY, setDragDeltaY] = useState(0)
  const [pointerWasDragged, setPointerWasDragged] = useState(false)
  const [insertComposerPos, setInsertComposerPos] = useState({ x: 0, y: 0 })
  const [insertAnchorId, setInsertAnchorId] = useState('')
  const [insertSide, setInsertSide] = useState('right')
  const [editorMode, setEditorMode] = useState('')
  const [editorText, setEditorText] = useState('')
  const [editorLocked, setEditorLocked] = useState(false)
  const [showInsertHint, setShowInsertHint] = useState(false)
  const [lastInsertPrompt] = useState('')
  const [insertIdeaDraft, setInsertIdeaDraft] = useState('')
  const [insertIdeaEditing] = useState(false)
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false)
  const [aiAnalyzing, setAiAnalyzing] = useState(false)
  const [insertSlotLayoutToken, setInsertSlotLayoutToken] = useState(0)
  const [stackPushIndex, setStackPushIndex] = useState(-1)
  const [stackPushDistancePx, setStackPushDistancePx] = useState(0)
  const [imageSizeById, setImageSizeById] = useState<Record<string, { w: number; h: number }>>({})
  const [trackInnerWidth, setTrackInnerWidth] = useState(0)
  const [stageScale, setStageScale] = useState(1)
  const [activeCardId, setActiveCardId] = useState('')
  const [, setActionOverlayPos] = useState({ left: 0, bottom: 0 })
  const [previewExpanded, setPreviewExpanded] = useState(false)
  const [imageStatusById, setImageStatusById] = useState<Record<string, string>>({})

  // —— 可变镜像（拖拽过程读最新值，不触发渲染）——
  const pointerDraggingIdRef = useRef('')
  const pointerStartXRef = useRef(0)
  const pointerStartYRef = useRef(0)
  const pointerScaleRef = useRef(1)
  const pointerOffsetXRef = useRef(0)
  const pointerOffsetYRef = useRef(0)
  const dragDeltaXRef = useRef(0)
  const dragDeltaYRef = useRef(0)
  const pointerWasDraggedRef = useRef(false)
  const suppressPreviewClickRef = useRef(false)
  const dragArmedRef = useRef(false)
  const dragArmTimerRef = useRef(0)
  const activePointerIdRef = useRef<number | null>(null)
  const activePointerCaptureElRef = useRef<any>(null)
  // 记录实际绑定到 window 的拖拽处理函数实例：这些函数是普通函数声明，每次渲染都会重新创建，
  // 若直接用渲染时的标识 add/remove，跨渲染（含卸载清理）时标识不一致会导致监听器无法移除而泄漏。
  const attachedPointerMoveRef = useRef<((event: any) => void) | null>(null)
  const attachedPointerUpRef = useRef<((event: any) => void) | null>(null)
  const attachedPointerCancelRef = useRef<(() => void) | null>(null)
  const stageScaleRef = useRef(1)
  const pendingInsertHintRef = useRef(false)
  const editorModeRef = useRef('')
  const activeCardIdRef = useRef('')
  const insertAnchorIdRef = useRef('')
  const insertSideRef = useRef('right')
  const sourceMenuOpenRef = useRef(false)
  const containerResizeObserverRef = useRef<ResizeObserver | null>(null)
  const trackResizeObserverRef = useRef<ResizeObserver | null>(null)

  // 让 ref 镜像始终跟随最新展示态
  stageScaleRef.current = stageScale
  editorModeRef.current = editorMode
  activeCardIdRef.current = activeCardId
  insertAnchorIdRef.current = insertAnchorId
  insertSideRef.current = insertSide
  sourceMenuOpenRef.current = sourceMenuOpen
  pointerDraggingIdRef.current = pointerDraggingId
  pointerWasDraggedRef.current = pointerWasDragged
  dragDeltaXRef.current = dragDeltaX
  dragDeltaYRef.current = dragDeltaY

  // 把当前 props 暴露给全局事件回调读取
  const propsRef = useRef(props)
  propsRef.current = props

  // ---- 派生 setter 工具：同步更新 ref + state ----
  const setPointerDragging = (v: string) => {
    pointerDraggingIdRef.current = v
    setPointerDraggingId(v)
  }
  const setWasDragged = (v: boolean) => {
    pointerWasDraggedRef.current = v
    setPointerWasDragged(v)
  }
  const setDeltaX = (v: number) => {
    dragDeltaXRef.current = v
    setDragDeltaX(v)
  }
  const setDeltaY = (v: number) => {
    dragDeltaYRef.current = v
    setDragDeltaY(v)
  }

  // ======== 舞台缩放 ========
  function getStageScale() {
    const v = Number(stageScaleRef.current)
    if (!Number.isFinite(v) || v <= 0) return 1
    return v
  }

  const updateStageScale = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const width = Math.max(1, rect.width || container.clientWidth || 1)
    const nextScale = Math.min(width / STAGE_BASE_WIDTH, 1)
    const snappedScale = Math.round(nextScale * 100) / 100
    const final = Number.isFinite(snappedScale) && snappedScale > 0 ? snappedScale : 1
    stageScaleRef.current = final
    setStageScale(final)
  }, [])

  // 右侧参考素材预览栈
  const previewStackMaterials = useMemo(() => {
    const list = Array.isArray(selectedMaterials) ? selectedMaterials : []
    return list.filter((item) => item?.src).slice(-3)
  }, [selectedMaterials])

  // ======== 版本状态工具 ========
  // ======== 展示派生量 ========
  const displayTotal = Math.min(Math.max(total, 1), MAX_STORYBOARD_IMAGES)
  const displayGeneratedCount = Math.min(Math.max(generatedCount, 0), displayTotal)
  const progressPercent = `${Math.min((displayGeneratedCount / displayTotal) * 100, 100)}%`
  const placeholderIndex = Math.min(displayGeneratedCount + 1, displayTotal)

  function isLoadingItem(item: any) {
    if (!item) return false
    if (hasStoryboardImage(item)) return false
    if (isFailedItem(item)) return false
    const status = String(item.status || '').toLowerCase()
    return ['submitting', 'submitted', 'queued', 'running', 'processing'].includes(status)
  }

  function isWaitingItem(item: any) {
    if (!item) return false
    if (hasStoryboardImage(item)) return false
    if (isFailedItem(item)) return false
    const status = String(item.status || '').toLowerCase()
    if (status === 'pending') return true
    return !status && !isGenerating
  }

  function isEditingItem(item: any) {
    if (!item) return false
    return Boolean(isSubmittingEdit && activeCardId && item.id === activeCardId)
  }

  function hasStoryboardImage(item: any) {
    return Boolean(String(item?.src || '').trim())
  }

  function isFailedItem(item: any) {
    const status = String(item?.status || '').toLowerCase()
    return ['failed', 'error', 'rejected'].includes(status)
  }

  const shouldShowPlaceholder = useMemo(() => {
    if (!isGenerating) return false
    if (items.length) return false
    if (displayGeneratedCount >= displayTotal) return false
    const hasLoadingItem = items.some((item) => isLoadingItem(item))
    return !hasLoadingItem
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGenerating, items, displayGeneratedCount, displayTotal])

  const canInsertMore = items.length < MAX_STORYBOARD_IMAGES
  const activeItem = items.find((item) => item.id === activeCardId) || null

  const isInsertComposerReady = (() => {
    if (editorMode === 'modify') {
      return Boolean(activeCardId) && !isSubmittingEdit
    }
    if (editorMode === 'insert') {
      return Boolean(insertAnchorId) && canInsertMore && !isGenerating
    }
    return false
  })()

  const hasReferenceImages = previewStackMaterials.length > 0
  const storyboardAspect = parseRatioNumbers(selectedRatio) || { w: 9, h: 16 }
  const storyboardStyle: CSSProperties = {
    ...panelStyle,
    ['--storyboard-aspect-ratio' as any]: ratioToCssAspect(selectedRatio),
    ['--storyboard-aspect-w' as any]: storyboardAspect.w,
    ['--storyboard-aspect-h' as any]: storyboardAspect.h,
    ['--storyboard-aspect-padding' as any]: `${(storyboardAspect.h / storyboardAspect.w) * 100}%`,
    ['--storyboard-stage-scale' as any]: stageScale,
  } as any

  // ======== 图片尺寸/卡片宽度 ========
  function getKnownImageRatio(item: any) {
    const id = String(item?.id || '').trim()
    if (!id || id === PLACEHOLDER_ID) return null
    const record = imageSizeById?.[id]
    const w = Number(record?.w || 0)
    const h = Number(record?.h || 0)
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null
    return { w, h }
  }

  function getItemAspect(item: any) {
    const known = getKnownImageRatio(item)
    if (known) return known
    return parseRatioNumbers(selectedRatio) || { w: 9, h: 16 }
  }

  function getItemCardWidthPx(item: any) {
    const { w, h } = getItemAspect(item)
    const ww = Number(w || 9)
    const hh = Number(h || 16)
    if (!Number.isFinite(ww) || !Number.isFinite(hh) || ww <= 0 || hh <= 0) return 282
    return Math.round(STACK_CARD_HEIGHT_PX * (ww / hh))
  }

  function getImageButtonStyle(item: any): CSSProperties {
    const { w, h } = getItemAspect(item)
    return {
      ['--storyboard-aspect-ratio' as any]: `${w} / ${h}`,
    } as any
  }

  // 在 isStackMode 内 index>0 时叠加负 margin（依赖 isStackMode，下方计算）
  function getStackLayoutStyle(item: any, index?: number): CSSProperties | undefined {
    const width = getItemCardWidthPx(item)
    if (!width || width <= 0) return undefined
    const style: CSSProperties = { width: `${width}px` }
    if (isStackMode && typeof index === 'number' && index > 0) {
      style.marginLeft = `-${Math.max(0, width - STACK_REVEAL_PX)}px`
    }
    return style
  }

  // ======== 图片加载诊断 ========
  const debugImages =
    typeof window !== 'undefined' && /[?&]imgdebug=1\b/.test(window.location.search || '')

  function setImageStatus(item: any, state: string) {
    const id = String(item?.id || '').trim()
    if (!id || id === PLACEHOLDER_ID) return
    setImageStatusById((prev) => ({ ...prev, [id]: state }))
  }

  function shortSrc(src: any) {
    const value = String(src || '')
    if (!value) return '(空 src)'
    if (value.startsWith('blob:')) return 'blob:'
    if (value.startsWith('data:')) return 'data:'
    try {
      const u = new URL(value, window.location.href)
      return `${u.protocol}//${u.host}`
    } catch {
      return value.slice(0, 40)
    }
  }

  function imageDebugLabel(item: any) {
    const id = String(item?.id || '').trim()
    const state = imageStatusById[id] || (item?.src ? 'pending' : 'no-src')
    return `${state} · ${shortSrc(item?.src)}`
  }

  function handleImageLoad(item: any, event: any) {
    setImageStatus(item, 'load')
    const id = String(item?.id || '').trim()
    if (!id || id === PLACEHOLDER_ID) return
    const img = event?.target
    const w = Number(img?.naturalWidth || 0)
    const h = Number(img?.naturalHeight || 0)
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return
    setImageSizeById((prev) => ({ ...prev, [id]: { w, h } }))
    requestAnimationFrame(() => updateTrackInnerWidth())
  }

  function handleImageError(item: any) {
    setImageStatus(item, 'error')
  }

  const updateTrackInnerWidth = useCallback(() => {
    const track = trackRef.current
    if (!track) return
    const rect = track.getBoundingClientRect?.()
    const style = window.getComputedStyle?.(track)
    const padLeft = style ? Number.parseFloat(style.paddingLeft || '0') : 0
    const padRight = style ? Number.parseFloat(style.paddingRight || '0') : 0
    const paddingX = (Number.isFinite(padLeft) ? padLeft : 0) + (Number.isFinite(padRight) ? padRight : 0)
    const width = rect?.width || track.clientWidth || 0
    setTrackInnerWidth(Math.max(0, width - paddingX))
  }, [])

  // ======== 视觉 id 列表 / 堆叠模式 ========
  const visualIds = useMemo(() => {
    const ids = items.map((item) => item.id)
    const hasPlaceholder = shouldShowPlaceholder
    if (!ids.length) {
      return hasPlaceholder ? [PLACEHOLDER_ID] : []
    }
    return hasPlaceholder ? [...ids, PLACEHOLDER_ID] : ids
  }, [items, shouldShowPlaceholder])

  const visualIndexById = useMemo(() => {
    const map = new Map<string, number>()
    visualIds.forEach((id, index) => map.set(id, index))
    return map
  }, [visualIds])

  const expandedTotalWidth = useMemo(() => {
    const ids = visualIds
    if (!ids.length) return 0
    let totalW = 0
    for (let i = 0; i < ids.length; i += 1) {
      const id = ids[i]
      const item = id === PLACEHOLDER_ID ? { id: PLACEHOLDER_ID } : items.find((it) => it.id === id)
      const width = getItemCardWidthPx(item)
      totalW += width
      if (i > 0) totalW += EXPANDED_GAP_PX
    }
    return totalW
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visualIds, items, imageSizeById, selectedRatio])

  const isStackMode = (() => {
    const inner = trackInnerWidth
    if (!inner) return false
    return expandedTotalWidth > inner
  })()

  // ======== 历史版本 ========
  const historyEntries = useMemo(() => {
    const item = activeItem
    if (!item) return []
    const history = Array.isArray(item.versionHistory) ? item.versionHistory : []
    if (!history.length) return []
    const index = Number(item.currentVersionIndex || 0)
    const currentIndex = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0
    const entries: { src: string; index: number }[] = []
    for (let i = history.length - 1; i >= 0; i -= 1) {
      if (i === currentIndex) continue
      const src = String(history[i]?.src || '').trim()
      if (!src) continue
      entries.push({ src, index: i })
      if (entries.length >= 10) break
    }
    return entries
  }, [activeItem])

  const historyPanelStyle: CSSProperties = (() => {
    const width = 176
    const gap = 14
    const x = Math.max(0, insertComposerPos.x - width - gap)
    const y = Math.max(0, insertComposerPos.y)
    return { transform: `translate3d(${x}px, ${y}px, 0)` }
  })()

  const editorTitle = editorMode === 'modify' ? '图片修改' : '添加分镜图片'
  const editorPlaceholder = (() => {
    const refHint = hasReferenceImages ? '已添加参考图，可直接发送或补充文字描述' : ''
    if (editorMode === 'modify') {
      if (!activeCardId) return '请选择一张分镜图片后输入修改描述'
      return refHint || '请输入此张图片修改描述，例如"我要在手机屏幕里加一些蔬菜元素..."'
    }
    if (editorMode === 'insert') {
      return refHint || '请输入分镜图片描述，例如"我要增加一个外卖员送餐时的画面..."'
    }
    return '点击分镜间的+号，添加新画面'
  })()

  const editorHintStyle: CSSProperties = {
    transform: `translate3d(${insertComposerPos.x}px, ${insertComposerPos.y + 120}px, 0)`,
  }
  const insertHintText = '新增图片生成完成 可直接编辑修改或在对话框中输入修改意见'
  const insertHintDescription = lastInsertPrompt
  const isBusy = isGenerating || isSubmittingEdit

  const visibleInsertSlots = useMemo(() => {
    const id = String(activeCardId || '').trim()
    if (!id) return []
    const index = items.findIndex((item) => item.id === id)
    if (index < 0) return []
    return [
      { key: `edge-left-${id}`, anchorId: id, side: 'left', edge: 'left', itemIndex: index },
      { key: `edge-right-${id}`, anchorId: id, side: 'right', edge: 'right', itemIndex: index },
    ]
  }, [activeCardId, items])

  // ======== 插入编排弹层定位 ========
  function resetPointerDrag() {
    // 用实际绑定时保存的函数实例移除，避免跨渲染标识不一致导致移除失败。
    if (attachedPointerMoveRef.current) {
      window.removeEventListener('pointermove', attachedPointerMoveRef.current)
      attachedPointerMoveRef.current = null
    }
    if (attachedPointerUpRef.current) {
      window.removeEventListener('pointerup', attachedPointerUpRef.current)
      attachedPointerUpRef.current = null
    }
    if (attachedPointerCancelRef.current) {
      window.removeEventListener('pointercancel', attachedPointerCancelRef.current)
      attachedPointerCancelRef.current = null
    }
    if (activePointerCaptureElRef.current && activePointerIdRef.current !== null) {
      try {
        activePointerCaptureElRef.current.releasePointerCapture?.(activePointerIdRef.current)
      } catch {
        // Pointer capture may already have been released by the browser.
      }
    }
    activePointerIdRef.current = null
    activePointerCaptureElRef.current = null
    if (dragArmTimerRef.current) {
      window.clearTimeout(dragArmTimerRef.current)
      dragArmTimerRef.current = 0
    }
    setPointerDragging('')
    pointerStartXRef.current = 0
    pointerStartYRef.current = 0
    pointerScaleRef.current = 1
    pointerOffsetXRef.current = 0
    pointerOffsetYRef.current = 0
    setDeltaX(0)
    setDeltaY(0)
    setWasDragged(false)
    dragArmedRef.current = false
    setDragOverId('')
  }

  function getInsertComposerSize() {
    const scale = getStageScale()
    const el = insertComposerRef.current
    if (!el) return { width: 800, height: 108 }
    const rect = el.getBoundingClientRect()
    return {
      width: Math.max(1, Math.round((rect.width || (el as any).offsetWidth || 800) / scale)),
      height: Math.max(1, Math.round((rect.height || (el as any).offsetHeight || 108) / scale)),
    }
  }

  function computeBottomDockComposerPosition() {
    const root = viewRef.current
    if (!root) return { x: 0, y: 0 }
    const scale = getStageScale()
    const rect = root.getBoundingClientRect()
    const width = Math.max(1, rect.width / scale)
    const height = Math.max(1, rect.height / scale)
    const size = getInsertComposerSize()
    const dockX = Math.round((width - size.width) / 2)
    const padding = 88
    const dockY = Math.round(height - size.height - padding)
    return { x: Math.max(0, dockX), y: Math.max(0, dockY) }
  }

  function moveComposerToBottomDock() {
    setInsertComposerPos(computeBottomDockComposerPosition())
  }

  function computeInsertComposerPositionFromButton(buttonEl: any) {
    const root = viewRef.current
    if (!root || !buttonEl) return computeBottomDockComposerPosition()
    const scale = getStageScale()
    const rootRect = root.getBoundingClientRect()
    const buttonRect = buttonEl.getBoundingClientRect()
    const size = getInsertComposerSize()
    const padding = 14
    const maxX = rootRect.width / scale - size.width - padding
    const maxY = rootRect.height / scale - size.height - padding
    const centerX = (buttonRect.left - rootRect.left + buttonRect.width / 2) / scale
    const x = Math.round(centerX - size.width / 2)
    const y = Math.round((buttonRect.bottom - rootRect.top + 12) / scale)
    return {
      x: clampNumber(x, padding, maxX),
      y: clampNumber(y, 80, maxY),
    }
  }

  const handleWindowResize = useCallback(() => {
    updateStageScale()
    if (editorModeRef.current !== 'insert') {
      moveComposerToBottomDock()
    }
    updateTrackInnerWidth()
    updateActionOverlayPosition()
    setInsertSlotLayoutToken((t) => t + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateStageScale, updateTrackInnerWidth])

  function updateActionOverlayPosition() {
    const id = String(activeCardIdRef.current || '').trim()
    if (!id) return
    const root = viewRef.current
    if (!root) return
    const card = root.querySelector(`[data-storyboard-id="${id}"]`)
    const anchor = (card?.querySelector?.('.storyboard-image-button') as any) || card
    const rect = anchor?.getBoundingClientRect?.()
    if (!rect) return
    const padding = 8
    setActionOverlayPos({
      left: Math.round(rect.left + padding),
      bottom: Math.round(window.innerHeight - rect.bottom + padding),
    })
  }

  function handleGlobalPointerDown(event: any) {
    if (propsRef.current.isLibraryOpen) return
    if (editorModeRef.current !== 'insert' && editorModeRef.current !== 'modify') return

    const target = event?.target
    if (!target || typeof target.closest !== 'function') return

    if (target.closest('.material-library-picker-dialog') || target.closest('.el-dialog') || target.closest('.ant-modal')) {
      return
    }

    // Close source picker menu on outside click
    if (sourceMenuOpenRef.current && !target.closest('.source-picker-menu')) {
      closeSourceMenu()
    }

    if (
      target.closest('.storyboard-editor') ||
      target.closest('.storyboard-gap-insert') ||
      target.closest('.storyboard-card') ||
      target.closest('.storyboard-actions-overlay') ||
      target.closest('.storyboard-insert-idea')
    ) {
      return
    }

    if (editorModeRef.current === 'insert' && activeCardIdRef.current) {
      setEditorMode('modify')
    }
    setEditorLocked(false)
    moveComposerToBottomDock()
    requestAnimationFrame(() => {
      const input = insertComposerRef.current?.querySelector('textarea')
      input?.focus?.()
    })
  }

  function getInsertSlotStyle(slot: any): CSSProperties {
    // 注：原 Vue 在此读取 insertSlotLayoutToken 注册响应式依赖；React 中本函数每次渲染都会执行，无需手动触发。
    const track = trackRef.current
    const anchorId = String(slot?.anchorId || '').trim()
    if (!track || !anchorId) return {}
    const card = track.querySelector?.(`[data-storyboard-id="${anchorId}"]`) as any
    if (!card) return {}

    const index = Number(slot?.itemIndex ?? -1)
    const neighborIndex = slot?.edge === 'right' ? index + 1 : index - 1
    const neighborId = items[neighborIndex]?.id
    const neighbor = neighborId ? (track.querySelector?.(`[data-storyboard-id="${neighborId}"]`) as any) : null
    const cardBox = {
      left: card.offsetLeft || 0,
      top: card.offsetTop || 0,
      width: card.offsetWidth || 0,
      height: card.offsetHeight || 0,
    }
    const neighborBox = neighbor
      ? {
          left: neighbor.offsetLeft || 0,
          top: neighbor.offsetTop || 0,
          width: neighbor.offsetWidth || 0,
          height: neighbor.offsetHeight || 0,
        }
      : null

    const currentCenterY = cardBox.top + cardBox.height / 2
    const neighborCenterY = neighborBox ? neighborBox.top + neighborBox.height / 2 : currentCenterY
    const top = Math.round((currentCenterY + neighborCenterY) / 2)

    let left = 0
    if (isStackMode || !neighborBox) {
      left = Math.round(slot?.edge === 'right' ? cardBox.left + cardBox.width : cardBox.left)
    } else {
      left =
        slot?.edge === 'right'
          ? Math.round((cardBox.left + cardBox.width + neighborBox.left) / 2)
          : Math.round((neighborBox.left + neighborBox.width + cardBox.left) / 2)
    }

    return {
      left: `${left}px`,
      top: `${top}px`,
    }
  }

  function getDeleteButtonStyle(): CSSProperties {
    // 同上：原 Vue 响应式依赖触发，React 无需。
    const track = trackRef.current
    const id = String(activeCardId || '').trim()
    if (!track || !id) return {}
    const card = track.querySelector?.(`[data-storyboard-id="${id}"]`) as any
    if (!card) return {}
    const anchor = (card.querySelector?.('.storyboard-image-button') as any) || card
    const leftBase = (card.offsetLeft || 0) + (anchor.offsetLeft || 0)
    const topBase = (card.offsetTop || 0) + (anchor.offsetTop || 0)
    const width = anchor.offsetWidth || 0
    const height = anchor.offsetHeight || 0
    const size = 18
    const padding = 10
    const left = Math.round(leftBase + width - size - padding)
    const top = Math.round(topBase + height - size - padding)
    return { left: `${left}px`, top: `${top}px` }
  }

  function handleGapInsertClick(slot: any, event: any) {
    if (!canInsertMore) return
    const anchorId = String(slot?.anchorId || '').trim()
    const side = slot?.side === 'left' ? 'left' : 'right'
    if (!anchorId) return
    setInsertAnchorId(anchorId)
    insertAnchorIdRef.current = anchorId
    setInsertSide(side)
    insertSideRef.current = side
    setEditorMode('insert')
    setEditorLocked(false)
    setInsertComposerPos(computeInsertComposerPositionFromButton(event?.currentTarget))
    setEditorText('')
    setInsertIdeaDraft('')
    onResetInsertIdea?.()
    pendingInsertHintRef.current = false
    setShowInsertHint(false)
    requestAnimationFrame(() => {
      const input = insertComposerRef.current?.querySelector('textarea')
      input?.focus?.()
    })
  }

  // ======== 拖拽排序（pointer）========
  function getDraggingLayoutRect() {
    if (!pointerDraggingIdRef.current) return null
    const card = document.querySelector(
      `.storyboard-card[data-storyboard-id="${pointerDraggingIdRef.current}"]`,
    )
    if (!card) return null
    const scale = pointerScaleRef.current || 1
    const rect = card.getBoundingClientRect()
    const left = rect.left - dragDeltaXRef.current * scale
    const top = rect.top - dragDeltaYRef.current * scale
    return {
      left,
      top,
      right: left + rect.width,
      bottom: top + rect.height,
      width: rect.width,
      height: rect.height,
    }
  }

  function getStoryboardElement(itemId: string) {
    return document.querySelector(`.storyboard-card[data-storyboard-id="${itemId}"]`)
  }

  function getItemIndex(itemId: string) {
    const index = visualIndexById.get(itemId)
    return typeof index === 'number' ? index : -1
  }

  function updateDragOffsetFromClient(clientX: number, clientY: number) {
    if (!pointerDraggingIdRef.current) return
    const rect = getDraggingLayoutRect()
    if (!rect) return
    const scale = pointerScaleRef.current || 1
    setDeltaX((clientX - rect.left) / scale - pointerOffsetXRef.current)
    setDeltaY((clientY - rect.top) / scale - pointerOffsetYRef.current)
  }

  function updateDragOffset(event: any) {
    updateDragOffsetFromClient(event.clientX, event.clientY)
  }

  function updateDragThreshold(event: any) {
    if (!pointerDraggingIdRef.current || pointerWasDraggedRef.current) return
    if (!dragArmedRef.current) return
    const deltaX = Math.abs(event.clientX - pointerStartXRef.current)
    const deltaY = Math.abs(event.clientY - pointerStartYRef.current)
    if (deltaX > 18 || deltaY > 18) {
      setWasDragged(true)
      suppressPreviewClickRef.current = true
      updateDragOffset(event)
    }
  }

  function findNeighborRealId(fromIndex: number, direction: number) {
    const ids = visualIds
    let idx = fromIndex + direction
    while (idx >= 0 && idx < ids.length) {
      const id = ids[idx]
      if (id && id !== PLACEHOLDER_ID) return id
      idx += direction
    }
    return ''
  }

  function maybeReorderAtPoint(event: any) {
    if (!pointerWasDraggedRef.current) return
    const fromIndex = getItemIndex(pointerDraggingIdRef.current)
    if (fromIndex === -1) return

    const previousId = findNeighborRealId(fromIndex, -1)
    const nextId = findNeighborRealId(fromIndex, 1)
    const previousElement = previousId ? getStoryboardElement(previousId) : null
    const nextElement = nextId ? getStoryboardElement(nextId) : null
    const previousCenter = previousElement
      ? previousElement.getBoundingClientRect().left + previousElement.getBoundingClientRect().width / 2
      : null
    const nextCenter = nextElement
      ? nextElement.getBoundingClientRect().left + nextElement.getBoundingClientRect().width / 2
      : null
    let targetId = ''

    if (previousId && previousCenter !== null && event.clientX < previousCenter) {
      targetId = previousId
    } else if (nextId && nextCenter !== null && event.clientX > nextCenter) {
      targetId = nextId
    } else {
      setDragOverId('')
      return
    }

    setDragOverId(targetId)
    onReorder?.({ fromId: pointerDraggingIdRef.current, toId: targetId })
    requestAnimationFrame(() => {
      updateDragOffsetFromClient(event.clientX, event.clientY)
    })
  }

  function handlePointerDown(item: any, event: any) {
    if (
      event.button !== 0 ||
      isLoadingItem(item) ||
      isEditingItem(item) ||
      event.target.closest(
        '.storyboard-actions, .storyboard-top-button, .storyboard-gap-insert, .storyboard-delete-float',
      )
    ) {
      return
    }

    if (dragArmTimerRef.current) {
      window.clearTimeout(dragArmTimerRef.current)
      dragArmTimerRef.current = 0
    }
    dragArmedRef.current = false
    activePointerIdRef.current = typeof event.pointerId === 'number' ? event.pointerId : null
    activePointerCaptureElRef.current = event.currentTarget || null
    if (activePointerCaptureElRef.current && activePointerIdRef.current !== null) {
      try {
        activePointerCaptureElRef.current.setPointerCapture?.(activePointerIdRef.current)
      } catch {
        // Pointer capture may fail during rapid dragging.
      }
    }
    setPointerDragging(item.id)
    pointerStartXRef.current = event.clientX
    pointerStartYRef.current = event.clientY
    pointerScaleRef.current =
      event.currentTarget.getBoundingClientRect().width / event.currentTarget.offsetWidth || 1
    pointerOffsetXRef.current =
      (event.clientX - event.currentTarget.getBoundingClientRect().left) / pointerScaleRef.current
    pointerOffsetYRef.current =
      (event.clientY - event.currentTarget.getBoundingClientRect().top) / pointerScaleRef.current
    setDeltaX(0)
    setDeltaY(0)
    setWasDragged(false)
    dragArmTimerRef.current = window.setTimeout(() => {
      if (!pointerDraggingIdRef.current || pointerWasDraggedRef.current) return
      dragArmedRef.current = true
    }, 160)
    // 保存实际绑定的函数实例，确保后续（含卸载）能用相同标识精确移除，避免监听器泄漏。
    attachedPointerMoveRef.current = handleGlobalPointerMove
    attachedPointerUpRef.current = handleGlobalPointerUp
    attachedPointerCancelRef.current = resetPointerDrag
    window.addEventListener('pointermove', handleGlobalPointerMove)
    window.addEventListener('pointerup', handleGlobalPointerUp)
    window.addEventListener('pointercancel', resetPointerDrag)
  }

  function handlePointerMove(event: any) {
    if (!pointerDraggingIdRef.current) return
    updateDragThreshold(event)
  }

  function handleGlobalPointerMove(event: any) {
    if (pointerDraggingIdRef.current && (event.buttons & 1) === 0) {
      resetPointerDrag()
      return
    }
    handlePointerMove(event)

    if (pointerWasDraggedRef.current) {
      event.preventDefault()
      updateDragOffset(event)
      maybeReorderAtPoint(event)
    }
  }

  function handlePointerEnter(item: any, event: any) {
    if (!pointerDraggingIdRef.current) return
    setDragOverId(item.id)
    if (pointerWasDraggedRef.current) {
      maybeReorderAtPoint(event)
    }
  }

  function handleGlobalPointerUp(event: any) {
    if (!pointerDraggingIdRef.current) return

    if (event.target.closest('.storyboard-gap-insert')) {
      resetPointerDrag()
      return
    }
    if (event.target.closest('.storyboard-delete-float')) {
      resetPointerDrag()
      return
    }

    const releasedId = pointerDraggingIdRef.current
    updateDragThreshold(event)

    if (pointerWasDraggedRef.current) {
      event.preventDefault()
      maybeReorderAtPoint(event)
      suppressPreviewClickRef.current = true
      window.setTimeout(() => {
        suppressPreviewClickRef.current = false
      }, 120)
    } else {
      const item = propsRef.current.items.find((storyboardItem) => storyboardItem.id === releasedId)
      if (item) {
        const index = propsRef.current.items.findIndex((storyboardItem) => storyboardItem.id === releasedId)
        if (releasedId !== PLACEHOLDER_ID && index >= 0 && isStackMode) {
          setStackPushIndex((prev) => {
            const next = prev === index ? -1 : index
            setStackPushDistancePx(next === -1 ? 0 : getItemCardWidthPx(item))
            return next
          })
          setInsertSlotLayoutToken((t) => t + 1)
        } else if (!isStackMode) {
          setStackPushIndex(-1)
          setStackPushDistancePx(0)
        }
        setActiveCardId(item.id)
        activeCardIdRef.current = item.id
        onSelectItem?.(item.id)
        setEditorMode('modify')
        setEditorLocked(false)
        pendingInsertHintRef.current = false
        setShowInsertHint(false)
        setInsertAnchorId('')
        insertAnchorIdRef.current = ''
        setInsertSide('right')
        moveComposerToBottomDock()
        scrollToStart()
        requestAnimationFrame(() => {
          const input = insertComposerRef.current?.querySelector('textarea')
          input?.focus?.()
        })
      }
    }

    resetPointerDrag()
  }

  function submitEditor() {
    let prompt = editorText.trim()

    // When user added reference images but didn't type any text,
    // auto-generate a fallback prompt so the send button works.
    if (!prompt && hasReferenceImages) {
      prompt = '参考提供的素材图片，生成一张风格一致的分镜画面'
    }

    if (!prompt) return

    if (editorMode === 'modify') {
      const itemId = activeCardId
      if (!itemId || isSubmittingEdit) return
      onModifyImage?.({ itemId, prompt })
      setEditorText('')
      pendingInsertHintRef.current = false
      setShowInsertHint(false)
      return
    }

    if (editorMode === 'insert') {
      onInsertItem?.({ anchorId: insertAnchorId, side: insertSide, prompt })
      setEditorText('')
      setEditorMode('')
      setEditorLocked(false)
      pendingInsertHintRef.current = false
      setShowInsertHint(false)
    }
  }

  function toggleSourceMenu() {
    setSourceMenuOpen((v) => !v)
  }

  function closeSourceMenu() {
    setSourceMenuOpen(false)
  }

  function openMaterialLibrary() {
    closeSourceMenu()
    onOpenLibrary?.()
  }

  function triggerLocalUpload() {
    closeSourceMenu()
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return
      if (editorModeRef.current === 'insert') {
        onUploadInsertStoryboard?.({ file, anchorId: insertAnchorIdRef.current, side: insertSideRef.current })
      } else {
        onUploadReplaceStoryboard?.(file)
      }
    }
    input.click()
  }

  function requestAiAnalyze() {
    if (aiAnalyzing) return
    // First ensure we have at least one reference image
    if (!previewStackMaterials.length) {
      closeSourceMenu()
      onOpenLibrary?.()
      return
    }
    closeSourceMenu()
    // Emit event for parent to handle AI analysis
    setAiAnalyzing(true)
    onAnalyzeReferenceImage?.(previewStackMaterials[0])
  }

  function cancelAiAnalyze() {
    setAiAnalyzing(false)
    onCancelAiAnalyze?.()
  }

  function getCardStackStyle(item: any, index: number): CSSProperties {
    const id = item?.id || ''
    const isDragging = id && id === pointerDraggingId && pointerWasDragged
    const visualIndex = visualIndexById.get(id)
    const stackCount = Math.max(visualIds.length, 1)
    const resolvedIndex = Math.max(0, typeof visualIndex === 'number' ? visualIndex : index)
    const baseZ = resolvedIndex + 1
    return {
      zIndex: isDragging ? stackCount + 3 : baseZ,
    }
  }

  function getCardMotionStyle(item: any, index: number): CSSProperties | undefined {
    const idx = typeof index === 'number' ? index : -1
    const shouldPush = idx >= 0 && stackPushIndex >= 0 && idx > stackPushIndex
    const pushX = shouldPush ? stackPushDistancePx : 0

    if (pointerDraggingId === item.id && pointerWasDragged) {
      return {
        transform: `translate3d(${pushX + dragDeltaX}px, ${dragDeltaY}px, 0)`,
        transition: 'none',
      }
    }

    if (!pushX) return undefined

    return {
      transform: `translate3d(${pushX}px, 0px, 0px)`,
    }
  }

  function handleCardKeyboardActivate(item: any) {
    if (!item?.id || item.id === PLACEHOLDER_ID) return
    if (isLoadingItem(item) || isEditingItem(item) || isSubmittingEdit) return

    const index = items.findIndex((storyboardItem) => storyboardItem.id === item.id)
    if (index >= 0 && isStackMode) {
      setStackPushIndex((prev) => {
        const next = prev === index ? -1 : index
        setStackPushDistancePx(next === -1 ? 0 : getItemCardWidthPx(item))
        return next
      })
      setInsertSlotLayoutToken((t) => t + 1)
    }
    setActiveCardId(item.id)
    activeCardIdRef.current = item.id
    onSelectItem?.(item.id)
    setEditorMode('modify')
    setEditorLocked(false)
    pendingInsertHintRef.current = false
    setShowInsertHint(false)
    setInsertAnchorId('')
    insertAnchorIdRef.current = ''
    setInsertSide('right')
    moveComposerToBottomDock()
    scrollToStart()
    requestAnimationFrame(() => {
      const input = insertComposerRef.current?.querySelector('textarea')
      input?.focus?.()
    })
  }

  function scrollToStart() {
    const el = trackRef.current
    if (!el) return
    try {
      el.scrollTo({ left: 0, behavior: 'smooth' })
    } catch {
      el.scrollLeft = 0
    }
  }

  // ======== watch: items id 列表变化 ========
  const itemIdsKey = items.map((item) => item.id).join('|')
  useEffect(() => {
    const ids = items.map((item) => item.id)
    if (!ids.length) {
      setActiveCardId('')
      setEditorMode('')
      setInsertAnchorId('')
      return
    }
    if (activeCardIdRef.current && !ids.includes(activeCardIdRef.current)) {
      setActiveCardId('')
      if (editorModeRef.current === 'modify') {
        setEditorMode('')
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemIdsKey])

  // watch: activeCardId 变化时清空 modify 输入
  useEffect(() => {
    if (editorModeRef.current === 'modify') {
      setEditorText('')
    }
     
  }, [activeCardId])

  // watch: isGenerating 由 true→false 且有待显示提示
  const prevGeneratingRef = useRef(isGenerating)
  useEffect(() => {
    const prev = prevGeneratingRef.current
    if (prev && !isGenerating && pendingInsertHintRef.current) {
      pendingInsertHintRef.current = false
      setShowInsertHint(true)
    }
    prevGeneratingRef.current = isGenerating
  }, [isGenerating])

  // watch: insertIdeaText 同步草稿（未编辑时）
  useEffect(() => {
    const text = String(insertIdeaDraft || insertIdeaText || '').trim()
    const shouldShow = insertIdeaLoading || insertIdeaEditing || Boolean(text)
    if (!shouldShow) return
    setInsertIdeaDraft(String(insertIdeaText || ''))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insertIdeaText])

  // watch: activeCardId / activeItem.src → 刷新操作浮层位置
  useEffect(() => {
    requestAnimationFrame(() => updateActionOverlayPosition())
     
  }, [activeCardId, activeItem?.src])

  // watch: activeCardId / ratio / items.length → 刷新插槽布局 token
  useEffect(() => {
    requestAnimationFrame(() => {
      setInsertSlotLayoutToken((t) => t + 1)
    })
     
  }, [activeCardId, selectedRatio, items.length])

  // watch: ratio / items.length / placeholder → 刷新 track 内宽
  useLayoutEffect(() => {
    requestAnimationFrame(() => {
      updateTrackInnerWidth()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRatio, items.length, shouldShowPlaceholder])

  // watch: isStackMode 变化 → 退出堆叠重置 push
  useEffect(() => {
    if (!isStackMode) {
      setStackPushIndex(-1)
      setStackPushDistancePx(0)
    }
    requestAnimationFrame(() => {
      setInsertSlotLayoutToken((t) => t + 1)
    })
     
  }, [isStackMode])

  // ======== onMounted / onBeforeUnmount ========
  useEffect(() => {
    setEditorMode('modify')
    setEditorLocked(false)
    moveComposerToBottomDock()
    updateStageScale()
    window.addEventListener('resize', handleWindowResize)
    window.addEventListener('scroll', updateActionOverlayPosition, true)
    window.addEventListener('pointerdown', handleGlobalPointerDown, true)

    // 复制到局部变量，供 cleanup 使用（避免 cleanup 时 trackRef.current 已变化）
    let trackEl: HTMLDivElement | null = null

    const raf = requestAnimationFrame(() => {
      const container = containerRef.current
      updateTrackInnerWidth()
      updateActionOverlayPosition()
      const track = trackRef.current
      trackEl = track
      track?.addEventListener?.('scroll', updateActionOverlayPosition, { passive: true })
      if (container && typeof ResizeObserver !== 'undefined') {
        containerResizeObserverRef.current = new ResizeObserver(() => {
          updateStageScale()
          if (editorModeRef.current !== 'insert') {
            moveComposerToBottomDock()
          }
        })
        containerResizeObserverRef.current.observe(container)
      }
      if (track && typeof ResizeObserver !== 'undefined') {
        trackResizeObserverRef.current = new ResizeObserver(() => {
          updateTrackInnerWidth()
        })
        trackResizeObserverRef.current.observe(track)
      }
    })

    return () => {
      cancelAnimationFrame(raf)
      resetPointerDrag()
      window.removeEventListener('resize', handleWindowResize)
      window.removeEventListener('scroll', updateActionOverlayPosition, true)
      window.removeEventListener('pointerdown', handleGlobalPointerDown, true)
      trackEl?.removeEventListener?.('scroll', updateActionOverlayPosition)
      if (containerResizeObserverRef.current) {
        try {
          containerResizeObserverRef.current.disconnect()
        } catch {
          // ignore
        }
        containerResizeObserverRef.current = null
      }
      if (trackResizeObserverRef.current) {
        try {
          trackResizeObserverRef.current.disconnect()
        } catch {
          // ignore
        }
        trackResizeObserverRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ======== render ========
  return (
    <section ref={containerRef as any} className="storyboard-view" style={storyboardStyle} aria-label="分镜图片生成">
      <div ref={viewRef} className="storyboard-design-stage">
        <div className="storyboard-progressbar" aria-label="分镜生成进度">
          <div className="storyboard-progressbar-track" aria-hidden="true">
            <div className="storyboard-progressbar-fill" style={{ width: progressPercent }}></div>
          </div>
          <div className="storyboard-progressbar-meta">
            <span className="storyboard-progressbar-count">
              {displayGeneratedCount}/{displayTotal} 最多可生成9张图片
            </span>
          </div>
        </div>

        <section className="storyboard-reference-note" aria-label="分镜图片生成提示">
          <span className="storyboard-reference-note-icon" aria-hidden="true">
            <svg viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6.25" />
              <path
                d="M8 4.45a.7.7 0 0 1 .7.7v3.2a.7.7 0 0 1-1.4 0v-3.2a.7.7 0 0 1 .7-.7Zm0 7.05a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8Z"
                fill="currentColor"
              />
            </svg>
          </span>
          <span className="storyboard-reference-note-text">
            因AI生成技术特性，本页面参考图片中的人物形象(含脸型、身材、服饰等细节)与最终生成视频的人物呈现效果可能存在差异，人物效果请以最终生成的视频内容为准。
          </span>
        </section>

        <div
          ref={trackRef}
          className={`storyboard-track ${isStackMode ? 'is-stack' : 'is-flat'}`}
          aria-label="分镜图片列表"
        >
          {items.map((item, index) => (
            <article
              key={item.id}
              className={[
                'storyboard-card',
                activeCardId === item.id ? 'is-active' : '',
                dragOverId === item.id ? 'is-drag-over' : '',
                pointerDraggingId === item.id ? 'is-pointer-dragging' : '',
                isLoadingItem(item) || isEditingItem(item) ? 'is-disabled' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              data-storyboard-id={item.id}
              style={{
                ...getCardStackStyle(item, index),
                ...getStackLayoutStyle(item, index),
                ...getCardMotionStyle(item, index),
              }}
              tabIndex={isLoadingItem(item) || isEditingItem(item) ? -1 : 0}
              role="button"
              aria-label={`分镜 ${index + 1}：${item.title || '未命名'}`}
              onPointerDown={(e) => handlePointerDown(item, e)}
              onPointerMove={handlePointerMove}
              onPointerEnter={(e) => handlePointerEnter(item, e)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleCardKeyboardActivate(item)
                } else if (e.key === ' ' || e.key === 'Spacebar') {
                  e.preventDefault()
                  handleCardKeyboardActivate(item)
                }
              }}
            >
              <button type="button" className="storyboard-image-button" style={getImageButtonStyle(item)}>
                {isLoadingItem(item) || isEditingItem(item) ? (
                  <div className="storyboard-loading" aria-label="图片生成中">
                    <div className="storyboard-loading-dots" aria-hidden="true">
                      <span className="dot dot-1"></span>
                      <span className="dot dot-2"></span>
                      <span className="dot dot-3"></span>
                      <span className="dot dot-4"></span>
                    </div>
                    <div className="storyboard-loading-text">图片生成中...</div>
                  </div>
                ) : isWaitingItem(item) ? (
                  <div className="storyboard-waiting" aria-label="等待上一张生成完成">
                    <div className="storyboard-waiting-icon" aria-hidden="true">
                      <span className="storyboard-waiting-dot"></span>
                      <span className="storyboard-waiting-dot"></span>
                      <span className="storyboard-waiting-dot"></span>
                    </div>
                    <div className="storyboard-waiting-title">等待上一张生成</div>
                    <div className="storyboard-waiting-copy">将按顺序继续生成当前分镜</div>
                  </div>
                ) : isFailedItem(item) ? (
                  <div className="storyboard-failed" aria-label="图片生成失败">
                    <div className="storyboard-failed-title">图片生成失败</div>
                    <div className="storyboard-failed-copy">请点击重新生成</div>
                  </div>
                ) : hasStoryboardImage(item) ? (
                  <img
                    key={item.src}
                    src={item.src}
                    alt={item.title}
                    className={imageStatusById[item.id] === 'load' ? 'sb-img-loaded' : ''}
                    draggable={false}
                    referrerPolicy="no-referrer"
                    onLoad={(e) => handleImageLoad(item, e)}
                    onError={() => handleImageError(item)}
                  />
                ) : (
                  <div className="storyboard-waiting" aria-label="图片待生成">
                    <div className="storyboard-waiting-icon" aria-hidden="true">
                      <span className="storyboard-waiting-dot"></span>
                      <span className="storyboard-waiting-dot"></span>
                      <span className="storyboard-waiting-dot"></span>
                    </div>
                    <div className="storyboard-waiting-title">待生成</div>
                    <div className="storyboard-waiting-copy">填写分镜词后开始顺序生成</div>
                  </div>
                )}
              </button>

              <span className="storyboard-badge order-badge">{index + 1}</span>
              {debugImages && <span className="storyboard-img-debug">{imageDebugLabel(item)}</span>}
            </article>
          ))}

          {shouldShowPlaceholder && (
            <article
              className="storyboard-card storyboard-card-placeholder"
              data-storyboard-id={PLACEHOLDER_ID}
              style={{
                ...getCardStackStyle({ id: PLACEHOLDER_ID }, items.length),
                ...getStackLayoutStyle({ id: PLACEHOLDER_ID }, items.length),
                ...getCardMotionStyle({ id: PLACEHOLDER_ID }, items.length),
              }}
            >
              <div className="storyboard-placeholder-box" aria-label="图片生成中">
                <div className="storyboard-placeholder-content">
                  <div className="storyboard-loading-dots" aria-hidden="true">
                    <span className="dot dot-1"></span>
                    <span className="dot dot-2"></span>
                    <span className="dot dot-3"></span>
                    <span className="dot dot-4"></span>
                  </div>
                  <span>图片生成中...</span>
                </div>
              </div>
              <span className="storyboard-badge order-badge">{placeholderIndex}</span>
            </article>
          )}

          {visibleInsertSlots.map((slot) => (
            <button
              key={`${slot.key}-${insertSlotLayoutToken}`}
              type="button"
              className="storyboard-gap-insert"
              aria-label="添加分镜图片"
              disabled={!canInsertMore || isBusy}
              style={getInsertSlotStyle(slot)}
              onClick={(e) => {
                e.stopPropagation()
                handleGapInsertClick(slot, e)
              }}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M10 2.5C10.221 2.5 10.433 2.5878 10.5893 2.74408C10.7455 2.90036 10.8333 3.11232 10.8333 3.33333V9.16667H16.6667C16.8877 9.16667 17.0996 9.25446 17.2559 9.41074C17.4122 9.56702 17.5 9.77899 17.5 10C17.5 10.221 17.4122 10.433 17.2559 10.5893C17.0996 10.7455 16.8877 10.8333 16.6667 10.8333H10.8333V16.6667C10.8333 16.8877 10.7455 17.0996 10.5893 17.2559C10.433 17.4122 10.221 17.5 10 17.5C9.77899 17.5 9.56702 17.4122 9.41074 17.2559C9.25446 17.0996 9.16667 16.8877 9.16667 16.6667V10.8333H3.33333C3.11232 10.8333 2.90036 10.7455 2.74408 10.5893C2.5878 10.433 2.5 10.221 2.5 10C2.5 9.77899 2.5878 9.56702 2.74408 9.41074C2.90036 9.25446 3.11232 9.16667 3.33333 9.16667H9.16667V3.33333C9.16667 3.11232 9.25446 2.90036 9.41074 2.74408C9.56702 2.5878 9.77899 2.5 10 2.5Z" />
              </svg>
            </button>
          ))}

          {activeItem && (
            <button
              type="button"
              className="storyboard-delete-button storyboard-delete-float"
              aria-label="删除分镜"
              disabled={isBusy || isLoadingItem(activeItem) || isEditingItem(activeItem)}
              style={getDeleteButtonStyle()}
              onClick={(e) => {
                e.stopPropagation()
                onRemove?.(activeItem.id)
              }}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M7.25 2.5c0-.41.34-.75.75-.75h4c.41 0 .75.34.75.75V4h3.25c.41 0 .75.34.75.75s-.34.75-.75.75H15.5v11.25c0 .83-.67 1.5-1.5 1.5h-8c-.83 0-1.5-.67-1.5-1.5V5.5H3.25c-.41 0-.75-.34-.75-.75S2.84 4 3.25 4H6.5V2.5Zm1.5 1.5h2.5V3.25h-2.5V4Zm-2.5 2.5v10.25h8V6.5h-8Zm2 2c.41 0 .75.34.75.75v5c0 .41-.34.75-.75.75s-.75-.34-.75-.75v-5c0-.41.34-.75.75-.75Zm3.5 0c.41 0 .75.34.75.75v5c0 .41-.34.75-.75.75s-.75-.34-.75-.75v-5c0-.41.34-.75.75-.75Z" />
              </svg>
            </button>
          )}
        </div>

        {(editorMode === 'modify' || editorMode === 'insert') && !insertIdeaEditing && (
          <section
            ref={insertComposerRef as any}
            className={[
              'storyboard-editor',
              !isInsertComposerReady ? 'is-disabled' : '',
              editorLocked ? 'is-locked' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            aria-label="图片修改/添加分镜"
            style={{ transform: `translate3d(${insertComposerPos.x}px, ${insertComposerPos.y}px, 0)` }}
          >
            <div className="storyboard-editor-preview" aria-label="当前分镜预览">
              <div
                className={`storyboard-editor-preview-image ${previewExpanded ? 'is-expanded' : ''}`}
                onMouseEnter={() => setPreviewExpanded(true)}
                onMouseLeave={() => setPreviewExpanded(false)}
              >
                {(editorMode === 'modify' || editorMode === 'insert') && !previewStackMaterials.length ? (
                  <button
                    type="button"
                    className="storyboard-editor-preview-empty"
                    aria-label="添加参考图"
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleSourceMenu()
                    }}
                  >
                    <span aria-hidden="true" className="storyboard-editor-preview-empty-plus">
                      +
                    </span>
                  </button>
                ) : editorMode === 'modify' || editorMode === 'insert' ? (
                  <>
                    <div className="storyboard-editor-preview-stack" aria-label="已添加素材预览">
                      {previewStackMaterials.map((material, idx) => (
                        <div
                          key={material.id}
                          className="storyboard-editor-preview-stack-item"
                          style={{
                            transform: previewExpanded
                              ? `translate3d(${idx * (PREVIEW_STACK_CARD_SIZE_PX + PREVIEW_STACK_EXPANDED_GAP_PX)}px, 0px, 0)`
                              : `translate3d(${idx * PREVIEW_STACK_SHIFT_PX}px, 0px, 0)`,
                            zIndex: idx + 1,
                          }}
                        >
                          <img src={material.src} alt={material.name || ''} draggable={false} />
                          <button
                            type="button"
                            className="storyboard-editor-preview-stack-remove"
                            aria-label="移除素材"
                            onClick={(e) => {
                              e.stopPropagation()
                              onRemoveMaterial?.(material.id)
                            }}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="storyboard-editor-preview-plus"
                      aria-label="添加参考图"
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleSourceMenu()
                      }}
                    >
                      +
                    </button>
                  </>
                ) : null}

                {/* Source picker popup menu (outside conditional, visible in both states) */}
                {sourceMenuOpen && (
                  <div className="source-picker-menu" onClick={(e) => e.stopPropagation()}>
                    <button type="button" className="source-picker-item" onClick={openMaterialLibrary}>
                      <svg viewBox="0 0 14 14" aria-hidden="true">
                        <rect x="1" y="1" width="12" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.2" />
                        <path d="M5 5h4M5 8h4M5 11h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                      </svg>
                      从素材库选择
                    </button>
                    <button type="button" className="source-picker-item" onClick={triggerLocalUpload}>
                      <svg viewBox="0 0 14 14" aria-hidden="true">
                        <path
                          d="M2 10V3a1 1 0 0 1 1-1h3l1.5 2H12a1 1 0 0 1 1 1v5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.2"
                          strokeLinecap="round"
                        />
                        <path
                          d="M7 9v4M5 11l2-2 2 2"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      上传本地图片
                    </button>
                    <button
                      type="button"
                      className="source-picker-item"
                      onClick={() => (aiAnalyzing ? cancelAiAnalyze() : requestAiAnalyze())}
                    >
                      {!aiAnalyzing ? (
                        <svg viewBox="0 0 14 14" aria-hidden="true">
                          <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
                          <path
                            d="M7 4v3l2 1.5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 14 14" aria-hidden="true">
                          <rect x="2" y="2" width="10" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.2" />
                          <path d="M5 5l4 4M9 5l-4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                        </svg>
                      )}
                      {aiAnalyzing ? '取消AI分析' : 'AI识别图片生成描述'}
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div className="storyboard-editor-body">
              <div className="storyboard-editor-title">{editorTitle}</div>
              <textarea
                value={editorText}
                onChange={(e) => setEditorText(e.target.value)}
                aria-label="输入描述"
                disabled={!isInsertComposerReady}
                readOnly={editorLocked}
                placeholder={editorPlaceholder}
              ></textarea>
            </div>
            <button
              type="button"
              className="storyboard-editor-send"
              aria-label="发送"
              disabled={(!editorText.trim() && !hasReferenceImages) || !isInsertComposerReady}
              onClick={submitEditor}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M17.5 2.5 2.5 9.25l6.25 1.5L10.25 17.5 17.5 2.5Zm-7.2 8.4-5.1-1.2 9.5-4.3-4.4 5.5Z" />
              </svg>
            </button>
          </section>
        )}

        {editorMode === 'modify' && activeItem && !insertIdeaEditing && (
          <section className="storyboard-history" aria-label="历史生成" style={historyPanelStyle}>
            <div className="storyboard-history-panel-title">历史生成</div>
            <div className="storyboard-history-body">
              {!activeItem.historyImages?.length ? (
                <div className="storyboard-history-empty">暂无历史记录</div>
              ) : (
                <div className="storyboard-history-grid" aria-label="历史版本列表">
                  {historyEntries.map((entry) => (
                    <div
                      key={`his-${entry.index}-${entry.src}`}
                      className={`storyboard-history-card ${
                        entry.index === Number(activeItem.currentVersionIndex || 0) ? 'is-active' : ''
                      }`}
                      onClick={(e) => {
                        e.stopPropagation()
                        onSetImageVersion?.({ itemId: activeItem.id, index: entry.index })
                      }}
                    >
                      <img src={entry.src} alt="" draggable={false} />
                      <button
                        type="button"
                        className="storyboard-history-remove"
                        aria-label="删除历史记录"
                        onClick={(e) => {
                          e.stopPropagation()
                          onRemoveImageVersion?.({ itemId: activeItem.id, index: entry.index })
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {showInsertHint && (
          <section className="storyboard-editor-hint" aria-label="新增图片提示" style={editorHintStyle}>
            <div className="storyboard-editor-hint-text">{insertHintText}</div>
            <div className="storyboard-editor-hint-desc">{insertHintDescription}</div>
          </section>
        )}

        <div className="storyboard-footer-actions">
          <button type="button" className="storyboard-regenerate" disabled={isBusy} onClick={() => onRegenerate?.()}>
            <svg viewBox="0 0 18 18" aria-hidden="true">
              <path d="M8.42 2.88c3.32 0 6.02 2.66 6.09 5.97l.25-.25.01-.01a.56.56 0 0 1 .79.01.56.56 0 0 1 .01.79l-.01.01-.7.7a1.27 1.27 0 0 1-1.79 0l-.7-.7a.56.56 0 0 1 .8-.8l.22.22a4.97 4.97 0 1 0-1.47 3.69.56.56 0 0 1 .79.8 6.08 6.08 0 1 1-4.3-10.42Z" />
            </svg>
            重新生成
          </button>

          <button type="button" className="timeline-button" disabled={isBusy} onClick={() => onGenerateStoryboard?.()}>
            生成镜头编排
          </button>
        </div>
      </div>
    </section>
  )
}
