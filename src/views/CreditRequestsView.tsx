import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { getBusinessErrorMessage } from '@/api/business'
import {
  createCreditRequest,
  decideCreditRequest,
  getCreditRequest,
  getCreditRequestContext,
  listCreditRequests,
  type CreditRequest,
  type CreditRequestDecision,
  type CreditRequestDirection,
  type CreditRequestPage,
  type CreditRequestPerson,
  type CreditRequestStatus,
} from '@/api/creditRequests'
import AppSidebar from '@/components/home/AppSidebar'
import AppTopbar from '@/components/layout/AppTopbar'
import { useSidebarNavigate } from '@/composables/useSidebarNavigate'
import { useConfirmDialog, useToast } from '@/composables/useToast'
import { deriveCurrentWorkspace, useCurrentUser, useWorkspaceSessionStore } from '@/stores/workspaceSession'
import { formatCredits } from '@/utils/creditsFormat'
import './CreditRequestsView.css'

const MAX_REQUEST_CREDITS = 1_000_000_000
const NOTE_LIMIT = 500

const STATUS_LABELS: Record<CreditRequestStatus, string> = {
  pending: '待审批',
  approved: '已通过',
  rejected: '已拒绝',
  expired: '已失效',
}
const DATE_FORMAT = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : DATE_FORMAT.format(date)
}

function newRequestKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-')
}

function RequestForm({ onCreated }: { onCreated: (item: CreditRequest) => void }) {
  const [superior, setSuperior] = useState<CreditRequestPerson | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [reload, setReload] = useState(0)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const submitController = useRef<AbortController | null>(null)
  const requestKey = useRef<{ amount: number; note: string; superiorId: number; key: string } | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setLoadError('')
    getCreditRequestContext(controller.signal)
      .then((context) => {
        if (!controller.signal.aborted) setSuperior(context.superior)
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoadError(getBusinessErrorMessage(error, '暂时无法读取你的直属上级。'))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [reload])

  useEffect(() => () => submitController.current?.abort(), [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (loading || loadError || !superior || submitController.current) return

    const input = amount.trim()
    const credits = Number(input)
    if (!/^\d+(\.\d{1,3})?$/.test(input) || credits < 0.001) {
      setFormError('请输入大于零的积分，最多保留三位小数。')
      return
    }

    if (credits > MAX_REQUEST_CREDITS) {
      setFormError('单次最多申请 10 亿积分。')
      return
    }

    const trimmedNote = note.trim()
    const controller = new AbortController()
    submitController.current = controller
    setSubmitting(true)
    setFormError('')
    try {
      let draft = requestKey.current
      if (!draft || credits !== draft.amount || trimmedNote !== draft.note || superior.id !== draft.superiorId) {
        draft = { amount: credits, note: trimmedNote, superiorId: superior.id, key: newRequestKey() }
        requestKey.current = draft
      }
      const item = await createCreditRequest(
        { amount: credits, note: trimmedNote, expected_superior_id: superior.id, request_key: draft.key },
        controller.signal,
      )
      if (controller.signal.aborted) return
      requestKey.current = null
      setAmount('')
      setNote('')
      onCreated(item)
    } catch (error) {
      if (controller.signal.aborted) return
      setFormError(getBusinessErrorMessage(error, '申请提交失败，请稍后重试。'))
      // 直属关系可能在填表时被管理员调整。
      setReload((value) => value + 1)
    } finally {
      submitController.current = null
      if (!controller.signal.aborted) setSubmitting(false)
    }
  }

  const disabled = loading || Boolean(loadError) || !superior || submitting

  return (
    <section className="credit-requests__panel" aria-labelledby="credit-request-form-title">
      <h2 id="credit-request-form-title">发起申请</h2>
      {loading ? (
        <p className="credit-requests__muted" role="status">
          正在查询直属上级…
        </p>
      ) : loadError ? (
        <p className="credit-requests__error" role="alert">
          {loadError}{' '}
          <button type="button" className="credit-requests__link" onClick={() => setReload((value) => value + 1)}>
            重试
          </button>
        </p>
      ) : superior ? (
        <p className="credit-requests__muted">
          审批人 <strong>{superior.name}</strong>
        </p>
      ) : (
        <p className="credit-requests__notice" role="status">
          当前账号未设置直属上级，无法提交积分申请。
        </p>
      )}
      <form className="credit-requests__form" onSubmit={(event) => void submit(event)} noValidate>
        <label>
          申请积分
          <input
            name="amount"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="如 100"
            value={amount}
            maxLength={20}
            disabled={disabled}
            required
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
        <label>
          申请说明 <span>选填，最多 {NOTE_LIMIT} 字</span>
          <textarea
            name="note"
            rows={3}
            maxLength={NOTE_LIMIT * 2}
            placeholder="填写本次积分的用途"
            value={note}
            disabled={disabled}
            onChange={(event) => setNote(Array.from(event.target.value).slice(0, NOTE_LIMIT).join(''))}
          />
        </label>
        {formError && (
          <p className="credit-requests__error" role="alert">
            {formError}
          </p>
        )}
        <button type="submit" className="credit-requests__button credit-requests__button--primary" disabled={disabled}>
          {submitting ? '提交中…' : '提交申请'}
        </button>
      </form>
    </section>
  )
}

interface RequestCardProps {
  item: CreditRequest
  direction: CreditRequestDirection
  canDecide: boolean
  processing: boolean
  onDecide: (item: CreditRequest, decision: CreditRequestDecision) => void
}

function RequestCard({ item, direction, canDecide, processing, onDecide }: RequestCardProps) {
  return (
    <article className="credit-requests__record">
      <div className="credit-requests__record-head">
        <div>
          <h3>{formatCredits(item.amount, 3)} 积分</h3>
          <p className="credit-requests__muted">
            {direction === 'received' ? '申请人' : '审批人'}{' '}
            <strong>{direction === 'received' ? item.applicant.name : item.superior.name}</strong>
          </p>
        </div>
        <span className={`credit-requests__status credit-requests__status--${item.status}`}>
          {STATUS_LABELS[item.status]}
        </span>
      </div>
      {item.note && <p className="credit-requests__note">{item.note}</p>}
      <div className="credit-requests__record-foot">
        <div className="credit-requests__dates">
          <span>
            申请于 <time dateTime={item.created_at}>{formatDate(item.created_at)}</time>
          </span>
          {item.decided_at && (
            <span>
              处理于 <time dateTime={item.decided_at}>{formatDate(item.decided_at)}</time>
            </span>
          )}
        </div>
        {canDecide && item.status === 'pending' && (
          <div className="credit-requests__actions">
            <button
              type="button"
              className="credit-requests__button"
              disabled={processing}
              onClick={() => onDecide(item, 'reject')}
            >
              拒绝
            </button>
            <button
              type="button"
              className="credit-requests__button credit-requests__button--primary"
              disabled={processing}
              onClick={() => onDecide(item, 'approve')}
            >
              同意并发放
            </button>
          </div>
        )}
      </div>
    </article>
  )
}

interface RequestHistoryProps {
  direction: CreditRequestDirection
  requestId: number
  userId: number
}

function RequestHistory({ direction, requestId, userId }: RequestHistoryProps) {
  const [cursors, setCursors] = useState([0])
  const [page, setPage] = useState<CreditRequestPage | null>(null)
  const [detail, setDetail] = useState<CreditRequest | null>(null)
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)
  const [loadError, setLoadError] = useState('')
  const [decideError, setDecideError] = useState('')
  const [processing, setProcessing] = useState(false)
  const decisionController = useRef<AbortController | null>(null)
  const { requestConfirm } = useConfirmDialog()
  const { showToast } = useToast()
  const cursor = cursors[cursors.length - 1]

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    setLoading(true)
    setLoadError('')
    const request = requestId
      ? getCreditRequest(requestId, signal).then((data) => {
          if (!signal.aborted) setDetail(data)
        })
      : listCreditRequests(direction, cursor, signal).then((data) => {
          if (!signal.aborted) setPage(data)
        })
    void request
      .catch((error: unknown) => {
        if (!signal.aborted) setLoadError(getBusinessErrorMessage(error, '暂时无法读取申请记录。'))
      })
      .finally(() => {
        if (!signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [cursor, direction, requestId, reload])

  useEffect(() => () => decisionController.current?.abort(), [])

  async function handleDecision(item: CreditRequest, decision: CreditRequestDecision) {
    if (item.superior.id !== userId || item.status !== 'pending' || decisionController.current) return
    const controller = new AbortController()
    decisionController.current = controller
    setProcessing(true)
    setDecideError('')
    try {
      const approve = decision === 'approve'
      const confirmed = await requestConfirm(
        approve
          ? `确认从你的个人工作空间可用积分中扣除 ${formatCredits(item.amount, 3)} 积分，发放至「${item.applicant.name}」的个人工作空间？`
          : `确认拒绝「${item.applicant.name}」的积分申请？`,
        {
          title: approve ? '确认发放积分' : '拒绝积分申请',
          confirmLabel: approve ? '确认发放' : '确认拒绝',
          danger: !approve,
        },
      )
      if (!confirmed || controller.signal.aborted) return
      const updated = await decideCreditRequest(item.id, decision, controller.signal)
      if (controller.signal.aborted) return
      setDetail((current) => (current?.id === item.id ? updated : current))
      setPage((current) =>
        current ? { ...current, items: current.items.map((row) => (row.id === item.id ? updated : row)) } : current,
      )
      showToast(approve ? '积分已发放' : '已拒绝申请', 'success')
      if (approve) {
        const session = useWorkspaceSessionStore.getState()
        const workspace = deriveCurrentWorkspace(session)
        if (workspace?.type === 'personal') void session.refreshWallet(Number(workspace.id))
      }
    } catch (error) {
      if (controller.signal.aborted) return
      setDecideError(getBusinessErrorMessage(error, '审批失败，请稍后重试。'))
      // 其他窗口可能已审批，重新读取记录后同步状态。
      setReload((value) => value + 1)
    } finally {
      decisionController.current = null
      if (!controller.signal.aborted) setProcessing(false)
    }
  }

  function renderRecord(item: CreditRequest, recordDirection: CreditRequestDirection) {
    return (
      <RequestCard
        item={item}
        direction={recordDirection}
        canDecide={item.superior.id === userId}
        processing={processing}
        onDecide={(target, decision) => void handleDecision(target, decision)}
      />
    )
  }

  return (
    <section className="credit-requests__panel" aria-labelledby="credit-request-history-title" aria-busy={loading}>
      <div className="credit-requests__history-head">
        <h2 id="credit-request-history-title">{requestId ? '申请详情' : '申请记录'}</h2>
        {requestId ? (
          <Link className="credit-requests__link" to={`?tab=${direction}`}>
            返回记录
          </Link>
        ) : (
          <button
            type="button"
            className="credit-requests__link"
            disabled={processing || loading}
            onClick={() => setReload((value) => value + 1)}
          >
            刷新
          </button>
        )}
      </div>
      {!requestId && (
        <nav className="credit-requests__tabs" aria-label="申请记录类型">
          <Link to="?tab=sent" aria-current={direction === 'sent' ? 'page' : undefined}>
            我发起的
          </Link>
          <Link to="?tab=received" aria-current={direction === 'received' ? 'page' : undefined}>
            我收到的
          </Link>
        </nav>
      )}
      {decideError && (
        <p className="credit-requests__error" role="alert">
          {decideError}
        </p>
      )}
      {loading ? (
        <p className="credit-requests__muted" role="status">
          正在加载申请记录…
        </p>
      ) : loadError ? (
        <p className="credit-requests__error" role="alert">
          {loadError}{' '}
          <button type="button" className="credit-requests__link" onClick={() => setReload((value) => value + 1)}>
            重试
          </button>
        </p>
      ) : requestId ? (
        detail && renderRecord(detail, detail.superior.id === userId ? 'received' : 'sent')
      ) : page?.items.length ? (
        <>
          <ul className="credit-requests__records">
            {page.items.map((item) => (
              <li key={item.id}>{renderRecord(item, direction)}</li>
            ))}
          </ul>
          {(cursors.length > 1 || page.has_more) && (
            <div className="credit-requests__pagination" aria-label="申请记录分页">
              <button
                type="button"
                className="credit-requests__button"
                disabled={cursors.length <= 1 || processing}
                onClick={() => setCursors((previous) => previous.slice(0, -1))}
              >
                上一页
              </button>
              <span className="credit-requests__muted">第 {cursors.length} 页</span>
              <button
                type="button"
                className="credit-requests__button"
                disabled={!page.has_more || processing}
                onClick={() => setCursors((previous) => [...previous, page.items[page.items.length - 1].id])}
              >
                下一页
              </button>
            </div>
          )}
        </>
      ) : (
        <p className="credit-requests__empty">
          {direction === 'sent' ? '暂无发起的积分申请。' : '暂无收到的积分申请。'}
        </p>
      )}
    </section>
  )
}

function CreditRequestContent({ userId }: { userId: number }) {
  const [params, setParams] = useSearchParams()
  const { showToast } = useToast()
  const direction = params.get('tab') === 'received' ? 'received' : 'sent'
  const rawRequestId = Number(params.get('request_id'))
  const requestId = Number.isSafeInteger(rawRequestId) && rawRequestId > 0 ? rawRequestId : 0

  return (
    <main className="credit-requests__content">
      <h1>积分申请</h1>
      {!requestId && <p className="credit-requests__intro">向直属上级申请积分，通过后积分将发放到你的个人工作空间。</p>}
      <div className={`credit-requests__columns${requestId ? ' credit-requests__columns--detail' : ''}`}>
        {!requestId && (
          <RequestForm
            onCreated={(item) => {
              showToast('申请已提交，等待上级审批', 'success')
              setParams({ tab: 'sent', request_id: String(item.id) })
            }}
          />
        )}
        <RequestHistory key={`${direction}:${requestId}`} direction={direction} requestId={requestId} userId={userId} />
      </div>
    </main>
  )
}

export default function CreditRequestsView() {
  const handleNavigate = useSidebarNavigate()
  const user = useCurrentUser()
  const userId = Number(user?.id || user?.user_id || 0)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="credit-requests">
      <AppSidebar
        activeKey="settings"
        onNavigate={handleNavigate}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <div className="credit-requests__main">
        <AppTopbar onMenu={() => setSidebarOpen(true)} />
        <CreditRequestContent key={userId} userId={userId} />
      </div>
    </div>
  )
}
