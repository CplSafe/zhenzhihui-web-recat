import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import styles from './ImageViewport.module.css'

const clamp = (value: number) => Math.min(8, Math.max(0.01, value))

/** Shared image detail surface. 100% means one image pixel per CSS pixel. */
export default function ImageViewport({
  src,
  alt,
  onError,
  onSize,
  overlay,
}: {
  src: string
  alt: string
  onError?: () => void
  onSize?: (size: { width: number; height: number }) => void
  overlay?: ReactNode
}) {
  const viewport = useRef<HTMLDivElement>(null)
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 })
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 })
  const [percent, setPercent] = useState<string | null>(null)
  const drag = useRef<{ id: number; x: number; y: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const fit = useCallback(() => {
    const box = viewport.current
    if (!box || !size.width || !size.height) return
    setViewportSize({ width: box.clientWidth, height: box.clientHeight })
    setPercent(null)
    setView({ scale: clamp(Math.min(box.clientWidth / size.width, box.clientHeight / size.height)), x: 0, y: 0 })
  }, [size])

  useEffect(() => {
    fit()
    // Defer layout-driven updates so WebKit does not re-enter ResizeObserver delivery.
    let frame = 0
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            window.cancelAnimationFrame(frame)
            frame = window.requestAnimationFrame(fit)
          })
    if (viewport.current) observer?.observe(viewport.current)
    return () => {
      observer?.disconnect()
      window.cancelAnimationFrame(frame)
    }
  }, [fit])

  const zoom = useCallback((factor: number, anchorX = 0, anchorY = 0) => {
    setPercent(null)
    setView((previous) => {
      const scale = clamp(previous.scale * factor)
      const change = scale / previous.scale
      return { scale, x: anchorX - (anchorX - previous.x) * change, y: anchorY - (anchorY - previous.y) * change }
    })
  }, [])

  useEffect(() => {
    const element = viewport.current
    if (!element) return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      event.stopPropagation()
      const box = element.getBoundingClientRect()
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1)
      zoom(
        Math.exp(-Math.max(-200, Math.min(200, delta)) * 0.002),
        event.clientX - box.left - box.width / 2,
        event.clientY - box.top - box.height / 2,
      )
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [zoom])

  function applyPercent() {
    if (percent === null) return
    const value = Number(percent)
    if (Number.isFinite(value) && value > 0) {
      const scale = clamp(value / 100)
      setView({ scale, x: 0, y: 0 })
    }
    setPercent(null)
  }

  return (
    <div
      className={styles.root}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div
        ref={viewport}
        className={styles.viewport}
        data-dragging={dragging}
        role="region"
        aria-label="图片缩放区域"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === '+' || event.key === '=') {
            event.preventDefault()
            event.stopPropagation()
            zoom(1.2)
          }
          if (event.key === '-') {
            event.preventDefault()
            event.stopPropagation()
            zoom(1 / 1.2)
          }
        }}
        onDoubleClick={() => {
          setPercent(null)
          if (Math.abs(view.scale - 1) < 0.001) fit()
          else setView({ scale: 1, x: 0, y: 0 })
        }}
        onPointerDown={(event) => {
          if (event.target instanceof Element && event.target.closest('button')) return
          if (event.button !== 0 || !size.width) return
          event.preventDefault()
          event.stopPropagation()
          drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
          event.currentTarget.setPointerCapture?.(event.pointerId)
          setDragging(true)
        }}
        onPointerMove={(event) => {
          const previous = drag.current
          if (!previous || previous.id !== event.pointerId) return
          const dx = event.clientX - previous.x
          const dy = event.clientY - previous.y
          drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
          setView((current) => ({ ...current, x: current.x + dx, y: current.y + dy }))
        }}
        onPointerUp={(event) => {
          drag.current = null
          setDragging(false)
          if (event.currentTarget.hasPointerCapture?.(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        onPointerCancel={() => {
          drag.current = null
          setDragging(false)
        }}
        onLostPointerCapture={() => {
          drag.current = null
          setDragging(false)
        }}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          onError={onError}
          onLoad={(event) => {
            const next = { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }
            setSize(next)
            onSize?.(next)
          }}
          className={styles.image}
          style={{
            width: size.width || undefined,
            height: size.height || undefined,
            transform: `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          }}
        />
        {overlay && size.width > 0 && size.height > 0 && (
          <div
            className={styles.imageOverlay}
            style={{
              left: viewportSize.width / 2 + view.x - (size.width * view.scale) / 2,
              top: viewportSize.height / 2 + view.y - (size.height * view.scale) / 2,
              width: size.width * view.scale,
              height: size.height * view.scale,
            }}
          >
            {overlay}
          </div>
        )}
      </div>
      <div className={styles.toolbar} role="group" aria-label="图片缩放工具">
        <button type="button" aria-label="缩小图片" disabled={view.scale <= 0.01} onClick={() => zoom(1 / 1.2)}>
          −
        </button>
        <label className={styles.percent}>
          <input
            aria-label="图片缩放百分比"
            type="number"
            min={1}
            max={800}
            value={percent ?? String(Math.round(view.scale * 100))}
            onChange={(event) => setPercent(event.target.value)}
            onBlur={applyPercent}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') event.stopPropagation()
              if (event.key === 'Enter') {
                applyPercent()
                event.currentTarget.blur()
              }
            }}
          />
          <span aria-hidden="true">%</span>
        </label>
        <button type="button" aria-label="放大图片" disabled={view.scale >= 8} onClick={() => zoom(1.2)}>
          +
        </button>
        <button
          type="button"
          onClick={() => {
            setPercent(null)
            setView({ scale: 1, x: 0, y: 0 })
          }}
        >
          原始大小
        </button>
        <button type="button" onClick={fit}>
          适应窗口
        </button>
      </div>
      <span className={styles.hint}>滚轮缩放 · 拖拽移动 · 双击切换原图</span>
    </div>
  )
}
