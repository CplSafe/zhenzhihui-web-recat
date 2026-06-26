/**
 * MemberCenterView — 会员中心(独立页面)。
 * 复用 MemberCenterModal 的全部逻辑(套餐 / 续费 / 积分充值 / 直跳支付宝支付),以 embedded 模式内联渲染,
 * 由本页提供 AppSidebar + AppTopbar 页面外壳。
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AppSidebar from '@/components/home/AppSidebar'
import AppTopbar from '@/components/layout/AppTopbar'
import AppToast from '@/components/AppToast'
import MemberCenterModal from '@/components/MemberCenterModal'
import './MemberCenterView.css'

const ROUTE_MAP: Record<string, string> = {
  home: '/home',
  creative: '/smart',
  'hot-copy': '/hot-copy',
  projects: '/projects',
  resources: '/resources',
  templates: '/templates',
}

export default function MemberCenterView() {
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="mcv-page">
      <AppToast />
      <AppSidebar
        activeKey=""
        onNavigate={(key) => {
          const path = ROUTE_MAP[key]
          if (path) navigate(path)
        }}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <div className="mcv-shell">
        <AppTopbar onMenu={() => setSidebarOpen(true)} />
        <main className="mcv-main">
          <MemberCenterModal open embedded onClose={() => navigate('/home')} />
        </main>
      </div>
    </div>
  )
}
