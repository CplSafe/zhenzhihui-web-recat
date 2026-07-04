/*
  SpaceSelectPanel — 工作空间选择面板
  展示用户所有工作空间/团队列表，支持切换空间、创建新空间、加入空间。
*/
import { useEffect, useMemo, useState } from 'react'
import { useUiStore } from '@/stores/ui'
import iconOrg from '@/img/0e11184b2fea6edf30f5d9069dff11d9.png'
import iconCreateTeam from '@/img/84dcae4ff71f768e85106ec686c4ff99.png'
import './SpaceSelectPanel.css'

interface Workspace {
  id?: number | string
  name?: string
  type?: string
  [key: string]: any
}

interface SpaceSelectPanelProps {
  workspaces?: Workspace[]
  activeWorkspaceId?: number
  defaultOpen?: boolean
  onSelect?: (id: number) => void
  onJoinTeam?: () => void
  onCreateTeam?: () => void
  onDeleteWorkspace?: (ws: Workspace) => void
}

export default function SpaceSelectPanel({
  workspaces = [],
  activeWorkspaceId = 0,
  defaultOpen = false,
  onSelect,
  onJoinTeam,
  onCreateTeam,
  onDeleteWorkspace,
}: SpaceSelectPanelProps) {
  const [open, setOpen] = useState<boolean>(defaultOpen)
  const workspaceSwitchLocked = useUiStore((s) => s.workspaceSwitchLocked)
  const workspaceSwitchLockReason = useUiStore((s) => s.workspaceSwitchLockReason)

  // watch props.defaultOpen
  useEffect(() => {
    setOpen(!!defaultOpen)
  }, [defaultOpen])

  const activeWorkspace = useMemo<Workspace | null>(
    () => workspaces.find((w) => Number(w?.id) === Number(activeWorkspaceId)) || workspaces[0] || null,
    [workspaces, activeWorkspaceId],
  )

  function toggle() {
    setOpen((v) => !v)
  }

  function pickWorkspace(ws: Workspace) {
    const id = Number(ws?.id || 0)
    if (!id || workspaceSwitchLocked) return
    onSelect?.(id)
  }

  function isDeletableWorkspace(ws: Workspace) {
    const type = String(ws?.type || '').toLowerCase()
    return Boolean(type) && type !== 'personal'
  }

  function requestDelete(ws: Workspace) {
    if (!isDeletableWorkspace(ws)) return
    onDeleteWorkspace?.(ws)
  }

  return (
    <section className={`sp-panel${open ? ' open' : ''}`} aria-label="空间选择">
      <div className="sp-card">
        <button type="button" className="sp-head" aria-expanded={open} onClick={toggle}>
          <span className="sp-title">{activeWorkspace?.name || '个人空间'}</span>
          <svg className={`sp-caret${open ? ' up' : ''}`} viewBox="0 0 14 14" aria-hidden="true">
            <path d="m4.5 5.3 2.5 2.5 2.5-2.5" />
          </svg>
        </button>

        {open && (
          <div className="sp-body">
            <div className="sp-divider" aria-hidden="true"></div>

            <div className="sp-list" role="listbox" aria-label="空间列表">
              {workspaces.map((ws) => {
                const isActive = Number(ws.id) === Number(activeWorkspaceId)
                const deletable = isDeletableWorkspace(ws)
                return (
                  <div key={String(ws.id)} className={`sp-item-row${isActive ? ' active' : ''}`}>
                    <button
                      type="button"
                      className={`sp-item${isActive ? ' active' : ''}${deletable ? ' deletable' : ''}`}
                      aria-selected={isActive}
                      disabled={workspaceSwitchLocked}
                      title={workspaceSwitchLocked ? workspaceSwitchLockReason || '当前视频处理中，暂不支持切换团队' : ''}
                      onClick={() => pickWorkspace(ws)}
                    >
                      <span className="sp-item-name">{ws.name || '个人空间'}</span>
                    </button>
                    {deletable && (
                      <button
                        type="button"
                        className="sp-delete-btn"
                        aria-label="删除团队"
                        data-tooltip="删除团队"
                        title=""
                        onClick={(e) => {
                          e.stopPropagation()
                          requestDelete(ws)
                        }}
                      >
                        <svg viewBox="0 0 16 16" aria-hidden="true">
                          <path d="M6.2 2.4h3.6c.6 0 1 .4 1 1v.5h2.1c.3 0 .6.3.6.6s-.3.6-.6.6h-.7l-.6 7c-.1 1-.9 1.8-1.9 1.8H6.3c-1 0-1.8-.8-1.9-1.8l-.6-7h-.7c-.3 0-.6-.3-.6-.6s.3-.6.6-.6h2.1v-.5c0-.6.4-1 1-1Zm3.4 1.5V3.6H6.4v.3h3.2ZM5 5.1l.5 6.8c0 .3.4.6.8.6h3.4c.4 0 .8-.3.8-.6l.5-6.8H5Zm2 1.3c.3 0 .6.3.6.6v3.5c0 .3-.3.6-.6.6s-.6-.3-.6-.6V7c0-.3.3-.6.6-.6Zm2 0c.3 0 .6.3.6.6v3.5c0 .3-.3.6-.6.6s-.6-.3-.6-.6V7c0-.3.3-.6.6-.6Z" />
                        </svg>
                      </button>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="sp-footer">
              <button
                type="button"
                className="sp-icon-btn"
                aria-label="创建团队"
                data-tooltip="创建团队"
                title=""
                onClick={() => onCreateTeam?.()}
              >
                <img className="sp-icon-img" src={iconCreateTeam} alt="" />
              </button>
              <button
                type="button"
                className="sp-icon-btn sp-icon-btn-end"
                aria-label="加入新团队"
                data-tooltip="加入新团队"
                title=""
                onClick={() => onJoinTeam?.()}
              >
                <img className="sp-icon-img" src={iconOrg} alt="" />
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
