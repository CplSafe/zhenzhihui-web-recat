/**
 * DraftSavedDialog — 草稿保存成功弹窗
 * 展示"草稿已保存"的成功提示和项目信息。
 */
import { useEffect } from 'react'
import './DraftSavedDialog.css'

interface DraftSavedDialogProps {
  open?: boolean
  title?: string
  description?: string
  onClose?: () => void
  onOpenHistory?: () => void
}

export default function DraftSavedDialog({
  open = false,
  title = '草稿已保存',
  description = '你可以在历史记录中查看并继续编辑之前保存的草稿。',
  onClose,
  onOpenHistory,
}: DraftSavedDialogProps) {
  // Esc 键关闭弹窗。
  useEffect(() => {
    function onKeydown(e: KeyboardEvent) {
      if (e.key === 'Escape' && open) onClose?.()
    }
    document.addEventListener('keydown', onKeydown)
    return () => document.removeEventListener('keydown', onKeydown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="ds-scrim" onClick={() => onClose?.()}>
      <section
        className="ds-panel"
        role="dialog"
        aria-modal="true"
        aria-label="草稿已保存"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="ds-head">
          <strong>{title}</strong>
          <p>{description}</p>
        </header>

        <footer className="ds-foot">
          <button type="button" className="ds-ghost" onClick={() => onClose?.()}>
            知道了
          </button>
          <button type="button" className="ds-primary" onClick={() => onOpenHistory?.()}>
            历史记录
          </button>
        </footer>
      </section>
    </div>
  )
}
