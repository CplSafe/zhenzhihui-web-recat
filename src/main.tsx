/**
 * 应用入口：挂载 React 根节点、全局中文 UI 主题和路由，并在首屏完成后延迟初始化可观测性。
 */
import './polyfills'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import 'normalize.css'
import './style.css'
import { router } from './router'

/** 兼容未原生声明 requestIdleCallback 的浏览器 Window 类型。 */
type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
}

/** 把可选日志 SDK 的下载与初始化移出首屏关键渲染路径。 */
function scheduleObservability(): void {
  if (!import.meta.env.VITE_O2_CLIENT_TOKEN || !import.meta.env.VITE_O2_SITE) return

  const start = () => {
    void import('./observability/openobserve-logger')
      .then(({ initObservability }) => initObservability())
      .catch(() => undefined)
  }
  const idleWindow = window as IdleWindow
  if (typeof idleWindow.requestIdleCallback === 'function') {
    idleWindow.requestIdleCallback(start, { timeout: 2000 })
    return
  }
  window.setTimeout(start, 1200)
}

// 全局组件只在此处挂载一次，页面内容交由 data router 按路由懒加载。
createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#5767e5' } }}>
      <RouterProvider router={router} />
    </ConfigProvider>
  </StrictMode>,
)

scheduleObservability()
