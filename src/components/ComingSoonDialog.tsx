/**
 * ComingSoonDialog — 全局「功能待开放」弹窗(单例)。
 *
 * 任意页面点未上线的菜单项 / 入口时,调用 ui store 的 openComingSoon() 即可弹出本弹窗;
 * 由顶层 <AppShell/> 挂载一次,各页面无需各自实现。
 * 关闭方式:点遮罩、点「我知道了」、按 Esc。
 */
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useUiStore } from '@/stores/ui'
import './ComingSoonDialog.css'

export default function ComingSoonDialog() {
  const open = useUiStore((s) => s.comingSoonOpen)
  const close = useUiStore((s) => s.closeComingSoon)

  // Esc 关闭
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  if (!open) return null

  return createPortal(
    <div className="coming-soon-mask" onClick={close}>
      <div className="coming-soon-card" role="dialog" aria-label="功能待开放" onClick={(e) => e.stopPropagation()}>
        <div className="coming-soon-icon" aria-hidden="true">
          🚧
        </div>
        <div className="coming-soon-title">功能待开放</div>
        <div className="coming-soon-desc">该功能正在打磨中,敬请期待</div>
        <button type="button" className="coming-soon-btn" onClick={close}>
          我知道了
        </button>
      </div>
    </div>,
    document.body,
  )
}
