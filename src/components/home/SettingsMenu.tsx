/**
 * SettingsMenu — 侧栏底部「设置」项。点击弹出菜单:个人中心 / 修改密码 / 退出登录
 * (对齐 Figma「我的-详情」1378:8885)。个人中心打开资料弹窗;修改密码/退出登录
 * 复用顶栏右上角同一套逻辑(ChangePasswordModal + useLogout)。
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LockOutlined, LogoutOutlined, UserOutlined } from '@ant-design/icons'
import ChangePasswordModal from '@/components/auth/ChangePasswordModal'
import PersonalCenterModal from '@/components/layout/PersonalCenterModal'
import { useLogout } from '@/composables/useLogout'
import { useConfirmDialog } from '@/composables/useToast'
import settingsIcon from '@/assets/sidebar/settings.svg'
import './SettingsMenu.css'

/** 侧栏设置入口图标。 */
const IconSettings = (
  <img className="app-sidebar__icon-img" src={settingsIcon} alt="" width={14} height={14} aria-hidden="true" />
)
/** 个人中心菜单图标。 */
const IconProfile = <UserOutlined className="settings-menu__ico-vector" aria-hidden="true" />

/** 修改密码菜单图标。 */
const IconLock = <LockOutlined className="settings-menu__ico-vector" aria-hidden="true" />

/** 退出登录菜单图标。 */
const IconLogout = <LogoutOutlined className="settings-menu__ico-vector" aria-hidden="true" />

/** 设置菜单完成一个动作后的可选收尾回调。 */
interface SettingsMenuProps {
  /** 移动端抽屉:选中菜单项后请求收起抽屉 */
  onAfterAction?: () => void
}

/** 管理设置菜单锚点、弹层焦点及个人中心、改密、退出三个动作。 */
export default function SettingsMenu({ onAfterAction }: SettingsMenuProps) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const [pwdOpen, setPwdOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const wasOpenRef = useRef(false)
  const logoutConfirmRef = useRef(false)
  const { logout, isLoggingOut } = useLogout()
  const { requestConfirm } = useConfirmDialog()

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
    if (!open) {
      if (wasOpenRef.current) btnRef.current?.focus()
      wasOpenRef.current = false
      return
    }
    wasOpenRef.current = true
    popRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus()
    function onDown(e: PointerEvent) {
      const t = e.target as Node
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return
      setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
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
  const doLogout = async () => {
    if (logoutConfirmRef.current || isLoggingOut) return
    logoutConfirmRef.current = true
    setOpen(false)
    try {
      const confirmed = await requestConfirm('退出后需要重新登录,确认退出当前账号吗？', {
        title: '退出登录',
        confirmLabel: '确认退出',
        danger: true,
      })
      if (!confirmed) return
      onAfterAction?.()
      await logout()
    } finally {
      logoutConfirmRef.current = false
    }
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`app-sidebar__item${open ? ' is-active' : ''}`}
        aria-haspopup="menu"
        aria-controls="settings-popup-menu"
        aria-expanded={open}
        onClick={toggle}
      >
        <span className="app-sidebar__icon">{IconSettings}</span>
        <span className="app-sidebar__label">设置</span>
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            id="settings-popup-menu"
            ref={popRef}
            className="settings-menu"
            role="menu"
            aria-label="设置菜单"
            style={{ left: pos.left, top: pos.top }}
          >
            <button type="button" className="settings-menu__item" role="menuitem" onClick={openProfile}>
              <span className="settings-menu__ico settings-menu__ico--blue">{IconProfile}</span>
              <span className="settings-menu__label">个人中心</span>
            </button>
            <button type="button" className="settings-menu__item" role="menuitem" onClick={openPwd}>
              <span className="settings-menu__ico settings-menu__ico--green">{IconLock}</span>
              <span className="settings-menu__label">修改密码</span>
            </button>
            <button
              type="button"
              className="settings-menu__item"
              role="menuitem"
              onClick={() => void doLogout()}
              disabled={isLoggingOut}
            >
              <span className="settings-menu__ico settings-menu__ico--red">{IconLogout}</span>
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
