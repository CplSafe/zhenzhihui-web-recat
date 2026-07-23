/**
 * 模块职责：集中声明应用页面路由、懒加载边界，以及创作页在项目/工作空间变化时的实例隔离规则。
 * 页面效果：游客从根路径进入开屏页，已有会话标记的用户进入首页；未知地址回退首页，异步页面加载失败时提供刷新入口。
 * 鉴权边界：AppShell 根据 handle.requiresAuth 统一保护项目、素材、团队等页面；首页、模板和创作浏览页允许游客进入，具体生成动作在页面内鉴权。
 * 状态边界：智能成片仅在“首次建项绑定当前会话”时保留实例，切项目、切工作空间或显式新建时重挂载，避免不同创作之间串状态。
 */
import { lazy, Suspense, useState } from 'react'
import type { ReactNode } from 'react'
import { createBrowserRouter, Navigate, useLocation, useParams, useRouteError } from 'react-router-dom'
import App from '../App'
import { hasAuthSessionMarker } from '../api/auth'
import { useWorkspaceId } from '../stores/workspaceSession'
import WorkspaceSwitchBridge from './WorkspaceSwitchBridge'

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

/** 品牌开屏页路由组件。 */
const SplashView = lazy(() => import('../views/SplashView'))
/** 统一登录页路由组件。 */
const LoginView = lazy(() => import('../views/LoginView'))
/** 产品首页路由组件。 */
const HomeView = lazy(() => import('../views/HomeView'))
/** 模板库路由组件。 */
const TemplatesView = lazy(() => import('../views/TemplatesView'))
/** 智能成片创作路由组件。 */
const SmartCreateView = lazy(() => import('../views/SmartCreateView'))
/** 爆款复制创作路由组件。 */
const HotCopyCreateView = lazy(() => import('../views/HotCopyCreateView'))
/** 项目管理路由组件。 */
const ProjectManagementView = lazy(() => import('../views/ProjectManagementView'))
/** 项目视频列表路由组件。 */
const ProjectVideoListView = lazy(() => import('../views/ProjectVideoListView'))
/** 项目视频详情路由组件。 */
const ProjectVideoDetailView = lazy(() => import('../views/ProjectVideoDetailView'))
/** 我的素材路由组件。 */
const ResourceManagementView = lazy(() => import('../views/ResourceManagementView'))
/** 团队数据看板路由组件。 */
const SpaceDashboardView = lazy(() => import('../views/SpaceDashboardView'))

/** 智能成片路由 state 中使用的一次性建项、重启和空间切换标记。 */
interface SmartRouteState {
  smartCreationBindProjectId?: number | string
  smartCreationBindSessionToken?: string
  smartCreationBindWorkspaceId?: number | string
  taskCenterNewSession?: boolean
  workspaceSwitchReset?: boolean
  restartProjectId?: number | string
}

/** 用于决定 SmartCreateView 是否需要重挂载的路由会话快照。 */
interface SmartRouteSession {
  workspaceId: number
  projectId: string
  version: number
  locationKey: string
  mountNonce: string
}

// mountNonce 标识本次组件实例，version 标识同一实例下需要隔离状态的路由会话。
let smartRouteMountSequence = 0
/** 创建当前浏览器实例内唯一的智能成片挂载标识。 */
function createSmartRouteMountNonce(): string {
  smartRouteMountSequence += 1
  return globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${smartRouteMountSequence.toString(36)}`
}

/** 把挂载标识与版本组合为可传给创作页的稳定会话令牌。 */
function getSmartRouteSessionToken(session: SmartRouteSession): string {
  return `${session.mountNonce}:${session.version}`
}

/** 根据项目、空间和导航意图决定复用当前创作实例还是递增版本重挂载。 */
function resolveSmartRouteSession(
  current: SmartRouteSession,
  input: { workspaceId: number; projectId: string; locationKey: string; routeState: SmartRouteState },
): SmartRouteSession {
  // 首次创建后从 /smart 绑定到 /smart/:id 属于同一会话；其余项目、空间或新建信号都应提升 version。
  const { workspaceId, projectId, locationKey, routeState } = input
  const creationBindProjectId = String(routeState.smartCreationBindProjectId || '')
  const creationBindSessionToken = String(routeState.smartCreationBindSessionToken || '')
  const creationBindWorkspaceId = Number(routeState.smartCreationBindWorkspaceId || 0)
  const isCurrentCreationBinding =
    !current.projectId &&
    !!projectId &&
    creationBindProjectId === projectId &&
    creationBindWorkspaceId === workspaceId &&
    creationBindSessionToken === getSmartRouteSessionToken(current)
  const isExplicitNewSessionNavigation =
    !current.projectId &&
    !projectId &&
    current.locationKey !== locationKey &&
    !!(routeState.taskCenterNewSession || routeState.workspaceSwitchReset || routeState.restartProjectId)

  if (
    current.workspaceId !== workspaceId ||
    (current.projectId !== projectId && !isCurrentCreationBinding) ||
    isExplicitNewSessionNavigation
  ) {
    return {
      ...current,
      workspaceId,
      projectId,
      version: current.version + 1,
      locationKey,
    }
  }
  if (isCurrentCreationBinding) {
    return { ...current, projectId, locationKey }
  }
  if (current.locationKey !== locationKey) return { ...current, locationKey }
  return current
}

/** 为智能成片提供工作空间隔离和首次建项保活的路由包装。 */
function WorkspaceScopedSmartCreateRoute() {
  const workspaceId = useWorkspaceId()
  const { id } = useParams()
  const location = useLocation()
  const ws = Number(workspaceId || 0)
  const projectId = String(id || '')
  const routeState = (location.state || {}) as SmartRouteState
  const [routeSession, setRouteSession] = useState<SmartRouteSession>(() => ({
    workspaceId: ws,
    projectId,
    version: 0,
    locationKey: location.key,
    mountNonce: createSmartRouteMountNonce(),
  }))
  const nextRouteSession = resolveSmartRouteSession(routeSession, {
    workspaceId: ws,
    projectId,
    locationKey: location.key,
    routeState,
  })

  // /smart 首次建项后会 replace 到 /smart/:id。这个变化只是给当前创作绑定后端项目，
  // 不能销毁 SmartCreateView，否则已经启动的脚本 / SKILL / 图片 / 素材落库请求会失去接收者。
  // 只有 navigate 携带且匹配本次创作会话、项目 id 的专用标记才允许保活；历史项目跳转必须重挂载加载。
  // 已绑定项目后再切到另一个项目（或返回新建页）、切换工作空间、显式新建会话时也换 key 隔离状态。
  if (nextRouteSession !== routeSession) {
    setRouteSession(nextRouteSession)
    return null
  }

  return (
    <SmartCreateView
      key={`smart-route-session-${routeSession.version}`}
      routeSessionToken={getSmartRouteSessionToken(routeSession)}
    />
  )
}

/** 用工作空间和项目 id 作为 key，隔离不同爆款复制会话。 */
function WorkspaceScopedHotCopyRoute() {
  // 爆款复制没有智能成片的首次绑定协议，项目或工作空间变化时直接通过 key 创建干净实例。
  const workspaceId = useWorkspaceId()
  const { id } = useParams()
  return <HotCopyCreateView key={`hot-copy-ws-${Number(workspaceId || 0)}-project-${id || 'new'}`} />
}

/** 为懒加载页面统一提供无布局抖动的加载占位。 */
function lazyPage(node: ReactNode): ReactNode {
  // 所有页面级动态模块共用一致的加载占位，错误则由上层 RouteErrorBoundary 接管。
  return <Suspense fallback={<div className="route-loading" aria-label="加载中" />}>{node}</Suspense>
}

// 已登录(本地标记)用户不进开屏页,直接去首页;游客才看开屏。
// 同步读 localStorage 标记,避免异步会话检查前先闪一帧开屏;全程 replace,不在历史里留开屏/根路径条目。
function IndexRedirect() {
  return <Navigate to={hasAuthSessionMarker() ? '/home' : '/welcome'} replace />
}
/** 已登录用户跳过开屏页，游客才渲染品牌欢迎页。 */
function WelcomeRoute() {
  if (hasAuthSessionMarker()) return <Navigate to="/home" replace />
  return <>{lazyPage(<SplashView />)}</>
}

/** 应用唯一的浏览器路由实例。 */
export const router = createBrowserRouter([
  {
    // AppShell 提供全局布局、会话守卫和全局弹层；各业务页面作为它的子路由渲染。
    element: <App />,
    errorElement: <RouteErrorBoundary />,
    children: [
      // index 必须免鉴权,否则未登录访问根路径会被中央守卫先重定向到 /login,
      // 轮不到 IndexRedirect 跳 /welcome(开屏页)。
      { index: true, element: <IndexRedirect />, handle: { requiresAuth: false } },
      { path: 'welcome', element: <WelcomeRoute />, handle: { requiresAuth: false } },
      { path: 'login', element: lazyPage(<LoginView />), handle: { requiresAuth: false } },
      { path: 'home', element: lazyPage(<HomeView />), handle: { requiresAuth: false } },
      { path: 'templates', element: lazyPage(<TemplatesView />), handle: { requiresAuth: false } },
      // 智能成片 / 爆款复制:免登录可进入并交互,仅「生成」动作需登录(组件内拦截)
      { path: 'smart/:id?', element: lazyPage(<WorkspaceScopedSmartCreateRoute />), handle: { requiresAuth: false } },
      { path: 'hot-copy', element: lazyPage(<WorkspaceScopedHotCopyRoute />), handle: { requiresAuth: false } },
      { path: 'hot-copy/:id', element: lazyPage(<WorkspaceScopedHotCopyRoute />), handle: { requiresAuth: false } },
      { path: 'workspace-switch', element: <WorkspaceSwitchBridge />, handle: { requiresAuth: false } },
      // 未显式标记 requiresAuth:false 的页面默认由 AppShell 要求有效会话。
      { path: 'projects', element: lazyPage(<ProjectManagementView />) },
      { path: 'projects/:projectId/videos', element: lazyPage(<ProjectVideoListView />) },
      { path: 'projects/:projectId/videos/:videoId', element: lazyPage(<ProjectVideoDetailView />) },
      { path: 'resources', element: lazyPage(<ResourceManagementView />) },
      { path: 'team', element: lazyPage(<SpaceDashboardView />) },
      { path: '*', element: <Navigate to="/home" replace />, handle: { requiresAuth: false } },
    ],
  },
])
