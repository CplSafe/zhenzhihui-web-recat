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
  listWorkspaceInvitations,
  removeWorkspaceMember,
  transferWorkspaceOwnership,
  updateWorkspaceMemberQuota,
  updateWorkspaceMemberRole,
} from '@/api/business'
import { useConfirmDialog } from '@/composables/useToast'
import './TeamManagementModal.css'

type ToastType = 'success' | 'error'

interface TeamManagementModalProps {
  open?: boolean
  workspaceId?: number
  workspace?: Record<string, any> | null
  currentMember?: Record<string, any> | null
  onClose?: () => void
  onToast?: (message: string, type?: ToastType) => void
}

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
  onClose,
  onToast,
}: TeamManagementModalProps) {
  const { requestConfirm } = useConfirmDialog()

  const [inviteCode, setInviteCode] = useState('')
  const [expiryDate, setExpiryDate] = useState('')
  const [activeInvitationId, setActiveInvitationId] = useState(0)
  const [expiryDays, setExpiryDays] = useState(7)

  const [query, setQuery] = useState('')

  const [membersLoading, setMembersLoading] = useState(false)
  const [members, setMembers] = useState<NormalizedMember[]>([])
  const [memberActionLoading, setMemberActionLoading] = useState(false)

  const [memberActionOpen, setMemberActionOpen] = useState(false)
  const [memberActionTarget, setMemberActionTarget] = useState<NormalizedMember | null>(null)
  const [memberActionStyle, setMemberActionStyle] = useState<React.CSSProperties>({})

  // 用 ref 持有不影响渲染的状态，等价 Vue 的 ref（避免闭包过期 + 避免重复触发）
  const membersLoadingRef = useRef(false)
  const invitationsLoadingRef = useRef(false)
  const invitationDeleteBusyIds = useRef<Set<number>>(new Set())
  const invitationAutoEnsuredWorkspaceId = useRef(0)

  // === computed ===
  const currentUserId = useMemo(() => {
    const value =
      currentMember?.user_id ??
      currentMember?.userId ??
      currentMember?.user?.id ??
      currentMember?.id ??
      0
    const id = Number(value || 0)
    return Number.isFinite(id) && id > 0 ? Math.floor(id) : 0
  }, [currentMember])

  const currentUserRole = useMemo(() => normalizeMemberRole(currentMember || {}), [currentMember])
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
  const workspaceType = useMemo(
    () => String(workspace?.type || '').trim().toLowerCase(),
    [workspace],
  )
  const isPersonalWorkspace = workspaceType === 'personal'
  const isTeamWorkspace = !workspaceType || workspaceType === 'team'

  const displayInviteCode = useMemo(() => formatInviteCodeForDisplay(inviteCode), [inviteCode])
  const inviteDisplayText = isPersonalWorkspace
    ? '个人空间不支持邀请码'
    : displayInviteCode || '暂无邀请码'
  const inviteExpiryText = isPersonalWorkspace
    ? '切换到团队空间后才可邀请成员加入'
    : expiryDate || '-'
  const canCopyInviteCode = isTeamWorkspace && Boolean(String(inviteCode || '').trim())

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
      invitationAutoEnsuredWorkspaceId.current = 0
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
        setActiveInvitationId(0)
        setInviteCode('')
        setExpiryDate('')
        if (open && invitationAutoEnsuredWorkspaceId.current !== wsId) {
          invitationAutoEnsuredWorkspaceId.current = wsId
          createWorkspaceInvitation({ workspaceId: wsId, expiryDays })
            .then((created: any) => {
              applyActiveInvitation(created)
            })
            .catch((error: any) => {
              onToast?.(error?.message || '邀请码生成失败', 'error')
            })
        }
      }
    } catch (error: any) {
      setActiveInvitationId(0)
      setInviteCode('')
      setExpiryDate('')
      onToast?.(error?.message || '邀请码信息加载失败', 'error')
    } finally {
      invitationsLoadingRef.current = false
    }
  }, [workspaceId, isPersonalWorkspace, open, expiryDays, onToast])

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
        const input = await requestConfirm(
          `为 ${name} 设置单任务积分上限 max_task_credits（非负整数，0 表示不限制）`,
          {
            title: '设置配额',
            inputEnabled: true,
            inputValue: '',
            inputLabel: '任务积分上限',
            inputPlaceholder: '0 表示不限制',
            confirmLabel: '保存',
          },
        )
        if (input === null) return
        const maxTaskCredits = Number(String(input).trim())
        await updateWorkspaceMemberQuota({ workspaceId: wsId, userId, maxTaskCredits })
        onToast?.(`已更新 ${name} 的配额`, 'success')
      } else if (action === 'transfer') {
        const confirmed = await requestConfirm(
          `确认将该团队所有权转让给 ${name} 吗？转让后你将不再是所有者。`,
          { danger: true },
        )
        if (!confirmed) return
        await transferWorkspaceOwnership({ workspaceId: wsId, userId })
        onToast?.(`已将团队所有权转让给 ${name}`, 'success')
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

  const filteredMembers = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return members
    return members.filter((m) => {
      const name = String(m.name || '').toLowerCase()
      const phone = String(m.phone || '')
      return name.includes(q) || phone.includes(q)
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
    loadInvitations()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

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
            <button type="button" className="tm-close" aria-label="关闭" onClick={close}>
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M11.06 10l4.22-4.22a.75.75 0 0 0-1.06-1.06L10 8.94 5.78 4.72a.75.75 0 1 0-1.06 1.06L8.94 10l-4.22 4.22a.75.75 0 1 0 1.06 1.06L10 11.06l4.22 4.22a.75.75 0 0 0 1.06-1.06L11.06 10z" />
              </svg>
            </button>

            <h2 className="tm-title">管理您的团队</h2>

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
                  {isPersonalWorkspace ? inviteExpiryText : `有效期至：${inviteExpiryText}`}
                </div>
              </div>

              <div className="tm-invite-right">
                {canManageWorkspace && isTeamWorkspace && (
                  <button type="button" className="tm-regenerate" onClick={generateCode}>
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M13.7 7.2a5.7 5.7 0 1 1-1.4-3.6l.1-1.2h1.2v4H9.5V5.2h1.6A4.5 4.5 0 1 0 12.6 8h1.1Z" />
                    </svg>
                    重新生成
                  </button>
                )}

                {canManageWorkspace && isTeamWorkspace && (
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
                      <span>{m.phone || '-'}</span>
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
              <button type="button" className="tm-action-item" onClick={() => handleMemberAction('make-admin')}>
                设为管理员
              </button>
              <button type="button" className="tm-action-item" onClick={() => handleMemberAction('set-member')}>
                设为成员
              </button>
              <button type="button" className="tm-action-item" onClick={() => handleMemberAction('quota')}>
                修改配额
              </button>
              {canTransferOwnership && (
                <button type="button" className="tm-action-item" onClick={() => handleMemberAction('transfer')}>
                  转让所有权
                </button>
              )}
              <button type="button" className="tm-action-item" onClick={() => handleMemberAction('remove')}>
                移出团队
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
