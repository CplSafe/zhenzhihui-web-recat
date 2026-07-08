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
  listWorkspaceInvitations,
  removeWorkspaceMember,
  transferWorkspaceOwnership,
  updateWorkspaceMemberQuota,
  updateWorkspaceMemberRole,
} from '@/api/business'
import { useWorkspaceSessionStore } from '@/stores/workspaceSession'
import { useConfirmDialog } from '@/composables/useToast'
import './TeamManagementModal.css'

type ToastType = 'success' | 'error'

interface TeamManagementModalProps {
  open?: boolean
  workspaceId?: number
  workspace?: Record<string, any> | null
  currentMember?: Record<string, any> | null
  /** 会话级用户 id(不随切换空间失效);用于在成员列表里定位「我」→ 取当前空间的真实角色 */
  sessionUserId?: number
  onClose?: () => void
  onToast?: (message: string, type?: ToastType) => void
}

interface NormalizedMember {
  raw: any
  id: number
  name: string
  email: string
  mobile: string
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

// 后端 MemberView 返回 email 与 mobile(手机号,DeepAuth 回传)。账号展示优先手机号、回退 email。
function normalizeMemberEmail(member: any): string {
  return pickFirstText(member?.email, member?.user?.email, member?.account?.email, member?.profile?.email)
}

function normalizeMemberMobile(member: any): string {
  return pickFirstText(
    member?.mobile,
    member?.phone,
    member?.user?.mobile,
    member?.user?.phone,
    member?.account?.mobile,
    member?.profile?.mobile,
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
  if (role === 'owner') return '所有者'
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
  const acceptedAt = String(invitation.acceptedAt || '').trim()
  if (acceptedAt) return false
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
  workspaceId = 0,
  workspace = null,
  currentMember = null,
  sessionUserId = 0,
  onClose,
  onToast,
}: TeamManagementModalProps) {
  const { requestConfirm } = useConfirmDialog()

  const [inviteCode, setInviteCode] = useState('')
  const [expiryDate, setExpiryDate] = useState('')
  const [activeInvitationId, setActiveInvitationId] = useState(0)
  const [expiryDays, setExpiryDays] = useState(7)
  // 席位上限:来自当前空间的订阅套餐(max_members)。0 = 未知/不限制,不拦邀请。
  const [maxMembers, setMaxMembers] = useState(0)

  const [query, setQuery] = useState('')

  const [membersLoading, setMembersLoading] = useState(false)
  const [members, setMembers] = useState<NormalizedMember[]>([])
  const [memberActionLoading, setMemberActionLoading] = useState(false)

  const [memberActionOpen, setMemberActionOpen] = useState(false)
  const [memberActionTarget, setMemberActionTarget] = useState<NormalizedMember | null>(null)
  const [memberActionStyle, setMemberActionStyle] = useState<React.CSSProperties>({})
  // 头部右上「…」菜单:退出 / 解散该空间
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

  // 用 ref 持有不影响渲染的状态，等价 Vue 的 ref（避免闭包过期 + 避免重复触发）
  const membersLoadingRef = useRef(false)
  const invitationsLoadingRef = useRef(false)
  const invitationDeleteBusyIds = useRef<Set<number>>(new Set())

  // === computed ===
  // 当前用户 id:优先会话级(不随切空间失效);回退到 currentMember(仅在会话初始空间时有效)。
  const currentUserId = useMemo(() => {
    const value =
      sessionUserId ||
      currentMember?.user_id ||
      currentMember?.userId ||
      currentMember?.user?.id ||
      currentMember?.id ||
      0
    const id = Number(value || 0)
    return Number.isFinite(id) && id > 0 ? Math.floor(id) : 0
  }, [sessionUserId, currentMember])

  // 当前用户在【当前激活空间】的角色:从该空间已加载的 members 列表里按 id 取(切换空间后仍准确);
  // members 未加载时回退到 currentMember 的角色(仅会话初始空间有效)。
  // 修复:此前只读 currentMember,切换空间后它被置 null → owner/admin 的管理入口全部消失。
  const currentUserRole = useMemo(() => {
    const fromList = members.find((m) => m.id === currentUserId)?.role
    return fromList || normalizeMemberRole(currentMember || {})
  }, [members, currentUserId, currentMember])
  const ownerUserId = useMemo(() => {
    const id = Number(workspace?.owner_user_id || workspace?.ownerUserId || 0)
    return Number.isFinite(id) && id > 0 ? Math.floor(id) : 0
  }, [workspace])
  const isCurrentUserOwner = useMemo(
    () => currentUserId > 0 && currentUserId === ownerUserId,
    [currentUserId, ownerUserId],
  )
  const canManageWorkspace = useMemo(
    () => isCurrentUserOwner || currentUserRole === 'admin',
    [isCurrentUserOwner, currentUserRole],
  )
  const canTransferOwnership = isCurrentUserOwner
  // 操作目标当前是否为管理员 → 决定角色按钮显示「取消管理员」还是「设为管理员」
  const memberActionTargetIsAdmin = useMemo(
    () => normalizeMemberRole(memberActionTarget || {}) === 'admin',
    [memberActionTarget],
  )
  const workspaceType = useMemo(
    () =>
      String(workspace?.type || '')
        .trim()
        .toLowerCase(),
    [workspace],
  )
  const isPersonalWorkspace = workspaceType === 'personal'
  const isTeamWorkspace = !workspaceType || workspaceType === 'team'

  const displayInviteCode = useMemo(() => formatInviteCodeForDisplay(inviteCode), [inviteCode])
  // 仅主账号(空间所有者)可管理/查看邀请码;非所有者(管理员/成员)一律隐藏:不显示码、不能复制/重新生成。
  const canManageInvite = isTeamWorkspace && isCurrentUserOwner
  // 席位:成员数 vs 套餐 max_members(后端真实值,不写死)。满员则不可再邀请。maxMembers=0 视为不限制。
  const memberCount = members.length
  const seatFull = maxMembers > 0 && memberCount >= maxMembers
  const canInvite = canManageInvite && !seatFull
  const inviteDisplayText = isPersonalWorkspace
    ? '个人空间不支持邀请码'
    : !isCurrentUserOwner
      ? '仅空间所有者可管理邀请码'
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
            email: normalizeMemberEmail(item),
            mobile: normalizeMemberMobile(item),
            role,
            roleLabel: isOwner ? '所有者' : getRoleLabel(role),
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
      onToast?.(error?.message || '邀请码信息加载失败', 'error')
    } finally {
      invitationsLoadingRef.current = false
    }
  }, [workspaceId, isPersonalWorkspace, onToast])

  function closeMemberActions() {
    setMemberActionOpen(false)
    setMemberActionTarget(null)
  }

  function openMemberActions(member: NormalizedMember, event: React.MouseEvent) {
    if (!canManageWorkspace) return
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
      if (!canManageWorkspace) {
        onToast?.('你没有权限执行该操作', 'error')
        return
      }
      const targetIsOwner = Boolean(target?.isOwner)
      if (action === 'transfer' && !canTransferOwnership) {
        onToast?.('只有团队所有者可以转让所有权', 'error')
        return
      }
      // 踢除成员:仅主账号(所有者),管理员不可
      if (action === 'remove' && !isCurrentUserOwner) {
        onToast?.('只有主账号可以移出成员', 'error')
        return
      }
      if (
        (action === 'remove' || action === 'make-admin' || action === 'set-member' || action === 'quota') &&
        targetIsOwner
      ) {
        onToast?.('无法对团队所有者执行该操作', 'error')
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
        onToast?.(`已对 ${name} 设置成员`, 'success')
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
        const confirmed = await requestConfirm(`确认将该团队所有权转让给 ${name} 吗？转让后你将不再是所有者。`, {
          danger: true,
        })
        if (!confirmed) return
        await transferWorkspaceOwnership({ workspaceId: wsId, userId })
        onToast?.(`已将团队所有权转让给 ${name}`, 'success')
        // 刷新空间(owner_user_id 变了)→ useCurrentWorkspace 更新 → isCurrentUserOwner 立刻变 false,
        // 原主账号当场降级为子账号:邀请码/踢除/转让/解散等主账号功能即时消失;成员列表所有者标记也更新。
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
      onToast?.(error?.message || '操作失败', 'error')
    } finally {
      setMemberActionLoading(false)
      closeMemberActions()
    }
  }

  // 解散该空间(仅所有者):强确认——解散后素材/项目/数据全部清空,不可恢复。
  async function handleDisband() {
    if (!workspaceId) return
    const ok = await requestConfirm('解散空间后,该空间的所有素材、项目及数据都将被清空,且不可恢复。确定解散该空间吗?', {
      danger: true,
    })
    if (!ok) return
    try {
      await useWorkspaceSessionStore.getState().disbandTeam(workspaceId)
      onToast?.('空间已解散', 'success')
      close()
    } catch (error: any) {
      onToast?.(error?.message || '解散失败,请稍后重试', 'error')
    }
  }

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

  const filteredMembers = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return members
    return members.filter((m) => {
      const name = String(m.name || '').toLowerCase()
      const email = String(m.email || '').toLowerCase()
      const mobile = String(m.mobile || '').toLowerCase()
      return name.includes(q) || email.includes(q) || mobile.includes(q)
    })
  }, [query, members])

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
        onToast?.(error?.message || '邀请码生成失败', 'error')
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
      onToast?.(error?.message || '撤销失败,请稍后重试', 'error')
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
    // 邀请码是【主账号专属】接口:非主账号(子账号/管理员)/个人空间调它会被后端 403「无权管理该 workspace」。
    // 子账号只是来看成员列表,不该碰邀请码接口 → 仅 canManageInvite(团队所有者)才拉;否则清空邀请状态。
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
          <section className="tm-modal" aria-label="管理您的团队">
            {/* 头部:← 返回 + 空间名(+ 重命名) + 右上「…」菜单(退出/解散) */}
            <div className="tm-header">
              <button type="button" className="tm-back" aria-label="返回" onClick={close}>
                <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M12 5l-5 5 5 5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <span className="tm-header-name">
                {workspace?.name || (isPersonalWorkspace ? '个人空间' : '团队空间')}
              </span>
              {isTeamWorkspace && canManageWorkspace && (
                <button
                  type="button"
                  className="tm-header-edit"
                  aria-label="重命名"
                  onClick={() => onToast?.('重命名功能暂未开放', 'success')}
                >
                  <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <path
                      d="M4 13.5V16h2.5l7-7-2.5-2.5-7 7zM12.5 5l2.5 2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              )}
              <span className="tm-header-spacer" />
              {isTeamWorkspace && (
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
                      {/* 退出:仅子账号可主动退出;主账号看不到,须先转让所有权(变子账号)或解散 */}
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
                      {isCurrentUserOwner && (
                        <button
                          type="button"
                          className="tm-header-menu-item tm-header-menu-item--danger"
                          role="menuitem"
                          onClick={() => {
                            setHeaderMenuOpen(false)
                            void handleDisband()
                          }}
                        >
                          解散该空间
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="tm-invite-card">
              <div className="tm-invite-left">
                <div className="tm-invite-label">团队邀请码</div>
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
                <div className="tm-invite-expiry">
                  {isPersonalWorkspace
                    ? inviteExpiryText
                    : isCurrentUserOwner && !seatFull
                      ? `有效期至：${inviteExpiryText}`
                      : ''}
                </div>
              </div>

              <div className="tm-invite-right">
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
                      <span>{m.mobile || m.email || '-'}</span>
                    </div>
                    {canManageWorkspace && (
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
              {/* 改角色后端仅 owner 可执行(admin 调用必 403),故只对 owner 展示;所有者自身行不显示角色切换。
                  按目标当前角色只显示对应一个按钮:管理员→「取消管理员」(降为成员),成员→「设为管理员」。 */}
              {isCurrentUserOwner &&
                !memberActionTarget?.isOwner &&
                (memberActionTargetIsAdmin ? (
                  <button type="button" className="tm-action-item" onClick={() => handleMemberAction('set-member')}>
                    取消管理员
                  </button>
                ) : (
                  <button type="button" className="tm-action-item" onClick={() => handleMemberAction('make-admin')}>
                    设为管理员
                  </button>
                ))}
              <button type="button" className="tm-action-item" onClick={() => handleMemberAction('quota')}>
                修改配额
              </button>
              {canTransferOwnership && (
                <button type="button" className="tm-action-item" onClick={() => handleMemberAction('transfer')}>
                  转让所有权
                </button>
              )}
              {/* 踢除成员:仅主账号(所有者),管理员不可 */}
              {isCurrentUserOwner && (
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
