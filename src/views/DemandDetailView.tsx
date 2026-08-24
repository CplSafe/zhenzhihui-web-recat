/**
 * 需求详情页（/demand/:id，设计稿「需求市场-需求详情」）。
 *
 * 页面职责：展示需求头部信息（缩略图、时长/比例/数量、报名截止与交付时间、单价）、
 * 内容概述与视频素材，底部「返回市场 / 申请接单」。发布者本人看到的是管理入口。
 * 游客可浏览，申请接单需登录。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import AppSidebar from '@/components/home/AppSidebar'
import AppTopbar from '@/components/layout/AppTopbar'
import ApplyDemandModal from '@/components/market/ApplyDemandModal'
import {
  formatDemandDate,
  formatDemandPrice,
  getMarketDemand,
  isDemandApplyDeadlinePassed,
  listMyApplications,
  type DemandApplication,
  type MarketDemand,
} from '@/api/market'
import { useAuth } from '@/auth/AuthContext'
import { useRequireAuth } from '@/composables/useRequireAuth'
import { useSidebarNavigate } from '@/composables/useSidebarNavigate'
import { useCurrentUser } from '@/stores/workspaceSession'
import { resolveUserId } from '@/utils/creativeDraftMetadata'
import './DemandDetailView.css'

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp|avif)$/i

function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0
    ? name
        .slice(dot + 1)
        .toUpperCase()
        .slice(0, 5)
    : '文件'
}

export default function DemandDetailView() {
  const { id } = useParams()
  const navigate = useNavigate()
  const requireAuth = useRequireAuth()
  const handleNavigate = useSidebarNavigate()
  const { isAuthenticated } = useAuth()
  const currentUser = useCurrentUser()
  const currentUserId = Number(resolveUserId(currentUser) || 0)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [demand, setDemand] = useState<MarketDemand | null>(null)
  const [error, setError] = useState('')
  const [applying, setApplying] = useState(false)
  // 我对该需求的有效申请（pending/accepted），用于「已申请」态与防重复提交
  const [myApplication, setMyApplication] = useState<DemandApplication | null>(null)

  const demandId = useMemo(() => Math.floor(Number(id) || 0), [id])

  const refreshMyApplication = useCallback(() => {
    if (!demandId || !isAuthenticated) return
    listMyApplications()
      .then(({ items }) => {
        const mine = items.find(
          (item) => item.demandId === demandId && (item.status === 'pending' || item.status === 'accepted'),
        )
        setMyApplication(mine || null)
      })
      .catch(() => {
        /* 查询失败不阻断申请入口，重复提交由后端兜底 */
      })
  }, [demandId, isAuthenticated])

  useEffect(() => {
    setMyApplication(null)
    refreshMyApplication()
  }, [refreshMyApplication])

  useEffect(() => {
    if (!demandId) {
      setError('需求不存在')
      return
    }
    const controller = new AbortController()
    setDemand(null)
    setError('')
    getMarketDemand(demandId, controller.signal)
      .then(setDemand)
      .catch((err: any) => {
        if (err?.name !== 'AbortError') setError(err?.message || '需求详情加载失败')
      })
    return () => controller.abort()
  }, [demandId])

  const backToMarket = useCallback(() => {
    navigate('/home', { state: { homeTab: 'market' } })
  }, [navigate])

  const openApply = useCallback(() => {
    requireAuth(() => setApplying(true))
  }, [requireAuth])

  const isPublisher = demand ? currentUserId > 0 && demand.publisher.id === currentUserId : false
  const materials = demand?.extras.materials || []
  const thumbnail = materials.find((item) => item.url && IMAGE_EXT.test(item.name))?.url || ''
  const deadlinePassed = isDemandApplyDeadlinePassed(demand?.extras.applyDeadline)
  const canApply = demand?.status === 'open' && !isPublisher && !deadlinePassed && !myApplication
  const applyLabel = myApplication
    ? myApplication.status === 'accepted'
      ? '已接单'
      : '已申请'
    : deadlinePassed
      ? '报名已截止'
      : '申请接单'
  const applyBlockReason = myApplication
    ? myApplication.status === 'accepted'
      ? '你已是该需求的制作人'
      : '你已提交过申请，等待发布者处理'
    : deadlinePassed
      ? '该需求报名已截止'
      : demand?.status !== 'open'
        ? '该需求当前不可报名'
        : ''

  return (
    <div className="dmd">
      <AppSidebar
        activeKey="home"
        onNavigate={handleNavigate}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <div className="dmd__main">
        <AppTopbar onMenu={() => setSidebarOpen(true)} />
        <div className="dmd__content">
          {error ? (
            <div className="dmd__placeholder">
              {error}
              <button type="button" className="dmd__back-link" onClick={backToMarket}>
                返回需求市场
              </button>
            </div>
          ) : !demand ? (
            <div className="dmd__placeholder">正在加载需求详情...</div>
          ) : (
            <section className="dmd__panel">
              <header className="dmd__head">
                <div className="dmd__thumb">
                  {thumbnail ? (
                    <img
                      src={thumbnail}
                      alt=""
                      onError={(event) => {
                        event.currentTarget.style.display = 'none'
                      }}
                    />
                  ) : null}
                  <span className="dmd__thumb-ph" aria-hidden="true">
                    🎬
                  </span>
                </div>
                <div className="dmd__head-info">
                  <h1 className="dmd__title">{demand.title}</h1>
                  <div className="dmd__meta dmd__meta--accent">
                    <span>
                      视频时长：<strong>{demand.extras.duration || '—'}</strong>
                    </span>
                    <span>
                      视频比例：<strong>{demand.extras.ratio || '—'}</strong>
                    </span>
                    <span>
                      视频数量：<strong>{demand.extras.quantity ? `${demand.extras.quantity}条` : '—'}</strong>
                    </span>
                  </div>
                  <div className="dmd__meta">
                    {demand.extras.applyDeadline && <span>报名截止时间：{demand.extras.applyDeadline}</span>}
                    {(demand.extras.deliveryDeadline || demand.deliveryDeadline) && (
                      <span>
                        交付时间：{demand.extras.deliveryDeadline || formatDemandDate(demand.deliveryDeadline)}
                      </span>
                    )}
                    <span>
                      发布者：{demand.publisher.nickname}
                      {demand.extras.targetIpName ? `（指定创作者：${demand.extras.targetIpName}）` : ''}
                    </span>
                  </div>
                  <div className="dmd__price">
                    {formatDemandPrice(demand)}
                    {demand.budgetCents > 0 && <em>/条</em>}
                  </div>
                </div>
              </header>

              <div className="dmd__section">
                <h2>内容概述</h2>
                <p className="dmd__desc">{demand.description || '发布者未填写详细描述。'}</p>
              </div>

              {materials.length > 0 && (
                <div className="dmd__section">
                  <h2>视频素材</h2>
                  <div className="dmd__materials">
                    {materials.map((material) => (
                      <figure
                        className="dmd__material"
                        key={`${material.name}-${material.assetId || material.url || ''}`}
                      >
                        <div className="dmd__material-thumb">
                          {material.url && IMAGE_EXT.test(material.name) ? (
                            <img
                              src={material.url}
                              alt={material.name}
                              loading="lazy"
                              onError={(event) => {
                                event.currentTarget.style.display = 'none'
                              }}
                            />
                          ) : null}
                          <span className="dmd__material-ext" aria-hidden="true">
                            {extOf(material.name)}
                          </span>
                        </div>
                        <figcaption>{material.name}</figcaption>
                      </figure>
                    ))}
                  </div>
                </div>
              )}

              <footer className="dmd__footer">
                <button type="button" className="dmd__btn dmd__btn--ghost" onClick={backToMarket}>
                  返回市场
                </button>
                {isPublisher ? (
                  <button
                    type="button"
                    className="dmd__btn dmd__btn--primary"
                    onClick={() => navigate('/collaborations')}
                  >
                    前往我的合作管理
                  </button>
                ) : (
                  <button
                    type="button"
                    className="dmd__btn dmd__btn--primary"
                    disabled={!canApply}
                    title={canApply ? undefined : applyBlockReason}
                    onClick={openApply}
                  >
                    {applyLabel}
                  </button>
                )}
              </footer>
            </section>
          )}
        </div>
      </div>

      <ApplyDemandModal
        demand={applying ? demand : null}
        onClose={() => setApplying(false)}
        onApplied={refreshMyApplication}
      />
    </div>
  )
}
