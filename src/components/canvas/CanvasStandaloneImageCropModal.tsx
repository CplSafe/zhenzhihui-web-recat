import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Alert, Button, Modal, Spin } from 'antd'
import {
  cropCanvasImageFile,
  validateCanvasImageCropSource,
  type CanvasImageCropRect,
} from '@/utils/canvasImagePixelCrop'
import CanvasPortalBoundary from './CanvasPortalBoundary'
import styles from './CanvasStandaloneImageCropModal.module.css'

const PRESETS = [
  { label: '自由', ratio: null },
  { label: '原图', ratio: null },
  { label: '1:1', ratio: [1, 1] },
  { label: '16:9', ratio: [16, 9] },
  { label: '9:16', ratio: [9, 16] },
  { label: '4:3', ratio: [4, 3] },
  { label: '3:4', ratio: [3, 4] },
  { label: '3:2', ratio: [3, 2] },
  { label: '2:3', ratio: [2, 3] },
  { label: '4:5', ratio: [4, 5] },
  { label: '5:4', ratio: [5, 4] },
  { label: '21:9', ratio: [7, 3] },
] as const

const HANDLES = {
  nw: '左上',
  n: '上',
  ne: '右上',
  w: '左',
  e: '右',
  sw: '左下',
  s: '下',
  se: '右下',
} as const

type Preset = (typeof PRESETS)[number]['label']
type Handle = keyof typeof HANDLES
type Size = Pick<CanvasImageCropRect, 'width' | 'height'>
type Point = Pick<CanvasImageCropRect, 'x' | 'y'>

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function handleAt(target: EventTarget): Handle | undefined {
  return (target as Element).closest<HTMLElement>('[data-crop-handle]')?.dataset.cropHandle as Handle | undefined
}

function moveCrop(rect: CanvasImageCropRect, delta: Point, size: Size): CanvasImageCropRect {
  return {
    ...rect,
    x: clamp(rect.x + delta.x, 0, size.width - rect.width),
    y: clamp(rect.y + delta.y, 0, size.height - rect.height),
  }
}

function largestCrop(size: Size, ratio: readonly [number, number]): CanvasImageCropRect {
  const factor = Math.floor(Math.min(size.width / ratio[0], size.height / ratio[1]))
  const width = ratio[0] * factor
  const height = ratio[1] * factor
  return { x: Math.floor((size.width - width) / 2), y: Math.floor((size.height - height) / 2), width, height }
}

function resizeCrop(rect: CanvasImageCropRect, delta: Point, size: Size, handle: Handle, preset: Preset) {
  const horizontal = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0
  const vertical = handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0
  const centerX = rect.x + rect.width / 2
  const centerY = rect.y + rect.height / 2
  const maxWidth =
    horizontal === 0
      ? 2 * Math.min(centerX, size.width - centerX)
      : horizontal > 0
        ? size.width - rect.x
        : rect.x + rect.width
  const maxHeight =
    vertical === 0
      ? 2 * Math.min(centerY, size.height - centerY)
      : vertical > 0
        ? size.height - rect.y
        : rect.y + rect.height
  let width = clamp(rect.width + delta.x * horizontal, 1, maxWidth)
  let height = clamp(rect.height + delta.y * vertical, 1, maxHeight)
  const units =
    preset === '原图' ? ([size.width, size.height] as const) : PRESETS.find((item) => item.label === preset)?.ratio
  if (units) {
    const [unitWidth, unitHeight] = units
    const maxFactor = Math.min(maxWidth / unitWidth, maxHeight / unitHeight)
    const horizontalChange = Math.abs(width - rect.width) / rect.width
    const verticalChange = Math.abs(height - rect.height) / rect.height
    const factor = horizontalChange >= verticalChange ? width / unitWidth : height / unitHeight
    if (preset === '原图') {
      // 原图的宽高可能互质，缩放裁剪框时允许 1 像素的取整误差。
      width = clamp(Math.round(unitWidth * Math.min(maxFactor, factor)), 1, maxWidth)
      height = clamp(Math.round(unitHeight * Math.min(maxFactor, factor)), 1, maxHeight)
    } else {
      const integerFactor = clamp(Math.round(factor), 1, Math.floor(maxFactor))
      width = integerFactor * unitWidth
      height = integerFactor * unitHeight
    }
  }
  return {
    x: horizontal ? (horizontal > 0 ? rect.x : rect.x + rect.width - width) : Math.round(centerX - width / 2),
    y: vertical ? (vertical > 0 ? rect.y : rect.y + rect.height - height) : Math.round(centerY - height / 2),
    width,
    height,
  }
}

interface Props {
  sourceUrl: string
  title: string
  onClose: () => void
  onSave: (file: File, width: number, height: number, signal: AbortSignal) => Promise<void>
}

export default function CanvasStandaloneImageCropModal({ sourceUrl, title, onClose, onSave }: Props) {
  const [source, setSource] = useState<{ blob: Blob; url: string; size: Size } | null>(null)
  const [size, setSize] = useState<Size | null>(null)
  const [crop, setCrop] = useState<CanvasImageCropRect | null>(null)
  const [preset, setPreset] = useState<Preset>('自由')
  const [loadError, setLoadError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [busy, setBusy] = useState(false)
  const saving = useRef<AbortController | null>(null)
  const lastExport = useRef<{ source: Blob; key: string; file: File } | null>(null)
  const drag = useRef<{
    pointerId: number
    start: Point
    rect: CanvasImageCropRect
    scale: Point
    handle?: Handle
  } | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    let url = ''
    async function load() {
      try {
        const response = await fetch(sourceUrl, { credentials: 'same-origin', signal: controller.signal })
        if (!response.ok) throw new Error('无法读取原图，请关闭窗口后重试')
        const blob = await response.blob()
        const size = await validateCanvasImageCropSource(blob)
        if (controller.signal.aborted) return
        url = URL.createObjectURL(blob)
        setSource({ blob, url, size })
      } catch (reason) {
        if (!controller.signal.aborted) setLoadError(reason instanceof Error ? reason.message : '无法读取原图')
      }
    }
    void load()
    return () => {
      controller.abort()
      saving.current?.abort()
      if (url) URL.revokeObjectURL(url)
    }
  }, [sourceUrl])

  function selectPreset(choice: (typeof PRESETS)[number]) {
    if (!size) return
    setPreset(choice.label)
    setSaveError('')
    if (choice.ratio) setCrop(largestCrop(size, choice.ratio))
    else if (choice.label === '原图') setCrop({ x: 0, y: 0, ...size })
  }

  function beginDrag(event: PointerEvent<HTMLDivElement>) {
    if (!crop || !size || busy || event.button !== 0 || drag.current) return
    if (!(event.target as Element).closest(`.${styles.selection}`)) return
    const bounds = event.currentTarget.getBoundingClientRect()
    if (!bounds.width || !bounds.height) return
    drag.current = {
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      rect: crop,
      scale: { x: size.width / bounds.width, y: size.height / bounds.height },
      handle: handleAt(event.target),
    }
    setSaveError('')
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function applyDrag(event: PointerEvent<HTMLDivElement>) {
    const active = drag.current
    if (!active || !size || active.pointerId !== event.pointerId) return
    const delta = {
      x: Math.round((event.clientX - active.start.x) * active.scale.x),
      y: Math.round((event.clientY - active.start.y) * active.scale.y),
    }
    setCrop(
      active.handle ? resizeCrop(active.rect, delta, size, active.handle, preset) : moveCrop(active.rect, delta, size),
    )
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId === event.pointerId) drag.current = null
  }

  function adjustWithKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (!crop || !size || busy || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault()
    event.stopPropagation()
    const handle = handleAt(event.target)
    const units = handle && PRESETS.find((item) => item.label === preset)?.ratio
    const step = event.shiftKey ? 10 : 1
    const stepX = step * (units?.[0] || 1)
    const stepY = step * (units?.[1] || 1)
    const delta = {
      x: event.key === 'ArrowLeft' ? -stepX : event.key === 'ArrowRight' ? stepX : 0,
      y: event.key === 'ArrowUp' ? -stepY : event.key === 'ArrowDown' ? stepY : 0,
    }
    setSaveError('')
    setCrop(handle ? resizeCrop(crop, delta, size, handle, preset) : moveCrop(crop, delta, size))
  }

  async function save() {
    if (!source || !crop || saving.current) return
    const operation = new AbortController()
    saving.current = operation
    setBusy(true)
    setSaveError('')
    try {
      const key = `${crop.x},${crop.y},${crop.width},${crop.height}`
      const cached = lastExport.current
      const file =
        cached?.source === source.blob && cached.key === key
          ? cached.file
          : await cropCanvasImageFile(source.blob, crop, `${title}-裁切.png`)
      if (operation.signal.aborted) return
      lastExport.current = { source: source.blob, key, file }
      await onSave(file, crop.width, crop.height, operation.signal)
      if (!operation.signal.aborted) onClose()
    } catch (reason) {
      if (!operation.signal.aborted) setSaveError(reason instanceof Error ? reason.message : '裁剪保存失败，请重试')
    } finally {
      saving.current = null
      if (!operation.signal.aborted) setBusy(false)
    }
  }

  return (
    <Modal
      open
      zIndex={2200}
      width={900}
      className={styles.modal}
      style={{ top: 24 }}
      title="裁剪图片"
      modalRender={(modal) => <CanvasPortalBoundary>{modal}</CanvasPortalBoundary>}
      keyboard={!busy}
      focusTriggerAfterClose={false}
      maskClosable={false}
      closable={!busy}
      onCancel={onClose}
      footer={
        <>
          <Button autoFocus disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button type="primary" loading={busy} disabled={!crop || Boolean(loadError)} onClick={save}>
            裁剪并创建节点
          </Button>
        </>
      }
    >
      <div className={styles.editor}>
        <div className={styles.presets} role="group" aria-label="裁剪比例">
          {PRESETS.map((choice) => (
            <button
              key={choice.label}
              type="button"
              aria-pressed={choice.label === preset}
              disabled={
                !size ||
                busy ||
                Boolean(loadError) ||
                Boolean(choice.ratio && (size.width < choice.ratio[0] || size.height < choice.ratio[1]))
              }
              onClick={() => selectPreset(choice)}
            >
              {choice.label}
            </button>
          ))}
        </div>
        {!loadError && (
          <div className={styles.preview}>
            {!size && <Spin aria-label="正在读取原图" />}
            {source && (
              <div
                className={styles.stage}
                style={
                  size
                    ? {
                        width: `min(100%, ${(size.width / size.height) * 52}dvh, ${(size.width / size.height) * 520}px)`,
                      }
                    : { display: 'none' }
                }
                onPointerDown={beginDrag}
                onPointerMove={applyDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onLostPointerCapture={endDrag}
              >
                <img
                  className={styles.image}
                  src={source.url}
                  alt="原图"
                  draggable={false}
                  onLoad={(event) => {
                    const { naturalWidth, naturalHeight } = event.currentTarget
                    const { width, height } = source.size
                    if (
                      !naturalWidth ||
                      !naturalHeight ||
                      Math.abs(width * naturalHeight - height * naturalWidth) > Math.max(width, height)
                    ) {
                      setLoadError('预览尺寸与原图方向不一致，无法准确裁剪')
                      return
                    }
                    setSize({ width, height })
                    setCrop({ x: 0, y: 0, width, height })
                  }}
                  onError={() => setLoadError('无法打开原图，请关闭窗口后重试')}
                />
                {crop && size && (
                  <div
                    className={styles.selection}
                    data-testid="canvas-image-crop-selection"
                    role="group"
                    aria-label="移动裁剪框"
                    tabIndex={busy ? -1 : 0}
                    onKeyDown={adjustWithKeys}
                    style={{
                      left: `${(crop.x / size.width) * 100}%`,
                      top: `${(crop.y / size.height) * 100}%`,
                      width: `${(crop.width / size.width) * 100}%`,
                      height: `${(crop.height / size.height) * 100}%`,
                    }}
                  >
                    {Object.entries(HANDLES).map(([handle, label]) => (
                      <button
                        key={handle}
                        type="button"
                        className={styles.handle}
                        data-crop-handle={handle}
                        aria-label={`调整裁剪范围（${label}）`}
                        disabled={busy}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {crop && !loadError && (
          <div className={styles.dimensions} role="status" aria-label="裁剪尺寸">
            {crop.width} × {crop.height} 像素
          </div>
        )}
        {(loadError || saveError) && <Alert type="error" showIcon message={loadError || saveError} />}
      </div>
    </Modal>
  )
}
