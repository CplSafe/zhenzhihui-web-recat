import { createPortal } from 'react-dom'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import styles from './MaterialMentionPopover.module.css'

export interface MaterialMentionItem {
  key: string
  label: string
  url: string
  kind?: 'image' | 'video'
}

interface MaterialMentionPopoverProps {
  open: boolean
  title: string
  items: MaterialMentionItem[]
  layout?: 'strip' | 'grid'
  getAnchorRect: () => DOMRect | null
  onSelect: (index: number) => void
  onClose: () => void
}

const VIEWPORT_GAP = 12
const ANCHOR_GAP = 8
const MAX_PANEL_WIDTH = 640
const GRID_PANEL_WIDTH = 252

/** 素材提及面板：既可锚定 textarea 内的 @，也可锚定工具栏按钮。 */
export default function MaterialMentionPopover({
  open,
  title,
  items,
  layout = 'strip',
  getAnchorRect,
  onSelect,
  onClose,
}: MaterialMentionPopoverProps) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' })

  const place = useCallback(() => {
    const panel = panelRef.current
    const anchor = getAnchorRect()
    if (!panel || !anchor) return
    const panelRect = panel.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const maxLeft = Math.max(VIEWPORT_GAP, viewportWidth - panelRect.width - VIEWPORT_GAP)
    const left = Math.min(
      Math.max(layout === 'grid' ? anchor.left + anchor.width / 2 - panelRect.width / 2 : anchor.left, VIEWPORT_GAP),
      maxLeft,
    )
    const fitsAbove = anchor.top >= panelRect.height + ANCHOR_GAP + VIEWPORT_GAP
    const fitsBelow = anchor.bottom + ANCHOR_GAP + panelRect.height + VIEWPORT_GAP <= viewportHeight
    const top =
      layout === 'grid'
        ? fitsBelow || !fitsAbove
          ? Math.min(anchor.bottom + ANCHOR_GAP, viewportHeight - panelRect.height - VIEWPORT_GAP)
          : anchor.top - panelRect.height - ANCHOR_GAP
        : fitsAbove
          ? anchor.top - panelRect.height - ANCHOR_GAP
          : Math.min(anchor.bottom + ANCHOR_GAP, viewportHeight - panelRect.height - VIEWPORT_GAP)
    setStyle({ left, top: Math.max(VIEWPORT_GAP, top), visibility: 'visible' })
  }, [getAnchorRect, layout])

  useLayoutEffect(() => {
    if (!open) return
    place()
  }, [open, items.length, place])

  useEffect(() => {
    if (!open) return
    const reposition = () => window.requestAnimationFrame(place)
    const onPointerDown = (event: PointerEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose, open, place])

  if (!open || !items.length) return null
  const desiredWidth =
    layout === 'grid' ? GRID_PANEL_WIDTH : Math.min(MAX_PANEL_WIDTH, Math.max(96, items.length * 80 + 20))

  return createPortal(
    <div
      ref={panelRef}
      className={`${styles.panel}${layout === 'grid' ? ` ${styles.panelGrid}` : ''}`}
      style={{ ...style, width: `min(${desiredWidth}px, calc(100vw - 24px))` }}
      role="listbox"
      aria-label={title}
    >
      <div className={styles.title}>{title}</div>
      <div
        className={`${styles.scroller}${layout === 'grid' ? ` ${styles.grid}` : ''}`}
        onWheel={(event) => {
          if (layout === 'grid') return
          if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
          event.currentTarget.scrollLeft += event.deltaY
          event.preventDefault()
        }}
      >
        {items.map((item, index) => (
          <button
            key={item.key}
            type="button"
            role="option"
            aria-selected="false"
            className={styles.item}
            onClick={() => onSelect(index)}
          >
            {item.kind === 'video' ? (
              <video className={styles.preview} src={item.url} muted playsInline preload="metadata" />
            ) : (
              <img className={styles.preview} src={item.url} alt="" width="72" height="56" loading="lazy" />
            )}
            <span className={styles.name}>{item.label}</span>
          </button>
        ))}
      </div>
    </div>,
    document.body,
  )
}
