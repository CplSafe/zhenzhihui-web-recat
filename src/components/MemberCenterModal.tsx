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
import {
  useWorkspaceId,
  useWorkspaceSessionStore,
  deriveAllWorkspaces,
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
import './MemberCenterModal.css'

interface Feature {
  text: string
  ok: boolean
}

// 后端 domain.Plan(已由 requestJson 解包 data)
// 设计稿需要的「副标题/划线原价/折扣/生成额度」若后端未返回则降级不显示。
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

// 卡片视图模型
interface PlanVM {
  id: number
  code: string
  name: string
  subtitle: string
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
const FEATURES_TEAM: Feature[] = [
  { text: '云端储存空间', ok: true },
  { text: 'AI智能成片', ok: true },
  { text: '爆款视频复制', ok: true },
  { text: '可创建团队', ok: true },
  { text: '素材库任意用', ok: true },
  { text: '超清 1080P 导出', ok: true },
  { text: '去除品牌水印,商用无忧', ok: true },
]

function yuan(cents: number): string {
  const v = (Number(cents) || 0) / 100
  return Number.isInteger(v) ? String(v) : v.toFixed(2)
}

// 折扣百分比 → 角标文案:80→「8折」、88→「8.8折」、75→「7.5折」。非有效折扣(<=0 或 >=100)返回空串。
function discountLabel(percent: number): string {
  const p = Number(percent) || 0
  if (p <= 0 || p >= 100) return ''
  const d = p / 10
  return `${Number.isInteger(d) ? d : d.toFixed(1)}折`
}

// 订阅到期展示:剩余天数 +「到期日期」。兼容多种字段名;无有效日期则返回空串。
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

function normalizeSlashUnit(raw: any): string {
  const s = String(raw || '').trim()
  if (!s) return ''
  return s.startsWith('/') ? s : `/${s}`
}

function creditUnitFromUnit(unit: string): string {
  const clean = String(unit || '')
    .trim()
    .replace(/^\//, '')
  return clean ? `积分/${clean}` : ''
}

// 周期文案只使用后端返回字段(unit/period_label/period_days/interval_*/period),不再按套餐名/code 猜「7天/季」。
function periodLabel(p: ApiPlan): { unit: string; creditUnit: string } {
  const backendUnit = normalizeSlashUnit(
    p.unit || p.period_label || p.periodLabel || p.display?.unit || p.display?.period_label || p.display?.periodLabel,
  )
  const backendCreditUnit = String(
    p.credit_unit || p.creditUnit || p.display?.credit_unit || p.display?.creditUnit || '',
  ).trim()
  if (backendUnit) return { unit: backendUnit, creditUnit: backendCreditUnit || creditUnitFromUnit(backendUnit) }

  const periodDays =
    Number(p.period_days ?? p.periodDays ?? p.duration_days ?? p.durationDays ?? p.display?.period_days ?? 0) || 0
  if (periodDays > 0) {
    const unit = `/${periodDays}天`
    return { unit, creditUnit: backendCreditUnit || creditUnitFromUnit(unit) }
  }

  const intervalUnit = String(p.interval_unit ?? p.intervalUnit ?? p.display?.interval_unit ?? '').toLowerCase()
  const intervalCount = Number(p.interval_count ?? p.intervalCount ?? p.display?.interval_count ?? 0) || 0
  if (intervalUnit) {
    if (intervalUnit === 'day' && intervalCount > 0) {
      const unit = `/${intervalCount}天`
      return { unit, creditUnit: backendCreditUnit || creditUnitFromUnit(unit) }
    }
    // 周:按后端返回的周数 interval_count 换算真实天数(1周=7天),不再写死「7天」。
    // 后端没给周数(interval_count 缺失/0)时按 1 周算,仍是 7 天。
    if (intervalUnit === 'week') {
      const unit = `/${7 * (intervalCount || 1)}天`
      return { unit, creditUnit: backendCreditUnit || creditUnitFromUnit(unit) }
    }
    if (intervalUnit === 'quarter') return { unit: '/季', creditUnit: backendCreditUnit || '积分/季' }
    if (intervalUnit === 'year') return { unit: '/年', creditUnit: backendCreditUnit || '积分/年' }
    if (intervalUnit === 'month') return { unit: '/月', creditUnit: backendCreditUnit || '积分/月' }
  }

  if (String(p.period || '').toLowerCase() === 'week') {
    const unit = `/${7 * (intervalCount || 1)}天`
    return { unit, creditUnit: backendCreditUnit || creditUnitFromUnit(unit) }
  }
  if (String(p.period || '').toLowerCase() === 'quarter')
    return { unit: '/季', creditUnit: backendCreditUnit || '积分/季' }
  if (String(p.period || '').toLowerCase() === 'year')
    return { unit: '/年', creditUnit: backendCreditUnit || '积分/年' }
  return { unit: '/月', creditUnit: backendCreditUnit || '积分/月' }
}

function toVM(p: ApiPlan): PlanVM {
  const s = `${p.name || ''} ${p.code || ''}`
  // 优先用后端 plan_type 区分团队/个人;没有该字段再退回按名称/code 猜
  const planType = String(p.plan_type ?? p.planType ?? '').toLowerCase()
  const isTeam = planType ? planType === 'team' : /团队|team/i.test(s)
  const { unit, creditUnit } = periodLabel(p)
  const credits = Number(p.base_credits ?? 0)

  // 价格用后端折扣三件套:price_cents=折前原价(划线),discounted_price_cents=折后实付(大号),
  // discount_percent=折扣百分比。discount_enabled 关闭或数据缺失时,大号显示原价、不划线、不显示角标。
  const originCents = Number(p.price_cents || 0)
  const discountedCents = Number(p.discounted_price_cents || 0)
  const enabled = p.discount_enabled === true && discountedCents > 0 && discountedCents < originCents
  const payCents = enabled ? discountedCents : originCents
  // 价格只展示整元(四舍五入),不显示小数:折后 79112 分 → ￥791
  const origin = enabled ? `￥${Math.round(originCents / 100)}` : ''
  const discount = enabled ? discountLabel(p.discount_percent ?? 0) : ''
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
    name: p.name || '套餐',
    subtitle,
    price: String(Math.round(payCents / 100)),
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

function PlanCard({
  plan,
  buying,
  purchased,
  onBuy,
}: {
  plan: PlanVM
  buying: boolean
  purchased: boolean
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
      <button type="button" className="mc-card-buy" disabled={buying} onClick={() => onBuy(plan)}>
        {buying ? '处理中…' : purchased ? '续费' : '立即开通'}
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

// 后端 domain.CreditPackage(已解包)
interface ApiPackage {
  id: number
  code?: string
  name: string
  amount_cents: number
  credits: number
  status?: string
}
interface PackageVM {
  id: number
  name: string
  subtitle: string
  credits: string
  price: string
  rate: string
}
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

// 积分充值卡复用套餐卡的视觉(同样的 .mc-card 外观与配色)
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

interface MemberCenterModalProps {
  open: boolean
  onClose: () => void
  /** 页面模式:不渲染遮罩/portal,内容内联交由外层页面承载;onClose 用于「完成」后返回 */
  embedded?: boolean
}

export default function MemberCenterModal({ open, onClose, embedded = false }: MemberCenterModalProps) {
  const { showToast } = useToast()
  const { requestConfirm } = useConfirmDialog()
  const workspaceId = Number(useWorkspaceId() || 0)
  // 仅主账号可充值:团队空间里只有所有者能充值,子账号不允许;个人空间是自己的,可充值。
  const currentWs = useCurrentWorkspace()
  const currentUser = useCurrentUser()
  const currentMember = useCurrentMember()
  const isTeamWs = Boolean(currentWs?.type) && String(currentWs.type).toLowerCase() !== 'personal'
  const isOwner =
    (Number(currentWs?.owner_user_id ?? currentWs?.ownerUserId ?? 0) > 0 &&
      Number(currentWs?.owner_user_id ?? currentWs?.ownerUserId) === Number(currentUser?.id ?? 0)) ||
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
  const orderedTeamNameRef = useRef('') // 本次下单用的团队名,供 18s 兜底自建时复用,保持一致
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
  const pendingOrderRef = useRef<Record<string, { orderId: number; payUrl: string; ts: number }>>({})

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
        .catch(() => alive && setSubscription(null))
    } else {
      setBalance(null)
      setSubscription(null)
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

  if (!open) return null

  // 基础版 = 非团队套餐;团队版 = 团队套餐
  const visible = mainTab === 'team' ? plans.filter((p) => p.isTeam) : plans.filter((p) => !p.isTeam)

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

  // 从下单返回里取订单 id(字段名后端不统一,做兜底)
  const orderIdOf = (res: any): number =>
    Number(
      res?.order?.id ?? res?.order?.order_id ?? res?.order_id ?? res?.id ?? res?.data?.order?.id ?? res?.data?.id ?? 0,
    ) || 0

  // 查某订单是否仍「待支付(pending)」——复用前确认,已付/取消/过期则不复用。
  const isOrderPending = async (orderId: number): Promise<boolean> => {
    const ws = Number(workspaceId || 0)
    if (!ws || !orderId) return false
    try {
      const rows: any = await listPaymentOrders({ workspaceId: ws, limit: 50 })
      const list: any[] = Array.isArray(rows) ? rows : rows?.items || rows?.list || rows?.orders || []
      return String(list.find((r: any) => Number(r?.id) === orderId)?.status || '') === 'pending'
    } catch {
      return false
    }
  }

  // 复用未支付订单:同 key 上次的单若在 10 分钟内且仍 pending → 复用原 pay_url,不重复下单;否则新下一单并缓存。
  const REUSE_ORDER_MS = 10 * 60 * 1000
  const resolveOrder = async (
    key: string,
    createFn: () => Promise<any>,
  ): Promise<{ payUrl: string; orderId: number }> => {
    const cached = pendingOrderRef.current[key]
    if (cached?.payUrl && Date.now() - cached.ts < REUSE_ORDER_MS && (await isOrderPending(cached.orderId))) {
      return { payUrl: cached.payUrl, orderId: cached.orderId } // 复用,不新建订单
    }
    if (cached) delete pendingOrderRef.current[key] // 旧单已失效,清掉
    const res: any = await createFn()
    const orderId = orderIdOf(res)
    const payUrl = String(res?.pay_url || '')
    if (orderId && payUrl) pendingOrderRef.current[key] = { orderId, payUrl, ts: Date.now() }
    return { payUrl, orderId }
  }

  // 打开支付页后轮询订单状态,给「成功/失败」结果提示并刷新余额/订阅(附加逻辑,不影响下单本身)。
  // 支付在外部标签页完成、前端收不到回调,故每 3s 查一次 listPaymentOrders 匹配本单 id,直到 paid/失败/超时。
  // 团队版支付成功后:适配团队空间。
  // 后端建团队通常是【异步】的,支付 paid 那一刻可能还没建好,故:
  //   ① 隔几秒重试刷新(~6×3s ≈ 18s),刷到"新出现的团队空间"就切过去(零重复风险);
  //   ② 等到底后端仍没建出团队 → 判定后端不建,前端兜底建一个(等待足够长,基本不与后端重复)。
  const adoptNewTeamWorkspace = async () => {
    const store = useWorkspaceSessionStore
    const isTeamWs = (w: any) => Boolean(w?.type) && String(w.type).toLowerCase() !== 'personal'
    console.log('[建团队] adoptNewTeamWorkspace 开始(重试找后端新建团队,18s 没有就兜底自建)') // 临时排查
    try {
      const beforeIds = new Set(
        (deriveAllWorkspaces(store.getState()) as any[]).map((w) => Number(w?.id || 0)).filter((id) => id > 0),
      )
      // 新出现的空间:优先团队空间,退回任一新空间
      const findNew = () => {
        const after = deriveAllWorkspaces(store.getState()) as any[]
        return (
          after.find((w) => Number(w?.id) > 0 && !beforeIds.has(Number(w.id)) && isTeamWs(w)) ||
          after.find((w) => Number(w?.id) > 0 && !beforeIds.has(Number(w.id)))
        )
      }
      // ① 重试 adopt:给后端异步建团队留时间。返回被切换到的新团队空间,供上层弹框命名。
      for (let i = 0; i < 6; i++) {
        await store.getState().loadWorkspaces()
        const created = findNew()
        if (created?.id) {
          store.getState().switchWorkspace(Number(created.id))
          return created
        }
        await new Promise((r) => window.setTimeout(r, 3000))
      }
      // 兜底前最后确认一次,收窄"后端刚建好但上一轮没刷到"的窗口
      await store.getState().loadWorkspaces()
      const late = findNew()
      if (late?.id) {
        store.getState().switchWorkspace(Number(late.id))
        return late
      }
      // ② 后端确实没建 → 前端兜底建团队(createTeam 内部:建 team 空间 → 刷列表 → 切过去)
      const user = store.getState().authSession?.user as any
      // 优先用本次下单填好的团队名(与后端随单建空间一致);缺失才退回默认名
      const fallbackName =
        orderedTeamNameRef.current.trim() ||
        `${String(user?.nickname || user?.name || user?.username || '我').trim()}的团队`
      console.log('[建团队] 后端 18s 内没建出新团队 → 前端兜底 createTeam:', fallbackName) // 临时
      const createdTeam = await store.getState().createTeam(fallbackName)
      console.log('[建团队] 兜底 createTeam 返回:', createdTeam) // 临时
      return createdTeam
    } catch (e) {
      // 临时:兜底建团队被后端拒(如需团队会员权限)会走这里,原来被静默吞掉
      console.error('[建团队] adopt / 兜底建团队失败:', e)
    }
    return null
  }

  const watchOrder = (orderId: number, kind: 'recharge' | 'subscribe', team = false) => {
    const ws = Number(workspaceId || 0)
    if (!orderId || !ws) return
    const type = kind === 'recharge' ? 'credit_recharge' : '' // 订阅有 initial/renewal 两种,留空取全部再按 id 匹配
    let tries = 0
    const MAX = 40 // ~40 × 3s ≈ 2 分钟
    const tick = async () => {
      if (!aliveRef.current) return
      tries += 1
      try {
        // 先主动对账:只【催后端】去支付宝核对并更新本单(不读它的返回状态——避免 reconcile 的状态字典
        // 与列表口径不一致导致误判);再用列表读【权威状态】('paid' 口径与原逻辑一致)。
        try {
          await reconcilePaymentOrder({ workspaceId: ws, orderId })
        } catch {
          /* 未支付/限流等 → 忽略,继续用列表查 */
        }
        const rows: any = await listPaymentOrders({ workspaceId: ws, type, limit: 50 })
        const list: any[] = Array.isArray(rows) ? rows : rows?.items || rows?.list || rows?.orders || []
        const st = String(list.find((r: any) => Number(r?.id) === orderId)?.status || '')
        // TODO 临时:排查「付款成功没建团队」——看轮询看到的订单状态 + 是否团队版
        if (st) console.log('[支付轮询] order=', orderId, 'status=', st, '| team=', team, '| kind=', kind)
        if (st === 'paid' || st === 'failed' || st === 'canceled') {
          // 终态:清掉该订单的复用缓存,下次点支付重新下单
          for (const k of Object.keys(pendingOrderRef.current)) {
            if (pendingOrderRef.current[k]?.orderId === orderId) delete pendingOrderRef.current[k]
          }
        }
        if (st === 'paid') {
          // 支付成功 → 装填智能成片引导(仅该用户【首次支付】装填一次,续费/再买不再触发),
          // 下次进 /smart 入口页触发跟随流程引导。
          armSmartGuide(useWorkspaceSessionStore.getState().authSession?.user?.id)
          if (!aliveRef.current) return
          showToast(kind === 'recharge' ? '充值成功,积分已到账' : '支付成功,会员已开通', 'success')
          getWallet(ws)
            .then((w: any) => aliveRef.current && setBalance(Number(w?.available ?? w?.balance ?? 0)))
            .catch(() => {})
          getSubscription(ws)
            .then((s: any) => aliveRef.current && setSubscription(s))
            .catch(() => {})
          // 同步刷新全局 store(顶栏/个人面板的会员套餐 + 积分进度据此显示):
          // 否则关掉弹窗回到页面看不到刚开通/续费的会员、刚充的积分(弹窗 setSubscription 只更新弹窗局部)。
          // 团队版新开走 adoptNewTeamWorkspace 切空间会再刷一次,此处对老空间刷一次也无害。
          void useWorkspaceSessionStore.getState().loadSubscriptionLabel()
          // 买的是团队版:团队名已在下单前填好并随单创建 → 这里只把新团队空间适配/切换过去,不再二次弹命名框。
          console.log('[支付] paid 已确认,team=', team, '→', team ? '触发建/切团队' : '非团队版,不建团队') // 临时排查
          if (kind === 'subscribe' && team) {
            void adoptNewTeamWorkspace()
          }
          return
        }
        if (st === 'failed' || st === 'canceled') {
          if (aliveRef.current) showToast(st === 'canceled' ? '支付已取消' : '支付失败,请重试', 'error')
          return
        }
      } catch {
        /* 查询失败忽略,继续轮询 */
      }
      if (aliveRef.current && tries < MAX) window.setTimeout(tick, 3000)
    }
    window.setTimeout(tick, 3000)
  }

  // 支付下单 + 打开支付宝支付页的统一流程。
  // 关键:window.open 必须在「点击手势的同步阶段」调用,否则下单 await 之后再开窗会被浏览器判定为
  // 非用户触发而拦截(这正是「有人能开、有人不能开」的根因)。所以这里先同步打开一个空白标签页,
  // 等下单接口返回 pay_url 后再把该标签页 location 替换为支付地址。
  //   - 不能带 noopener:带了部分浏览器会返回 null 句柄,后续无法改 location;改为手动断开 win.opener 兜安全。
  //   - 极少数环境(如装了拦截插件)连同步开窗都失败 → 存下 pay_url,在弹窗内显示「手动打开」按钮兜底。
  const startPay = async (
    createOrder: () => Promise<{ payUrl: string; orderId: number }>,
    failMsg: string,
    kind: 'recharge' | 'subscribe',
    team = false, // 团队版订阅:支付成功后要刷新空间列表并切到后端新建的团队空间
  ) => {
    setPendingPayUrl('')
    // ① 与点击同步开空白页(此刻一定还在用户手势上下文里)
    const win = window.open('about:blank', '_blank')
    if (win) win.opener = null // 安全:断开对本页的引用,等价 noopener
    try {
      const { payUrl, orderId } = await createOrder()
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
      // ④ 附加:轮询订单状态,出「成功/失败」结果并刷新余额/订阅(不影响上面的下单/开窗)
      watchOrder(orderId, kind, team)
    } catch (e) {
      win?.close()
      showToast(getBusinessErrorMessage(e, failMsg), 'error')
    }
  }

  // 会员开通 / 续费:统一走 subscription-orders 下单,取一次性付款 pay_url 直接跳支付宝。
  const onBuy = async (p: PlanVM) => {
    if (buyingId) return
    if (!workspaceId) {
      showToast('缺少 workspace,无法开通', 'error')
      return
    }
    const renew = isPurchased(p)
    // A方案:团队套餐一律「开新团队」——每买一次就新开一个团队(空间:套餐 1:1),同一套餐可反复买、各用于新团队。
    // 续费某个已有团队走订阅信息区的「续费当前团队」按钮(intent=subscribe);个人版维持 开通/续费。
    const newTeam = p.isTeam
    const intent = newTeam ? 'new_team' : 'subscribe'
    // new_team:随单建团队空间。团队名不在会员中心输入,统一用唯一默认名,并做校验/去重,避免后端因非法/重名建不出空间。
    let nwsName = ''
    if (newTeam) {
      nwsName = uniqueDefaultTeamName
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
      if (existingTeamNames.has(nwsName.toLowerCase())) {
        for (let i = 2; i < 100; i++) {
          const cand = `${nwsName}${i}`
          if (!existingTeamNames.has(cand.toLowerCase())) {
            nwsName = cand
            break
          }
        }
      }
      orderedTeamNameRef.current = nwsName
    }
    // 幂等键:后端要求简单字母数字串(示例 a1b2c3),不能带冒号/中文 → 用随机 base36 token
    const idemKey = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`
    setBuyingId(p.id)
    try {
      // 开通与续费用同一个接口:POST /api/v1/billing/subscription-orders;未支付单 10 分钟内复用,不重复下单
      await startPay(
        () =>
          resolveOrder(`sub:${intent}:${p.id}:${nwsName}`, () =>
            createSubscriptionOrder({
              workspaceId,
              planId: p.id,
              intent,
              newWorkspaceName: nwsName,
              idempotencyKey: idemKey,
            }),
          ),
        !newTeam && renew ? '续费失败,请稍后重试' : '开通失败,请稍后重试',
        'subscribe',
        newTeam, // 开新团队空间:支付成功后刷新空间列表并切到后端新建的团队空间
      )
    } finally {
      setBuyingId(0)
    }
  }

  // 积分充值:取一次性付款 pay_url 直接跳支付宝。
  const onRecharge = async (pkg: PackageVM) => {
    if (buyingId) return
    if (!canRecharge) {
      showToast('仅主账号可充值,子账号请联系主账号', 'error')
      return
    }
    if (!workspaceId) {
      showToast('缺少 workspace,无法充值', 'error')
      return
    }
    setBuyingId(pkg.id)
    try {
      await startPay(
        () => resolveOrder(`recharge:${pkg.id}`, () => createRechargeOrder({ workspaceId, creditPackageId: pkg.id })),
        '充值失败,请稍后重试',
        'recharge',
      )
    } finally {
      setBuyingId(0)
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
      void useWorkspaceSessionStore.getState().loadSubscriptionLabel()
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
    if (renewing || buyingId || !workspaceId || !subscription?.active) return
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
      setRenewing(false)
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
        {expiredBanner && <div className="mcm-expired">您所购买的会员已到期，请续费</div>}

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
                {visible.map((p) => (
                  <PlanCard
                    key={p.id}
                    plan={p}
                    buying={buyingId === p.id}
                    /* 团队套餐卡片一律「开新团队」,不显示「续费」;续费走订阅信息区的「续费当前团队」 */
                    purchased={!p.isTeam && isPurchased(p)}
                    onBuy={onBuy}
                  />
                ))}
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
