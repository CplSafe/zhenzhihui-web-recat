/**
 * 「操作教程」按钮 + 视频弹窗。
 * 按当前路由取教程（utils/tutorialVideos），没有教程的页面不渲染。
 * 弹窗用 portal 渲染到 body：遮罩点击 / Esc / 关闭按钮均可关闭，打开时自动播放（视频本身静音）。
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { getTutorialByKey, getTutorialForPath, type TutorialVideo } from '@/utils/tutorialVideos'
import './TutorialButton.css'

/** 按钮外观：顶栏文字按钮 / 画布页的圆角胶囊 / 创作入口文字按钮。 */
interface TutorialButtonProps {
  className?: string
  variant?: 'topbar' | 'pill' | 'entry'
  /** 独立页面组件可直接指定教程，避免依赖外层路由上下文。 */
  tutorialKey?: TutorialVideo['key']
}

/** 有教程的页面显示按钮，点击弹出该页面的操作手册视频。 */
export default function TutorialButton(props: TutorialButtonProps) {
  if (props.tutorialKey) {
    return <TutorialButtonView {...props} tutorial={getTutorialByKey(props.tutorialKey)} />
  }
  return <RoutedTutorialButton {...props} />
}

/** 顶栏等共享壳层仍可按当前路由自动选择教程。 */
function RoutedTutorialButton(props: TutorialButtonProps) {
  const { pathname } = useLocation()
  return <TutorialButtonView {...props} tutorial={getTutorialForPath(pathname)} />
}

/** 纯展示与交互层：无论教程来源如何，按钮和弹窗行为完全一致。 */
function TutorialButtonView({
  className = '',
  variant = 'topbar',
  tutorial,
}: TutorialButtonProps & { tutorial: TutorialVideo | null }) {
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
        title="查看本页面的操作教程"
      >
        <span>操作教程</span>
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
        {tutorial.docUrl ? (
          <footer className="tutorial-modal__foot">
            <span className="tutorial-modal__foot-hint">视频只演示主流程，每一步的参数与注意事项见图文手册。</span>
            <a
              className="tutorial-modal__doc-link"
              href={tutorial.docUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="tutorial-doc-link"
            >
              查看完整图文手册 ↗
            </a>
          </footer>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}
