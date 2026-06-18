/**
 * 路由表（react-router v7 data router）
 * 由原 vue-router 配置移植。受保护页的鉴权守卫在 App(AppShell) 中央处理；
 * 仅 /login 标记 handle.requiresAuth=false。
 */
import { lazy, Suspense } from 'react'
import type { ReactNode } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import App from '../App'

const LoginView = lazy(() => import('../views/LoginView'))
const CreativeEntryView = lazy(() => import('../views/CreativeEntryView'))
const CreativeScriptView = lazy(() => import('../views/CreativeScriptView'))
const ProjectManagementView = lazy(() => import('../views/ProjectManagementView'))
const ResourceManagementView = lazy(() => import('../views/ResourceManagementView'))
const WorkbenchView = lazy(() => import('../views/WorkbenchView'))

function lazyPage(node: ReactNode): ReactNode {
  return <Suspense fallback={<div className="route-loading" aria-label="加载中" />}>{node}</Suspense>
}

export const router = createBrowserRouter([
  {
    element: <App />,
    children: [
      { index: true, element: <Navigate to="/creative" replace /> },
      { path: 'login', element: lazyPage(<LoginView />), handle: { requiresAuth: false } },
      { path: 'workbench', element: lazyPage(<WorkbenchView />) },
      { path: 'creative/blank', element: lazyPage(<CreativeScriptView />) },
      { path: 'creative', element: lazyPage(<CreativeEntryView />) },
      { path: 'creative/:id', element: lazyPage(<CreativeScriptView />) },
      { path: 'projects', element: lazyPage(<ProjectManagementView />) },
      { path: 'resources', element: lazyPage(<ResourceManagementView />) },
      { path: '*', element: <Navigate to="/creative" replace /> },
    ],
  },
])
