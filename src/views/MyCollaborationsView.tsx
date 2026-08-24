/**
 * 我的合作（/collaborations，设计稿「我的合作」）。
 *
 * 「我的发布」：我发布的需求列表 + 统计卡（全部请求/进行中/待处理申请/已完成/总消耗），
 * 展开行可查看并接受/拒绝接单申请，需求可取消或标记完成。
 * 「我的接单」：我提交的接单申请 + 撤回。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AppSidebar from '@/components/home/AppSidebar'
import AppTopbar from '@/components/layout/AppTopbar'
import {
  acceptDemandApplication,
  applicationStatusLabel,
  cancelMarketDemand,
  completeMarketDemand,
  demandStatusLabel,
  formatDemandDate,
  formatDemandPrice,
  listDemandApplications,
  listMyApplications,
  listMyDemands,
  rejectDemandApplication,
  withdrawDemandApplication,
  type DemandApplication,
  type MarketDemand,
} from '@/api/market'
import { useConfirmDialog, useToast } from '@/composables/useToast'
import { useSidebarNavigate } from '@/composables/useSidebarNavigate'
import './MyCollaborationsView.css'

type CollabTab = 'published' | 'accepted'

/** 上限内为「报名中」的需求预取申请列表，供待处理统计与展开面板使用。 */
const APPLICATION_PREFETCH_LIMIT = 20

function DemandThumb({ demand }: { demand: MarketDemand }) {
  const url = (demand.extras.materials || []).find((item) => item.url)?.url || ''
  return (
    <span className="collab__thumb">
      {url ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          onError={(event) => {
            event.currentTarget.style.display = 'none'
          }}
        />
      ) : null}
      <i aria-hidden="true">🎬</i>
    </span>
  )
}

function UserCell({ user }: { user: { nickname: string; avatar: string } | null }) {
  if (!user) return <span className="collab__muted">待接单</span>
  return (
    <span className="collab__user">
      {user.avatar ? <img src={user.avatar} alt="" /> : <i aria-hidden="true">{user.nickname.slice(0, 1)}</i>}
      {user.nickname}
    </span>
  )
}

export default function MyCollaborationsView() {
  const navigate = useNavigate()
  const handleNavigate = useSidebarNavigate()
  const { showToast } = useToast()
  const { requestConfirm } = useConfirmDialog()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [tab, setTab] = useState<CollabTab>('published')
  const [demands, setDemands] = useState<MarketDemand[]>([])
  const [demandsLoading, setDemandsLoading] = useState(true)
  const [demandsError, setDemandsError] = useState('')
  const [applicationsByDemand, setApplicationsByDemand] = useState<Record<number, DemandApplication[]>>({})
  const [expandedDemandId, setExpandedDemandId] = useState(0)
  const [myApplications, setMyApplications] = useState<DemandApplication[]>([])
  const [myApplicationsLoading, setMyApplicationsLoading] = useState(true)
  const [busyKey, setBusyKey] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    setDemandsLoading(true)
    setDemandsError('')
    listMyDemands({ signal: controller.signal })
      .then(async ({ items }) => {
        setDemands(items)
        setDemandsLoading(false)
        // 报名中的需求预取申请（限量 + 串行小批量），用于「待处理申请」统计与展开面板。
        const openDemands = items.filter((demand) => demand.status === 'open').slice(0, APPLICATION_PREFETCH_LIMIT)
        for (const demand of openDemands) {
          if (controller.signal.aborted) return
          try {
            const { items: applications } = await listDemandApplications(demand.id, { signal: controller.signal })
            setApplicationsByDemand((current) => ({ ...current, [demand.id]: applications }))
          } catch {
            /* 单条失败不影响其余统计 */
          }
        }
      })
      .catch((error: any) => {
        if (error?.name === 'AbortError') return
        setDemandsLoading(false)
        setDemandsError(error?.message || '我的需求加载失败')
      })
    listMyApplications({ signal: controller.signal })
      .then(({ items }) => setMyApplications(items))
      .catch(() => {})
      .finally(() => {
        if (!controller.signal.aborted) setMyApplicationsLoading(false)
      })
    return () => controller.abort()
  }, [])

  const pendingApplicationCount = useMemo(
    () =>
      Object.values(applicationsByDemand).reduce(
        (sum, applications) => sum + applications.filter((item) => item.status === 'pending').length,
        0,
      ),
    [applicationsByDemand],
  )

  const publishedStats = useMemo(() => {
    const inProgress = demands.filter((demand) => demand.status === 'in_progress').length
    const completed = demands.filter((demand) => demand.status === 'completed')
    const totalSpentYuan = completed.reduce(
      (sum, demand) => sum + (demand.budgetCents / 100) * (demand.extras.quantity || 1),
      0,
    )
    return [
      { label: '全部请求', value: `${demands.length}个` },
      { label: '进行中', value: `${inProgress}个` },
      { label: '待处理申请', value: `${pendingApplicationCount}个` },
      { label: '已完成', value: `${completed.length}个` },
      { label: '总消耗', value: `¥ ${totalSpentYuan.toFixed(2)}` },
    ]
  }, [demands, pendingApplicationCount])

  const acceptedStats = useMemo(() => {
    const pending = myApplications.filter((item) => item.status === 'pending').length
    const accepted = myApplications.filter((item) => item.status === 'accepted')
    const rejected = myApplications.filter((item) => item.status === 'rejected' || item.status === 'withdrawn').length
    const expectedYuan = accepted.reduce((sum, item) => sum + item.quoteCents / 100, 0)
    return [
      { label: '全部申请', value: `${myApplications.length}个` },
      { label: '待处理', value: `${pending}个` },
      { label: '已接受', value: `${accepted.length}个` },
      { label: '已拒绝/撤回', value: `${rejected}个` },
      { label: '预计收入', value: `¥ ${expectedYuan.toFixed(2)}` },
    ]
  }, [myApplications])

  const toggleExpand = useCallback(
    (demand: MarketDemand) => {
      const next = expandedDemandId === demand.id ? 0 : demand.id
      setExpandedDemandId(next)
      if (next && !applicationsByDemand[demand.id]) {
        listDemandApplications(demand.id)
          .then(({ items }) => setApplicationsByDemand((current) => ({ ...current, [demand.id]: items })))
          .catch(() => setApplicationsByDemand((current) => ({ ...current, [demand.id]: [] })))
      }
    },
    [applicationsByDemand, expandedDemandId],
  )

  const handleAccept = useCallback(
    async (application: DemandApplication) => {
      const key = `accept-${application.id}`
      if (busyKey) return
      const confirmed = await requestConfirm(
        `确定接受「${application.applicant.nickname}」的接单申请吗？接受后需求进入制作中。`,
        { title: '接受申请', confirmLabel: '接受' },
      )
      if (confirmed !== true) return
      setBusyKey(key)
      try {
        const updated = await acceptDemandApplication(application.id)
        setDemands((current) => current.map((item) => (item.id === updated.id ? updated : item)))
        const { items } = await listDemandApplications(application.demandId).catch(() => ({
          items: [] as DemandApplication[],
        }))
        setApplicationsByDemand((current) => ({ ...current, [application.demandId]: items }))
        showToast('已接受接单申请', 'success')
      } catch (error: any) {
        showToast(error?.message || '操作失败，请稍后重试', 'error')
      } finally {
        setBusyKey('')
      }
    },
    [busyKey, requestConfirm, showToast],
  )

  const handleReject = useCallback(
    async (application: DemandApplication) => {
      const key = `reject-${application.id}`
      if (busyKey) return
      setBusyKey(key)
      try {
        const updated = await rejectDemandApplication(application.id)
        setApplicationsByDemand((current) => ({
          ...current,
          [application.demandId]: (current[application.demandId] || []).map((item) =>
            item.id === application.id ? { ...item, status: updated.status || 'rejected' } : item,
          ),
        }))
        showToast('已拒绝该申请', 'success')
      } catch (error: any) {
        showToast(error?.message || '操作失败，请稍后重试', 'error')
      } finally {
        setBusyKey('')
      }
    },
    [busyKey, showToast],
  )

  const handleCancelDemand = useCallback(
    async (demand: MarketDemand) => {
      if (busyKey) return
      const confirmed = await requestConfirm(`确定取消需求「${demand.title}」吗？`, {
        title: '取消需求',
        confirmLabel: '取消需求',
        danger: true,
      })
      if (confirmed !== true) return
      setBusyKey(`cancel-${demand.id}`)
      try {
        const updated = await cancelMarketDemand(demand.id)
        setDemands((current) => current.map((item) => (item.id === updated.id ? updated : item)))
        showToast('需求已取消', 'success')
      } catch (error: any) {
        showToast(error?.message || '操作失败，请稍后重试', 'error')
      } finally {
        setBusyKey('')
      }
    },
    [busyKey, requestConfirm, showToast],
  )

  const handleCompleteDemand = useCallback(
    async (demand: MarketDemand) => {
      if (busyKey) return
      const confirmed = await requestConfirm(`确认需求「${demand.title}」已交付完成吗？`, {
        title: '完成需求',
        confirmLabel: '标记完成',
      })
      if (confirmed !== true) return
      setBusyKey(`complete-${demand.id}`)
      try {
        const updated = await completeMarketDemand(demand.id)
        setDemands((current) => current.map((item) => (item.id === updated.id ? updated : item)))
        showToast('需求已完成', 'success')
      } catch (error: any) {
        showToast(error?.message || '操作失败，请稍后重试', 'error')
      } finally {
        setBusyKey('')
      }
    },
    [busyKey, requestConfirm, showToast],
  )

  const handleWithdraw = useCallback(
    async (application: DemandApplication) => {
      if (busyKey) return
      const confirmed = await requestConfirm('确定撤回这条接单申请吗？', {
        title: '撤回申请',
        confirmLabel: '撤回',
        danger: true,
      })
      if (confirmed !== true) return
      setBusyKey(`withdraw-${application.id}`)
      try {
        const updated = await withdrawDemandApplication(application.id)
        setMyApplications((current) =>
          current.map((item) =>
            item.id === application.id ? { ...item, status: updated.status || 'withdrawn' } : item,
          ),
        )
        showToast('申请已撤回', 'success')
      } catch (error: any) {
        showToast(error?.message || '操作失败，请稍后重试', 'error')
      } finally {
        setBusyKey('')
      }
    },
    [busyKey, requestConfirm, showToast],
  )

  const stats = tab === 'published' ? publishedStats : acceptedStats

  return (
    <div className="collab">
      <AppSidebar
        activeKey="collaborations"
        onNavigate={handleNavigate}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <div className="collab__main">
        <AppTopbar onMenu={() => setSidebarOpen(true)} />
        <div className="collab__content">
          <div className="collab__tabs">
            <button
              type="button"
              className={`collab__tab${tab === 'published' ? ' is-active' : ''}`}
              onClick={() => setTab('published')}
            >
              我的发布
            </button>
            <button
              type="button"
              className={`collab__tab${tab === 'accepted' ? ' is-active' : ''}`}
              onClick={() => setTab('accepted')}
            >
              我的接单
            </button>
          </div>

          <div className="collab__stats">
            {stats.map((stat) => (
              <div className="collab__stat" key={stat.label}>
                <span className="collab__stat-label">{stat.label}</span>
                <strong className="collab__stat-value">{stat.value}</strong>
              </div>
            ))}
          </div>

          {tab === 'published' ? (
            <div className="collab__table" role="table" aria-label="我发布的需求">
              <div className="collab__row collab__row--head" role="row">
                <span role="columnheader">需求信息</span>
                <span role="columnheader">制作人</span>
                <span role="columnheader">预算/条</span>
                <span role="columnheader">状态</span>
                <span role="columnheader">截至时间</span>
                <span role="columnheader" className="collab__col-actions">
                  操作
                </span>
              </div>
              {demandsLoading ? (
                <div className="collab__placeholder">加载中…</div>
              ) : demandsError ? (
                <div className="collab__placeholder">{demandsError}</div>
              ) : demands.length ? (
                demands.map((demand) => {
                  const applications = applicationsByDemand[demand.id] || []
                  const pending = applications.filter((item) => item.status === 'pending')
                  const expanded = expandedDemandId === demand.id
                  return (
                    <div key={demand.id} className="collab__row-group">
                      <div
                        className={`collab__row collab__row--body${expanded ? ' is-expanded' : ''}`}
                        role="row"
                        onClick={() => toggleExpand(demand)}
                      >
                        <span className="collab__demand" role="cell">
                          <DemandThumb demand={demand} />
                          <span className="collab__demand-text">
                            <strong>{demand.title}</strong>
                            {demand.extras.applyDeadline && <em>报名截止时间：{demand.extras.applyDeadline}</em>}
                          </span>
                        </span>
                        <span role="cell">
                          <UserCell user={demand.assignee} />
                        </span>
                        <span role="cell">
                          {formatDemandPrice(demand)}
                          {demand.budgetCents > 0 ? '/条' : ''}
                        </span>
                        <span role="cell">
                          <i className={`collab__status is-${demand.status}`}>{demandStatusLabel(demand.status)}</i>
                          {pending.length > 0 && <i className="collab__badge">{pending.length} 待处理</i>}
                        </span>
                        <span role="cell">
                          {demand.extras.deliveryDeadline || formatDemandDate(demand.deliveryDeadline) || '—'}
                        </span>
                        <span role="cell" className="collab__col-actions" onClick={(event) => event.stopPropagation()}>
                          <button
                            type="button"
                            className="collab__link"
                            onClick={() => navigate(`/demand/${demand.id}`)}
                          >
                            详情
                          </button>
                          {(demand.status === 'open' || demand.status === 'draft') && (
                            <button
                              type="button"
                              className="collab__link collab__link--danger"
                              disabled={busyKey === `cancel-${demand.id}`}
                              onClick={() => handleCancelDemand(demand)}
                            >
                              取消
                            </button>
                          )}
                          {demand.status === 'in_progress' && (
                            <button
                              type="button"
                              className="collab__link"
                              disabled={busyKey === `complete-${demand.id}`}
                              onClick={() => handleCompleteDemand(demand)}
                            >
                              完成
                            </button>
                          )}
                        </span>
                      </div>
                      {expanded && (
                        <div className="collab__applications">
                          {applicationsByDemand[demand.id] === undefined ? (
                            <div className="collab__placeholder collab__placeholder--sub">申请加载中…</div>
                          ) : applications.length ? (
                            applications.map((application) => (
                              <div className="collab__application" key={application.id}>
                                <UserCell user={application.applicant} />
                                <span className="collab__application-message">{application.message || '—'}</span>
                                <span className="collab__application-quote">
                                  {application.quoteCents > 0 ? `报价 ${application.quoteCents / 100}元` : '报价面议'}
                                  {application.estimatedDays > 0 ? ` · ${application.estimatedDays}天` : ''}
                                </span>
                                {application.status === 'pending' && demand.status === 'open' ? (
                                  <span className="collab__application-actions">
                                    <button
                                      type="button"
                                      className="collab__mini-btn collab__mini-btn--primary"
                                      disabled={Boolean(busyKey)}
                                      onClick={() => handleAccept(application)}
                                    >
                                      接受
                                    </button>
                                    <button
                                      type="button"
                                      className="collab__mini-btn"
                                      disabled={Boolean(busyKey)}
                                      onClick={() => handleReject(application)}
                                    >
                                      拒绝
                                    </button>
                                  </span>
                                ) : (
                                  <i className={`collab__status is-app-${application.status}`}>
                                    {applicationStatusLabel(application.status)}
                                  </i>
                                )}
                              </div>
                            ))
                          ) : (
                            <div className="collab__placeholder collab__placeholder--sub">暂无接单申请</div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })
              ) : (
                <div className="collab__placeholder">
                  还没有发布过需求
                  <button
                    type="button"
                    className="collab__empty-btn"
                    onClick={() => navigate('/home', { state: { homeTab: 'market' } })}
                  >
                    去需求市场发布
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="collab__table" role="table" aria-label="我的接单申请">
              <div className="collab__row collab__row--head collab__row--apps" role="row">
                <span role="columnheader">需求信息</span>
                <span role="columnheader">发布者</span>
                <span role="columnheader">我的报价</span>
                <span role="columnheader">状态</span>
                <span role="columnheader">申请时间</span>
                <span role="columnheader" className="collab__col-actions">
                  操作
                </span>
              </div>
              {myApplicationsLoading ? (
                <div className="collab__placeholder">加载中…</div>
              ) : myApplications.length ? (
                myApplications.map((application) => (
                  <div
                    className="collab__row collab__row--body collab__row--apps"
                    role="row"
                    key={application.id}
                    onClick={() => application.demand && navigate(`/demand/${application.demand.id}`)}
                  >
                    <span className="collab__demand" role="cell">
                      {application.demand ? <DemandThumb demand={application.demand} /> : null}
                      <span className="collab__demand-text">
                        <strong>{application.demand?.title || `需求 #${application.demandId}`}</strong>
                        {application.message && <em>{application.message}</em>}
                      </span>
                    </span>
                    <span role="cell">
                      <UserCell user={application.demand?.publisher || null} />
                    </span>
                    <span role="cell">{application.quoteCents > 0 ? `${application.quoteCents / 100}元` : '面议'}</span>
                    <span role="cell">
                      <i className={`collab__status is-app-${application.status}`}>
                        {applicationStatusLabel(application.status)}
                      </i>
                    </span>
                    <span role="cell">{formatDemandDate(application.createdAt) || '—'}</span>
                    <span role="cell" className="collab__col-actions" onClick={(event) => event.stopPropagation()}>
                      {application.status === 'pending' && (
                        <button
                          type="button"
                          className="collab__link collab__link--danger"
                          disabled={busyKey === `withdraw-${application.id}`}
                          onClick={() => handleWithdraw(application)}
                        >
                          撤回
                        </button>
                      )}
                    </span>
                  </div>
                ))
              ) : (
                <div className="collab__placeholder">
                  还没有接单申请
                  <button
                    type="button"
                    className="collab__empty-btn"
                    onClick={() => navigate('/home', { state: { homeTab: 'market' } })}
                  >
                    去需求市场看看
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
