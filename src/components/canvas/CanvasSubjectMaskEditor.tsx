import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ForwardedRef,
  type PointerEvent,
} from 'react'
import styles from './CanvasSubjectMaskEditor.module.css'

type Size = { width: number; height: number }
type Point = { x: number; y: number }
type Stroke = { erase: boolean; diameter: number; points: Point[] }

export interface CanvasSubjectMaskEditorHandle {
  exportMask(): Promise<File>
}

interface Props {
  src: string
  disabled?: boolean
  onSelectionChange: (hasMask: boolean) => void
}

function canvasPoint(event: PointerEvent<HTMLCanvasElement>, bounds: DOMRect): Point {
  return { x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height }
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

function renderSelection(context: CanvasRenderingContext2D, edits: readonly (Stroke | null)[]) {
  context.clearRect(0, 0, context.canvas.width, context.canvas.height)
  for (const stroke of edits.slice(edits.lastIndexOf(null) + 1)) {
    if (stroke) stroke.points.forEach((point, index) => paintSegment(context, stroke, point, stroke.points[index - 1]))
  }
}

function MaskEditor({
  src,
  disabled = false,
  onSelectionChange,
  editorRef,
}: Props & {
  editorRef: ForwardedRef<CanvasSubjectMaskEditorHandle>
}) {
  const [size, setSize] = useState<Size | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [diameter, setDiameter] = useState(32)
  const [erase, setErase] = useState(false)
  const [hasSelection, setHasSelection] = useState(false)
  const [hasHistory, setHasHistory] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const edits = useRef<Array<Stroke | null>>([])
  const active = useRef<{ pointerId: number; stroke: Stroke } | null>(null)
  const selectionCallback = useRef(onSelectionChange)
  selectionCallback.current = onSelectionChange

  useEffect(() => selectionCallback.current(false), [])

  useImperativeHandle(
    editorRef,
    () => ({
      async exportMask() {
        if (!size || !hasSelection) throw new Error('请先涂抹要编辑的区域')
        if (active.current) throw new Error('请结束当前笔画后重试')
        const canvas = document.createElement('canvas')
        canvas.width = size.width
        canvas.height = size.height
        const context = canvas.getContext('2d')
        if (!context) throw new Error('无法创建编辑蒙版，请重试')
        renderSelection(context, edits.current)
        // 图生图接口使用透明像素标记编辑区。反转涂抹层的 alpha 后导出原尺寸 PNG。
        context.globalCompositeOperation = 'source-out'
        context.fillStyle = '#fff'
        context.fillRect(0, 0, canvas.width, canvas.height)
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
        if (!blob) throw new Error('无法导出编辑蒙版，请重试')
        if (blob.size >= 4 * 1024 * 1024) throw new Error('编辑蒙版超过 4 MB，请缩小图片后重试')
        return new File([blob], 'subject-mask.png', { type: 'image/png' })
      },
    }),
    [size, hasSelection],
  )

  function refreshSelection(context: CanvasRenderingContext2D) {
    const { width, height } = context.canvas
    const { data } = context.getImageData(0, 0, width, height)
    const hasMask = data.some((value, index) => index % 4 === 3 && value > 0)
    setHasSelection(hasMask)
    setHasHistory(edits.current.length > 0)
    selectionCallback.current(hasMask)
  }

  function beginStroke(event: PointerEvent<HTMLCanvasElement>) {
    if (disabled || event.button !== 0 || active.current) return
    const canvas = event.currentTarget
    const context = canvas.getContext('2d', { willReadFrequently: true })
    const bounds = canvas.getBoundingClientRect()
    if (!context || !bounds.width || !bounds.height) return
    const point = canvasPoint(event, bounds)
    const stroke = { erase, diameter: diameter / bounds.width, points: [point] }
    canvas.setPointerCapture(event.pointerId)
    active.current = { pointerId: event.pointerId, stroke }
    paintSegment(context, stroke, point)
  }

  function extendStroke(event: PointerEvent<HTMLCanvasElement>) {
    const current = active.current
    if (!current || current.pointerId !== event.pointerId) return
    const context = event.currentTarget.getContext('2d')
    if (!context) return
    const point = canvasPoint(event, event.currentTarget.getBoundingClientRect())
    const previous = current.stroke.points[current.stroke.points.length - 1]
    if (previous?.x === point.x && previous.y === point.y) return
    paintSegment(context, current.stroke, point, previous)
    current.stroke.points.push(point)
  }

  function finishStroke(event: PointerEvent<HTMLCanvasElement>, canceled = false) {
    const current = active.current
    if (!current || current.pointerId !== event.pointerId) return
    active.current = null
    const context = event.currentTarget.getContext('2d')
    if (!context) return
    if (canceled) {
      renderSelection(context, edits.current)
      return
    }
    edits.current.push(current.stroke)
    refreshSelection(context)
  }

  function changeSelection(clear: boolean) {
    const context = canvasRef.current?.getContext('2d')
    if (!context || active.current) return
    if (clear) edits.current.push(null)
    else edits.current.pop()
    renderSelection(context, edits.current)
    refreshSelection(context)
  }

  const ratio = size ? size.width / size.height : 1
  const previewScale = size ? Math.min(1, 960 / Math.max(size.width, size.height)) : 1

  return (
    <section className={styles.editor} aria-label="编辑选区" aria-busy={!size && !loadError}>
      <div className={styles.toolbar} role="group" aria-label="涂抹工具">
        <button type="button" aria-pressed={!erase} disabled={disabled || !size} onClick={() => setErase(false)}>
          画笔
        </button>
        <button type="button" aria-pressed={erase} disabled={disabled || !size} onClick={() => setErase(true)}>
          橡皮
        </button>
        <label className={styles.brushSize}>
          大小
          <input
            type="range"
            aria-label="画笔大小"
            min={4}
            max={100}
            value={diameter}
            disabled={disabled || !size}
            onChange={(event) => setDiameter(event.target.valueAsNumber)}
          />
          <span>{diameter} px</span>
        </label>
        <button type="button" disabled={disabled || !hasHistory} onClick={() => changeSelection(false)}>
          撤销
        </button>
        <button type="button" disabled={disabled || !hasSelection} onClick={() => changeSelection(true)}>
          清空
        </button>
      </div>
      {loadError ? <p role="alert">原图加载失败，请重新打开编辑器</p> : null}
      {!size && !loadError ? <p role="status">正在读取原图…</p> : null}
      <div
        className={styles.surface}
        style={size ? { aspectRatio: ratio, width: `min(100%, ${ratio * 48}vh, ${ratio * 460}px)` } : undefined}
        hidden={!size}
      >
        <img
          src={src}
          alt="原图"
          draggable={false}
          onLoad={({ currentTarget }) => {
            const { naturalWidth: width, naturalHeight: height } = currentTarget
            if (width && height) setSize({ width, height })
            else setLoadError(true)
          }}
          onError={() => setLoadError(true)}
        />
        {size && (
          <canvas
            ref={canvasRef}
            className={styles.selection}
            width={Math.max(1, Math.round(size.width * previewScale))}
            height={Math.max(1, Math.round(size.height * previewScale))}
            aria-label="图片涂抹区域"
            aria-disabled={disabled}
            onPointerDown={beginStroke}
            onPointerMove={extendStroke}
            onPointerUp={finishStroke}
            onPointerCancel={(event) => finishStroke(event, true)}
            onLostPointerCapture={(event) => finishStroke(event, true)}
          />
        )}
      </div>
      {size && <p className={styles.hint}>涂抹要编辑的区域，绿色覆盖表示已选中。</p>}
    </section>
  )
}

export default forwardRef<CanvasSubjectMaskEditorHandle, Props>(function CanvasSubjectMaskEditor(props, ref) {
  return <MaskEditor key={props.src} {...props} editorRef={ref} />
})
