import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

type Props = { shortcut: string; onDuplicate: () => void; onDuplicateWithUpstream: () => void }

/** Render outside the scrollable context menu so the submenu cannot be clipped. */
export default function CanvasDuplicateMenu({ shortcut, onDuplicate, onDuplicateWithUpstream }: Props) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const submenuRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<number | undefined>(undefined)
  const [position, setPosition] = useState<{ left: number; top: number; flipped: boolean } | null>(null)
  const cancelClose = () => window.clearTimeout(closeTimer.current)
  const scheduleClose = () => {
    cancelClose()
    closeTimer.current = window.setTimeout(() => {
      if (
        !triggerRef.current?.contains(document.activeElement) &&
        !submenuRef.current?.contains(document.activeElement)
      )
        setPosition(null)
    }, 150)
  }
  useEffect(() => () => window.clearTimeout(closeTimer.current), [])
  const show = () => {
    cancelClose()
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = 190
    const flipped = rect.right + 4 + width > window.innerWidth - 8
    setPosition({
      left: Math.max(8, flipped ? rect.left - width - 4 : rect.right + 4),
      top: Math.max(8, Math.min(rect.top - 6, window.innerHeight - 110)),
      flipped,
    })
  }
  return (
    <div className="canvas-context-menu__submenu-host" onMouseEnter={show} onMouseLeave={scheduleClose}>
      <button
        ref={triggerRef}
        type="button"
        className="canvas-context-menu__item"
        aria-haspopup="menu"
        aria-expanded={Boolean(position)}
        onFocus={show}
        onBlur={scheduleClose}
        onClick={show}
      >
        <span className="canvas-context-menu__icon">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M5 15V5a2 2 0 0 1 2-2h10" />
          </svg>
        </span>
        创建副本
        <span className="canvas-context-menu__kbd" aria-hidden="true">
          ›
        </span>
      </button>
      {position &&
        createPortal(
          <div
            ref={submenuRef}
            className={`canvas-context-menu canvas-context-menu__submenu${position.flipped ? ' is-flipped' : ''}`}
            role="menu"
            style={{ left: position.left, top: position.top }}
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
            onFocus={cancelClose}
            onBlur={scheduleClose}
          >
            <button type="button" role="menuitem" className="canvas-context-menu__item" onClick={onDuplicate}>
              只含当前节点<span className="canvas-context-menu__kbd">{shortcut}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="canvas-context-menu__item"
              onClick={onDuplicateWithUpstream}
            >
              包含之前所有节点
            </button>
          </div>,
          document.body,
        )}
    </div>
  )
}
