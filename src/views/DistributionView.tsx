import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { DatePicker } from 'antd'
import dayjs from 'dayjs'
import { getReferralMyCode, listDistributionCommissions, listDistributionInvitees } from '@/api/business'
import WithdrawalDialog from '@/components/distribution/WithdrawalDialog'
import { useDistributionAccess } from '@/composables/useDistributionAccess'
import arrowRightIcon from '@/assets/distribution/arrow-right.svg?no-inline'
import backIcon from '@/assets/distribution/back.svg?no-inline'
import calendarIcon from '@/assets/distribution/calendar.svg?no-inline'
import directInviteIcon from '@/assets/distribution/direct-invite.svg?no-inline'
import distributorInviteIcon from '@/assets/distribution/distributor-invite.svg?no-inline'
import exportIcon from '@/assets/distribution/export.svg?no-inline'
import noticeIcon from '@/assets/distribution/notice.svg?no-inline'
import pendingIcon from '@/assets/distribution/pending.svg?no-inline'
import pendingBackground from '@/assets/distribution/pending-bg.svg?no-inline'
import searchIcon from '@/assets/distribution/search.svg?no-inline'
import totalRebateIcon from '@/assets/distribution/total-rebate.svg?no-inline'
import withdrawableIcon from '@/assets/distribution/withdrawable.svg?no-inline'
import './DistributionView.css'

interface DistributionFilters {
  keyword: string
  mobile: string
  relationship: string
  orderType: string
  status: string
  startTime: string
  endTime: string
  minAmount: string
  maxAmount: string
}

interface DistributionSummaryCard {
  label: string
  value: string
  unit: string
  icon: string
  action?: string
  backgroundIcon?: string
  hidden?: boolean
}

interface DistributionOverviewDetail {
  label: string
  value: string
  hint: string
  explanation: string
  source: string
}

type InviteeView = 'customer' | 'distributor'

const EMPTY_FILTERS: DistributionFilters = {
  keyword: '',
  mobile: '',
  relationship: '',
  orderType: '',
  status: '',
  startTime: '',
  endTime: '',
  minAmount: '',
  maxAmount: '',
}

const PAGE_SIZE = 10
const COMMISSION_FETCH_SIZE = 100
const MAX_COMMISSION_RECORDS = 5000
const INVITEE_FETCH_SIZE = 200
const MAX_INVITEE_RECORDS = 5000
const DISTRIBUTION_REFRESH_INTERVAL_MS = 3_000

const ORDER_TYPE_DEFINITIONS = [
  {
    value: 'subscription_initial',
    label: '首次订阅',
    aliases: ['subscription_initial', 'initial_subscription', 'first_subscription', 'new_subscription'],
  },
  {
    value: 'subscription_renewal',
    label: '续订',
    aliases: ['subscription_renewal', 'renewal', 'subscription_renew', 'recurring_subscription'],
  },
  {
    value: 'credits_recharge',
    label: '积分充值',
    aliases: [
      'credits_recharge',
      'credit_recharge',
      'points_recharge',
      'point_recharge',
      'balance_recharge',
      'credit_purchase',
      'points_purchase',
      'recharge',
      'top_up',
      'topup',
    ],
  },
  {
    value: 'membership_subscription',
    label: '会员订阅',
    aliases: ['membership', 'membership_subscription', 'member_subscription', 'vip_subscription'],
  },
] as const

function DistributionPagination({
  page,
  total,
  label,
  onPageChange,
}: {
  page: number
  total: number
  label: string
  onPageChange: (page: number) => void
}) {
  const pageCount = Math.ceil(total / PAGE_SIZE)
  if (pageCount <= 1) return null
  return (
    <nav className="distribution-pagination" aria-label={label}>
      <button type="button" disabled={page === 1} onClick={() => onPageChange(Math.max(1, page - 1))}>
        上一页
      </button>
      <span>
        第 {page} 页，共 {pageCount} 页
      </span>
      <button type="button" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
        下一页
      </button>
    </nav>
  )
}

function DistributionMetricHelp({
  label,
  explanation,
  source,
}: {
  label: string
  explanation: string
  source: string
}) {
  return (
    <details className="distribution-metric-help">
      <summary aria-label={`查看“${label}”说明`} title={`查看“${label}”说明`}>
        i
      </summary>
      <div className="distribution-metric-help__popover" role="note">
        <strong>{label}是什么？</strong>
        <p>{explanation}</p>
        <small>数据来源：{source}</small>
      </div>
    </details>
  )
}

function pick(source: any, keys: string[], fallback: any = ''): any {
  for (const key of keys) {
    const value = source?.[key]
    if (value !== undefined && value !== null && value !== '') return value
  }
  return fallback
}

function unwrap(source: any): any {
  return source?.data && typeof source.data === 'object' && !Array.isArray(source.data) ? source.data : source
}

function pageItems(payload: any): any[] {
  const source = unwrap(payload)
  if (Array.isArray(source)) return source
  return [source?.items, source?.records, source?.list, source?.commissions, source?.invitees].find(Array.isArray) || []
}

function pageTotal(payload: any, fallback: number): number {
  const source = unwrap(payload)
  const pagination = source?.pagination || source?.page || source?.meta
  const value = Number(
    pick(source, ['total', 'count', 'total_count'], pick(pagination, ['total', 'count', 'total_count'], fallback)),
  )
  return Number.isFinite(value) ? value : fallback
}

function optionalMoneyCents(source: any, yuanKeys: string[], centsKeys: string[] = []): number | null {
  const centsValue = pick(source, centsKeys, null)
  if (centsValue !== null) {
    const cents = Number(centsValue)
    if (Number.isSafeInteger(cents)) return cents
  }
  const yuanValue = pick(source, yuanKeys, null)
  if (yuanValue === null) return null
  const yuan = Number(yuanValue)
  if (!Number.isFinite(yuan)) return null
  const unit = String(pick(source, ['amount_unit', 'money_unit', 'currency_unit'], ''))
    .trim()
    .toLowerCase()
  const cents = ['cent', 'cents', 'fen', '分'].includes(unit) ? yuan : Math.round(yuan * 100)
  return Number.isSafeInteger(cents) ? cents : null
}

function formatMoneyFromCents(value: number): string {
  const cents = Number.isSafeInteger(value) ? value : 0
  const sign = cents < 0 ? '-' : ''
  const absolute = Math.abs(cents)
  const yuan = Math.floor(absolute / 100).toLocaleString('zh-CN')
  const fraction = String(absolute % 100).padStart(2, '0')
  return `${sign}${yuan}.${fraction}`
}

function formatOptionalMoneyFromCents(value: number | null): string {
  return value === null ? '暂无数据' : `￥${formatMoneyFromCents(value)}`
}

function centsFrom(source: any, keys: string[]): number {
  const value = Number(pick(source, keys, 0))
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
}

function optionalNumber(source: any, keys: string[]): number | null {
  const value = pick(source, keys, null)
  if (value === null) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function formatDateTime(value: any): { date: string; time: string } {
  if (!value) return { date: '---', time: '' }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    const raw = String(value).trim()
    const [day = raw, time = ''] = raw.split(/[T ]/)
    return { date: day || '---', time: time.slice(0, 8) }
  }
  const parts = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || ''
  return {
    date: `${read('year')}-${read('month')}-${read('day')}`,
    time: `${read('hour')}:${read('minute')}:${read('second')}`,
  }
}

function isDistributorRelation(value: any): boolean {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
  return ['distributor', 'indirect', 'distributor_customer'].includes(normalized)
}

function relationLabel(value: any): string {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
  if (['direct', 'mine', 'my_customer', 'direct_customer', 'customer'].includes(normalized)) return '我的客户'
  if (isDistributorRelation(normalized)) return '分销商'
  return String(value || '---')
}

function commissionRelationship(row: any): { label: string; value: '' | 'direct' | 'distributor' } {
  const level = Number(pick(row, ['relation_level', 'relationLevel', 'level'], 0)) || 0
  if (level >= 2) return { label: '分销商客户', value: 'distributor' }

  const rawValue = pick(row, ['relationship', 'relation', 'relation_type', 'kind'], '')
  if (!rawValue && level <= 0) return { label: '---', value: '' }
  const normalized = String(rawValue || '')
    .trim()
    .toLowerCase()
  const isDistributor = ['distributor', 'indirect', 'distributor_customer'].includes(normalized)
  return {
    label: isDistributor ? relationLabel(rawValue) : '我的客户',
    value: isDistributor ? 'distributor' : 'direct',
  }
}

function orderTypeMeta(value: any): { label: string; value: string } {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
  if (!normalized) return { label: '---', value: '' }
  const definition = ORDER_TYPE_DEFINITIONS.find((item) => (item.aliases as readonly string[]).includes(normalized))
  if (definition) return { label: definition.label, value: definition.value }
  if (/[\u3400-\u9fff]/u.test(normalized)) return { label: String(value).trim(), value: 'other' }
  return { label: '其他订单', value: 'other' }
}

function statusMeta(value: any): { label: string; tone: 'pending' | 'settled' | 'cancelled' | 'unknown' } {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
  if (['settled', 'completed', 'paid', 'success', 'credited'].includes(normalized))
    return { label: '已入账', tone: 'settled' }
  if (['cancelled', 'canceled', 'refunded', 'failed'].includes(normalized)) {
    return { label: '已取消', tone: 'cancelled' }
  }
  if (normalized === 'not_credited') return { label: '未入账', tone: 'pending' }
  if (['pending', 'processing', 'settling'].includes(normalized)) return { label: '结算中', tone: 'pending' }
  return { label: normalized ? String(value) : '状态待同步', tone: 'unknown' }
}

function moneyCardValue(
  source: any,
  yuanKeys: string[],
  centsKeys: string[],
): { value: string; unit: string; hidden: boolean } {
  const amountCents = optionalMoneyCents(source, yuanKeys, centsKeys)
  return {
    value: formatMoneyFromCents(amountCents ?? 0),
    unit: '￥',
    hidden: false,
  }
}

function withdrawnMoneyCardValue(source: any): { value: string; unit: string; hidden: boolean } {
  const explicitAmountCents = optionalMoneyCents(
    source,
    ['withdrawn_amount', 'total_withdrawn', 'total_withdrawn_amount'],
    ['withdrawn_cents', 'withdrawn_amount_cents', 'total_withdrawn_cents', 'total_withdrawn_amount_cents'],
  )
  return explicitAmountCents === null
    ? { value: '--', unit: '￥', hidden: false }
    : { value: formatMoneyFromCents(explicitAmountCents), unit: '￥', hidden: false }
}

function parseYuanInputToCents(value: string): number | null {
  const normalized = value.trim()
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null
  const [yuan = '0', fraction = ''] = normalized.split('.')
  const cents = Number(yuan) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(cents) ? cents : null
}

function csvCell(value: any): string {
  return `"${String(value ?? '').replaceAll('"', '""')}"`
}

export default function DistributionView() {
  const navigate = useNavigate()
  const { overview: rawOverview, retry: refreshOverview, status: distributionStatus } = useDistributionAccess()
  const canManageDistribution = distributionStatus === 'allowed'
  const [draftFilters, setDraftFilters] = useState<DistributionFilters>(EMPTY_FILTERS)
  const [filters, setFilters] = useState<DistributionFilters>(EMPTY_FILTERS)
  const [page, setPage] = useState(1)
  const [inviteePage, setInviteePage] = useState(1)
  const [rows, setRows] = useState<any[]>([])
  const [invitees, setInvitees] = useState<any[]>([])
  const [inviteeView, setInviteeView] = useState<InviteeView>('customer')
  const [loading, setLoading] = useState(false)
  const [listError, setListError] = useState('')
  const [rulesOpen, setRulesOpen] = useState(false)
  const [withdrawalOpen, setWithdrawalOpen] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [channelInviteOpen, setChannelInviteOpen] = useState(false)
  const [channelCopyFeedback, setChannelCopyFeedback] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [copyFeedback, setCopyFeedback] = useState('')
  const inviteesRequestRef = useRef<AbortController | null>(null)
  const commissionsRequestRef = useRef<AbortController | null>(null)
  const handleInviteeTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const nextView: InviteeView = event.key === 'ArrowLeft' || event.key === 'Home' ? 'customer' : 'distributor'
    setInviteeView(nextView)
    setInviteePage(1)
    window.requestAnimationFrame(() => {
      document
        .getElementById(nextView === 'customer' ? 'distribution-customer-tab' : 'distribution-distributor-tab')
        ?.focus()
    })
  }
  useEffect(() => {
    document.documentElement.classList.add('distribution-document-scroll')
    return () => document.documentElement.classList.remove('distribution-document-scroll')
  }, [])

  const overview = useMemo(() => unwrap(rawOverview) || {}, [rawOverview])
  const withdrawableCents = centsFrom(overview, [
    'withdrawable_cents',
    'balance_cents',
    'withdrawable_commission_cents',
    'withdrawable_amount_cents',
  ])
  const withdrawingCents = centsFrom(overview, ['withdrawing_cents'])
  const withdrawnCents = centsFrom(overview, [
    'withdrawn_cents',
    'withdrawn_amount_cents',
    'total_withdrawn_cents',
    'total_withdrawn_amount_cents',
  ])
  const overviewInviteCode = String(pick(overview, ['code', 'invite_code', 'inviteCode', 'referral_code'], '')).trim()
  const distributorCode = String(
    pick(
      overview,
      ['distributor_code', 'distributorCode', 'channel_invite_code', 'channelInviteCode'],
      pick(overview?.distributor, ['code', 'invite_code', 'inviteCode'], ''),
    ),
  ).trim()
  const inviteUrl = inviteCode ? `${window.location.origin}/login?invite_code=${encodeURIComponent(inviteCode)}` : ''
  // 部分后端版本没有单独返回 distributor_code，渠道关系由 invite_type=channel 区分；
  // 因此优先使用渠道专属码，缺失时兼容当前营销人员的普通推广码。
  const channelInviteCode = distributorCode || overviewInviteCode || inviteCode
  const channelInviteUrl = channelInviteCode
    ? `${window.location.origin}/login?invite_code=${encodeURIComponent(channelInviteCode)}&invite_type=channel`
    : ''

  useEffect(() => {
    const app = document.getElementById('app')
    if (!app) return undefined
    const previousOverflowX = app.style.overflowX
    const previousOverflowY = app.style.overflowY
    app.style.overflowX = 'auto'
    app.style.overflowY = 'auto'
    return () => {
      app.style.overflowX = previousOverflowX
      app.style.overflowY = previousOverflowY
    }
  }, [])

  const loadInvitees = useCallback(() => {
    inviteesRequestRef.current?.abort()
    const controller = new AbortController()
    inviteesRequestRef.current = controller
    void (async () => {
      const collected: any[] = []
      let expectedTotal = 0
      let offset = 0

      while (!controller.signal.aborted && collected.length < MAX_INVITEE_RECORDS) {
        const payload = await listDistributionInvitees({
          limit: INVITEE_FETCH_SIZE,
          offset,
          signal: controller.signal,
        })
        const items = pageItems(payload)
        const reportedTotal = pageTotal(payload, Number.NaN)
        if (Number.isFinite(reportedTotal)) expectedTotal = reportedTotal
        collected.push(...items)
        offset += items.length
        if (!items.length || items.length < INVITEE_FETCH_SIZE || (expectedTotal > 0 && offset >= expectedTotal)) break
      }

      return { items: collected, total: expectedTotal || collected.length }
    })()
      .then(({ items }) => {
        setInvitees(items)
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setInvitees([])
      })
      .finally(() => {
        if (inviteesRequestRef.current === controller) {
          inviteesRequestRef.current = null
        }
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    return loadInvitees()
  }, [loadInvitees])

  const loadRows = useCallback(() => {
    commissionsRequestRef.current?.abort()
    const controller = new AbortController()
    commissionsRequestRef.current = controller
    setLoading(true)
    setListError('')
    void (async () => {
      const collected: any[] = []
      let expectedTotal = 0
      let offset = 0

      while (!controller.signal.aborted && collected.length < MAX_COMMISSION_RECORDS) {
        const payload = await listDistributionCommissions({
          offset,
          limit: COMMISSION_FETCH_SIZE,
          signal: controller.signal,
        })
        const items = pageItems(payload)
        const reportedTotal = pageTotal(payload, Number.NaN)
        if (Number.isFinite(reportedTotal)) expectedTotal = reportedTotal
        collected.push(...items)
        offset += items.length
        if (!items.length || items.length < COMMISSION_FETCH_SIZE || (expectedTotal > 0 && offset >= expectedTotal))
          break
      }

      return collected
    })()
      .then((items) => {
        setRows(items)
      })
      .catch((error: any) => {
        if (controller.signal.aborted) return
        setRows([])
        setListError(error?.message || '收益明细加载失败，请稍后重试')
      })
      .finally(() => {
        if (commissionsRequestRef.current === controller) {
          commissionsRequestRef.current = null
          if (!controller.signal.aborted) setLoading(false)
        }
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    return loadRows()
  }, [loadRows])

  const refreshDistributionData = useCallback(() => {
    refreshOverview()
    if (!inviteesRequestRef.current) loadInvitees()
    if (!commissionsRequestRef.current) loadRows()
  }, [loadInvitees, loadRows, refreshOverview])

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refreshDistributionData()
    }
    const timer = window.setInterval(refreshWhenVisible, DISTRIBUTION_REFRESH_INTERVAL_MS)
    window.addEventListener('focus', refreshWhenVisible)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refreshWhenVisible)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [refreshDistributionData])

  const inviteeCounts = useMemo(
    () =>
      invitees.reduce(
        (counts, item) => {
          const relation = String(pick(item, ['relationship', 'relation', 'relation_type'], 'direct'))
            .trim()
            .toLowerCase()
          if (isDistributorRelation(relation)) counts.distributor += 1
          else counts.direct += 1
          return counts
        },
        { direct: 0, distributor: 0 },
      ),
    [invitees],
  )

  const cards = useMemo<DistributionSummaryCard[]>(
    () => [
      {
        label: '累计返利金额',
        ...moneyCardValue(
          overview,
          ['total_earned', 'total_commission', 'total_commission_amount', 'total_rebate'],
          ['total_earned_cents', 'total_commission_cents'],
        ),
        icon: totalRebateIcon,
      },
      {
        label: '可提现金额',
        ...moneyCardValue(
          overview,
          ['balance', 'withdrawable_commission', 'withdrawable_amount', 'available_commission'],
          ['withdrawable_cents', 'balance_cents', 'withdrawable_commission_cents', 'withdrawable_amount_cents'],
        ),
        icon: withdrawableIcon,
        action: '提现',
      },
      {
        label: '已提现金额',
        ...withdrawnMoneyCardValue(overview),
        icon: pendingIcon,
        backgroundIcon: pendingBackground,
      },
      {
        label: '成功邀请客户',
        value: String(
          Math.max(
            Number(pick(overview, ['direct_invitee_count', 'successful_invitees', 'invitee_count'], 0)) || 0,
            inviteeCounts.direct,
          ),
        ),
        unit: '人',
        icon: directInviteIcon,
      },
      {
        label: '成功邀请渠道',
        value: String(
          Math.max(
            Number(
              pick(
                overview,
                [
                  'channel_invitee_count',
                  'successful_channel_invitees',
                  'invited_distributor_count',
                  'distributor_invitee_count',
                  'indirect_invitee_count',
                  'sub_invitee_count',
                ],
                0,
              ),
            ) || 0,
            inviteeCounts.distributor,
          ),
        ),
        unit: '个',
        icon: distributorInviteIcon,
      },
    ],
    [inviteeCounts, overview],
  )

  const overviewDetails = useMemo(() => {
    const items: DistributionOverviewDetail[] = []
    const withdrawingCentsValue = optionalMoneyCents(overview, [], ['withdrawing_cents'])
    const totalRechargedCents = optionalMoneyCents(overview, [], ['total_recharged_cents'])
    const totalConsumed = optionalNumber(overview, ['total_consumed_credits'])
    const directRebateCents = optionalMoneyCents(overview, [], ['direct_rebate_cents'])
    const directRebateCount = optionalNumber(overview, ['direct_rebate_count'])
    const indirectRebateCents = optionalMoneyCents(overview, [], ['indirect_rebate_cents'])
    const indirectRebateCount = optionalNumber(overview, ['indirect_rebate_count'])

    if (withdrawingCentsValue !== null) {
      items.push({
        label: '提现中',
        value: `￥${formatMoneyFromCents(withdrawingCentsValue)}`,
        hint: '已申请、尚未完成打款',
        explanation: '已提交提现申请，但平台尚未处理完成的金额；处理完成后会转入“已提现金额”。',
        source: '系统汇总状态为“提现中”的提现申请',
      })
    }
    if (totalRechargedCents !== null) {
      items.push({
        label: '累计充值',
        value: `￥${formatMoneyFromCents(totalRechargedCents)}`,
        hint: '受邀用户积分充值订单总额',
        explanation: '您邀请关系内的用户，已成功支付的积分充值订单实付总额，不包含其他类型订单。',
        source: '系统汇总受邀用户的积分充值订单',
      })
    }
    if (totalConsumed !== null) {
      items.push({
        label: '累计消耗积分',
        value: String(totalConsumed),
        hint: '受邀用户实际使用的积分',
        explanation: '您邀请关系内的用户在使用平台功能时，已经实际扣除的积分总数。',
        source: '系统汇总受邀用户的积分实际扣减记录',
      })
    }
    if (directRebateCents !== null || directRebateCount !== null) {
      items.push({
        label: '直接返利',
        value: `￥${formatMoneyFromCents(directRebateCents ?? 0)}`,
        hint: `直接客户贡献 · ${directRebateCount ?? 0} 笔订单`,
        explanation: '您直接邀请的客户，其符合返利规则的订单为您产生的返利金额。',
        source: '系统汇总直接邀请客户产生返利的订单',
      })
    }
    if (indirectRebateCents !== null || indirectRebateCount !== null) {
      items.push({
        label: '间接返利',
        value: `￥${formatMoneyFromCents(indirectRebateCents ?? 0)}`,
        hint: `下级分销关系贡献 · ${indirectRebateCount ?? 0} 笔订单`,
        explanation: '由您邀请的下级分销关系所带来的客户订单，为您产生的返利金额。',
        source: '系统汇总下级分销关系产生返利的订单',
      })
    }
    return items
  }, [overview])

  const normalizedInvitees = useMemo(
    () =>
      invitees.map((item, index) => {
        const relationshipValue = pick(item, ['relationship', 'relation', 'relation_type', 'kind'], 'direct')
        return {
          key: `invitee-${String(pick(item, ['invitee_id', 'customer_id', 'user_id', 'id'], index))}`,
          matchId: String(
            pick(
              item,
              ['customer_id', 'customer_user_id', 'invitee_user_id', 'user_id', 'account_id', 'invitee_id', 'mobile'],
              '',
            ),
          ).trim(),
          registeredAt: formatDateTime(
            pick(item, ['registered_at', 'bound_at', 'invited_at', 'created_at', 'registration_time']),
          ),
          customerName: pick(
            item,
            ['customer_name', 'invitee_name', 'display_name', 'user_name', 'username', 'account_name', 'nickname'],
            '---',
          ),
          relationship: relationLabel(relationshipValue),
          isDistributor: isDistributorRelation(relationshipValue),
          mobile: String(pick(item, ['mobile', 'masked_mobile'], '')).trim(),
          paidOrderCount: Number(pick(item, ['paid_order_count', 'order_count'], 0)) || 0,
          invitedCustomerCount: optionalNumber(item, ['invited_customer_count']),
          distributorName: pick(item, ['distributor_name', 'owner_name', 'referrer_name'], '---'),
          customerStatus: String(
            pick(item, ['customer_status', 'operation_status', 'usage_status', 'status'], ''),
          ).trim(),
          totalRechargeCents: optionalMoneyCents(
            item,
            ['total_recharge_amount', 'total_recharge', 'recharge_total', 'total_paid_amount'],
            ['total_recharge_cents', 'total_recharge_amount_cents', 'total_paid_amount_cents', 'total_paid_cents'],
          ),
          totalRebateCents: optionalMoneyCents(item, ['total_rebate_amount', 'total_rebate'], ['total_rebate_cents']),
          lastPaymentAt: formatDateTime(pick(item, ['last_payment_at', 'last_paid_at'])),
          totalConsumedCredits: optionalNumber(item, ['total_consumed_credits']),
          balanceCents: optionalMoneyCents(
            item,
            ['balance_amount', 'available_balance', 'balance'],
            ['balance_amount_cents', 'available_balance_cents', 'balance_cents'],
          ),
        }
      }),
    [invitees],
  )

  const visibleInvitees = useMemo(
    () => normalizedInvitees.filter((row) => row.isDistributor === (inviteeView === 'distributor')),
    [inviteeView, normalizedInvitees],
  )
  const visibleInviteeRows = useMemo(
    () => visibleInvitees.slice((inviteePage - 1) * PAGE_SIZE, inviteePage * PAGE_SIZE),
    [inviteePage, visibleInvitees],
  )

  useEffect(() => {
    const lastPage = Math.max(1, Math.ceil(visibleInvitees.length / PAGE_SIZE))
    if (inviteePage > lastPage) setInviteePage(lastPage)
  }, [inviteePage, visibleInvitees.length])

  const normalizedCommissions = useMemo(
    () =>
      rows.map((row, index) => {
        const occurredAt = pick(row, [
          'consumed_at',
          'paid_at',
          'payment_time',
          'recharged_at',
          'order_paid_at',
          'occurred_at',
          'created_at',
        ])
        const consumedAt = formatDateTime(occurredAt)
        const settledAt = formatDateTime(pick(row, ['settled_at', 'settlement_time']))
        const relationship = commissionRelationship(row)
        // payment_type 表示支付方式，不能作为业务订单类型使用。
        const orderType = orderTypeMeta(pick(row, ['order_type'], ''))
        return {
          key: String(pick(row, ['commission_id', 'id', 'order_id'], index)),
          matchId: String(
            pick(row, ['customer_id', 'customer_user_id', 'invitee_user_id', 'user_id', 'account_id'], ''),
          ).trim(),
          consumedAt,
          occurredAtMs: new Date(occurredAt).getTime(),
          customerName: pick(
            row,
            ['customer_name', 'invitee_name', 'display_name', 'user_name', 'username', 'account_name', 'nickname'],
            '---',
          ),
          relationship: relationship.label,
          relationshipValue: relationship.value,
          mobile: String(pick(row, ['mobile', 'masked_mobile'], '')).trim(),
          orderType: orderType.label,
          orderTypeValue: orderType.value,
          distributorName: pick(row, ['distributor_name', 'owner_name', 'referrer_name'], '---'),
          paidAmountCents: optionalMoneyCents(
            row,
            ['paid_amount', 'payment_amount', 'recharge_amount', 'order_amount'],
            ['paid_amount_cents', 'payment_amount_cents', 'recharge_amount_cents', 'order_amount_cents'],
          ),
          commissionAmountCents: optionalMoneyCents(
            row,
            ['commission_amount', 'rebate_amount', 'income_amount'],
            ['commission_amount_cents', 'rebate_amount_cents', 'income_amount_cents'],
          ),
          status: statusMeta(pick(row, ['status', 'commission_status', 'settlement_status', 'rebate_status'])),
          settledAt,
        }
      }),
    [rows],
  )

  const orderTypeOptions = useMemo(() => {
    const options = new Map<string, string>()
    normalizedCommissions.forEach((row) => {
      if (row.orderTypeValue && row.orderType !== '---') options.set(row.orderTypeValue, row.orderType)
    })
    return Array.from(options, ([value, label]) => ({ value, label }))
  }, [normalizedCommissions])

  const filteredCommissionRows = useMemo(() => {
    const keyword = filters.keyword.trim().toLowerCase()
    const mobile = filters.mobile.replace(/[^\d]/g, '')
    const startTime = filters.startTime ? new Date(`${filters.startTime}T00:00:00`).getTime() : Number.NEGATIVE_INFINITY
    const endTime = filters.endTime ? new Date(`${filters.endTime}T23:59:59.999`).getTime() : Number.POSITIVE_INFINITY
    const minAmountCents =
      filters.minAmount === '' ? Number.NEGATIVE_INFINITY : (parseYuanInputToCents(filters.minAmount) ?? Number.NaN)
    const maxAmountCents =
      filters.maxAmount === '' ? Number.POSITIVE_INFINITY : (parseYuanInputToCents(filters.maxAmount) ?? Number.NaN)

    return normalizedCommissions.filter((row) => {
      const rowMobile = row.mobile.replace(/[^\d]/g, '')
      const matchesKeyword =
        !keyword ||
        String(row.customerName).toLowerCase().includes(keyword) ||
        String(row.matchId).toLowerCase().includes(keyword)
      const matchesMobile = !mobile || rowMobile.includes(mobile)
      const matchesRelationship = !filters.relationship || row.relationshipValue === filters.relationship
      const matchesOrderType = !filters.orderType || row.orderTypeValue === filters.orderType
      const matchesStatus = !filters.status || row.status.tone === filters.status
      const matchesAmount =
        (!filters.minAmount && !filters.maxAmount) ||
        (row.paidAmountCents !== null && row.paidAmountCents >= minAmountCents && row.paidAmountCents <= maxAmountCents)
      const matchesTime =
        (!filters.startTime && !filters.endTime) ||
        (Number.isFinite(row.occurredAtMs) && row.occurredAtMs >= startTime && row.occurredAtMs <= endTime)
      return (
        matchesKeyword &&
        matchesMobile &&
        matchesRelationship &&
        matchesOrderType &&
        matchesStatus &&
        matchesAmount &&
        matchesTime
      )
    })
  }, [filters, normalizedCommissions])
  const total = filteredCommissionRows.length
  const normalizedRows = useMemo(
    () => filteredCommissionRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filteredCommissionRows, page],
  )

  useEffect(() => {
    const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE))
    if (page > lastPage) setPage(lastPage)
  }, [page, total])
  const inviteeFields = useMemo(
    () => ({
      registeredAt: visibleInvitees.some((row) => row.registeredAt.date !== '---'),
      customerName: visibleInvitees.some((row) => row.customerName !== '---'),
      relationship: visibleInvitees.some((row) => row.relationship !== '---'),
      mobile: visibleInvitees.some((row) => Boolean(row.mobile)),
      paidOrderCount: visibleInvitees.some((row) => row.paidOrderCount > 0),
      invitedCustomerCount: visibleInvitees.some((row) => row.invitedCustomerCount !== null),
      distributorName: visibleInvitees.some((row) => row.distributorName !== '---'),
      customerStatus: visibleInvitees.some((row) => Boolean(row.customerStatus)),
      totalRecharge: visibleInvitees.some((row) => row.totalRechargeCents !== null),
      // 后端字段尚未完全上线，先固定展示列；缺失值显示为 ---。
      totalConsumedCredits: true,
      totalRebate: visibleInvitees.some((row) => row.totalRebateCents !== null),
      lastPaymentAt: visibleInvitees.some((row) => row.lastPaymentAt.date !== '---'),
      balance: visibleInvitees.some((row) => row.balanceCents !== null),
    }),
    [visibleInvitees],
  )

  const commissionFields = useMemo(
    () => ({
      consumedAt: normalizedRows.some((row) => row.consumedAt.date !== '---'),
      customerName: normalizedRows.some((row) => row.customerName !== '---'),
      relationship: normalizedRows.some((row) => row.relationship !== '---'),
      mobile: normalizedRows.some((row) => Boolean(row.mobile)),
      orderType: normalizedRows.some((row) => row.orderType !== '---'),
      distributorName: normalizedRows.some((row) => row.distributorName !== '---'),
      paidAmount: normalizedRows.some((row) => row.paidAmountCents !== null),
      commissionAmount: normalizedRows.some((row) => row.commissionAmountCents !== null),
      status: normalizedRows.some((row) => row.status.tone !== 'unknown'),
      settledAt: normalizedRows.some((row) => row.settledAt.date !== '---'),
    }),
    [normalizedRows],
  )
  const incompleteCommissionRows = useMemo(
    () =>
      normalizedRows.filter(
        (row) =>
          (row.paidAmountCents !== null || row.commissionAmountCents !== null) &&
          (row.customerName === '---' || row.relationship === '---'),
      ).length,
    [normalizedRows],
  )
  const updateFilter = (key: keyof DistributionFilters, value: string) => {
    setDraftFilters((current) => ({ ...current, [key]: value }))
  }

  const submitFilters = () => {
    const nextFilters = { ...draftFilters }
    const minAmountCents = parseYuanInputToCents(nextFilters.minAmount)
    const maxAmountCents = parseYuanInputToCents(nextFilters.maxAmount)
    if (
      nextFilters.minAmount !== '' &&
      nextFilters.maxAmount !== '' &&
      minAmountCents !== null &&
      maxAmountCents !== null &&
      minAmountCents > maxAmountCents
    ) {
      nextFilters.minAmount = draftFilters.maxAmount
      nextFilters.maxAmount = draftFilters.minAmount
      setDraftFilters(nextFilters)
    }
    setPage(1)
    setFilters(nextFilters)
  }

  const resetFilters = () => {
    setDraftFilters(EMPTY_FILTERS)
    setFilters(EMPTY_FILTERS)
    setPage(1)
  }

  const exportRows = () => {
    const header = [
      '消费时间',
      '客户名称',
      '手机号',
      '关系',
      '订单类型',
      '所属分销商',
      '充值金额',
      '我的收益',
      '收益状态',
      '结算时间',
    ]
    const body = filteredCommissionRows.map((row) => [
      `${row.consumedAt.date} ${row.consumedAt.time}`.trim(),
      row.customerName,
      row.mobile,
      row.relationship,
      row.orderType,
      row.distributorName,
      row.paidAmountCents === null ? '暂无数据' : formatMoneyFromCents(row.paidAmountCents),
      row.commissionAmountCents === null ? '暂无数据' : formatMoneyFromCents(row.commissionAmountCents),
      row.status.label,
      `${row.settledAt.date} ${row.settledAt.time}`.trim(),
    ])
    const csv = [header, ...body].map((line) => line.map(csvCell).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `邀请收益明细-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const loadInviteCode = useCallback(() => {
    if (overviewInviteCode) {
      setInviteCode(overviewInviteCode)
      setInviteError('')
      return
    }
    setInviteLoading(true)
    setInviteError('')
    void getReferralMyCode()
      .then((code) => {
        if (!code) throw new Error('后端未返回专属邀请码')
        setInviteCode(code)
      })
      .catch((error: any) => {
        setInviteCode('')
        setInviteError(error?.message || '邀请码加载失败，请稍后重试')
      })
      .finally(() => setInviteLoading(false))
  }, [overviewInviteCode])

  const openInvite = () => {
    setInviteOpen(true)
    setCopyFeedback('')
    if (!inviteCode && !inviteLoading) loadInviteCode()
  }

  const copyInviteValue = async (value: string, label: string) => {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setCopyFeedback(`${label}已复制`)
    } catch {
      setCopyFeedback('复制失败，请手动复制')
    }
  }

  const openChannelInvite = () => {
    setChannelCopyFeedback('')
    setChannelInviteOpen(true)
    if (!channelInviteCode && !inviteLoading) loadInviteCode()
  }

  const copyChannelInviteLink = async () => {
    if (!channelInviteUrl) return
    try {
      await navigator.clipboard.writeText(channelInviteUrl)
      setChannelCopyFeedback('渠道邀请链接已复制')
    } catch {
      setChannelCopyFeedback('复制失败，请手动复制')
    }
  }

  return (
    <main className="distribution-page">
      <div className="distribution-page__canvas">
        <header className="distribution-header">
          <button type="button" className="distribution-back" onClick={() => navigate(-1)} aria-label="返回上一页">
            <img src={backIcon} alt="" width={28} height={28} />
          </button>
          <h1>邀请收益</h1>
          <button
            type="button"
            className="distribution-channel-invite-button"
            onClick={openChannelInvite}
            disabled={!canManageDistribution}
            title={!canManageDistribution ? '当前分销状态不可邀请渠道' : undefined}
          >
            邀请渠道
          </button>
          <button
            type="button"
            className="distribution-invite-button"
            onClick={openInvite}
            disabled={!canManageDistribution}
            title={!canManageDistribution ? '当前分销状态不可邀请客户' : undefined}
          >
            邀请客户
          </button>
        </header>

        <section className="distribution-notice" aria-label="邀请收益说明">
          <img src={noticeIcon} alt="" width={14} height={14} />
          <span>邀请收益说明：您成功邀请的客户首次成功后，系统将于一个月内按照返利规则进行金额结算。</span>
          <button type="button" onClick={() => setRulesOpen(true)}>
            查看规则
            <img src={arrowRightIcon} alt="" width={16} height={16} />
          </button>
        </section>

        <section className="distribution-stats">
          {cards
            .filter((card) => !card.hidden)
            .map((card) => (
              <article className="distribution-stat-card" key={card.label}>
                <span className="distribution-stat-card__icon">
                  {card.backgroundIcon ? <img src={card.backgroundIcon} alt="" aria-hidden="true" /> : null}
                  <img src={card.icon} alt="" width={62} height={62} />
                </span>
                <span className="distribution-stat-card__content">
                  <span className="distribution-stat-card__label">
                    {card.label}
                    {card.action ? (
                      <button
                        type="button"
                        onClick={() => setWithdrawalOpen(true)}
                        disabled={!canManageDistribution}
                        title={!canManageDistribution ? '当前分销状态不可申请提现' : undefined}
                      >
                        {card.action}
                        <img src={arrowRightIcon} alt="" />
                      </button>
                    ) : null}
                  </span>
                  <strong>
                    <small>{card.unit === '￥' ? card.unit : ''}</small>
                    {card.value}
                    <small>{['人', '个'].includes(card.unit) ? card.unit : ''}</small>
                  </strong>
                </span>
              </article>
            ))}
        </section>

        {overviewDetails.length > 0 ? (
          <section className="distribution-overview-details" aria-label="分销业务概览">
            {overviewDetails.map((item) => (
              <article key={item.label}>
                <div className="distribution-overview-details__label">
                  <span>{item.label}</span>
                  <DistributionMetricHelp label={item.label} explanation={item.explanation} source={item.source} />
                </div>
                <strong>{item.value}</strong>
                <small>{item.hint}</small>
              </article>
            ))}
          </section>
        ) : null}

        <section className="distribution-invitees" aria-labelledby="distribution-invitees-title">
          <header>
            <div>
              <h2 id="distribution-invitees-title" className="distribution-sr-only">
                邀请客户
              </h2>
              <div className="distribution-invitee-tabs" role="tablist" aria-label="邀请关系列表">
                <button
                  id="distribution-customer-tab"
                  type="button"
                  role="tab"
                  aria-selected={inviteeView === 'customer'}
                  aria-controls="distribution-invitee-table-panel"
                  tabIndex={inviteeView === 'customer' ? 0 : -1}
                  onClick={() => {
                    setInviteeView('customer')
                    setInviteePage(1)
                  }}
                  onKeyDown={handleInviteeTabKeyDown}
                >
                  邀请客户
                </button>
                <button
                  id="distribution-distributor-tab"
                  type="button"
                  role="tab"
                  aria-selected={inviteeView === 'distributor'}
                  aria-controls="distribution-invitee-table-panel"
                  tabIndex={inviteeView === 'distributor' ? 0 : -1}
                  onClick={() => {
                    setInviteeView('distributor')
                    setInviteePage(1)
                  }}
                  onKeyDown={handleInviteeTabKeyDown}
                >
                  分销商
                </button>
              </div>
              <span aria-live="polite">
                {inviteeView === 'customer' ? '已邀请客户' : '已邀请分销商'} {visibleInvitees.length}{' '}
                {inviteeView === 'customer' ? '人' : '个'}
              </span>
            </div>
          </header>
          <div
            id="distribution-invitee-table-panel"
            className="distribution-table-wrap"
            role="tabpanel"
            aria-labelledby={inviteeView === 'customer' ? 'distribution-customer-tab' : 'distribution-distributor-tab'}
          >
            <table className="distribution-table">
              <thead>
                <tr>
                  {inviteeFields.registeredAt ? <th>注册时间</th> : null}
                  {inviteeFields.customerName ? <th>客户名称</th> : null}
                  {inviteeFields.mobile ? <th>手机号</th> : null}
                  {inviteeFields.relationship ? <th>关系</th> : null}
                  {inviteeFields.paidOrderCount ? <th>已支付订单</th> : null}
                  {inviteeFields.invitedCustomerCount ? <th>邀请客户数</th> : null}
                  {inviteeFields.distributorName ? <th>所属分销商</th> : null}
                  {inviteeFields.customerStatus ? <th>客户状态</th> : null}
                  {inviteeFields.totalRecharge ? <th>累计充值</th> : null}
                  {inviteeFields.totalConsumedCredits ? <th>累计消耗积分</th> : null}
                  {inviteeFields.totalRebate ? <th>返利</th> : null}
                  {inviteeFields.lastPaymentAt ? <th>最近支付时间</th> : null}
                  {inviteeFields.balance ? <th>剩余金额</th> : null}
                </tr>
              </thead>
              <tbody>
                {visibleInviteeRows.map((row) => (
                  <tr key={row.key}>
                    {inviteeFields.registeredAt ? (
                      <td>
                        <span className="date-time">
                          <span>{row.registeredAt.date}</span>
                          <span>{row.registeredAt.time}</span>
                        </span>
                      </td>
                    ) : null}
                    {inviteeFields.customerName ? <td>{row.customerName}</td> : null}
                    {inviteeFields.mobile ? <td>{row.mobile || '---'}</td> : null}
                    {inviteeFields.relationship ? <td>{row.relationship}</td> : null}
                    {inviteeFields.paidOrderCount ? <td>{row.paidOrderCount}</td> : null}
                    {inviteeFields.invitedCustomerCount ? <td>{row.invitedCustomerCount ?? '---'}</td> : null}
                    {inviteeFields.distributorName ? <td>{row.distributorName}</td> : null}
                    {inviteeFields.customerStatus ? <td>{row.customerStatus || '---'}</td> : null}
                    {inviteeFields.totalRecharge ? (
                      <td>{formatOptionalMoneyFromCents(row.totalRechargeCents)}</td>
                    ) : null}
                    {inviteeFields.totalConsumedCredits ? (
                      <td>{row.totalConsumedCredits === null ? '---' : row.totalConsumedCredits}</td>
                    ) : null}
                    {inviteeFields.totalRebate ? <td>{formatOptionalMoneyFromCents(row.totalRebateCents)}</td> : null}
                    {inviteeFields.lastPaymentAt ? (
                      <td>
                        <span className="date-time">
                          <span>{row.lastPaymentAt.date}</span>
                          <span>{row.lastPaymentAt.time}</span>
                        </span>
                      </td>
                    ) : null}
                    {inviteeFields.balance ? <td>{formatOptionalMoneyFromCents(row.balanceCents)}</td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
            {!visibleInvitees.length ? (
              <div className="distribution-table-state">
                {inviteeView === 'customer' ? '暂无邀请客户' : '暂无分销商'}
              </div>
            ) : null}
          </div>
          <DistributionPagination
            page={inviteePage}
            total={visibleInvitees.length}
            label="邀请关系列表分页"
            onPageChange={setInviteePage}
          />
        </section>

        <section className="distribution-filters" aria-label="收益明细筛选">
          <label className="distribution-search">
            <img src={searchIcon} alt="" width={16} height={16} />
            <input
              value={draftFilters.keyword}
              onChange={(event) => updateFilter('keyword', event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && submitFilters()}
              placeholder="搜索客户名称/账号ID"
              aria-label="搜索客户名称或账号ID"
            />
          </label>
          <label className="distribution-search distribution-search--mobile">
            <img src={searchIcon} alt="" width={16} height={16} />
            <input
              value={draftFilters.mobile}
              onChange={(event) => updateFilter('mobile', event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && submitFilters()}
              placeholder="搜索手机号"
              aria-label="搜索手机号"
              inputMode="numeric"
            />
          </label>
          <select
            value={draftFilters.relationship}
            onChange={(event) => updateFilter('relationship', event.target.value)}
            aria-label="关系分类"
          >
            <option value="">全部关系</option>
            <option value="direct">我的客户</option>
            <option value="distributor">分销商客户</option>
          </select>
          <select
            value={draftFilters.orderType}
            onChange={(event) => updateFilter('orderType', event.target.value)}
            aria-label="订单类型"
          >
            <option value="">全部订单类型</option>
            {orderTypeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <div className="distribution-date" role="group" aria-label="消费时间区间">
            <span>消费时间</span>
            <DatePicker.RangePicker
              value={[
                draftFilters.startTime ? dayjs(draftFilters.startTime) : null,
                draftFilters.endTime ? dayjs(draftFilters.endTime) : null,
              ]}
              format="YYYY年MM月DD日"
              placeholder={['开始年月日', '结束年月日']}
              separator="—"
              suffixIcon={<img src={calendarIcon} alt="" width={20} height={20} />}
              allowClear
              onChange={(dates) => {
                setDraftFilters((current) => ({
                  ...current,
                  startTime: dates?.[0]?.format('YYYY-MM-DD') || '',
                  endTime: dates?.[1]?.format('YYYY-MM-DD') || '',
                }))
              }}
            />
          </div>
          <div className="distribution-amount" role="group" aria-label="充值金额区间">
            <span>充值金额</span>
            <input
              type="number"
              min="0"
              max={draftFilters.maxAmount || undefined}
              step="0.01"
              inputMode="decimal"
              value={draftFilters.minAmount}
              onChange={(event) => updateFilter('minAmount', event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && submitFilters()}
              placeholder="最低"
              aria-label="最低充值金额"
            />
            <i>—</i>
            <input
              type="number"
              min={draftFilters.minAmount || '0'}
              step="0.01"
              inputMode="decimal"
              value={draftFilters.maxAmount}
              onChange={(event) => updateFilter('maxAmount', event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && submitFilters()}
              placeholder="最高"
              aria-label="最高充值金额"
            />
          </div>
          <select
            value={draftFilters.status}
            onChange={(event) => updateFilter('status', event.target.value)}
            aria-label="收益状态"
          >
            <option value="">全部状态</option>
            <option value="pending">未入账/结算中</option>
            <option value="settled">已入账</option>
            <option value="cancelled">已取消</option>
          </select>
          <button type="button" className="distribution-button distribution-button--reset" onClick={resetFilters}>
            重置
          </button>
          <button type="button" className="distribution-button distribution-button--query" onClick={submitFilters}>
            查询
          </button>
          <button type="button" className="distribution-export" onClick={exportRows} disabled={!normalizedRows.length}>
            <img src={exportIcon} alt="" width={14} height={14} />
            导出明细
          </button>
        </section>

        {incompleteCommissionRows ? (
          <p className="distribution-data-warning" role="status">
            当前有 {incompleteCommissionRows}{' '}
            条收益记录缺少客户归属信息，金额与客户无法可靠对应，请联系管理员核对返佣接口。
          </p>
        ) : null}

        <section className="distribution-table-wrap" aria-live="polite">
          <table className="distribution-table">
            <thead>
              <tr>
                {commissionFields.consumedAt ? <th>消费时间</th> : null}
                {commissionFields.customerName ? <th>客户名称</th> : null}
                {commissionFields.mobile ? <th>手机号</th> : null}
                {commissionFields.relationship ? <th>关系</th> : null}
                {commissionFields.orderType ? <th>订单类型</th> : null}
                {commissionFields.distributorName ? <th>所属分销商</th> : null}
                {commissionFields.paidAmount ? <th>充值金额</th> : null}
                {commissionFields.commissionAmount ? <th>我的收益</th> : null}
                {commissionFields.status ? <th>收益状态</th> : null}
                {commissionFields.settledAt ? <th>结算时间</th> : null}
              </tr>
            </thead>
            <tbody>
              {normalizedRows.map((row) => (
                <tr key={row.key}>
                  {commissionFields.consumedAt ? (
                    <td>
                      <span className="date-time">
                        <span>{row.consumedAt.date}</span>
                        <span>{row.consumedAt.time}</span>
                      </span>
                    </td>
                  ) : null}
                  {commissionFields.customerName ? <td>{row.customerName}</td> : null}
                  {commissionFields.mobile ? <td>{row.mobile || '---'}</td> : null}
                  {commissionFields.relationship ? <td>{row.relationship}</td> : null}
                  {commissionFields.orderType ? <td>{row.orderType}</td> : null}
                  {commissionFields.distributorName ? <td>{row.distributorName}</td> : null}
                  {commissionFields.paidAmount ? <td>{formatOptionalMoneyFromCents(row.paidAmountCents)}</td> : null}
                  {commissionFields.commissionAmount ? (
                    <td className="distribution-income">{formatOptionalMoneyFromCents(row.commissionAmountCents)}</td>
                  ) : null}
                  {commissionFields.status ? (
                    <td>
                      {row.status.tone === 'unknown' ? (
                        '---'
                      ) : (
                        <span className={`distribution-status is-${row.status.tone}`}>{row.status.label}</span>
                      )}
                    </td>
                  ) : null}
                  {commissionFields.settledAt ? (
                    <td>
                      <span className="date-time">
                        <span>{row.settledAt.date}</span>
                        <span>{row.settledAt.time}</span>
                      </span>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
          {loading ? <div className="distribution-table-state">正在加载收益明细…</div> : null}
          {!loading && listError ? (
            <div className="distribution-table-state is-error">
              {listError}
              <button type="button" onClick={loadRows}>
                重试
              </button>
            </div>
          ) : null}
          {!loading && !listError && !normalizedRows.length ? (
            <div className="distribution-table-state">暂无符合条件的收益明细</div>
          ) : null}
        </section>

        <DistributionPagination page={page} total={total} label="收益明细分页" onPageChange={setPage} />
      </div>

      {rulesOpen ? (
        <div className="distribution-rules-backdrop" role="presentation" onMouseDown={() => setRulesOpen(false)}>
          <section
            className="distribution-rules"
            role="dialog"
            aria-modal="true"
            aria-labelledby="distribution-rules-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2 id="distribution-rules-title">邀请收益规则</h2>
            <p>
              成功邀请的客户完成符合返利条件的首次消费后，系统会根据当前返利规则计算收益，并在一个月内完成结算。实际金额与结算状态以收益明细为准。
            </p>
            <button type="button" onClick={() => setRulesOpen(false)}>
              我知道了
            </button>
          </section>
        </div>
      ) : null}

      {inviteOpen ? (
        <div className="distribution-rules-backdrop" role="presentation" onMouseDown={() => setInviteOpen(false)}>
          <section
            className="distribution-invite-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="distribution-invite-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <h2 id="distribution-invite-title">邀请客户</h2>
                <p>分享您的专属链接，客户注册后将自动建立邀请关系</p>
              </div>
              <button type="button" onClick={() => setInviteOpen(false)} aria-label="关闭邀请客户弹窗">
                ×
              </button>
            </header>

            {inviteLoading ? <div className="distribution-invite-state">正在获取专属邀请码…</div> : null}
            {!inviteLoading && inviteError ? (
              <div className="distribution-invite-state is-error">
                <span>{inviteError}</span>
                <button type="button" onClick={loadInviteCode}>
                  重新获取
                </button>
              </div>
            ) : null}
            {!inviteLoading && !inviteError && inviteCode ? (
              <>
                <div className="distribution-invite-field">
                  <label>专属邀请链接</label>
                  <div>
                    <input value={inviteUrl} readOnly aria-label="专属邀请链接" />
                    <button type="button" onClick={() => void copyInviteValue(inviteUrl, '邀请链接')}>
                      复制链接
                    </button>
                  </div>
                </div>
                <p className="distribution-invite-tip">
                  客户通过该链接完成注册后，系统会根据后端返利规则记录客户关系与收益。
                </p>
                <div className="distribution-invite-actions">
                  <span role="status">{copyFeedback}</span>
                  <button type="button" onClick={() => void copyInviteValue(inviteUrl, '邀请链接')}>
                    复制链接并邀请
                  </button>
                </div>
              </>
            ) : null}
          </section>
        </div>
      ) : null}

      {channelInviteOpen ? (
        <div
          className="distribution-rules-backdrop"
          role="presentation"
          onMouseDown={() => setChannelInviteOpen(false)}
        >
          <section
            className="distribution-invite-dialog distribution-channel-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="distribution-channel-invite-title"
            aria-describedby="distribution-channel-invite-description"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span className="distribution-channel-badge">渠道身份</span>
                <h2 id="distribution-channel-invite-title">邀请渠道</h2>
                <p id="distribution-channel-invite-description">
                  对方接受邀请后，可继续邀请渠道和成员；普通成员仍不可查看邀请收益。
                </p>
              </div>
              <button type="button" onClick={() => setChannelInviteOpen(false)} aria-label="关闭邀请渠道弹窗">
                ×
              </button>
            </header>

            {!channelInviteUrl && inviteLoading ? (
              <div className="distribution-invite-state">正在获取渠道邀请码…</div>
            ) : null}
            {!channelInviteUrl && !inviteLoading ? (
              <div className="distribution-invite-state is-error">
                <span>{inviteError || '未获取到渠道邀请码，请稍后重试'}</span>
                <button type="button" onClick={loadInviteCode}>
                  重新获取
                </button>
              </div>
            ) : null}
            {channelInviteUrl ? (
              <div className="distribution-channel-link-panel">
                <h3>分享邀请链接</h3>
                <p>复制链接发送给对方，对方打开后即可进入渠道邀请注册流程。</p>
                <label htmlFor="distribution-channel-invite-link">渠道邀请链接</label>
                <div className="distribution-channel-link-box">
                  <input
                    id="distribution-channel-invite-link"
                    value={channelInviteUrl}
                    readOnly
                    onFocus={(event) => event.currentTarget.select()}
                  />
                  <button type="button" onClick={() => void copyChannelInviteLink()}>
                    复制链接
                  </button>
                </div>
              </div>
            ) : null}

            {channelCopyFeedback ? (
              <div className="distribution-channel-dialog-footer">
                <span role="status" aria-live="polite">
                  {channelCopyFeedback}
                </span>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      {withdrawalOpen ? (
        <WithdrawalDialog
          withdrawableCents={withdrawableCents}
          withdrawingCents={withdrawingCents}
          withdrawnCents={withdrawnCents}
          onClose={() => setWithdrawalOpen(false)}
          onSuccess={refreshOverview}
        />
      ) : null}
    </main>
  )
}
