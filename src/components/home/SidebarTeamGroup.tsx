/*
  SidebarTeamGroup — 2.1 侧栏「团队空间」组(对齐新设计)。
  - 标题「团队空间」
  - 当前空间白框:空间名 + 分隔线 + 邀请成员图标(hover 提示)
  - 「+ 加入空间」按钮
  切换空间不在此(已在右上角个人面板)。挂载时兜底 loadWorkspaces 一次,供个人面板列全空间。
*/
import { useEffect } from 'react'
import {
  useAllWorkspaces,
  useCurrentWorkspace,
  useWorkspaceId,
  useWorkspaceSessionStore,
} from '@/stores/workspaceSession'
import { openTeamManage, openJoinTeam } from '@/stores/ui'
import inviteIcon from '@/assets/logo/image copy 3.png'
import './SidebarTeamGroup.css'

const isTeamWorkspace = (w: any): boolean => Boolean(w?.type) && String(w.type).toLowerCase() !== 'personal'

const IconPlus = (
  <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7">
    <path d="M10 4.5v11M4.5 10h11" strokeLinecap="round" />
  </svg>
)

// 会话内只兜底拉一次全部空间(供个人面板切换列表列全),不给每次翻页刷接口
let workspacesFetched = false

interface SidebarTeamGroupProps {
  collapsed?: boolean
}

export default function SidebarTeamGroup({ collapsed = false }: SidebarTeamGroupProps) {
  const currentWorkspace = useCurrentWorkspace()
  const workspaces = useAllWorkspaces()
  const activeId = useWorkspaceId()
  const switchWorkspace = useWorkspaceSessionStore((s) => s.switchWorkspace)
  const loadWorkspaces = useWorkspaceSessionStore((s) => s.loadWorkspaces)

  useEffect(() => {
    if (workspacesFetched) return
    workspacesFetched = true
    void Promise.resolve(loadWorkspaces?.()).catch(() => {
      workspacesFetched = false
    })
  }, [loadWorkspaces])

  // 只要名下有团队空间就展示本组(团队版 / 被邀请进团队);基础版无团队空间则不展示。
  const teamWorkspaces = (workspaces as any[]).filter(isTeamWorkspace)
  if (!teamWorkspaces.length) return null

  // 展示的团队:当前若已在某团队则用它,否则用第一个团队空间。
  const displayTeam = isTeamWorkspace(currentWorkspace) ? currentWorkspace : teamWorkspaces[0]
  const teamId = Number(displayTeam?.id || 0)
  const teamName = displayTeam?.name || '团队空间'
  const isCurrent = teamId > 0 && teamId === Number(activeId)

  // 进入该团队(切换是同步的:切完 current=该团队,邀请/成员/解散/角色上下文都对准它)
  const enterTeam = () => {
    if (teamId > 0 && !isCurrent) switchWorkspace(teamId)
  }

  return (
    <div className="app-sidebar__group stg">
      <div className="app-sidebar__group-title">团队空间</div>

      {/* 团队名(点击进入该团队)+ 邀请成员 */}
      <div className="stg-current">
        <button
          type="button"
          className="stg-current__name"
          title={collapsed ? teamName : '切换到该团队空间'}
          onClick={enterTeam}
        >
          {teamName}
        </button>
        <span className="stg-current__divider" aria-hidden="true" />
        <button
          type="button"
          className="stg-invite"
          data-tip="邀请成员"
          aria-label="邀请成员"
          onClick={() => {
            enterTeam() // 先进入该团队(同步切换),确保团队管理弹窗对准的是这个团队
            openTeamManage()
          }}
        >
          <img className="stg-invite__img" src={inviteIcon} alt="" width={20} height={20} />
        </button>
      </div>

      {/* 加入空间 */}
      <button type="button" className="stg-join" onClick={() => openJoinTeam()}>
        <span className="stg-join__ico">{IconPlus}</span>
        <span className="stg-join__label">加入空间</span>
      </button>
    </div>
  )
}
