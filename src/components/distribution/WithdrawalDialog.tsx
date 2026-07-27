import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createDistributionWithdrawal,
  createDistributionWithdrawalMethod,
  deleteDistributionWithdrawalMethod,
  listDistributionWithdrawalMethods,
  listDistributionWithdrawals,
} from '@/api/business'
import { useConfirmDialog } from '@/composables/useToast'
import './WithdrawalDialog.css'

type WithdrawalMethodType = 'bank_card'

interface WithdrawalMethod {
  id: number
  accountName: string
  accountNumber: string
  bankName: string
  isDefault: boolean
}

interface WithdrawalRecord {
  id: string
  amountCents: number
  status: string
  createdAt: string
}

interface WithdrawalDialogProps {
  withdrawableCents: number
  withdrawingCents: number
  withdrawnCents: number
  onClose: () => void
  onSuccess: () => void
}

const EMPTY_METHOD_FORM = {
  methodType: 'bank_card' as WithdrawalMethodType,
  accountName: '',
  accountNumber: '',
  bankName: '',
  isDefault: true,
}

function unwrapList(payload: any, keys: string[]): any[] {
  const source =
    payload?.data && typeof payload.data === 'object' && !Array.isArray(payload.data) ? payload.data : payload
  if (Array.isArray(source)) return source
  return [source?.items, source?.records, source?.list, ...keys.map((key) => source?.[key])].find(Array.isArray) || []
}

function formatMoneyFromCents(value: number): string {
  const cents = Number.isSafeInteger(value) ? Math.max(0, value) : 0
  const yuan = Math.floor(cents / 100).toLocaleString('zh-CN')
  const fraction = String(cents % 100).padStart(2, '0')
  return `${yuan}.${fraction}`
}

function parseYuanInputToCents(value: string): number {
  const normalized = value.trim()
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return 0
  const [yuan = '0', fraction = ''] = normalized.split('.')
  const cents = Number(yuan) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(cents) ? cents : 0
}

function withdrawalStatusLabel(status: string): string {
  if (status === 'paid') return '已到账'
  if (status === 'rejected') return '已驳回'
  return '提现中'
}

function createIdempotencyKey(): string {
  return crypto.randomUUID()
}

export default function WithdrawalDialog({
  withdrawableCents,
  withdrawingCents,
  withdrawnCents,
  onClose,
  onSuccess,
}: WithdrawalDialogProps) {
  const { requestConfirm } = useConfirmDialog()
  const [methods, setMethods] = useState<WithdrawalMethod[]>([])
  const [records, setRecords] = useState<WithdrawalRecord[]>([])
  const [selectedMethodId, setSelectedMethodId] = useState('')
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [methodSubmitting, setMethodSubmitting] = useState(false)
  const [deletingMethodId, setDeletingMethodId] = useState<number | null>(null)
  const [showMethodForm, setShowMethodForm] = useState(false)
  const [methodForm, setMethodForm] = useState(EMPTY_METHOD_FORM)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const idempotencyKeyRef = useRef('')

  const loadData = useCallback(async (signal?: AbortSignal, silent = false) => {
    if (!silent) setLoading(true)
    setError('')
    try {
      const [methodPayload, withdrawalPayload] = await Promise.all([
        listDistributionWithdrawalMethods({ signal }),
        listDistributionWithdrawals({ limit: 20, offset: 0, signal }),
      ])
      const nextMethods = unwrapList(methodPayload, ['methods', 'withdrawal_methods'])
        .filter((item) =>
          ['bank', 'bankcard', 'bank_card'].includes(
            String(item.method_type || item.methodType || item.type || '').toLowerCase(),
          ),
        )
        .map((item) => ({
          id: Number(item.id),
          accountName: String(item.account_name || ''),
          accountNumber: String(item.masked_account_number || item.account_number || ''),
          bankName: String(item.bank_name || ''),
          isDefault: Boolean(item.is_default),
        }))
        .filter((item) => Number.isSafeInteger(item.id) && item.id > 0)
      const nextRecords = unwrapList(withdrawalPayload, ['withdrawals']).map((item, index) => ({
        id: String(item.id || index),
        amountCents: Math.max(0, Math.round(Number(item.amount_cents) || 0)),
        status: String(item.status || 'pending'),
        createdAt: String(item.created_at || ''),
      }))
      setMethods(nextMethods)
      setRecords(nextRecords)
      setSelectedMethodId((current) => {
        if (nextMethods.some((item) => String(item.id) === current)) return current
        const preferred = nextMethods.find((item) => item.isDefault) || nextMethods[0]
        return preferred ? String(preferred.id) : ''
      })
    } catch (nextError: any) {
      if (signal?.aborted) return
      setError(nextError?.message || '提现数据加载失败，请稍后重试')
    } finally {
      if (!signal?.aborted && !silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void loadData(controller.signal)
    return () => controller.abort()
  }, [loadData])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting && !methodSubmitting) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [methodSubmitting, onClose, submitting])

  const amountCents = useMemo(() => parseYuanInputToCents(amount), [amount])

  const updateAmount = (value: string) => {
    setAmount(value)
    idempotencyKeyRef.current = ''
    setError('')
    setSuccess('')
  }

  const updateSelectedMethod = (value: string) => {
    setSelectedMethodId(value)
    idempotencyKeyRef.current = ''
    setError('')
    setSuccess('')
  }

  const submitWithdrawal = async () => {
    if (!selectedMethodId) {
      setError('请先添加并选择提现方式')
      return
    }
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
      setError('请输入有效的提现金额')
      return
    }
    if (amountCents > withdrawableCents) {
      setError('提现金额不能超过当前可提现金额')
      return
    }

    setSubmitting(true)
    setError('')
    setSuccess('')
    if (!idempotencyKeyRef.current) idempotencyKeyRef.current = createIdempotencyKey()
    try {
      await createDistributionWithdrawal({
        methodId: Number(selectedMethodId),
        amountCents,
        idempotencyKey: idempotencyKeyRef.current,
      })
      idempotencyKeyRef.current = ''
      setAmount('')
      setSuccess('提现申请已提交，金额已转入提现中')
      onSuccess()
      await loadData()
    } catch (nextError: any) {
      const code = String(nextError?.code || nextError?.response?.code || '')
      setError(
        code === 'INSUFFICIENT_WITHDRAWABLE_BALANCE'
          ? '可提现余额不足，请刷新后重试'
          : nextError?.message || '提现申请提交失败，请稍后重试',
      )
    } finally {
      setSubmitting(false)
    }
  }

  const submitMethod = async () => {
    if (!methodForm.accountName.trim() || !methodForm.accountNumber.trim()) {
      setError('请完整填写账户姓名和收款账号')
      return
    }
    if (methodForm.methodType === 'bank_card' && !methodForm.bankName.trim()) {
      setError('银行卡提现必须填写开户银行')
      return
    }
    setMethodSubmitting(true)
    setError('')
    setSuccess('')
    try {
      await createDistributionWithdrawalMethod(methodForm)
      setMethodForm(EMPTY_METHOD_FORM)
      setShowMethodForm(false)
      setSuccess('提现方式添加成功')
      await loadData()
    } catch (nextError: any) {
      setError(nextError?.message || '提现方式添加失败，请检查填写内容')
    } finally {
      setMethodSubmitting(false)
    }
  }

  const removeMethod = async (method: WithdrawalMethod) => {
    const confirmed = await requestConfirm(`确认删除银行卡账号 ${method.accountNumber} 吗？`, {
      title: '删除提现方式',
      confirmLabel: '删除',
      danger: true,
    })
    if (!confirmed) return
    setDeletingMethodId(method.id)
    setError('')
    setSuccess('')
    try {
      await deleteDistributionWithdrawalMethod({ id: method.id })
      setSuccess('提现方式已删除')
      await loadData()
    } catch (nextError: any) {
      setError(nextError?.message || '提现方式删除失败')
    } finally {
      setDeletingMethodId(null)
    }
  }

  return (
    <div className="withdrawal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="withdrawal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="withdrawal-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="withdrawal-dialog__header">
          <div>
            <span>资金管理</span>
            <h2 id="withdrawal-dialog-title">申请提现</h2>
            <p>选择收款方式并提交提现金额，申请成功后将进入“提现中”。</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭提现弹窗" autoFocus>
            ×
          </button>
        </header>

        <div className="withdrawal-balance-grid" aria-label="提现金额概览">
          <article>
            <span>可提现</span>
            <strong>￥{formatMoneyFromCents(withdrawableCents)}</strong>
          </article>
          <article>
            <span>提现中</span>
            <strong>￥{formatMoneyFromCents(withdrawingCents)}</strong>
          </article>
          <article>
            <span>已提现</span>
            <strong>￥{formatMoneyFromCents(withdrawnCents)}</strong>
          </article>
        </div>

        {loading ? <div className="withdrawal-state">正在加载提现信息…</div> : null}

        {!loading ? (
          <>
            <div className="withdrawal-section-heading">
              <h3>提现方式</h3>
              <button type="button" onClick={() => setShowMethodForm((value) => !value)}>
                {showMethodForm ? '收起' : '+ 添加提现方式'}
              </button>
            </div>

            {showMethodForm ? (
              <div className="withdrawal-method-form">
                <div className="withdrawal-method-form__fixed-type">
                  <span>提现方式</span>
                  <strong>银行卡</strong>
                  <small>当前仅支持提现到本人银行卡</small>
                </div>
                <label>
                  <span>账户姓名</span>
                  <input
                    value={methodForm.accountName}
                    onChange={(event) => setMethodForm((current) => ({ ...current, accountName: event.target.value }))}
                    placeholder="请输入真实姓名"
                  />
                </label>
                <label>
                  <span>银行卡号</span>
                  <input
                    value={methodForm.accountNumber}
                    onChange={(event) =>
                      setMethodForm((current) => ({ ...current, accountNumber: event.target.value }))
                    }
                    placeholder="请输入银行卡号"
                    inputMode="numeric"
                    autoComplete="cc-number"
                  />
                </label>
                <label>
                  <span>开户银行</span>
                  <input
                    value={methodForm.bankName}
                    onChange={(event) => setMethodForm((current) => ({ ...current, bankName: event.target.value }))}
                    placeholder="例如：招商银行"
                    autoComplete="organization"
                  />
                </label>
                <label className="withdrawal-default-check">
                  <input
                    type="checkbox"
                    checked={methodForm.isDefault}
                    onChange={(event) => setMethodForm((current) => ({ ...current, isDefault: event.target.checked }))}
                  />
                  <span>设为默认提现方式</span>
                </label>
                <button
                  type="button"
                  className="withdrawal-primary-button"
                  onClick={() => void submitMethod()}
                  disabled={methodSubmitting}
                >
                  {methodSubmitting ? '保存中…' : '保存提现方式'}
                </button>
              </div>
            ) : null}

            <div className="withdrawal-method-list" role="radiogroup" aria-label="选择提现方式">
              {methods.map((method) => (
                <div key={method.id} className="withdrawal-method-card">
                  <input
                    id={`withdrawal-method-${method.id}`}
                    type="radio"
                    name="withdrawal-method"
                    value={method.id}
                    checked={selectedMethodId === String(method.id)}
                    onChange={(event) => updateSelectedMethod(event.target.value)}
                  />
                  <label htmlFor={`withdrawal-method-${method.id}`}>
                    <strong>
                      银行卡
                      {method.isDefault ? <small>默认</small> : null}
                    </strong>
                    <span>
                      {method.accountName} · {method.accountNumber}
                      {method.bankName ? ` · ${method.bankName}` : ''}
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={() => void removeMethod(method)}
                    disabled={deletingMethodId === method.id || submitting}
                    aria-label="删除银行卡提现方式"
                  >
                    {deletingMethodId === method.id ? '删除中…' : '删除'}
                  </button>
                </div>
              ))}
              {!methods.length ? <div className="withdrawal-empty">尚未添加提现方式</div> : null}
            </div>

            <div className="withdrawal-amount-row">
              <label htmlFor="withdrawal-amount">提现金额</label>
              <div>
                <span>￥</span>
                <input
                  id="withdrawal-amount"
                  type="number"
                  min="0.01"
                  max={Math.max(0, withdrawableCents / 100)}
                  step="0.01"
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => updateAmount(event.target.value)}
                  placeholder="请输入提现金额"
                />
                <button type="button" onClick={() => updateAmount(formatMoneyFromCents(withdrawableCents))}>
                  全部提现
                </button>
              </div>
            </div>

            {error ? (
              <p className="withdrawal-feedback is-error" role="alert">
                {error}
              </p>
            ) : null}
            {success ? (
              <p className="withdrawal-feedback is-success" role="status" aria-live="polite">
                {success}
              </p>
            ) : null}

            <button
              type="button"
              className="withdrawal-submit"
              onClick={() => void submitWithdrawal()}
              disabled={submitting || withdrawableCents <= 0}
            >
              {submitting ? '提交中…' : '确认提现'}
            </button>

            <div className="withdrawal-history">
              <h3>最近提现记录</h3>
              {records.map((record) => (
                <div key={record.id}>
                  <span>{record.createdAt || '---'}</span>
                  <strong>￥{formatMoneyFromCents(record.amountCents)}</strong>
                  <small className={`is-${record.status.toLowerCase()}`}>{withdrawalStatusLabel(record.status)}</small>
                </div>
              ))}
              {!records.length ? <p>暂无提现记录</p> : null}
            </div>
          </>
        ) : null}
      </section>
    </div>
  )
}
