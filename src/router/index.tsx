/**
 * 路由表（react-router v7 data router）
 * 由原 vue-router 配置移植。受保护页的鉴权守卫在 App(AppShell) 中央处理；
 * 仅 /login 标记 handle.requiresAuth=false。
 */
import { lazy, Suspense } from 'react'
import type { ReactNode } from 'react'
import { createBrowserRouter, Navigate, useRouteError } from 'react-router-dom'
import App from '../App'

// 路由级错误边界：捕获 lazy chunk 加载失败（如部署后旧 chunk 失效、离线）或渲染抛错，
// 避免整页白屏无任何恢复入口。
function RouteErrorBoundary() {
  const error = useRouteError() as any
  return (
    <div
      role="alert"
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        style={{
          maxWidth: 420,
          textAlign: 'center',
          padding: 24,
          borderRadius: 12,
          border: '1px solid #eee',
          boxShadow: '0 8px 24px rgba(0,0,0,0.06)',
        }}
      >
        <strong style={{ fontSize: 16 }}>页面加载失败</strong>
        <p style={{ color: '#666', margin: '12px 0 16px' }}>
          {String(error?.message || error || '发生未知错误，请刷新重试')}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            padding: '8px 20px',
            borderRadius: 8,
            border: 'none',
            background: '#5767e5',
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          刷新重试
        </button>
      </div>
    </div>
  )
}

const SplashView = lazy(() => import('../views/SplashView'))
const LoginView = lazy(() => import('../views/LoginView'))
const HomeView = lazy(() => import('../views/HomeView'))
const TemplatesView = lazy(() => import('../views/TemplatesView'))
const SmartCreateView = lazy(() => import('../views/SmartCreateView'))
const HotCopyView = lazy(() => import('../views/HotCopyView'))
const ProjectManagementView = lazy(() => import('../views/ProjectManagementView'))
const ProjectVideoListView = lazy(() => import('../views/ProjectVideoListView'))
const ProjectVideoDetailView = lazy(() => import('../views/ProjectVideoDetailView'))
const ResourceManagementView = lazy(() => import('../views/ResourceManagementView'))
const WorkbenchView = lazy(() => import('../views/WorkbenchView'))

function lazyPage(node: ReactNode): ReactNode {
  return <Suspense fallback={<div className="route-loading" aria-label="加载中" />}>{node}</Suspense>
}

export const router = createBrowserRouter([
  {
    element: <App />,
    errorElement: <RouteErrorBoundary />,
    children: [
      { index: true, element: <Navigate to="/home" replace /> },
      { path: 'welcome', element: lazyPage(<SplashView />), handle: { requiresAuth: false } },
      { path: 'login', element: lazyPage(<LoginView />), handle: { requiresAuth: false } },
      { path: 'home', element: lazyPage(<HomeView />), handle: { requiresAuth: false } },
      { path: 'templates', element: lazyPage(<TemplatesView />), handle: { requiresAuth: false } },
      { path: 'workbench', element: lazyPage(<WorkbenchView />) },
      { path: 'smart', element: lazyPage(<SmartCreateView />), handle: { requiresAuth: false } },
      { path: 'smart/:id', element: lazyPage(<SmartCreateView />), handle: { requiresAuth: false } },
      { path: 'hot-copy', element: lazyPage(<HotCopyView />), handle: { requiresAuth: false } },
      { path: 'creative', element: <Navigate to="/smart" replace /> },
      { path: 'creative/blank', element: <Navigate to="/smart" replace /> },
      { path: 'creative/:id', element: <Navigate to="/smart" replace /> },
      { path: 'projects', element: lazyPage(<ProjectManagementView />) },
      { path: 'projects/:projectId/videos', element: lazyPage(<ProjectVideoListView />) },
      { path: 'projects/:projectId/videos/:videoId', element: lazyPage(<ProjectVideoDetailView />) },
      { path: 'resources', element: lazyPage(<ResourceManagementView />) },
      { path: '*', element: <Navigate to="/home" replace /> },
    ],
  },
])
