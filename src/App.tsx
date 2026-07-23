/**
 * 应用根布局：管理鉴权守卫、工作空间失效过渡，并挂载全局任务中心、弹窗、提示和新手引导。
 * 路由页面通过 <Outlet/> 渲染，跨页面单例只在这里挂载一次。
 */
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Outlet, useLocation, useMatches, useNavigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthContext'
import AppToast from './components/AppToast'
import AppConfirmDialog from './components/AppConfirmDialog'
import { useSafeWorkspaceSwitch } from './composables/useSafeWorkspaceSwitch'
import { useGuideStore } from './stores/guide'
import { useUiStore } from './stores/ui'
import { deriveWorkspaceId, useWorkspaceSessionStore } from './stores/workspaceSession'
import { captureInviteCode } from './utils/inviteCode'
import './App.css'

/** 登录后按需加载的帮助中心悬浮入口。 */
const HelpCenter = lazy(() => import('./components/common/HelpCenter'))
/** 按需加载的新手引导聚光覆盖层。 */
const GuideOverlay = lazy(() => import('./components/guide/GuideOverlay'))
/** 按需加载的会员中心全局弹窗。 */
const MemberCenterModal = lazy(() => import('./components/MemberCenterModal'))
/** 按需加载的团队管理全局弹窗。 */
const GlobalTeamManageModal = lazy(() => import('./components/team/GlobalTeamManageModal'))
/** 按需加载的加入团队全局弹窗。 */
const GlobalJoinTeamDialog = lazy(() => import('./components/team/GlobalJoinTeamDialog'))
/** 按需加载的“功能待开放”全局提示。 */
const ComingSoonDialog = lazy(() => import('./components/ComingSoonDialog'))
/** 按需加载的全局视频任务恢复协调器。 */
const TaskCenterCoordinator = lazy(() => import('./components/task/TaskCenterCoordinator'))

// 退出登录标记：dev 模式下 AuthContext 用 mock session 绕过 API 检查，
// 此时主动退出需清除 mock 标记，让守卫正常跳转到 /login。
export const DEV_LOGOUT_FLAG = '__zzh_dev_logout__'
/** 开发环境记录主动退出，阻止 mock 会话在下一次检查时自动恢复。 */
export function markDevLogout() {
  ;(window as any)[DEV_LOGOUT_FLAG] = true
}

/**
 * 处理后台空间列表刷新发现的访问权变化。
 * store 会暂时保留已失效的源空间；该桥接组件先安全卸载创作页，再从会话中移除空间，
 * 让所有刷新入口都遵守同一套草稿防误写规则。
 */
export function WorkspaceRefreshTransitionBridge() {
  const pendingTransition = useWorkspaceSessionStore((state) => state.pendingWorkspaceTransition)
  const switchWorkspaceSafely = useSafeWorkspaceSwitch()
  const processingRef = useRef(false)
  const [drainVersion, setDrainVersion] = useState(0)

  useEffect(() => {
    if (!pendingTransition || processingRef.current) return
    processingRef.current = true
    let started = false

    // 安全切换依赖同步桥接导航先卸载旧创作页；effect 执行期间 React 无法可靠立刻 flush，
    // 因此把切换放到下一个宏任务，模拟用户事件边界。
    const timer = window.setTimeout(() => {
      started = true
      const latest = useWorkspaceSessionStore.getState().pendingWorkspaceTransition
      if (!latest || latest.removedWorkspaceId !== pendingTransition.removedWorkspaceId) {
        processingRef.current = false
        return
      }

      const removedWorkspaceId = latest.removedWorkspaceId
      let leftRemovedWorkspace = deriveWorkspaceId(useWorkspaceSessionStore.getState()) !== removedWorkspaceId

      if (!leftRemovedWorkspace) {
        try {
          const switched = switchWorkspaceSafely(latest.workspaceId, {
            sourceWorkspace: latest.sourceWorkspace,
            // 源空间权限已经撤销，生成租约不能继续把应用锁在用户已不属于的空间。
            allowLockedTransition: true,
            suppressLockedToast: true,
          })
          leftRemovedWorkspace =
            switched || deriveWorkspaceId(useWorkspaceSessionStore.getState()) !== removedWorkspaceId
        } catch {
          leftRemovedWorkspace = false
        }
      }

      if (!leftRemovedWorkspace) {
        processingRef.current = false
        return
      }

      const consumed = useWorkspaceSessionStore.getState().consumePendingWorkspaceTransition(removedWorkspaceId)
      if (!consumed) {
        processingRef.current = false
        return
      }

      void useWorkspaceSessionStore
        .getState()
        .finalizeWorkspaceRemoval(removedWorkspaceId)
        .finally(() => {
          processingRef.current = false
          // 收尾期间的刷新可能继续加入空间移除任务，本地版本号负责触发下一轮排空。
          setDrainVersion((version) => version + 1)
        })
    }, 0)

    return () => {
      if (started) return
      window.clearTimeout(timer)
      processingRef.current = false
    }
  }, [drainVersion, pendingTransition, switchWorkspaceSafely])

  return null
}

/** 根据当前路由和会话状态渲染业务页面，并承载所有全局单例 UI。 */
export function AppShell() {
  const navigate = useNavigate()
  const location = useLocation()
  const matches = useMatches()
  const { isAuthenticated, isCheckingSession, authCheckError, loadAuthSession } = useAuth()

  // 会员中心:全局单例弹窗,任意页面顶栏点「会员中心」均可唤出(取代原 /membership 路由页)。
  const memberCenterOpen = useUiStore((s) => s.memberCenterOpen)
  const closeMemberCenter = useUiStore((s) => s.closeMemberCenter)
  const teamManageOpen = useUiStore((s) => s.teamManageOpen)
  const joinTeamOpen = useUiStore((s) => s.joinTeamOpen)
  const comingSoonOpen = useUiStore((s) => s.comingSoonOpen)
  const guideActive = useGuideStore((s) => Boolean(s.activeKey))

  const requiresAuth = !matches.some((m) => (m.handle as any)?.requiresAuth === false)
  const protectedRouteDenied = requiresAuth && !isAuthenticated

  // 首次会话检查是否已完成。完成后:后台续期/再校验(focus / 定时)即使再把 isCheckingSession 翻 true,
  // 也【不再卸载页面】——否则当前页会被换成空白 loading 再挂回,导致正在进行的点击丢失(点一下"刷新"、要点两次)。
  // 真的失效(isAuthenticated 变 false)由下方守卫跳登录处理,而不是闪白整页。
  const [hasChecked, setHasChecked] = useState(false)
  useEffect(() => {
    // 仅在「检查结束且无错误」(即首次成功渲染过页面)后置位;首次失败保持 false 以便展示错误卡 + 重试。
    if (!isCheckingSession && !authCheckError) setHasChecked(true)
  }, [isCheckingSession, authCheckError])

  // 进站即捕获分享链接里的推广邀请码(/login?invite_code=…),存起来供后续注册使用,避免路由跳转丢 query。
  useEffect(() => {
    captureInviteCode()
  }, [])

  useEffect(() => {
    if (isCheckingSession) return
    if (authCheckError) return

    // 受保护页(项目管理 / 素材市场等)未登录 → 直接去登录页(「需登录」)。
    // 不再用全屏游客遮罩(它会盖住侧边栏导致无法切换其它菜单)。
    if (requiresAuth && !isAuthenticated) {
      navigate('/login', { replace: true })
      return
    }
    if (!requiresAuth && isAuthenticated && (location.pathname === '/login' || location.pathname === '/welcome')) {
      navigate('/home', { replace: true })
    }
  }, [isAuthenticated, isCheckingSession, authCheckError, requiresAuth, location.pathname, navigate])

  return (
    <>
      <WorkspaceRefreshTransitionBridge />

      {!hasChecked && isCheckingSession ? (
        <div className="auth-session-loading" aria-label="登录状态检查中" />
      ) : !hasChecked && authCheckError && requiresAuth ? (
        <div className="auth-session-error">
          <div className="auth-session-error__card">
            <strong>登录状态检查失败</strong>
            <p>{authCheckError}</p>
            <div className="auth-session-error__actions">
              <button type="button" onClick={() => loadAuthSession()}>
                重新检查
              </button>
              <button type="button" className="ghost" onClick={() => navigate('/welcome', { replace: true })}>
                前往开屏页
              </button>
            </div>
          </div>
        </div>
      ) : protectedRouteDenied ? (
        <div className="auth-session-loading" aria-label="正在跳转登录页" />
      ) : (
        <Outlet />
      )}

      {/* 页面卸载/刷新后的 AI 视频任务恢复与全局完成提醒。 */}
      {isAuthenticated && hasChecked ? (
        <Suspense fallback={null}>
          <TaskCenterCoordinator />
        </Suspense>
      ) : null}

      {/* 会员中心全局弹窗:最高优先级全屏遮罩 + 右上角 X 关闭,任意页面可唤出 */}
      {memberCenterOpen ? (
        <Suspense fallback={null}>
          <MemberCenterModal open onClose={closeMemberCenter} />
        </Suspense>
      ) : null}

      {/* 团队管理全局弹窗:侧栏「邀请成员」等处唤出,任意 2.1 页面可弹 */}
      {teamManageOpen ? (
        <Suspense fallback={null}>
          <GlobalTeamManageModal />
        </Suspense>
      ) : null}

      {/* 加入空间全局弹窗:侧栏「加入空间」唤出 */}
      {joinTeamOpen ? (
        <Suspense fallback={null}>
          <GlobalJoinTeamDialog />
        </Suspense>
      ) : null}

      {/* 「功能待开放」全局弹窗:任意页面点未上线项时统一弹出 */}
      {comingSoonOpen ? (
        <Suspense fallback={null}>
          <ComingSoonDialog />
        </Suspense>
      ) : null}

      <AppToast />
      <AppConfirmDialog />
      {/* 帮助中心悬浮球:登录后所有业务页都显示(含 requiresAuth:false 的 /smart、/hot-copy),登录/开屏页不显示。
          用 hasChecked 而非 !isCheckingSession —— 后台续期/再校验时不跟着闪、也不被卸载。 */}
      {isAuthenticated && hasChecked && location.pathname !== '/login' && location.pathname !== '/welcome' && (
        <Suspense fallback={null}>
          <HelpCenter />
        </Suspense>
      )}

      {/* 新手引导覆盖层:登录后由页面首次进入自动弹 / 帮助中心手动重看 */}
      {isAuthenticated && hasChecked && guideActive ? (
        <Suspense fallback={null}>
          <GuideOverlay />
        </Suspense>
      ) : null}
    </>
  )
}

/** 注入认证上下文的应用根组件。 */
export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  )
}
