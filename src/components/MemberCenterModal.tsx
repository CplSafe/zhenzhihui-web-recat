/**
 * MemberCenterModal — 会员中心(弹窗,按 Figma 521:3541)。
 * 覆盖在当前页之上(portal),关闭即回到原页面。
 * 个人版/团队版 Tab + 套餐卡片。套餐名/价格/积分/周期、当前积分余额、立即开通(支付签约)均接真实接口:
 *   - GET  /api/v1/billing/plans            列出套餐(listBillingPlans)
 *   - GET  /api/v1/billing/wallet           当前 workspace 积分余额(getWallet)
 *   - POST /api/v1/billing/subscription-orders  开通普通订阅(一次性付款,取 pay_url)(createSubscriptionOrder)
 *   - POST /api/v1/billing/recharge-orders       积分充值(一次性付款,取 pay_url)(createRechargeOrder)
 * 注:签约(subscriptions/sign-url,周期扣款)暂未开通权限,故会员开通走一次性付款。
 * 接口未提供「副标题/功能清单」等营销文案,按个人/团队保留静态展示。
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { QRCodeCanvas } from 'qrcode.react'
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
  listPaymentOrders,
} from '@/api/business'
import './MemberCenterModal.css'

interface Feature {
  text: string
  ok: boolean
}

// 后端 domain.Plan(已由 requestJson 解包 data)
interface ApiPlan {
  id: number
  code: string
  name: string
  period: string // month | year
  price_cents: number
  base_credits: number
  status?: string
}

// 卡片视图模型
interface PlanVM {
  id: number
  code: string
  name: string
  price: string
  unit: string
  credits: string
  creditUnit: string
  rate: string // 1积分≈X元
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

// 从套餐名/code 推断周期文案(接口 period 只有 month|year,7天/季 从名称识别)
function periodLabel(p: ApiPlan): { unit: string; creditUnit: string } {
  const s = `${p.name || ''} ${p.code || ''}`
  if (/7\s*天|试用|trial|week/i.test(s)) return { unit: '/7天', creditUnit: '积分/七天' }
  if (/季|quarter/i.test(s)) return { unit: '/季', creditUnit: '积分/季' }
  if (/年|year/i.test(s) || p.period === 'year') return { unit: '/年', creditUnit: '积分/年' }
  return { unit: '/月', creditUnit: '积分/月' }
}

function toVM(p: ApiPlan): PlanVM {
  const isTeam = /团队|team/i.test(`${p.name || ''} ${p.code || ''}`)
  const { unit, creditUnit } = periodLabel(p)
  const credits = Number(p.base_credits ?? 0)
  const rate = credits > 0 ? `1积分≈${(Number(p.price_cents || 0) / 100 / credits).toFixed(2)}元` : ''
  return {
    id: Number(p.id),
    code: p.code || '',
    name: p.name || '套餐',
    price: yuan(p.price_cents),
    unit,
    credits: String(credits),
    creditUnit,
    rate,
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

function PlanCard({ plan, buying, onBuy }: { plan: PlanVM; buying: boolean; onBuy: (p: PlanVM) => void }) {
  return (
    <div className="mc-card">
      <div className="mc-card-name">{plan.name}</div>
      <div className="mc-card-price">
        <span className="mc-card-cny">￥</span>
        <span className="mc-card-num">{plan.price}</span>
        <span className="mc-card-unit">{plan.unit}</span>
      </div>
      <div className="mc-card-credits">
        <span className="mc-card-credit-num">{plan.credits}</span>
        <span className="mc-card-credit-unit">{plan.creditUnit}</span>
        {plan.rate && <span className="mc-card-rate">{plan.rate}</span>}
      </div>
      <button type="button" className="mc-card-buy" disabled={buying} onClick={() => onBuy(plan)}>
        {buying ? '处理中…' : '立即开通'}
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
  credits: string
  price: string
}
function toPkgVM(p: ApiPackage): PackageVM {
  return {
    id: Number(p.id),
    name: p.name || '积分包',
    credits: String(p.credits ?? 0),
    price: yuan(p.amount_cents),
  }
}

function PackageCard({ pkg, buying, onBuy }: { pkg: PackageVM; buying: boolean; onBuy: (p: PackageVM) => void }) {
  return (
    <div className="mc-card">
      <div className="mc-card-name">{pkg.name}</div>
      <div className="mc-card-credits">
        <span className="mc-card-credit-num">{pkg.credits}</span>
        <span className="mc-card-credit-unit">积分</span>
        <span className="mc-card-rate">1积分=0.09元</span>
      </div>
      <div className="mc-card-price">
        <span className="mc-card-cny">￥</span>
        <span className="mc-card-num">{pkg.price}</span>
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
  const [mainTab, setMainTab] = useState<'plan' | 'recharge'>('recharge')
  const [plans, setPlans] = useState<PlanVM[]>([])
  const [packages, setPackages] = useState<PackageVM[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [balance, setBalance] = useState<number | null>(null)
  const [subscription, setSubscription] = useState<any>(null)
  const [buyingId, setBuyingId] = useState(0)
  // 立即开通 / 充值后的扫码支付步骤(会员=签约地址,充值=一次性 pay_url)
  const [step, setStep] = useState<'plans' | 'pay'>('plans')
  const [payInfo, setPayInfo] = useState<{
    kind: 'plan' | 'recharge'
    title: string
    price: string
    url: string
    demo: boolean
    orderId?: number // 充值订单号:用 payment-orders 查状态
    planCode?: string // 会员套餐 code:用 subscription 查是否已激活
    beforeBalance?: number // 充值前余额:用 wallet 兜底判断到账
  } | null>(null)
  // 支付状态轮询(payment-orders / subscription / wallet)
  const [paid, setPaid] = useState(false)
  const [checking, setChecking] = useState(false)

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
    // 每次打开都回到套餐列表第一步
    setStep('plans')
    setPayInfo(null)
    setPaid(false)
    setMainTab('recharge')
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

  // 进入扫码支付后自动轮询支付状态;检测到成功切到「支付成功」态,3 分钟超时停止。
  useEffect(() => {
    if (!open || step !== 'pay' || !payInfo || payInfo.demo || paid) return
    let alive = true
    const deadline = Date.now() + 3 * 60 * 1000
    const timer = window.setInterval(async () => {
      if (!alive) return
      if (Date.now() > deadline) {
        window.clearInterval(timer)
        return
      }
      const ok = await verifyPaid(payInfo)
      if (alive && ok) {
        setPaid(true)
        window.clearInterval(timer)
      }
    }, 3000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
    // verifyPaid 为每次渲染重建的纯函数,刻意不入依赖,避免重复起轮询
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step, payInfo, paid, workspaceId])

  if (!open) return null

  const visible = plans // 基础版/团队版已合并,所有套餐一起展示

  // 会员开通:普通订阅(一次性付款,pay_url);签约(sign-url)是周期扣款,暂未开通权限
  const onBuy = async (p: PlanVM) => {
    if (buyingId) return
    if (!workspaceId) {
      showToast('缺少 workspace,无法开通', 'error')
      return
    }
    setBuyingId(p.id)
    setPaid(false)
    try {
      const res: any = await createSubscriptionOrder({ workspaceId, planId: p.id })
      const url = String(res?.pay_url || '')
      if (url) {
        setPayInfo({ kind: 'plan', title: p.name, price: `￥${p.price}${p.unit}`, url, demo: false, planCode: p.code })
        setStep('pay')
      } else {
        showToast('未获取到支付链接,请稍后重试', 'error')
      }
    } catch (e) {
      // 开发环境(未接通后端/未登录)展示占位二维码,方便预览支付步骤;线上仍提示错误
      if (import.meta.env.DEV) {
        setPayInfo({
          kind: 'plan',
          title: p.name,
          price: `￥${p.price}${p.unit}`,
          url: `https://example.com/pay/preview?plan=${p.id}`,
          demo: true,
          planCode: p.code,
        })
        setStep('pay')
      } else {
        showToast(getBusinessErrorMessage(e, '开通失败,请稍后重试'), 'error')
      }
    } finally {
      setBuyingId(0)
    }
  }

  // 积分充值:一次性支付(pay_url)
  const onRecharge = async (pkg: PackageVM) => {
    if (buyingId) return
    if (!workspaceId) {
      showToast('缺少 workspace,无法充值', 'error')
      return
    }
    setBuyingId(pkg.id)
    setPaid(false)
    try {
      const res: any = await createRechargeOrder({ workspaceId, creditPackageId: pkg.id })
      const url = String(res?.pay_url || '')
      const orderId = Number(res?.order?.id ?? res?.id ?? 0) || 0
      if (url) {
        setPayInfo({
          kind: 'recharge',
          title: pkg.name,
          price: `￥${pkg.price}`,
          url,
          demo: false,
          orderId,
          beforeBalance: balance ?? undefined,
        })
        setStep('pay')
      } else {
        showToast('未获取到支付链接,请稍后重试', 'error')
      }
    } catch (e) {
      if (import.meta.env.DEV) {
        setPayInfo({
          kind: 'recharge',
          title: pkg.name,
          price: `￥${pkg.price}`,
          url: `https://example.com/pay/preview?pkg=${pkg.id}`,
          demo: true,
        })
        setStep('pay')
      } else {
        showToast(getBusinessErrorMessage(e, '充值失败,请稍后重试'), 'error')
      }
    } finally {
      setBuyingId(0)
    }
  }

  // 用真实接口判断支付是否成功:
  //  - 充值:GET payment-orders 查该订单 status=paid;兜底 GET wallet 余额是否增长
  //  - 会员:GET subscription 查 active 且 plan_code 匹配
  // 返回 true=已确认到账/已开通。每次确认都会顺带刷新余额。
  const verifyPaid = async (info: NonNullable<typeof payInfo>): Promise<boolean> => {
    if (!workspaceId || info.demo) return false
    try {
      if (info.kind === 'recharge') {
        if (info.orderId) {
          const res: any = await listPaymentOrders({ workspaceId, type: 'credit_recharge', limit: 50 })
          const list: any[] = Array.isArray(res) ? res : res?.items || res?.list || res?.orders || []
          const ord = list.find((o: any) => Number(o?.id) === info.orderId)
          if (ord && /paid|success|succeeded|completed/i.test(String(ord.status || ''))) {
            await refreshBalance()
            return true
          }
        }
        // 兜底:钱包余额比充值前增长
        const w: any = await getWallet(workspaceId)
        const avail = Number(w?.available ?? w?.balance ?? 0)
        setBalance(avail)
        return info.beforeBalance != null && avail > info.beforeBalance
      } else {
        const sub: any = await getSubscription(workspaceId)
        const ok = !!sub?.active && (!info.planCode || sub.plan_code === info.planCode)
        if (ok) await refreshBalance()
        return ok
      }
    } catch {
      return false
    }
  }

  const refreshBalance = async () => {
    if (!workspaceId) return
    try {
      const w: any = await getWallet(workspaceId)
      setBalance(Number(w?.available ?? w?.balance ?? 0))
    } catch {
      /* 忽略:余额刷新失败不影响支付结果判断 */
    }
  }

  // 点「我已完成支付」:立即查一次状态。
  const onManualCheck = async () => {
    if (!payInfo || checking) return
    if (payInfo.demo) {
      showToast('预览模式无法校验支付,线上会自动确认', 'info')
      return
    }
    setChecking(true)
    try {
      const ok = await verifyPaid(payInfo)
      if (ok) setPaid(true)
      else showToast('尚未检测到支付结果,完成支付后请稍候', 'info')
    } finally {
      setChecking(false)
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
      {step === 'pay' && payInfo ? (
        <div className="mcm-pay">
          <button type="button" className="mcm-pay-back" onClick={() => setStep('plans')}>
            <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
              <path
                d="M10 3 5 8l5 5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            返回
          </button>
          <h2 className="mcm-title">{paid ? '支付成功' : '扫码支付'}</h2>
          <div className="mcm-pay-plan">
            <span className="mcm-pay-plan-name">{payInfo.title}</span>
            <span className="mcm-pay-plan-price">{payInfo.price}</span>
          </div>
          {paid ? (
            <>
              <div className="mcm-pay-success" role="status">
                <svg viewBox="0 0 64 64" width="72" height="72" aria-hidden="true">
                  <circle cx="32" cy="32" r="30" fill="none" stroke="#32c7a6" strokeWidth="3" />
                  <path
                    d="M20 33l8 8 16-18"
                    fill="none"
                    stroke="#32c7a6"
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <div className="mcm-pay-success-text">{payInfo.kind === 'recharge' ? '积分已到账' : '会员已开通'}</div>
                {balance !== null && <div className="mcm-pay-success-sub">当前积分余额:{balance}</div>}
              </div>
              <button type="button" className="mcm-pay-done" onClick={onClose}>
                完成
              </button>
            </>
          ) : (
            <>
              <div className="mcm-pay-qr">
                <QRCodeCanvas value={payInfo.url} size={196} marginSize={1} fgColor="#333333" bgColor="#ffffff" />
              </div>
              <div className="mcm-pay-tip">请使用支付宝扫码完成支付</div>
              {payInfo.demo ? (
                <div className="mcm-pay-demo">预览模式:开发环境未接通后端,此为占位二维码</div>
              ) : (
                <div className="mcm-pay-tip mcm-pay-polling">支付完成后将自动确认到账…</div>
              )}
              <button type="button" className="mcm-pay-done" disabled={checking} onClick={onManualCheck}>
                {checking ? '查询中…' : '我已完成支付'}
              </button>
            </>
          )}
        </div>
      ) : (
        <>
          <h2 className="mcm-title">会员中心</h2>
          {balance !== null && <div className="mcm-balance">当前积分余额:{balance}</div>}

          {/* 当前订阅信息(套餐 / 席位 / 并发);未订阅不显示 */}
          {subscription?.active && (
            <div className="mcm-sub">
              <span className="mcm-sub-plan">{subscription.plan_name || subscription.plan_code || '当前套餐'}</span>
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
            </div>
          )}

          {/* 顶层:会员套餐 / 积分充值 */}
          <div className="mcm-tabs">
            <button
              type="button"
              className={`mcm-tab${mainTab === 'recharge' ? ' is-active' : ''}`}
              onClick={() => setMainTab('recharge')}
            >
              积分充值
            </button>
            <button
              type="button"
              className={`mcm-tab${mainTab === 'plan' ? ' is-active' : ''}`}
              onClick={() => setMainTab('plan')}
            >
              会员套餐
            </button>
          </div>

          {mainTab === 'plan' ? (
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
                    <PlanCard key={p.id} plan={p} buying={buyingId === p.id} onBuy={onBuy} />
                  ))}
                </div>
              )}
            </>
          ) : loading ? (
            <div className="mcm-hint">积分包加载中…</div>
          ) : !packages.length ? (
            <div className="mcm-hint">暂无可充值的积分包</div>
          ) : (
            <div className="mcm-cards">
              {packages.map((pkg) => (
                <PackageCard key={pkg.id} pkg={pkg} buying={buyingId === pkg.id} onBuy={onRecharge} />
              ))}
            </div>
          )}
        </>
      )}
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
