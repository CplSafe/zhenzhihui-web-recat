/**
 * 供需商单（/market）
 *
 * 页面职责：承载原首页的「IP」与「需求市场」两个标签，作为侧栏「市场 → 供需商单」的落地页。
 * 页面不再显示「供需商单」大标题，两个标签按用户视角命名、发单在前：
 * - 「我要发单」（key 'market'，原需求市场）：价格 / 时间排序 + 发布需求入口，只展示可报名（open）的需求。
 * - 「我要接单」（key 'ip'，原 IP）：领域 / 平台 / 粉丝三组筛选 + 创作者卡片，点击进入 IP 主页。
 * - 两个标签都一次展示全部卡片，不再折叠「查看更多」，也不提供搜索框。
 * 其他页面可通过 navigate('/market', { state: { marketTab: 'market' } }) 直达指定标签。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import AppSidebar from '@/components/home/AppSidebar'
import AppTopbar from '@/components/layout/AppTopbar'
import FilterSelect from '@/components/common/FilterSelect'
import DemandCard from '@/components/market/DemandCard'
import DemandFormModal, { type DemandFormTarget } from '@/components/market/DemandFormModal'
import { listCommunityIps, type CommunityIpProfile } from '@/api/communityIp'
import { listMarketDemands, type MarketDemand } from '@/api/market'
import { useRequireAuth } from '@/composables/useRequireAuth'
import { useSidebarNavigate } from '@/composables/useSidebarNavigate'
import './HomeView.css'
import './MarketView.css'

/**
 * 供需商单页的两个标签，数组顺序即展示顺序，第一个是默认标签。
 * key 沿用旧值不改：路由 state.marketTab（需求详情「返回市场」、我的合作等入口）靠它直达。
 */
const TABS = [
  { key: 'market', label: '我要发单' },
  { key: 'ip', label: '我要接单' },
] as const

/** 供需商单标签键；路由 state.marketTab 复用同一套取值。 */
export type MarketTabKey = (typeof TABS)[number]['key']

/** IP Tab「粉丝」筛选的固定区间。 */
const IP_FANS_RANGES = [
  { key: '', label: '全部粉丝', match: () => true },
  { key: 'lt1w', label: '1W以下', match: (count: number) => count < 10_000 },
  { key: '1w-10w', label: '1W-10W', match: (count: number) => count >= 10_000 && count < 100_000 },
  { key: 'gte10w', label: '10W以上', match: (count: number) => count >= 100_000 },
] as const

function formatFollowers(value: number): string {
  if (value >= 10000) return `${(value / 10000).toFixed(value % 10000 ? 1 : 0)}W`
  return String(value)
}

function isMarketTab(value: unknown): value is MarketTabKey {
  return TABS.some((tab) => tab.key === value)
}

/** 后端未返回头像时使用轻量占位，避免把大尺寸演示图片打入首屏产物。 */
function IpAvatar({ profile }: { profile: CommunityIpProfile }) {
  if (profile.avatar) return <img src={profile.avatar} alt="" />
  return (
    <span className="home__ip-avatar-fallback" aria-hidden="true">
      {profile.name.trim().slice(0, 1).toLocaleUpperCase() || 'IP'}
    </span>
  )
}

/** 渲染 IP 创作者与需求市场两个标签的供需商单页。 */
export default function MarketView() {
  const navigate = useNavigate()
  const location = useLocation()
  const requireAuth = useRequireAuth()
  const handleNavigate = useSidebarNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const routeTab = (location.state as { marketTab?: unknown } | null)?.marketTab
  const [activeTab, setActiveTab] = useState<MarketTabKey>(() => (isMarketTab(routeTab) ? routeTab : TABS[0].key))
  // 已挂载时再次收到 marketTab（如需求详情点「返回市场」）也切到对应标签。
  useEffect(() => {
    if (isMarketTab(routeTab)) setActiveTab(routeTab)
  }, [routeTab, location.key])

  // IP Tab：领域 / 平台 / 粉丝三组筛选（选项由已加载数据推导）
  const [ipCategoryFilter, setIpCategoryFilter] = useState('')
  const [ipPlatformFilter, setIpPlatformFilter] = useState('')
  const [ipFansFilter, setIpFansFilter] = useState('')
  const [ipProfiles, setIpProfiles] = useState<CommunityIpProfile[]>([])
  const [ipLoading, setIpLoading] = useState(false)
  const [ipError, setIpError] = useState('')
  // 需求市场 Tab
  const [marketDemands, setMarketDemands] = useState<MarketDemand[]>([])
  const [marketLoading, setMarketLoading] = useState(false)
  const [marketError, setMarketError] = useState('')
  const [marketSort, setMarketSort] = useState<{ field: 'price' | 'time'; dir: 'asc' | 'desc' } | null>(null)
  // 发布需求抽屉
  const [demandFormOpen, setDemandFormOpen] = useState(false)
  const [demandTarget, setDemandTarget] = useState<DemandFormTarget | null>(null)

  useEffect(() => {
    if (activeTab !== 'ip') return
    const controller = new AbortController()
    setIpLoading(true)
    setIpError('')
    listCommunityIps({ limit: 100, signal: controller.signal })
      .then(({ items }) => setIpProfiles(items))
      .catch((error: any) => {
        if (error?.name !== 'AbortError') setIpError(error?.message || 'IP 列表加载失败')
      })
      .finally(() => {
        if (!controller.signal.aborted) setIpLoading(false)
      })
    return () => controller.abort()
  }, [activeTab])

  useEffect(() => {
    if (activeTab !== 'market') return
    const controller = new AbortController()
    setMarketLoading(true)
    setMarketError('')
    // 市场只展示可报名（open）的需求：后端公开列表会包含已完成的单，混排会误导接单者。
    listMarketDemands({ status: 'open', limit: 100, signal: controller.signal })
      .then(({ items }) => setMarketDemands(items))
      .catch((error: any) => {
        if (error?.name !== 'AbortError') setMarketError(error?.message || '需求市场加载失败')
      })
      .finally(() => {
        if (!controller.signal.aborted) setMarketLoading(false)
      })
    return () => controller.abort()
  }, [activeTab])

  const ipCategoryOptions = useMemo(() => {
    const values = new Set<string>()
    ipProfiles.forEach((profile) => {
      if (profile.category && profile.category !== '暂未设置') values.add(profile.category)
    })
    return [...values]
  }, [ipProfiles])

  const ipPlatformOptions = useMemo(() => {
    const values = new Set<string>()
    ipProfiles.forEach((profile) => profile.platforms.forEach((platform) => values.add(platform.name)))
    return [...values]
  }, [ipProfiles])

  const visibleIpProfiles = useMemo(() => {
    const fansRange = IP_FANS_RANGES.find((range) => range.key === ipFansFilter) || IP_FANS_RANGES[0]
    return ipProfiles.filter((profile) => {
      if (ipCategoryFilter && profile.category !== ipCategoryFilter) return false
      if (ipPlatformFilter && !profile.platforms.some((platform) => platform.name === ipPlatformFilter)) return false
      return fansRange.match(profile.followers)
    })
  }, [ipCategoryFilter, ipFansFilter, ipPlatformFilter, ipProfiles])

  const visibleMarketDemands = useMemo(() => {
    const items = [...marketDemands]
    if (!marketSort) return items
    const factor = marketSort.dir === 'asc' ? 1 : -1
    return items.sort((a, b) => {
      if (marketSort.field === 'price') return (a.budgetCents - b.budgetCents) * factor
      const left = new Date(a.publishedAt || a.createdAt).getTime() || 0
      const right = new Date(b.publishedAt || b.createdAt).getTime() || 0
      return (left - right) * factor
    })
  }, [marketDemands, marketSort])

  /** 排序按钮：未选中 → 降序 → 升序 → 取消。 */
  const toggleMarketSort = useCallback((field: 'price' | 'time') => {
    setMarketSort((current) => {
      if (!current || current.field !== field) return { field, dir: 'desc' }
      if (current.dir === 'desc') return { field, dir: 'asc' }
      return null
    })
  }, [])

  const openDemandForm = useCallback(
    (target: DemandFormTarget | null) => {
      requireAuth(() => {
        setDemandTarget(target)
        setDemandFormOpen(true)
      })
    },
    [requireAuth],
  )

  const handleDemandPublished = useCallback((demand: MarketDemand) => {
    setMarketDemands((current) => [demand, ...current.filter((item) => item.id !== demand.id)])
  }, [])

  const openIp = (id: CommunityIpProfile['id']) => navigate(`/ip/${id}`)

  return (
    <div className="home market">
      <AppSidebar
        activeKey="market"
        onNavigate={handleNavigate}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="home__main">
        <AppTopbar onMenu={() => setSidebarOpen(true)} />

        <div className="home__content">
          <div className="market__inner">
            <div className="home__tabs-bar market__tabs-bar">
              <div className="home__tabs" role="tablist" aria-label="商单类型">
                {TABS.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === t.key}
                    className={`home__tab${activeTab === t.key ? ' is-active' : ''}`}
                    onClick={() => setActiveTab(t.key)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 排序 + 发布需求：放在「我要发单」标签下方单独一行 */}
            {activeTab === 'market' && (
              <div className="home__market-tools market__tools">
                {(
                  [
                    ['price', '价格排序'],
                    ['time', '时间排序'],
                  ] as const
                ).map(([field, label]) => (
                  <button
                    key={field}
                    type="button"
                    className={`home__sort-btn${marketSort?.field === field ? ' is-active' : ''}`}
                    onClick={() => toggleMarketSort(field)}
                    aria-label={`按${label.slice(0, 2)}${marketSort?.field === field && marketSort.dir === 'asc' ? '升序' : '降序'}排列`}
                  >
                    {label}
                    <span aria-hidden="true" className="home__sort-arrows">
                      <i className={marketSort?.field === field && marketSort.dir === 'asc' ? 'is-on' : ''}>↑</i>
                      <i className={marketSort?.field === field && marketSort.dir === 'desc' ? 'is-on' : ''}>↓</i>
                    </span>
                  </button>
                ))}
                <button type="button" className="home__publish-demand-btn" onClick={() => openDemandForm(null)}>
                  发布需求
                </button>
              </div>
            )}

            <div className="home__tab-box">
              {activeTab === 'ip' ? (
                <>
                  <div className="home__ip-filters">
                    <div className="home__ip-filter">
                      <span>领域</span>
                      <FilterSelect
                        ariaLabel="按领域筛选"
                        value={ipCategoryFilter}
                        onChange={setIpCategoryFilter}
                        options={[
                          { value: '', label: '全部领域' },
                          ...ipCategoryOptions.map((option) => ({ value: option, label: option })),
                        ]}
                      />
                    </div>
                    <div className="home__ip-filter">
                      <span>平台</span>
                      <FilterSelect
                        ariaLabel="按平台筛选"
                        value={ipPlatformFilter}
                        onChange={setIpPlatformFilter}
                        options={[
                          { value: '', label: '全部平台' },
                          ...ipPlatformOptions.map((option) => ({ value: option, label: option })),
                        ]}
                      />
                    </div>
                    <div className="home__ip-filter">
                      <span>粉丝</span>
                      <FilterSelect
                        ariaLabel="按粉丝数量筛选"
                        value={ipFansFilter}
                        onChange={setIpFansFilter}
                        options={IP_FANS_RANGES.map((range) => ({ value: range.key, label: range.label }))}
                      />
                    </div>
                  </div>
                  {ipLoading ? (
                    <div className="home__placeholder">正在加载 IP 创作者...</div>
                  ) : ipError ? (
                    <div className="home__placeholder">{ipError}</div>
                  ) : visibleIpProfiles.length ? (
                    <div className="home__ip-grid">
                      {visibleIpProfiles.map((profile) => (
                        <div
                          className="home__ipcard"
                          key={profile.id}
                          role="button"
                          tabIndex={0}
                          aria-label={`查看 ${profile.name} 的主页`}
                          onClick={() => openIp(profile.id)}
                          onKeyDown={(event) => {
                            if (event.target !== event.currentTarget) return
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              openIp(profile.id)
                            }
                          }}
                        >
                          <div className="home__ipcard-top">
                            <div className="home__ipcard-photo">
                              <IpAvatar profile={profile} />
                            </div>
                            <div className="home__ipcard-info">
                              <strong className="home__ipcard-name">{profile.name}</strong>
                              <span className="home__ipcard-tags">
                                {profile.category}
                                {profile.contentType ? `/${profile.contentType}` : ''}
                              </span>
                              <span className="home__ipcard-line">
                                平台：
                                {profile.platforms.length ? (
                                  profile.platforms.slice(0, 3).map((platform) => (
                                    <em className="home__ipcard-platform" key={platform.name}>
                                      {platform.name}
                                    </em>
                                  ))
                                ) : (
                                  <i className="home__ipcard-empty">—</i>
                                )}
                              </span>
                              <span className="home__ipcard-line">
                                粉丝数量：{profile.followers ? formatFollowers(profile.followers) : '—'}
                              </span>
                            </div>
                          </div>
                          <div className="home__ipcard-footer">
                            <span className="home__ipcard-price">
                              {profile.averageOrderValue > 0 ? (
                                <>
                                  ¥ {profile.averageOrderValue}
                                  <em>/起</em>
                                </>
                              ) : (
                                '面议'
                              )}
                            </span>
                            <button
                              type="button"
                              className="home__ipcard-send"
                              onClick={(event) => {
                                event.stopPropagation()
                                openIp(profile.id)
                              }}
                            >
                              查看详情
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="home__placeholder">没有找到匹配的 IP</div>
                  )}
                </>
              ) : marketLoading ? (
                <div className="home__placeholder">正在加载需求市场...</div>
              ) : marketError ? (
                <div className="home__placeholder">{marketError}</div>
              ) : visibleMarketDemands.length ? (
                <div className="home__market-grid">
                  {visibleMarketDemands.map((demand) => (
                    <DemandCard key={demand.id} demand={demand} onOpen={(item) => navigate(`/demand/${item.id}`)} />
                  ))}
                </div>
              ) : (
                <div className="home__placeholder">
                  暂无发布中的需求
                  <button type="button" className="home__retry-btn" onClick={() => openDemandForm(null)}>
                    发布第一个需求
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <DemandFormModal
        open={demandFormOpen}
        targetIp={demandTarget}
        onClose={() => setDemandFormOpen(false)}
        onPublished={handleDemandPublished}
      />
    </div>
  )
}
