import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AppSidebar from '@/components/home/AppSidebar'
import AppTopbar from '@/components/layout/AppTopbar'
import { getBusinessErrorMessage, getWorkspaceMemberStatistics, getWorkspaceOverview } from '@/api/business'
import { listWorkspaceMembers } from '@/api/auth'
import { useCurrentMember, useCurrentUser, useCurrentWorkspace, useWorkspaceId } from '@/stores/workspaceSession'
import { openComingSoon } from '@/stores/ui'
import './SpaceDashboardView.css'

const ROUTE_MAP: Record<string, string> = {
  home: '/home',
  creative: '/smart',
  'hot-copy': '/hot-copy',
  projects: '/projects',
  resources: '/resources',
  templates: '/templates',
  team: '/team',
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

type OverviewMetrics = {
  members: number
  projects: number
  videos: number
  credits: number
}

type MemberStatRow = {
  id: string | number
  name: string
  phone: string
  projects: number
  videos: number
  credits: number
}

function pickNum(obj: any, keys: string[]): number {
  if (!obj || typeof obj !== 'object') return 0
  for (const key of keys) {
    const value = obj[key]
    if (value !== undefined && value !== null && value !== '' && Number.isFinite(Number(value))) {
      return Number(value)
    }
  }
  return 0
}

function pickText(...values: any[]): string {
  const found = values.find((value) => String(value ?? '').trim())
  return found ? String(found).trim() : ''
}

function parseOverview(payload: any): OverviewMetrics {
  const source = payload && typeof payload === 'object' ? payload : {}
  const nested = source.total ?? source.cumulative ?? source.all ?? source.overall ?? source.data
  const base = nested && typeof nested === 'object' ? nested : source
  const num = (keys: string[]) => pickNum(base, keys) || pickNum(source, keys)
  return {
    members: num(MEMBER_KEYS),
    projects: num(PROJECT_KEYS),
    videos: num(VIDEO_KEYS),
    credits: num(CREDIT_KEYS),
  }
}

function parseMemberStats(payload: any): MemberStatRow[] {
  const rawList = Array.isArray(payload)
    ? payload
    : (payload?.items ?? payload?.list ?? payload?.records ?? payload?.members ?? payload?.data ?? [])
  const list = Array.isArray(rawList) ? rawList : []

  return list
    .filter((item: any) => item && typeof item === 'object')
    .map((item: any) => {
      const base = item.total ?? item.cumulative ?? item
      const num = (keys: string[]) => pickNum(base, keys) || pickNum(item, keys)
      return {
        id: item.user_id ?? item.userId ?? item.id ?? item.member_id ?? '',
        name: pickText(item.nickname, item.name, item.user_name, item.member_name, item.username, '成员'),
        phone: pickText(item.phone, item.mobile, item.account, item.username),
        projects: num(PROJECT_KEYS),
        videos: num(VIDEO_KEYS),
        credits: num(CREDIT_KEYS),
      }
    })
}

function normalizeMemberPhone(member: any): string {
  return pickText(
    member?.phone,
    member?.mobile,
    member?.account,
    member?.username,
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

function avgPerVideo(credits: number, videos: number): number {
  return videos > 0 ? Math.round((credits / videos) * 10) / 10 : 0
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(Number.isFinite(value) ? value : 0)
}

const ICON_BOXES = [
  {
    key: 'members',
    label: '成员人数',
    unit: '人',
    colorClass: 'violet',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z" />
        <path d="M4 20a8 8 0 0 1 16 0" />
        <path d="M18.5 8.5a2.5 2.5 0 1 0-2.1-4" />
      </svg>
    ),
  },
  {
    key: 'projects',
    label: '项目个数',
    unit: '个',
    colorClass: 'blue',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
      </svg>
    ),
  },
  {
    key: 'videos',
    label: '总生成视频数',
    unit: '个',
    colorClass: 'green',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="5" width="18" height="14" rx="3" />
        <path d="m10 9 5 3-5 3z" />
      </svg>
    ),
  },
  {
    key: 'avg',
    label: '平均每个视频消耗积分数',
    unit: '积分/个',
    colorClass: 'orange',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 19h16" />
        <path d="M7 16V9" />
        <path d="M12 16V5" />
        <path d="M17 16v-4" />
      </svg>
    ),
  },
  {
    key: 'credits',
    label: '消耗积分总数',
    unit: '积分',
    colorClass: 'red',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3v18" />
        <path d="M16.5 7.5A4.5 4.5 0 0 0 12 5H9.8A2.8 2.8 0 0 0 7 7.8c0 1.5 1.2 2.7 2.7 2.7h4.6a2.7 2.7 0 1 1 0 5.5H12A4.5 4.5 0 0 1 7.5 13.5" />
      </svg>
    ),
  },
]

export default function SpaceDashboardView() {
  const navigate = useNavigate()
  const workspaceId = useWorkspaceId()
  const currentWorkspace = useCurrentWorkspace() as any
  const currentUser = useCurrentUser() as any
  const currentMember = useCurrentMember() as any

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [overview, setOverview] = useState<OverviewMetrics | null>(null)
  const [memberStats, setMemberStats] = useState<MemberStatRow[]>([])
  const [updatedAt, setUpdatedAt] = useState('')

  const workspaceType = String(currentWorkspace?.type || '')
    .trim()
    .toLowerCase()
  const isPersonalWorkspace = workspaceType === 'personal'
  const ownerUserId = Number(currentWorkspace?.owner_user_id || currentWorkspace?.ownerUserId || 0)
  const currentUserId = Number(currentUser?.id || currentUser?.user_id || 0)
  const currentRole = String(
    currentMember?.workspace_role ||
      currentMember?.workspaceRole ||
      currentMember?.role ||
      currentMember?.member_role ||
      '',
  )
    .trim()
    .toLowerCase()
  const canRevealWorkspaceInfo =
    isPersonalWorkspace ||
    currentRole === 'member' ||
    currentRole === 'admin' ||
    (ownerUserId > 0 && currentUserId === ownerUserId)
  const canViewDashboard =
    !isPersonalWorkspace && (currentRole === 'admin' || (ownerUserId > 0 && currentUserId === ownerUserId))

  const statCards = useMemo(() => {
    const totalCredits = overview?.credits ?? 0
    const totalVideos = overview?.videos ?? 0
    return ICON_BOXES.map((item) => {
      if (item.key === 'avg') {
        return { ...item, value: avgPerVideo(totalCredits, totalVideos) }
      }
      return { ...item, value: overview?.[item.key as keyof OverviewMetrics] ?? 0 }
    })
  }, [overview])

  const handleNavigate = (key: string) => {
    const path = ROUTE_MAP[key]
    if (path) navigate(path)
    else openComingSoon()
  }

  const loadDashboard = useCallback(
    async (showLoading = true) => {
      const wsId = Number(workspaceId || 0)
      if (showLoading) setLoading(true)
      else setRefreshing(true)
      setError('')

      if (!wsId) {
        setOverview(null)
        setMemberStats([])
        setLoading(false)
        setRefreshing(false)
        return
      }

      if (isPersonalWorkspace) {
        setOverview(null)
        setMemberStats([])
        setLoading(false)
        setRefreshing(false)
        return
      }

      if (!canViewDashboard) {
        setOverview(null)
        setMemberStats([])
        setLoading(false)
        setRefreshing(false)
        return
      }

      const [overviewResult, memberResult, membersResult] = await Promise.allSettled([
        getWorkspaceOverview(wsId),
        getWorkspaceMemberStatistics(wsId),
        listWorkspaceMembers(wsId),
      ])

      if (overviewResult.status === 'fulfilled') {
        setOverview(parseOverview(overviewResult.value))
      } else {
        setOverview(null)
      }

      if (memberResult.status === 'fulfilled') {
        let rows = parseMemberStats(memberResult.value)
        if (membersResult.status === 'fulfilled') {
          const rawList = Array.isArray(membersResult.value)
            ? membersResult.value
            : (membersResult.value?.items ??
              membersResult.value?.list ??
              membersResult.value?.records ??
              membersResult.value?.members ??
              membersResult.value?.data ??
              [])
          const list = Array.isArray(rawList) ? rawList : []
          const phoneById = new Map<number, string>()
          for (const item of list) {
            if (!item || typeof item !== 'object') continue
            const id = Number(item?.id || item?.user_id || item?.userId || 0)
            if (!Number.isFinite(id) || id <= 0) continue
            const phone = normalizeMemberPhone(item)
            if (phone) phoneById.set(Math.floor(id), phone)
          }
          rows = rows.map((row) => {
            if (row.phone) return row
            const id = Number(row.id || 0)
            if (!Number.isFinite(id) || id <= 0) return row
            return { ...row, phone: phoneById.get(Math.floor(id)) || '' }
          })
        }
        setMemberStats(rows)
      } else {
        setMemberStats([])
      }

      if (
        overviewResult.status === 'rejected' &&
        memberResult.status === 'rejected' &&
        (membersResult.status === 'fulfilled' || membersResult.status === 'rejected')
      ) {
        setError(
          getBusinessErrorMessage(
            overviewResult.reason,
            overviewResult.reason?.message || memberResult.reason?.message || '空间数据加载失败',
          ),
        )
      } else if (overviewResult.status === 'rejected' || memberResult.status === 'rejected') {
        setError('部分数据加载失败，当前已展示后端可返回的真实数据')
      }

      setUpdatedAt(new Date().toLocaleString('zh-CN'))
      setLoading(false)
      setRefreshing(false)
    },
    [workspaceId, isPersonalWorkspace, canViewDashboard],
  )

  useEffect(() => {
    void loadDashboard(true)
  }, [loadDashboard])

  return (
    <div className="space-dashboard-page">
      <AppSidebar
        activeKey="team"
        onNavigate={handleNavigate}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="space-dashboard-shell">
        <AppTopbar onMenu={() => setSidebarOpen(true)} />

        <section className="space-dashboard-main" aria-label="空间数据看板">
          <div className="space-dashboard-header">
            <button type="button" className="space-dashboard-back" onClick={() => navigate(-1)} aria-label="返回">
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M11.5 4.5 6 10l5.5 5.5" />
                <path d="M6.5 10h8" />
              </svg>
            </button>
            <h1 className="space-dashboard-title">数据统计</h1>
          </div>

          {isPersonalWorkspace ? (
            <div className="space-dashboard-empty">
              <h2>个人空间暂不展示团队统计</h2>
              <p>请先切换到团队空间，再查看空间级成员、项目和视频消耗数据。</p>
            </div>
          ) : !canViewDashboard ? (
            <div className="space-dashboard-empty">
              <h2>暂无查看权限</h2>
              <p>当前账号尚未加入该团队或无团队管理权限，无法查看空间统计与成员信息。</p>
            </div>
          ) : loading ? (
            <div className="space-dashboard-loading">
              <div className="space-dashboard-loading__grid">
                {Array.from({ length: 5 }).map((_, index) => (
                  <span key={index} className="space-dashboard-loading__card" />
                ))}
              </div>
              <div className="space-dashboard-loading__table" />
            </div>
          ) : (
            <>
              <div className="space-dashboard-toolbar">
                <span className="space-dashboard-toolbar__workspace">
                  {canRevealWorkspaceInfo ? currentWorkspace?.name || '当前空间' : '团队空间'}
                </span>
                <div className="space-dashboard-toolbar__actions">
                  <span>{updatedAt ? `更新于 ${updatedAt}` : '等待首次加载'}</span>
                  <button
                    type="button"
                    className="space-dashboard-refresh"
                    disabled={refreshing || loading}
                    onClick={() => void loadDashboard(false)}
                  >
                    {refreshing ? '刷新中...' : '刷新'}
                  </button>
                </div>
              </div>

              {error ? <div className="space-dashboard-error">{error}</div> : null}

              <div className="space-dashboard-cards">
                {statCards.map((card) => (
                  <article key={card.key} className="space-dashboard-card">
                    <span className={`space-dashboard-card__icon is-${card.colorClass}`}>{card.icon}</span>
                    <div className="space-dashboard-card__body">
                      <span className="space-dashboard-card__label">{card.label}</span>
                      <div className="space-dashboard-card__value">
                        <strong>{formatNumber(card.value)}</strong>
                        <span className="space-dashboard-card__unit">{card.unit}</span>
                      </div>
                    </div>
                  </article>
                ))}
              </div>

              <div className="space-dashboard-table">
                <div className="space-dashboard-table__head">
                  <span>成员</span>
                  <span>成员账号</span>
                  <span>项目个数</span>
                  <span>总生成视频数</span>
                  <span>消耗积分分数</span>
                  <span>平均每个视频消耗积分分数</span>
                </div>
                {memberStats.length ? (
                  memberStats.map((item, index) => (
                    <div key={String(item.id || index)} className="space-dashboard-table__row">
                      <span className="space-dashboard-table__name">{item.name}</span>
                      <span>{item.phone || '-'}</span>
                      <span>{formatNumber(item.projects)}</span>
                      <span>{formatNumber(item.videos)}</span>
                      <span>{formatNumber(item.credits)}</span>
                      <span>{formatNumber(avgPerVideo(item.credits, item.videos))}</span>
                    </div>
                  ))
                ) : (
                  <div className="space-dashboard-table__empty">当前空间暂无可展示的成员统计数据</div>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
