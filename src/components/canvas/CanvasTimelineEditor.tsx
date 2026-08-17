/**
 * 剪辑时间线编辑器：一条主视频轨道的基础剪辑（对标剪映的基础剪辑模式）。
 *
 * 轨道按「像素/秒」排版而不是按时长占比分配宽度——只有时间与像素成正比，
 * 刻度尺、播放头、吸附、边缘裁剪才对得上；按占比排版的轨道上，这些东西全都是假的。
 *
 * 三种指针交互共用一条轨道，靠按下的位置区分：
 *   片段中段按下 → 拖动排序（拖过邻段中点才换位）
 *   片段左右边缘 → 裁剪入点/出点
 *   刻度尺或轨道空白 → 定位播放头
 * 拖动过程中只在本地预演，松手才写回一次 onChange：否则一次拖动会灌进几十条历史、
 * 也会把上层的草稿保存打成一串抖动的请求。
 *
 * 受控组件——时间线状态由画布节点持有，这里只负责编辑与预览。
 * 预览复用画布节点里那个播放器（CanvasTimelinePlayer，隐去它自带的轨道），
 * 合成本身由 onCompose 交给上层的合成引擎执行。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { assetStreamUrl } from '@/utils/assetUrl'
import { buildFilmstrip, getCachedFilmstrip } from '@/utils/videoFilmstrip'
import {
  MAX_TIMELINE_CLIPS,
  MIN_CLIP_DURATION_SEC,
  buildTimelineTicks,
  formatTimelineTime,
  getClipDuration,
  getClipOffsets,
  getTimelineDuration,
  locateTimelineTime,
  addTimelineKeyframe,
  duplicateTimelineClip,
  removeTimelineKeyframe,
  removeTimelineClip,
  reorderTimelineClips,
  resolveTimelineDropIndex,
  roundSeconds,
  setTimelineClipMuted,
  splitTimelineClip,
  snapTimelineTime,
  trimTimelineClip,
  validateTimeline,
  type TimelineClip,
  type TimelineState,
} from '@/utils/timelineClips'
import CanvasTimelinePlayer from './CanvasTimelinePlayer'
import styles from './CanvasTimelineEditor.module.css'

interface CanvasTimelineEditorProps {
  open: boolean
  workspaceId: number
  state: TimelineState
  onChange: (next: TimelineState) => void
  onClose: () => void
  /** 画布上可加入的视频节点（已有素材、且还不在时间线里）。 */
  addableSources?: ReadonlyArray<{ nodeId: string; assetId: number; label: string; thumbnailUrl: string }>
  /** 把画布上的某个视频节点加成片段；不依赖手动拉线，空时间线也能起步。 */
  onAddClip?: (sourceNodeId: string) => void
  /** 已连线但来源视频还没生成出素材的数量，这类连线暂时产生不了片段。 */
  pendingSourceCount?: number
  /** 合成入口；未提供时按钮禁用并说明原因。cutlist 由上层按节点自行组装。 */
  onCompose?: () => void
  composing?: boolean
  /** 合成各阶段的文案（读取素材 / 合成 / 保存），合成中显示在按钮上。 */
  composeProgress?: string
  /** 合成引擎不可用时的说明，例如「等待后端合成接口」。 */
  composeDisabledReason?: string
  /** 素材规格兼容性提示，由上层探测后传入。 */
  compatibilityNote?: string
  /** 将当前选中的裁剪片段作为一个新的视频节点放回画布。 */
  onAddClipToCanvas?: (clip: TimelineClip) => void
}

/** 缩放下限：再小片段就细成一条线，认不出也点不中。 */
const MIN_PX_PER_SEC = 6
/** 缩放上限：1 秒占满半屏已经够做逐帧微调了，再放大只是空转。 */
const MAX_PX_PER_SEC = 480
/** 吸附半径（像素）。用像素而不是秒：不管缩放到哪一档，手感都一样。 */
const SNAP_THRESHOLD_PX = 8
/** 位移小于这个像素数按「点击」处理，否则轻微抖动会把点选变成一次排序。 */
const MOVE_THRESHOLD_PX = 4
/** 键盘微调步长；按住 Shift 走大步。这是裁剪与定位唯一的非指针通道。 */
const NUDGE_STEP_SEC = 0.1
const NUDGE_STEP_LARGE_SEC = 1
/** 历史栈深度，撤销/重做各保留这么多步。 */
const HISTORY_LIMIT = 50

/**
 * 抓住指针，让拖出元素之后的 move/up 仍然回到这里。
 *
 * 包 try 是必要的而不是保守：指针在按下与捕获之间被系统收走（触摸被手势接管、笔离开数位板）时
 * setPointerCapture 会抛 NotFoundError；不接住的话整个 pointerdown 处理就断在这里，
 * 拖动状态没建起来，后面的一切都不会发生。捕获失败最多是拖出元素后跟丢，不该让按下本身失败。
 */
function capturePointer(element: Element, pointerId: number): void {
  try {
    element.setPointerCapture?.(pointerId)
  } catch {
    /* 指针已失效，按不捕获处理 */
  }
}

function releasePointer(element: Element, pointerId: number): void {
  try {
    element.releasePointerCapture?.(pointerId)
  } catch {
    /* 已经自动释放 */
  }
}

type DragState =
  | {
      mode: 'move'
      clipId: string
      index: number
      startX: number
      dxPx: number
      targetIndex: number
      moved: boolean
    }
  | {
      mode: 'trimIn' | 'trimOut'
      clipId: string
      index: number
      startX: number
      inSec: number
      outSec: number
      snappedSec: number | null
    }

export default function CanvasTimelineEditor({
  open,
  workspaceId,
  state,
  onChange,
  onClose,
  onAddClip,
  addableSources = [],
  pendingSourceCount = 0,
  onCompose,
  composing = false,
  composeProgress = '',
  composeDisabledReason = '',
  compatibilityNote = '',
  onAddClipToCanvas,
}: CanvasTimelineEditorProps) {
  const [playheadSec, setPlayheadSec] = useState(0)
  const [selectedClipId, setSelectedClipId] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [drag, setDrag] = useState<DragState | null>(null)
  // 0 表示「适应宽度」：整条片子铺满可视区，换片段/换窗宽都自动跟随
  const [zoomPxPerSec, setZoomPxPerSec] = useState(0)
  const [viewportWidth, setViewportWidth] = useState(0)
  const [filmstrips, setFilmstrips] = useState<Record<number, string[]>>({})
  const [history, setHistory] = useState<TimelineState[]>([])
  const [future, setFuture] = useState<TimelineState[]>([])

  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  // 用 useMemo 固定引用：clips 直接参与下面副作用的依赖，每次渲染新建数组会让副作用反复触发
  const clips = useMemo(() => state?.clips || [], [state])
  const offsets = useMemo(() => getClipOffsets(state), [state])
  const totalSec = getTimelineDuration(state)
  const located = useMemo(() => locateTimelineTime(state, playheadSec), [state, playheadSec])
  const problems = useMemo(() => validateTimeline(state), [state])

  /**
   * 拖动裁剪时的预演状态。
   *
   * 只有它进播放器与属性面板：拖动中就能看到裁到哪一帧、片段变成多长，
   * 而轨道排版仍按已提交的状态走（被拖的那块单独画），松手前后不会整条轨道跳一下。
   */
  const draftState = useMemo(() => {
    if (!drag || drag.mode === 'move') return state
    return trimTimelineClip(state, drag.clipId, { inSec: drag.inSec, outSec: drag.outSec })
  }, [state, drag])
  const draftClips = useMemo(() => draftState.clips || [], [draftState])
  const draftTotalSec = getTimelineDuration(draftState)

  const selectedClip = draftClips.find((clip) => clip.id === selectedClipId) || null
  const selectedIndex = draftClips.findIndex((clip) => clip.id === selectedClipId)
  /** 工具栏的作用对象：优先选中的片段，没选中就落在播放头所在的那段。 */
  const targetClip = selectedClip || located?.clip || null
  const targetIndex = targetClip ? draftClips.findIndex((clip) => clip.id === targetClip.id) : -1

  // 片段被删除或时间线变短后，播放头与选中态都不能停留在已经不存在的位置上
  useEffect(() => {
    if (playheadSec > totalSec) setPlayheadSec(totalSec)
    if (selectedClipId && !clips.some((clip) => clip.id === selectedClipId)) setSelectedClipId('')
  }, [clips, playheadSec, selectedClipId, totalSec])

  const update = useCallback(
    (next: TimelineState) => {
      if (next === state) return
      setHistory((stack) => [...stack.slice(-(HISTORY_LIMIT - 1)), state])
      setFuture([])
      onChange(next)
    },
    [onChange, state],
  )

  /*
   * 撤销/重做都从当前的 history/future 数组直接读，而不是在 setState 的更新函数里顺手做事：
   * 更新函数在严格模式下会被调用两次，把 onChange 写在里面等于往上层推两次状态。
   * 这两个动作都由一次点击触发，读到的一定是最新数组，不需要函数式更新来防竞态。
   */
  const undo = useCallback(() => {
    if (!history.length) return
    const previous = history[history.length - 1]
    setHistory(history.slice(0, -1))
    setFuture([...future.slice(-(HISTORY_LIMIT - 1)), state])
    onChange(previous)
  }, [history, future, onChange, state])

  const redo = useCallback(() => {
    if (!future.length) return
    const next = future[future.length - 1]
    setFuture(future.slice(0, -1))
    setHistory([...history.slice(-(HISTORY_LIMIT - 1)), state])
    onChange(next)
  }, [history, future, onChange, state])

  // ── 缩放与排版 ────────────────────────────────────────────────

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    setViewportWidth(element.getBoundingClientRect().width || 0)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => setViewportWidth(entries[0]?.contentRect?.width || 0))
    observer.observe(element)
    return () => observer.disconnect()
  }, [open])

  const fitPxPerSec = draftTotalSec > 0 && viewportWidth > 0 ? viewportWidth / draftTotalSec : 60
  const livePxPerSec = Math.min(MAX_PX_PER_SEC, Math.max(MIN_PX_PER_SEC, zoomPxPerSec || fitPxPerSec))

  /**
   * 拖动期间冻结缩放比例。
   *
   * 「适应宽度」是按总时长算的，而裁剪会让总时长边拖边变——不冻结的话每动一像素整条轨道就重新缩放一次：
   * 手上拖的边缘跟不上指针，没碰的片段还会自己变宽变窄。缩放这件事得等松手之后再重新适应。
   */
  const frozenPxPerSecRef = useRef(livePxPerSec)
  useEffect(() => {
    if (!drag) frozenPxPerSecRef.current = livePxPerSec
  }, [drag, livePxPerSec])
  const pxPerSec = drag ? frozenPxPerSecRef.current : livePxPerSec
  const contentWidth = Math.max(draftTotalSec * pxPerSec, viewportWidth)
  const ticks = useMemo(() => buildTimelineTicks(draftTotalSec, draftTotalSec * pxPerSec), [draftTotalSec, pxPerSec])

  /** 吸附参考点：时间线两端、每个片段的边界、播放头、关键帧。 */
  const snapPoints = useMemo(() => {
    const points = [0, totalSec, playheadSec]
    clips.forEach((clip, index) => {
      const offset = offsets[index] || 0
      points.push(offset, offset + getClipDuration(clip))
      ;(clip.keyframes || []).forEach((frame) => points.push(offset + frame.timeSec - clip.inSec))
    })
    return points
  }, [clips, offsets, playheadSec, totalSec])

  const snapSec = useCallback(
    (value: number) => snapTimelineTime(value, snapPoints, SNAP_THRESHOLD_PX / pxPerSec),
    [snapPoints, pxPerSec],
  )

  /** 指针横坐标 → 成片时刻。以轨道内容元素为基准，天然算进了横向滚动。 */
  const timeFromClientX = useCallback(
    (clientX: number) => {
      const rect = contentRef.current?.getBoundingClientRect()
      if (!rect || !(pxPerSec > 0)) return 0
      return Math.min(Math.max(0, (clientX - rect.left) / pxPerSec), draftTotalSec)
    },
    [pxPerSec, draftTotalSec],
  )

  /**
   * 轨道排版：每块片段的左端与宽度（像素）。
   *
   * 拖动排序时按预演顺序排位，其余片段实时让位；被拖的那块跟着指针走。
   * 拖动裁剪时其余片段一律留在原位——让整条轨道跟着裁剪实时坍缩，
   * 手上拖的边缘就会和指针分家，那才是真的难用。
   */
  const layout = useMemo(() => {
    const previewClips =
      drag?.mode === 'move' ? reorderTimelineClips(state, drag.index, drag.targetIndex).clips || [] : clips
    const previewOffsets = getClipOffsets({ clips: previewClips })
    const leftById = new Map<string, number>()
    previewClips.forEach((clip, index) => leftById.set(clip.id, previewOffsets[index] || 0))

    return clips.map((clip, index) => {
      const originalOffset = offsets[index] || 0
      if (drag && drag.clipId === clip.id) {
        if (drag.mode === 'move') {
          return {
            clip,
            index,
            leftPx: originalOffset * pxPerSec + drag.dxPx,
            widthPx: getClipDuration(clip) * pxPerSec,
            dragging: true,
          }
        }
        const duration = Math.max(MIN_CLIP_DURATION_SEC, drag.outSec - drag.inSec)
        const shiftSec = drag.mode === 'trimIn' ? drag.inSec - clip.inSec : 0
        return {
          clip: { ...clip, inSec: drag.inSec, outSec: drag.outSec },
          index,
          leftPx: (originalOffset + shiftSec) * pxPerSec,
          widthPx: duration * pxPerSec,
          dragging: true,
        }
      }
      return {
        clip,
        index,
        leftPx: (leftById.get(clip.id) ?? originalOffset) * pxPerSec,
        widthPx: getClipDuration(clip) * pxPerSec,
        dragging: false,
      }
    })
  }, [clips, offsets, state, drag, pxPerSec])

  // 播放头跑出可视区就跟着滚，长片子播放时不用手动追
  useEffect(() => {
    const element = scrollRef.current
    if (!element || element.clientWidth <= 0) return
    const x = playheadSec * pxPerSec
    const margin = 32
    if (x < element.scrollLeft + margin) element.scrollLeft = Math.max(0, x - margin)
    else if (x > element.scrollLeft + element.clientWidth - margin) {
      element.scrollLeft = x - element.clientWidth + margin
    }
  }, [playheadSec, pxPerSec])

  /**
   * 每条素材的缩略帧，铺在片段块上当胶片条。
   * 抽帧要 seek + 解码，只在片段进入轨道后异步补上；没取到就保持纯色底。
   */
  useEffect(() => {
    if (!open) return
    let cancelled = false
    const assetIds = [...new Set(clips.map((clip) => clip.assetId).filter((assetId) => assetId > 0))]
    for (const assetId of assetIds) {
      const url = assetStreamUrl(assetId, workspaceId)
      if (!url) continue
      const cached = getCachedFilmstrip(url)
      if (cached) {
        setFilmstrips((current) => (current[assetId] ? current : { ...current, [assetId]: cached }))
        continue
      }
      void buildFilmstrip(url).then((frames) => {
        if (cancelled || !frames.length) return
        setFilmstrips((current) => ({ ...current, [assetId]: frames }))
      })
    }
    return () => {
      cancelled = true
    }
  }, [clips, workspaceId, open])

  // ── 编辑动作 ──────────────────────────────────────────────────

  const seekTo = useCallback(
    (seconds: number, snap = true) => {
      const raw = Math.min(Math.max(0, seconds), draftTotalSec)
      setPlayheadSec(snap ? Math.min(snapSec(raw), draftTotalSec) : raw)
    },
    [draftTotalSec, snapSec],
  )

  /**
   * 分割落在播放头所在的那一段，而不是当前选中的那一段。
   *
   * 分割这件事本来就是由播放头定义的。跟着选中走的话，只要选中的段和播放头不在一处，
   * 按钮就会灰着说「把播放头移到片段中间」——而播放头明明就在某个片段中间，是个死路。
   * 其余动作（删除/静音/复制）与播放头无关，仍以选中为准。
   */
  const splitClip = located?.clip || null
  const splitOffsetSec = located?.clipOffsetSec ?? -1
  const canSplit =
    splitClip !== null &&
    splitOffsetSec >= MIN_CLIP_DURATION_SEC &&
    getClipDuration(splitClip) - splitOffsetSec >= MIN_CLIP_DURATION_SEC

  const handleSplit = useCallback(() => {
    if (!splitClip || !canSplit) return
    update(splitTimelineClip(state, splitClip.id, splitOffsetSec))
    setSelectedClipId(splitClip.id)
  }, [splitClip, canSplit, splitOffsetSec, state, update])

  const handleDuplicate = useCallback(() => {
    if (!targetClip) return
    const next = duplicateTimelineClip(state, targetClip.id)
    update(next)
    // 选中新出来的那一段：从结果里找出多出来的 id，而不是在这里复刻一遍取名规则
    const created = next.clips.find((clip) => !clips.some((existing) => existing.id === clip.id))
    if (created) setSelectedClipId(created.id)
  }, [targetClip, clips, state, update])

  const handleRemove = useCallback(() => {
    if (!targetClip) return
    update(removeTimelineClip(state, targetClip.id))
    setSelectedClipId('')
  }, [targetClip, state, update])

  const handleToggleMute = useCallback(() => {
    if (!targetClip) return
    update(setTimelineClipMuted(state, targetClip.id, targetClip.muted !== true))
  }, [targetClip, state, update])

  const handleMove = useCallback(
    (toIndex: number) => {
      if (targetIndex < 0) return
      update(reorderTimelineClips(state, targetIndex, toIndex))
    },
    [targetIndex, state, update],
  )

  const handleTrim = useCallback(
    (clipId: string, edits: { inSec?: number; outSec?: number }) => update(trimTimelineClip(state, clipId, edits)),
    [state, update],
  )

  // ── 指针交互：定位 / 排序 / 裁剪 ──────────────────────────────

  const scrubbingRef = useRef(false)
  /**
   * 拖动状态的镜像。
   *
   * 松手时要「读一遍拖到哪、然后提交」，而提交是副作用——放进 setState 的更新函数里，
   * 严格模式下会被执行两次，等于提交两次。所以判定读 ref，setDrag 只负责重渲染。
   */
  const dragRef = useRef<DragState | null>(null)
  const applyDrag = useCallback((next: DragState | null) => {
    dragRef.current = next
    setDrag(next)
  }, [])

  const handleScrubDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return
      capturePointer(event.currentTarget, event.pointerId)
      scrubbingRef.current = true
      seekTo(timeFromClientX(event.clientX))
    },
    [seekTo, timeFromClientX],
  )

  const handleScrubMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (!scrubbingRef.current) return
      seekTo(timeFromClientX(event.clientX))
    },
    [seekTo, timeFromClientX],
  )

  const handleScrubUp = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (!scrubbingRef.current) return
    scrubbingRef.current = false
    releasePointer(event.currentTarget, event.pointerId)
  }, [])

  const handleClipDown = useCallback(
    (event: React.PointerEvent<HTMLElement>, clip: TimelineClip, index: number) => {
      if (event.button !== 0) return
      capturePointer(event.currentTarget, event.pointerId)
      setSelectedClipId(clip.id)
      applyDrag({
        mode: 'move',
        clipId: clip.id,
        index,
        startX: event.clientX,
        dxPx: 0,
        targetIndex: index,
        moved: false,
      })
    },
    [applyDrag],
  )

  const handleClipMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const current = dragRef.current
      if (!current || current.mode !== 'move') return
      const dxPx = event.clientX - current.startX
      if (!current.moved && Math.abs(dxPx) < MOVE_THRESHOLD_PX) return
      const centerSec = (offsets[current.index] || 0) + dxPx / pxPerSec + getClipDuration(clips[current.index]) / 2
      const dropIndex = resolveTimelineDropIndex(state, current.clipId, centerSec)
      applyDrag({ ...current, dxPx, moved: true, targetIndex: dropIndex < 0 ? current.index : dropIndex })
    },
    [applyDrag, clips, offsets, pxPerSec, state],
  )

  const handleClipUp = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      releasePointer(event.currentTarget, event.pointerId)
      const current = dragRef.current
      applyDrag(null)
      if (!current || current.mode !== 'move') return
      // 没拖动就是一次点击：选中之外还把播放头落到点的位置，「点哪看哪」
      if (!current.moved) seekTo(timeFromClientX(event.clientX))
      else if (current.targetIndex !== current.index) {
        update(reorderTimelineClips(state, current.index, current.targetIndex))
      }
    },
    [applyDrag, seekTo, timeFromClientX, state, update],
  )

  const handleTrimDown = useCallback(
    (event: React.PointerEvent<HTMLElement>, clip: TimelineClip, index: number, edge: 'in' | 'out') => {
      if (event.button !== 0) return
      event.stopPropagation()
      capturePointer(event.currentTarget, event.pointerId)
      setSelectedClipId(clip.id)
      applyDrag({
        mode: edge === 'in' ? 'trimIn' : 'trimOut',
        clipId: clip.id,
        index,
        startX: event.clientX,
        inSec: clip.inSec,
        outSec: clip.outSec,
        snappedSec: null,
      })
    },
    [applyDrag],
  )

  const handleTrimMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const current = dragRef.current
      if (!current || current.mode === 'move') return
      const clip = clips[current.index]
      if (!clip || clip.id !== current.clipId) return

      const offset = offsets[current.index] || 0
      const duration = getClipDuration(clip)
      const upper = clip.sourceDurationSec > 0 ? clip.sourceDurationSec : Infinity
      const deltaSec = (event.clientX - current.startX) / pxPerSec

      /**
       * 参考线只在「吸附真的把边缘拉过去了」时亮。
       *
       * 判断依据是吸附前后的差值，不能只看结果落没落在参考点上——
       * 没有参考点在半径内时 snapTimelineTime 原样返回，那时结果当然等于自己，
       * 按后者判断的话这条线会从头亮到尾，等于没有指示。
       * 比的是 roundSeconds 之后的原值：吸附函数内部统一舍入到毫秒，
       * 直接和未舍入的原值比，那点舍入误差本身就会被当成一次吸附。
       * 还要确认边界钳制没把吸附结果又推开，否则会指着一个没去成的位置。
       */
      const guide = (rawEdge: number, snapped: number, appliedEdge: number) =>
        Math.abs(snapped - roundSeconds(rawEdge)) > 1e-6 && Math.abs(appliedEdge - snapped) < 1e-6 ? snapped : null

      if (current.mode === 'trimIn') {
        // 吸附的是「入点边缘在成片时间轴上的位置」，不是源片里的时刻：
        // 用户对齐的是屏幕上看到的那条线，而源片时刻和它差着一个偏移。
        const rawEdge = offset + deltaSec
        const snapped = snapSec(rawEdge)
        const inSec = Math.min(Math.max(0, clip.inSec + (snapped - offset)), clip.outSec - MIN_CLIP_DURATION_SEC)
        applyDrag({ ...current, inSec, snappedSec: guide(rawEdge, snapped, offset + (inSec - clip.inSec)) })
        return
      }

      const rawEdge = offset + duration + deltaSec
      const snapped = snapSec(rawEdge)
      const outSec = Math.min(
        Math.max(clip.outSec + (snapped - offset - duration), clip.inSec + MIN_CLIP_DURATION_SEC),
        upper,
      )
      applyDrag({ ...current, outSec, snappedSec: guide(rawEdge, snapped, offset + (outSec - clip.inSec)) })
    },
    [applyDrag, clips, offsets, pxPerSec, snapSec],
  )

  const handleTrimUp = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      releasePointer(event.currentTarget, event.pointerId)
      const current = dragRef.current
      applyDrag(null)
      if (!current || current.mode === 'move') return
      const clip = clips[current.index]
      if (!clip || (current.inSec === clip.inSec && current.outSec === clip.outSec)) return

      update(trimTimelineClip(state, current.clipId, { inSec: current.inSec, outSec: current.outSec }))
      // 停在刚裁出来的那一帧上，松手就能看到裁到哪
      const offset = offsets[current.index] || 0
      const duration = current.outSec - current.inSec
      setPlayheadSec(current.mode === 'trimIn' ? offset : Math.max(offset, offset + duration - 0.04))
    },
    [applyDrag, clips, offsets, state, update],
  )

  /** 裁剪手柄的键盘通道：拖拽在键盘与读屏下不可达，方向键顶上。 */
  const handleTrimKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>, clip: TimelineClip, edge: 'in' | 'out') => {
      const direction = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
      if (!direction) return
      event.preventDefault()
      // 不让方向键继续冒到面板级快捷键上：同一次按键既裁剪又挪播放头，两件事会互相干扰
      event.stopPropagation()
      const step = (event.shiftKey ? NUDGE_STEP_LARGE_SEC : NUDGE_STEP_SEC) * direction
      handleTrim(clip.id, edge === 'in' ? { inSec: clip.inSec + step } : { outSec: clip.outSec + step })
    },
    [handleTrim],
  )

  // ── 快捷键 ────────────────────────────────────────────────────

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const tag = target?.tagName || ''
      // 正在输入框里打字时不抢键，否则删不掉字符、也退不出输入
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return

      const meta = event.ctrlKey || event.metaKey
      if (meta && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
        return
      }
      if (meta && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        redo()
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (!selectedClipId) return
        event.preventDefault()
        handleRemove()
        return
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        const step = (event.shiftKey ? NUDGE_STEP_LARGE_SEC : NUDGE_STEP_SEC) * (event.key === 'ArrowLeft' ? -1 : 1)
        setPlayheadSec((current) => Math.min(Math.max(0, current + step), draftTotalSec))
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, redo, undo, onClose, selectedClipId, handleRemove, draftTotalSec])

  // 点到别处收起添加菜单：它会盖住轨道，留着碍事
  useEffect(() => {
    if (!addOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if ((event.target as HTMLElement)?.closest?.(`.${styles.addWrap}`)) return
      setAddOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [addOpen])

  if (!open) return null

  const composeBlockedReason = composeDisabledReason || problems[0] || ''
  const canCompose = Boolean(onCompose) && !composeBlockedReason && !composing

  // 没得可加时按钮要说清是「上限满了」还是「画布上没有可用视频」，而不是干巴巴地灰着
  const addBlockedReason =
    clips.length >= MAX_TIMELINE_CLIPS
      ? `片段数已达上限（${MAX_TIMELINE_CLIPS} 个）`
      : addableSources.length === 0
        ? '画布上没有可加入的视频：先生成视频，或把已有视频节点连到本节点'
        : ''

  /** 裁剪拖动时预览要跟着走：看的是裁完之后那一帧，而不是裁之前的画面。 */
  const previewPlayheadSec =
    drag && drag.mode !== 'move'
      ? drag.mode === 'trimIn'
        ? offsets[drag.index] || 0
        : Math.max(offsets[drag.index] || 0, (offsets[drag.index] || 0) + (drag.outSec - drag.inSec) - 0.04)
      : playheadSec

  const targetLabel = targetIndex >= 0 ? `片段 ${targetIndex + 1}` : ''
  const noTargetReason = '先在轨道上选一个片段'

  return (
    <div className={styles.mask} role="dialog" aria-modal="true" aria-label="视频剪辑">
      <div className={styles.panel}>
        <header className={styles.header}>
          <div className={styles.title}>
            <strong>视频剪辑</strong>
            <span className={styles.total}>
              {draftClips.length} 段 · 共 {formatTimelineTime(draftTotalSec)}
            </span>
          </div>
          <div className={styles.headActions}>
            <button type="button" className={styles.headTool} onClick={undo} disabled={!history.length}>
              撤销
            </button>
            <button type="button" className={styles.headTool} onClick={redo} disabled={!future.length}>
              重做
            </button>
            {onAddClip && (
              <div className={styles.addWrap}>
                <button
                  type="button"
                  className={styles.addClip}
                  onClick={() => setAddOpen((current) => !current)}
                  disabled={addBlockedReason !== ''}
                  aria-expanded={addOpen}
                  title={addBlockedReason || '从画布上挑一个视频节点加入时间线'}
                >
                  ＋ 添加片段
                </button>
                {addOpen && (
                  <div className={styles.addMenu} role="menu" aria-label="画布上的视频">
                    {addableSources.map((source) => (
                      <button
                        key={source.nodeId}
                        type="button"
                        role="menuitem"
                        className={styles.addMenuItem}
                        onClick={() => {
                          onAddClip(source.nodeId)
                          setAddOpen(false)
                        }}
                      >
                        {source.thumbnailUrl ? (
                          // 静音 + 只取元数据：这里只要一帧封面，不该为选片下载整条视频
                          <video className={styles.addMenuThumb} src={source.thumbnailUrl} preload="metadata" muted />
                        ) : (
                          <span className={styles.addMenuThumb} />
                        )}
                        <span className={styles.addMenuLabel}>{source.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <button type="button" className={styles.close} onClick={onClose} aria-label="关闭">
              ×
            </button>
          </div>
        </header>

        {/* 连线已建立但来源视频还没生成完，这类连线暂时产生不了片段——必须说出来，
            否则用户连上线什么都没发生，只会以为功能坏了 */}
        {pendingSourceCount > 0 && (
          <div className={styles.pending} role="status">
            有 {pendingSourceCount} 个连入的视频还没有生成完成，生成后会自动加入；也可以点「添加片段」直接从素材库选。
          </div>
        )}

        <div className={styles.body}>
          <div className={styles.stage}>
            {/* 预览与节点内嵌用的是同一个播放器：两段素材串成一条连续的片子。
                它自带的轨道在这里藏起来——下面那条才是可编辑的时间轴 */}
            <CanvasTimelinePlayer
              className={styles.player}
              clips={draftClips}
              workspaceId={workspaceId}
              hideTimeline
              playheadSec={previewPlayheadSec}
              onPlayheadChange={(next) => {
                // 裁剪拖动期间播放器收到的是预演位置，别让它把播放头写回来
                if (drag && drag.mode !== 'move') return
                // 用户正在拖播放头时同样不接受回写：此刻权威位置在用户手上，
                // 播放器报的是尚未追上的 video.currentTime，接了就会把白线拽回原处。
                if (scrubbingRef.current) return
                setPlayheadSec(next)
              }}
            />
          </div>

          {/* 右侧属性面板：选中片段的读数与逐项操作 */}
          <aside className={styles.inspector} aria-label="片段属性">
            {selectedClip ? (
              <>
                <div className={styles.inspectorHead}>
                  <strong>片段 {selectedIndex + 1}</strong>
                  <span className={styles.dim}>{getClipDuration(selectedClip).toFixed(2)}s</span>
                </div>

                <div className={styles.field}>
                  <label htmlFor="timeline-clip-in">起点</label>
                  <input
                    id="timeline-clip-in"
                    type="number"
                    step={0.01}
                    min={0}
                    max={Math.max(0, selectedClip.outSec - MIN_CLIP_DURATION_SEC)}
                    value={selectedClip.inSec}
                    onChange={(event) => handleTrim(selectedClip.id, { inSec: Number(event.target.value) })}
                  />
                </div>
                <div className={styles.field}>
                  <label htmlFor="timeline-clip-out">终点</label>
                  <input
                    id="timeline-clip-out"
                    type="number"
                    step={0.01}
                    min={selectedClip.inSec + MIN_CLIP_DURATION_SEC}
                    {...(selectedClip.sourceDurationSec > 0 ? { max: selectedClip.sourceDurationSec } : {})}
                    value={selectedClip.outSec}
                    onChange={(event) => handleTrim(selectedClip.id, { outSec: Number(event.target.value) })}
                  />
                </div>

                <div className={styles.meta}>
                  <span>源片时长</span>
                  <b>{selectedClip.sourceDurationSec > 0 ? `${selectedClip.sourceDurationSec.toFixed(2)}s` : '未知'}</b>
                </div>
                <div className={styles.meta}>
                  <span>时间轴位置</span>
                  <b>{formatTimelineTime(offsets[selectedIndex] || 0)}</b>
                </div>

                <div className={styles.inspectorRow}>
                  <button
                    type="button"
                    onClick={() =>
                      handleTrim(selectedClip.id, {
                        inSec: located?.clip.id === selectedClip.id ? located.sourceTimeSec : selectedClip.inSec,
                      })
                    }
                    disabled={located?.clip.id !== selectedClip.id}
                    title="把播放头所在的这一帧设为本段的起点"
                  >
                    播放头设为起点
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      handleTrim(selectedClip.id, {
                        outSec: located?.clip.id === selectedClip.id ? located.sourceTimeSec : selectedClip.outSec,
                      })
                    }
                    disabled={located?.clip.id !== selectedClip.id}
                    title="把播放头所在的这一帧设为本段的终点"
                  >
                    播放头设为终点
                  </button>
                </div>

                {/* 拖拽排序在键盘与读屏下不可达，前移/后移是它唯一的替代通道 */}
                <div className={styles.inspectorRow}>
                  <button
                    type="button"
                    onClick={() => update(reorderTimelineClips(state, selectedIndex, selectedIndex - 1))}
                    disabled={selectedIndex <= 0}
                    aria-label={`片段 ${selectedIndex + 1} 前移`}
                  >
                    ‹ 前移
                  </button>
                  <button
                    type="button"
                    onClick={() => update(reorderTimelineClips(state, selectedIndex, selectedIndex + 1))}
                    disabled={selectedIndex < 0 || selectedIndex >= draftClips.length - 1}
                    aria-label={`片段 ${selectedIndex + 1} 后移`}
                  >
                    后移 ›
                  </button>
                </div>

                <div className={styles.keyframes}>
                  <div className={styles.keyframesHead}>
                    <span>关键帧</span>
                    <button
                      type="button"
                      onClick={() => {
                        if (located?.clip.id !== selectedClip.id) return
                        update(addTimelineKeyframe(state, selectedClip.id, located.sourceTimeSec))
                      }}
                      disabled={located?.clip.id !== selectedClip.id}
                    >
                      ＋ 打点
                    </button>
                  </div>
                  {(selectedClip.keyframes || []).length ? (
                    <div className={styles.keyframeList}>
                      {(selectedClip.keyframes || []).map((frame) => (
                        <span key={frame.timeSec} className={styles.keyframeChip}>
                          <button
                            type="button"
                            onClick={() =>
                              seekTo((offsets[selectedIndex] || 0) + frame.timeSec - selectedClip.inSec, false)
                            }
                            aria-label={`跳到关键帧 ${formatTimelineTime(frame.timeSec)}`}
                          >
                            {formatTimelineTime(frame.timeSec)}
                          </button>
                          <button
                            type="button"
                            onClick={() => update(removeTimelineKeyframe(state, selectedClip.id, frame.timeSec))}
                            aria-label={`删除关键帧 ${formatTimelineTime(frame.timeSec)}`}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className={styles.dim}>还没有打点</span>
                  )}
                </div>

                {onAddClipToCanvas && (
                  <button
                    type="button"
                    className={styles.inspectorWide}
                    // 这个动作会把片段从时间线移走，文案必须说清楚，否则用户以为只是复制一份
                    title="把这一段导出成素材放到画布上，并从时间线移除"
                    onClick={() => onAddClipToCanvas(selectedClip)}
                  >
                    剪出这一段到画布
                  </button>
                )}
              </>
            ) : (
              <div className={styles.inspectorEmpty}>
                在下方轨道上点一个片段，这里显示它的裁剪区间与属性。
                <br />
                拖动片段中段可排序，拖动左右边缘可裁剪。
              </div>
            )}
          </aside>
        </div>

        {/* 工具条：作用于选中的片段（没选中时落在播放头所在那段） */}
        <div className={styles.toolbar}>
          <div className={styles.toolGroup}>
            <button
              type="button"
              onClick={handleSplit}
              disabled={!canSplit}
              title={
                canSplit ? `在播放头处把片段 ${(located?.index ?? 0) + 1} 分成两段` : '把播放头移到片段中间才能分割'
              }
            >
              ✂ 分割
            </button>
            <button
              type="button"
              onClick={handleRemove}
              disabled={!targetClip}
              title={targetClip ? `删除${targetLabel}` : noTargetReason}
            >
              🗑 删除
            </button>
            <button
              type="button"
              onClick={handleToggleMute}
              disabled={!targetClip}
              aria-pressed={targetClip?.muted === true}
              title={targetClip ? `${targetClip.muted ? '取消静音' : '静音'}${targetLabel}` : noTargetReason}
            >
              {targetClip?.muted ? '🔇 取消静音' : '🔊 静音'}
            </button>
            <button
              type="button"
              onClick={handleDuplicate}
              disabled={!targetClip}
              title={targetClip ? `复制${targetLabel}` : noTargetReason}
            >
              ⧉ 复制
            </button>
          </div>

          <div className={styles.toolSpacer}>
            {targetLabel && <span className={styles.dim}>当前：{targetLabel}</span>}
          </div>

          <div className={styles.toolGroup}>
            <button
              type="button"
              onClick={() => handleMove(targetIndex - 1)}
              disabled={targetIndex <= 0}
              aria-label="选中片段左移"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => handleMove(targetIndex + 1)}
              disabled={targetIndex < 0 || targetIndex >= draftClips.length - 1}
              aria-label="选中片段右移"
            >
              ›
            </button>
          </div>

          <div className={styles.toolGroup}>
            <button
              type="button"
              onClick={() => setZoomPxPerSec(Math.max(MIN_PX_PER_SEC, pxPerSec / 1.5))}
              aria-label="缩小时间轴"
            >
              −
            </button>
            <span className={styles.zoomValue}>{Math.round(pxPerSec)} px/s</span>
            <button
              type="button"
              onClick={() => setZoomPxPerSec(Math.min(MAX_PX_PER_SEC, pxPerSec * 1.5))}
              aria-label="放大时间轴"
            >
              +
            </button>
            <button type="button" onClick={() => setZoomPxPerSec(0)} aria-label="时间轴适应宽度">
              适应
            </button>
          </div>
        </div>

        {/* 时间轴：刻度尺 + 一条主视频轨道，播放头贯穿两者 */}
        <div className={styles.timelineScroll} ref={scrollRef}>
          <div className={styles.timelineContent} ref={contentRef} style={{ width: `${contentWidth}px` }}>
            <div
              className={styles.ruler}
              onPointerDown={handleScrubDown}
              onPointerMove={handleScrubMove}
              onPointerUp={handleScrubUp}
              onPointerCancel={handleScrubUp}
              aria-hidden="true"
            >
              {ticks.map((tick) => (
                <i
                  key={tick.sec}
                  className={tick.major ? styles.tickMajor : styles.tick}
                  style={{ left: `${tick.sec * pxPerSec}px` }}
                />
              ))}
              {ticks
                .filter((tick) => tick.major)
                .map((tick) => (
                  <span
                    key={`label-${tick.sec}`}
                    className={styles.rulerLabel}
                    style={{ left: `${tick.sec * pxPerSec}px` }}
                  >
                    {formatTimelineTime(tick.sec)}
                  </span>
                ))}
            </div>

            <ol
              className={styles.track}
              aria-label="片段列表"
              // 轨道空白处按下也是定位：一条主轨道上，末尾那块空白是最顺手的「跳到结尾」
              onPointerDown={(event) => {
                if (event.target !== event.currentTarget) return
                handleScrubDown(event)
              }}
              onPointerMove={handleScrubMove}
              onPointerUp={handleScrubUp}
              onPointerCancel={handleScrubUp}
            >
              {layout.map(({ clip, index, leftPx, widthPx, dragging }) => {
                const duration = getClipDuration(clip)
                const frames = filmstrips[clip.assetId] || []
                const source = clip.sourceDurationSec
                // 胶片条按源片时间铺开再按裁剪区间平移：裁过的片段露出的正好是它真正用到的那几帧
                const stripWidth = source > 0 && duration > 0 ? (source / duration) * 100 : 100
                const stripLeft = source > 0 && duration > 0 ? -(clip.inSec / duration) * 100 : 0
                return (
                  <li
                    key={clip.id}
                    className={`${styles.clip}${located?.index === index ? ` ${styles.clipActive}` : ''}${
                      selectedClipId === clip.id ? ` ${styles.clipSelected}` : ''
                    }${dragging ? ` ${styles.clipDragging}` : ''}`}
                    style={{ left: `${leftPx}px`, width: `${Math.max(widthPx, 2)}px` }}
                  >
                    {frames.length > 0 && (
                      <span className={styles.film} aria-hidden="true">
                        <span className={styles.filmInner} style={{ width: `${stripWidth}%`, left: `${stripLeft}%` }}>
                          {frames.map((frame, frameIndex) => (
                            <img key={frameIndex} src={frame} alt="" draggable={false} />
                          ))}
                        </span>
                      </span>
                    )}

                    {(clip.keyframes || []).map((frame) => (
                      <i
                        key={frame.timeSec}
                        className={styles.keyframeMark}
                        style={{ left: `${((frame.timeSec - clip.inSec) / Math.max(duration, 0.001)) * 100}%` }}
                        aria-hidden="true"
                      />
                    ))}

                    <button
                      type="button"
                      className={styles.clipBody}
                      aria-label={`片段 ${index + 1}`}
                      aria-pressed={selectedClipId === clip.id}
                      title={`片段 ${index + 1} · ${duration.toFixed(1)}s（拖动排序，拖左右边缘裁剪）`}
                      onPointerDown={(event) => handleClipDown(event, clip, index)}
                      onPointerMove={handleClipMove}
                      onPointerUp={handleClipUp}
                      onPointerCancel={() => applyDrag(null)}
                    >
                      <span className={styles.clipLabel}>
                        <b>{index + 1}</b>
                        <span>{duration.toFixed(1)}s</span>
                        {clip.muted && <span aria-label="已静音">🔇</span>}
                      </span>
                    </button>

                    <button
                      type="button"
                      className={`${styles.handle} ${styles.handleIn}`}
                      aria-label={`片段 ${index + 1} 起点手柄`}
                      title="拖动裁剪起点（方向键微调）"
                      onPointerDown={(event) => handleTrimDown(event, clip, index, 'in')}
                      onPointerMove={handleTrimMove}
                      onPointerUp={handleTrimUp}
                      onPointerCancel={() => applyDrag(null)}
                      onKeyDown={(event) => handleTrimKeyDown(event, clips[index], 'in')}
                    >
                      <i />
                    </button>
                    <button
                      type="button"
                      className={`${styles.handle} ${styles.handleOut}`}
                      aria-label={`片段 ${index + 1} 终点手柄`}
                      title="拖动裁剪终点（方向键微调）"
                      onPointerDown={(event) => handleTrimDown(event, clip, index, 'out')}
                      onPointerMove={handleTrimMove}
                      onPointerUp={handleTrimUp}
                      onPointerCancel={() => applyDrag(null)}
                      onKeyDown={(event) => handleTrimKeyDown(event, clips[index], 'out')}
                    >
                      <i />
                    </button>
                  </li>
                )
              })}
              {!clips.length && (
                <li className={styles.trackEmpty}>时间线还是空的，先用右上角「添加片段」加入画布上的视频</li>
              )}
            </ol>

            {/* 吸附命中时亮一条参考线，让「贴上去了」这件事看得见 */}
            {drag && drag.mode !== 'move' && drag.snappedSec !== null && (
              <span
                className={styles.snapLine}
                style={{ left: `${drag.snappedSec * pxPerSec}px` }}
                aria-hidden="true"
              />
            )}
            {/*
              播放头本身要能拖：线只有 2px 且 pointer-events:none，此前唯一能定位的是上方
              22px 高的刻度尺——看起来最该能抓的东西反而抓不住，暂停时想看某一帧只能靠播过去。
              这里叠一条透明的加宽热区，指针事件走和刻度尺同一套 scrub 逻辑。
            */}
            <span className={styles.playhead} style={{ left: `${playheadSec * pxPerSec}px` }}>
              <i />
              <span
                className={styles.playheadGrip}
                role="slider"
                tabIndex={0}
                aria-label="播放头"
                aria-valuemin={0}
                aria-valuemax={draftTotalSec}
                aria-valuenow={playheadSec}
                aria-valuetext={formatTimelineTime(playheadSec)}
                onPointerDown={handleScrubDown}
                onPointerMove={handleScrubMove}
                onPointerUp={handleScrubUp}
                onPointerCancel={handleScrubUp}
                onKeyDown={(event) => {
                  const step = event.shiftKey ? NUDGE_STEP_LARGE_SEC : NUDGE_STEP_SEC
                  if (event.key === 'ArrowLeft') {
                    event.preventDefault()
                    seekTo(playheadSec - step)
                  } else if (event.key === 'ArrowRight') {
                    event.preventDefault()
                    seekTo(playheadSec + step)
                  }
                }}
              />
            </span>
          </div>
        </div>

        <footer className={styles.footer}>
          <div className={styles.notes}>
            <div className={styles.time}>
              <b>{formatTimelineTime(playheadSec)}</b> / {formatTimelineTime(draftTotalSec)}
            </div>
            {compatibilityNote && <div className={styles.note}>{compatibilityNote}</div>}
            {problems.length > 0 && <div className={styles.problem}>{problems[0]}</div>}
          </div>
          <button
            type="button"
            className={styles.compose}
            disabled={!canCompose}
            title={composeBlockedReason || undefined}
            onClick={() => onCompose?.()}
          >
            {composing ? composeProgress || '合成中…' : '合成为一条视频'}
          </button>
        </footer>
      </div>
    </div>
  )
}
