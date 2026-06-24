/**
 * AppLayout — 主应用布局
 * 侧边栏 + 顶部导航 + 主内容区 + 全局弹窗（Billing/Team），所有登录后页面共用此布局。
 * 全局 Toast/Confirm 由顶层 App 单例挂载，本布局不再重复渲染。
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import BillingModal from '@/components/billing/BillingModal'
import CreativeSidebar from '@/components/creative/CreativeSidebar'
import WorkspaceTopbar from '@/components/creative/WorkspaceTopbar'
import CreateTeamDialog from './CreateTeamDialog'
import JoinTeamDialog from './JoinTeamDialog'
import TeamManagementModal from '@/components/team/TeamManagementModal'
import { getAuthErrorMessage, logoutSession } from '@/api/auth'
import { createWorkspaceInvitation, getBusinessErrorMessage } from '@/api/business'
import { useToast, useConfirmDialog } from '@/composables/useToast'
import { useUiStore } from '@/stores/ui'
import { shouldClearSessionAfterLogoutFailure } from '@/utils/workflowGuards'
import { loadLastCreativeProjectId } from '@/utils/creativeStorage'
import { markDevLogout } from '@/App'
import {
  useWorkspaceSessionStore,
  useCurrentUser,
  useCurrentWorkspace,
  useCurrentMember,
  useAllWorkspaces,
  useWorkspaceId,
  useCurrentPlanName,
  useCurrentPlanExpiresAt,
  useWalletCredits,
  usePlanBaseCredits,
} from '@/stores/workspaceSession'
import { useAuth } from '@/auth/AuthContext'
import './AppLayout.css'

const DESIGN_WIDTH = 1700
const DESIGN_HEIGHT = 900
const SIDEBAR_WIDTH = 220
const SIDEBAR_COLLAPSED_WIDTH = 72
const LIBRARY_WIDTH = 404

interface AppLayoutProps {
  // 当前页面高亮的导航项：分步创作画布默认 '分步创作'，素材市场页传 '素材市场'。
  activeNav?: string
  children?: ReactNode
  // 部分视图沿用旧 props 传参；AppLayout 内部经 useAuth() 取会话与登出，这些为可选兼容项。
  authSession?: any
  onLogoutSuccess?: () => void
}

export default function AppLayout(props: AppLayoutProps) {
  const { activeNav = '分步创作', children } = props

  const navigate = useNavigate()
  const location = useLocation()
  const { showToast } = useToast()
  const { requestConfirm } = useConfirmDialog()
  const { authSession, handleLogoutSuccess } = useAuth()

  // 工作空间 / 订阅 / 钱包 / 套餐 状态集中在 store，页面与外壳共享（不依赖组件层级）。
  const setAuthSession = useWorkspaceSessionStore((s) => s.setAuthSession)
  const loadSubscriptionLabel = useWorkspaceSessionStore((s) => s.loadSubscriptionLabel)
  const loadWorkspaces = useWorkspaceSessionStore((s) => s.loadWorkspaces)
  const switchWorkspaceAction = useWorkspaceSessionStore((s) => s.switchWorkspace)
  const createTeamAction = useWorkspaceSessionStore((s) => s.createTeam)
  const joinTeamAction = useWorkspaceSessionStore((s) => s.joinTeam)
  const deleteTeamAction = useWorkspaceSessionStore((s) => s.deleteTeam)

  const currentUser = useCurrentUser()
  const currentWorkspace = useCurrentWorkspace()
  const currentMember = useCurrentMember()
  const allWorkspaces = useAllWorkspaces()
  const workspaceId = useWorkspaceId()
  const currentPlanName = useCurrentPlanName()
  const currentPlanExpiresAt = useCurrentPlanExpiresAt()
  const walletCredits = useWalletCredits()
  const planBaseCredits = usePlanBaseCredits()

  // 全局脏状态（对应原 sharedDirtyState）。
  const dirty = useUiStore((s) => s.dirty)
  const setDirty = useUiStore((s) => s.setDirty)

  // authSession 注入 store（App → useAuth → store）。
  useEffect(() => {
    setAuthSession(authSession)
  }, [authSession, setAuthSession])

  const [viewportWidth, setViewportWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : DESIGN_WIDTH)
  const [viewportHeight, setViewportHeight] = useState(
    typeof window !== 'undefined' ? window.innerHeight : DESIGN_HEIGHT,
  )
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)

  const [billingOpen, setBillingOpen] = useState(false)
  const [billingTab, setBillingTab] = useState('plans')

  const [teamManagementOpen, setTeamManagementOpen] = useState(false)
  const [createTeamOpen, setCreateTeamOpen] = useState(false)
  const [isCreatingTeam, setIsCreatingTeam] = useState(false)
  const [createTeamInviteCode, setCreateTeamInviteCode] = useState('')
  const [createdTeamWorkspaceId, setCreatedTeamWorkspaceId] = useState(0)
  const [joinTeamOpen, setJoinTeamOpen] = useState(false)
  const [isJoiningTeam, setIsJoiningTeam] = useState(false)
  const [deleteTeamConfirmOpen, setDeleteTeamConfirmOpen] = useState(false)
  const [deletingWorkspace, setDeletingWorkspace] = useState(false)
  const [workspacePendingDelete, setWorkspacePendingDelete] = useState<any>(null)

  // 路由名映射：smart-workbench = /smart/:id（智能成片编辑页）
  const isCreativeWorkbench = useMemo(() => {
    const path = location.pathname
    return /^\/smart\/[^/]+$/.test(path)
  }, [location.pathname])
  const isCreativeEntry = useMemo(() => location.pathname === '/smart', [location.pathname])

  const isTabletViewport = viewportWidth <= 1280
  const isMobileViewport = viewportWidth <= 900
  const expandedSidebarWidth = useMemo(() => {
    if (isMobileViewport) {
      return SIDEBAR_COLLAPSED_WIDTH
    }
    if (isTabletViewport) {
      return Math.round(Math.min(Math.max(viewportWidth * 0.16, 184), 208))
    }
    return SIDEBAR_WIDTH
  }, [isMobileViewport, isTabletViewport, viewportWidth])
  const currentSidebarWidth = sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : expandedSidebarWidth
  const layoutWidth = viewportWidth
  const layoutHeight = Math.max(viewportHeight, DESIGN_HEIGHT)
  const libraryWidth = useMemo(() => {
    if (viewportWidth <= 1100) {
      return Math.round(Math.min(Math.max(viewportWidth * 0.3, 300), 360))
    }
    return LIBRARY_WIDTH
  }, [viewportWidth])
  const contentStageScale = useMemo(() => {
    const availableWidth = Math.max(layoutWidth - currentSidebarWidth, 0)
    const raw = availableWidth / 1264
    return Math.min(raw, 1.1).toFixed(4)
  }, [layoutWidth, currentSidebarWidth])

  const shellStyle = useMemo(
    () =>
      ({
        '--design-width': `${layoutWidth}px`,
        '--design-height': `${layoutHeight}px`,
        '--sidebar-width': `${currentSidebarWidth}px`,
        '--content-width': `${layoutWidth - currentSidebarWidth}px`,
        '--library-left': `${layoutWidth - libraryWidth}px`,
        '--library-width': `${libraryWidth}px`,
        '--content-stage-scale': contentStageScale,
      }) as any,
    [layoutWidth, layoutHeight, currentSidebarWidth, libraryWidth, contentStageScale],
  )

  const navSections = useMemo(
    () =>
      [
        {
          title: '创作',
          className: 'create-section',
          items: [
            { label: '工作台', icon: 'dashboard' },
            { label: '分步创作', icon: 'steps' },
            { label: '灵感创作', icon: 'spark' },
          ],
        },
        {
          title: '管理',
          className: 'manage-section',
          items: [
            { label: '项目管理', icon: 'folder' },
            { label: '素材市场', icon: 'shop' },
          ],
        },
      ].map((section) => ({
        ...section,
        items: section.items.map((item) => ({
          ...item,
          active: item.label === activeNav,
        })),
      })),
    [activeNav],
  )

  function openBilling(tab = 'plans') {
    setBillingTab(['plans', 'credits', 'ledgers', 'orders', 'admin'].includes(tab) ? tab : 'plans')
    setBillingOpen(true)
  }

  function openTeamManagement() {
    setTeamManagementOpen(true)
  }

  // 切换活跃空间：store 改 override，workspaceId 变化由下方 effect 统一刷新订阅/钱包。
  function switchWorkspace(id: any) {
    switchWorkspaceAction(id)
    if (isCreativeWorkbench || isCreativeEntry) {
      navigate('/smart', { replace: true })
    }
  }

  // 创建团队：输入名称 → store.createTeam（POST + 刷新列表 + 切换）→ toast。
  function openCreateTeam() {
    setCreateTeamInviteCode('')
    setCreatedTeamWorkspaceId(0)
    setCreateTeamOpen(true)
  }

  function openJoinTeam() {
    setJoinTeamOpen(true)
  }

  async function handleCreateTeamGenerateInvite(payload: { name?: string }) {
    if (isCreatingTeam) return
    const name = payload?.name?.trim?.() || ''
    if (!name) return
    setIsCreatingTeam(true)
    try {
      const created = await createTeamAction(name)
      const createdId = Number(created?.id || 0) || 0
      setCreatedTeamWorkspaceId(createdId)
      showToast('团队已创建', 'success')
      if (createdId) {
        const invitation = await createWorkspaceInvitation({
          workspaceId: createdId,
          expiryDays: 7,
          role: 'member',
        })
        const code = String(invitation?.code || '').trim()
        if (code) {
          setCreateTeamInviteCode(code)
          showToast('邀请码已生成', 'success')
        } else {
          showToast('邀请码生成失败：未返回 code', 'error')
        }
      }
    } catch (error: any) {
      showToast(getBusinessErrorMessage(error, error.message || '创建团队失败'), 'error')
    } finally {
      setIsCreatingTeam(false)
    }
  }

  function closeCreateTeamDialog() {
    setCreateTeamOpen(false)
    if (createdTeamWorkspaceId) {
      setTeamManagementOpen(true)
    }
  }

  function handleCreateTeamSubmit() {
    if (!createTeamInviteCode) return
    closeCreateTeamDialog()
  }

  async function handleJoinTeam(payload: { inviteCode?: string }) {
    if (isJoiningTeam) return
    const inviteCode = payload?.inviteCode?.trim?.() || ''
    if (!inviteCode) return
    setIsJoiningTeam(true)
    try {
      await joinTeamAction(inviteCode)
      await syncWorkspaceRuntime()
      showToast('已加入新团队', 'success')
      setJoinTeamOpen(false)
      if (isCreativeWorkbench || isCreativeEntry) {
        navigate('/smart', { replace: true })
      }
    } catch (error: any) {
      showToast(getBusinessErrorMessage(error, error.message || '加入团队失败'), 'error')
    } finally {
      setIsJoiningTeam(false)
    }
  }

  function requestDeleteWorkspace(workspace: any) {
    const id = Number(workspace?.id || 0)
    const type = String(workspace?.type || '').toLowerCase()
    if (!id || type === 'personal') return
    setWorkspacePendingDelete(workspace)
    setDeleteTeamConfirmOpen(true)
  }

  function closeDeleteWorkspaceConfirm() {
    if (deletingWorkspace) return
    setDeleteTeamConfirmOpen(false)
    setWorkspacePendingDelete(null)
  }

  async function confirmDeleteWorkspace() {
    const target = workspacePendingDelete
    const id = Number(target?.id || 0)
    if (!id || deletingWorkspace) return
    const wasActiveWorkspace = Number(workspaceId || 0) === id
    setDeletingWorkspace(true)
    try {
      await deleteTeamAction(id)
      showToast('团队已删除', 'success')
      setDeleteTeamConfirmOpen(false)
      setWorkspacePendingDelete(null)
      if (wasActiveWorkspace && (isCreativeWorkbench || isCreativeEntry)) {
        navigate('/smart', { replace: true })
      }
    } catch (error: any) {
      showToast(getBusinessErrorMessage(error, error.message || '删除团队失败'), 'error')
    } finally {
      setDeletingWorkspace(false)
    }
  }

  const syncWorkspaceRuntime = useCallback(
    async ({ reloadWorkspaces = false }: { reloadWorkspaces?: boolean } = {}) => {
      if (reloadWorkspaces) {
        await loadWorkspaces()
      }
      await loadSubscriptionLabel()
    },
    [loadWorkspaces, loadSubscriptionLabel],
  )

  // 进入移动端断点时强制折叠侧边栏。
  useEffect(() => {
    if (isMobileViewport) setSidebarCollapsed(true)
  }, [isMobileViewport])

  function toggleSidebar() {
    setSidebarCollapsed((prev) => !prev)
  }

  function showComingSoon(label: string) {
    // 已接路由的导航项直接跳转；其余暂未上线，提示「敬请期待」。
    if (label === '工作台') {
      navigate('/workbench')
      return
    }

    if (label === '素材市场') {
      navigate('/resources')
      return
    }

    if (label === '项目管理') {
      navigate('/projects')
      return
    }

    if (label === '分步创作') {
      if (isCreativeWorkbench) return
      const lastProjectId = loadLastCreativeProjectId(workspaceId)
      if (lastProjectId) {
        navigate(`/smart/${lastProjectId}`)
        return
      }
      navigate('/smart')
      return
    }

    showToast(`${label}功能即将开放`, 'success')
  }

  async function handleLogout() {
    if (isLoggingOut) {
      return
    }

    // If there are unsaved draft changes, prompt the user before logging out
    if (dirty) {
      const choice = await requestConfirm('当前创意项目有未保存的修改，退出登录后修改可能丢失。是否保存后再退出？', {
        title: '未保存的修改',
        confirmLabel: '直接退出',
        cancelLabel: '取消',
        danger: false,
      })
      if (choice === false || choice === null) {
        return
      }
      setDirty(false)
    }

    setIsLoggingOut(true)

    if (import.meta.env.DEV) {
      setIsLoggingOut(false)
      markDevLogout()
      handleLogoutSuccess()
      return
    }

    try {
      await logoutSession()
      showToast('已退出登录', 'success')
      setIsLoggingOut(false)
      handleLogoutSuccess()
    } catch (error) {
      if (shouldClearSessionAfterLogoutFailure(error)) {
        setIsLoggingOut(false)
        handleLogoutSuccess()
        return
      }
      showToast(getAuthErrorMessage(error, '退出登录失败，请稍后重试'), 'error')
      setIsLoggingOut(false)
    }
  }

  // onMounted：监听窗口尺寸 + 首次刷新工作空间运行时。
  useEffect(() => {
    function updateViewportMetrics() {
      setViewportWidth(window.innerWidth)
      setViewportHeight(window.innerHeight)
    }
    // 拖拽改变窗口大小会高频触发 resize；防抖避免每帧 setState 引发重渲染风暴。
    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    function onResize() {
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(updateViewportMetrics, 120)
    }
    updateViewportMetrics()
    window.addEventListener('resize', onResize)
    void syncWorkspaceRuntime({ reloadWorkspaces: true })
    return () => {
      if (resizeTimer) clearTimeout(resizeTimer)
      window.removeEventListener('resize', onResize)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 切换空间：刷新订阅/钱包/计费候选。素材重载是各页面自身的职责。
  useEffect(() => {
    void syncWorkspaceRuntime()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  // 计费抽屉关闭后刷新套餐标签（购买可能改变订阅）。
  useEffect(() => {
    if (!billingOpen) void syncWorkspaceRuntime()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billingOpen])

  return (
    <main className="creative-shell" style={shellStyle}>
      <BillingModal
        open={billingOpen}
        initialTab={billingTab}
        workspaceId={workspaceId}
        user={currentUser}
        onClose={() => setBillingOpen(false)}
        onToast={showToast}
      />

      <TeamManagementModal
        open={teamManagementOpen}
        workspaceId={workspaceId}
        workspace={currentWorkspace}
        currentMember={currentMember}
        onClose={() => setTeamManagementOpen(false)}
        onToast={showToast}
      />

      <CreateTeamDialog
        open={createTeamOpen}
        loading={isCreatingTeam}
        inviteCode={createTeamInviteCode}
        onClose={closeCreateTeamDialog}
        onGenerateInvite={handleCreateTeamGenerateInvite}
        onSubmit={handleCreateTeamSubmit}
      />

      <JoinTeamDialog
        open={joinTeamOpen}
        loading={isJoiningTeam}
        onClose={() => setJoinTeamOpen(false)}
        onSubmit={handleJoinTeam}
      />

      <section className="creative-stage" aria-label="窗口式创作">
        <div className={`creative-frame${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
          <CreativeSidebar
            collapsed={sidebarCollapsed}
            sections={navSections}
            workspaces={allWorkspaces}
            activeWorkspaceId={workspaceId}
            onToggleSidebar={toggleSidebar}
            onNavClick={showComingSoon}
            onSwitchWorkspace={switchWorkspace}
            onCreateTeam={openCreateTeam}
            onJoinTeam={openJoinTeam}
            onDeleteWorkspace={requestDeleteWorkspace}
          />

          <WorkspaceTopbar
            user={currentUser}
            workspace={currentWorkspace}
            member={currentMember}
            planName={currentPlanName}
            planExpiresAt={currentPlanExpiresAt}
            credits={walletCredits}
            creditsTotal={planBaseCredits}
            isLoggingOut={isLoggingOut}
            onOpenBilling={openBilling}
            onJoinTeam={openJoinTeam}
            onOpenTeamManagement={openTeamManagement}
            onLogout={handleLogout}
            onComingSoon={showComingSoon}
          />

          {/* 页面内容。工作空间/计费状态在 useWorkspaceSessionStore，子页面自取，
              不依赖组件父子层级。 */}
          {children}
        </div>
      </section>

      {deleteTeamConfirmOpen && (
        <div className="delete-team-overlay" role="dialog" aria-modal="true" aria-label="删除团队确认">
          <button
            type="button"
            className="delete-team-backdrop"
            aria-label="关闭删除团队确认"
            onClick={closeDeleteWorkspaceConfirm}
          ></button>
          <section className="delete-team-modal">
            <h3 className="delete-team-title">退出团队</h3>
            <p className="delete-team-copy">确认退出团队“{workspacePendingDelete?.name || '该团队'}”？</p>
            <p className="delete-team-copy delete-team-copy-warning">
              退出后将从你的工作空间列表中移除，不再接收该团队的更新。
            </p>
            <div className="delete-team-actions">
              <button
                type="button"
                className="delete-team-btn delete-team-btn-cancel"
                onClick={closeDeleteWorkspaceConfirm}
              >
                取消
              </button>
              <button
                type="button"
                className="delete-team-btn delete-team-btn-danger"
                disabled={deletingWorkspace}
                onClick={confirmDeleteWorkspace}
              >
                {deletingWorkspace ? '删除中...' : '确认删除'}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}
