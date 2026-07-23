/**
 * MemberCenterModal — 会员中心(弹窗,按 Figma 521:3541)。
 * 覆盖在当前页之上(portal),关闭即回到原页面。
 * 个人版/团队版 Tab + 套餐卡片。套餐名/价格/积分/周期、当前积分余额、立即开通/续费均接真实接口。
 * 取到一次性付款 pay_url 后【直接跳转支付宝支付页】(去掉站内扫码步骤)。
 *   - GET  /api/v1/billing/plans                       列出套餐(listBillingPlans)
 *   - GET  /api/v1/billing/wallet                      当前 workspace 积分余额(getWallet)
 *   - GET  /api/v1/billing/subscription                当前订阅(getSubscription),已订阅的套餐按钮显示「续费」
 *   - POST /api/v1/billing/subscription-orders         开通/续费订阅(一次性付款,取 pay_url)(createSubscriptionOrder;开通与续费统一走此接口)
 *   - POST /api/v1/billing/recharge-orders             积分充值(一次性付款,取 pay_url)(createRechargeOrder)
 * 注:签约(subscriptions/sign-url,周期扣款)暂未开通权限,故会员开通走一次性付款。
 * 接口未提供「副标题/功能清单」等营销文案,按个人/团队保留静态展示。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useToast, useConfirmDialog } from '@/composables/useToast'
import { useSafeWorkspaceSwitch } from '@/composables/useSafeWorkspaceSwitch'
import { useUiStore } from '@/stores/ui'
import {
  useWorkspaceId,
  useWorkspaceSessionStore,
  deriveAllWorkspaces,
  deriveWorkspaceId,
  useAllWorkspaces,
  useCurrentWorkspace,
  useCurrentUser,
  useCurrentMember,
} from '@/stores/workspaceSession'
import {
  cancelSubscription,
  createRechargeOrder,
  createSubscriptionOrder,
  disableSubscriptionAutoRenew,
  getBusinessErrorMessage,
  getSubscription,
  getWallet,
  listBillingPlans,
  listCreditPackages,
  listPaymentOrders,
  reconcilePaymentOrder,
} from '@/api/business'
import { armSmartGuide } from '@/stores/guide'
import { WORKSPACE_NAME_MAX, validateWorkspaceName } from '@/utils/workspaceName'
import { logger } from '@/observability/openobserve-logger'
import { createSafeErrorDiagnostic } from '@/utils/observabilitySanitizer'
import {
  bindPendingNewTeamOrder,
  clearPendingNewTeamOrder,
  loadPendingNewTeamOrder,
  loadPendingNewTeamOrders,
  savePendingNewTeamOrder,
  type PendingNewTeamOrderIntent,
} from '@/utils/pendingNewTeamOrder'
import {
  getMemberCenterPaymentUserScope,
  formatPriceCents,
  isSameMemberCenterPaymentScope,
  releaseMemberCenterPayment,
  resolvePurchasedTeamWorkspace,
  stopTrackingMemberCenterOrder,
  tryAcquireMemberCenterPayment,
  tryTrackMemberCenterOrder,
} from '@/utils/memberCenterPayment'
import './MemberCenterModal.css'

/** 套餐能力清单中的一项及其是否包含状态。 */
interface Feature {
  text: string
  ok: boolean
}

/**
 * 后端套餐结构（已由 requestJson 解包 data）。
 * 设计稿需要的副标题、划线原价、折扣和生成额度若未返回则降级不显示。
 */
interface ApiPlan {
  id: number
  code: string
  name: string
  period: string
  period_label?: string
  periodLabel?: string
  period_days?: number
  periodDays?: number
  duration_days?: number
  durationDays?: number
  interval_unit?: string
  intervalUnit?: string
  interval_count?: number
  intervalCount?: number
  unit?: string
  credit_unit?: string
  creditUnit?: string
  plan_type?: string // team | personal(后端区分团队/个人套餐)
  planType?: string
  price_cents: number // 折前原价(划线价)
  base_credits: number
  status?: string
  description?: string
  subtitle?: string
  // 后端折扣三件套:开关 + 折后实付价 + 折扣百分比(80=8折、88=8.8折、75=7.5折)
  discount_enabled?: boolean
  discounted_price_cents?: number
  discount_percent?: number
  quota?: string
  display?: any
}

/** 将多个后端版本字段归一化后的套餐卡片视图模型。 */
interface PlanVM {
  id: number
  code: string
  name: string
  subtitle: string
  priceCents: number
  price: string
  unit: string
  origin: string // 划线原价(￥899),无则空
  discount: string // 折扣(8.8折),无则空
  credits: string
  creditUnit: string
  rate: string // 1积分≈X元
  quota: string // 最多生成约 X 张图片,无则空
  features: Feature[]
  isTeam: boolean
}

// 接口未提供功能清单,按图给静态展示(上段能力 + 下段权益;团队版多「可创建团队」)
const FEATURES_PERSONAL: Feature[] = [
  { text: '云端储存空间', ok: true },
  { text: 'AI智能成片', ok: true },
  { text: '爆款视频复制', ok: true },
  { text: '素材库任意用', ok: true },
  { text: '超清 1080P 导出', ok: true },
  { text: '去除品牌水印,商用无忧', ok: true },
]

/** 接口未提供团队权益清单时使用的设计稿展示项。 */
const FEATURES_TEAM: Feature[] = [
  { text: '云端储存空间', ok: true },
  { text: 'AI智能成片', ok: true },
  { text: '爆款视频复制', ok: true },
  { text: '可创建团队', ok: true },
  { text: '素材库任意用', ok: true },
  { text: '超清 1080P 导出', ok: true },
  { text: '去除品牌水印,商用无忧', ok: true },
]

/** 按分为单位格式化人民币价格，保留后端真实精度。 */
function yuan(cents: number): string {
  return formatPriceCents(cents)
}

/** 折扣百分比转角标文案；80→“8折”、88→“8.8折”，无效折扣返回空串。 */
function discountLabel(percent: number): string {
  const p = Number(percent) || 0
  if (p <= 0 || p >= 100) return ''
  const d = p / 10
  return `${Number.isInteger(d) ? d : d.toFixed(1)}折`
}

/** 兼容多版本到期字段，格式化为“剩余天数 + 到期日期”。 */
function formatExpiry(sub: any): string {
  const raw =
    sub?.current_period_end ||
    sub?.currentPeriodEnd ||
    sub?.expire_at ||
    sub?.expires_at ||
    sub?.expired_at ||
    sub?.end_at ||
    sub?.end_time ||
    ''
  if (!raw) return ''
  // 兼容秒级时间戳(数字)与 ISO 字符串
  const ms = typeof raw === 'number' ? (raw < 1e12 ? raw * 1000 : raw) : Date.parse(String(raw))
  const end = new Date(ms)
  if (isNaN(end.getTime())) return ''
  const ymd = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`
  const days = Math.ceil((end.getTime() - Date.now()) / 86400000)
  if (days < 0) return `已于 ${ymd} 到期`
  if (days === 0) return `今天到期（${ymd}）`
  return `${days} 天后到期（${ymd}）`
}

/** 读取订阅到期时间戳，供购买后选择最新有效订阅。 */
function expiryTimeMs(sub: any): number {
  const raw =
    sub?.current_period_end ||
    sub?.currentPeriodEnd ||
    sub?.expire_at ||
    sub?.expires_at ||
    sub?.expired_at ||
    sub?.end_at ||
    sub?.end_time ||
    ''
  if (!raw) return 0
  const ms = typeof raw === 'number' ? (raw < 1e12 ? raw * 1000 : raw) : Date.parse(String(raw))
  return Number.isFinite(ms) ? ms : 0
}

/** 统一价格周期单位为以斜杠开头的展示形式。 */
function normalizeSlashUnit(raw: any): string {
  const s = String(raw || '').trim()
  if (!s) return ''
  return s.startsWith('/') ? s : `/${s}`
}

/** 根据价格周期生成对应积分周期文案。 */
function creditUnitFromUnit(unit: string): string {
  const clean = String(unit || '')
    .trim()
    .replace(/^\//, '')
  return clean ? `积分/${clean}` : ''
}

/** 从显式天数、周期和 interval 字段中解析套餐有效天数。 */
function resolvePeriodDays(p: ApiPlan): number {
  const explicitDays =
    Number(
      p.period_days ??
        p.periodDays ??
        p.duration_days ??
        p.durationDays ??
        p.display?.period_days ??
        p.display?.periodDays ??
        p.display?.duration_days ??
        p.display?.durationDays ??
        0,
    ) || 0
  if (explicitDays > 0) return explicitDays

  const periodRaw = p.period ?? p.display?.period ?? ''
  const periodNum = Number(periodRaw)
  if (String(periodRaw || '').trim() && Number.isFinite(periodNum) && periodNum > 0) {
    return periodNum
  }

  const intervalUnit = String(
    p.interval_unit ?? p.intervalUnit ?? p.display?.interval_unit ?? p.display?.intervalUnit ?? '',
  ).toLowerCase()
  const intervalCount =
    Number(p.interval_count ?? p.intervalCount ?? p.display?.interval_count ?? p.display?.intervalCount ?? 0) || 0
  if (intervalUnit === 'day' && intervalCount > 0) return intervalCount
  if (intervalUnit === 'week') return 7 * (intervalCount || 1)

  if (String(periodRaw || '').toLowerCase() === 'week') {
    return 7 * (intervalCount || 1)
  }

  return 0
}

/** 按字段优先级解析套餐周期展示文案。 */
function resolvePeriodText(p: ApiPlan): string {
  const periodDays = resolvePeriodDays(p)
  if (periodDays > 0) return `${periodDays}天`

  const backendUnit = String(
    p.unit ||
      p.period_label ||
      p.periodLabel ||
      p.display?.unit ||
      p.display?.period_label ||
      p.display?.periodLabel ||
      '',
  )
    .trim()
    .replace(/^\//, '')
  if (backendUnit) return backendUnit

  const intervalUnit = String(
    p.interval_unit ?? p.intervalUnit ?? p.display?.interval_unit ?? p.display?.intervalUnit ?? '',
  ).toLowerCase()
  const intervalCount =
    Number(p.interval_count ?? p.intervalCount ?? p.display?.interval_count ?? p.display?.intervalCount ?? 0) || 0
  if (intervalUnit === 'quarter') return '季'
  if (intervalUnit === 'year') return '年'
  if (intervalUnit === 'month') return '月'
  if (intervalUnit === 'day' && intervalCount > 0) return `${intervalCount}天`
  if (intervalUnit === 'week') return `${7 * (intervalCount || 1)}天`

  const periodRaw = String(p.period ?? p.display?.period ?? '').toLowerCase()
  if (periodRaw === 'quarter') return '季'
  if (periodRaw === 'year') return '年'
  if (periodRaw === 'month') return '月'
  if (periodRaw === 'week') return `${7 * (intervalCount || 1)}天`

  return '月'
}

/** 让试用套餐名称与后端真实周期保持一致，避免标题仍显示旧天数。 */
function normalizePlanName(name: string, p: ApiPlan): string {
  const rawName = String(name || '').trim()
  if (!rawName) return '套餐'

  const periodText = resolvePeriodText(p)
  if (!periodText.endsWith('天')) return rawName

  // 会员中心里标题、价格单位、积分单位需要统一跟随同一套周期字段。
  if (/^\d+\s*天(?=\S)/.test(rawName)) {
    return rawName.replace(/^\d+\s*天(?=\S)/, periodText)
  }
  if (/试用会员/.test(rawName) && !new RegExp(`^${periodText}`).test(rawName)) {
    return rawName.replace(/试用会员/, `${periodText}试用会员`)
  }
  return rawName
}

// 周期优先级:明确的数字 > 后端的展示文案(unit/period_label 可能未同步更新)。
// 1.period_days/duration_days 2.period 纯数字 3.unit/period_label 4.interval_unit 5.period 文字 6.兜底/月
/** 同时生成价格单位与积分单位，保证卡片两处周期一致。 */
function periodLabel(p: ApiPlan): { unit: string; creditUnit: string } {
  const backendCreditUnit = String(
    p.credit_unit || p.creditUnit || p.display?.credit_unit || p.display?.creditUnit || '',
  ).trim()
  const periodText = resolvePeriodText(p)
  const unit = normalizeSlashUnit(periodText)
  return { unit, creditUnit: backendCreditUnit || creditUnitFromUnit(unit) }
}

/** 把后端套餐、折扣和展示字段转换为稳定的卡片视图模型。 */
function toVM(p: ApiPlan): PlanVM {
  const s = `${p.name || ''} ${p.code || ''}`
  // 优先用后端 plan_type 区分团队/个人;没有该字段再退回按名称/code 猜
  const planType = String(p.plan_type ?? p.planType ?? '').toLowerCase()
  const isTeam = planType ? planType === 'team' : /团队|team/i.test(s)
  const { unit, creditUnit } = periodLabel(p)
  const credits = Number(p.base_credits ?? 0)

  // 价格用后端折扣三件套:price_cents=折前原价(划线),discounted_price_cents=折后实付(大号),
  // discount_percent=折扣百分比。discount_enabled 关闭或数据缺失时,大号显示原价、不划线、不显示角标。
  // display 字段作为兜底(部分后端版本把价格放在 display 里)。
  const originCents = Number(p.price_cents ?? p.display?.price_cents ?? p.display?.priceCents ?? 0)
  const discountedCents = Number(
    p.discounted_price_cents ?? p.display?.discounted_price_cents ?? p.display?.discountedPriceCents ?? 0,
  )
  const discountEnabled = Boolean(
    p.discount_enabled ?? p.display?.discount_enabled ?? p.display?.discountEnabled ?? false,
  )
  const discountPercent = Number(p.discount_percent ?? p.display?.discount_percent ?? p.display?.discountPercent ?? 0)
  const enabled = discountEnabled && discountedCents > 0 && discountedCents < originCents
  const payCents = enabled ? discountedCents : originCents
  // 价格必须保留后端的“分”精度；1 分套餐不能被四舍五入成 ￥0。
  const origin = enabled ? `￥${formatPriceCents(originCents)}` : ''
  const discount = enabled ? discountLabel(discountPercent) : ''
  // 1积分≈X元 用折后实付价算(用户实际付的钱)
  const rate = credits > 0 ? `1积分≈${(payCents / 100 / credits).toFixed(2)}元` : ''

  const subtitle =
    String(p.subtitle || p.description || p.display?.subtitle || '').trim() ||
    (isTeam ? '多成员共享创作,素材高效管理' : '解锁全量核心功能,高效产出')

  // 生成额度:只用后端真实字段,后端没返回就不显示(不再写死估算)
  const quota = String(p.quota || p.display?.quota || '').trim()
  return {
    id: Number(p.id),
    code: p.code || '',
    name: normalizePlanName(p.name || '套餐', p),
    subtitle,
    priceCents: payCents,
    price: formatPriceCents(payCents),
    unit,
    origin,
    discount,
    credits: String(credits),
    creditUnit,
    rate,
    quota,
    features: isTeam ? FEATURES_TEAM : FEATURES_PERSONAL,
    isTeam,
  }
}

/** 套餐权益是否包含的勾选/关闭图标。 */
function Check({ ok }: { ok: boolean }) {
  return ok ? (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M3 8.5l3.2 3.2L13 5"
        fill="none"
        stroke="#32c7a6"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ) : (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="#c4c4c4" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

/** 渲染套餐价格、积分、权益及开通/续费操作。 */
function PlanCard({
  plan,
  buying,
  purchased,
  disabled,
  disabledText,
  disabledReason,
  onBuy,
}: {
  plan: PlanVM
  buying: boolean
  purchased: boolean
  disabled?: boolean
  disabledText?: string
  disabledReason?: string
  onBuy: (p: PlanVM) => void
}) {
  return (
    <div className="mc-card">
      <div className="mc-card-head">
        <span className="mc-card-name">{(plan.isTeam ? '团队版/' : '个人版/') + plan.name}</span>
        {plan.discount && <span className="mc-card-discount">{plan.discount}</span>}
      </div>
      <div className="mc-card-sub">{plan.subtitle}</div>
      <div className="mc-card-price">
        <span className="mc-card-cny">￥</span>
        <span className="mc-card-num">{plan.price}</span>
        <span className="mc-card-unit">{plan.unit}</span>
        {plan.origin && <span className="mc-card-origin">{plan.origin}</span>}
      </div>
      <div className="mc-card-credits">
        <span className="mc-card-credit-num">{plan.credits}</span>
        <span className="mc-card-credit-unit">{plan.creditUnit}</span>
      </div>
      {plan.quota && <div className="mc-card-quota">{plan.quota}</div>}
      <button
        type="button"
        className="mc-card-buy"
        disabled={buying || disabled}
        title={disabled ? disabledReason : undefined}
        onClick={() => onBuy(plan)}
      >
        {buying ? '处理中…' : disabled ? disabledText || '暂不可购买' : purchased ? '续费' : '立即开通'}
      </button>
      <div className="mc-card-divider" />
      <ul className="mc-card-feats">
        {plan.features.map((f, i) => (
          <li key={i} className={f.ok ? '' : 'is-off'}>
            <Check ok={f.ok} />
            <span>{f.text}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** 后端积分包结构（已完成响应解包）。 */
interface ApiPackage {
  id: number
  code?: string
  name: string
  amount_cents: number
  credits: number
  status?: string
}
/** 积分充值卡片使用的归一化视图模型。 */
interface PackageVM {
  id: number
  name: string
  subtitle: string
  credits: string
  price: string
  rate: string
}
/** 将后端积分包转换为价格、积分和兑换率展示模型。 */
function toPkgVM(p: ApiPackage): PackageVM {
  const credits = Number(p.credits ?? 0)
  const rate = credits > 0 ? `1积分≈${(Number(p.amount_cents || 0) / 100 / credits).toFixed(2)}元` : ''
  return {
    id: Number(p.id),
    name: p.name || '积分包',
    subtitle: '一次性充值,积分永久有效',
    credits: String(credits),
    price: yuan(p.amount_cents),
    rate,
  }
}

/** 积分充值卡复用套餐卡的视觉，并把购买动作交给会员中心统一处理。 */
function PackageCard({ pkg, buying, onBuy }: { pkg: PackageVM; buying: boolean; onBuy: (p: PackageVM) => void }) {
  return (
    <div className="mc-card">
      <div className="mc-card-name">{pkg.name}</div>
      <div className="mc-card-sub">{pkg.subtitle}</div>
      <div className="mc-card-price">
        <span className="mc-card-cny">￥</span>
        <span className="mc-card-num">{pkg.price}</span>
      </div>
      <div className="mc-card-credits">
        <span className="mc-card-credit-num">{pkg.credits}</span>
        <span className="mc-card-credit-unit">积分</span>
      </div>
      <button type="button" className="mc-card-buy" disabled={buying} onClick={() => onBuy(pkg)}>
        {buying ? '处理中…' : '立即充值'}
      </button>
    </div>
  )
}

/** 会员中心的开关、关闭回调与内嵌页面模式。 */
interface MemberCenterModalProps {
  open: boolean
  onClose: () => void
  /** 页面模式:不渲染遮罩/portal,内容内联交由外层页面承载;onClose 用于「完成」后返回 */
  embedded?: boolean
}

/**
 * 加载套餐、订阅、钱包和订单，协调个人/团队购买、支付跳转、订单补偿及购买后空间切换。
 */
export default function MemberCenterModal({ open, onClose, embedded = false }: MemberCenterModalProps) {
  const { showToast } = useToast()
  const { requestConfirm } = useConfirmDialog()
  const switchWorkspaceSafely = useSafeWorkspaceSwitch()
  const workspaceSwitchLocked = useUiStore((state) => state.workspaceSwitchLocked)
  const workspaceId = Number(useWorkspaceId() || 0)
  // 仅主账号可充值:团队空间里只有所有者能充值,子账号不允许;个人空间是自己的,可充值。
  const currentWs = useCurrentWorkspace()
  const currentUser = useCurrentUser()
  const currentMember = useCurrentMember()
  const paymentUserScope = getMemberCenterPaymentUserScope(currentUser)
  const isTeamWs = Boolean(currentWs?.type) && String(currentWs.type).toLowerCase() !== 'personal'
  const isOwner =
    (Boolean(paymentUserScope) &&
      String(currentWs?.owner_user_id ?? currentWs?.ownerUserId ?? '').trim() === paymentUserScope) ||
    String(currentMember?.role || '').toLowerCase() === 'owner'
  const canRecharge = !isTeamWs || isOwner
  // 新开团队空间的默认团队名(intent=new_team 必须带名字随下单建空间);默认「XX的团队」。
  // 用户在【充值/开通前】就把团队名输入好(见团队版 tab 的团队名输入框),随下单直接建好空间,不再支付后二次命名。
  const defaultTeamName = `${String(currentUser?.nickname || currentUser?.name || currentUser?.username || '我').trim()}的团队`
  // 顶层 tab:基础版(个人套餐)/ 团队版(团队套餐)/ 积分充值
  const [mainTab, setMainTab] = useState<'basic' | 'team' | 'recharge'>('basic')
  // 名下已有团队名(去空格、忽略大小写),用于给「下单默认名」去重,避免后端因重名建不出空间。
  const allWorkspaces = useAllWorkspaces()
  const existingTeamNames = useMemo(
    () =>
      new Set(
        (allWorkspaces as any[])
          .filter((w) => Boolean(w?.type) && String(w.type).toLowerCase() !== 'personal')
          .map((w) =>
            String(w?.name || '')
              .trim()
              .toLowerCase(),
          )
          .filter(Boolean),
      ),
    [allWorkspaces],
  )
  // 下单用的唯一默认名:「XX的团队」被占用则追加序号,防止 new_team 因重名建不出空间。
  const uniqueDefaultTeamName = useMemo(() => {
    if (!existingTeamNames.has(defaultTeamName.toLowerCase())) return defaultTeamName
    for (let i = 2; i < 100; i++) {
      const cand = `${defaultTeamName}${i}`
      if (!existingTeamNames.has(cand.toLowerCase())) return cand
    }
    return `${defaultTeamName}-${Date.now().toString(36)}`
  }, [defaultTeamName, existingTeamNames])
  // 支付成功后「创建团队并命名」弹框:被命名的团队 id(0=关闭)、输入名、提交中(现改为下单前命名,此弹框保留兜底,一般不触发)
  const [namePromptTeamId, setNamePromptTeamId] = useState(0)
  const [teamNameInput, setTeamNameInput] = useState('')
  const [renamingTeam, setRenamingTeam] = useState(false)
  // 子账号(不可充值)若正停在积分充值 tab(如切空间后)→ 退回基础版,避免看到充值内容
  useEffect(() => {
    if (!canRecharge && mainTab === 'recharge') setMainTab('basic')
  }, [canRecharge, mainTab])
  const [plans, setPlans] = useState<PlanVM[]>([])
  const [packages, setPackages] = useState<PackageVM[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [balance, setBalance] = useState<number | null>(null)
  const [subscription, setSubscription] = useState<any>(null)
  const [subscriptionLoading, setSubscriptionLoading] = useState(false)
  const [subActionLoading, setSubActionLoading] = useState(false)
  const [renewing, setRenewing] = useState(false)
  const [buyingId, setBuyingId] = useState(0)
  // 极少数情况下「同步开窗」仍被浏览器拦截:存下 pay_url,在弹窗内给一个手动打开入口兜底。
  const [pendingPayUrl, setPendingPayUrl] = useState('')
  // 组件存活标记:订单轮询是异步长任务,卸载后不再 setState / 不再继续轮询
  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])
  // 未支付订单复用缓存:key(sub:planId / recharge:pkgId)→ 上次下单的 {订单id, pay_url, 时间戳}。
  // 「扫码没付→再点支付」时,若该单仍 pending 就复用原链接,避免重复下单留下一堆 pending 单。
  const pendingOrderRef = useRef<
    Record<
      string,
      {
        orderId: number
        payUrl: string
        ts: number
        newWorkspaceId?: number
        workspaceBaselineIds?: number[]
      }
    >
  >({})
  const resolvingOrderRef = useRef<Record<string, Promise<any>>>({})
  const watchedOrderIdsRef = useRef<Map<number, symbol>>(new Map())
  const paymentActionLockRef = useRef(false)
  const paymentActionOwnerRef = useRef(0)
  const paymentActionSequenceRef = useRef(0)
  const paymentScopeEpochRef = useRef(0)
  const paymentScopeKey = `${paymentUserScope || 'anonymous'}:ws${workspaceId}`
  const paymentScopeKeyRef = useRef(paymentScopeKey)

  const isPaymentScopeCurrent = (userId: string, scopeWorkspaceId: number, scopeEpoch: number): boolean => {
    if (!aliveRef.current || paymentScopeEpochRef.current !== scopeEpoch) return false
    const state = useWorkspaceSessionStore.getState()
    return isSameMemberCenterPaymentScope(
      { userId, workspaceId: scopeWorkspaceId },
      {
        userId: getMemberCenterPaymentUserScope(state.authSession?.user),
        workspaceId: deriveWorkspaceId(state),
      },
    )
  }

  const acquirePaymentAction = (): number => {
    if (!tryAcquireMemberCenterPayment(paymentActionLockRef)) return 0
    const ownerToken = ++paymentActionSequenceRef.current
    paymentActionOwnerRef.current = ownerToken
    return ownerToken
  }

  const releasePaymentAction = (ownerToken: number): boolean => {
    if (!ownerToken || paymentActionOwnerRef.current !== ownerToken) return false
    paymentActionOwnerRef.current = 0
    releaseMemberCenterPayment(paymentActionLockRef)
    return true
  }

  useEffect(() => {
    if (paymentScopeKeyRef.current === paymentScopeKey) return
    paymentScopeKeyRef.current = paymentScopeKey
    paymentScopeEpochRef.current += 1
    pendingOrderRef.current = {}
    resolvingOrderRef.current = {}
    watchedOrderIdsRef.current.clear()
    paymentActionOwnerRef.current = 0
    paymentActionLockRef.current = false
    setPendingPayUrl('')
    setBuyingId(0)
    setRenewing(false)
  }, [paymentScopeKey])

  // Esc 关闭(仅弹窗模式;页面模式不拦 Esc)
  useEffect(() => {
    if (!open || embedded) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, embedded, onClose])

  // 打开时拉取套餐 + 当前积分余额
  useEffect(() => {
    if (!open) return
    let alive = true
    setMainTab('basic')
    setLoading(true)
    setError('')
    setSubscription(null)
    setSubscriptionLoading(Boolean(workspaceId))
    listBillingPlans()
      .then((list: any) => {
        if (!alive) return
        const vms = (Array.isArray(list) ? list : []).map(toVM)
        setPlans(vms)
      })
      .catch((e: any) => alive && setError(getBusinessErrorMessage(e, '套餐加载失败,请稍后重试')))
      .finally(() => alive && setLoading(false))

    // 积分包(充值)
    listCreditPackages()
      .then((list: any) => alive && setPackages((Array.isArray(list) ? list : []).map(toPkgVM)))
      .catch(() => alive && setPackages([]))

    if (workspaceId) {
      getWallet(workspaceId)
        .then((w: any) => alive && setBalance(Number(w?.available ?? w?.balance ?? 0)))
        .catch(() => alive && setBalance(null))
      // 当前订阅(套餐 / 席位 / 并发);未订阅返回 active:false
      getSubscription(workspaceId)
        .then((s: any) => alive && setSubscription(s))
        .catch((e: any) => {
          if (!alive) return
          setSubscription(null)
          setError(getBusinessErrorMessage(e, '会员状态加载失败，请刷新后重试'))
        })
        .finally(() => alive && setSubscriptionLoading(false))
    } else {
      setBalance(null)
      setSubscription(null)
      setSubscriptionLoading(false)
    }
    return () => {
      alive = false
    }
  }, [open, workspaceId])

  const expiredBanner = useMemo(() => {
    if (!subscription) return false
    const expMs = expiryTimeMs(subscription)
    if (!expMs) return false
    const hasBought = Boolean(
      subscription.plan_id || subscription.planId || subscription.plan_code || subscription.plan_name,
    )
    if (!hasBought) return false
    return expMs <= Date.now()
  }, [subscription])

  // 基础版 = 非团队套餐;团队版 = 团队套餐
  const visible = mainTab === 'team' ? plans.filter((p) => p.isTeam) : plans.filter((p) => !p.isTeam)

  const subscriptionPlanType = String(subscription?.plan_type ?? subscription?.planType ?? '').toLowerCase()
  const subscriptionIsTeam = subscriptionPlanType
    ? subscriptionPlanType === 'team'
    : Number(subscription?.max_members || 0) > 1 ||
      /团队|team/i.test(`${subscription?.plan_name || ''} ${subscription?.plan_code || ''}`)
  const subscriptionExpiryMs = expiryTimeMs(subscription)
  const hasActiveSubscription =
    Boolean(subscription?.active) && (!subscriptionExpiryMs || subscriptionExpiryMs > Date.now())
  const currentPlan = (() => {
    if (!hasActiveSubscription) return null
    const planId = Number(subscription?.plan_id ?? subscription?.planId ?? 0) || 0
    if (planId) {
      const matchedById = plans.find((plan) => plan.id === planId)
      if (matchedById) return matchedById
    }
    const planCode = String(subscription?.plan_code || '').trim()
    if (planCode) {
      const matchedByCode = plans.find((plan) => plan.code === planCode)
      if (matchedByCode) return matchedByCode
    }
    const planName = String(subscription?.plan_name || '').trim()
    if (!planName) return null
    return plans.find((plan) => plan.name === planName && plan.isTeam === subscriptionIsTeam) || null
  })()

  // 该套餐是否为当前已生效订阅(用于把「立即开通」显示为「续费」)
  // 该套餐是否为当前已生效订阅(决定按钮显示「续费」还是「立即开通」)。
  // ① 优先用唯一 plan_id 精确匹配;② 后端没返回 plan_id 时,退回 code/name 匹配,
  //    但必须叠加「团队/个人类型一致」—— 否则团队版与个人版同周期套餐重名(如都叫「年度会员」)会串台误判。
  const isPurchased = (p: PlanVM) => {
    if (!subscription?.active) return false
    const subPlanId = Number(subscription.plan_id ?? subscription.planId ?? 0) || 0
    if (subPlanId) return subPlanId === p.id
    const codeOrNameHit =
      (!!subscription.plan_code && subscription.plan_code === p.code) ||
      (!!subscription.plan_name && subscription.plan_name === p.name)
    if (!codeOrNameHit) return false
    const t = String(subscription.plan_type ?? subscription.planType ?? '').toLowerCase()
    const subIsTeam = t ? t === 'team' : Number(subscription.max_members) > 1
    return subIsTeam === p.isTeam
  }

  const getPlanPurchaseRestriction = (p: PlanVM) => {
    // 团队套餐卡片创建的是独立新空间，不属于当前团队的升降级链路。
    if (p.isTeam) return { disabled: false, text: '', reason: '' }
    if (subscriptionLoading) {
      return {
        disabled: true,
        text: '套餐状态加载中…',
        reason: '正在确认当前套餐，请稍后再试',
      }
    }
    if (!hasActiveSubscription || subscriptionIsTeam !== p.isTeam || isPurchased(p)) {
      return { disabled: false, text: '', reason: '' }
    }
    if (!currentPlan) {
      return {
        disabled: true,
        text: '暂不可购买',
        reason: '未能识别当前套餐价格，请刷新会员中心后重试',
      }
    }
    if (p.priceCents >= currentPlan.priceCents) {
      return { disabled: false, text: '', reason: '' }
    }
    const expiry = formatExpiry(subscription)
    return {
      disabled: true,
      text: '到期后可购买',
      reason: `当前${p.isTeam ? '团队版' : '个人版'}套餐${expiry ? `有效期至 ${expiry}，` : ''}到期前不能购买更低价格的套餐`,
    }
  }

  // 从下单返回里取订单 id(字段名后端不统一,做兜底)
  const orderIdOf = (res: any): number =>
    Number(
      res?.order?.id ?? res?.order?.order_id ?? res?.order_id ?? res?.id ?? res?.data?.order?.id ?? res?.data?.id ?? 0,
    ) || 0

  // 从 new_team 下单返回里取新建 workspace id(多字段兜底)
  const newWorkspaceIdOf = (res: any): number =>
    Number(
      res?.new_workspace_id ??
        res?.workspace_id ??
        res?.workspace?.id ??
        res?.order?.workspace_id ??
        res?.order?.new_workspace_id ??
        res?.data?.workspace_id ??
        res?.data?.new_workspace_id ??
        0,
    ) || 0

  // 查某订单是否仍「待支付(pending)」——复用前确认,已付/取消/过期则不复用。
  const getOrderStatus = async (orderId: number, workspaceIds: number[] = []): Promise<string> => {
    if (!orderId) return ''
    const liveWorkspaceIds = (deriveAllWorkspaces(useWorkspaceSessionStore.getState()) as any[]).map((item: any) =>
      Math.floor(Number(item?.id || 0)),
    )
    const candidates = [
      ...new Set(
        [...workspaceIds, ...liveWorkspaceIds, Number(workspaceId || 0)]
          .map((id) => Math.floor(Number(id) || 0))
          .filter((id) => id > 0),
      ),
    ]
    for (const workspaceIdCandidate of candidates) {
      try {
        const rows: any = await listPaymentOrders({ workspaceId: workspaceIdCandidate, limit: 50 })
        const list: any[] = Array.isArray(rows) ? rows : rows?.items || rows?.list || rows?.orders || []
        const status = String(list.find((r: any) => Number(r?.id) === orderId)?.status || '')
        if (status) return status
      } catch {
        // 某个空间暂时不可查时继续尝试其他候选空间。
      }
    }
    return ''
  }

  // 复用未支付订单:同 key 上次的单若在 10 分钟内且仍 pending → 复用原 pay_url,不重复下单;否则新下一单并缓存。
  const REUSE_ORDER_MS = 10 * 60 * 1000
  const resolveOrder = (
    key: string,
    createFn: () => Promise<any>,
    options: { workspaceBaselineIds?: number[]; reuseWhenStatusUnknown?: boolean } = {},
  ): Promise<{ payUrl: string; orderId: number; newWorkspaceId: number; workspaceBaselineIds: number[] }> => {
    const scopeUserId = paymentUserScope
    const scopeWorkspaceId = workspaceId
    const scopeEpoch = paymentScopeEpochRef.current
    const assertScopeCurrent = () => {
      if (!isPaymentScopeCurrent(scopeUserId, scopeWorkspaceId, scopeEpoch)) {
        throw new Error('支付会话已切换')
      }
    }
    const scopedKey = `${paymentScopeKey}:epoch${scopeEpoch}:${key}`
    const inflight = resolvingOrderRef.current[scopedKey]
    if (inflight) return inflight
    const pending = (async () => {
      assertScopeCurrent()
      const cached = pendingOrderRef.current[scopedKey]
      if (cached?.payUrl && Date.now() - cached.ts < REUSE_ORDER_MS) {
        const cachedWorkspaceIds = [Number(cached.newWorkspaceId || 0), ...(cached.workspaceBaselineIds || [])].filter(
          (id) => id > 0,
        )
        const status = await getOrderStatus(cached.orderId, cachedWorkspaceIds)
        assertScopeCurrent()
        // new_team 订单可能尚未挂到任何可查询空间。此时宁可复用原支付链接，
        // 也不能用新的幂等键再下单并创建第二个 activation_pending 团队。
        if (status === 'pending' || (!status && options.reuseWhenStatusUnknown !== false)) {
          return {
            payUrl: cached.payUrl,
            orderId: cached.orderId,
            newWorkspaceId: cached.newWorkspaceId || 0,
            workspaceBaselineIds: cached.workspaceBaselineIds || options.workspaceBaselineIds || [],
          }
        }
      }
      if (cached) delete pendingOrderRef.current[scopedKey] // 旧单已失效,清掉
      assertScopeCurrent()
      const res: any = await createFn()
      assertScopeCurrent()
      const orderId = orderIdOf(res)
      const payUrl = String(res?.pay_url || '')
      const newWorkspaceId = newWorkspaceIdOf(res)
      const workspaceBaselineIds = options.workspaceBaselineIds || []
      if (orderId && payUrl) {
        pendingOrderRef.current[scopedKey] = {
          orderId,
          payUrl,
          ts: Date.now(),
          newWorkspaceId,
          workspaceBaselineIds,
        }
      }
      return { payUrl, orderId, newWorkspaceId, workspaceBaselineIds }
    })()
    resolvingOrderRef.current[scopedKey] = pending
    const clearInflight = () => {
      if (resolvingOrderRef.current[scopedKey] === pending) delete resolvingOrderRef.current[scopedKey]
    }
    void pending.then(clearInflight, clearInflight)
    return pending
  }

  // 团队版支付成功后:适配团队空间。
  // 后端建团队通常是【异步】的,支付 paid 那一刻可能还没建好,故:
  //   ① 优先使用下单返回的 newWorkspaceId 精确定位新空间;
  //   ② 无 newWorkspaceId 时,使用下单前捕获的空间列表,通过 diff 找到新增的团队空间;
  //   ③ 隔几秒重试刷新（最长约 60 秒）;
  //   ④ 超时后只提示稍后刷新。new_team 的唯一创建者必须是后端，前端不能再补建一个重复团队。
  const adoptNewTeamWorkspace = async (
    targetWorkspaceId = 0,
    workspaceBaselineIds: number[] = [],
    orderedTeamName = '',
    isScopeCurrent: () => boolean = () => aliveRef.current,
  ) => {
    const store = useWorkspaceSessionStore
    const beforeIds = new Set(workspaceBaselineIds.map((id) => Math.floor(Number(id) || 0)).filter((id) => id > 0))
    try {
      // 重试加载 workspace 列表（给后端异步建团队留时间）
      for (let i = 0; i < 20; i++) {
        if (!isScopeCurrent()) return null
        await store.getState().loadWorkspaces()
        if (!isScopeCurrent()) return null
        const all = deriveAllWorkspaces(store.getState()) as any[]

        const purchasedTeam = resolvePurchasedTeamWorkspace(all, {
          targetWorkspaceId,
          orderedTeamName,
          workspaceBaselineIds,
        })
        if (purchasedTeam?.id) {
          if (!isScopeCurrent()) return null
          const targetId = Number(purchasedTeam.id)
          if (deriveWorkspaceId(store.getState()) === targetId) return purchasedTeam
          const switched = switchWorkspaceSafely(targetId, { suppressLockedToast: true })
          if (switched) return purchasedTeam
        }

        await new Promise((r) => window.setTimeout(r, 3000))
      }
      if (isScopeCurrent()) {
        showToast('支付已成功，团队空间仍在创建中，请稍后刷新空间列表', 'info')
      }
      if (!isScopeCurrent()) return null
      logger.warn('member_center_team_adoption_delayed', {
        targetWorkspaceId,
        orderedTeamName: orderedTeamName.trim(),
        baselineWorkspaceCount: beforeIds.size,
      })
    } catch (e) {
      if (!isScopeCurrent()) return null
      const diagnostic = createSafeErrorDiagnostic(e)
      if (import.meta.env.DEV) console.warn('[建团队] 识别后端新建团队失败', diagnostic)
      else logger.warn('member_center_team_adoption_failed', diagnostic)
    }
    return null
  }

  const watchOrder = (
    orderId: number,
    kind: 'recharge' | 'subscribe',
    team = false,
    newWorkspaceId = 0,
    workspaceBaselineIds: number[] = [],
    pendingNewTeamIntent?: PendingNewTeamOrderIntent,
    orderedTeamName = '',
  ) => {
    const ws = Number(workspaceId || 0)
    const orderUserScope = paymentUserScope
    const orderScopeEpoch = paymentScopeEpochRef.current
    const isOrderScopeCurrent = () => isPaymentScopeCurrent(orderUserScope, ws, orderScopeEpoch)
    if (!orderId || !orderUserScope || !ws) return
    // new_team 订单:下单时未关联当前 workspace,轮询需用新空间的 id;若后端未返回,
    // 回退到当前 ws(至少 reconcile 能工作),同时额外尝试不按 workspace 过滤的兜底。
    let resolvedTeamWorkspaceId = team && newWorkspaceId > 0 ? newWorkspaceId : 0
    if (!ws && !resolvedTeamWorkspaceId) return
    const watchToken = tryTrackMemberCenterOrder(watchedOrderIdsRef.current, orderId)
    if (!watchToken) return
    const stopWatching = () => {
      stopTrackingMemberCenterOrder(watchedOrderIdsRef.current, orderId, watchToken)
    }
    // 刷新前已确认支付成功，但后端团队还未出现在空间列表：无需再次查询/对账订单，
    // 直接从持久化的“已支付、待接管”阶段恢复建团识别。
    if (team && pendingNewTeamIntent?.status === 'paid') {
      void adoptNewTeamWorkspace(
        pendingNewTeamIntent.newWorkspaceId || newWorkspaceId,
        pendingNewTeamIntent.workspaceBaselineIds || workspaceBaselineIds,
        pendingNewTeamIntent.teamName || orderedTeamName,
        isOrderScopeCurrent,
      )
        .then((purchasedTeam) => {
          if (purchasedTeam) {
            clearPendingNewTeamOrder(pendingNewTeamIntent.userId, pendingNewTeamIntent.planId)
          }
        })
        .finally(stopWatching)
      return
    }
    let tries = 0
    const FAST_POLL_LIMIT = 40
    const orderWatchDeadline = Date.now() + REUSE_ORDER_MS
    const tick = async () => {
      if (!isOrderScopeCurrent()) {
        stopWatching()
        return
      }
      tries += 1
      try {
        if (team && !resolvedTeamWorkspaceId) {
          try {
            await useWorkspaceSessionStore.getState().loadWorkspaces()
            if (!isOrderScopeCurrent()) {
              stopWatching()
              return
            }
            const all = deriveAllWorkspaces(useWorkspaceSessionStore.getState()) as any[]
            const purchasedTeam = resolvePurchasedTeamWorkspace(all, {
              orderedTeamName,
              workspaceBaselineIds,
            })
            resolvedTeamWorkspaceId = Number(purchasedTeam?.id || 0) || 0
          } catch {
            /* 空间同步延迟不阻断订单轮询 */
          }
        }
        const pollWs = resolvedTeamWorkspaceId || ws
        // 先主动对账:只【催后端】去支付宝核对并更新本单(不读它的返回状态——避免 reconcile 的状态字典
        // 与列表口径不一致导致误判);再用列表读【权威状态】('paid' 口径与原逻辑一致)。
        // 对账用当前 ws(写操作);列表查询用 pollWs(读新空间关联的订单)。
        try {
          await reconcilePaymentOrder({ workspaceId: ws || pollWs, orderId })
        } catch {
          /* 未支付/限流等 → 忽略,继续用列表查 */
        }
        if (!isOrderScopeCurrent()) {
          stopWatching()
          return
        }
        const st = await getOrderStatus(orderId, [
          pollWs,
          resolvedTeamWorkspaceId,
          newWorkspaceId,
          ...workspaceBaselineIds,
        ])
        if (!isOrderScopeCurrent()) {
          stopWatching()
          return
        }

        const normalizedStatus = st.toLowerCase()
        const isTerminalStatus = ['paid', 'failed', 'canceled', 'cancelled', 'expired', 'closed'].includes(
          normalizedStatus,
        )
        if (isTerminalStatus) {
          stopWatching()
          // 终态:清掉该订单的复用缓存,下次点支付重新下单
          for (const k of Object.keys(pendingOrderRef.current)) {
            if (pendingOrderRef.current[k]?.orderId === orderId) delete pendingOrderRef.current[k]
          }
          // new_team 的 paid 只代表支付阶段完成，空间接管成功之前必须保留恢复意图。
          if (pendingNewTeamIntent && normalizedStatus !== 'paid') {
            clearPendingNewTeamOrder(pendingNewTeamIntent.userId, pendingNewTeamIntent.planId)
          }
        }
        if (normalizedStatus === 'paid') {
          if (!isOrderScopeCurrent()) {
            stopWatching()
            return
          }
          // 支付成功 → 装填智能成片引导(仅该用户【首次支付】装填一次,续费/再买不再触发),
          // 下次进 /smart 入口页触发跟随流程引导。
          armSmartGuide(orderUserScope)
          showToast(kind === 'recharge' ? '充值成功,积分已到账' : '支付成功,会员已开通', 'success')
          getWallet(ws)
            .then((w: any) => isOrderScopeCurrent() && setBalance(Number(w?.available ?? w?.balance ?? 0)))
            .catch(() => {})
          getSubscription(ws)
            .then((s: any) => isOrderScopeCurrent() && setSubscription(s))
            .catch(() => {})
          // 同步刷新全局 store(顶栏/个人面板的会员套餐 + 积分进度据此显示):
          // 否则关掉弹窗回到页面看不到刚开通/续费的会员、刚充的积分(弹窗 setSubscription 只更新弹窗局部)。
          // 团队版新开走 adoptNewTeamWorkspace 切空间会再刷一次,此处对老空间刷一次也无害。
          void useWorkspaceSessionStore.getState().loadSubscriptionLabel({ force: true })
          // 买的是团队版:团队名已在下单前填好并随单创建 → 这里只把新团队空间适配/切换过去,不再二次弹命名框。
          if (kind === 'subscribe' && team) {
            const paidIntent = pendingNewTeamIntent
              ? {
                  ...pendingNewTeamIntent,
                  status: 'paid' as const,
                  updatedAt: Date.now(),
                  newWorkspaceId: resolvedTeamWorkspaceId || newWorkspaceId || pendingNewTeamIntent.newWorkspaceId,
                }
              : undefined
            if (paidIntent) savePendingNewTeamOrder(paidIntent)
            const purchasedTeam = await adoptNewTeamWorkspace(
              resolvedTeamWorkspaceId || newWorkspaceId,
              workspaceBaselineIds,
              orderedTeamName,
              isOrderScopeCurrent,
            )
            if (purchasedTeam && paidIntent) {
              clearPendingNewTeamOrder(paidIntent.userId, paidIntent.planId)
            }
          }
          return
        }
        if (['failed', 'canceled', 'cancelled', 'expired', 'closed'].includes(normalizedStatus)) {
          const canceled = ['canceled', 'cancelled', 'expired', 'closed'].includes(normalizedStatus)
          if (isOrderScopeCurrent()) showToast(canceled ? '支付已取消' : '支付失败,请重试', 'error')
          return
        }
      } catch {
        if (!isOrderScopeCurrent()) {
          stopWatching()
          return
        }
        /* 查询失败忽略,继续轮询 */
      }
      if (isOrderScopeCurrent() && Date.now() < orderWatchDeadline) {
        // 前两分钟保持快速反馈；之后降频但继续监听到支付链接的复用期结束。
        window.setTimeout(tick, tries < FAST_POLL_LIMIT ? 3000 : 15_000)
      } else {
        stopWatching()
      }
    }
    window.setTimeout(tick, 3000)
  }

  // MemberCenterModal 常驻 AppShell。刷新页面后自动恢复所有属于当前账号的 new_team
  // 订单监听；旧空间、新空间 id 以及下单时的 workspace 基线都会参与候选查询。
  useEffect(() => {
    if (!paymentUserScope || !workspaceId) return
    const intents = loadPendingNewTeamOrders(paymentUserScope)
    for (const intent of intents) {
      if (!intent.orderId) continue
      watchOrder(
        intent.orderId,
        'subscribe',
        true,
        intent.newWorkspaceId || 0,
        intent.workspaceBaselineIds,
        intent,
        intent.teamName,
      )
    }
    // watchOrder 使用当前支付 scope，并由 watchedOrderIdsRef 保证同一订单只启动一个监听。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentScopeKey, paymentUserScope, workspaceId, workspaceSwitchLocked])

  // 支付下单 + 打开支付宝支付页的统一流程。
  // 关键:window.open 必须在「点击手势的同步阶段」调用,否则下单 await 之后再开窗会被浏览器判定为
  // 非用户触发而拦截(这正是「有人能开、有人不能开」的根因)。所以这里先同步打开一个空白标签页,
  // 等下单接口返回 pay_url 后再把该标签页 location 替换为支付地址。
  //   - 不能带 noopener:带了部分浏览器会返回 null 句柄,后续无法改 location;改为手动断开 win.opener 兜安全。
  //   - 极少数环境(如装了拦截插件)连同步开窗都失败 → 存下 pay_url,在弹窗内显示「手动打开」按钮兜底。
  const startPay = async (
    createOrder: () => Promise<{
      payUrl: string
      orderId: number
      newWorkspaceId?: number
      workspaceBaselineIds?: number[]
    }>,
    failMsg: string,
    kind: 'recharge' | 'subscribe',
    team = false, // 团队版订阅:支付成功后要刷新空间列表并切到后端新建的团队空间
    pendingNewTeamIntent?: PendingNewTeamOrderIntent,
    orderedTeamName = '',
  ) => {
    const startedUserScope = paymentUserScope
    const startedWorkspaceId = workspaceId
    const startedScopeEpoch = paymentScopeEpochRef.current
    const isStartedScopeCurrent = () => isPaymentScopeCurrent(startedUserScope, startedWorkspaceId, startedScopeEpoch)
    if (!isStartedScopeCurrent()) return
    setPendingPayUrl('')
    // ① 与点击同步开空白页(此刻一定还在用户手势上下文里)
    const win = window.open('about:blank', '_blank')
    if (win) win.opener = null // 安全:断开对本页的引用,等价 noopener
    try {
      const { payUrl, orderId, newWorkspaceId = 0, workspaceBaselineIds = [] } = await createOrder()
      if (!isStartedScopeCurrent()) {
        win?.close()
        return
      }
      if (!payUrl) {
        win?.close()
        showToast('未获取到支付链接,请稍后重试', 'error')
        return
      }
      if (win) {
        // ② 拿到地址后替换跳转目标
        win.location.href = payUrl
        showToast('已打开支付宝支付页面,完成支付后可刷新查看', 'info')
      } else {
        // ③ 同步开窗都被拦截:给手动入口,不让用户卡死
        setPendingPayUrl(payUrl)
        showToast('支付页面被浏览器拦截,请点击下方「手动打开支付页」', 'error')
      }
      const trackedNewTeamIntent = bindPendingNewTeamOrder(pendingNewTeamIntent, orderId, newWorkspaceId)
      if (trackedNewTeamIntent) savePendingNewTeamOrder(trackedNewTeamIntent)
      // ④ 附加:轮询订单状态,出「成功/失败」结果并刷新余额/订阅(不影响上面的下单/开窗)
      watchOrder(orderId, kind, team, newWorkspaceId, workspaceBaselineIds, trackedNewTeamIntent, orderedTeamName)
    } catch (e) {
      win?.close()
      if (isStartedScopeCurrent()) showToast(getBusinessErrorMessage(e, failMsg), 'error')
    }
  }

  // 会员开通 / 续费:统一走 subscription-orders 下单,取一次性付款 pay_url 直接跳支付宝。
  const onBuy = async (p: PlanVM) => {
    if (buyingId || paymentActionLockRef.current) return
    if (!workspaceId) {
      showToast('缺少 workspace,无法开通', 'error')
      return
    }
    const restriction = getPlanPurchaseRestriction(p)
    if (restriction.disabled) {
      showToast(restriction.reason, 'info')
      return
    }
    const renew = isPurchased(p)
    // A方案:团队套餐一律「开新团队」——每买一次就新开一个团队(空间:套餐 1:1),同一套餐可反复买、各用于新团队。
    // 续费某个已有团队走订阅信息区的「续费当前团队」按钮(intent=subscribe);个人版维持 开通/续费。
    const newTeam = p.isTeam
    const intent = newTeam ? 'new_team' : 'subscribe'
    const restoredNewTeamIntent = newTeam && paymentUserScope ? loadPendingNewTeamOrder(paymentUserScope, p.id) : null
    // new_team:随单建团队空间。团队名不在会员中心输入,统一用唯一默认名,并做校验/去重,避免后端因非法/重名建不出空间。
    let nwsName = restoredNewTeamIntent?.teamName || ''
    if (newTeam) {
      if (!nwsName) nwsName = uniqueDefaultTeamName
      let nameErr = validateWorkspaceName(nwsName)
      if (nameErr) {
        const trimmed = String(nwsName).trim()
        nwsName = (trimmed.length > WORKSPACE_NAME_MAX ? trimmed.slice(0, WORKSPACE_NAME_MAX) : trimmed) || '我的团队'
        nameErr = validateWorkspaceName(nwsName)
      }
      if (nameErr) {
        showToast(nameErr, 'error')
        return
      }
      if (!restoredNewTeamIntent && existingTeamNames.has(nwsName.toLowerCase())) {
        for (let i = 2; i < 100; i++) {
          const cand = `${nwsName}${i}`
          if (!existingTeamNames.has(cand.toLowerCase())) {
            nwsName = cand
            break
          }
        }
      }
    }
    // 必须在 new_team 下单前捕获基线。后端会在下单时创建 activation_pending 空间；
    // 若支付后才取列表，新空间已经在基线里，diff 永远无法识别。
    const workspaceBaselineIds = newTeam
      ? restoredNewTeamIntent?.workspaceBaselineIds ||
        (deriveAllWorkspaces(useWorkspaceSessionStore.getState()) as any[])
          .map((item: any) => Math.floor(Number(item?.id || 0)))
          .filter((id: number) => id > 0)
      : []
    // 幂等键:后端要求简单字母数字串(示例 a1b2c3),不能带冒号/中文 → 用随机 base36 token
    const idemKey =
      restoredNewTeamIntent?.idempotencyKey ||
      `${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`
    const pendingNewTeamIntent: PendingNewTeamOrderIntent | undefined =
      newTeam && paymentUserScope
        ? {
            userId: paymentUserScope,
            planId: p.id,
            teamName: nwsName,
            idempotencyKey: idemKey,
            createdAt: restoredNewTeamIntent?.createdAt || Date.now(),
            workspaceBaselineIds,
            ...(restoredNewTeamIntent?.orderId ? { orderId: restoredNewTeamIntent.orderId } : {}),
            ...(restoredNewTeamIntent?.newWorkspaceId ? { newWorkspaceId: restoredNewTeamIntent.newWorkspaceId } : {}),
            status: restoredNewTeamIntent?.status || 'pending',
            ...(restoredNewTeamIntent?.updatedAt ? { updatedAt: restoredNewTeamIntent.updatedAt } : {}),
          }
        : undefined
    if (pendingNewTeamIntent?.status === 'paid' && pendingNewTeamIntent.orderId) {
      watchOrder(
        pendingNewTeamIntent.orderId,
        'subscribe',
        true,
        pendingNewTeamIntent.newWorkspaceId || 0,
        workspaceBaselineIds,
        pendingNewTeamIntent,
        nwsName,
      )
      showToast('支付已完成，正在同步团队空间', 'info')
      return
    }
    const paymentActionToken = acquirePaymentAction()
    if (!paymentActionToken) return
    setBuyingId(p.id)
    try {
      if (pendingNewTeamIntent) savePendingNewTeamOrder(pendingNewTeamIntent)
      // 开通与续费用同一个接口:POST /api/v1/billing/subscription-orders;未支付单 10 分钟内复用,不重复下单
      await startPay(
        () =>
          resolveOrder(
            `sub:${intent}:${p.id}`,
            async () => {
              const response = await createSubscriptionOrder({
                workspaceId,
                planId: p.id,
                intent,
                newWorkspaceName: nwsName,
                idempotencyKey: idemKey,
              })
              if (pendingNewTeamIntent) {
                savePendingNewTeamOrder({
                  ...pendingNewTeamIntent,
                  orderId: orderIdOf(response),
                  newWorkspaceId: newWorkspaceIdOf(response),
                })
              }
              return response
            },
            {
              workspaceBaselineIds,
              // 状态查询短暂失败时复用同一支付链接，避免产生两个都可支付的订单。
              reuseWhenStatusUnknown: true,
            },
          ),
        !newTeam && renew ? '续费失败,请稍后重试' : '开通失败,请稍后重试',
        'subscribe',
        newTeam, // 开新团队空间:支付成功后刷新空间列表并切到后端新建的团队空间
        pendingNewTeamIntent,
        nwsName,
      )
    } finally {
      if (releasePaymentAction(paymentActionToken)) setBuyingId(0)
    }
  }

  // 积分充值:取一次性付款 pay_url 直接跳支付宝。
  const onRecharge = async (pkg: PackageVM) => {
    if (buyingId || paymentActionLockRef.current) return
    if (!canRecharge) {
      showToast('仅主账号可充值,子账号请联系主账号', 'error')
      return
    }
    if (!workspaceId) {
      showToast('缺少 workspace,无法充值', 'error')
      return
    }
    const paymentActionToken = acquirePaymentAction()
    if (!paymentActionToken) return
    setBuyingId(pkg.id)
    try {
      await startPay(
        () => resolveOrder(`recharge:${pkg.id}`, () => createRechargeOrder({ workspaceId, creditPackageId: pkg.id })),
        '充值失败,请稍后重试',
        'recharge',
      )
    } finally {
      if (releasePaymentAction(paymentActionToken)) setBuyingId(0)
    }
  }

  // 「创建团队并命名」弹框提交:把刚开通的团队空间改成用户填的名字(updateWorkspace),刷新列表。
  const submitTeamName = async () => {
    const id = Number(namePromptTeamId || 0)
    const name = teamNameInput.trim()
    if (!id || renamingTeam) return
    if (!name) {
      showToast('请输入团队名称', 'error')
      return
    }
    setRenamingTeam(true)
    try {
      // renameTeam:updateWorkspace 改名 + 刷新空间列表(侧栏/顶栏/弹窗同步新名)
      await useWorkspaceSessionStore.getState().renameTeam(id, name)
      void useWorkspaceSessionStore.getState().loadSubscriptionLabel({ force: true })
      showToast('团队已创建', 'success')
      setNamePromptTeamId(0)
    } catch (e: any) {
      showToast(getBusinessErrorMessage(e, '团队命名失败,可稍后在团队管理里修改'), 'error')
    } finally {
      setRenamingTeam(false)
    }
  }

  // 订阅管理(仅主账号 canRecharge):关闭自动续费 / 取消订阅。成功后重拉订阅刷新展示。
  const subscriptionId = Number(subscription?.subscription_id || subscription?.id || 0)
  const isAutoRenew = String(subscription?.renew_mode || '')
    .toLowerCase()
    .includes('auto')
  const refreshSubscription = () => {
    const ws = Number(workspaceId || 0)
    if (!ws) return
    getSubscription(ws)
      .then((s: any) => aliveRef.current && setSubscription(s))
      .catch(() => {})
  }
  const handleDisableAutoRenew = async () => {
    if (subActionLoading || !workspaceId || !subscriptionId) return
    const ok = await requestConfirm('确定关闭自动续费吗?关闭后当前订阅到期将不再自动扣款,权益到期结束。')
    if (!ok) return
    setSubActionLoading(true)
    try {
      await disableSubscriptionAutoRenew({ workspaceId, subscriptionId })
      showToast('已关闭自动续费', 'success')
      refreshSubscription()
    } catch (e) {
      showToast(getBusinessErrorMessage(e, '操作失败,请稍后重试'), 'error')
    } finally {
      setSubActionLoading(false)
    }
  }
  const handleCancelSubscription = async () => {
    if (subActionLoading || !workspaceId || !subscriptionId) return
    const ok = await requestConfirm('确定取消当前订阅吗?取消后将不再续费。')
    if (!ok) return
    setSubActionLoading(true)
    try {
      await cancelSubscription({ workspaceId, subscriptionId })
      showToast('已取消订阅', 'success')
      refreshSubscription()
    } catch (e) {
      showToast(getBusinessErrorMessage(e, '取消订阅失败,请稍后重试'), 'error')
    } finally {
      setSubActionLoading(false)
    }
  }

  // A方案:续费【当前所在团队】(团队套餐卡片已改为「开新团队」,续费独立到这)。intent=subscribe,不建新团队。
  const handleRenewCurrentTeam = async () => {
    if (renewing || buyingId || paymentActionLockRef.current || !workspaceId || !subscription?.active) return
    // 定位当前套餐 id:优先订阅自带 plan_id,否则按 code/name 从套餐列表匹配
    let planId = Number(subscription.plan_id ?? subscription.planId ?? 0) || 0
    if (!planId) {
      const matched = plans.find((p) => subscription.plan_code === p.code || subscription.plan_name === p.name)
      planId = Number(matched?.id || 0) || 0
    }
    if (!planId) {
      showToast('未找到当前套餐,无法续费', 'error')
      return
    }
    const idemKey = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`
    const paymentActionToken = acquirePaymentAction()
    if (!paymentActionToken) return
    setRenewing(true)
    try {
      await startPay(
        () =>
          resolveOrder(`sub:subscribe:${planId}:`, () =>
            createSubscriptionOrder({ workspaceId, planId, intent: 'subscribe', idempotencyKey: idemKey }),
          ),
        '续费失败,请稍后重试',
        'subscribe',
        false,
      )
    } finally {
      if (releasePaymentAction(paymentActionToken)) setRenewing(false)
    }
  }

  const shell = (
    <div className={`mcm${embedded ? ' mcm--embedded' : ''}`} role="dialog" aria-label="会员中心">
      {!embedded && (
        <button type="button" className="mcm-close" aria-label="关闭" onClick={onClose}>
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
        </button>
      )}
      <>
        <h2 className="mcm-title">会员中心</h2>
        {balance !== null && <div className="mcm-balance">当前积分余额:{balance}</div>}
        {expiredBanner && <div className="mcm-expired">会员已到期，请续费后继续使用</div>}

        {/* 兜底:同步开窗仍被拦截时,给用户一个可点击的手动支付入口(a 标签由用户点击触发,不会被拦截) */}
        {pendingPayUrl && (
          <div className="mcm-paylink">
            <span>支付页面被浏览器拦截,</span>
            <a href={pendingPayUrl} target="_blank" rel="noopener noreferrer" onClick={() => setPendingPayUrl('')}>
              点此手动打开支付页
            </a>
          </div>
        )}

        {/* 当前订阅信息(套餐 / 席位 / 并发);未订阅不显示 */}
        {subscription?.active && (
          <div className="mcm-sub">
            <span className="mcm-sub-plan">
              {(() => {
                const name = subscription.plan_name || subscription.plan_code || '当前套餐'
                // 判断当前订阅是 团队 还是 个人:优先订阅自带 plan_type,
                // 否则按 plan_code/name 匹配到套餐看 isTeam,再否则按席位>1 兜底
                const matched = plans.find(
                  (p) => subscription.plan_code === p.code || subscription.plan_name === p.name,
                )
                const t = String(
                  subscription.plan_type ??
                    subscription.planType ??
                    (matched ? (matched.isTeam ? 'team' : 'personal') : ''),
                ).toLowerCase()
                const isTeam = t ? t === 'team' : Number(subscription.max_members) > 1
                return `${isTeam ? '团队版/' : '个人版/'}${name}`
              })()}
            </span>
            {Number(subscription.max_members) > 0 && (
              <span className="mcm-sub-item">
                席位 {Number(subscription.current_member_count || 0)}/{Number(subscription.max_members)}
              </span>
            )}
            {Number(subscription.concurrency) > 0 && (
              <span className="mcm-sub-item">并发 {Number(subscription.concurrency)}</span>
            )}
            {Number(subscription.base_credits) > 0 && (
              <span className="mcm-sub-item">赠 {Number(subscription.base_credits)} 积分</span>
            )}
            {(() => {
              const exp = formatExpiry(subscription)
              return exp ? <span className="mcm-sub-item mcm-sub-expiry">{exp}</span> : null
            })()}
            {subscription.renew_mode && (
              <span className="mcm-sub-item">
                {String(subscription.renew_mode).toLowerCase().includes('auto') ? '自动续费' : '手动续费'}
              </span>
            )}
            {/* A方案:续费当前团队(团队套餐卡片改为开新团队后,续费走这里)。仅主账号、当前在团队里显示。 */}
            {canRecharge && isTeamWs && subscriptionId > 0 && (
              <button
                type="button"
                className="mcm-sub-item mcm-sub-action"
                style={{
                  border: 'none',
                  background: 'none',
                  color: '#5767e5',
                  cursor: 'pointer',
                  padding: 0,
                  fontWeight: 600,
                }}
                disabled={renewing}
                onClick={handleRenewCurrentTeam}
              >
                {renewing ? '续费中…' : '续费当前团队'}
              </button>
            )}
            {/* 订阅管理:仅主账号。自动续费时可「关闭自动续费」;有订阅时可「取消订阅」 */}
            {canRecharge && subscriptionId > 0 && isAutoRenew && (
              <button
                type="button"
                className="mcm-sub-item mcm-sub-action"
                style={{ border: 'none', background: 'none', color: '#5767e5', cursor: 'pointer', padding: 0 }}
                disabled={subActionLoading}
                onClick={handleDisableAutoRenew}
              >
                关闭自动续费
              </button>
            )}
            {canRecharge && subscriptionId > 0 && (
              <button
                type="button"
                className="mcm-sub-item mcm-sub-action"
                style={{ border: 'none', background: 'none', color: '#e5574f', cursor: 'pointer', padding: 0 }}
                disabled={subActionLoading}
                onClick={handleCancelSubscription}
              >
                取消订阅
              </button>
            )}
          </div>
        )}

        {/* 顶层:基础版 / 团队版 / 积分充值 */}
        <div className="mcm-tabs">
          <button
            type="button"
            className={`mcm-tab${mainTab === 'basic' ? ' is-active' : ''}`}
            onClick={() => setMainTab('basic')}
          >
            基础版
          </button>
          <button
            type="button"
            className={`mcm-tab${mainTab === 'team' ? ' is-active' : ''}`}
            onClick={() => setMainTab('team')}
          >
            团队版
          </button>
          {/* 积分充值:仅主账号(所有者)可见;子账号(团队成员)不展示,不允许充值 */}
          {canRecharge && (
            <button
              type="button"
              className={`mcm-tab${mainTab === 'recharge' ? ' is-active' : ''}`}
              onClick={() => setMainTab('recharge')}
            >
              积分充值
            </button>
          )}
        </div>

        {mainTab !== 'recharge' ? (
          <>
            {loading ? (
              <div className="mcm-hint">套餐加载中…</div>
            ) : error ? (
              <div className="mcm-hint">{error}</div>
            ) : !visible.length ? (
              <div className="mcm-hint">暂无可开通的套餐</div>
            ) : (
              <div className="mcm-cards">
                {visible.map((p) => {
                  const restriction = getPlanPurchaseRestriction(p)
                  return (
                    <PlanCard
                      key={p.id}
                      plan={p}
                      buying={buyingId === p.id}
                      /* 团队套餐卡片一律「开新团队」,不显示「续费」;续费走订阅信息区的「续费当前团队」 */
                      purchased={!p.isTeam && isPurchased(p)}
                      disabled={restriction.disabled}
                      disabledText={restriction.text}
                      disabledReason={restriction.reason}
                      onBuy={onBuy}
                    />
                  )
                })}
              </div>
            )}
          </>
        ) : loading ? (
          <div className="mcm-hint">积分包加载中…</div>
        ) : !packages.length ? (
          <div className="mcm-hint">暂无可充值的积分包</div>
        ) : (
          <div className="mcm-cards mcm-cards--recharge">
            {packages.map((pkg) => (
              <PackageCard key={pkg.id} pkg={pkg} buying={buyingId === pkg.id} onBuy={onRecharge} />
            ))}
          </div>
        )}
      </>
    </div>
  )

  // 支付成功后的「创建团队并命名」弹框:叠在会员中心之上(portal),命名后 updateWorkspace 改名。
  const namePrompt =
    namePromptTeamId > 0
      ? createPortal(
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 3000,
              background: 'rgba(17,24,39,0.45)',
              display: 'grid',
              placeItems: 'center',
              padding: 16,
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label="创建团队"
              style={{
                width: 'min(380px, 100%)',
                background: '#fff',
                borderRadius: 16,
                boxShadow: '0 24px 70px rgba(0,0,0,0.22)',
                padding: '24px 24px 20px',
                boxSizing: 'border-box',
              }}
            >
              <div style={{ fontSize: 18, fontWeight: 700, color: '#1f2430', marginBottom: 6 }}>创建你的团队</div>
              <div style={{ fontSize: 13, color: '#8a8f9c', lineHeight: 1.6, marginBottom: 16 }}>
                团队版已开通,给团队起个名字,即可邀请成员一起协作。
              </div>
              <input
                autoFocus
                type="text"
                maxLength={20}
                value={teamNameInput}
                placeholder="为你的团队起个名字"
                onChange={(e) => setTeamNameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submitTeamName()
                }}
                style={{
                  width: '100%',
                  height: 42,
                  borderRadius: 10,
                  border: '1px solid rgba(0,0,0,0.12)',
                  padding: '0 12px',
                  fontSize: 14,
                  color: '#1f2430',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 18 }}>
                <button
                  type="button"
                  onClick={() => setNamePromptTeamId(0)}
                  disabled={renamingTeam}
                  style={{
                    flex: 'none',
                    height: 40,
                    padding: '0 14px',
                    borderRadius: 10,
                    border: '1px solid rgba(0,0,0,0.12)',
                    background: '#fff',
                    color: '#6b7280',
                    fontSize: 14,
                    cursor: renamingTeam ? 'not-allowed' : 'pointer',
                  }}
                >
                  以后再说
                </button>
                <button
                  type="button"
                  onClick={() => void submitTeamName()}
                  disabled={renamingTeam || !teamNameInput.trim()}
                  style={{
                    flex: 1,
                    height: 40,
                    borderRadius: 10,
                    border: 0,
                    background: renamingTeam || !teamNameInput.trim() ? '#a9b0ee' : '#5767e5',
                    color: '#fff',
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: renamingTeam || !teamNameInput.trim() ? 'not-allowed' : 'pointer',
                  }}
                >
                  {renamingTeam ? '创建中…' : '创建团队'}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null

  if (!open) return null

  return (
    <>
      {embedded ? (
        shell
      ) : (
        <>
          {createPortal(
            <div className="mcm-mask" onClick={(e) => e.target === e.currentTarget && onClose()}>
              {shell}
            </div>,
            document.body,
          )}
        </>
      )}
      {namePrompt}
    </>
  )
}
