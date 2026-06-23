/*
  TimelineEditorPanel — 时间线编辑面板（大组件）
  管理视频时间线：分段（segment）编辑、旁白/字幕/音效轨道、时长裁剪、画面比例、
  缩略图预览、AI 重新加载片段、视频播放器嵌入。
*/
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import playIcon from '@/img/image copy 2.png'
import './TimelineEditorPanel.css'

// ============================================================
// 类型
// ============================================================

interface TimelineSegment {
  id: string
  storyboardIndex: number
  start: number
  end: number
  voiceover: string
  subtitle: string
  sfx: string
}

interface TimelineTrackBlock {
  id: string
  start: number
  end: number
  text: string
}

interface TimelineData {
  segments?: any[]
  voiceover?: any[]
  subtitle?: any[]
  sfx?: any[]
}

export interface ReloadPayload {
  segmentId: string
  instruction: string
}

export interface UpdateStoryboardPromptPayload {
  segmentId: string
  storyboardIndex: number
  prompt: string
}

export interface SyncedPayload {
  trackName: string
  blockId: string
}

export interface TimelineEditorPanelProps {
  panelStyle: CSSProperties
  selectedRatio?: string
  storyboardItems?: any[]
  storyboards?: any[]
  timeline?: TimelineData
  totalDuration?: number
  isReloading?: boolean
  reloadReady?: boolean
  videoCostEstimate?: any
  isEstimatingVideoCost?: boolean
  videoCostEstimateError?: string
  // ---- 事件回调（对应 Vue defineEmits）----
  onUpdateTimeline?: (timeline: {
    segments: TimelineSegment[]
    voiceover: TimelineTrackBlock[]
    subtitle: TimelineTrackBlock[]
    sfx: TimelineTrackBlock[]
  }) => void
  onUpdateStoryboardPrompt?: (payload: UpdateStoryboardPromptPayload) => void
  onGenerateVideo?: () => void
  onEstimateVideoCost?: () => void
  onReload?: (payload: ReloadPayload) => void
  onApproveReload?: () => void
  onSynced?: (payload: SyncedPayload) => void
  onComingSoon?: (label: string) => void
}

// 时间轴基础常量。
// RULER_WIDTH 对应设计稿中的标尺宽度，所有秒数与像素的换算都依赖这个基准值。
const RULER_WIDTH = 1188
const MIN_BLOCK_SECONDS = 0.5

type TrackName = 'segments' | 'voiceover' | 'subtitle' | 'sfx'

interface DragState {
  trackName: TrackName
  blockId: string
  mode: 'move' | 'resize-end' | 'resize-start'
  startPointerX: number
  initialStart: number
  initialEnd: number
}

interface BoundaryDragState {
  mode: 'start' | 'end'
  startPointerX: number
  virtualLeft: boolean
  virtualRight: boolean
  leftId: string
  rightId: string
  leftStart: number
  rightEnd: number
  initialLeftEnd: number
}

function cloneTrack(source: any[] | undefined, prefix: string): TimelineTrackBlock[] {
  return (source || []).map((block, index) => ({
    id: block?.id || `${prefix}-${index + 1}`,
    start: Number(block?.start) || 0,
    end: Number(block?.end) || 0,
    text: block?.text || '',
  }))
}

export default function TimelineEditorPanel(props: TimelineEditorPanelProps) {
  const {
    panelStyle,
    storyboardItems = [],
    storyboards = [],
    timeline,
    totalDuration = 10,
    isReloading = false,
    reloadReady = false,
    videoCostEstimate = null,
    isEstimatingVideoCost = false,
    videoCostEstimateError = '',
  } = props

  // 本地时间线编辑状态。
  // 这里维护 segment、三条轨道、当前选中块、拖拽状态、草稿文本和编辑模式等局部状态。
  // 四条轨道用 ref 作为可变源（对应 Vue 的 reactive 数组，拖拽时原地修改），
  // 用 version 计数器触发重渲染。
  const segmentsRef = useRef<TimelineSegment[]>([])
  const voiceoverRef = useRef<TimelineTrackBlock[]>([])
  const subtitleRef = useRef<TimelineTrackBlock[]>([])
  const sfxRef = useRef<TimelineTrackBlock[]>([])
  const [, setVersion] = useState(0)
  const bump = useCallback(() => setVersion((v) => v + 1), [])

  const [selectedSegmentId, setSelectedSegmentId] = useState('')
  const dragStateRef = useRef<DragState | null>(null)

  // 缩略图图片加载状态（per-item）
  const [imageLoadState, setImageLoadState] = useState<Record<string, string>>({})

  // 缩略图加载完成后记录状态，避免重复显示骨架或失败态。
  const onThumbLoad = useCallback((id?: string) => {
    if (id) setImageLoadState((prev) => ({ ...prev, [id]: 'loaded' }))
  }, [])

  // 缩略图加载失败时记录错误状态，供模板显示兜底样式。
  const onThumbError = useCallback((id?: string) => {
    if (id) setImageLoadState((prev) => ({ ...prev, [id]: 'error' }))
  }, [])

  // 当前分镜缩略图是否仍在生成中。
  function isThumbGenerating(item: any): boolean {
    if (!item) return false
    const s = String(item.status || '').toLowerCase()
    return ['submitting', 'submitted', 'queued', 'running', 'processing'].includes(s)
  }

  // 当前分镜缩略图是否进入失败态。
  function isThumbFailed(item: any): boolean {
    if (!item) return false
    const s = String(item.status || '').toLowerCase()
    return ['failed', 'error', 'rejected'].includes(s)
  }

  // 当前分镜缩略图是否还没有可用图片。
  function isThumbPending(item: any): boolean {
    if (!item) return true
    if (item.src) return false
    const s = String(item.status || '').toLowerCase()
    return s === 'pending' || (!s && !item.src)
  }

  // ---- 编辑态 ----
  const [timelineDraft, setTimelineDraft] = useState('')
  const timelineOriginalRef = useRef('')
  const [isApplyingDraft, setIsApplyingDraft] = useState(false)
  const [, setSyncedBlockKey] = useState('')
  const editorTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const editorCardRef = useRef<HTMLElement | null>(null)

  // 播放头 / 边界拖拽相关状态。
  const [, setPlayheadDragging] = useState(false)
  const boundaryDragStateRef = useRef<BoundaryDragState | null>(null)
  const [selectedTrackName, setSelectedTrackName] = useState('')
  const [selectedTrackBlockId, setSelectedTrackBlockId] = useState('')

  const [editorMode, setEditorMode] = useState<'shot' | 'voiceover' | 'subtitle' | 'sfx'>('shot')

  // ============================================================
  // 工具函数（依赖当前 ref 数组）
  // ============================================================

  const getTrackList = useCallback((trackName: string): any[] => {
    if (trackName === 'segments') return segmentsRef.current
    if (trackName === 'voiceover') return voiceoverRef.current
    if (trackName === 'subtitle') return subtitleRef.current
    if (trackName === 'sfx') return sfxRef.current
    return []
  }, [])

  // 统一计算时间线总秒数。
  // 不只看 props.totalDuration，还会把 segment 和各轨道块的结束时间一起纳入计算。
  const computeTotalSeconds = useCallback((): number => {
    const max = Math.max(
      totalDuration || 0,
      ...segmentsRef.current.map((segment) => segment.end || 0),
      ...voiceoverRef.current.map((block) => block.end || 0),
      ...subtitleRef.current.map((block) => block.end || 0),
      ...sfxRef.current.map((block) => block.end || 0),
    )
    return Math.max(max, 1)
  }, [totalDuration])

  function pxToSeconds(px: number): number {
    return (px / RULER_WIDTH) * computeTotalSeconds()
  }

  function clampSeconds(value: number): number {
    return Number(Math.min(Math.max(value, 0), computeTotalSeconds()).toFixed(2))
  }

  function getRulerElement(): Element | null {
    return document.querySelector('.timeline-ruler-hitbox')
  }

  function syncTrackBlocksToSegment(segmentIndex: number) {
    const segment = segmentsRef.current[segmentIndex]
    if (!segment) return
    const apply = (list: TimelineTrackBlock[]) => {
      const block = list[segmentIndex]
      if (!block) return
      block.start = segment.start
      block.end = segment.end
    }
    apply(voiceoverRef.current)
    apply(subtitleRef.current)
    apply(sfxRef.current)
  }

  // ============================================================
  // 派生展示状态
  // ============================================================

  const segments = segmentsRef.current
  const totalSeconds = computeTotalSeconds()

  // 当前选中的镜头段与其派生展示状态。
  const selectedSegment = useMemo<TimelineSegment | null>(
    () => segments.find((segment) => segment.id === selectedSegmentId) || segments[0] || null,
     
    [selectedSegmentId, segments],
  )

  const getStoryboardForSegment = useCallback(
    (segment: TimelineSegment | null): any => {
      if (!segment) return null
      const index = segment.storyboardIndex ?? segmentsRef.current.indexOf(segment)
      const item =
        storyboardItems[index] || storyboardItems[segmentsRef.current.indexOf(segment)] || null
      const board = storyboards[index] || null
      if (item && board) return { ...item, ...board }
      return board || item || null
    },
    [storyboardItems, storyboards],
  )

  const selectedStoryboard = getStoryboardForSegment(selectedSegment)
  const scaleTotalSeconds = Math.min(Math.max(totalSeconds || 1, 1), 15)

  const miniTimelineMarks = useMemo(() => {
    const ticks = Math.max(Math.ceil(scaleTotalSeconds), 1)
    if (ticks === 1) return [{ pct: 0, label: '01' }]
    return Array.from({ length: ticks }, (_, index) => {
      const pct = (index / (ticks - 1)) * 100
      return { pct, label: String(index + 1).padStart(2, '0') }
    })
  }, [scaleTotalSeconds])

  const selectedRangePct = useMemo(() => {
    const segment = selectedSegment
    if (!segment) return { left: 0, width: 0 }
    const max = scaleTotalSeconds || 1
    const left = (clampSeconds(segment.start) / max) * 100
    const width =
      (Math.max(clampSeconds(segment.end) - clampSeconds(segment.start), MIN_BLOCK_SECONDS) / max) *
      100
    return { left, width }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSegment, scaleTotalSeconds])

  const selectedTrackBlock = useMemo<TimelineTrackBlock | null>(() => {
    const trackName = selectedTrackName
    const blockId = selectedTrackBlockId
    if (!trackName || !blockId) return null
    const list = getTrackList(trackName)
    return list.find((block) => block.id === blockId) || null
     
  }, [selectedTrackName, selectedTrackBlockId, getTrackList])

  // 右侧编辑卡标题与时间范围文案。
  const editingTitle = useMemo(() => {
    if (editorMode === 'shot') return '镜头描述'
    if (editorMode === 'subtitle') return '字幕描述'
    if (editorMode === 'sfx') return '音效配乐'
    return '台词旁白'
  }, [editorMode])

  function formatRange(block: { start: number; end: number }): string {
    return `${block.start.toFixed(1)}s - ${block.end.toFixed(1)}s`
  }

  function formatDuration(seconds: number): string {
    const value = Number(seconds || 0)
    if (Math.abs(value - Math.round(value)) < 0.01) return `${Math.round(value)}s`
    return `${value.toFixed(1)}s`
  }

  const editingRangeLabel = useMemo(() => {
    const block = selectedTrackBlock
    if (block) return formatRange(block)
    if (selectedSegment) return formatRange(selectedSegment)
    return ''
     
  }, [selectedTrackBlock, selectedSegment])

  // 费用估算区的派生显示值。
  const num = (n: any) => Number(n || 0).toLocaleString('zh-CN')

  const estimatedCost = Number(videoCostEstimate?.estimated_cost ?? 0)
  const estimatedBalance = Number(videoCostEstimate?.balance ?? 0)
  const canAffordEstimate = videoCostEstimate?.can_afford === true
  const hasEstimate = videoCostEstimate && typeof videoCostEstimate?.estimated_cost === 'number'

  // ============================================================
  // 父级事件回写
  // ============================================================

  const emitChange = useCallback(() => {
    props.onUpdateTimeline?.({
      segments: segmentsRef.current.map((segment) => ({ ...segment })),
      voiceover: voiceoverRef.current.map((block) => ({ ...block })),
      subtitle: subtitleRef.current.map((block) => ({ ...block })),
      sfx: sfxRef.current.map((block) => ({ ...block })),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.onUpdateTimeline])

  // ============================================================
  // 边界拖拽
  // ============================================================

  // 拖动 segment 边界时，实时同步左右片段的开始/结束时间。
  // 这里会同时修正对应轨道块，保证时间线各条轨道仍与 segment 保持对齐。
  const handleBoundaryMove = useCallback(
    (event: PointerEvent) => {
      const state = boundaryDragStateRef.current
      if (!state) return
      event.preventDefault()
      const ruler = getRulerElement()
      if (!ruler) return
      const rect = ruler.getBoundingClientRect()
      const scaleX = rect.width / RULER_WIDTH || 1
      const deltaPx = (event.clientX - state.startPointerX) / scaleX
      const deltaSeconds = pxToSeconds(deltaPx)
      const mode = state.mode === 'start' ? 'start' : 'end'
      const left = state.virtualLeft
        ? null
        : segmentsRef.current.find((entry) => entry.id === state.leftId)
      const right = state.virtualRight
        ? null
        : segmentsRef.current.find((entry) => entry.id === state.rightId)
      if (!state.virtualLeft && !left) return
      if (!state.virtualRight && !right) return

      const minBoundary = state.leftStart + MIN_BLOCK_SECONDS
      const maxBoundary = state.rightEnd - MIN_BLOCK_SECONDS
      const nextBoundary = clampSeconds(
        Math.min(Math.max(state.initialLeftEnd + deltaSeconds, minBoundary), maxBoundary),
      )

      if (mode === 'end') {
        if (left) {
          left.end = nextBoundary
          const leftIndex = segmentsRef.current.findIndex((entry) => entry.id === left.id)
          if (leftIndex >= 0) {
            syncTrackBlocksToSegment(leftIndex)
          }
        }
        if (right) {
          right.start = nextBoundary
          const rightIndex = segmentsRef.current.findIndex((entry) => entry.id === right.id)
          if (rightIndex >= 0) {
            syncTrackBlocksToSegment(rightIndex)
          }
        }
      } else {
        if (left) {
          left.end = nextBoundary
          const leftIndex = segmentsRef.current.findIndex((entry) => entry.id === left.id)
          if (leftIndex >= 0) {
            syncTrackBlocksToSegment(leftIndex)
          }
        }
        if (right) {
          right.start = nextBoundary
          const rightIndex = segmentsRef.current.findIndex((entry) => entry.id === right.id)
          if (rightIndex >= 0) {
            syncTrackBlocksToSegment(rightIndex)
          }
        }
      }
      bump()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bump],
  )

  // 结束边界拖拽后，清理监听与临时状态。
  const endBoundaryDrag = useCallback(() => {
    if (!boundaryDragStateRef.current) return
    boundaryDragStateRef.current = null
    setPlayheadDragging(false)
    window.removeEventListener('pointermove', handleBoundaryMove)
    window.removeEventListener('pointerup', endBoundaryDrag)
    window.removeEventListener('pointercancel', endBoundaryDrag)
    emitChange()
     
  }, [handleBoundaryMove, emitChange])

  // ============================================================
  // 轨道块拖拽 / 缩放
  // ============================================================

  const handleDragMove = useCallback(
    (event: PointerEvent) => {
      const dragState = dragStateRef.current
      if (!dragState) return

      event.preventDefault()
      const ruler = getRulerElement()
      if (!ruler) return

      const rect = ruler.getBoundingClientRect()
      const scaleX = rect.width / RULER_WIDTH || 1
      const deltaPx = (event.clientX - dragState.startPointerX) / scaleX
      const deltaSeconds = pxToSeconds(deltaPx)
      const list = getTrackList(dragState.trackName)
      const block = list.find((entry) => entry.id === dragState.blockId)

      if (!block) return

      if (dragState.mode === 'move') {
        const duration = dragState.initialEnd - dragState.initialStart
        let nextStart = dragState.initialStart + deltaSeconds
        if (['segments', 'voiceover', 'subtitle', 'sfx'].includes(dragState.trackName)) {
          const listRef = dragState.trackName === 'segments' ? segmentsRef.current : list
          const index = listRef.findIndex((entry) => entry.id === dragState.blockId)
          const prev = index > 0 ? listRef[index - 1] : null
          const next = index >= 0 ? listRef[index + 1] : null
          const minStart = prev ? prev.end : 0
          const maxStart = next ? next.start - duration : totalSeconds - duration
          nextStart = Math.max(minStart, Math.min(nextStart, maxStart))
        } else {
          nextStart = Math.max(0, Math.min(nextStart, totalSeconds - duration))
        }
        block.start = clampSeconds(nextStart)
        block.end = clampSeconds(nextStart + duration)
        if (dragState.trackName === 'segments') {
          const segmentIndex = segmentsRef.current.findIndex(
            (entry) => entry.id === dragState.blockId,
          )
          if (segmentIndex >= 0) {
            syncTrackBlocksToSegment(segmentIndex)
          }
        }
      } else if (dragState.mode === 'resize-end') {
        if (dragState.trackName === 'segments') {
          const blockIndex = segmentsRef.current.findIndex((entry) => entry.id === dragState.blockId)
          const next = blockIndex >= 0 ? segmentsRef.current[blockIndex + 1] : null
          if (!next) {
            let nextEnd = dragState.initialEnd + deltaSeconds
            nextEnd = Math.max(block.start + MIN_BLOCK_SECONDS, Math.min(nextEnd, totalSeconds))
            block.end = clampSeconds(nextEnd)
            if (blockIndex >= 0) {
              syncTrackBlocksToSegment(blockIndex)
            }
            bump()
            return
          }

          const minBoundary = block.start + MIN_BLOCK_SECONDS
          const maxBoundary = next.end - MIN_BLOCK_SECONDS
          const boundary = clampSeconds(
            Math.min(Math.max(dragState.initialEnd + deltaSeconds, minBoundary), maxBoundary),
          )
          block.end = boundary
          next.start = boundary
          if (blockIndex >= 0) {
            syncTrackBlocksToSegment(blockIndex)
            syncTrackBlocksToSegment(blockIndex + 1)
          }
          bump()
          return
        }

        if (['voiceover', 'subtitle', 'sfx'].includes(dragState.trackName)) {
          const blockIndex = list.findIndex((entry) => entry.id === dragState.blockId)
          const next = blockIndex >= 0 ? list[blockIndex + 1] : null
          const minEnd = block.start + MIN_BLOCK_SECONDS
          const maxEnd = next ? next.start - MIN_BLOCK_SECONDS : totalSeconds
          const nextEnd = clampSeconds(
            Math.min(Math.max(dragState.initialEnd + deltaSeconds, minEnd), maxEnd),
          )
          block.end = nextEnd
          bump()
          return
        }

        let nextEnd = dragState.initialEnd + deltaSeconds
        nextEnd = Math.max(block.start + MIN_BLOCK_SECONDS, Math.min(nextEnd, totalSeconds))
        block.end = clampSeconds(nextEnd)
      } else if (dragState.mode === 'resize-start') {
        if (dragState.trackName === 'segments') {
          const blockIndex = segmentsRef.current.findIndex((entry) => entry.id === dragState.blockId)
          const prev = blockIndex > 0 ? segmentsRef.current[blockIndex - 1] : null
          if (!prev) {
            let nextStart = dragState.initialStart + deltaSeconds
            nextStart = Math.max(0, Math.min(nextStart, block.end - MIN_BLOCK_SECONDS))
            block.start = clampSeconds(nextStart)
            if (blockIndex >= 0) {
              syncTrackBlocksToSegment(blockIndex)
            }
            bump()
            return
          }

          const minBoundary = prev.start + MIN_BLOCK_SECONDS
          const maxBoundary = block.end - MIN_BLOCK_SECONDS
          const boundary = clampSeconds(
            Math.min(Math.max(dragState.initialStart + deltaSeconds, minBoundary), maxBoundary),
          )
          prev.end = boundary
          block.start = boundary
          if (blockIndex >= 0) {
            syncTrackBlocksToSegment(blockIndex - 1)
            syncTrackBlocksToSegment(blockIndex)
          }
          bump()
          return
        }

        if (['voiceover', 'subtitle', 'sfx'].includes(dragState.trackName)) {
          const blockIndex = list.findIndex((entry) => entry.id === dragState.blockId)
          const prev = blockIndex > 0 ? list[blockIndex - 1] : null
          const minStart = prev ? prev.end + MIN_BLOCK_SECONDS : 0
          const maxStart = block.end - MIN_BLOCK_SECONDS
          const nextStart = clampSeconds(
            Math.min(Math.max(dragState.initialStart + deltaSeconds, minStart), maxStart),
          )
          block.start = nextStart
          bump()
          return
        }

        let nextStart = dragState.initialStart + deltaSeconds
        nextStart = Math.max(0, Math.min(nextStart, block.end - MIN_BLOCK_SECONDS))
        block.start = clampSeconds(nextStart)
      }
      bump()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getTrackList, totalSeconds, bump],
  )

  const endDrag = useCallback(() => {
    if (!dragStateRef.current) return
    dragStateRef.current = null
    window.removeEventListener('pointermove', handleDragMove)
    window.removeEventListener('pointerup', endDrag)
    window.removeEventListener('pointercancel', endDrag)
    emitChange()

  }, [handleDragMove, emitChange])

  // 在刻度条上拖拽「选中镜头段高亮」的左右把手来调整该段时长/边界。
  // 复用已完整实现的 handleDragMove（segments 轨道的 resize-start/resize-end），
  // 监听器用每次手势内新建的闭包 add/remove，规避 handleDragMove 引用随渲染变化导致的解绑泄漏。
  function startSegmentResize(event: ReactPointerEvent, mode: 'resize-start' | 'resize-end') {
    const segment = selectedSegment
    if (!segment) return
    event.preventDefault()
    event.stopPropagation()
    dragStateRef.current = {
      trackName: 'segments',
      blockId: segment.id,
      mode,
      startPointerX: event.clientX,
      initialStart: segment.start,
      initialEnd: segment.end,
    }
    const move = (e: PointerEvent) => handleDragMove(e)
    const end = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      dragStateRef.current = null
      emitChange()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  // ============================================================
  // 选择 / 编辑器操作
  // ============================================================

  function selectSegment(segment: TimelineSegment) {
    setSelectedSegmentId(segment.id)
  }

  function getSelectedSegmentIndex(): number {
    const segment = selectedSegment
    if (!segment) return -1
    return segmentsRef.current.findIndex((entry) => entry.id === segment.id)
  }

  function getStoryboardPrompt(segment: TimelineSegment, index: number): string {
    const storyboard = getStoryboardForSegment(segment)
    const prompt = String(storyboard?.prompt || '').trim()
    if (prompt) return prompt
    const title = String(storyboard?.title || '').trim()
    if (title) return title
    return `分镜 ${index + 1}`
  }

  function getShotDraftText(): string {
    const segment = selectedSegment
    if (!segment) return ''
    const index = Math.max(getSelectedSegmentIndex(), 0)
    return getStoryboardPrompt(segment, index)
  }

  function pickTrackBlockForSelectedSegment(trackName: string): TimelineTrackBlock | null {
    const index = getSelectedSegmentIndex()
    if (index < 0) return null
    const list = getTrackList(trackName)
    return list[index] || null
  }

  function setSelectedTrackBlock(trackName: string, blockId: string) {
    setSelectedTrackName(trackName)
    setSelectedTrackBlockId(blockId)
  }

  function selectEditingBlock(trackName: string, blockId: string) {
    setEditorMode(trackName as any)
    setSelectedTrackBlock(trackName, blockId)
    const list = getTrackList(trackName)
    const block = list.find((entry) => entry.id === blockId)
    const text = block?.text || ''
    timelineOriginalRef.current = text
    setTimelineDraft(text)
  }

  function openShotEditor() {
    setEditorMode('shot')
    setSelectedTrackName('')
    setSelectedTrackBlockId('')
    const text = getShotDraftText()
    timelineOriginalRef.current = text
    setTimelineDraft(text)
  }

  function openVoiceoverEditor() {
    const block = pickTrackBlockForSelectedSegment('voiceover')
    if (block) {
      selectEditingBlock('voiceover', block.id)
      return
    }
    setEditorMode('voiceover')
    setSelectedTrackName('')
    setSelectedTrackBlockId('')
    const text = selectedSegment?.voiceover || ''
    timelineOriginalRef.current = text
    setTimelineDraft(text)
  }

  function openSfxEditor() {
    const block = pickTrackBlockForSelectedSegment('sfx')
    if (block) {
      selectEditingBlock('sfx', block.id)
      return
    }
    setEditorMode('sfx')
    setSelectedTrackName('')
    setSelectedTrackBlockId('')
    const text = selectedSegment?.sfx || ''
    timelineOriginalRef.current = text
    setTimelineDraft(text)
  }

  function updateSegmentText(field: 'voiceover' | 'subtitle' | 'sfx', value: string) {
    if (!selectedSegment) return
    selectedSegment[field] = value
    emitChange()
  }

  function updateTimelineDraft(value: string) {
    setTimelineDraft(value)
  }

  function updateStoryboardPrompt(segment: TimelineSegment, value: string) {
    if (!segment) return
    props.onUpdateStoryboardPrompt?.({
      segmentId: segment.id,
      storyboardIndex: segment.storyboardIndex ?? segmentsRef.current.indexOf(segment),
      prompt: value,
    })
  }

  function applyTimelineDraft() {
    if (isApplyingDraft) return
    setIsApplyingDraft(true)

    if (editorMode === 'shot') {
      const segment = selectedSegment
      if (segment) {
        updateStoryboardPrompt(segment, timelineDraft)
        timelineOriginalRef.current = timelineDraft
        window.setTimeout(() => {
          setIsApplyingDraft(false)
        }, 280)
        return
      }
    }

    const block = selectedTrackBlock
    if (
      block &&
      (selectedTrackName === 'voiceover' ||
        selectedTrackName === 'subtitle' ||
        selectedTrackName === 'sfx')
    ) {
      block.text = timelineDraft
      timelineOriginalRef.current = block.text
      const key = `${selectedTrackName}:${block.id}`
      setSyncedBlockKey(key)
      emitChange()
      props.onSynced?.({ trackName: selectedTrackName, blockId: block.id })
      window.setTimeout(() => {
        setSyncedBlockKey((prev) => (prev === key ? '' : prev))
      }, 900)
      window.setTimeout(() => {
        setIsApplyingDraft(false)
      }, 280)
      return
    }

    if (!selectedSegment) {
      window.setTimeout(() => {
        setIsApplyingDraft(false)
      }, 280)
      return
    }

    updateSegmentText('voiceover', timelineDraft)
    timelineOriginalRef.current = timelineDraft
    window.setTimeout(() => {
      setIsApplyingDraft(false)
    }, 280)
  }

  function resetTimelineDraft() {
    setTimelineDraft(timelineOriginalRef.current)
  }

  // ============================================================
  // 刻度条 / 预览播放
  // ============================================================

  const [scaleCursorSeconds, setScaleCursorSeconds] = useState(0)
  const scaleCursorPct = useMemo(() => {
    const max = scaleTotalSeconds || 1
    const value = clampSeconds(scaleCursorSeconds || 0)
    return (value / max) * 100
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scaleTotalSeconds, scaleCursorSeconds])

  function selectSegmentBySecond(second: number) {
    const seconds = clampSeconds(second)
    const hit =
      segmentsRef.current.find(
        (segment) => seconds >= Number(segment.start || 0) && seconds < Number(segment.end || 0),
      ) ||
      segmentsRef.current.find((segment) => seconds <= Number(segment.start || 0)) ||
      segmentsRef.current[segmentsRef.current.length - 1] ||
      null
    if (hit) selectSegment(hit)
  }

  function handleScaleClick(event: React.MouseEvent<HTMLDivElement>) {
    const track = event?.currentTarget
    if (!track?.getBoundingClientRect) return
    const rect = track.getBoundingClientRect()
    const max = scaleTotalSeconds || 1
    const pct = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1)
    const seconds = pct * max
    setScaleCursorSeconds(seconds)
    selectSegmentBySecond(seconds)
  }

  // 预览播放（rAF 驱动）
  const previewRafRef = useRef(0)
  const previewStartAtRef = useRef(0)
  const previewStartSecRef = useRef(0)
  const previewEndSecRef = useRef(0)

  const stopPreview = useCallback(() => {
    if (previewRafRef.current) cancelAnimationFrame(previewRafRef.current)
    previewRafRef.current = 0
  }, [])

  // 注：tickPreview 当前未被模板触发，handlePreviewPlay 走 coming-soon。
  // 保留逻辑以忠实迁移。
  const tickPreview = useCallback((now: number) => {
    const elapsed = (now - previewStartAtRef.current) / 1000
    const next = previewStartSecRef.current + elapsed
    setScaleCursorSeconds(Math.min(next, previewEndSecRef.current))
    if (next >= previewEndSecRef.current) {
      if (previewRafRef.current) cancelAnimationFrame(previewRafRef.current)
      previewRafRef.current = 0
      return
    }
    previewRafRef.current = requestAnimationFrame(tickPreview)
  }, [])
  // 引用以避免未使用告警（与源保持等价）
  void tickPreview

  function handlePreviewPlay() {
    props.onComingSoon?.('视频预览播放')
  }

  async function handleModifyCurrentSegment() {
    if (!selectedSegment) return
    stopPreview()
    openShotEditor()
    // 等待 DOM 更新后聚焦（对应 Vue nextTick）
    requestAnimationFrame(() => {
      editorCardRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
      requestAnimationFrame(() => {
        editorTextareaRef.current?.focus?.()
      })
    })
  }

  // ============================================================
  // 副作用（对应 Vue watch / onBeforeUnmount）
  // ============================================================

  // watch(() => props.timeline, syncTracksFromProps, { immediate, deep })
  useEffect(() => {
    segmentsRef.current = (timeline?.segments || []).map((segment: any, index: number) => ({
      id: segment.id || `segment-${index + 1}`,
      storyboardIndex: segment.storyboardIndex ?? index,
      start: Number(segment.start) || 0,
      end: Number(segment.end) || 0,
      voiceover: segment.voiceover || '',
      subtitle: segment.subtitle || '',
      sfx: segment.sfx || '',
    }))
    voiceoverRef.current = cloneTrack(timeline?.voiceover, 'voice')
    subtitleRef.current = cloneTrack(timeline?.subtitle, 'subtitle')
    sfxRef.current = cloneTrack(timeline?.sfx, 'sfx')

    setSelectedSegmentId((prev) => {
      if (!prev && segmentsRef.current.length) return segmentsRef.current[0].id
      return prev
    })

    setSelectedTrackName((prevName) => {
      if (prevName && selectedTrackBlockId) {
        const list = getTrackList(prevName)
        if (!list.find((block) => block.id === selectedTrackBlockId)) {
          setSelectedTrackBlockId('')
          return ''
        }
      }
      return prevName
    })

    bump()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline])

  // watch(selectedSegment.id): 切换分镜时停止预览，若未选轨道块则打开镜头编辑器
  useEffect(() => {
    stopPreview()
    if (selectedTrackBlock) return
    openShotEditor()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSegment?.id])

  // watch(selectedTrackBlock.id): 同步草稿文本
  useEffect(() => {
    const block = selectedTrackBlock
    if (!block) return
    const text = block.text || ''
    timelineOriginalRef.current = text
    setTimelineDraft(text)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTrackBlock?.id])

  // onBeforeUnmount: 清理拖拽与预览
  useEffect(() => {
    return () => {
      endDrag()
      endBoundaryDrag()
      stopPreview()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ============================================================
  // 渲染
  // ============================================================

  return (
    <section className="timeline-editor" style={panelStyle} aria-label="时间线编辑">
      <div className="timeline-layout">
        <div className="timeline-left">
          <div className="timeline-preview-card" aria-label="镜头预览">
            <div
              className={`timeline-preview-surface${selectedStoryboard?.src ? ' has-image' : ''}`}
              style={{
                width: '600px',
                aspectRatio: '1/1',
                backgroundImage: selectedStoryboard?.src
                  ? `url(${selectedStoryboard.src})`
                  : 'none',
                backgroundSize: 'contain',
                backgroundPosition: 'center',
                backgroundRepeat: 'no-repeat',
              }}
            >
              {!selectedStoryboard?.src && (
                <div className="timeline-preview-placeholder">暂无预览图</div>
              )}
              <button
                type="button"
                className="timeline-preview-play"
                aria-label="播放预览"
                onClick={handlePreviewPlay}
              >
                <img
                  className="timeline-preview-play-icon"
                  src={playIcon}
                  alt=""
                  draggable={false}
                />
              </button>
              <button
                type="button"
                className="timeline-preview-edit"
                disabled={!selectedSegment}
                onClick={handleModifyCurrentSegment}
              >
                修改此分镜
              </button>
            </div>
            <div className="timeline-preview-bottom" aria-label="分镜缩略图与时间轴">
              <div className="timeline-storyboard-strip" aria-label="分镜卡片列表">
                {segments.map((segment, index) => {
                  const board = getStoryboardForSegment(segment)
                  return (
                    <button
                      key={`thumb-${segment.id}`}
                      type="button"
                      className={`timeline-storyboard-card${
                        selectedSegmentId === segment.id ? ' selected' : ''
                      }`}
                      onClick={() => selectSegment(segment)}
                    >
                      <span className="timeline-storyboard-cover">
                        {/* 层1: 骨架占位（始终存在，120×120 浅灰底） */}
                        <span className="timeline-storyboard-skeleton"></span>

                        {/* 层2: 图片（loaded 后 opacity 0→1 过渡） */}
                        {board?.src && (
                          <img
                            src={board.src}
                            alt={'分镜' + (index + 1)}
                            className={
                              imageLoadState[board?.id] === 'loaded' ? 'is-loaded' : undefined
                            }
                            onLoad={() => onThumbLoad(board?.id)}
                            onError={() => onThumbError(board?.id)}
                          />
                        )}

                        {/* 层3: 正在生成遮罩（per-card，只覆盖本卡片内容区） */}
                        {isThumbGenerating(board) ? (
                          <span className="timeline-storyboard-loading">
                            <span className="ts-loading-spinner"></span>
                          </span>
                        ) : isThumbFailed(board) ? (
                          /* 层4: 失败态 */
                          <span className="timeline-storyboard-failed">
                            <span className="ts-failed-icon">!</span>
                          </span>
                        ) : isThumbPending(board) ? (
                          /* 层5: 排队中角标（弱提示） */
                          <span className="timeline-storyboard-queued">排队中</span>
                        ) : null}

                        {/* 底部字幕 */}
                        <span className="timeline-storyboard-caption" aria-hidden="true">
                          <span className="timeline-storyboard-caption__left">
                            分镜{index + 1}
                          </span>
                          <span className="timeline-storyboard-caption__right">
                            {formatDuration(segment.end - segment.start)}
                          </span>
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
              <div className="timeline-scale" aria-label="时间刻度条">
                <div
                  className="timeline-scale-track timeline-ruler-hitbox"
                  role="button"
                  tabIndex={0}
                  onClick={handleScaleClick}
                >
                  <span
                    className="timeline-scale-highlight"
                    style={{ left: `${selectedRangePct.left}%`, width: `${selectedRangePct.width}%` }}
                  >
                    {selectedSegment && (
                      <>
                        <span
                          className="timeline-scale-handle timeline-scale-handle--start"
                          role="slider"
                          aria-label="调整镜头起始时间"
                          onClick={(e) => e.stopPropagation()}
                          onPointerDown={(e) => startSegmentResize(e, 'resize-start')}
                        ></span>
                        <span
                          className="timeline-scale-handle timeline-scale-handle--end"
                          role="slider"
                          aria-label="调整镜头结束时间"
                          onClick={(e) => e.stopPropagation()}
                          onPointerDown={(e) => startSegmentResize(e, 'resize-end')}
                        ></span>
                      </>
                    )}
                  </span>
                  <span
                    className="timeline-scale-cursor"
                    style={{ left: `${scaleCursorPct}%` }}
                    aria-hidden="true"
                  ></span>
                </div>
                <div className="timeline-scale-labels" aria-hidden="true">
                  {miniTimelineMarks.map((mark) => (
                    <span
                      key={mark.pct}
                      className="timeline-scale-label"
                      style={{ left: `${mark.pct}%` }}
                    >
                      {mark.label}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <aside className="timeline-right" aria-label="镜头信息与编辑">
          <div className="timeline-info-cards">
            <button
              type="button"
              className={`timeline-info-card${editorMode === 'shot' ? ' active' : ''}`}
              onClick={openShotEditor}
            >
              <div className="timeline-info-card__head">
                <b>镜头描述</b>
                {selectedSegment && <span>{formatRange(selectedSegment)}</span>}
              </div>
              <p className="timeline-info-card__body">
                {selectedStoryboard?.prompt || selectedStoryboard?.title || '暂无镜头描述'}
              </p>
            </button>

            <button
              type="button"
              className={`timeline-info-card${editorMode === 'voiceover' ? ' active' : ''}`}
              onClick={openVoiceoverEditor}
            >
              <div className="timeline-info-card__head">
                <b>台词旁白</b>
                {selectedSegment && <span>{formatRange(selectedSegment)}</span>}
              </div>
              <p className="timeline-info-card__body">
                {pickTrackBlockForSelectedSegment('voiceover')?.text ||
                  selectedSegment?.voiceover ||
                  '暂无台词旁白'}
              </p>
            </button>

            <button
              type="button"
              className={`timeline-info-card${editorMode === 'sfx' ? ' active' : ''}`}
              onClick={openSfxEditor}
            >
              <div className="timeline-info-card__head">
                <b>音效配乐</b>
                {selectedSegment && <span>{formatRange(selectedSegment)}</span>}
              </div>
              <p className="timeline-info-card__body">
                {pickTrackBlockForSelectedSegment('sfx')?.text ||
                  selectedSegment?.sfx ||
                  '暂无音效配乐'}
              </p>
            </button>
          </div>

          <div className="timeline-editor-section">
            {selectedSegment && (
              <article
                ref={editorCardRef as any}
                className="timeline-editor-card"
              >
                <header className="timeline-editor-card__head">
                  <div className="timeline-editor-card__title">
                    <span>{editingTitle}</span>
                    <b>{editingRangeLabel}</b>
                  </div>
                </header>

                <textarea
                  ref={editorTextareaRef}
                  className="timeline-editor-card__textarea"
                  value={timelineDraft}
                  placeholder="输入你的修改内容..."
                  aria-label="修改描述"
                  onChange={(e) => updateTimelineDraft(e.target.value)}
                ></textarea>

                <footer className="timeline-editor-card__footer">
                  <button
                    type="button"
                    className="timeline-editor-card__btn ghost"
                    disabled={isReloading}
                    onClick={() =>
                      props.onReload?.({
                        segmentId: selectedSegment?.id || '',
                        instruction: timelineDraft,
                      })
                    }
                  >
                    {isReloading ? '加载中...' : '重新加载'}
                  </button>
                  <button
                    type="button"
                    className="timeline-editor-card__btn ghost"
                    disabled={isReloading}
                    onClick={resetTimelineDraft}
                  >
                    重置
                  </button>
                  <button
                    type="button"
                    className="timeline-editor-card__btn primary"
                    aria-label="应用修改"
                    disabled={isApplyingDraft || isReloading}
                    onClick={applyTimelineDraft}
                  >
                    应用
                  </button>
                  {reloadReady && (
                    <button
                      type="button"
                      className="timeline-editor-card__btn ghost"
                      disabled={isReloading}
                      onClick={() => props.onApproveReload?.()}
                    >
                      生成新分镜图
                    </button>
                  )}
                </footer>
              </article>
            )}

            <div className="timeline-right-footer">
              <div className="timeline-cost">
                  <button
                    type="button"
                    className="timeline-cost-refresh"
                    disabled={isEstimatingVideoCost}
                    onClick={() => props.onEstimateVideoCost?.()}
                  >
                    {isEstimatingVideoCost ? '预估中...' : '刷新预估'}
                  </button>
                  {videoCostEstimateError ? (
                    <span className="timeline-cost-text error">{videoCostEstimateError}</span>
                  ) : hasEstimate ? (
                    <span className={`timeline-cost-text${canAffordEstimate ? '' : ' error'}`}>
                      {canAffordEstimate ? '预计消耗' : '余额不足，预计需要'} {num(estimatedCost)} 积分
                      · 余额 {num(estimatedBalance)} 积分
                    </span>
                  ) : (
                    <span className="timeline-cost-text">未预估</span>
                  )}
                </div>
                <button
                  type="button"
                  className="timeline-generate-video"
                  disabled={isEstimatingVideoCost || (hasEstimate && !canAffordEstimate)}
                  onClick={() => props.onGenerateVideo?.()}
                >
                  生成视频
                </button>
              </div>
          </div>
        </aside>
      </div>
    </section>
  )
}
