import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listDistributionCommissions, listDistributionInvitees } from '@/api/business'
import { useDistributionAccess } from '@/composables/useDistributionAccess'
import arrowRightIcon from '@/assets/distribution/arrow-right.svg'
import backIcon from '@/assets/distribution/back.svg'
import calendarIcon from '@/assets/distribution/calendar.svg'
import directInviteIcon from '@/assets/distribution/direct-invite.svg'
import distributorInviteIcon from '@/assets/distribution/distributor-invite.svg'
import exportIcon from '@/assets/distribution/export.svg'
import noticeIcon from '@/assets/distribution/notice.svg'
import pendingIcon from '@/assets/distribution/pending.svg'
import pendingBackground from '@/assets/distribution/pending-bg.svg'
import searchIcon from '@/assets/distribution/search.svg'
import totalRebateIcon from '@/assets/distribution/total-rebate.svg'
import withdrawableIcon from '@/assets/distribution/withdrawable.svg'
import './DistributionView.css'

interface DistributionFilters {
  keyword: string
  relationship: string
  distributorId: string
  status: string
  startTime: string
  endTime: string
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
  const value = Number(pick(source, ['total', 'count', 'total_count'], fallback))
  return Number.isFinite(value) ? value : fallback
}

function numeric(source: any, yuanKeys: string[], centsKeys: string[] = []): number {
  const cents = Number(pick(source, centsKeys, Number.NaN))
  if (Number.isFinite(cents)) return cents / 100
  const yuan = Number(pick(source, yuanKeys, 0))
  return Number.isFinite(yuan) ? yuan : 0
}

function formatMoney(value: number, fractionDigits = 2): string {
  return value.toLocaleString('zh-CN', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })
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
  if (['direct', 'mine', 'my_customer', 'direct_customer'].includes(normalized)) return '我的客户'
  if (['distributor', 'indirect', 'distributor_customer'].includes(normalized)) return '分销商客户'
  return String(value || '---')
}

function statusMeta(value: any): { label: string; tone: 'pending' | 'settled' | 'cancelled' } {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
  if (['settled', 'completed', 'paid', 'success'].includes(normalized)) return { label: '已结算', tone: 'settled' }
  if (['cancelled', 'canceled', 'refunded', 'failed'].includes(normalized)) {
    return { label: '已取消', tone: 'cancelled' }
  }
  return { label: normalized ? String(value) : '结算中', tone: 'pending' }
}

function csvCell(value: any): string {
  return `"${String(value ?? '').replaceAll('"', '""')}"`
}

export default function DistributionView() {
  const navigate = useNavigate()
  const { status: accessStatus, overview: rawOverview, error: accessError, retry } = useDistributionAccess()
  const [draftFilters, setDraftFilters] = useState<DistributionFilters>(EMPTY_FILTERS)
  const [filters, setFilters] = useState<DistributionFilters>(EMPTY_FILTERS)
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [distributors, setDistributors] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [listError, setListError] = useState('')
  const [rulesOpen, setRulesOpen] = useState(false)

  const overview = useMemo(() => unwrap(rawOverview) || {}, [rawOverview])

  useEffect(() => {
    if (accessStatus === 'denied') navigate('/home', { replace: true })
  }, [accessStatus, navigate])

  useEffect(() => {
    if (accessStatus !== 'allowed') return
    const controller = new AbortController()
    void listDistributionInvitees({ limit: 200, signal: controller.signal })
      .then((payload) => {
        const items = pageItems(payload)
        const seen = new Map<string, any>()
        items.forEach((item) => {
          const id = String(pick(item, ['distributor_id', 'distributorId', 'owner_id'], '')).trim()
          const name = String(pick(item, ['distributor_name', 'distributorName', 'owner_name', 'ownerName'], '')).trim()
          if (id && name) seen.set(id, { id, name })
        })
        setDistributors([...seen.values()])
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [accessStatus])

  const loadRows = useCallback(() => {
    if (accessStatus !== 'allowed') return () => undefined
    const controller = new AbortController()
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
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [accessStatus, filters, page])

  useEffect(() => loadRows(), [loadRows])

  const cards = useMemo(
    () => [
      {
        label: '累计返利金额',
        value: formatMoney(
          numeric(
            overview,
            ['total_commission', 'total_commission_amount', 'total_rebate'],
            ['total_commission_cents'],
          ),
        ),
        unit: '￥',
        icon: totalRebateIcon,
      },
      {
        label: '可提现金额',
        value: formatMoney(
          numeric(
            overview,
            ['withdrawable_commission', 'withdrawable_amount', 'available_commission'],
            ['withdrawable_commission_cents', 'withdrawable_amount_cents'],
          ),
        ),
        unit: '￥',
        icon: withdrawableIcon,
        action: '可提现',
      },
      {
        label: '待结算金额',
        value: formatMoney(
          numeric(
            overview,
            ['pending_commission', 'pending_amount'],
            ['pending_commission_cents', 'pending_amount_cents'],
          ),
        ),
        unit: '￥',
        icon: pendingIcon,
        backgroundIcon: pendingBackground,
      },
      {
        label: '成功邀请客户',
        value: String(pick(overview, ['direct_invitee_count', 'successful_invitees', 'invitee_count'], 0)),
        unit: '人',
        icon: directInviteIcon,
      },
      {
        label: '分销商邀请客户',
        value: String(pick(overview, ['distributor_invitee_count', 'indirect_invitee_count', 'sub_invitee_count'], 0)),
        unit: '人',
        icon: distributorInviteIcon,
      },
    ],
    [overview],
  )

  const normalizedRows = useMemo(
    () =>
      rows.map((row, index) => {
        const consumedAt = formatDateTime(pick(row, ['consumed_at', 'paid_at', 'payment_time', 'created_at']))
        const settledAt = formatDateTime(pick(row, ['settled_at', 'settlement_time']))
        return {
          key: String(pick(row, ['commission_id', 'id', 'order_id'], index)),
          consumedAt,
          customerName: pick(row, ['customer_name', 'invitee_name', 'display_name', 'user_name'], '---'),
          customerId: pick(row, ['customer_account_id', 'customer_id', 'invitee_id', 'user_id'], '---'),
          relationship: relationLabel(pick(row, ['relationship', 'relation', 'relation_type'])),
          distributorName: pick(
            row,
            ['distributor_name', 'owner_name', 'referrer_name'],
            relationLabel(pick(row, ['relationship', 'relation'])) === '我的客户' ? '直接客户' : '---',
          ),
          paidAmount: numeric(row, ['paid_amount', 'payment_amount', 'recharge_amount'], ['paid_amount_cents']),
          commissionAmount: numeric(
            row,
            ['commission_amount', 'rebate_amount', 'income_amount'],
            ['commission_amount_cents'],
          ),
          status: statusMeta(pick(row, ['status', 'commission_status', 'settlement_status'])),
          settledAt,
        }
      }),
    [rows],
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
    const header = [
      '消费时间',
      '客户名称',
      '客户账户ID',
      '关系',
      '所属分销商',
      '充值金额',
      '我的收益',
      '收益状态',
      '结算时间',
    ]
    const body = normalizedRows.map((row) => [
      `${row.consumedAt.date} ${row.consumedAt.time}`.trim(),
      row.customerName,
      row.customerId,
      row.relationship,
      row.distributorName,
      formatMoney(row.paidAmount),
      formatMoney(row.commissionAmount),
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

  if (accessStatus === 'idle' || accessStatus === 'checking' || accessStatus === 'denied') {
    return <div className="distribution-access-state" aria-label="正在验证营销人员权限" />
  }

  if (accessStatus === 'error') {
    return (
      <main className="distribution-access-error">
        <h1>邀请收益暂时无法打开</h1>
        <p>{(accessError as any)?.message || '营销人员权限验证失败，请检查网络后重试。'}</p>
        <div>
          <button type="button" onClick={() => navigate(-1)}>
            返回
          </button>
          <button type="button" className="primary" onClick={retry}>
            重新加载
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
          {cards.map((card) => (
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

        <section className="distribution-table-wrap" aria-live="polite">
          <table className="distribution-table">
            <thead>
              <tr>
                <th>消费时间</th>
                <th>客户名称</th>
                <th>客户账户ID</th>
                <th>关系</th>
                <th>所属分销商</th>
                <th>充值金额</th>
                <th>我的收益</th>
                <th>收益状态</th>
                <th>结算时间</th>
              </tr>
            </thead>
            <tbody>
              {normalizedRows.map((row) => (
                <tr key={row.key}>
                  <td>
                    <span className="date-time">
                      <span>{row.consumedAt.date}</span>
                      <span>{row.consumedAt.time}</span>
                    </span>
                  </td>
                  <td>{row.customerName}</td>
                  <td>{row.customerId}</td>
                  <td>{row.relationship}</td>
                  <td>{row.distributorName}</td>
                  <td>￥{formatMoney(row.paidAmount)}</td>
                  <td className="distribution-income">￥{formatMoney(row.commissionAmount, 0)}</td>
                  <td>
                    <span className={`distribution-status is-${row.status.tone}`}>{row.status.label}</span>
                  </td>
                  <td>
                    <span className="date-time">
                      <span>{row.settledAt.date}</span>
                      <span>{row.settledAt.time}</span>
                    </span>
                  </td>
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
    </main>
  )
}
