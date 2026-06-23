/**
 * 模板库页面（占位 stub）。
 * 「查看更多」从首页跳转至此,用于展示全部模板视频。
 * TODO(彭骏): 接后端模板列表(热度>时间倒序、分页/瀑布流),完善筛选与「做同款」。
 */
import { useNavigate } from 'react-router-dom'
import AppSidebar from '@/components/home/AppSidebar'
import './HomeView.css'

const ROUTE_MAP: Record<string, string> = {
  home: '/home',
  creative: '/smart',
  projects: '/projects',
  resources: '/resources',
}

export default function TemplatesView() {
  const navigate = useNavigate()
  const onNavigate = (key: string) => {
    const path = ROUTE_MAP[key]
    if (path) navigate(path)
  }
  return (
    <div className="home">
      <AppSidebar activeKey="home" onNavigate={onNavigate} />
      <div className="home__main">
        <header className="home__topbar">
          <button type="button" className="home__more-btn" onClick={() => navigate('/home')}>
            返回首页
          </button>
        </header>
        <div className="home__content">
          <h2 className="home__section-title" style={{ fontSize: 22, marginBottom: 16 }}>
            模板库
          </h2>
          <div className="home__placeholder">模板库页面建设中，敬请期待</div>
        </div>
      </div>
    </div>
  )
}
