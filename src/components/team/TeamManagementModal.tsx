/*
  TeamManagementModal — 团队管理弹窗
  管理团队成员列表、邀请成员、角色分配（管理员/成员）、移除成员、邀请码管理。
*/
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { listWorkspaceMembers } from '@/api/auth'
import {
  createWorkspaceInvitation,
  deleteWorkspaceInvitation,
  getSubscription,
  getWorkspaceMemberStatistics,
  getWorkspaceOverview,
  listWorkspaceInvitations,
  removeWorkspaceMember,
  transferWorkspaceOwnership,
  updateWorkspaceMemberQuota,
  updateWorkspaceMemberRole,
} from '@/api/business'
import { deriveAllWorkspaces, useWorkspaceSessionStore } from '@/stores/workspaceSession'
import { useConfirmDialog } from '@/composables/useToast'
import { WORKSPACE_NAME_MAX, normalizeWorkspaceNameForCompare, validateWorkspaceName } from '@/utils/workspaceName'
import editIcon from '@/assets/81926ea1670cd86f6fc1adec90042f08.png'
import './TeamManagementModal.css'

type ToastType = 'success' | 'error'

interface TeamManagementModalProps {
  open?: boolean
  /** 打开时初始 tab:'members'(成员管理,默认)/ 'data'(团队数据) */
  initialTab?: 'members' | 'data'
  workspaceId?: number
  workspace?: Record<string, any> | null
  currentMember?: Record<string, any> | null
  onClose?: () => void
  onToast?: (message: string, type?: ToastType) => void
}

// ── 团队数据(overview / member-statistics)容错解析:后端 C 端接口字段名未定,多候选兜底 ──
function pickNum(obj: any, keys: string[]): number {
  if (!obj || typeof obj !== 'object') return 0
  for (const k of keys) {
    const v = obj[k]
    if (v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v))) return Number(v)
  }
  return 0
}
const MEMBER_KEYS = ['member_count', 'members_total', 'members', 'memberCount', 'user_count', 'users_total']
const PROJECT_KEYS = ['project_count', 'projects_total', 'projects', 'projectCount', 'proj_count']
const VIDEO_KEYS = [
  'video_count',
  'videos_total',
  'videos',
  'works_total',
  'works',
  'work_count',
  'generated_videos',
  'total_videos',
]
const CREDIT_KEYS = [
  'credits_consumed',
  'consumed_credits',
  'credits_total',
  'total_credits',
  'credit_consumed',
  'consume_credits',
  'credits',
]

function parseOverview(payload: any): { members: number; projects: number; videos: number; credits: number } {
  const o = payload && typeof payload === 'object' ? payload : {}
  // 兼容 flat 或 { total/cumulative/all/overall/data: {...} } 包裹;取累计口径,取不到再回落顶层
  const nested = o.total ?? o.cumulative ?? o.all ?? o.overall ?? o.data
  const src = nested && typeof nested === 'object' ? nested : o
  const num = (keys: string[]) => pickNum(src, keys) || pickNum(o, keys)
  return {
    members: num(MEMBER_KEYS),
    projects: num(PROJECT_KEYS),
    videos: num(VIDEO_KEYS),
    credits: num(CREDIT_KEYS),
  }
}

interface MemberStatRow {
  id: any
  name: string
  phone: string
  projects: number
  videos: number
  credits: number
}
function parseMemberStats(payload: any): MemberStatRow[] {
  const list = Array.isArray(payload)
    ? payload
    : (payload?.items ?? payload?.list ?? payload?.records ?? payload?.members ?? payload?.data ?? [])
  const arr = Array.isArray(list) ? list : []
  return arr
    .filter((m: any) => m && typeof m === 'object')
    .map((m: any) => {
      const base = m.total ?? m.cumulative ?? m
      const num = (keys: string[]) => pickNum(base, keys) || pickNum(m, keys)
      return {
        id: m.user_id ?? m.userId ?? m.id ?? m.member_id ?? '',
        name: normalizeMemberName(m) || pickFirstText(m.user_name, m.member_name, '成员'),
        phone: normalizeMemberPhone(m),
        projects: num(PROJECT_KEYS),
        videos: num(VIDEO_KEYS),
        credits: num(CREDIT_KEYS),
      }
    })
}
// 平均每视频消耗积分(前端算,保留 1 位小数,防除 0)
const avgPerVideo = (credits: number, videos: number): number =>
  videos > 0 ? Math.round((credits / videos) * 10) / 10 : 0

// 权限不足(403)。后端尚未把邀请码接口放开给管理员时会返回 403 → 用于静默/友好降级,不弹通用报错。
const isPermissionDenied = (error: any): boolean => Number(error?.status) === 403

// 某些后端版本只允许把所有权转让给 member。前端在 owner -> admin 的场景下做一次兼容兜底:
// 若接口因目标成员当前是 admin 被拒绝，则先降为 member 再重试转让。
function shouldRetryTransferViaMemberFallback(error: any): boolean {
  const status = Number(error?.status || 0)
  if (![400, 409, 422].includes(status)) return false
  const message = String(error?.message || error?.response?.message || '')
    .trim()
    .toLowerCase()
  return /admin|administrator|管理员|member|成员|owner|ownership|transfer|转让/.test(message)
}

// 数据看板 5 张卡的图标(描边 currentColor,由外层设色)
const svgProps = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}
const IcoMembers = (
  <svg {...svgProps}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 5.5a3 3 0 0 1 0 5.8M20.5 19a5.2 5.2 0 0 0-3-4.7" />
  </svg>
)
const IcoProjects = (
  <svg {...svgProps}>
    <rect x="4" y="4" width="16" height="16" rx="2.5" />
    <path d="M8 9h8M8 13h8M8 17h5" />
  </svg>
)
const IcoVideos = (
  <svg {...svgProps}>
    <circle cx="12" cy="12" r="9" />
    <path d="M10 8.5 16 12l-6 3.5z" fill="currentColor" stroke="none" />
  </svg>
)
const IcoAvg = (
  <svg {...svgProps}>
    <ellipse cx="12" cy="6" rx="7" ry="3" />
    <path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
  </svg>
)
const IcoCredits = (
  <svg {...svgProps}>
    <rect x="5" y="4" width="14" height="17" rx="2" />
    <path d="M9 3.5h6v2.5H9zM8.5 11h7M8.5 15h5" />
  </svg>
)

interface NormalizedMember {
  raw: any
  id: number
  name: string
  phone: string
  role: string
  roleLabel: string
  isOwner: boolean
}

interface NormalizedInvitation {
  raw: any
  id: number
  code: string
  expiresAt: string
  revokedAt: string
  acceptedAt: string
  createdAt: string
  status: string
}

const expiryOptions = [
  { label: '7天', value: 7 },
  { label: '30天', value: 30 },
  { label: '90天', value: 90 },
]

function pickFirstText(...candidates: any[]): string {
  for (const candidate of candidates) {
    const value = String(candidate ?? '').trim()
    if (value) return value
  }
  return ''
}

function normalizeMemberName(member: any, fallback = ''): string {
  return (
    pickFirstText(
      member?.nickname,
      member?.name,
      member?.user?.nickname,
      member?.user?.name,
      member?.profile?.nickname,
      member?.account?.nickname,
      member?.user?.mobile,
      member?.mobile,
      member?.user?.email,
      fallback,
    ) || fallback
  )
}

function normalizeMemberPhone(member: any): string {
  return pickFirstText(
    member?.mobile,
    member?.phone,
    member?.telephone,
    member?.tel,
    member?.mobile_masked,
    member?.phone_masked,
    member?.mobileMasked,
    member?.phoneMasked,
    member?.mobile_number,
    member?.phone_number,
    member?.user?.mobile,
    member?.user?.phone,
    member?.user?.telephone,
    member?.user?.tel,
    member?.user?.mobile_masked,
    member?.user?.phone_masked,
    member?.user?.mobile_number,
    member?.user?.phone_number,
    member?.profile?.mobile,
    member?.profile?.phone,
    member?.profile?.telephone,
    member?.account?.mobile,
    member?.account?.phone,
    member?.account?.telephone,
  )
}

function normalizeMemberId(member: any, index: number): number {
  const id = Number(member?.id || member?.user_id || member?.userId || 0)
  if (Number.isFinite(id) && id > 0) return Math.floor(id)
  return index + 1
}

function normalizeMemberRole(member: any): string {
  const raw = pickFirstText(
    member?.role,
    member?.workspace_role,
    member?.member_role,
    member?.workspaceRole,
    member?.memberRole,
    member?.membership_role,
    member?.membershipRole,
  ).toLowerCase()
  if (raw === 'owner' || raw === 'admin' || raw === 'member') return raw
  return ''
}

function getRoleLabel(role: string): string {
  if (role === 'owner') return '超级管理员'
  if (role === 'admin') return '管理员'
  if (role === 'member') return '成员'
  return ''
}

function toInvitationId(item: any): number {
  const id = Number(item?.id || item?.invitation_id || item?.inv_id || item?.invId || 0)
  return Number.isFinite(id) && id > 0 ? Math.floor(id) : 0
}

function toInvitationCode(item: any): string {
  return pickFirstText(item?.code, item?.invite_code, item?.invitation_code, item?.token, item?.key)
}

function toInvitationExpiry(item: any): string {
  return pickFirstText(
    item?.expires_at,
    item?.expire_at,
    item?.expired_at,
    item?.expiresAt,
    item?.expiry_date,
    item?.expires_date,
  )
}

function normalizeInvitations(payload: any): NormalizedInvitation[] {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.items)
      ? payload.items
      : Array.isArray(payload?.list)
        ? payload.list
        : Array.isArray(payload?.records)
          ? payload.records
          : []
  return list
    .filter((item: any) => item && typeof item === 'object')
    .map((item: any) => ({
      raw: item,
      id: toInvitationId(item),
      code: toInvitationCode(item),
      expiresAt: toInvitationExpiry(item),
      revokedAt: pickFirstText(item?.revoked_at, item?.revokedAt),
      acceptedAt: pickFirstText(item?.accepted_at, item?.acceptedAt),
      createdAt: pickFirstText(item?.created_at, item?.createdAt),
      status: String(item?.status || item?.state || ''),
    }))
    .filter((item: NormalizedInvitation) => item.id || item.code)
}

function formatExpiryDate(value: any): string {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return raw
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function isInvitationActive(invitation: NormalizedInvitation | null): boolean {
  if (!invitation) return false
  const revokedAt = String(invitation.revokedAt || '').trim()
  if (revokedAt) return false
  // 邀请码可多次使用:被人接受过(acceptedAt)不再算「失效」,同一个码继续作为活码供反复加入。
  // 仅「被撤销 / 被禁用 / 已过期」才判为失效。
  const status = String(invitation.status || '')
    .trim()
    .toLowerCase()
  if (status && (status === 'revoked' || status === 'disabled' || status === 'inactive')) return false

  const expiresAt = String(invitation.expiresAt || '').trim()
  if (!expiresAt) return true
  const d = new Date(expiresAt)
  if (Number.isNaN(d.getTime())) return true
  return d.getTime() > Date.now()
}

function pickActiveInvitation(list: NormalizedInvitation[]): NormalizedInvitation | null {
  if (!Array.isArray(list) || !list.length) return null
  const activeList = list.filter((item) => isInvitationActive(item))
  const sorted = (activeList.length ? activeList : list).slice().sort((a, b) => {
    const t1 = new Date(a.createdAt || 0).getTime()
    const t2 = new Date(b.createdAt || 0).getTime()
    if (Number.isNaN(t1) && Number.isNaN(t2)) return 0
    if (Number.isNaN(t1)) return 1
    if (Number.isNaN(t2)) return -1
    return t2 - t1
  })
  return sorted.find((item) => item.code) || null
}

function formatInviteCodeForDisplay(value: any): string {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (raw.includes(' ') || raw.includes('-')) return raw
  const upper = raw.toUpperCase()
  if (/^[A-Z0-9]{8}$/.test(upper)) return `${upper.slice(0, 4)} ${upper.slice(4)}`
  return raw
}

export default function TeamManagementModal({
  open = false,
  initialTab = 'members',
  workspaceId = 0,
  workspace = null,
  currentMember = null,
  onClose,
  onToast,
}: TeamManagementModalProps) {
  const { requestConfirm } = useConfirmDialog()

  // tab:成员管理 / 团队数据。打开时用 initialTab(点团队空间名进来 = 'data')。
  const [activeTab, setActiveTab] = useState<'members' | 'data'>(initialTab)
  // 团队数据:总览 + 成员统计(owner/admin;字段容错解析)
  const [dataLoading, setDataLoading] = useState(false)
  const [overview, setOverview] = useState<{
    members: number
    projects: number
    videos: number
    credits: number
  } | null>(null)
  const [memberStats, setMemberStats] = useState<MemberStatRow[]>([])

  const [inviteCode, setInviteCode] = useState('')
  const [expiryDate, setExpiryDate] = useState('')
  const [activeInvitationId, setActiveInvitationId] = useState(0)
  const [expiryDays, setExpiryDays] = useState(7)
  // 席位上限:来自当前空间的订阅套餐(max_members)。0 = 未知/不限制,不拦邀请。
  const [maxMembers, setMaxMembers] = useState(0)

  const [query, setQuery] = useState('')

  const [membersLoading, setMembersLoading] = useState(false)
  const [members, setMembers] = useState<NormalizedMember[]>([])
  // 转让所有权后,父级 workspace prop 的 owner_user_id 要等 loadWorkspaces 回来才更新;
  // 这里先本地记住新所有者 id,让「所有者」标记与主账号权限立即切换,避免刷新前显示两个所有者。
  const [ownerOverrideId, setOwnerOverrideId] = useState(0)
  const [memberActionLoading, setMemberActionLoading] = useState(false)

  const [memberActionOpen, setMemberActionOpen] = useState(false)
  const [memberActionTarget, setMemberActionTarget] = useState<NormalizedMember | null>(null)
  const [memberActionStyle, setMemberActionStyle] = useState<React.CSSProperties>({})
  // 头部右上「…」菜单:退出该空间(仅子账号;主账号不再有解散入口)
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false)
  const headerMenuRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!headerMenuOpen) return
    const onDown = (e: PointerEvent) => {
      if (headerMenuRef.current && !headerMenuRef.current.contains(e.target as Node)) setHeaderMenuOpen(false)
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [headerMenuOpen])

  // 头部空间名重命名(仅团队空间 + 可管理者):点铅笔进入行内编辑,Enter/保存提交,Esc/取消退出。
  const [renaming, setRenaming] = useState(false)
  const [renameDraft, setRenameDraft] = useState('')
  const [renameBusy, setRenameBusy] = useState(false)
  const renameInputRef = useRef<HTMLInputElement | null>(null)

  // 用 ref 持有不影响渲染的状态，等价 Vue 的 ref（避免闭包过期 + 避免重复触发）
  const membersLoadingRef = useRef(false)
  const invitationsLoadingRef = useRef(false)
  const invitationDeleteBusyIds = useRef<Set<number>>(new Set())

  // === computed ===
  // 登录用户 id 取会话内 user.id(稳定,不随所看空间变化);currentMember 只对应会话默认空间,
  // 回退用它里面的 id。
  const sessionUserId = useWorkspaceSessionStore((s) => {
    const v = Number(s.authSession?.user?.id || 0)
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0
  })
  const currentUserId = useMemo(() => {
    if (sessionUserId > 0) return sessionUserId
    const value = currentMember?.user_id ?? currentMember?.userId ?? currentMember?.user?.id ?? currentMember?.id ?? 0
    const id = Number(value || 0)
    return Number.isFinite(id) && id > 0 ? Math.floor(id) : 0
  }, [sessionUserId, currentMember])

  // 角色以「当前所看空间的成员列表」为准。currentMember 仅对应会话默认空间,管理员查看他人团队时
  // deriveCurrentMember 会返回 null → 解析不出 admin → 顶部邀请与成员行「…」全部消失。故优先
  // 从成员列表里自己那行读取角色,列表未就绪时再回退到 currentMember。
  const currentUserRole = useMemo(() => {
    const mine = currentUserId > 0 ? members.find((m) => m.id === currentUserId) : null
    if (mine?.role) return mine.role
    return normalizeMemberRole(currentMember || {})
  }, [members, currentUserId, currentMember])
  const memberActionTargetIsAdmin = useMemo(() => {
    if (!memberActionTarget || memberActionTarget.isOwner) return false
    const normalizedRole = normalizeMemberRole(memberActionTarget.raw || memberActionTarget)
    return memberActionTarget.role === 'admin' || normalizedRole === 'admin' || memberActionTarget.roleLabel === '管理员'
  }, [memberActionTarget])
  const ownerFromProp = useMemo(() => {
    const id = Number(workspace?.owner_user_id || workspace?.ownerUserId || 0)
    return Number.isFinite(id) && id > 0 ? Math.floor(id) : 0
  }, [workspace])
  // 有效所有者:优先本地 override(转让后即时生效),否则用 workspace prop
  const ownerUserId = ownerOverrideId > 0 ? ownerOverrideId : ownerFromProp
  // prop 追上 override(转让已在父级生效)→ 清除 override,回到单一数据源
  useEffect(() => {
    if (ownerOverrideId > 0 && ownerFromProp === ownerOverrideId) setOwnerOverrideId(0)
  }, [ownerFromProp, ownerOverrideId])
  // 切换空间 / 重开弹窗时归零 override,避免把上一个团队的新所有者 id 串到别的团队
  useEffect(() => {
    setOwnerOverrideId(0)
  }, [workspaceId, open])
  const isCurrentUserOwner = useMemo(
    () => currentUserId > 0 && currentUserId === ownerUserId,
    [currentUserId, ownerUserId],
  )
  const canManageWorkspace = useMemo(
    () => isCurrentUserOwner || currentUserRole === 'admin',
    [isCurrentUserOwner, currentUserRole],
  )
  const canTransferOwnership = isCurrentUserOwner
  const canEditMemberQuota = canManageWorkspace
  // 成员行「更多操作(三个点)」显示/可操作规则 —— 能操作才显示三个点:
  //  · 所有者:可操作任何人,【包括自己】(自己那行仅「修改配额」有意义,见操作菜单);
  //  · 管理员:只能操作【成员】(不能操作所有者或其他管理员,含自己);
  //  · 成员:不能操作任何人(canManageWorkspace 为 false)。
  const canActOnMember = (m: NormalizedMember): boolean => {
    if (!canManageWorkspace) return false // 成员:不显示三个点
    if (isCurrentUserOwner) return true // 所有者:可操作任何人(含自己那行)
    if (m.isOwner) return false // 管理员:不能操作所有者
    return m.role === 'member' // 管理员:只能操作「成员」
  }
  const workspaceType = useMemo(
    () =>
      String(workspace?.type || '')
        .trim()
        .toLowerCase(),
    [workspace],
  )
  const isPersonalWorkspace = workspaceType === 'personal'
  const isTeamWorkspace = !workspaceType || workspaceType === 'team'

  // 打开弹窗时用 initialTab 定 tab(点团队空间名进来 = 'data')
  useEffect(() => {
    if (open) setActiveTab(initialTab)
  }, [open, initialTab])

  // 团队数据:切到「团队数据」tab(团队空间 + owner/admin)时加载 overview + member-statistics(字段容错解析)
  useEffect(() => {
    const wsId = Number(workspaceId || 0)
    if (!open || activeTab !== 'data' || isPersonalWorkspace || !wsId || !canManageWorkspace) return
    let alive = true
    setDataLoading(true)
    Promise.allSettled([getWorkspaceOverview(wsId), getWorkspaceMemberStatistics(wsId)])
      .then(([ov, ms]) => {
        if (!alive) return
        setOverview(ov.status === 'fulfilled' ? parseOverview(ov.value) : null)
        setMemberStats(ms.status === 'fulfilled' ? parseMemberStats(ms.value) : [])
      })
      .finally(() => {
        if (alive) setDataLoading(false)
      })
    return () => {
      alive = false
    }
  }, [open, activeTab, isPersonalWorkspace, workspaceId, canManageWorkspace])

  const displayInviteCode = useMemo(() => formatInviteCodeForDisplay(inviteCode), [inviteCode])
  // 所有者与管理员可管理/查看邀请码(邀请成员);普通成员一律隐藏:不显示码、不能复制/重新生成。
  const canManageInvite = isTeamWorkspace && canManageWorkspace
  // 席位:成员数 vs 套餐 max_members(后端真实值,不写死)。满员则不可再邀请。maxMembers=0 视为不限制。
  const memberCount = members.length
  const seatFull = maxMembers > 0 && memberCount >= maxMembers
  const canInvite = canManageInvite && !seatFull
  const inviteDisplayText = isPersonalWorkspace
    ? '个人空间不支持邀请码'
    : !canManageWorkspace
      ? '仅超级管理员或管理员可管理邀请码'
      : seatFull
        ? `席位已满(${memberCount}/${maxMembers}),暂不可再邀请`
        : displayInviteCode || '暂无邀请码'
  const inviteExpiryText = isPersonalWorkspace ? '切换到团队空间后才可邀请成员加入' : expiryDate || '-'
  const canCopyInviteCode = canInvite && Boolean(String(inviteCode || '').trim())

  // normalizeMembers 依赖 ownerUserId，因此用闭包形式定义
  const normalizeMembers = useCallback(
    (payload: any): NormalizedMember[] => {
      const list = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.items)
          ? payload.items
          : Array.isArray(payload?.list)
            ? payload.list
            : Array.isArray(payload?.members)
              ? payload.members
              : Array.isArray(payload?.records)
                ? payload.records
                : []
      const ownerId = ownerUserId
      return list
        .filter((item: any) => item && typeof item === 'object')
        .map((item: any, index: number) => {
          const userId = normalizeMemberId(item, index)
          const role = normalizeMemberRole(item)
          // 所有权通过 owner_user_id 判断，不依赖后端返回的 role 字段
          const isOwner = ownerId > 0 && userId === ownerId
          return {
            raw: item,
            id: userId,
            name: normalizeMemberName(item, `成员${index + 1}`),
            phone: normalizeMemberPhone(item),
            role,
            roleLabel: isOwner ? '超级管理员' : getRoleLabel(role),
            isOwner,
          }
        })
    },
    [ownerUserId],
  )

  const loadMembers = useCallback(async () => {
    const wsId = Number(workspaceId || 0)
    if (!wsId) {
      setMembers([])
      return
    }

    if (membersLoadingRef.current) return
    membersLoadingRef.current = true
    setMembersLoading(true)

    try {
      const result = await listWorkspaceMembers(wsId)
      setMembers(normalizeMembers(result))
    } catch (error: any) {
      setMembers([])
      onToast?.(error?.message || '成员信息加载失败', 'error')
    } finally {
      membersLoadingRef.current = false
      setMembersLoading(false)
    }
  }, [workspaceId, normalizeMembers, onToast])

  function applyActiveInvitation(invite: any) {
    const id = toInvitationId(invite)
    const code = toInvitationCode(invite)
    const expiresAt = toInvitationExpiry(invite)
    setActiveInvitationId(id)
    setInviteCode(code)
    setExpiryDate(formatExpiryDate(expiresAt))
  }

  const loadInvitations = useCallback(async () => {
    const wsId = Number(workspaceId || 0)
    if (!wsId || isPersonalWorkspace) {
      setActiveInvitationId(0)
      setInviteCode('')
      setExpiryDate('')
      return
    }
    if (invitationsLoadingRef.current) return
    invitationsLoadingRef.current = true
    try {
      const result = await listWorkspaceInvitations(wsId)
      const list = normalizeInvitations(result)
      const active = pickActiveInvitation(list)
      if (active) {
        applyActiveInvitation(active.raw)
      } else {
        // 无有效邀请码 → 显示「暂无邀请码」,由主账号手动「重新生成」。
        // 【不再自动补码】:否则主账号「撤销邀请」后重开弹窗会又自动生成,撤销形同无效。
        setActiveInvitationId(0)
        setInviteCode('')
        setExpiryDate('')
      }
    } catch (error: any) {
      setActiveInvitationId(0)
      setInviteCode('')
      setExpiryDate('')
      // 后端未放开管理员邀请码权限时会 403 → 静默降级为「暂无邀请码」,打开弹窗不弹错误
      if (!isPermissionDenied(error)) {
        onToast?.(error?.message || '邀请码信息加载失败', 'error')
      }
    } finally {
      invitationsLoadingRef.current = false
    }
  }, [workspaceId, isPersonalWorkspace, onToast])

  function closeMemberActions() {
    setMemberActionOpen(false)
    setMemberActionTarget(null)
  }

  function openMemberActions(member: NormalizedMember, event: React.MouseEvent) {
    if (!canActOnMember(member)) return
    const el = event?.currentTarget as HTMLElement | undefined
    if (!el?.getBoundingClientRect) return
    const rect = el.getBoundingClientRect()
    const left = Math.max(12, rect.right - 112)
    const top = rect.bottom + 8
    setMemberActionStyle({ left: `${Math.round(left)}px`, top: `${Math.round(top)}px` })
    setMemberActionTarget(member || null)
    setMemberActionOpen(true)
  }

  async function handleMemberAction(action: string) {
    const target = memberActionTarget
    const name = target?.name || '成员'
    const wsId = Number(workspaceId || 0)
    const userId = Number(target?.id || 0)
    if (!wsId || !userId) return
    if (memberActionLoading) return

    setMemberActionLoading(true)
    try {
      // 权限校验:管理员只能操作成员、所有者可操作任何非所有者、成员不可操作(与三个点显示规则一致)
      if (!target || !canActOnMember(target)) {
        onToast?.('你没有权限执行该操作', 'error')
        return
      }
      const targetIsOwner = Boolean(target?.isOwner)
      if (action === 'transfer' && !canTransferOwnership) {
        onToast?.('只有团队超级管理员可以转让所有权', 'error')
        return
      }
      // 踢除成员:所有者与管理员均可;管理员只能移出普通成员(由上面的 canActOnMember 限定),
      // 不能移出所有者/其他管理员;所有者可移出任何非所有者。转让所有权仍仅限所有者(见上)。
      if (action === 'remove' && !canManageWorkspace) {
        onToast?.('你没有权限移出成员', 'error')
        return
      }
      if (action === 'quota' && !canEditMemberQuota) {
        onToast?.('只有团队超级管理员或管理员可以修改成员配额', 'error')
        return
      }
      // 所有者可对自己「修改配额」;设为管理员/取消管理员/移出团队 对所有者仍无意义 → 拦截
      if ((action === 'remove' || action === 'make-admin' || action === 'set-member') && targetIsOwner) {
        onToast?.('无法对团队超级管理员执行该操作', 'error')
        return
      }
      if (action === 'remove' && currentUserId && userId === currentUserId) {
        onToast?.('如需退出团队，请在团队列表中点击删除/退出团队', 'error')
        return
      }
      if (action === 'make-admin') {
        await updateWorkspaceMemberRole({ workspaceId: wsId, userId, role: 'admin' })
        onToast?.(`已对 ${name} 设置管理员`, 'success')
        await loadMembers()
      } else if (action === 'set-member') {
        await updateWorkspaceMemberRole({ workspaceId: wsId, userId, role: 'member' })
        onToast?.(`已取消 ${name} 的管理员权限`, 'success')
        await loadMembers()
      } else if (action === 'quota') {
        const input = await requestConfirm(`为 ${name} 设置单任务积分上限 max_task_credits（非负整数，0 表示不限制）`, {
          title: '设置配额',
          inputEnabled: true,
          inputValue: '',
          inputLabel: '任务积分上限',
          inputPlaceholder: '0 表示不限制',
          confirmLabel: '保存',
        })
        if (input === null) return
        const maxTaskCredits = Number(String(input).trim())
        await updateWorkspaceMemberQuota({ workspaceId: wsId, userId, maxTaskCredits })
        onToast?.(`已更新 ${name} 的配额`, 'success')
      } else if (action === 'transfer') {
        const confirmed = await requestConfirm(`确认将该团队所有权转让给 ${name} 吗？转让后你将不再是超级管理员。`, {
          danger: true,
        })
        if (!confirmed) return
        try {
          await transferWorkspaceOwnership({ workspaceId: wsId, userId })
        } catch (transferError: any) {
          if (!memberActionTargetIsAdmin || !shouldRetryTransferViaMemberFallback(transferError)) {
            throw transferError
          }
          await updateWorkspaceMemberRole({ workspaceId: wsId, userId, role: 'member' })
          await transferWorkspaceOwnership({ workspaceId: wsId, userId })
        }
        // 立即把有效所有者切到新成员:列表所有者标记与主账号权限(邀请码/踢除/转让/解散)当场更新,
        // 不必等 loadWorkspaces 回来刷新 workspace prop,避免刷新前出现「两个所有者」。
        setOwnerOverrideId(userId)
        onToast?.(`已将团队所有权转让给 ${name}`, 'success')
        // 刷新空间(owner_user_id 变了)→ useCurrentWorkspace 更新 → prop 追上后 override 自动清除。
        await useWorkspaceSessionStore.getState().loadWorkspaces()
        await loadMembers()
      } else if (action === 'remove') {
        const confirmed = await requestConfirm(`确认将 ${name} 移出团队吗？`, { danger: true })
        if (!confirmed) return
        await removeWorkspaceMember({ workspaceId: wsId, userId })
        onToast?.(`已将 ${name} 移出团队`, 'success')
        await loadMembers()
      } else {
        onToast?.('功能即将开放', 'success')
      }
    } catch (error: any) {
      // 后端未放开管理员的踢除/改角色权限时会 403 → 友好提示,不弹通用报错
      onToast?.(
        isPermissionDenied(error) ? '你没有权限执行该操作,请联系团队超级管理员' : error?.message || '操作失败',
        'error',
      )
    } finally {
      setMemberActionLoading(false)
      closeMemberActions()
    }
  }

  // ── 空间重命名 ──
  function startRename() {
    if (!(isTeamWorkspace && canManageWorkspace) || renameBusy) return
    setRenameDraft(String(workspace?.name || '').trim())
    setRenaming(true)
  }
  function cancelRename() {
    if (renameBusy) return
    setRenaming(false)
    setRenameDraft('')
  }
  async function commitRename() {
    if (renameBusy) return
    const wsId = Number(workspaceId || 0)
    if (!wsId) return
    const current = String(workspace?.name || '').trim()
    const next = renameDraft.trim()
    if (!next || next === current) {
      // 空 / 未改动 → 直接退出编辑,不打扰
      cancelRename()
      return
    }
    // 安全校验(长度 / 控制字符 / 尖括号):不通过则停留编辑态便于修正
    const invalid = validateWorkspaceName(next)
    if (invalid) {
      onToast?.(invalid, 'error')
      return
    }
    // 不可重复:与用户名下其它空间比对(去空白 + 折叠空格 + 小写)
    const key = normalizeWorkspaceNameForCompare(next)
    const dup = deriveAllWorkspaces(useWorkspaceSessionStore.getState()).some(
      (w: any) => Number(w?.id || 0) !== wsId && normalizeWorkspaceNameForCompare(w?.name || '') === key,
    )
    if (dup) {
      onToast?.('已存在同名空间,请换一个名称', 'error')
      return
    }
    setRenameBusy(true)
    try {
      await useWorkspaceSessionStore.getState().renameTeam(wsId, next)
      onToast?.('空间名称已更新', 'success')
      setRenaming(false)
      setRenameDraft('')
    } catch (error: any) {
      // 后端查重冲突(409)→ 明确提示重名,避免落到通用「草稿保存冲突」文案
      const status = Number(error?.status || 0)
      onToast?.(status === 409 ? '已存在同名空间,请换一个名称' : error?.message || '重命名失败,请稍后重试', 'error')
    } finally {
      setRenameBusy(false)
    }
  }

  // 进入编辑态时聚焦并全选输入框,方便直接改名
  useEffect(() => {
    if (!renaming) return
    const el = renameInputRef.current
    if (el) {
      el.focus()
      el.select()
    }
  }, [renaming])

  // 关闭弹窗 / 切换空间时退出重命名态,避免把上一个空间的草稿名带过来
  useEffect(() => {
    setRenaming(false)
    setRenameDraft('')
  }, [workspaceId, open])

  // 退出该空间:子账号可直接退出;主账号(所有者)必须【先手动转让主账号权限】,单人团队引导去解散。
  async function handleLeave() {
    if (!workspaceId) return
    if (isCurrentUserOwner) {
      onToast?.(
        members.length <= 1
          ? '你是主账号且是唯一成员,无法退出。如需删除空间请用「解散该空间」。'
          : '你是主账号,退出前请先在成员列表把主账号权限转让给其他成员,再退出。',
        'error',
      )
      return
    }
    const ok = await requestConfirm('退出后你将不再看到该空间的素材、项目等数据。确定退出该空间吗?')
    if (!ok) return
    try {
      await useWorkspaceSessionStore.getState().deleteTeam(workspaceId)
      onToast?.('已退出该空间', 'success')
      close()
    } catch (error: any) {
      onToast?.(error?.message || '退出失败,请稍后重试', 'error')
    }
  }

  // 「所有者」只认当前有效 owner_user_id(单一数据源),在渲染时实时判定:
  // 这样转让后 ownerUserId 一变,列表标记立刻跟着变,无需重新拉取;同时把后端 role='owner'
  // 但并非当前所有者的成员(转让瞬间的旧主账号)降级为管理员,杜绝「两个所有者」。
  const decoratedMembers = useMemo(() => {
    // 所有者未知(prop 缺失)时不做降级,保持既有判定
    if (ownerUserId <= 0) return members
    return members.map((m) => {
      const isOwner = m.id === ownerUserId
      const role = isOwner ? 'owner' : m.role === 'owner' ? 'admin' : m.role
      if (isOwner === m.isOwner && role === m.role) return m
      return { ...m, isOwner, role, roleLabel: isOwner ? '超级管理员' : getRoleLabel(role) }
    })
  }, [members, ownerUserId])

  const filteredMembers = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return decoratedMembers
    return decoratedMembers.filter((m) => {
      const name = String(m.name || '').toLowerCase()
      const phone = String(m.phone || '')
      return name.includes(q) || phone.includes(q)
    })
  }, [query, decoratedMembers])

  function close() {
    onClose?.()
  }

  function generateCode() {
    const wsId = Number(workspaceId || 0)
    if (isPersonalWorkspace) {
      onToast?.('个人空间不支持邀请码，请切换到团队空间后再操作', 'error')
      return
    }
    if (!wsId || invitationsLoadingRef.current) return
    invitationsLoadingRef.current = true
    const previousInvitationId = Number(activeInvitationId || 0)
    createWorkspaceInvitation({ workspaceId: wsId, expiryDays })
      .then((created: any) => {
        applyActiveInvitation(created)
        onToast?.('邀请码已重新生成', 'success')
        if (previousInvitationId && toInvitationId(created) && previousInvitationId !== toInvitationId(created)) {
          invitationDeleteBusyIds.current.add(previousInvitationId)
          return deleteWorkspaceInvitation({ workspaceId: wsId, invitationId: previousInvitationId }).finally(() => {
            invitationDeleteBusyIds.current.delete(previousInvitationId)
          })
        }
        return null
      })
      .catch((error: any) => {
        onToast?.(
          isPermissionDenied(error) ? '暂无邀请码管理权限,请联系团队超级管理员' : error?.message || '邀请码生成失败',
          'error',
        )
      })
      .finally(() => {
        invitationsLoadingRef.current = false
        loadInvitations()
      })
  }

  // 撤销邀请:让当前邀请码立即失效(删除该邀请),不再生成新码 —— 无码状态保持,直到主账号「重新生成」。
  // 不影响已加入成员;仅关闭新的加入通道。
  async function handleRevoke() {
    const wsId = Number(workspaceId || 0)
    const invId = Number(activeInvitationId || 0)
    if (!wsId || !invId || invitationsLoadingRef.current) return
    const ok = await requestConfirm('撤销后当前邀请码立即失效,已发出的链接将无法再加入。确定撤销?', { danger: true })
    if (!ok) return
    invitationsLoadingRef.current = true
    invitationDeleteBusyIds.current.add(invId)
    try {
      await deleteWorkspaceInvitation({ workspaceId: wsId, invitationId: invId })
      setActiveInvitationId(0)
      setInviteCode('')
      setExpiryDate('')
      onToast?.('邀请码已撤销', 'success')
    } catch (error: any) {
      onToast?.(
        isPermissionDenied(error) ? '暂无邀请码管理权限,请联系团队超级管理员' : error?.message || '撤销失败,请稍后重试',
        'error',
      )
    } finally {
      invitationDeleteBusyIds.current.delete(invId)
      invitationsLoadingRef.current = false
    }
  }

  async function copyCode() {
    if (!canCopyInviteCode) return
    try {
      await navigator.clipboard.writeText(
        String(inviteCode || '')
          .replace(/\s+/g, '')
          .trim(),
      )
      onToast?.('邀请码已复制', 'success')
    } catch {
      onToast?.('复制失败，请手动复制', 'error')
    }
  }

  // watch props.open
  useEffect(() => {
    if (!open) {
      setQuery('')
      closeMemberActions()
      return
    }
    loadMembers()
    // 邀请码接口需「可管理空间」权限(所有者/管理员);普通成员/个人空间调它会被后端 403 →
    // 仅 canManageInvite(所有者或管理员)才拉;否则清空邀请状态。
    // ⚠ 需后端同步放开管理员对 workspace-invitation(list/create/delete)的权限,否则管理员会收到 403。
    if (canManageInvite) {
      loadInvitations()
    } else {
      setActiveInvitationId(0)
      setInviteCode('')
      setExpiryDate('')
    }
    // 拉当前空间订阅拿席位上限(max_members),供邀请前拦超额;个人空间/拉取失败按「不限制」(0)处理
    const wsId = Number(workspaceId || 0)
    if (!wsId || isPersonalWorkspace) {
      setMaxMembers(0)
    } else {
      let alive = true
      getSubscription(wsId)
        .then((sub: any) => alive && setMaxMembers(Number(sub?.max_members || 0) || 0))
        .catch(() => alive && setMaxMembers(0))
      return () => {
        alive = false
      }
    }
    // 含 workspaceId：弹窗打开期间切换空间时需重新拉取成员/邀请，避免显示上一个团队的数据
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workspaceId])

  // onMounted / onBeforeUnmount —— Escape 关闭
  useEffect(() => {
    function onKeydown(e: KeyboardEvent) {
      if (e.key !== 'Escape' || !open) return
      close()
    }
    document.addEventListener('keydown', onKeydown)
    return () => document.removeEventListener('keydown', onKeydown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <>
      {open && (
        <div className="tm-overlay" role="dialog" aria-modal="true" aria-label="团队管理">
          <button type="button" className="tm-backdrop" aria-label="关闭团队管理" onClick={close}></button>
          <section
            className="tm-modal"
            aria-label="管理您的团队"
            // 团队数据 tab:全屏展示(看板更宽敞);成员管理仍是常规小弹窗尺寸
            style={activeTab === 'data' ? { width: '96vw', height: '92vh' } : undefined}
          >
            {/* 头部:← 返回 + 空间名(+ 重命名) + 右上「…」菜单(退出/解散) */}
            <div className="tm-header">
              <button type="button" className="tm-back" aria-label="返回" onClick={close}>
                <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M12 5l-5 5 5 5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {renaming ? (
                <span className="tm-header-rename">
                  <input
                    ref={renameInputRef}
                    className="tm-header-rename-input"
                    value={renameDraft}
                    maxLength={WORKSPACE_NAME_MAX}
                    placeholder="输入空间名称"
                    disabled={renameBusy}
                    aria-label="空间名称"
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void commitRename()
                      } else if (e.key === 'Escape') {
                        e.preventDefault()
                        cancelRename()
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="tm-header-rename-ok"
                    disabled={renameBusy}
                    onClick={() => void commitRename()}
                  >
                    {renameBusy ? '保存中…' : '保存'}
                  </button>
                  <button
                    type="button"
                    className="tm-header-rename-cancel"
                    disabled={renameBusy}
                    onClick={cancelRename}
                  >
                    取消
                  </button>
                </span>
              ) : (
                <>
                  <span className="tm-header-name">
                    {workspace?.name || (isPersonalWorkspace ? '个人空间' : '团队空间')}
                  </span>
                  {isTeamWorkspace && canManageWorkspace && (
                    <button type="button" className="tm-header-edit" aria-label="重命名" onClick={startRename}>
                      <img className="tm-header-edit-img" src={editIcon} alt="" aria-hidden="true" />
                    </button>
                  )}
                </>
              )}
              <span className="tm-header-spacer" />
              {/* 「…」菜单仅剩「退出该空间」(仅子账号可见);主账号无菜单项,故不再渲染触发按钮 */}
              {isTeamWorkspace && !isCurrentUserOwner && (
                <div className="tm-header-more-wrap" ref={headerMenuRef}>
                  <button
                    type="button"
                    className="tm-header-more"
                    aria-label="更多操作"
                    aria-haspopup="menu"
                    onClick={() => setHeaderMenuOpen((v) => !v)}
                  >
                    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
                      <path d="M5 10a1.4 1.4 0 1 1 0 2.8A1.4 1.4 0 0 1 5 10Zm5 0a1.4 1.4 0 1 1 0 2.8A1.4 1.4 0 0 1 10 10Zm5 0a1.4 1.4 0 1 1 0 2.8A1.4 1.4 0 0 1 15 10Z" />
                    </svg>
                  </button>
                  {headerMenuOpen && (
                    <div className="tm-header-menu" role="menu">
                      {/* 退出:仅子账号可主动退出;主账号看不到,须先转让所有权(变子账号)后再退出 */}
                      {!isCurrentUserOwner && (
                        <button
                          type="button"
                          className="tm-header-menu-item"
                          role="menuitem"
                          onClick={() => {
                            setHeaderMenuOpen(false)
                            void handleLeave()
                          }}
                        >
                          退出该空间
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 团队空间:仅「成员管理」tab(团队数据已下线;个人空间无 tab,只显示成员) */}
            {!isPersonalWorkspace && (
              <div className="tm-tabs" style={{ display: 'flex', gap: 16, padding: '0 20px 10px' }}>
                {(['members'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setActiveTab(t)}
                    style={{
                      border: 'none',
                      background: 'none',
                      padding: '4px 2px',
                      cursor: 'pointer',
                      fontSize: 15,
                      fontWeight: activeTab === t ? 600 : 400,
                      color: activeTab === t ? '#5767e5' : '#8a8f9c',
                      borderBottom: activeTab === t ? '2px solid #5767e5' : '2px solid transparent',
                    }}
                  >
                    成员管理
                  </button>
                ))}
              </div>
            )}

            {(isPersonalWorkspace || activeTab === 'members') && (
              <>
                <div className="tm-invite-card">
                  {/* 顶行:邀请码标签 + 名额提示(左) | 撤销邀请(右) */}
                  <div className="tm-invite-row tm-invite-row--top">
                    <div className="tm-invite-labels">
                      <span className="tm-invite-label">团队邀请码</span>
                      {canManageInvite && maxMembers > 1 && (
                        <span className="tm-invite-hint">最多可邀请{maxMembers - 1}名成员</span>
                      )}
                    </div>
                    {/* 撤销邀请:仅主账号、且当前有有效邀请码时显示 → 撤销后失效、无码 */}
                    {canInvite && Number(activeInvitationId || 0) > 0 && (
                      <button type="button" className="tm-revoke" onClick={handleRevoke}>
                        <svg viewBox="0 0 16 16" aria-hidden="true">
                          <path
                            d="M3 8a5 5 0 1 1 1.6 3.7M3 8H1.6M3 8V6.4"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                        撤销邀请
                      </button>
                    )}
                  </div>

                  {/* 中行:邀请码 + 复制 */}
                  <div className="tm-invite-code">
                    <span className={isPersonalWorkspace ? 'is-muted' : undefined}>{inviteDisplayText}</span>
                    <button
                      type="button"
                      className="tm-copy"
                      aria-label="复制邀请码"
                      disabled={!canCopyInviteCode}
                      onClick={copyCode}
                    >
                      <svg viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M5.2 1.8h6.1c.8 0 1.5.7 1.5 1.5v6.1c0 .8-.7 1.5-1.5 1.5H5.2c-.8 0-1.5-.7-1.5-1.5V3.3c0-.8.7-1.5 1.5-1.5Zm0 1.2a.3.3 0 0 0-.3.3v6.1c0 .2.1.3.3.3h6.1c.2 0 .3-.1.3-.3V3.3a.3.3 0 0 0-.3-.3H5.2Z" />
                        <path d="M3.2 4.2H3c-.7 0-1.2.5-1.2 1.2v6.3c0 .7.5 1.2 1.2 1.2h6.3c.7 0 1.2-.5 1.2-1.2v-.2H4.8c-.9 0-1.6-.7-1.6-1.6V4.2Z" />
                      </svg>
                    </button>
                  </div>

                  {/* 底行:有效期(左) | 重新生成 + 有效期下拉(右) */}
                  <div className="tm-invite-row tm-invite-row--bottom">
                    <div className="tm-invite-expiry">
                      {isPersonalWorkspace
                        ? inviteExpiryText
                        : canManageWorkspace && !seatFull
                          ? `有效期至：${inviteExpiryText}`
                          : ''}
                    </div>

                    <div className="tm-invite-actions">
                      {canInvite && (
                        <button type="button" className="tm-regenerate" onClick={generateCode}>
                          <svg viewBox="0 0 16 16" aria-hidden="true">
                            <path d="M13.7 7.2a5.7 5.7 0 1 1-1.4-3.6l.1-1.2h1.2v4H9.5V5.2h1.6A4.5 4.5 0 1 0 12.6 8h1.1Z" />
                          </svg>
                          重新生成
                        </button>
                      )}

                      {canInvite && (
                        <div className="tm-expiry-select">
                          <select
                            value={expiryDays}
                            aria-label="有效期"
                            onChange={(e) => setExpiryDays(Number(e.target.value))}
                          >
                            {expiryOptions.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                          <svg viewBox="0 0 12 12" aria-hidden="true">
                            <path d="m3.5 4.5 2.5 2.5 2.5-2.5" />
                          </svg>
                        </div>
                      )}

                      {!(canManageWorkspace && isTeamWorkspace) && isPersonalWorkspace && (
                        <div className="tm-invite-placeholder">个人空间仅支持个人使用</div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="tm-members-head">
                  <h3>成员信息</h3>
                  <div className="tm-search">
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <circle cx="7" cy="7" r="5" />
                      <path d="m11 11 3 3" />
                    </svg>
                    <input
                      value={query}
                      type="text"
                      placeholder="搜索成员昵称、账号..."
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </div>
                </div>

                <div className="tm-members">
                  {membersLoading ? (
                    <div className="tm-members-empty">正在加载成员信息...</div>
                  ) : !filteredMembers.length ? (
                    <div className="tm-members-empty">暂无成员</div>
                  ) : (
                    filteredMembers.map((m) => (
                      <div key={m.id} className="tm-member">
                        <div className="tm-avatar" aria-hidden="true">
                          <span>{String(m.name).trim().charAt(0).toUpperCase()}</span>
                        </div>
                        <div className="tm-member-meta">
                          <div className="tm-member-name">
                            <strong>{m.name}</strong>
                            {m.roleLabel && (
                              <span className="tm-role-badge" data-role={m.isOwner ? 'owner' : m.role}>
                                {m.roleLabel}
                              </span>
                            )}
                          </div>
                          <span>{m.phone || '-'}</span>
                        </div>
                        {canActOnMember(m) && (
                          <button
                            type="button"
                            className="tm-more"
                            aria-label="更多操作"
                            onClick={(e) => {
                              e.stopPropagation()
                              openMemberActions(m, e)
                            }}
                          >
                            <svg viewBox="0 0 20 20" aria-hidden="true">
                              <path d="M5 10a1.4 1.4 0 1 1 0 2.8A1.4 1.4 0 0 1 5 10Zm5-0a1.4 1.4 0 1 1 0 2.8A1.4 1.4 0 0 1 10 10Zm5 0a1.4 1.4 0 1 1 0 2.8A1.4 1.4 0 0 1 15 10Z" />
                            </svg>
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </>
            )}

            {/* 团队数据看板(团队空间 + 团队数据 tab):总览 + 每个成员统计。接口 owner/admin,非管理者提示无权限。 */}
            {!isPersonalWorkspace && activeTab === 'data' && (
              <div className="tm-data" style={{ padding: '0 20px 20px' }}>
                {!canManageWorkspace ? (
                  <div className="tm-members-empty">仅主账号 / 管理员可查看团队数据</div>
                ) : dataLoading ? (
                  <div className="tm-members-empty">正在加载团队数据…</div>
                ) : (
                  <>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
                      {[
                        {
                          label: '成员人数',
                          value: overview?.members ?? memberStats.length,
                          unit: '人',
                          bg: '#f3ecfd',
                          fg: '#a855f7',
                          ico: IcoMembers,
                        },
                        {
                          label: '项目个数',
                          value: overview?.projects ?? 0,
                          unit: '个',
                          bg: '#e9eeff',
                          fg: '#5b8def',
                          ico: IcoProjects,
                        },
                        {
                          label: '总生成视频数',
                          value: overview?.videos ?? 0,
                          unit: '个',
                          bg: '#e3f7f0',
                          fg: '#32c7a6',
                          ico: IcoVideos,
                        },
                        {
                          label: '平均每个视频消耗积分数',
                          value: avgPerVideo(overview?.credits ?? 0, overview?.videos ?? 0),
                          unit: '积分/个',
                          bg: '#fff0e5',
                          fg: '#f5934f',
                          ico: IcoAvg,
                        },
                        {
                          label: '消耗积分总数',
                          value: overview?.credits ?? 0,
                          unit: '积分',
                          bg: '#fdeaea',
                          fg: '#e5574f',
                          ico: IcoCredits,
                        },
                      ].map((c) => (
                        <div
                          key={c.label}
                          style={{
                            flex: '1 1 160px',
                            minWidth: 150,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 12,
                            background: '#fff',
                            border: '1px solid #eef0f4',
                            borderRadius: 12,
                            padding: '14px 16px',
                          }}
                        >
                          <span
                            style={{
                              flex: '0 0 auto',
                              width: 40,
                              height: 40,
                              borderRadius: 10,
                              background: c.bg,
                              color: c.fg,
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            {c.ico}
                          </span>
                          <span style={{ minWidth: 0 }}>
                            <span style={{ display: 'block', fontSize: 13, color: '#8a8f9c', marginBottom: 4 }}>
                              {c.label}
                            </span>
                            <span style={{ fontSize: 20, fontWeight: 700, color: '#2b2f38' }}>{c.value}</span>
                            <span style={{ fontSize: 12, color: '#8a8f9c', marginLeft: 3 }}>{c.unit}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                      <div style={{ minWidth: 680 }}>
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '1.1fr 1.4fr 1fr 1.2fr 1.2fr 1.7fr',
                            gap: 6,
                            padding: '12px 16px',
                            fontSize: 14,
                            fontWeight: 600,
                            color: '#4a4f5c',
                            background: '#eef1fb',
                            borderRadius: 10,
                          }}
                        >
                          <span>成员</span>
                          <span>成员账号</span>
                          <span>项目个数</span>
                          <span>总生成视频数</span>
                          <span>消耗积分数</span>
                          <span>平均每个视频消耗积分数</span>
                        </div>
                        {memberStats.length ? (
                          memberStats.map((m, i) => (
                            <div
                              key={String(m.id || i)}
                              style={{
                                display: 'grid',
                                gridTemplateColumns: '1.1fr 1.4fr 1fr 1.2fr 1.2fr 1.7fr',
                                gap: 6,
                                padding: '14px 16px',
                                fontSize: 14,
                                color: '#2b2f38',
                                borderBottom: '1px solid #f0f1f5',
                              }}
                            >
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {m.name}
                              </span>
                              <span>{m.phone || '-'}</span>
                              <span>{m.projects}</span>
                              <span>{m.videos}</span>
                              <span>{m.credits}</span>
                              <span>{avgPerVideo(m.credits, m.videos)}</span>
                            </div>
                          ))
                        ) : (
                          <div className="tm-members-empty">暂无成员数据</div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </section>
        </div>
      )}

      {memberActionOpen &&
        createPortal(
          <div className="tm-action-layer" aria-label="成员操作">
            <button
              type="button"
              className="tm-action-backdrop"
              aria-label="关闭成员操作"
              onClick={closeMemberActions}
            ></button>
            <div className="tm-action-menu" style={memberActionStyle} onClick={(e) => e.stopPropagation()}>
              {/* 所有者行(含所有者操作自己):仅「修改配额」有意义,角色变更/转让/移出对所有者一律隐藏 */}
              {/* 角色切换:仅所有者可用;成员显示「设为管理员」,管理员显示「取消管理员」 */}
              {isCurrentUserOwner && !memberActionTarget?.isOwner && !memberActionTargetIsAdmin && (
                <button type="button" className="tm-action-item" onClick={() => handleMemberAction('make-admin')}>
                  设为管理员
                </button>
              )}
              {isCurrentUserOwner && !memberActionTarget?.isOwner && memberActionTargetIsAdmin && (
                <button type="button" className="tm-action-item" onClick={() => handleMemberAction('set-member')}>
                  取消管理员
                </button>
              )}
              {canEditMemberQuota && (
                <button type="button" className="tm-action-item" onClick={() => handleMemberAction('quota')}>
                  修改配额
                </button>
              )}
              {canTransferOwnership && !memberActionTarget?.isOwner && (
                <button type="button" className="tm-action-item" onClick={() => handleMemberAction('transfer')}>
                  转让所有权
                </button>
              )}
              {/* 踢除成员:所有者与管理员均可(管理员仅对成员行有菜单,故只会移出成员);不对所有者显示 */}
              {canManageWorkspace && !memberActionTarget?.isOwner && (
                <button type="button" className="tm-action-item" onClick={() => handleMemberAction('remove')}>
                  移出团队
                </button>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
