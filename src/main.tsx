import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import 'normalize.css'
import './style.css'
import { router } from './router'

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#5767e5' } }}>
      <RouterProvider router={router} />
    </ConfigProvider>
  </StrictMode>,
)
