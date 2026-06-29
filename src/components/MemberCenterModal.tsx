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
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useToast } from '@/composables/useToast'
import { useWorkspaceId } from '@/stores/workspaceSession'
import {
  createRechargeOrder,
  createSubscriptionOrder,
  getBusinessErrorMessage,
  getSubscription,
  getWallet,
  listBillingPlans,
  listCreditPackages,
} from '@/api/business'
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
  period: string // month | year
  plan_type?: string // team | personal(后端区分团队/个人套餐)
  planType?: string
  price_cents: number
  base_credits: number
  status?: string
  description?: string
  subtitle?: string
  original_price_cents?: number
  list_price_cents?: number
  origin_price_cents?: number
  discount?: string | number
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

// 从套餐名/code 推断周期文案(接口 period 只有 month|year,7天/季 从名称识别)
function periodLabel(p: ApiPlan): { unit: string; creditUnit: string } {
  const s = `${p.name || ''} ${p.code || ''}`
  if (/7\s*天|试用|trial|week/i.test(s)) return { unit: '/7天', creditUnit: '积分/七天' }
  if (/季|quarter/i.test(s)) return { unit: '/季', creditUnit: '积分/季' }
  if (/年|year/i.test(s) || p.period === 'year') return { unit: '/年', creditUnit: '积分/年' }
  return { unit: '/月', creditUnit: '积分/月' }
}

function toVM(p: ApiPlan): PlanVM {
  const s = `${p.name || ''} ${p.code || ''}`
  // 优先用后端 plan_type 区分团队/个人;没有该字段再退回按名称/code 猜
  const planType = String(p.plan_type ?? p.planType ?? '').toLowerCase()
  const isTeam = planType ? planType === 'team' : /团队|team/i.test(s)
  const { unit, creditUnit } = periodLabel(p)
  const credits = Number(p.base_credits ?? 0)
  const priceCents = Number(p.price_cents || 0)
  const rate = credits > 0 ? `1积分≈${(priceCents / 100 / credits).toFixed(2)}元` : ''
  const periodKey = /7\s*天|试用|trial|week/i.test(s)
    ? 'trial'
    : /季|quarter/i.test(s)
      ? 'quarter'
      : /年|year/i.test(s) || p.period === 'year'
        ? 'year'
        : 'month'

  // 划线原价 + 折扣:① 后端字段优先;② 暂未返回时按设计稿规则「写死」(按周期固定折扣,原价由现价反推)。
  const originCents = Number(p.original_price_cents || p.list_price_cents || p.origin_price_cents || 0) || 0
  let origin = originCents > priceCents ? `￥${yuan(originCents)}` : ''
  let discount = p.discount ? String(p.discount) : ''
  if (!origin && !discount) {
    const ratio = periodKey === 'quarter' ? 0.75 : periodKey === 'year' ? 0.7 : periodKey === 'month' ? 0.88 : 0
    if (ratio && priceCents > 0) {
      // 月卡 8.8折、季卡 7.5折(直接取整会变 9折/8折);年卡维持原有取整(7折,不变)
      discount =
        periodKey === 'month' ? '8.8折' : periodKey === 'quarter' ? '7.5折' : `${Math.round((ratio * 100) / 10)}折`
      origin = `￥${Math.round(priceCents / 100 / ratio)}`
    }
  }

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
    price: yuan(p.price_cents),
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
  const workspaceId = Number(useWorkspaceId() || 0)
  // 顶层 tab:基础版(个人套餐)/ 团队版(团队套餐)/ 积分充值
  const [mainTab, setMainTab] = useState<'basic' | 'team' | 'recharge'>('basic')
  const [plans, setPlans] = useState<PlanVM[]>([])
  const [packages, setPackages] = useState<PackageVM[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [balance, setBalance] = useState<number | null>(null)
  const [subscription, setSubscription] = useState<any>(null)
  const [buyingId, setBuyingId] = useState(0)

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

  if (!open) return null

  // 基础版 = 非团队套餐;团队版 = 团队套餐
  const visible = mainTab === 'team' ? plans.filter((p) => p.isTeam) : plans.filter((p) => !p.isTeam)

  // 该套餐是否为当前已生效订阅(用于把「立即开通」显示为「续费」)
  const isPurchased = (p: PlanVM) =>
    !!subscription?.active && (subscription.plan_code === p.code || subscription.plan_name === p.name)

  // 取到支付宝 pay_url 后直接打开支付页(去掉站内扫码步骤)。
  // 只在新标签页打开,绝不跳转当前页;若被浏览器拦截则提示用户允许弹窗后重试。
  const openAlipay = (url: string) => {
    const win = window.open(url, '_blank', 'noopener,noreferrer')
    if (!win) {
      showToast('支付页面被浏览器拦截,请允许弹出窗口后重试', 'error')
      return
    }
    showToast('已打开支付宝支付页面,完成支付后可刷新查看', 'info')
  }

  // 会员开通 / 续费:统一走 subscription-orders 下单,取一次性付款 pay_url 直接跳支付宝。
  const onBuy = async (p: PlanVM) => {
    if (buyingId) return
    if (!workspaceId) {
      showToast('缺少 workspace,无法开通', 'error')
      return
    }
    const renew = isPurchased(p)
    setBuyingId(p.id)
    try {
      // 开通与续费用同一个接口:POST /api/v1/billing/subscription-orders
      const url = String((await createSubscriptionOrder({ workspaceId, planId: p.id }))?.pay_url || '')
      if (url) openAlipay(url)
      else showToast('未获取到支付链接,请稍后重试', 'error')
    } catch (e) {
      showToast(getBusinessErrorMessage(e, renew ? '续费失败,请稍后重试' : '开通失败,请稍后重试'), 'error')
    } finally {
      setBuyingId(0)
    }
  }

  // 积分充值:取一次性付款 pay_url 直接跳支付宝。
  const onRecharge = async (pkg: PackageVM) => {
    if (buyingId) return
    if (!workspaceId) {
      showToast('缺少 workspace,无法充值', 'error')
      return
    }
    setBuyingId(pkg.id)
    try {
      const res: any = await createRechargeOrder({ workspaceId, creditPackageId: pkg.id })
      const url = String(res?.pay_url || '')
      if (url) openAlipay(url)
      else showToast('未获取到支付链接,请稍后重试', 'error')
    } catch (e) {
      showToast(getBusinessErrorMessage(e, '充值失败,请稍后重试'), 'error')
    } finally {
      setBuyingId(0)
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
          <button
            type="button"
            className={`mcm-tab${mainTab === 'recharge' ? ' is-active' : ''}`}
            onClick={() => setMainTab('recharge')}
          >
            积分充值
          </button>
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
                  <PlanCard key={p.id} plan={p} buying={buyingId === p.id} purchased={isPurchased(p)} onBuy={onBuy} />
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

  return embedded
    ? shell
    : createPortal(
        <div className="mcm-mask" onClick={(e) => e.target === e.currentTarget && onClose()}>
          {shell}
        </div>,
        document.body,
      )
}
