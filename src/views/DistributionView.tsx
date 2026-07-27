import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getReferralMyCode, listDistributionCommissions, listDistributionInvitees } from '@/api/business'
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
  relationship: string
  distributorId: string
  status: string
  startTime: string
  endTime: string
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

const EMPTY_FILTERS: DistributionFilters = {
  keyword: '',
  relationship: '',
  distributorId: '',
  status: '',
  startTime: '',
  endTime: '',
}

const PAGE_SIZE = 50
const INVITEE_FETCH_SIZE = 200
const MAX_INVITEE_RECORDS = 5000
const DISTRIBUTION_REFRESH_INTERVAL_MS = 3_000

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

function optionalNumeric(source: any, yuanKeys: string[], centsKeys: string[] = []): number | null {
  const centsValue = pick(source, centsKeys, null)
  if (centsValue !== null) {
    const cents = Number(centsValue)
    if (Number.isFinite(cents)) return cents / 100
  }
  const yuanValue = pick(source, yuanKeys, null)
  if (yuanValue === null) return null
  const yuan = Number(yuanValue)
  if (!Number.isFinite(yuan)) return null
  const unit = String(pick(source, ['amount_unit', 'money_unit', 'currency_unit'], ''))
    .trim()
    .toLowerCase()
  return ['cent', 'cents', 'fen', '分'].includes(unit) ? yuan / 100 : yuan
}

function formatMoney(value: number, fractionDigits = 2): string {
  return value.toLocaleString('zh-CN', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })
}

function formatOptionalMoney(value: number | null): string {
  return value === null ? '暂无数据' : `￥${formatMoney(value)}`
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

function relationLabel(value: any): string {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
  if (['direct', 'mine', 'my_customer', 'direct_customer', 'customer'].includes(normalized)) return '我的客户'
  if (['distributor', 'indirect', 'distributor_customer'].includes(normalized)) return '分销商客户'
  return String(value || '---')
}

function orderTypeLabel(value: any): string {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
  if (normalized === 'subscription_initial') return '首次订阅'
  return String(value || '---')
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
  const amount = optionalNumeric(source, yuanKeys, centsKeys)
  return amount === null
    ? { value: formatMoney(0), unit: '￥', hidden: false }
    : { value: formatMoney(amount), unit: '￥', hidden: false }
}

function csvCell(value: any): string {
  return `"${String(value ?? '').replaceAll('"', '""')}"`
}

export default function DistributionView() {
  const navigate = useNavigate()
  const {
    status: accessStatus,
    overview: rawOverview,
    error: accessError,
    retry: refreshOverview,
    isDistributor,
  } = useDistributionAccess()
  const [draftFilters, setDraftFilters] = useState<DistributionFilters>(EMPTY_FILTERS)
  const [filters, setFilters] = useState<DistributionFilters>(EMPTY_FILTERS)
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [invitees, setInvitees] = useState<any[]>([])
  const [distributors, setDistributors] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [listError, setListError] = useState('')
  const [rulesOpen, setRulesOpen] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [channelInviteOpen, setChannelInviteOpen] = useState(false)
  const [channelCopyFeedback, setChannelCopyFeedback] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [copyFeedback, setCopyFeedback] = useState('')
  const inviteesRequestRef = useRef<AbortController | null>(null)
  const commissionsRequestRef = useRef<AbortController | null>(null)
  useEffect(() => {
    document.documentElement.classList.add('distribution-document-scroll')
    return () => document.documentElement.classList.remove('distribution-document-scroll')
  }, [])

  useEffect(() => {
    if (accessStatus === 'denied') navigate('/home', { replace: true })
  }, [accessStatus, navigate])

  const overview = useMemo(() => unwrap(rawOverview) || {}, [rawOverview])
  const overviewInviteCode = String(pick(overview, ['code', 'invite_code', 'inviteCode', 'referral_code'], '')).trim()
  const distributorCode = String(pick(overview, ['distributor_code', 'distributorCode'], '')).trim()
  const inviteUrl = inviteCode ? `${window.location.origin}/login?invite_code=${encodeURIComponent(inviteCode)}` : ''
  const channelInviteUrl = distributorCode
    ? `${window.location.origin}/login?invite_code=${encodeURIComponent(distributorCode)}&invite_type=channel`
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
    if (!isDistributor) return undefined
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
        const seen = new Map<string, any>()
        items.forEach((item) => {
          const id = String(pick(item, ['distributor_id', 'distributorId', 'owner_id'], '')).trim()
          const name = String(pick(item, ['distributor_name', 'distributorName', 'owner_name', 'ownerName'], '')).trim()
          if (id && name) seen.set(id, { id, name })
        })
        setDistributors([...seen.values()])
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
  }, [isDistributor])

  useEffect(() => {
    return loadInvitees()
  }, [loadInvitees])

  const loadRows = useCallback(() => {
    if (!isDistributor) return undefined
    commissionsRequestRef.current?.abort()
    const controller = new AbortController()
    commissionsRequestRef.current = controller
    setLoading(true)
    setListError('')
    void listDistributionCommissions({
      ...filters,
      offset: (page - 1) * PAGE_SIZE,
      limit: PAGE_SIZE,
      signal: controller.signal,
    })
      .then((payload) => {
        const items = pageItems(payload)
        setRows(items)
        setTotal(pageTotal(payload, items.length))
      })
      .catch((error: any) => {
        if (controller.signal.aborted) return
        setRows([])
        setTotal(0)
        setListError(error?.message || '收益明细加载失败，请稍后重试')
      })
      .finally(() => {
        if (commissionsRequestRef.current === controller) {
          commissionsRequestRef.current = null
          if (!controller.signal.aborted) setLoading(false)
        }
      })
    return () => controller.abort()
  }, [filters, isDistributor, page])

  useEffect(() => {
    return loadRows()
  }, [loadRows])

  const refreshDistributionData = useCallback(() => {
    refreshOverview()
    if (!inviteesRequestRef.current) loadInvitees()
    if (!commissionsRequestRef.current) loadRows()
  }, [loadInvitees, loadRows, refreshOverview])

  useEffect(() => {
    if (!isDistributor) return undefined
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
  }, [isDistributor, refreshDistributionData])

  const inviteeCounts = useMemo(
    () =>
      invitees.reduce(
        (counts, item) => {
          const relation = String(pick(item, ['relationship', 'relation', 'relation_type'], 'direct'))
            .trim()
            .toLowerCase()
          if (['distributor', 'indirect', 'distributor_customer'].includes(relation)) counts.distributor += 1
          else counts.direct += 1
          return counts
        },
        { direct: 0, distributor: 0 },
      ),
    [invitees],
  )

  const cards = useMemo<DistributionSummaryCard[]>(
    () =>
      [
        {
          label: '累计返利金额',
          ...moneyCardValue(
            overview,
            ['total_commission', 'total_commission_amount', 'total_rebate'],
            ['total_commission_cents'],
          ),
          icon: totalRebateIcon,
        },
        {
          label: '可提现金额',
          ...moneyCardValue(
            overview,
            ['withdrawable_commission', 'withdrawable_amount', 'available_commission'],
            ['withdrawable_commission_cents', 'withdrawable_amount_cents'],
          ),
          icon: withdrawableIcon,
          action: '可提现',
        },
        {
          label: '待结算金额',
          ...moneyCardValue(
            overview,
            ['pending_commission', 'pending_amount'],
            ['pending_commission_cents', 'pending_amount_cents'],
          ),
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
          label: '分销商邀请客户',
          value: String(
            Math.max(
              Number(pick(overview, ['distributor_invitee_count', 'indirect_invitee_count', 'sub_invitee_count'], 0)) ||
                0,
              inviteeCounts.distributor,
            ),
          ),
          unit: '人',
          icon: distributorInviteIcon,
        },
      ].filter((card) => card.icon !== pendingIcon && card.icon !== distributorInviteIcon),
    [inviteeCounts, overview],
  )

  const normalizedInvitees = useMemo(
    () =>
      invitees.map((item, index) => ({
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
        relationship: relationLabel(pick(item, ['relationship', 'relation', 'relation_type', 'kind'], 'direct')),
        mobile: String(pick(item, ['mobile', 'masked_mobile'], '')).trim(),
        paidOrderCount: Number(pick(item, ['paid_order_count', 'order_count'], 0)) || 0,
        distributorName: pick(item, ['distributor_name', 'owner_name', 'referrer_name'], '---'),
        customerStatus: String(
          pick(item, ['customer_status', 'operation_status', 'usage_status', 'status'], ''),
        ).trim(),
        totalRecharge: optionalNumeric(
          item,
          ['total_recharge_amount', 'total_recharge', 'recharge_total', 'total_paid_amount'],
          ['total_recharge_cents', 'total_recharge_amount_cents', 'total_paid_amount_cents', 'total_paid_cents'],
        ),
        totalRebate: optionalNumeric(item, ['total_rebate_amount', 'total_rebate'], ['total_rebate_cents']),
        lastPaymentAt: formatDateTime(pick(item, ['last_payment_at', 'last_paid_at'])),
        totalConsumed: optionalNumeric(
          item,
          ['total_consumed_amount', 'total_consumed', 'consumption_total', 'total_usage_amount'],
          ['total_consumed_cents', 'total_consumed_amount_cents', 'total_usage_amount_cents'],
        ),
        balance: optionalNumeric(
          item,
          ['balance_amount', 'available_balance', 'balance'],
          ['balance_amount_cents', 'available_balance_cents', 'balance_cents'],
        ),
      })),
    [invitees],
  )

  const normalizedCommissions = useMemo(
    () =>
      rows.map((row, index) => {
        const consumedAt = formatDateTime(
          pick(row, [
            'consumed_at',
            'paid_at',
            'payment_time',
            'recharged_at',
            'order_paid_at',
            'occurred_at',
            'created_at',
          ]),
        )
        const settledAt = formatDateTime(pick(row, ['settled_at', 'settlement_time']))
        return {
          key: String(pick(row, ['commission_id', 'id', 'order_id'], index)),
          matchId: String(
            pick(row, ['customer_id', 'customer_user_id', 'invitee_user_id', 'user_id', 'account_id', 'mobile'], ''),
          ).trim(),
          consumedAt,
          customerName: pick(
            row,
            ['customer_name', 'invitee_name', 'display_name', 'user_name', 'username', 'account_name', 'nickname'],
            '---',
          ),
          relationship: relationLabel(pick(row, ['relationship', 'relation', 'relation_type', 'kind'])),
          mobile: String(pick(row, ['mobile', 'masked_mobile'], '')).trim(),
          orderType: orderTypeLabel(pick(row, ['order_type', 'payment_type'])),
          distributorName: pick(row, ['distributor_name', 'owner_name', 'referrer_name'], '---'),
          paidAmount: optionalNumeric(
            row,
            ['paid_amount', 'payment_amount', 'recharge_amount', 'order_amount'],
            ['paid_amount_cents', 'payment_amount_cents', 'recharge_amount_cents', 'order_amount_cents'],
          ),
          commissionAmount: optionalNumeric(
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

  const normalizedRows = normalizedCommissions
  const inviteeFields = useMemo(
    () => ({
      registeredAt: normalizedInvitees.some((row) => row.registeredAt.date !== '---'),
      customerName: normalizedInvitees.some((row) => row.customerName !== '---'),
      relationship: normalizedInvitees.some((row) => row.relationship !== '---'),
      mobile: normalizedInvitees.some((row) => Boolean(row.mobile)),
      paidOrderCount: normalizedInvitees.some((row) => row.paidOrderCount > 0),
      distributorName: normalizedInvitees.some((row) => row.distributorName !== '---'),
      customerStatus: normalizedInvitees.some((row) => Boolean(row.customerStatus)),
      totalRecharge: normalizedInvitees.some((row) => row.totalRecharge !== null),
      totalRebate: normalizedInvitees.some((row) => row.totalRebate !== null),
      lastPaymentAt: normalizedInvitees.some((row) => row.lastPaymentAt.date !== '---'),
      totalConsumed: normalizedInvitees.some((row) => row.totalConsumed !== null),
      balance: normalizedInvitees.some((row) => row.balance !== null),
    }),
    [normalizedInvitees],
  )

  const commissionFields = useMemo(
    () => ({
      consumedAt: normalizedRows.some((row) => row.consumedAt.date !== '---'),
      customerName: normalizedRows.some((row) => row.customerName !== '---'),
      relationship: normalizedRows.some((row) => row.relationship !== '---'),
      mobile: normalizedRows.some((row) => Boolean(row.mobile)),
      orderType: normalizedRows.some((row) => row.orderType !== '---'),
      distributorName: normalizedRows.some((row) => row.distributorName !== '---'),
      paidAmount: normalizedRows.some((row) => row.paidAmount !== null),
      commissionAmount: normalizedRows.some((row) => row.commissionAmount !== null),
      status: normalizedRows.some((row) => row.status.tone !== 'unknown'),
      settledAt: normalizedRows.some((row) => row.settledAt.date !== '---'),
    }),
    [normalizedRows],
  )
  const incompleteCommissionRows = useMemo(
    () =>
      normalizedRows.filter(
        (row) =>
          (row.paidAmount !== null || row.commissionAmount !== null) &&
          (row.customerName === '---' || row.relationship === '---'),
      ).length,
    [normalizedRows],
  )
  const updateFilter = (key: keyof DistributionFilters, value: string) => {
    setDraftFilters((current) => ({ ...current, [key]: value }))
  }

  const submitFilters = () => {
    setPage(1)
    setFilters(draftFilters)
  }

  const resetFilters = () => {
    setDraftFilters(EMPTY_FILTERS)
    setFilters(EMPTY_FILTERS)
    setPage(1)
  }

  const exportRows = () => {
    const header = ['消费时间', '客户名称', '关系', '所属分销商', '充值金额', '我的收益', '收益状态', '结算时间']
    const body = normalizedRows.map((row) => [
      `${row.consumedAt.date} ${row.consumedAt.time}`.trim(),
      row.customerName,
      row.relationship,
      row.distributorName,
      row.paidAmount === null ? '暂无数据' : formatMoney(row.paidAmount),
      row.commissionAmount === null ? '暂无数据' : formatMoney(row.commissionAmount),
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

  if (accessStatus === 'idle' || accessStatus === 'checking' || accessStatus === 'denied') {
    return (
      <main className="distribution-access-state" aria-busy="true">
        <div className="distribution-access-error" role="status">
          <h1>正在验证销售权限</h1>
          <p>{accessStatus === 'denied' ? '当前账号无权访问，正在返回首页…' : '请稍候…'}</p>
        </div>
      </main>
    )
  }

  if (accessStatus === 'error') {
    return (
      <main className="distribution-access-state">
        <div className="distribution-access-error" role="alert">
          <h1>销售权限验证失败</h1>
          <p>{String((accessError as any)?.message || '暂时无法验证当前账号权限，请稍后重试')}</p>
          <div>
            <button type="button" onClick={() => navigate('/home', { replace: true })}>
              返回首页
            </button>
            <button type="button" className="primary" onClick={refreshOverview}>
              重新验证
            </button>
          </div>
        </div>
      </main>
    )
  }

  if (accessStatus === 'disabled') {
    return (
      <main className="distribution-access-state">
        <div className="distribution-access-error" role="alert">
          <h1>销售身份被停用，请联系客服</h1>
          <button type="button" onClick={() => navigate('/home', { replace: true })}>
            返回首页
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="distribution-page">
      <div className="distribution-page__canvas">
        <header className="distribution-header">
          <button type="button" className="distribution-back" onClick={() => navigate(-1)} aria-label="返回上一页">
            <img src={backIcon} alt="" width={28} height={28} />
          </button>
          <h1>邀请收益</h1>
          <button type="button" className="distribution-channel-invite-button" onClick={openChannelInvite}>
            邀请渠道
          </button>
          <button type="button" className="distribution-invite-button" onClick={openInvite}>
            邀请客户
          </button>
        </header>

        <section className="distribution-notice" aria-label="邀请收益说明">
          <img src={noticeIcon} alt="" width={14} height={14} />
          <span>邀请收益说明：您成功邀请的客户首次成功后，系统将于三个月内按照返利规则进行金额结算。</span>
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
                      <button type="button">
                        {card.action}
                        <img src={arrowRightIcon} alt="" />
                      </button>
                    ) : null}
                  </span>
                  <strong>
                    <small>{card.unit === '￥' ? card.unit : ''}</small>
                    {card.value}
                    <small>{card.unit === '人' ? card.unit : ''}</small>
                  </strong>
                </span>
              </article>
            ))}
        </section>

        <section className="distribution-invitees" aria-labelledby="distribution-invitees-title">
          <header>
            <div>
              <h2 id="distribution-invitees-title">邀请客户</h2>
              <span>已建立邀请关系 {normalizedInvitees.length} 人</span>
            </div>
          </header>
          <div className="distribution-table-wrap">
            <table className="distribution-table">
              <thead>
                <tr>
                  {inviteeFields.registeredAt ? <th>注册时间</th> : null}
                  {inviteeFields.customerName ? <th>客户名称</th> : null}
                  {inviteeFields.mobile ? <th>手机号</th> : null}
                  {inviteeFields.relationship ? <th>关系</th> : null}
                  {inviteeFields.paidOrderCount ? <th>已支付订单</th> : null}
                  {inviteeFields.distributorName ? <th>所属分销商</th> : null}
                  {inviteeFields.customerStatus ? <th>客户状态</th> : null}
                  {inviteeFields.totalRecharge ? <th>累计充值</th> : null}
                  {inviteeFields.totalRebate ? <th>累计返利</th> : null}
                  {inviteeFields.lastPaymentAt ? <th>最近支付时间</th> : null}
                  {inviteeFields.totalConsumed ? <th>累计消耗</th> : null}
                  {inviteeFields.balance ? <th>剩余金额</th> : null}
                </tr>
              </thead>
              <tbody>
                {normalizedInvitees.map((row) => (
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
                    {inviteeFields.distributorName ? <td>{row.distributorName}</td> : null}
                    {inviteeFields.customerStatus ? <td>{row.customerStatus || '---'}</td> : null}
                    {inviteeFields.totalRecharge ? <td>{formatOptionalMoney(row.totalRecharge)}</td> : null}
                    {inviteeFields.totalRebate ? <td>{formatOptionalMoney(row.totalRebate)}</td> : null}
                    {inviteeFields.lastPaymentAt ? (
                      <td>
                        <span className="date-time">
                          <span>{row.lastPaymentAt.date}</span>
                          <span>{row.lastPaymentAt.time}</span>
                        </span>
                      </td>
                    ) : null}
                    {inviteeFields.totalConsumed ? <td>{formatOptionalMoney(row.totalConsumed)}</td> : null}
                    {inviteeFields.balance ? <td>{formatOptionalMoney(row.balance)}</td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
            {!normalizedInvitees.length ? <div className="distribution-table-state">暂无邀请客户</div> : null}
          </div>
        </section>

        <section className="distribution-filters" aria-label="收益明细筛选">
          <label className="distribution-search">
            <img src={searchIcon} alt="" width={16} height={16} />
            <input
              value={draftFilters.keyword}
              onChange={(event) => updateFilter('keyword', event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && submitFilters()}
              placeholder="搜索客户名称/账号ID"
            />
          </label>
          <select
            value={draftFilters.relationship}
            onChange={(event) => updateFilter('relationship', event.target.value)}
          >
            <option value="">全部关系</option>
            <option value="direct">我的客户</option>
            <option value="distributor">分销商客户</option>
          </select>
          <label className="distribution-date">
            <span>消费时间</span>
            <input
              type="date"
              value={draftFilters.startTime}
              onChange={(event) => updateFilter('startTime', event.target.value)}
              aria-label="消费开始日期"
            />
            <i>—</i>
            <input
              type="date"
              value={draftFilters.endTime}
              onChange={(event) => updateFilter('endTime', event.target.value)}
              aria-label="消费结束日期"
            />
            <img src={calendarIcon} alt="" width={20} height={20} />
          </label>
          <select
            value={draftFilters.distributorId}
            onChange={(event) => updateFilter('distributorId', event.target.value)}
          >
            <option value="">全部分销商</option>
            {distributors.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <select value={draftFilters.status} onChange={(event) => updateFilter('status', event.target.value)}>
            <option value="">全部状态</option>
            <option value="pending">结算中</option>
            <option value="settled">已结算</option>
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
                  {commissionFields.paidAmount ? <td>{formatOptionalMoney(row.paidAmount)}</td> : null}
                  {commissionFields.commissionAmount ? (
                    <td className="distribution-income">{formatOptionalMoney(row.commissionAmount)}</td>
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

        {total > PAGE_SIZE ? (
          <nav className="distribution-pagination" aria-label="收益明细分页">
            <button type="button" disabled={page === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
              上一页
            </button>
            <span>
              第 {page} 页，共 {Math.ceil(total / PAGE_SIZE)} 页
            </span>
            <button
              type="button"
              disabled={page >= Math.ceil(total / PAGE_SIZE)}
              onClick={() => setPage((value) => value + 1)}
            >
              下一页
            </button>
          </nav>
        ) : null}
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
              成功邀请的客户完成符合返利条件的首次消费后，系统会根据当前返利规则计算收益，并在三个月内完成结算。实际金额与结算状态以收益明细为准。
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

            {!channelInviteUrl ? (
              <div className="distribution-invite-state is-error">
                <span>未获取到渠道邀请码，请稍后重试</span>
                <button type="button" onClick={refreshOverview}>
                  刷新
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

            <div className="distribution-channel-dialog-footer">
              <p>对方通过该链接完成注册后，后端将按渠道邀请类型建立邀请关系。</p>
              <span role="status" aria-live="polite">
                {channelCopyFeedback}
              </span>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  )
}
