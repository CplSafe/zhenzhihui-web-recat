/**
 * 积分明细页（/credits）。
 *
 * 展示当前工作空间的每一笔积分流水：消费、退回、冻结、充值等，配「可用余额 / 冻结中」概览与类型筛选。
 * 数据源 `/api/v1/billing/credit-ledgers`（listCreditLedgers，服务端 limit/offset 分页 + kind 过滤）。
 * 余额取自钱包 currentWallet（available / frozen）。金额↔人民币走 creditsYuan（1 积分 = 0.02 元）。
 *
 * 说明：流水记录本身不带「关联作品/任务」引用，故不做逐条「查看作品」跳转（后端补字段后再加）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import AppSidebar from '@/components/home/AppSidebar'
import AppTopbar from '@/components/layout/AppTopbar'
import { getBusinessErrorMessage, listCreditLedgers } from '@/api/business'
import {
  CREDIT_LEDGER_FILTERS,
  creditLedgerKindLabel,
  extractCreditLedgerPage,
  formatCreditDelta,
  type CreditLedgerRecord,
} from '@/utils/creditLedger'
import { creditsToYuanAmount } from '@/utils/creditsYuan'
import { useSidebarNavigate } from '@/composables/useSidebarNavigate'
import { openMemberCenterTab } from '@/stores/ui'
import {
  useCurrentWorkspace,
  useWalletCredits,
  useWorkspaceId,
  useWorkspaceSessionStore,
} from '@/stores/workspaceSession'
import './CreditsView.css'

const PAGE_SIZE = 20

/** 时间戳 → 「2026-09-10 14:32」；空/非法原样返回。 */
function formatDateTime(iso: string): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 积分 → 「¥12.34」；算不出显示 ¥0。 */
function yuanLabel(credits: number): string {
  const amount = creditsToYuanAmount(credits)
  return amount ? `¥${amount}` : '¥0'
}

export default function CreditsView() {
  const handleNavigate = useSidebarNavigate()
  const workspaceId = useWorkspaceId()
  const currentWorkspace = useCurrentWorkspace()
  const available = useWalletCredits()
  const wallet = useWorkspaceSessionStore((s) => s.currentWallet)
  const frozen = Math.max(0, Number((wallet as any)?.frozen ?? 0) || 0)
  const workspaceName = String((currentWorkspace as any)?.name || '当前工作空间')

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [filterKey, setFilterKey] = useState('all')
  const [page, setPage] = useState(1)
  const [records, setRecords] = useState<CreditLedgerRecord[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const kind = useMemo(() => CREDIT_LEDGER_FILTERS.find((item) => item.key === filterKey)?.kind ?? '', [filterKey])

  // 进入/切换空间时确保钱包已加载（可用余额、冻结额都来自 currentWallet）。
  useEffect(() => {
    if (workspaceId > 0) void useWorkspaceSessionStore.getState().loadSubscriptionLabel()
  }, [workspaceId])

  // 切换空间或筛选时回到第 1 页，避免停在越界页码上。
  useEffect(() => {
    setPage(1)
  }, [workspaceId, kind])

  // 拉当前页流水：服务端分页（limit/offset）+ kind 过滤。
  useEffect(() => {
    if (!(workspaceId > 0)) {
      setRecords([])
      setTotal(null)
      return
    }
    let alive = true
    setLoading(true)
    setError('')
    const offset = (page - 1) * PAGE_SIZE
    listCreditLedgers({ workspaceId, kind, limit: PAGE_SIZE, offset })
      .then((payload) => {
        if (!alive) return
        const parsed = extractCreditLedgerPage(payload, offset)
        setRecords(parsed.records)
        setTotal(parsed.total)
      })
      .catch((err: any) => {
        if (!alive) return
        setRecords([])
        setTotal(null)
        setError(getBusinessErrorMessage(err, '积分明细加载失败，请稍后重试'))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [workspaceId, kind, page])

  // 有 total 用它算总页数；后端不返回 total 时按「本页是否满页」推断能否翻下一页。
  const hasPrev = page > 1
  const hasNext = total != null ? page * PAGE_SIZE < total : records.length === PAGE_SIZE
  const pageLabel = total != null ? `第 ${page} / ${Math.max(1, Math.ceil(total / PAGE_SIZE))} 页` : `第 ${page} 页`

  const goPrev = useCallback(() => setPage((value) => Math.max(1, value - 1)), [])
  const goNext = useCallback(() => setPage((value) => value + 1), [])

  return (
    <div className="credits">
      <AppSidebar
        activeKey="credits"
        onNavigate={handleNavigate}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <div className="credits__main">
        <AppTopbar onMenu={() => setSidebarOpen(true)} />
        <div className="credits__content">
          <header className="credits__head">
            <div>
              <h1 className="credits__title">积分明细</h1>
              <p className="credits__sub">
                工作空间 <b>{workspaceName}</b> · 每一笔积分的消费、退回与冻结都在这里
              </p>
            </div>
            <span className="credits__rate">1 积分 = 0.02 元</span>
          </header>

          <section className="credits__cards">
            <div className="credits__card credits__card--primary">
              <button type="button" className="credits__recharge" onClick={() => openMemberCenterTab('recharge')}>
                充值积分
              </button>
              <div className="credits__card-k">可用余额</div>
              <div className="credits__card-v">
                {Number(available || 0).toLocaleString('en-US')}
                <small>积分</small>
              </div>
              <div className="credits__card-yuan">≈ {yuanLabel(Number(available || 0))} 可用</div>
            </div>
            <div className="credits__card">
              <div className="credits__card-k">
                冻结中
                <span
                  className="credits__info"
                  title="生成任务提交时按预估先冻结，任务完成后按实际消耗结算，多退少不补"
                >
                  i
                </span>
              </div>
              <div className="credits__card-v">
                {frozen.toLocaleString('en-US')}
                <small>积分</small>
              </div>
              <div className="credits__card-yuan">≈ {yuanLabel(frozen)} 生成中占用</div>
            </div>
          </section>

          <div className="credits__panel">
            <div className="credits__filters" role="tablist" aria-label="流水类型筛选">
              {CREDIT_LEDGER_FILTERS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={filterKey === item.key}
                  className={`credits__filter${filterKey === item.key ? ' is-on' : ''}`}
                  onClick={() => setFilterKey(item.key)}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="credits__table-scroll">
              <table className="credits__table">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>事由</th>
                    <th>类型</th>
                    <th className="credits__num">积分变动</th>
                    <th className="credits__num">折合</th>
                    <th className="credits__num">结算后余额</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td className="credits__state" colSpan={6}>
                        正在加载积分明细…
                      </td>
                    </tr>
                  ) : error ? (
                    <tr>
                      <td className="credits__state credits__state--err" colSpan={6}>
                        {error}
                      </td>
                    </tr>
                  ) : records.length === 0 ? (
                    <tr>
                      <td className="credits__state" colSpan={6}>
                        暂无积分流水
                      </td>
                    </tr>
                  ) : (
                    records.map((record) => (
                      <tr key={record.id}>
                        <td className="credits__when">{formatDateTime(record.createdAt)}</td>
                        <td className="credits__reason">{record.reason || '—'}</td>
                        <td>
                          <span className={`credits__chip credits__chip--${record.direction}`}>
                            {creditLedgerKindLabel(record.kind, record.direction)}
                          </span>
                        </td>
                        <td className={`credits__num credits__delta credits__delta--${record.direction}`}>
                          {formatCreditDelta(record)}
                        </td>
                        <td className="credits__num credits__yuan-cell">{yuanLabel(record.amount)}</td>
                        <td className="credits__num credits__bal">
                          {record.balanceAfter == null ? '—' : record.balanceAfter.toLocaleString('en-US')}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="credits__foot">
              <span>{total != null ? `共 ${total} 笔 · 每页 ${PAGE_SIZE} 笔` : `每页 ${PAGE_SIZE} 笔`}</span>
              <span className="credits__pager">
                <button type="button" disabled={!hasPrev || loading} onClick={goPrev}>
                  上一页
                </button>
                <span className="credits__page-label">{pageLabel}</span>
                <button type="button" disabled={!hasNext || loading} onClick={goNext}>
                  下一页
                </button>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
