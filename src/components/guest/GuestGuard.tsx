/**
 * GuestGuard — 游客模式遮罩
 * 未登录用户可以浏览页面，但点击操作时弹出登录提示。
 */
import { useNavigate } from 'react-router-dom'
import { useConfirmDialog } from '@/composables/useToast'
import './GuestGuard.css'

const GUEST_KEY = 'zzh_guest_mode'

export function isGuestMode(): boolean {
  return sessionStorage.getItem(GUEST_KEY) === '1'
}

export function setGuestMode(): void {
  sessionStorage.setItem(GUEST_KEY, '1')
}

export function clearGuestMode(): void {
  sessionStorage.removeItem(GUEST_KEY)
}

export default function GuestGuard() {
  const navigate = useNavigate()
  const { requestConfirm } = useConfirmDialog()

  const handleClick = async () => {
    const result = await requestConfirm('登录后即可使用全部功能', {
      title: '需要登录',
      confirmLabel: '去登录',
      cancelLabel: '取消',
    })
    if (result) {
      clearGuestMode()
      navigate('/login')
    }
  }

  return (
    <div className="guest-guard" onClick={handleClick}>
      <div className="guest-guard-hint">
        <span>点击任意位置登录，解锁全部功能</span>
      </div>
    </div>
  )
}
