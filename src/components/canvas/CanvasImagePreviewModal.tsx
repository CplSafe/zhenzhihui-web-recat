/**
 * CanvasImagePreviewModal — 画布图片节点的「放大查看」全屏预览。
 *
 * 与视频预览（CanvasVideoPreviewModal）同一套交互语言：portal 到 body、遮罩点击/Esc 关闭。
 * 额外提供画廊导航：左右箭头 / 方向键在画布上的**全部图片**之间切换，
 * 底部缩略图条可直接跳到任意一张——预览不局限于双击的那一张。
 */
import { useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import styles from './CanvasImagePreviewModal.module.css'

/** 画廊中的一张图片：画布上每个有素材的图片节点对应一项。 */
export interface CanvasImagePreviewItem {
  /** 节点 id，同时作为画廊项的唯一键 */
  id: string
  /** 图片地址（节点当前展示用的同一地址） */
  url: string
  /** 节点标题，展示在预览左上角 */
  title?: string
}

interface CanvasImagePreviewModalProps {
  /** 画布上全部可预览的图片（按节点顺序） */
  items: CanvasImagePreviewItem[]
  /** 当前展示的图片（节点 id）；找不到时回退到第一张 */
  activeId: string
  /** 切换到另一张图片 */
  onSelect: (id: string) => void
  onClose: () => void
}

export default function CanvasImagePreviewModal({ items, activeId, onSelect, onClose }: CanvasImagePreviewModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const activeThumbRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  const onSelectRef = useRef(onSelect)
  onCloseRef.current = onClose
  onSelectRef.current = onSelect

  const foundIndex = items.findIndex((item) => item.id === activeId)
  const index = foundIndex >= 0 ? foundIndex : 0
  const current = items[index]
  const itemsRef = useRef(items)
  const indexRef = useRef(index)
  itemsRef.current = items
  indexRef.current = index

  const goTo = useCallback((nextIndex: number) => {
    const list = itemsRef.current
    if (nextIndex < 0 || nextIndex >= list.length) return
    onSelectRef.current(list[nextIndex].id)
  }, [])

  // 打开期间锁定页面滚动、聚焦关闭按钮；Esc 关闭、方向键翻图；关闭后还原焦点。
  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        goTo(indexRef.current - 1)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        goTo(indexRef.current + 1)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      window.requestAnimationFrame(() => {
        if (previouslyFocused?.isConnected) previouslyFocused.focus()
      })
    }
  }, [goTo])

  // 切图后让缩略图条自动滚到当前项，画廊长时也能看见「现在在哪」。（jsdom 无 scrollIntoView，故取可选调用）
  useEffect(() => {
    activeThumbRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [index])

  if (!current) return null

  const title = String(current.title || '').trim()

  return createPortal(
    <div className={styles.mask} onClick={() => onCloseRef.current()} role="presentation">
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label="图片预览"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          ref={closeButtonRef}
          type="button"
          className={styles.close}
          onClick={() => onCloseRef.current()}
          aria-label="关闭图片预览"
        >
          ✕
        </button>

        {(title || items.length > 1) && (
          <div className={styles.caption}>
            {title ? <span className={styles.captionTitle}>{title}</span> : null}
            {items.length > 1 ? (
              <span className={styles.captionCount} aria-label={`第 ${index + 1} 张，共 ${items.length} 张`}>
                {index + 1} / {items.length}
              </span>
            ) : null}
          </div>
        )}

        <div className={styles.stage}>
          {items.length > 1 && (
            <button
              type="button"
              className={`${styles.nav} ${styles.navPrev}`}
              onClick={() => goTo(index - 1)}
              disabled={index <= 0}
              aria-label="上一张图片"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                <path d="m14.5 5.5-7 6.5 7 6.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
          {/* key 强制换图时重挂载：上一张的画面不会在新图加载期间残留 */}
          <img key={current.id} className={styles.image} src={current.url} alt={title || '画布图片'} />
          {items.length > 1 && (
            <button
              type="button"
              className={`${styles.nav} ${styles.navNext}`}
              onClick={() => goTo(index + 1)}
              disabled={index >= items.length - 1}
              aria-label="下一张图片"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                <path d="m9.5 5.5 7 6.5-7 6.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>

        {items.length > 1 && (
          <div className={styles.thumbs} role="listbox" aria-label="画布全部图片">
            {items.map((item, itemIndex) => (
              <button
                key={item.id}
                ref={itemIndex === index ? activeThumbRef : undefined}
                type="button"
                role="option"
                aria-selected={itemIndex === index}
                className={`${styles.thumb}${itemIndex === index ? ` ${styles.thumbActive}` : ''}`}
                onClick={() => onSelectRef.current(item.id)}
                title={String(item.title || '').trim() || `第 ${itemIndex + 1} 张`}
              >
                <img src={item.url} alt="" aria-hidden="true" loading="lazy" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
