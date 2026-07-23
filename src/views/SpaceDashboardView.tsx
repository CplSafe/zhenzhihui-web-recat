/**
 * 团队空间数据看板
 *
 * 页面效果：按月份汇总成员数、项目数、成功生成视频数与积分消耗，展示日趋势折线、成员贡献排行，
 * 并可把当前排行导出为 CSV。不同后端接口并行加载，部分接口失败时仍展示其余真实数据。
 *
 * 权限边界：个人空间不展示团队统计；团队空间仅 owner/admin 可查看成员账号、排行和消耗数据。
 * 趋势按 Asia/Shanghai 自然日归集，请求结果与当前 workspace 绑定，避免切换空间后混入旧数据。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { DatePicker } from 'antd'
import dayjs from 'dayjs'
import AppSidebar from '@/components/home/AppSidebar'
import AppTopbar from '@/components/layout/AppTopbar'
import {
  getBusinessErrorMessage,
  getWorkspaceMemberStatistics,
  getWorkspaceOverview,
  listAiTasks,
  listCreditLedgers,
  listCreativeProjects,
} from '@/api/business'
import { listWorkspaceMembers } from '@/api/auth'
import {
  deriveWorkspaceId,
  useCurrentMember,
  useCurrentUser,
  useCurrentWorkspace,
  useWorkspaceId,
  useWorkspaceSessionStore,
} from '@/stores/workspaceSession'
import { openComingSoon } from '@/stores/ui'
import dashboardHero from '@/assets/space-dashboard-hero.webp'
import dashboardHeroFallback from '@/assets/space-dashboard-hero-fallback.png'
import { bindAssetUrlToWorkspace } from '@/utils/workspaceScopedUrl'
import './SpaceDashboardView.css'

/** 侧边栏导航键与页面路径映射。 */
const ROUTE_MAP: Record<string, string> = {
  home: '/home',
  creative: '/smart',
  'hot-copy': '/hot-copy',
  projects: '/projects',
  resources: '/resources',
  templates: '/templates',
  team: '/team',
}

/** 后端成员总数字段的兼容候选。 */
const MEMBER_KEYS = ['member_count', 'members_total', 'members', 'memberCount', 'user_count', 'users_total']
/** 后端项目总数字段的兼容候选。 */
const PROJECT_KEYS = ['project_count', 'projects_total', 'projects', 'projectCount', 'proj_count']
/** 后端视频/作品总数字段的兼容候选。 */
const VIDEO_KEYS = [
  'total_works',
  'video_count',
  'videos_total',
  'videos',
  'works_total',
  'works',
  'work_count',
  'generated_videos',
  'total_videos',
]
/** 后端积分消耗字段的兼容候选。 */
const CREDIT_KEYS = [
  'total_credits',
  'credits_consumed',
  'consumed_credits',
  'credits_total',
  'credit_consumed',
  'consume_credits',
  'credits',
]

/** 团队空间概览区展示的四项核心指标。 */
type OverviewMetrics = {
  members: number
  projects: number
  videos: number
  credits: number
}

/** 成员贡献排行使用的统一行结构。 */
type MemberStatRow = {
  id: string | number
  name: string
  phone: string
  avatar: string
  projects: number
  videos: number
  credits: number
}

/** 折线图中的单日标签与数值。 */
type TrendPoint = {
  label: string
  value: number
}

/** 成员贡献表支持的排序指标。 */
type SortKey = 'videos' | 'credits' | 'projects'
/** 指标卡及环比计算支持的指标键。 */
type MetricKey = keyof OverviewMetrics | 'avg'

/** 与上月比较后展示的方向、摘要和百分比。 */
type TrendMeta = {
  summary: string
  direction: 'up' | 'down' | 'flat'
  percentage: string
}

/** 接口无数据时使用的零值概览。 */
const EMPTY_OVERVIEW: OverviewMetrics = { members: 0, projects: 0, videos: 0, credits: 0 }
/** 无法取得上月数据时的环比占位。 */
const UNAVAILABLE_TREND: TrendMeta = {
  summary: '数据暂不可用',
  direction: 'flat',
  percentage: '--',
}
/** 计入成功视频产量的任务操作类型。 */
const VIDEO_OPERATION_CODES = ['video.generate', 'video.edit', 'video.replicate'] as const
/** 全量趋势历史在同一空间内复用 5 分钟。 */
const TREND_HISTORY_CACHE_TTL_MS = 5 * 60 * 1000
/** 生成上海时区自然日聚合键的日期格式器。 */
const SHANGHAI_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** 从多个兼容字段中选择首个有效数值。 */
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

/** 从候选值中选择首个非空文本。 */
function pickText(...values: any[]): string {
  const found = values.find((value) => String(value ?? '').trim())
  return found ? String(found).trim() : ''
}

// 兼容后端历史字段与嵌套结构，把概览统一为页面使用的四项指标。
function parseOverview(payload: any): OverviewMetrics {
  const source = payload && typeof payload === 'object' ? payload : {}
  const nested = source.total ?? source.cumulative ?? source.all ?? source.overall ?? source.data
  const base = nested && typeof nested === 'object' && !Array.isArray(nested) ? nested : source
  const num = (keys: string[]) => pickNum(base, keys) || pickNum(source, keys)
  return {
    members: num(MEMBER_KEYS),
    projects: num(PROJECT_KEYS),
    videos: num(VIDEO_KEYS),
    credits: num(CREDIT_KEYS),
  }
}

/** 从概览返回体中提取上月指标，供环比文案计算。 */
function parsePreviousOverview(payload: any): OverviewMetrics | null {
  const source = payload && typeof payload === 'object' ? payload : {}
  const previous =
    source.previous_month ??
    source.previousMonth ??
    source.last_month ??
    source.lastMonth ??
    source.comparison?.previous ??
    source.data?.previous_month ??
    source.data?.previousMonth
  return previous && typeof previous === 'object' && !Array.isArray(previous) ? parseOverview(previous) : null
}

/** 兼容多种接口结构并规范化成员贡献排行。 */
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
        avatar: pickText(
          item.avatar_url,
          item.avatarUrl,
          item.avatar,
          item.user?.avatar_url,
          item.user?.avatarUrl,
          item.profile?.avatar_url,
        ),
        projects: num(PROJECT_KEYS),
        videos: num(VIDEO_KEYS),
        credits: num(CREDIT_KEYS),
      }
    })
}

// 统计必须覆盖完整空间数据，因此循环拉取所有分页，并用项目 id 去重。
async function listAllWorkspaceProjects(workspaceId: number): Promise<any[]> {
  const pageSize = 100
  const projects: any[] = []
  const seenIds = new Set<string>()
  let offset = 0

  for (let pageIndex = 0; pageIndex < 1000; pageIndex += 1) {
    const page = await listCreativeProjects({ workspaceId, offset, limit: pageSize })
    const items = Array.isArray(page) ? page : []
    if (!items.length) break

    let addedCount = 0
    items.forEach((item: any, index: number) => {
      const projectId = pickText(item?.id, item?.project_id, item?.projectId)
      const identity = projectId ? `id:${projectId}` : `offset:${offset + index}`
      if (seenIds.has(identity)) return
      seenIds.add(identity)
      projects.push(item)
      addedCount += 1
    })

    if (items.length < pageSize || addedCount === 0) break
    offset += items.length
  }

  return projects
}

/** 按创建者用户 id 汇总项目数量。 */
function projectCountByCreator(projects: any[]): Map<number, number> {
  const counts = new Map<number, number>()
  projects.forEach((project) => {
    const creatorId = Number(
      project?.user_id ??
        project?.userId ??
        project?.creator_user_id ??
        project?.creatorUserId ??
        project?.created_by ??
        project?.creator?.user_id ??
        project?.creator?.id ??
        0,
    )
    if (!Number.isFinite(creatorId) || creatorId <= 0) return
    const id = Math.floor(creatorId)
    counts.set(id, (counts.get(id) || 0) + 1)
  })
  return counts
}

/** 从数组或分页返回体中提取当前页记录。 */
function extractPageRecords(payload: any): any[] {
  if (Array.isArray(payload)) return payload
  const records = payload?.items ?? payload?.list ?? payload?.records ?? payload?.data ?? []
  return Array.isArray(records) ? records : []
}

// “生成视频数”只统计成功任务的真实视频输出，覆盖生成、编辑和爆款复制三种操作。
async function listAllSucceededVideoTasks(workspaceId: number): Promise<any[]> {
  const taskGroups = await Promise.all(
    VIDEO_OPERATION_CODES.map(async (operationCode) => {
      const tasks: any[] = []
      const seenIds = new Set<string>()
      let offset = 0

      for (let pageIndex = 0; pageIndex < 1000; pageIndex += 1) {
        const payload = await listAiTasks({
          workspaceId,
          status: 'succeeded',
          operationCode,
          limit: 100,
          offset,
        })
        const items = extractPageRecords(payload)
        if (!items.length) break

        let addedCount = 0
        items.forEach((task: any, index: number) => {
          const taskId = pickText(task?.id, task?.task_id, task?.taskId)
          const identity = taskId ? `${operationCode}:${taskId}` : `${operationCode}:offset:${offset + index}`
          if (seenIds.has(identity)) return
          seenIds.add(identity)
          tasks.push(task)
          addedCount += 1
        })

        const total = Number(payload?.total)
        offset += items.length
        if (items.length < 100 || addedCount === 0 || (Number.isFinite(total) && offset >= total)) break
      }

      return tasks
    }),
  )

  return taskGroups.flat()
}

/** 分页拉取空间内全部已结算积分流水，并按流水 id 去重。 */
async function listAllSettledCreditLedgers(workspaceId: number): Promise<any[]> {
  const ledgers: any[] = []
  const seenIds = new Set<string>()
  let offset = 0

  for (let pageIndex = 0; pageIndex < 1000; pageIndex += 1) {
    const payload = await listCreditLedgers({ workspaceId, kind: 'settle', limit: 100, offset })
    const items = extractPageRecords(payload)
    if (!items.length) break

    let addedCount = 0
    items.forEach((ledger: any, index: number) => {
      const ledgerId = pickText(ledger?.id, ledger?.ledger_id, ledger?.ledgerId)
      const identity = ledgerId ? `id:${ledgerId}` : `offset:${offset + index}`
      if (seenIds.has(identity)) return
      seenIds.add(identity)
      ledgers.push(ledger)
      addedCount += 1
    })

    const total = Number(payload?.total)
    offset += items.length
    if (items.length < 100 || addedCount === 0 || (Number.isFinite(total) && offset >= total)) break
  }

  return ledgers
}

/** 全量趋势数据的缓存值、加载时间和并发共享 Promise。 */
type TrendHistoryCacheEntry = {
  value?: any[]
  loadedAt?: number
  promise?: Promise<any[]>
}

/** 按工作空间缓存成功视频任务历史。 */
const videoTaskHistoryCache = new Map<number, TrendHistoryCacheEntry>()
/** 按工作空间缓存已结算积分流水历史。 */
const creditLedgerHistoryCache = new Map<number, TrendHistoryCacheEntry>()

// 同一空间五分钟内复用趋势历史；并发请求共享同一个 promise，减少重复拉取全量分页。
function loadCachedTrendHistory(
  cache: Map<number, TrendHistoryCacheEntry>,
  workspaceId: number,
  loader: (workspaceId: number) => Promise<any[]>,
): Promise<any[]> {
  const now = Date.now()
  const existing = cache.get(workspaceId)
  if (existing?.value && now - Number(existing.loadedAt || 0) < TREND_HISTORY_CACHE_TTL_MS) {
    return Promise.resolve(existing.value)
  }
  if (existing?.promise) return existing.promise

  const promise = loader(workspaceId)
  cache.set(workspaceId, { promise })
  void promise.then(
    (value) => {
      if (cache.get(workspaceId)?.promise === promise) {
        cache.set(workspaceId, { value, loadedAt: Date.now() })
      }
    },
    () => {
      if (cache.get(workspaceId)?.promise === promise) cache.delete(workspaceId)
    },
  )
  return promise
}

/** 清空团队看板趋势缓存，供账号/空间数据变更后强制刷新。 */
export function clearSpaceDashboardTrendCache(): void {
  videoTaskHistoryCache.clear()
  creditLedgerHistoryCache.clear()
}

/** 把时间值转换为上海时区的 YYYY-MM-DD 聚合键。 */
function shanghaiDateKey(value: any): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const parts = SHANGHAI_DATE_FORMATTER.formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || ''
  const year = get('year')
  const month = get('month')
  const day = get('day')
  return year && month && day ? `${year}-${month}-${day}` : ''
}

// 按上海时区把记录聚合到所选月份的每个自然日，缺少数据的日期显式补 0。
function buildDailyTrend(
  records: any[],
  selectedMonth: string,
  dateValue: (record: any) => any,
  pointValue: (record: any) => number,
): TrendPoint[] {
  const [yearText, monthText] = selectedMonth.split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return []

  const dayCount = new Date(year, month, 0).getDate()
  const dailyValues = Array.from({ length: dayCount }, () => 0)
  records.forEach((record) => {
    const dateKey = shanghaiDateKey(dateValue(record))
    if (!dateKey.startsWith(`${selectedMonth}-`)) return
    const day = Number(dateKey.slice(-2))
    if (!Number.isFinite(day) || day < 1 || day > dayCount) return
    const value = pointValue(record)
    if (Number.isFinite(value) && value > 0) dailyValues[day - 1] += value
  })

  return dailyValues.map((value, index) => ({
    label: `${monthText}-${String(index + 1).padStart(2, '0')}`,
    value,
  }))
}

/** 统计成功任务输出中真实的视频资产数量。 */
function videoOutputCount(task: any): number {
  const outputs = Array.isArray(task?.outputs) ? task.outputs : []
  return outputs.filter((output: any) => {
    const type = String(output?.type || output?.asset_type || '').toLowerCase()
    const mime = String(output?.mime_type || output?.mimeType || '').toLowerCase()
    return type === 'video' || mime.startsWith('video/')
  }).length
}

/** 从成员、用户、资料或账号对象中提取手机号展示值。 */
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

/** 从成员相关对象中提取头像地址。 */
function normalizeMemberAvatar(member: any): string {
  return pickText(
    member?.avatar_url,
    member?.avatarUrl,
    member?.avatar,
    member?.user?.avatar_url,
    member?.user?.avatarUrl,
    member?.user?.avatar,
    member?.profile?.avatar_url,
    member?.profile?.avatarUrl,
  )
}

/** 计算每条成功视频的平均积分消耗。 */
function avgPerVideo(credits: number, videos: number): number {
  return videos > 0 ? Math.round((credits / videos) * 10) / 10 : 0
}

/** 按中文千分位格式展示统计数值。 */
function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(Number.isFinite(value) ? value : 0)
}

/** 返回月份选择器使用的当前 YYYY-MM。 */
function currentMonthValue(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

/** 把 YYYY-MM 转换为该月首尾日期范围文案。 */
function monthDateRange(value: string): string {
  const [yearText, monthText] = value.split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  const lastDay = new Date(year, month, 0).getDate()
  return `${yearText}-${monthText}-01 至 ${yearText}-${monthText}-${String(lastDay).padStart(2, '0')}`
}

/** 按指标键读取概览值，并派生单视频平均积分。 */
function metricValue(metrics: OverviewMetrics, key: MetricKey): number {
  if (key === 'avg') return avgPerVideo(metrics.credits, metrics.videos)
  return metrics[key]
}

/** 计算指定指标相对上月的增减摘要和百分比。 */
function buildTrendMeta(key: MetricKey, current: OverviewMetrics, previous: OverviewMetrics | null): TrendMeta {
  if (!previous) return { summary: '较上月持平', direction: 'flat', percentage: '较上月持平' }
  const currentValue = metricValue(current, key)
  const previousValue = metricValue(previous, key)
  const delta = Math.round((currentValue - previousValue) * 10) / 10
  if (delta === 0) return { summary: '较上月持平', direction: 'flat', percentage: '较上月持平' }

  const direction = delta > 0 ? 'up' : 'down'
  const absolute = formatNumber(Math.abs(delta))
  const changeWord = delta > 0 ? '增加' : '减少'
  const descriptions: Record<MetricKey, string> = {
    videos: `较上月${changeWord}${absolute}个视频`,
    members: `较上月${changeWord}${absolute}人`,
    projects: `较上月${changeWord}${absolute}个项目`,
    avg: `较上月平均消耗${changeWord}${absolute}积分`,
    credits: `较上月总消耗${changeWord}${absolute}积分`,
  }
  const percent = previousValue === 0 ? 100 : Math.abs((delta / previousValue) * 100)
  return {
    summary: descriptions[key],
    direction,
    percentage: `${percent.toFixed(1)}%`,
  }
}

/** 渲染指标卡上的环比方向标签。 */
function TrendChip({ trend }: { trend: TrendMeta }) {
  if (trend.direction === 'flat') {
    return (
      <span className="space-dashboard-trend-chip is-flat">
        <span className="space-dashboard-trend-chip__symbol">--</span>
        {trend.percentage}
      </span>
    )
  }
  return (
    <span className={`space-dashboard-trend-chip is-${trend.direction}`}>
      <span className="space-dashboard-trend-chip__symbol" aria-hidden="true">
        {trend.direction === 'up' ? '↑' : '↓'}
      </span>
      {trend.percentage}
    </span>
  )
}

/** 渲染单个团队核心指标及环比信息。 */
function MetricCard({
  metricKey,
  label,
  unit,
  value,
  trend,
  primary = false,
}: {
  metricKey: MetricKey
  label: string
  unit: string
  value: number | null
  trend: TrendMeta
  primary?: boolean
}) {
  return (
    <article className={`space-dashboard-metric${primary ? ' is-primary' : ''}`} data-metric={metricKey}>
      <h2 className="space-dashboard-metric__label">{label}</h2>
      <div className="space-dashboard-metric__value">
        <strong>{value === null ? '--' : formatNumber(value)}</strong>
        <span>{unit}</span>
      </div>
      <p className="space-dashboard-metric__summary">{trend.summary}</p>
      <TrendChip trend={trend} />
      {primary ? (
        <picture className="space-dashboard-metric__hero" aria-hidden="true">
          <source srcSet={dashboardHero} type="image/webp" />
          <img src={dashboardHeroFallback} alt="" />
        </picture>
      ) : null}
    </article>
  )
}

/** 把图表最大值向上取整到便于阅读的刻度。 */
function niceMaximum(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback
  const roughStep = value / 5
  const magnitude = 10 ** Math.floor(Math.log10(roughStep))
  const normalized = roughStep / magnitude
  const niceStep = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10
  return niceStep * magnitude * 5
}

/** 使用相邻控制点把数据点转换为平滑 SVG 贝塞尔路径。 */
function smoothPath(points: Array<{ x: number; y: number }>): string {
  if (!points.length) return ''
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`
  let path = `M ${points[0].x} ${points[0].y}`
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[index - 1] ?? points[index]
    const current = points[index]
    const next = points[index + 1]
    const afterNext = points[index + 2] ?? next
    const control1X = current.x + (next.x - previous.x) / 6
    const control1Y = current.y + (next.y - previous.y) / 6
    const control2X = next.x - (afterNext.x - current.x) / 6
    const control2Y = next.y - (afterNext.y - current.y) / 6
    path += ` C ${control1X} ${control1Y}, ${control2X} ${control2Y}, ${next.x} ${next.y}`
  }
  return path
}

/** 趋势无数据时生成占位日期刻度。 */
function fallbackMonthLabels(monthValue: string): string[] {
  const month = monthValue.split('-')[1] || '01'
  return Array.from({ length: 15 }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`)
}

/** 渲染支持指针提示的月度趋势折线/面积图。 */
function TrendChart({
  title,
  legend,
  color,
  data,
  monthValue,
  fallbackMax,
  unit,
  emptyText = '暂无趋势数据',
  initialTooltip = false,
}: {
  title: string
  legend: string
  color: string
  data: TrendPoint[]
  monthValue: string
  fallbackMax: number
  unit: string
  emptyText?: string
  initialTooltip?: boolean
}) {
  const chartData = useMemo(() => data, [data])
  const hasData = chartData.length > 0
  const labels = hasData ? chartData.map((item) => item.label) : fallbackMonthLabels(monthValue)
  const values = hasData ? chartData.map((item) => item.value) : labels.map(() => 0)
  const maxValue = niceMaximum(Math.max(...values, 0), fallbackMax)
  const [activeIndex, setActiveIndex] = useState<number | null>(null)

  useEffect(() => {
    setActiveIndex(initialTooltip && hasData ? Math.min(4, values.length - 1) : null)
  }, [hasData, initialTooltip, values.length])

  const width = 860
  const height = 280
  const plot = { left: 44, right: 16, top: 16, bottom: 42 }
  const plotWidth = width - plot.left - plot.right
  const plotHeight = height - plot.top - plot.bottom
  const points = values.map((value, index) => ({
    x: plot.left + (labels.length <= 1 ? plotWidth / 2 : (index / (labels.length - 1)) * plotWidth),
    y: plot.top + plotHeight - (Math.max(0, value) / maxValue) * plotHeight,
  }))
  const linePath = smoothPath(points)
  const areaPath = linePath
    ? `${linePath} L ${points[points.length - 1].x} ${plot.top + plotHeight} L ${points[0].x} ${plot.top + plotHeight} Z`
    : ''
  const gradientId = `space-dashboard-gradient-${color.replace('#', '')}`
  const tickValues = Array.from({ length: 6 }, (_, index) => maxValue - (maxValue / 5) * index)
  const labelTickCount = Math.min(7, labels.length)
  const labelTickIndexes = new Set(
    Array.from({ length: labelTickCount }, (_, index) =>
      Math.round((index / Math.max(1, labelTickCount - 1)) * Math.max(0, labels.length - 1)),
    ),
  )

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!hasData) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const localX = ((event.clientX - bounds.left) / bounds.width) * width
    const ratio = Math.min(1, Math.max(0, (localX - plot.left) / plotWidth))
    setActiveIndex(Math.round(ratio * (points.length - 1)))
  }

  const activePoint = activeIndex === null ? null : points[activeIndex]
  const tooltipX = activePoint ? Math.min(width - 150, Math.max(plot.left + 8, activePoint.x + 12)) : 0
  const tooltipY = activePoint ? Math.min(height - 82, Math.max(plot.top + 8, activePoint.y + 10)) : 0

  return (
    <section className="space-dashboard-chart" aria-label={title}>
      <div className="space-dashboard-chart__header">
        <h2>{title}</h2>
        <span className="space-dashboard-chart__legend">
          <i style={{ backgroundColor: color }} />
          {legend}
        </span>
      </div>
      <div className="space-dashboard-chart__canvas">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`${title}折线图`}
          onPointerMove={handlePointerMove}
          onPointerLeave={() => setActiveIndex(initialTooltip && hasData ? Math.min(4, values.length - 1) : null)}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.2" />
              <stop offset="100%" stopColor={color} stopOpacity="0.025" />
            </linearGradient>
          </defs>
          {tickValues.map((tick, index) => {
            const y = plot.top + (plotHeight / 5) * index
            return (
              <g key={tick}>
                <line x1={plot.left} y1={y} x2={width - plot.right} y2={y} className="space-dashboard-chart__grid" />
                <text x={plot.left - 20} y={y + 5} textAnchor="end" className="space-dashboard-chart__axis">
                  {formatNumber(Math.round(tick))}
                </text>
              </g>
            )
          })}
          {labels.map((label, index) => {
            if (!labelTickIndexes.has(index)) return null
            const x = plot.left + (labels.length <= 1 ? plotWidth / 2 : (index / (labels.length - 1)) * plotWidth)
            return (
              <text
                key={`${label}-${index}`}
                x={x}
                y={height - 7}
                textAnchor="middle"
                className="space-dashboard-chart__axis"
              >
                {label}
              </text>
            )
          })}
          {hasData ? (
            <>
              <path d={areaPath} fill={`url(#${gradientId})`} />
              <path d={linePath} fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" />
            </>
          ) : null}
          {activePoint && activeIndex !== null ? (
            <g className="space-dashboard-chart__tooltip">
              <line
                x1={activePoint.x}
                y1={plot.top}
                x2={activePoint.x}
                y2={plot.top + plotHeight}
                className="space-dashboard-chart__cursor"
              />
              <circle cx={activePoint.x} cy={activePoint.y} r="6" fill={color} stroke="#fff" strokeWidth="1" />
              <rect x={tooltipX} y={tooltipY} width="140" height="70" rx="3" />
              <text x={tooltipX + 10} y={tooltipY + 26} className="space-dashboard-chart__tooltip-date">
                {labels[activeIndex]}
              </text>
              <text x={tooltipX + 10} y={tooltipY + 52} fill={color} className="space-dashboard-chart__tooltip-value">
                {`${legend.replace(/[（(].*$/, '')}：${formatNumber(values[activeIndex])}${unit}`}
              </text>
            </g>
          ) : null}
        </svg>
        {!hasData ? <span className="space-dashboard-chart__empty">{emptyText}</span> : null}
      </div>
    </section>
  )
}

/** 前三名显示奖牌，其余成员显示普通序号。 */
function RankBadge({ rank }: { rank: number }) {
  if (rank > 3) return <span className="space-dashboard-rank-number">{rank}</span>
  const palettes = [
    ['#f5cf38', '#e9a91f', '#fff3a6'],
    ['#b8c3d1', '#8493a6', '#eef3f8'],
    ['#e7a06e', '#c87945', '#ffd2b5'],
  ]
  const [main, dark, light] = palettes[rank - 1]
  return (
    <svg className="space-dashboard-medal" viewBox="0 0 30 30" aria-label={`第${rank}名`}>
      <path d="M7 14.8 5 29l6.4-3.7L15 30l3.6-4.7L25 29l-2-14.2Z" fill={dark} />
      <path d="M8.5 17.2 7.4 26l4.5-2.6 3.1 4.1V16Z" fill={light} opacity="0.9" />
      <circle cx="15" cy="11.8" r="10.8" fill={main} />
      <circle cx="15" cy="11.8" r="7.2" fill={light} opacity="0.45" />
      <text x="15" y="16" textAnchor="middle" fontSize="12" fontWeight="600" fill="#fff">
        {rank}
      </text>
    </svg>
  )
}

/** 渲染成员头像，加载失败时回退姓名首字。 */
function MemberAvatar({ src, name }: { src: string; name: string }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  if (!src || failed) {
    return <span className="space-dashboard-avatar is-fallback">{name.slice(0, 1).toUpperCase()}</span>
  }
  return <img className="space-dashboard-avatar" src={src} alt="" onError={() => setFailed(true)} />
}

/** 转义 CSV 中的引号、逗号和换行。 */
function escapeCsv(value: string | number): string {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** 加载并展示当前团队空间的月度概览、趋势与成员贡献排行。 */
export default function SpaceDashboardView() {
  const navigate = useNavigate()
  const workspaceId = useWorkspaceId()
  const currentWorkspace = useCurrentWorkspace() as any
  const currentUser = useCurrentUser() as any
  const currentMember = useCurrentMember() as any

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [overview, setOverview] = useState<OverviewMetrics | null>(null)
  // 总视频数必须来自成功的 video.generate/edit/replicate 任务，不用项目/works 代替。
  const [videoTaskCount, setVideoTaskCount] = useState<number | null>(null)
  const [projectCount, setProjectCount] = useState<number | null>(null)
  const [previousOverview, setPreviousOverview] = useState<OverviewMetrics | null>(null)
  const [memberStats, setMemberStats] = useState<MemberStatRow[]>([])
  const [videoTrend, setVideoTrend] = useState<TrendPoint[]>([])
  const [creditTrend, setCreditTrend] = useState<TrendPoint[]>([])
  const [trendLoading, setTrendLoading] = useState(false)
  const [videoTrendError, setVideoTrendError] = useState('')
  const [creditTrendError, setCreditTrendError] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('videos')
  const [selectedMonth, setSelectedMonth] = useState(currentMonthValue)
  const dashboardRequestIdRef = useRef(0)
  const trendRequestIdRef = useRef(0)

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
  // 看板包含成员账号与消耗明细，查看权限严格限制为空间 owner/admin。
  const canViewDashboard =
    !isPersonalWorkspace && (currentRole === 'admin' || (ownerUserId > 0 && currentUserId === ownerUserId))

  const resolvedOverview = overview ?? EMPTY_OVERVIEW
  const taskBasedOverview = useMemo(
    () => ({ ...resolvedOverview, videos: videoTaskCount ?? 0 }),
    [resolvedOverview, videoTaskCount],
  )
  const metricCards = useMemo(() => {
    const projectOverview = { ...taskBasedOverview, projects: projectCount ?? 0 }
    return [
      {
        key: 'videos' as const,
        label: '总生成视频数',
        unit: '个',
        value: videoTaskCount,
        // 后端 overview 的 previous.video 口径仍可能是 works，不用它与成功任务数做虚假环比。
        trend: UNAVAILABLE_TREND,
      },
      {
        key: 'members' as const,
        label: '成员人数',
        unit: '人',
        value: overview ? resolvedOverview.members : null,
        trend: overview ? buildTrendMeta('members', resolvedOverview, previousOverview) : UNAVAILABLE_TREND,
      },
      {
        key: 'projects' as const,
        label: '项目个数',
        unit: '个',
        value: projectCount,
        trend:
          projectCount === null ? UNAVAILABLE_TREND : buildTrendMeta('projects', projectOverview, previousOverview),
      },
      {
        key: 'avg' as const,
        label: '平均消耗积分',
        unit: '积分/个',
        value: overview && videoTaskCount !== null ? avgPerVideo(resolvedOverview.credits, videoTaskCount) : null,
        trend:
          overview && videoTaskCount !== null
            ? buildTrendMeta('avg', taskBasedOverview, previousOverview)
            : UNAVAILABLE_TREND,
      },
      {
        key: 'credits' as const,
        label: '总消耗积分',
        unit: '积分',
        value: overview ? resolvedOverview.credits : null,
        trend: overview ? buildTrendMeta('credits', resolvedOverview, previousOverview) : UNAVAILABLE_TREND,
      },
    ]
  }, [overview, previousOverview, projectCount, resolvedOverview, taskBasedOverview, videoTaskCount])

  const sortedMembers = useMemo(
    () =>
      [...memberStats].sort((left, right) => {
        const difference = right[sortKey] - left[sortKey]
        return difference || right.videos - left.videos || String(left.name).localeCompare(String(right.name), 'zh-CN')
      }),
    [memberStats, sortKey],
  )

  const handleNavigate = (key: string) => {
    const path = ROUTE_MAP[key]
    if (path) navigate(path)
    else openComingSoon()
  }

  // 概览、成员目录、项目与成功任务并行加载；Promise.allSettled 允许局部失败降级展示。
  const loadDashboard = useCallback(async () => {
    const requestId = dashboardRequestIdRef.current + 1
    dashboardRequestIdRef.current = requestId
    const wsId = Number(workspaceId || 0)
    setLoading(true)
    setError('')

    if (!wsId || isPersonalWorkspace || !canViewDashboard) {
      setOverview(null)
      setVideoTaskCount(null)
      setProjectCount(null)
      setPreviousOverview(null)
      setMemberStats([])
      setVideoTrend([])
      setCreditTrend([])
      setLoading(false)
      return
    }

    const [overviewResult, memberResult, membersResult, projectsResult, videoTasksResult] = await Promise.allSettled([
      getWorkspaceOverview(wsId),
      getWorkspaceMemberStatistics(wsId),
      listWorkspaceMembers(wsId),
      listAllWorkspaceProjects(wsId),
      loadCachedTrendHistory(videoTaskHistoryCache, wsId, listAllSucceededVideoTasks),
    ])
    if (
      dashboardRequestIdRef.current !== requestId ||
      deriveWorkspaceId(useWorkspaceSessionStore.getState()) !== wsId
    ) {
      return
    }

    if (overviewResult.status === 'fulfilled') {
      setOverview(parseOverview(overviewResult.value))
      setPreviousOverview(parsePreviousOverview(overviewResult.value))
    } else {
      setOverview(null)
      setPreviousOverview(null)
    }

    setVideoTaskCount(videoTasksResult.status === 'fulfilled' ? videoTasksResult.value.length : null)

    const projects = projectsResult.status === 'fulfilled' ? projectsResult.value : null
    setProjectCount(projects ? projects.length : null)

    if (memberResult.status === 'fulfilled') {
      let rows = parseMemberStats(memberResult.value)
      if (projects) {
        const countByCreator = projectCountByCreator(projects)
        rows = rows.map((row) => {
          const userId = Number(row.id || 0)
          return {
            ...row,
            projects:
              Number.isFinite(userId) && userId > 0 ? countByCreator.get(Math.floor(userId)) || 0 : row.projects,
          }
        })
      }
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
        const memberById = new Map<number, { phone: string; avatar: string }>()
        for (const item of list) {
          if (!item || typeof item !== 'object') continue
          const id = Number(item?.user_id ?? item?.userId ?? item?.id ?? 0)
          if (!Number.isFinite(id) || id <= 0) continue
          memberById.set(Math.floor(id), {
            phone: normalizeMemberPhone(item),
            avatar: bindAssetUrlToWorkspace(normalizeMemberAvatar(item), wsId),
          })
        }
        rows = rows.map((row) => {
          const id = Number(row.id || 0)
          const directory = Number.isFinite(id) && id > 0 ? memberById.get(Math.floor(id)) : undefined
          return {
            ...row,
            phone: row.phone || directory?.phone || '',
            avatar: bindAssetUrlToWorkspace(row.avatar || directory?.avatar || '', wsId),
          }
        })
      }
      setMemberStats(rows)
    } else {
      setMemberStats([])
    }

    if (
      overviewResult.status === 'rejected' &&
      memberResult.status === 'rejected' &&
      projectsResult.status === 'rejected' &&
      videoTasksResult.status === 'rejected'
    ) {
      setError(
        getBusinessErrorMessage(
          overviewResult.reason,
          overviewResult.reason?.message || memberResult.reason?.message || '空间数据加载失败',
        ),
      )
    } else if (
      overviewResult.status === 'rejected' ||
      memberResult.status === 'rejected' ||
      projectsResult.status === 'rejected' ||
      videoTasksResult.status === 'rejected'
    ) {
      setError('部分数据加载失败，当前已展示后端可返回的真实数据')
    }

    setLoading(false)
  }, [workspaceId, isPersonalWorkspace, canViewDashboard])

  useEffect(() => {
    void loadDashboard()
    return () => {
      dashboardRequestIdRef.current += 1
    }
  }, [loadDashboard])

  // 月份变化时重新聚合视频和积分趋势；请求 id 与当前 workspace 双重拦截过期响应。
  const loadMonthlyTrends = useCallback(async () => {
    const requestId = trendRequestIdRef.current + 1
    trendRequestIdRef.current = requestId
    const wsId = Number(workspaceId || 0)

    if (!wsId || isPersonalWorkspace || !canViewDashboard) {
      setVideoTrend([])
      setCreditTrend([])
      setVideoTrendError('')
      setCreditTrendError('')
      setTrendLoading(false)
      return
    }

    setTrendLoading(true)
    setVideoTrendError('')
    setCreditTrendError('')
    setVideoTrend([])
    setCreditTrend([])

    const [tasksResult, ledgersResult] = await Promise.allSettled([
      loadCachedTrendHistory(videoTaskHistoryCache, wsId, listAllSucceededVideoTasks),
      loadCachedTrendHistory(creditLedgerHistoryCache, wsId, listAllSettledCreditLedgers),
    ])
    if (trendRequestIdRef.current !== requestId || deriveWorkspaceId(useWorkspaceSessionStore.getState()) !== wsId) {
      return
    }

    if (tasksResult.status === 'fulfilled') {
      const completedVideoTasks = tasksResult.value.filter((task) => videoOutputCount(task) > 0)
      setVideoTrend(
        buildDailyTrend(
          completedVideoTasks,
          selectedMonth,
          (task) => task?.updated_at ?? task?.updatedAt ?? task?.created_at ?? task?.createdAt,
          (task) => videoOutputCount(task),
        ),
      )
    } else {
      setVideoTrend([])
      setVideoTrendError(getBusinessErrorMessage(tasksResult.reason, '视频生成趋势加载失败'))
    }

    if (ledgersResult.status === 'fulfilled') {
      setCreditTrend(
        buildDailyTrend(
          ledgersResult.value,
          selectedMonth,
          (ledger) => ledger?.created_at ?? ledger?.createdAt ?? ledger?.updated_at ?? ledger?.updatedAt,
          (ledger) => Math.abs(Number(ledger?.amount || 0)),
        ),
      )
    } else {
      setCreditTrend([])
      setCreditTrendError(getBusinessErrorMessage(ledgersResult.reason, '积分消耗趋势加载失败'))
    }

    setTrendLoading(false)
  }, [workspaceId, isPersonalWorkspace, canViewDashboard, selectedMonth])

  useEffect(() => {
    void loadMonthlyTrends()
    return () => {
      trendRequestIdRef.current += 1
    }
  }, [loadMonthlyTrends])

  // 加 BOM 保证 Excel 正确识别中文，并对含逗号/引号/换行的字段做标准 CSV 转义。
  const handleExport = () => {
    const headers = ['排名', '成员', '成员账号', '项目个数', '总生成视频数', '消耗积分数', '平均每个视频消耗积分数']
    const rows = sortedMembers.map((item, index) => [
      index + 1,
      item.name,
      item.phone || '-',
      item.projects,
      item.videos,
      item.credits,
      avgPerVideo(item.credits, item.videos),
    ])
    const csv = `\ufeff${[headers, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\n')}`
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${pickText(currentWorkspace?.name, '空间')}-${selectedMonth}-数据统计.csv`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

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

        <main className="space-dashboard-main" aria-label="空间数据看板">
          <div className="space-dashboard-content">
            <header className="space-dashboard-header">
              <div className="space-dashboard-heading">
                <button type="button" className="space-dashboard-back" onClick={() => navigate(-1)} aria-label="返回">
                  <svg viewBox="0 0 28 28" aria-hidden="true">
                    <path d="M18 6 10 14l8 8" />
                    <path d="M10.5 14H23" />
                  </svg>
                </button>
                <h1>数据统计</h1>
              </div>
              <DatePicker
                className="space-dashboard-month-picker"
                picker="month"
                value={dayjs(`${selectedMonth}-01`)}
                format="YYYY年M月"
                allowClear={false}
                inputReadOnly
                placement="bottomRight"
                aria-label="统计月份"
                cellRender={(current, info) =>
                  info.type === 'month' ? (
                    <span className="space-dashboard-month-cell">{dayjs(current).format('M月')}</span>
                  ) : (
                    info.originNode
                  )
                }
                onChange={(value) => {
                  if (value) setSelectedMonth(value.format('YYYY-MM'))
                }}
              />
            </header>

            <div className="space-dashboard-period">
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="8" cy="8" r="6.5" />
                <path d="M8 7.2v4" />
                <circle cx="8" cy="4.7" r="0.7" className="is-filled" />
              </svg>
              <span>统计日期：{monthDateRange(selectedMonth)}</span>
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
                <div className="space-dashboard-loading__metrics">
                  <span className="is-primary" />
                  {Array.from({ length: 4 }).map((_, index) => (
                    <span key={index} />
                  ))}
                </div>
                <span className="space-dashboard-loading__charts" />
                <span className="space-dashboard-loading__table" />
              </div>
            ) : (
              <>
                {error ? <div className="space-dashboard-error">{error}</div> : null}

                <section className="space-dashboard-metrics" aria-label="核心指标">
                  {metricCards.map(({ key, ...card }, index) => (
                    <MetricCard key={key} {...card} metricKey={key} primary={index === 0} />
                  ))}
                </section>

                <section className="space-dashboard-trends" aria-label="趋势数据">
                  <TrendChart
                    title="视频生成趋势"
                    legend="视频数（个）"
                    color="#a16ff2"
                    data={videoTrend}
                    monthValue={selectedMonth}
                    fallbackMax={100}
                    unit="个"
                    emptyText={trendLoading ? '趋势数据加载中' : videoTrendError || '暂无视频生成数据'}
                    initialTooltip
                  />
                  <TrendChart
                    title="积分消耗趋势"
                    legend="消耗积分数"
                    color="#3b9ff8"
                    data={creditTrend}
                    monthValue={selectedMonth}
                    fallbackMax={25000}
                    unit=""
                    emptyText={trendLoading ? '趋势数据加载中' : creditTrendError || '暂无积分消耗数据'}
                  />
                </section>

                <section className="space-dashboard-ranking" aria-labelledby="space-dashboard-ranking-title">
                  <div className="space-dashboard-ranking__toolbar">
                    <div className="space-dashboard-ranking__title">
                      <h2 id="space-dashboard-ranking-title">成员贡献排行榜</h2>
                      <span className="space-dashboard-ranking__info" title="按所选指标从高到低排列成员">
                        i
                      </span>
                    </div>
                    <div className="space-dashboard-ranking__actions">
                      <label className="space-dashboard-sort">
                        <span className="sr-only">排行榜排序方式</span>
                        <select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}>
                          <option value="videos">按生成视频数排序</option>
                          <option value="credits">按消耗积分数排序</option>
                          <option value="projects">按项目个数排序</option>
                        </select>
                        <svg viewBox="0 0 20 20" aria-hidden="true">
                          <path d="m6 8 4 4 4-4" />
                        </svg>
                      </label>
                      <button
                        type="button"
                        className="space-dashboard-export"
                        onClick={handleExport}
                        disabled={!sortedMembers.length}
                      >
                        <svg viewBox="0 0 20 20" aria-hidden="true">
                          <path d="M10 2.5v10" />
                          <path d="m6.5 9 3.5 3.5L13.5 9" />
                          <path d="M3 14.5v2.5h14v-2.5" />
                        </svg>
                        导出数据
                      </button>
                    </div>
                  </div>

                  <div className="space-dashboard-table-wrap">
                    <div className="space-dashboard-table">
                      <div className="space-dashboard-table__head space-dashboard-table__grid">
                        <span>排名</span>
                        <span>成员</span>
                        <span>成员账号</span>
                        <span>项目个数</span>
                        <span>总生成视频数</span>
                        <span>消耗积分数</span>
                        <span>平均每个视频消耗积分数</span>
                      </div>
                      {sortedMembers.length ? (
                        sortedMembers.map((item, index) => (
                          <div
                            key={String(item.id || index)}
                            className="space-dashboard-table__row space-dashboard-table__grid"
                          >
                            <span className="space-dashboard-table__rank">
                              <RankBadge rank={index + 1} />
                            </span>
                            <span className="space-dashboard-table__member">
                              <MemberAvatar src={item.avatar} name={item.name} />
                              <span>{item.name}</span>
                            </span>
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
                  </div>
                </section>
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
