import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ForwardedRef,
  type PointerEvent,
} from 'react'
import type { CanvasSubjectCandidate } from '@/api/canvasSubjectRecognition'
import {
  createConnectedColorMask,
  readSelectionBounds,
  type CanvasSubjectSelectionBounds,
} from './canvasSubjectSelection'
import styles from './CanvasSubjectMaskEditor.module.css'

export type { CanvasSubjectSelectionBounds } from './canvasSubjectSelection'

type Size = { width: number; height: number }
type Point = { x: number; y: number }
type Stroke = { kind: 'stroke'; erase: boolean; diameter: number; points: Point[] }
type Rectangle = { kind: 'rectangle'; start: Point; end: Point }
type Region = { kind: 'region'; mask: HTMLCanvasElement; replace?: boolean }
type Edit = Stroke | Rectangle | Region | null
type Tool = 'brush' | 'eraser' | 'rectangle' | 'color' | 'subject'

export interface CanvasSubjectMaskEditorHandle {
  exportMask(): Promise<File>
  exportCutout(maxLongEdge?: number): Promise<File>
}

interface Props {
  src: string
  disabled?: boolean
  mediaLabel?: string
  onSelectionChange: (hasMask: boolean, bounds?: CanvasSubjectSelectionBounds) => void
  onAnalysisChange?: (pending: boolean) => void
  onRecognizeCandidates?: (point: Point, signal: AbortSignal) => Promise<CanvasSubjectCandidate[]>
  onSelectSubjectName?: (name: string) => void
}

function canvasPoint(event: PointerEvent<HTMLCanvasElement>, bounds: DOMRect): Point {
  return { x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height }
}

function clampUnit(value: number) {
  return Math.min(1, Math.max(0, value))
}

function rectangleBounds(rectangle: Rectangle): CanvasSubjectSelectionBounds {
  const left = clampUnit(Math.min(rectangle.start.x, rectangle.end.x))
  const top = clampUnit(Math.min(rectangle.start.y, rectangle.end.y))
  const right = clampUnit(Math.max(rectangle.start.x, rectangle.end.x))
  const bottom = clampUnit(Math.max(rectangle.start.y, rectangle.end.y))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function paintSegment(context: CanvasRenderingContext2D, stroke: Stroke, point: Point, previous?: Point) {
  const { width, height } = context.canvas
  const diameter = stroke.diameter * width
  context.globalCompositeOperation = stroke.erase ? 'destination-out' : 'source-over'
  context.fillStyle = '#00e5be'
  context.strokeStyle = context.fillStyle
  context.beginPath()
  if (previous && (previous.x !== point.x || previous.y !== point.y)) {
    context.lineWidth = diameter
    context.lineCap = 'round'
    context.moveTo(previous.x * width, previous.y * height)
    context.lineTo(point.x * width, point.y * height)
    context.stroke()
  } else {
    context.arc(point.x * width, point.y * height, diameter / 2, 0, Math.PI * 2)
    context.fill()
  }
}

function renderSelection(context: CanvasRenderingContext2D, edits: readonly Edit[]) {
  const { width, height } = context.canvas
  context.clearRect(0, 0, width, height)
  for (const edit of edits.slice(edits.lastIndexOf(null) + 1)) {
    switch (edit?.kind) {
      case 'stroke':
        edit.points.forEach((point, index) => paintSegment(context, edit, point, edit.points[index - 1]))
        break
      case 'rectangle': {
        const box = rectangleBounds(edit)
        context.globalCompositeOperation = 'source-over'
        context.fillStyle = '#00e5be'
        context.fillRect(box.x * width, box.y * height, box.width * width, box.height * height)
        break
      }
      case 'region':
        context.globalCompositeOperation = 'source-over'
        if (edit.replace) context.clearRect(0, 0, width, height)
        context.drawImage(edit.mask, 0, 0, width, height)
        break
    }
  }
}

function renderCutout(context: CanvasRenderingContext2D, image: HTMLImageElement, edits: readonly Edit[]) {
  const { width, height } = context.canvas
  renderSelection(context, edits)
  context.globalCompositeOperation = 'source-in'
  context.drawImage(image, 0, 0, width, height)
  context.globalCompositeOperation = 'source-over'
}

async function encodePng(canvas: HTMLCanvasElement, name: string) {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('无法导出 PNG，请重试')
  return new File([blob], name, { type: 'image/png' })
}

function MaskEditor({
  src,
  disabled = false,
  mediaLabel = '原图',
  onSelectionChange,
  onAnalysisChange,
  onRecognizeCandidates,
  onSelectSubjectName,
  editorRef,
}: Props & {
  editorRef: ForwardedRef<CanvasSubjectMaskEditorHandle>
}) {
  const [size, setSize] = useState<Size | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [pixelError, setPixelError] = useState('')
  const [diameter, setDiameter] = useState(32)
  const [tool, setTool] = useState<Tool>(mediaLabel === '原图' ? 'brush' : 'subject')
  const [analysis, setAnalysis] = useState<'segmentation' | 'candidates' | null>(null)
  const [subjectPoint, setSubjectPoint] = useState<Point | null>(null)
  const [candidates, setCandidates] = useState<CanvasSubjectCandidate[]>([])
  const [draftBox, setDraftBox] = useState<CanvasSubjectSelectionBounds | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [hasSelection, setHasSelection] = useState(false)
  const [hasHistory, setHasHistory] = useState(false)
  const imageRef = useRef<HTMLImageElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const previewRef = useRef<HTMLCanvasElement>(null)
  const sourcePixels = useRef<ImageData | null>(null)
  const edits = useRef<Edit[]>([])
  const analysisRequest = useRef<AbortController | null>(null)
  const active = useRef<{ pointerId: number; bounds: DOMRect; edit: Stroke | Rectangle } | null>(null)
  const selectionCallback = useRef(onSelectionChange)
  selectionCallback.current = onSelectionChange
  const analysisCallback = useRef(onAnalysisChange)
  analysisCallback.current = onAnalysisChange

  useEffect(() => {
    selectionCallback.current(false)
    return () => {
      if (!analysisRequest.current) return
      analysisRequest.current.abort()
      analysisRequest.current = null
      analysisCallback.current?.(false)
    }
  }, [])

  useImperativeHandle(editorRef, () => {
    function exportContext(maxLongEdge = Infinity) {
      if (!size || !hasSelection) throw new Error('请先选择要编辑的区域')
      if (active.current || analysisRequest.current) throw new Error('请结束当前选区操作后重试')
      const canvas = document.createElement('canvas')
      const scale = maxLongEdge > 0 ? Math.min(1, maxLongEdge / Math.max(size.width, size.height)) : 1
      canvas.width = Math.max(1, Math.round(size.width * scale))
      canvas.height = Math.max(1, Math.round(size.height * scale))
      const context = canvas.getContext('2d')
      if (!context) throw new Error('无法创建输出图片，请重试')
      return context
    }

    return {
      async exportMask() {
        const context = exportContext()
        renderSelection(context, edits.current)
        // 图生图接口使用透明像素标记编辑区。
        context.globalCompositeOperation = 'source-out'
        context.fillStyle = '#fff'
        context.fillRect(0, 0, context.canvas.width, context.canvas.height)
        const file = await encodePng(context.canvas, 'subject-mask.png')
        if (file.size >= 4 * 1024 * 1024) throw new Error('编辑蒙版超过 4 MB，请缩小图片后重试')
        return file
      },
      async exportCutout(maxLongEdge) {
        const context = exportContext(maxLongEdge)
        const image = imageRef.current
        if (!image) throw new Error(`无法读取${mediaLabel}，请重新打开编辑器`)
        renderCutout(context, image, edits.current)
        try {
          return await encodePng(context.canvas, 'subject-cutout.png')
        } catch {
          throw new Error('无法导出抠图，请确认素材可读取后重试')
        }
      },
    }
  }, [size, hasSelection, mediaLabel])

  function refreshSelection(context: CanvasRenderingContext2D) {
    const { width, height } = context.canvas
    const bounds = readSelectionBounds(context.getImageData(0, 0, width, height))
    const hasMask = Boolean(bounds)
    setHasSelection(hasMask)
    setHasHistory(edits.current.length > 0)
    selectionCallback.current(hasMask, bounds)
  }

  function selectColor(context: CanvasRenderingContext2D, point: Point) {
    const image = imageRef.current
    if (!image || !size) return
    const scale = Math.min(1, 512 / Math.max(size.width, size.height))
    const mask = document.createElement('canvas')
    mask.width = Math.max(1, Math.round(size.width * scale))
    mask.height = Math.max(1, Math.round(size.height * scale))
    const maskContext = mask.getContext('2d', { willReadFrequently: true })
    if (!maskContext) return
    try {
      if (!sourcePixels.current) {
        maskContext.drawImage(image, 0, 0, mask.width, mask.height)
        sourcePixels.current = maskContext.getImageData(0, 0, mask.width, mask.height)
      }
    } catch {
      setPixelError(`无法读取${mediaLabel}的颜色，请改用画笔或框选`)
      return
    }
    const output = maskContext.createImageData(mask.width, mask.height)
    const x = Math.min(mask.width - 1, Math.floor(clampUnit(point.x) * mask.width))
    const y = Math.min(mask.height - 1, Math.floor(clampUnit(point.y) * mask.height))
    if (!createConnectedColorMask(sourcePixels.current, output, x, y)) {
      setPixelError('请点击有图像内容的区域')
      return
    }
    maskContext.putImageData(output, 0, 0)
    edits.current.push({ kind: 'region', mask })
    context.globalCompositeOperation = 'source-over'
    context.drawImage(mask, 0, 0, context.canvas.width, context.canvas.height)
    refreshSelection(context)
  }

  async function analyzeSubject(point: Point, type: 'segmentation' | 'candidates', candidate?: CanvasSubjectCandidate) {
    const image = imageRef.current
    const context = canvasRef.current?.getContext('2d', { willReadFrequently: true })
    if (!image || !context || disabled || analysisRequest.current) return
    const controller = new AbortController()
    analysisRequest.current = controller
    setAnalysis(type)
    analysisCallback.current?.(true)
    setPixelError('')
    try {
      if (type === 'candidates') {
        const options = await onRecognizeCandidates?.(point, controller.signal)
        if (controller.signal.aborted) return
        setCandidates(options || [])
        if (!options?.length) setPixelError('没有识别到候选主体，可改点主体中心或用画笔修正')
        return
      }
      const { segmentCanvasSubject } = await import('./canvasSubjectSegmentation')
      if (controller.signal.aborted) return
      const pixels = await segmentCanvasSubject(image, point, candidate?.bounds, controller.signal)
      if (controller.signal.aborted) return
      const mask = document.createElement('canvas')
      mask.width = pixels.width
      mask.height = pixels.height
      const maskContext = mask.getContext('2d')
      if (!maskContext) throw new Error('无法显示自动抠图，可改用画笔或框选')
      maskContext.putImageData(pixels, 0, 0)
      edits.current.push({ kind: 'region', mask, replace: true })
      renderSelection(context, edits.current)
      refreshSelection(context)
      onSelectSubjectName?.(candidate?.label || '')
    } catch (error) {
      if (controller.signal.aborted) return
      setPixelError(error instanceof Error ? error.message : '识别失败，请重试或改用画笔')
    } finally {
      if (analysisRequest.current === controller) {
        analysisRequest.current = null
        setAnalysis(null)
        analysisCallback.current?.(false)
      }
    }
  }

  function beginEdit(event: PointerEvent<HTMLCanvasElement>) {
    if (disabled || previewing || event.button !== 0 || active.current || analysisRequest.current) return
    const canvas = event.currentTarget
    const context = canvas.getContext('2d', { willReadFrequently: true })
    const bounds = canvas.getBoundingClientRect()
    if (!context || !bounds.width || !bounds.height) return
    const point = canvasPoint(event, bounds)
    setPixelError('')
    setCandidates([])
    if (tool === 'subject') {
      setSubjectPoint(point)
      void analyzeSubject(point, 'segmentation')
      return
    }
    setSubjectPoint(null)
    if (tool === 'color') {
      selectColor(context, point)
      return
    }
    const edit: Stroke | Rectangle =
      tool === 'rectangle'
        ? { kind: 'rectangle', start: point, end: point }
        : { kind: 'stroke', erase: tool === 'eraser', diameter: diameter / bounds.width, points: [point] }
    canvas.setPointerCapture(event.pointerId)
    active.current = { pointerId: event.pointerId, bounds, edit }
    if (edit.kind === 'stroke') paintSegment(context, edit, point)
  }

  function extendEdit(event: PointerEvent<HTMLCanvasElement>) {
    const current = active.current
    if (!current || current.pointerId !== event.pointerId || disabled) return
    const { edit, bounds } = current
    const point = canvasPoint(event, bounds)
    if (edit.kind === 'rectangle') {
      edit.end = point
      setDraftBox(rectangleBounds(edit))
      return
    }
    const context = event.currentTarget.getContext('2d')
    if (!context) return
    const previous = edit.points[edit.points.length - 1]
    if (previous?.x === point.x && previous.y === point.y) return
    paintSegment(context, edit, point, previous)
    edit.points.push(point)
  }

  function finishEdit(event: PointerEvent<HTMLCanvasElement>, canceled = false) {
    const current = active.current
    if (!current || current.pointerId !== event.pointerId) return
    active.current = null
    setDraftBox(null)
    const context = event.currentTarget.getContext('2d')
    if (!context) return
    if (canceled || disabled) {
      if (current.edit.kind === 'stroke') renderSelection(context, edits.current)
      return
    }
    if (current.edit.kind === 'rectangle') {
      current.edit.end = canvasPoint(event, current.bounds)
      const box = rectangleBounds(current.edit)
      if (box.width * context.canvas.width < 1 || box.height * context.canvas.height < 1) return
      edits.current.push(current.edit)
      renderSelection(context, edits.current)
    } else {
      edits.current.push(current.edit)
    }
    refreshSelection(context)
  }

  function changeSelection(clear: boolean) {
    const context = canvasRef.current?.getContext('2d')
    if (!context || active.current) return
    if (clear) edits.current.push(null)
    else edits.current.pop()
    renderSelection(context, edits.current)
    refreshSelection(context)
    setPixelError('')
    setSubjectPoint(null)
    setCandidates([])
  }

  function togglePreview() {
    setPixelError('')
    if (previewing) {
      setPreviewing(false)
      return
    }
    const image = imageRef.current
    const context = previewRef.current?.getContext('2d', { willReadFrequently: true })
    if (!image || !context || active.current) return
    try {
      renderCutout(context, image, edits.current)
      // Only show the preview when this frame can also be exported.
      context.getImageData(0, 0, 1, 1)
      setPreviewing(true)
    } catch {
      setPixelError(`无法预览${mediaLabel}抠图，请确认素材可读取后重试`)
    }
  }

  const ratio = size ? size.width / size.height : 1
  const previewScale = size ? Math.min(1, 960 / Math.max(size.width, size.height)) : 1
  const previewWidth = size ? Math.max(1, Math.round(size.width * previewScale)) : 0
  const previewHeight = size ? Math.max(1, Math.round(size.height * previewScale)) : 0
  const editingDisabled = disabled || !size || previewing || Boolean(analysis)

  return (
    <section className={styles.editor} aria-label="编辑选区" aria-busy={(!size && !loadError) || Boolean(analysis)}>
      <div className={styles.toolbar} role="group" aria-label="涂抹工具">
        {(
          [
            ['subject', '智能点选'],
            ['brush', '画笔'],
            ['eraser', '橡皮'],
            ['rectangle', '框选'],
            ['color', '按颜色点选'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={tool === id}
            disabled={editingDisabled}
            onClick={() => {
              setTool(id)
              setPixelError('')
            }}
          >
            {label}
          </button>
        ))}
        <label className={styles.brushSize}>
          大小
          <input
            type="range"
            aria-label="画笔大小"
            min={4}
            max={100}
            value={diameter}
            disabled={editingDisabled || (tool !== 'brush' && tool !== 'eraser')}
            onChange={(event) => setDiameter(event.target.valueAsNumber)}
          />
          <span>{diameter} px</span>
        </label>
        <button type="button" disabled={editingDisabled || !hasHistory} onClick={() => changeSelection(false)}>
          撤销
        </button>
        <button type="button" disabled={editingDisabled || !hasSelection} onClick={() => changeSelection(true)}>
          清空
        </button>
        <button
          type="button"
          aria-pressed={previewing}
          disabled={disabled || !hasSelection || Boolean(analysis)}
          onClick={togglePreview}
        >
          {previewing ? '返回选区' : '预览抠图'}
        </button>
      </div>
      {analysis && (
        <p role="status" className={styles.hint}>
          {analysis === 'segmentation' ? '正在自动抠图…' : '正在识别候选主体…'}
        </p>
      )}
      {loadError ? <p role="alert">{mediaLabel}加载失败，请重新打开编辑器</p> : null}
      {pixelError && (
        <p role="alert" className={styles.error}>
          {pixelError}
        </p>
      )}
      {!size && !loadError ? <p role="status">正在读取{mediaLabel}…</p> : null}
      <div
        className={styles.surface}
        style={size ? { aspectRatio: ratio, width: `min(100%, ${ratio * 48}vh, ${ratio * 460}px)` } : undefined}
        hidden={!size}
      >
        <img
          ref={imageRef}
          src={src}
          alt={mediaLabel}
          draggable={false}
          onLoad={({ currentTarget }) => {
            const { naturalWidth: width, naturalHeight: height } = currentTarget
            if (width && height) setSize({ width, height })
            else setLoadError(true)
          }}
          onError={() => setLoadError(true)}
        />
        {size && (
          <>
            <canvas
              ref={canvasRef}
              className={styles.selection}
              width={previewWidth}
              height={previewHeight}
              aria-label={mediaLabel === '原图' ? '图片涂抹区域' : `${mediaLabel}涂抹区域`}
              aria-disabled={editingDisabled}
              hidden={previewing}
              onPointerDown={beginEdit}
              onPointerMove={extendEdit}
              onPointerUp={finishEdit}
              onPointerCancel={(event) => finishEdit(event, true)}
              onLostPointerCapture={(event) => finishEdit(event, true)}
            />
            {draftBox && (
              <div
                className={styles.rectangle}
                aria-hidden="true"
                style={{
                  left: `${draftBox.x * 100}%`,
                  top: `${draftBox.y * 100}%`,
                  width: `${draftBox.width * 100}%`,
                  height: `${draftBox.height * 100}%`,
                }}
              />
            )}
            <canvas
              ref={previewRef}
              className={styles.preview}
              width={previewWidth}
              height={previewHeight}
              aria-label="抠图预览"
              hidden={!previewing}
            />
          </>
        )}
      </div>
      {tool === 'subject' && subjectPoint && !previewing && onRecognizeCandidates && (
        <div className={styles.toolbar} role="group" aria-label="主体候选">
          {candidates.length ? (
            candidates.map((candidate, index) => (
              <button
                key={`${candidate.label}-${index}`}
                type="button"
                disabled={editingDisabled}
                onClick={() => void analyzeSubject(subjectPoint, 'segmentation', candidate)}
              >
                {candidate.label}
              </button>
            ))
          ) : (
            <button
              type="button"
              disabled={editingDisabled}
              onClick={() => void analyzeSubject(subjectPoint, 'candidates')}
            >
              识别主体候选（可能消耗积分）
            </button>
          )}
        </div>
      )}
      {size && !previewing && (
        <p className={styles.hint}>
          {tool === 'subject' && '点击要处理的主体，自动抠图后可用画笔和橡皮修正。'}
          {tool === 'color' && '点击后选中相连的近似颜色，可用画笔和橡皮修整。'}
          {tool !== 'subject' && tool !== 'color' && '绿色覆盖表示已选中，可用画笔、框选或橡皮调整。'}
        </p>
      )}
    </section>
  )
}

export default forwardRef<CanvasSubjectMaskEditorHandle, Props>(function CanvasSubjectMaskEditor(props, ref) {
  return <MaskEditor key={props.src} {...props} editorRef={ref} />
})
