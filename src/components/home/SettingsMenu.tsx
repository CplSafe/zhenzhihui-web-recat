/**
 * SettingsMenu — 侧栏底部「设置」项。点击弹出菜单:个人中心 / 修改密码 / 退出登录
 * (对齐 Figma「我的-详情」1378:8885)。个人中心打开资料弹窗;修改密码/退出登录
 * 复用顶栏右上角同一套逻辑(ChangePasswordModal + useLogout)。
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ChangePasswordModal from '@/components/auth/ChangePasswordModal'
import PersonalCenterModal from '@/components/layout/PersonalCenterModal'
import { useLogout } from '@/composables/useLogout'
import lockIcon from '@/assets/f0664ce9dc6df70f76c69f9c034a047c.png'
import logoutIcon from '@/assets/149cc9cc4f85b48451edcb6fa468dff0.png'
import './SettingsMenu.css'

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}
const IconSettings = (
  <svg viewBox="0 0 24 24" width="18" height="18" {...stroke}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
  </svg>
)
// 个人中心 / 退出登录 共用「退出箭头」图标;修改密码 用「锁」图标(均为 PNG)
const IconLockImg = <img className="settings-menu__ico-img" src={lockIcon} alt="" aria-hidden="true" />
const IconLogoutImg = <img className="settings-menu__ico-img" src={logoutIcon} alt="" aria-hidden="true" />

interface SettingsMenuProps {
  /** 移动端抽屉:选中菜单项后请求收起抽屉 */
  onAfterAction?: () => void
}

export default function SettingsMenu({ onAfterAction }: SettingsMenuProps) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const [pwdOpen, setPwdOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const { logout, isLoggingOut } = useLogout()

  // 菜单向上展开(设置项在侧栏底部):菜单底边对齐按钮顶边上方 8px。用 portal 避免被侧栏裁切。
  const toggle = () => {
    setOpen((v) => {
      const next = !v
      if (next && btnRef.current) {
        const r = btnRef.current.getBoundingClientRect()
        setPos({ left: r.left, top: r.top - 8 })
      }
      return next
    })
  }

  useEffect(() => {
    if (!open) return
    function onDown(e: PointerEvent) {
      const t = e.target as Node
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return
      setOpen(false)
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [open])

  const openProfile = () => {
    setOpen(false)
    setProfileOpen(true)
    onAfterAction?.()
  }
  const openPwd = () => {
    setOpen(false)
    setPwdOpen(true)
    onAfterAction?.()
  }
  const doLogout = () => {
    setOpen(false)
    onAfterAction?.()
    void logout()
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`app-sidebar__item${open ? ' is-active' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        <span className="app-sidebar__icon">{IconSettings}</span>
        <span className="app-sidebar__label">设置</span>
      </button>

      {open &&
        pos &&
        createPortal(
          <div ref={popRef} className="settings-menu" role="menu" style={{ left: pos.left, top: pos.top }}>
            <button type="button" className="settings-menu__item" role="menuitem" onClick={openProfile}>
              <span className="settings-menu__ico settings-menu__ico--blue">{IconLogoutImg}</span>
              <span className="settings-menu__label">个人中心</span>
            </button>
            <button type="button" className="settings-menu__item" role="menuitem" onClick={openPwd}>
              <span className="settings-menu__ico settings-menu__ico--green">{IconLockImg}</span>
              <span className="settings-menu__label">修改密码</span>
            </button>
            <button
              type="button"
              className="settings-menu__item"
              role="menuitem"
              onClick={doLogout}
              disabled={isLoggingOut}
            >
              <span className="settings-menu__ico settings-menu__ico--red">{IconLogoutImg}</span>
              <span className="settings-menu__label">{isLoggingOut ? '退出中…' : '退出登录'}</span>
            </button>
          </div>,
          document.body,
        )}

      {profileOpen && <PersonalCenterModal onClose={() => setProfileOpen(false)} />}
      {pwdOpen && <ChangePasswordModal onClose={() => setPwdOpen(false)} />}
    </>
  )
}
