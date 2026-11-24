import { useLogout } from '@/composables/useLogout'

export default function AccountSwitchBanner({ name, expired = false }: { name?: string; expired?: boolean }) {
  const { logout, isLoggingOut } = useLogout()

  return (
    <section
      className={`account-switch-banner${expired ? ' account-switch-banner--expired' : ''}`}
      aria-label="用户身份切换"
    >
      <strong>{expired ? '用户身份切换已失效' : name ? `当前以 ${name} 的身份操作` : '用户身份切换'}</strong>
      <button type="button" onClick={() => void logout()} disabled={isLoggingOut}>
        {isLoggingOut ? '正在退出…' : '退出身份切换'}
      </button>
    </section>
  )
}
