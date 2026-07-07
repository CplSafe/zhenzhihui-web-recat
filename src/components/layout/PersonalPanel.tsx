/*
  PersonalPanel — 顶栏头像下拉的「我的-个人面板」(对齐 Figma 1147:3823)。
  头像+姓名+角色徽标+当前空间 / 会员卡(套餐+到期+积分进度) / 切换空间。
  数据全接 workspaceSession store;切换空间直接生效,会员卡点击回调给 AppTopbar。
  (个人中心 / 修改密码 / 退出登录 已移至侧栏「设置」菜单,见 SettingsMenu。)
*/
import { useEffect, useState } from 'react'
import { Tooltip } from 'antd'
import {
  useAllWorkspaces,
  useCurrentMember,
  useCurrentPlanExpiresAt,
  useCurrentPlanName,
  useCurrentUser,
  useCurrentWorkspace,
  usePlanBaseCredits,
  useWalletCredits,
  useWorkspaceId,
  useWorkspaceSessionStore,
} from '@/stores/workspaceSession'
import { openTeamManage, useUiStore } from '@/stores/ui'
import { useToast, useConfirmDialog } from '@/composables/useToast'
import { validateWorkspaceName, normalizeWorkspaceNameForCompare } from '@/utils/workspaceName'
import crownImg from '@/assets/vip/5dc4125fc31865adb710a7f65ad2df60.png'
import teamIcon from '@/assets/5d214dea973d5d1dd62b8be882e775c2.png'
import editIcon from '@/assets/81926ea1670cd86f6fc1adec90042f08.png'
import './PersonalPanel.css'

const roleLabelOf = (role: any): string => {
  const r = String(role || '').toLowerCase()
  if (r === 'owner') return '超级管理员'
  if (r === 'admin') return '管理员'
  if (r === 'member') return '成员'
  return ''
}

const roleValueOf = (member: any, workspace: any, user: any): string => {
  const currentWorkspaceId = Number(workspace?.id || 0)
  const memberWorkspaceId = Number(
    member?.workspace_id ??
      member?.workspaceId ??
      member?.workspace?.id ??
      member?.current_workspace_id ??
      member?.currentWorkspaceId ??
      0,
  )
  const userId = Number(user?.id || 0)
  const ownerUserId = Number(workspace?.owner_user_id || workspace?.ownerUserId || 0)

  if (currentWorkspaceId > 0 && ownerUserId > 0 && userId > 0 && ownerUserId === userId) {
    return 'owner'
  }

  if (currentWorkspaceId > 0 && memberWorkspaceId > 0 && memberWorkspaceId !== currentWorkspaceId) {
    return ''
  }

  return String(
    member?.workspace_role || member?.workspaceRole || member?.member_role || member?.memberRole || member?.role || '',
  )
    .trim()
    .toLowerCase()
}

const fmtDate = (s: any): string => String(s || '').slice(0, 10)

const IconMembers = <img className="ppl__ws-ico-img" src={teamIcon} alt="" aria-hidden="true" />
const IconCrown = <img className="ppl__crown-img" src={crownImg} alt="" aria-hidden="true" />
// 切换空间列表默认露出约 3 个,超出则固定高度可滚动(不撑高面板)
const MAX_VISIBLE_WS = 3

interface PersonalPanelProps {
  onMember?: () => void
  onClose?: () => void
}

export default function PersonalPanel({ onMember, onClose }: PersonalPanelProps) {
  const user = useCurrentUser()
  const member = useCurrentMember()
  const currentWs = useCurrentWorkspace()
  const workspaces = useAllWorkspaces()
  const activeId = useWorkspaceId()
  const planName = useCurrentPlanName()
  const expiresAt = useCurrentPlanExpiresAt()
  const credits = useWalletCredits()
  const baseCredits = usePlanBaseCredits()
  const switchWorkspace = useWorkspaceSessionStore((s) => s.switchWorkspace)
  const workspaceSwitchLocked = useUiStore((s) => s.workspaceSwitchLocked)
  const workspaceSwitchLockReason = useUiStore((s) => s.workspaceSwitchLockReason)
  const { showToast } = useToast()
  const { requestConfirm } = useConfirmDialog()
  const [renamingTeam, setRenamingTeam] = useState(false)

  const hasMore = workspaces.length > MAX_VISIBLE_WS

  const name = user?.name || user?.nickname || user?.mobile || '用户'
  const roleValue = roleValueOf(member, currentWs, user)
  const role = roleLabelOf(roleValue)
  const isTeamWs = Boolean(currentWs?.type) && String(currentWs.type).toLowerCase() !== 'personal'
  const canRevealTeamInfo = !isTeamWs || Boolean(roleValue)
  const wsName = canRevealTeamInfo ? currentWs?.name || '个人空间' : '团队空间'
  // 团队空间 + 所有者/管理员才可重命名(与团队管理弹窗头部的重命名权限一致)
  const canRenameTeam = isTeamWs && ['owner', 'admin'].includes(roleValue)

  // 重命名当前团队:弹输入框(预填现名)→ 前端校验/查重 → renameTeam(改后侧栏/顶栏同步)。
  const handleRenameTeam = async () => {
    if (renamingTeam) return
    const wsId = Number(currentWs?.id || 0)
    if (!wsId) return
    const currentName = String(currentWs?.name || '').trim()
    const input = await requestConfirm('修改当前团队空间的名称,改后侧栏 / 顶栏同步更新。', {
      title: '重命名团队',
      inputEnabled: true,
      inputValue: currentName,
      inputLabel: '团队名称',
      inputPlaceholder: '请输入团队名称',
      confirmLabel: '保存',
    })
    if (input === null) return // 取消
    const next = String(input).trim()
    if (!next || next === currentName) return
    // 基本校验(长度 / 控制字符 / 尖括号),与创建团队输入框一致
    const err = validateWorkspaceName(next)
    if (err) {
      showToast(err, 'error')
      return
    }
    // 名下团队查重(排除当前空间自己),避免后端因重名报错
    const norm = normalizeWorkspaceNameForCompare(next)
    const dup = (workspaces as any[]).some(
      (w) =>
        Number(w?.id) !== wsId &&
        Boolean(w?.type) &&
        String(w.type).toLowerCase() !== 'personal' &&
        normalizeWorkspaceNameForCompare(String(w?.name || '')) === norm,
    )
    if (dup) {
      showToast('已存在同名团队,请换一个名称', 'error')
      return
    }
    setRenamingTeam(true)
    try {
      await useWorkspaceSessionStore.getState().renameTeam(wsId, next)
      showToast('团队名称已更新', 'success')
    } catch (error: any) {
      const status = Number(error?.status)
      showToast(status === 409 ? '已存在同名空间,请换一个名称' : error?.message || '重命名失败,请稍后重试', 'error')
    } finally {
      setRenamingTeam(false)
    }
  }
  const avatarUrl = user?.avatar || user?.avatar_url || user?.avatarUrl || ''
  const accountName = name
  const initial = String(accountName).trim().charAt(0) || 'U'
  // 积分进度按【已消耗】算(用得越多条越满)。有任何消耗就至少显示 1%(从 1% 起,让进度立刻可见);
  // 完全没消耗则 0%。credits 为剩余积分,baseCredits 为套餐基础积分。
  const usedCredits = Math.max(0, baseCredits - Number(credits))
  const usedPct =
    baseCredits > 0 && usedCredits > 0 ? Math.min(100, Math.max(1, Math.round((usedCredits / baseCredits) * 100))) : 0

  const pickWs = (id: number) => {
    if (workspaceSwitchLocked) {
      showToast(workspaceSwitchLockReason || '当前视频处理中，暂不支持切换团队', 'error')
      return
    }
    if (id && Number(id) !== Number(activeId)) switchWorkspace(id)
    onClose?.()
  }

  return (
    <div className="ppl">
      {/* 头部:始终显示登录账号;当前空间单独展示,避免团队名和账号名混淆。 */}
      <div className="ppl__head">
        <div className="ppl__id">
          {avatarUrl ? (
            <img className="ppl__ava" src={avatarUrl} alt="" />
          ) : (
            <span className="ppl__ava ppl__ava--txt">{initial}</span>
          )}
          <div className="ppl__identity">
            <div className="ppl__identity-top">
              <span className="ppl__name" title={accountName}>
                {accountName}
              </span>
              {role && <span className="ppl__role">{role}</span>}
            </div>
            <div className="ppl__identity-sub">
              <span className="ppl__identity-label">当前空间</span>
              <span className="ppl__identity-ws" title={wsName}>
                {wsName}
              </span>
              {canRenameTeam && (
                <Tooltip title="重命名团队" placement="bottom" zIndex={4000}>
                  <button
                    type="button"
                    className="ppl__rename"
                    aria-label="重命名团队"
                    disabled={renamingTeam}
                    onClick={handleRenameTeam}
                  >
                    <img className="ppl__rename-img" src={editIcon} alt="" aria-hidden="true" />
                  </button>
                </Tooltip>
              )}
            </div>
          </div>
        </div>
        {/* 当前空间:团队空间只显示图标,悬停弹出「团队成员」黑色圆角浮层,点击打开团队管理查看成员 */}
        {isTeamWs && canRevealTeamInfo ? (
          <Tooltip title="团队成员" placement="bottom" zIndex={4000}>
            <button
              type="button"
              className="ppl__ws ppl__ws--btn ppl__ws--icononly"
              aria-label="团队成员"
              onClick={() => {
                onClose?.()
                openTeamManage()
              }}
            >
              <span className="ppl__ws-ico">{IconMembers}</span>
            </button>
          </Tooltip>
        ) : (
          <div className="ppl__ws" title={wsName}>
            <span className="ppl__ws-ico">{IconMembers}</span>
            <span className="ppl__ws-txt">{wsName}</span>
          </div>
        )}
      </div>

      {/* 会员卡:套餐 + 到期 + 积分进度(点整卡进会员中心) */}
      <button type="button" className="ppl__card" onClick={() => onMember?.()}>
        <div className="ppl__card-top">
          <div className="ppl__plan-wrap">
            <div className="ppl__plan">
              <span className="ppl__vbadge">V</span>
              {planName || '未开通会员'}
            </div>
            {expiresAt && <div className="ppl__expire">{fmtDate(expiresAt)} 到期</div>}
          </div>
          <span className="ppl__crown">{IconCrown}</span>
        </div>
        <div className="ppl__credits-row">
          <span className="ppl__credits-label">积分已用{usedPct}%</span>
          <span className="ppl__credits-num">
            <b>{Number(credits) || 0}</b> /{baseCredits || 0}
          </span>
        </div>
        <div className="ppl__bar">
          <span className="ppl__bar-fill" style={{ width: `${usedPct}%` }} />
        </div>
      </button>

      {/* 切换空间 */}
      <div className="ppl__switch-title">切换空间</div>
      {/* 列表固定高度(约 3 个)+ 可滚动:空间再多面板也不被撑长,滚动查看其余 */}
      <div className={`ppl__ws-list${hasMore ? ' scroll' : ''}`}>
        {workspaces.map((ws: any) => {
          const active = Number(ws.id) === Number(activeId)
          return (
            <button
              key={String(ws.id)}
              type="button"
              className={`ppl__ws-item${active ? ' active' : ''}`}
              disabled={workspaceSwitchLocked}
              title={workspaceSwitchLocked ? workspaceSwitchLockReason || '当前视频处理中，暂不支持切换团队' : ''}
              onClick={() => pickWs(Number(ws.id))}
            >
              <span className="ppl__ws-item-name">{ws.name || '个人空间'}</span>
              <span className={`ppl__radio${active ? ' on' : ''}`} aria-hidden="true" />
            </button>
          )
        })}
      </div>
    </div>
  )
}
