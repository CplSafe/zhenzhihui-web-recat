/**
 * 「操作手册」按钮 + 视频弹窗（对标 CineArt 右上角操作手册）。
 * 按当前路由取教程（utils/tutorialVideos），没有教程的页面不渲染。
 * 弹窗用 portal 渲染到 body：遮罩点击 / Esc / 关闭按钮均可关闭，打开时自动播放（视频本身静音）。
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { getTutorialForPath, type TutorialVideo } from '@/utils/tutorialVideos'
import './TutorialButton.css'

/** 按钮外观：顶栏文字按钮 / 画布页的圆角胶囊。 */
interface TutorialButtonProps {
  className?: string
  variant?: 'topbar' | 'pill'
}

/** 有教程的页面显示按钮，点击弹出该页面的操作手册视频。 */
export default function TutorialButton({ className = '', variant = 'topbar' }: TutorialButtonProps) {
  const { pathname } = useLocation()
  const tutorial = getTutorialForPath(pathname)
  const [open, setOpen] = useState(false)

  // 切换到没有教程的页面时收起弹窗
  useEffect(() => {
    if (!tutorial) setOpen(false)
  }, [tutorial])

  if (!tutorial) return null

  return (
    <>
      <button
        type="button"
        className={`tutorial-btn tutorial-btn--${variant} ${className}`.trim()}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="查看本页面的操作手册"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" />
          <path d="M4 20.5V5.5M20 18v3H6.5" />
          <path d="m10.5 8 4 3-4 3z" fill="currentColor" stroke="none" />
        </svg>
        <span>操作手册</span>
      </button>
      {open && <TutorialModal tutorial={tutorial} onClose={() => setOpen(false)} />}
    </>
  )
}

/** 视频弹窗。 */
function TutorialModal({ tutorial, onClose }: { tutorial: TutorialVideo; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])

  return createPortal(
    <div className="tutorial-modal__mask" onClick={onClose} data-testid="tutorial-modal-mask">
      <div
        className="tutorial-modal"
        role="dialog"
        aria-modal="true"
        aria-label={tutorial.title}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="tutorial-modal__head">
          <div>
            <h2 className="tutorial-modal__title">{tutorial.title}</h2>
            <p className="tutorial-modal__summary">{tutorial.summary}</p>
          </div>
          <button ref={closeRef} type="button" className="tutorial-modal__close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>
        <video
          className="tutorial-modal__video"
          src={tutorial.src}
          controls
          autoPlay
          playsInline
          preload="metadata"
          data-testid="tutorial-video"
        />
      </div>
    </div>,
    document.body,
  )
}
