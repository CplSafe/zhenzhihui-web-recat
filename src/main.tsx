import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import 'normalize.css'
import './style.css'
import { router } from './router'
import { initObservability } from './observability/openobserve-logger'

// 统一日志:尽早初始化,捕获 console 报错/未捕获异常/用户行为 → OpenObserve。
// 未配置 VITE_O2_* 时内部自动跳过,不影响业务。
initObservability()

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#5767e5' } }}>
      <RouterProvider router={router} />
    </ConfigProvider>
  </StrictMode>,
)
