/**
 * VideoPreviewModal — 全屏视频预览弹窗(点遮罩关闭)。
 * 复用 home__video-modal* 样式(由 HomeView.css 提供,首页/模板库均已载入)。
 * 取代此前在 HomeView(历史项目播放 + 模板预览)与 TemplatesView 里三份重复的同款弹窗。
 */
import { useEffect, useRef } from 'react'

/** 预览视频地址、封面、跨域策略和关闭事件。 */
interface VideoPreviewModalProps {
  /** 视频地址;为空则不渲染 */
  src: string
  poster?: string
  /** 仅同源资产(/download)需要;外链 OSS 无 CORS 头,传它会卡在 0:00,故默认不带 */
  crossOrigin?: 'anonymous' | 'use-credentials'
  onClose: () => void
}

/** 在全屏模态层中播放视频，并管理初始焦点、Esc 和遮罩关闭。 */
export default function VideoPreviewModal({ src, poster, crossOrigin, onClose }: VideoPreviewModalProps) {
  const modalRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!src) return
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
      if (event.key !== 'Tab' || !modalRef.current) return
      const focusable = Array.from(
        modalRef.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), video[controls], [tabindex]:not([tabindex="-1"])',
        ),
      )
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
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
  }, [src])

  if (!src) return null
  return (
    <div className="home__video-modal-mask" onClick={onClose}>
      <div
        ref={modalRef}
        className="home__video-modal"
        role="dialog"
        aria-modal="true"
        aria-label="视频预览"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          ref={closeButtonRef}
          type="button"
          className="home__video-modal-close"
          onClick={onClose}
          aria-label="关闭视频预览"
        >
          ✕
        </button>
        <video
          className="home__video-modal-player"
          src={src}
          poster={poster || undefined}
          controls
          autoPlay
          playsInline
          {...(crossOrigin ? { crossOrigin } : {})}
        />
      </div>
    </div>
  )
}
