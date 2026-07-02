/*
  PersonalPanel — 顶栏头像下拉的「我的-个人面板」(对齐 Figma 1147:3823)。
  头像+姓名+角色徽标+当前空间 / 会员卡(套餐+到期+积分进度) / 切换空间 / 修改密码·退出登录。
  数据全接 workspaceSession store;切换空间直接生效,其余动作回调给 AppTopbar。
*/
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
import { openTeamManage } from '@/stores/ui'
import './PersonalPanel.css'

const roleLabelOf = (role: any): string => {
  const r = String(role || '').toLowerCase()
  if (r === 'owner') return '超级管理员'
  if (r === 'admin') return '管理员'
  if (r === 'member') return '成员'
  return ''
}
const fmtDate = (s: any): string => String(s || '').slice(0, 10)

const IconMembers = (
  <svg viewBox="0 0 22 22" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6">
    <circle cx="8.5" cy="8" r="3" />
    <path
      d="M3.5 17.5c0-2.8 2.2-4.5 5-4.5s5 1.7 5 4.5M15 5.5a3 3 0 0 1 0 5.8M16 17.5c0-2-.7-3.5-1.9-4.4"
      strokeLinecap="round"
    />
  </svg>
)
const IconCrown = (
  <svg viewBox="0 0 64 56" width="86" height="76" fill="none" aria-hidden="true">
    <path
      d="M8 44l-4-26 14 9L32 8l14 19 14-9-4 26z"
      fill="#7fe0c6"
      stroke="#43c9a8"
      strokeWidth="2"
      strokeLinejoin="round"
    />
    <circle cx="4" cy="18" r="3" fill="#43c9a8" />
    <circle cx="60" cy="18" r="3" fill="#43c9a8" />
    <circle cx="32" cy="8" r="3" fill="#43c9a8" />
  </svg>
)
const IconLock = (
  <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7">
    <rect x="4.5" y="8.5" width="11" height="8" rx="2" />
    <path d="M7 8.5V6.5a3 3 0 0 1 6 0v2" strokeLinecap="round" />
  </svg>
)
const IconLogout = (
  <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7">
    <path
      d="M12.5 6.5V5a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 5v10A1.5 1.5 0 0 0 6 16.5h5a1.5 1.5 0 0 0 1.5-1.5v-1.5M9 10h8m0 0-2.5-2.5M17 10l-2.5 2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)
const IconChevronR = (
  <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6">
    <path d="m8 6 4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
// 切换空间列表默认露出约 3 个,超出则固定高度可滚动(不撑高面板)
const MAX_VISIBLE_WS = 3

interface PersonalPanelProps {
  onMember?: () => void
  onChangePwd?: () => void
  onLogout?: () => void
  onClose?: () => void
  loggingOut?: boolean
}

export default function PersonalPanel({ onMember, onChangePwd, onLogout, onClose, loggingOut }: PersonalPanelProps) {
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

  const hasMore = workspaces.length > MAX_VISIBLE_WS

  const name = user?.name || user?.nickname || user?.mobile || '用户'
  const role = roleLabelOf(member?.role)
  const wsName = currentWs?.name || '个人空间'
  const isTeamWs = Boolean(currentWs?.type) && String(currentWs.type).toLowerCase() !== 'personal'
  const avatarUrl = user?.avatar || user?.avatar_url || user?.avatarUrl || ''
  const initial = String(name).trim().charAt(0) || 'U'
  // 积分进度按【已消耗】算(用得越多条越满)。有任何消耗就至少显示 1%(从 1% 起,让进度立刻可见);
  // 完全没消耗则 0%。credits 为剩余积分,baseCredits 为套餐基础积分。
  const usedCredits = Math.max(0, baseCredits - Number(credits))
  const usedPct =
    baseCredits > 0 && usedCredits > 0 ? Math.min(100, Math.max(1, Math.round((usedCredits / baseCredits) * 100))) : 0

  const pickWs = (id: number) => {
    if (id && Number(id) !== Number(activeId)) switchWorkspace(id)
    onClose?.()
  }

  return (
    <div className="ppl">
      {/* 头部:头像 + 姓名 + 角色徽标 / 当前空间 */}
      <div className="ppl__head">
        <div className="ppl__id">
          {avatarUrl ? (
            <img className="ppl__ava" src={avatarUrl} alt="" />
          ) : (
            <span className="ppl__ava ppl__ava--txt">{initial}</span>
          )}
          <span className="ppl__name">{name}</span>
          {role && <span className="ppl__role">{role}</span>}
        </div>
        {/* 当前空间:团队空间可点 → 打开团队管理弹窗查看该空间全部成员 */}
        {isTeamWs ? (
          <button
            type="button"
            className="ppl__ws ppl__ws--btn"
            title={`${wsName} · 查看成员`}
            onClick={() => {
              onClose?.()
              openTeamManage()
            }}
          >
            <span className="ppl__ws-ico">{IconMembers}</span>
            <span className="ppl__ws-txt">{wsName}</span>
          </button>
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
              onClick={() => pickWs(Number(ws.id))}
            >
              <span className="ppl__ws-item-name">{ws.name || '个人空间'}</span>
              <span className={`ppl__radio${active ? ' on' : ''}`} aria-hidden="true" />
            </button>
          )
        })}
      </div>

      {/* 动作 */}
      <button type="button" className="ppl__act" onClick={() => onChangePwd?.()}>
        <span className="ppl__act-ico ppl__act-ico--green">{IconLock}</span>
        <span className="ppl__act-label">修改密码</span>
        <span className="ppl__act-arrow">{IconChevronR}</span>
      </button>
      <button type="button" className="ppl__act" onClick={() => onLogout?.()} disabled={loggingOut}>
        <span className="ppl__act-ico ppl__act-ico--red">{IconLogout}</span>
        <span className="ppl__act-label">{loggingOut ? '退出中…' : '退出登录'}</span>
        <span className="ppl__act-arrow">{IconChevronR}</span>
      </button>
    </div>
  )
}
