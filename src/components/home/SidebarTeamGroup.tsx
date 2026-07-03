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
import { useCurrentWorkspace, useWorkspaceSessionStore } from '@/stores/workspaceSession'
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
  const wsName = (currentWorkspace as any)?.name || (isTeam ? '团队' : '个人空间')

  return (
    <div className="app-sidebar__group stg">
      <div className="app-sidebar__group-title">团队</div>

      {/* 当前空间名(个人 / 团队都显示);团队空间可点 → 打开团队管理(成员管理);并带「邀请成员」 */}
      <div className="stg-current">
        {isTeam ? (
          <button
            type="button"
            className="stg-current__name stg-current__name--btn"
            title={collapsed ? wsName : '团队管理'}
            onClick={() => openTeamManage()}
          >
            {wsName}
          </button>
        ) : (
          <span className="stg-current__name" title={collapsed ? wsName : undefined}>
            {wsName}
          </span>
        )}
        {isTeam && (
          <>
            <span className="stg-current__divider" aria-hidden="true" />
            <button
              type="button"
              className="stg-invite"
              data-tip="邀请成员"
              aria-label="邀请成员"
              onClick={() => openTeamManage()}
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
