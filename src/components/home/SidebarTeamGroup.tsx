/*
  SidebarTeamGroup — 2.1 侧栏「工作空间」组(跟随当前空间)。
  - 标题「工作空间」
  - 当前空间白框:显示【当前所在空间】的名字
      · 个人空间 → 显示「个人空间」,不含邀请成员(个人空间不能邀请)
      · 团队空间 → 显示团队名 + 邀请成员图标
  - 「+ 加入空间」按钮
  切换空间不在此(在右上角个人面板)。挂载时兜底 loadWorkspaces 一次,供个人面板列全空间。
*/
import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  useCurrentMember,
  useCurrentUser,
  useCurrentWorkspace,
  useWorkspaceSessionStore,
} from '@/stores/workspaceSession'
import { openTeamManage, openJoinTeam } from '@/stores/ui'
import inviteIcon from '@/assets/logo/image copy 3.png'
import joinSpaceIcon from '@/assets/sidebar/join.svg'
import './SidebarTeamGroup.css'

/** 根据空间类型区分团队空间与个人空间，决定是否显示邀请入口。 */
const isTeamWorkspace = (w: any): boolean => Boolean(w?.type) && String(w.type).toLowerCase() !== 'personal'

/** 加入新空间按钮图标。 */
const IconPlus = (
  <img className="stg-join__ico-img" src={joinSpaceIcon} alt="" width={12} height={12} aria-hidden="true" />
)

// 会话内只兜底拉一次全部空间(供个人面板切换列表列全),不给每次翻页刷接口
let workspacesFetched = false

/** 工作空间区域的折叠展示状态。 */
interface SidebarTeamGroupProps {
  collapsed?: boolean
}

/** 显示当前工作空间，并连接加入空间和团队管理全局弹窗。 */
export default function SidebarTeamGroup({ collapsed = false }: SidebarTeamGroupProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const currentWorkspace = useCurrentWorkspace()
  const currentMember = useCurrentMember() as any
  const currentUser = useCurrentUser() as any
  const loadWorkspaces = useWorkspaceSessionStore((s) => s.loadWorkspaces)

  useEffect(() => {
    if (workspacesFetched) return
    workspacesFetched = true
    void Promise.resolve(loadWorkspaces?.()).catch(() => {
      workspacesFetched = false
    })
  }, [loadWorkspaces])

  // 跟随当前空间:不再固定显示团队。个人空间显示「个人空间」,团队空间显示团队名 + 邀请成员。
  if (!currentWorkspace) return null
  const isTeam = isTeamWorkspace(currentWorkspace)
  const ownerUserId = Number((currentWorkspace as any)?.owner_user_id || (currentWorkspace as any)?.ownerUserId || 0)
  const currentUserId = Number(currentUser?.id || currentUser?.user_id || 0)
  const currentRole = String(
    currentMember?.workspace_role ||
      currentMember?.workspaceRole ||
      currentMember?.member_role ||
      currentMember?.memberRole ||
      currentMember?.role ||
      '',
  )
    .trim()
    .toLowerCase()
  const canRevealTeamInfo = !isTeam || Boolean(currentRole) || (ownerUserId > 0 && currentUserId === ownerUserId)
  const wsName = canRevealTeamInfo ? (currentWorkspace as any)?.name || (isTeam ? '团队' : '个人空间') : '团队空间'
  const dashboardActive = location.pathname === '/team'

  const openDashboard = () => {
    navigate('/team')
  }

  return (
    <div className="app-sidebar__group stg">
      <div className="app-sidebar__group-title">团队</div>

      {/* 当前空间卡片点击进入空间数据看板;邀请成员按钮保留为团队管理入口。 */}
      <div
        className={`stg-current${dashboardActive ? ' is-active' : ''}`}
        role="button"
        tabIndex={0}
        aria-label="打开空间数据看板"
        onClick={openDashboard}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            openDashboard()
          }
        }}
      >
        <span className="stg-current__name" title={collapsed ? wsName : undefined}>
          {wsName}
        </span>
        {isTeam && canRevealTeamInfo && (
          <>
            <span className="stg-current__divider" aria-hidden="true" />
            <button
              type="button"
              className="stg-invite"
              data-tip="邀请成员"
              aria-label="邀请成员"
              onClick={(event) => {
                event.stopPropagation()
                openTeamManage()
              }}
            >
              <img className="stg-invite__img" src={inviteIcon} alt="" width={20} height={20} />
            </button>
          </>
        )}
      </div>

      {/* 加入空间 */}
      <button type="button" className="stg-join" onClick={() => openJoinTeam()}>
        <span className="stg-join__ico">{IconPlus}</span>
        <span className="stg-join__label">加入空间</span>
      </button>
    </div>
  )
}
