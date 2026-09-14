/**
 * 积分流水（credit-ledger）记录的归一化与展示逻辑。
 *
 * 后端 `/api/v1/billing/credit-ledgers` 返回的单条记录字段是弱类型的（前端无 TS interface），
 * 且不同环境可能给 snake_case / camelCase、amount 可能是带符号也可能是绝对值。这里统一成稳定的
 * 展示模型：不发请求、不读全局状态，纯函数，便于「积分明细」页直接消费并单测。
 *
 * kind 语义（后端约定）：settle=实际消费扣款、freeze=提交任务时预冻结、release=释放/退回；
 * 充值/赠送等入账走各自的 kind（recharge/grant/topup…）。未知 kind 按金额方向兜底展示。
 */

/** 判定为「支出/占用」的 kind（余额减少）。 */
const OUT_KINDS = new Set(['settle', 'freeze', 'consume', 'deduct', 'debit', 'expire'])
/** 判定为「入账/退回」的 kind（余额增加）。 */
const IN_KINDS = new Set(['release', 'recharge', 'refund', 'grant', 'topup', 'reward', 'gift', 'credit'])

/** kind → 中文展示标签；未知 kind 交由调用方按方向兜底。 */
const KIND_LABELS: Readonly<Record<string, string>> = Object.freeze({
  settle: '消费',
  freeze: '冻结',
  release: '退回',
  recharge: '充值',
  refund: '退款',
  grant: '赠送',
  topup: '充值',
  reward: '奖励',
  gift: '赠送',
  expire: '过期',
})

export type CreditLedgerDirection = 'in' | 'out'

export interface CreditLedgerRecord {
  /** 记录唯一标识（用于列表 key 与去重）；缺失时由调用方用下标兜底。 */
  id: string
  /** 原始 kind 字符串（小写归一）。 */
  kind: string
  /** 原始事由文本。 */
  reason: string
  /** ISO 时间字符串（created_at）。 */
  createdAt: string
  /** 金额绝对值（积分数，恒为非负）。 */
  amount: number
  /** 资金方向：out=支出/占用，in=入账/退回。 */
  direction: CreditLedgerDirection
  /** 结算后余额；后端未给时为 null（展示为「—」）。 */
  balanceAfter: number | null
  /** 产生该笔的成员 user_id；无则 0。 */
  userId: number
}

/** 从多个候选字段名里取第一个有值的（兼容 snake_case / camelCase）。 */
function pick(raw: any, ...keys: string[]): any {
  for (const key of keys) {
    const value = raw?.[key]
    if (value !== undefined && value !== null && value !== '') return value
  }
  return undefined
}

/** 归一化 kind：转小写去空白；缺失返回空串。 */
export function normalizeCreditLedgerKind(kind: unknown): string {
  return String(kind ?? '')
    .trim()
    .toLowerCase()
}

/**
 * 判定资金方向：优先按 kind 白名单，未知 kind 再按金额符号兜底（>=0 入账、<0 支出）。
 * amount 传后端原始值（可能带符号，也可能是绝对值）。
 */
export function creditLedgerDirection(kind: string, amount: number): CreditLedgerDirection {
  const normalized = normalizeCreditLedgerKind(kind)
  if (OUT_KINDS.has(normalized)) return 'out'
  if (IN_KINDS.has(normalized)) return 'in'
  return Number(amount) < 0 ? 'out' : 'in'
}

/** kind → 展示标签；未知 kind 按方向返回「入账 / 支出」。 */
export function creditLedgerKindLabel(kind: string, direction: CreditLedgerDirection): string {
  const normalized = normalizeCreditLedgerKind(kind)
  return KIND_LABELS[normalized] || (direction === 'in' ? '入账' : '支出')
}

/** 把一条后端流水记录归一化为稳定展示模型。 */
export function normalizeCreditLedgerRecord(raw: any, fallbackId = ''): CreditLedgerRecord {
  const kind = normalizeCreditLedgerKind(pick(raw, 'kind', 'type', 'ledger_kind'))
  const rawAmount = Number(pick(raw, 'amount', 'credits', 'delta') ?? 0) || 0
  const direction = creditLedgerDirection(kind, rawAmount)
  const balanceRaw = pick(raw, 'balance_after', 'balanceAfter', 'balance')
  const idText = String(pick(raw, 'id', 'ledger_id', 'ledgerId') ?? '').trim()
  return {
    id: idText || fallbackId,
    kind,
    reason: String(pick(raw, 'reason', 'remark', 'description', 'memo') ?? '').trim(),
    createdAt: String(pick(raw, 'created_at', 'createdAt', 'updated_at', 'updatedAt') ?? '').trim(),
    amount: Math.abs(rawAmount),
    direction,
    balanceAfter: balanceRaw === undefined ? null : Number(balanceRaw),
    userId: Math.floor(Number(pick(raw, 'user_id', 'userId') ?? 0)) || 0,
  }
}

/** 展示用的带符号积分变动文本，如「-800」「+10000」。 */
export function formatCreditDelta(record: Pick<CreditLedgerRecord, 'amount' | 'direction'>): string {
  const sign = record.direction === 'out' ? '-' : '+'
  return `${sign}${record.amount.toLocaleString('en-US')}`
}

/** 从数组或分页信封里取当前页记录（兼容 items/list/records/data）。 */
function extractRawRecords(payload: any): any[] {
  if (Array.isArray(payload)) return payload
  const records = payload?.items ?? payload?.list ?? payload?.records ?? payload?.data ?? []
  return Array.isArray(records) ? records : []
}

/** 从返回体读取总条数；缺失返回 null（由调用方按本页是否满页推断是否还有下一页）。 */
function extractTotal(payload: any): number | null {
  const total = payload?.total ?? payload?.count ?? payload?.total_count ?? payload?.totalCount
  const n = Number(total)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null
}

export interface CreditLedgerPage {
  records: CreditLedgerRecord[]
  /** 后端返回的总条数；未提供为 null。 */
  total: number | null
}

/** 归一化一整页流水返回体。 */
export function extractCreditLedgerPage(payload: any, offset = 0): CreditLedgerPage {
  const raw = extractRawRecords(payload)
  const records = raw.map((item, index) => normalizeCreditLedgerRecord(item, `offset-${offset + index}`))
  return { records, total: extractTotal(payload) }
}

/** 「积分明细」页的类型筛选项 → 后端 kind 过滤值（空串=全部）。 */
export const CREDIT_LEDGER_FILTERS: ReadonlyArray<{ key: string; label: string; kind: string }> = Object.freeze([
  { key: 'all', label: '全部', kind: '' },
  { key: 'settle', label: '消费', kind: 'settle' },
  { key: 'release', label: '退回', kind: 'release' },
  { key: 'freeze', label: '冻结', kind: 'freeze' },
])
