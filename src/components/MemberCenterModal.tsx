/**
 * MemberCenterModal — 会员中心(弹窗,按 Figma 521:3541)。
 * 覆盖在当前页之上(portal),关闭即回到原页面。
 * 个人版/团队版 Tab + 套餐卡片。套餐名/价格/积分/周期、当前积分余额、立即开通(支付签约)均接真实接口:
 *   - GET  /api/v1/billing/plans            列出套餐(listBillingPlans)
 *   - GET  /api/v1/billing/wallet           当前 workspace 积分余额(getWallet)
 *   - POST /api/v1/billing/subscriptions/sign-url  开通 → 取支付宝签约地址(createSubscriptionSignUrl)
 * 接口未提供「副标题/功能清单」等营销文案,按个人/团队保留静态展示。
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { QRCodeCanvas } from 'qrcode.react'
import { useToast } from '@/composables/useToast'
import { useWorkspaceId } from '@/stores/workspaceSession'
import { createSubscriptionSignUrl, getBusinessErrorMessage, getWallet, listBillingPlans } from '@/api/business'
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
  name: string
  subtitle: string
  price: string
  unit: string
  credits: string
  creditUnit: string
  features: Feature[]
  isTeam: boolean
}

// 接口未提供功能清单,按个人/团队给静态展示(团队多「可创建团队」)
const FEATURES_PERSONAL: Feature[] = [
  { text: '素材库任意用', ok: true },
  { text: '超清 1080P 导出', ok: true },
  { text: '去除品牌水印,商用无忧', ok: true },
  { text: '云端储存空间', ok: true },
  { text: '不可创建团队', ok: false },
]
const FEATURES_TEAM: Feature[] = [
  { text: '素材库任意用', ok: true },
  { text: '超清 1080P 导出', ok: true },
  { text: '去除品牌水印,商用无忧', ok: true },
  { text: '云端储存空间', ok: true },
  { text: '可创建团队、邀请成员', ok: true },
]

function yuan(cents: number): string {
  const v = (Number(cents) || 0) / 100
  return Number.isInteger(v) ? String(v) : v.toFixed(2)
}

function toVM(p: ApiPlan): PlanVM {
  const isTeam = /团队|team/i.test(`${p.name || ''} ${p.code || ''}`)
  const yearly = p.period === 'year'
  return {
    id: Number(p.id),
    name: p.name || '套餐',
    subtitle: yearly ? '年付更划算,适合长期规模化生产' : '按月订阅,随时开通',
    price: yuan(p.price_cents),
    unit: yearly ? '/年' : '/月',
    credits: String(p.base_credits ?? 0),
    creditUnit: yearly ? '积分/年' : '积分/月',
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
      <div className="mc-card-sub">{plan.subtitle}</div>
      <div className="mc-card-price">
        <span className="mc-card-cny">￥</span>
        <span className="mc-card-num">{plan.price}</span>
        <span className="mc-card-unit">{plan.unit}</span>
      </div>
      <div className="mc-card-credits">
        <span className="mc-card-credit-num">{plan.credits}</span>
        <span className="mc-card-credit-unit">{plan.creditUnit}</span>
        <span className="mc-card-rate">1积分=0.09元</span>
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

interface MemberCenterModalProps {
  open: boolean
  onClose: () => void
}

export default function MemberCenterModal({ open, onClose }: MemberCenterModalProps) {
  const { showToast } = useToast()
  const workspaceId = Number(useWorkspaceId() || 0)
  const [tab, setTab] = useState<'personal' | 'team'>('personal')
  const [plans, setPlans] = useState<PlanVM[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [balance, setBalance] = useState<number | null>(null)
  const [buyingId, setBuyingId] = useState(0)
  // 立即开通后的支付步骤
  const [step, setStep] = useState<'plans' | 'pay'>('plans')
  const [payInfo, setPayInfo] = useState<{ plan: PlanVM; signUrl: string; demo: boolean } | null>(null)

  // Esc 关闭
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // 打开时拉取套餐 + 当前积分余额
  useEffect(() => {
    if (!open) return
    let alive = true
    // 每次打开都从套餐列表开始
    setStep('plans')
    setPayInfo(null)
    setLoading(true)
    setError('')
    listBillingPlans()
      .then((list: any) => {
        if (!alive) return
        const vms = (Array.isArray(list) ? list : []).map(toVM)
        setPlans(vms)
        // 若没有团队套餐,默认停在个人版
        if (!vms.some((p) => p.isTeam)) setTab('personal')
      })
      .catch((e: any) => alive && setError(getBusinessErrorMessage(e, '套餐加载失败,请稍后重试')))
      .finally(() => alive && setLoading(false))

    if (workspaceId) {
      getWallet(workspaceId)
        .then((w: any) => alive && setBalance(Number(w?.available ?? w?.balance ?? 0)))
        .catch(() => alive && setBalance(null))
    } else {
      setBalance(null)
    }
    return () => {
      alive = false
    }
  }, [open, workspaceId])

  if (!open) return null

  const visible = plans.filter((p) => (tab === 'team' ? p.isTeam : !p.isTeam))

  const onBuy = async (p: PlanVM) => {
    if (buyingId) return
    if (!workspaceId) {
      showToast('缺少 workspace,无法开通', 'error')
      return
    }
    setBuyingId(p.id)
    try {
      const res: any = await createSubscriptionSignUrl({ workspaceId, planId: p.id })
      const url = String(res?.sign_url || '')
      if (url) {
        setPayInfo({ plan: p, signUrl: url, demo: false })
        setStep('pay')
      } else {
        showToast('未获取到支付链接,请稍后重试', 'error')
      }
    } catch (e) {
      // 开发环境(未接通后端/未登录)展示占位二维码,方便预览支付步骤;线上仍提示错误
      if (import.meta.env.DEV) {
        setPayInfo({ plan: p, signUrl: `https://example.com/pay/preview?plan=${p.id}`, demo: true })
        setStep('pay')
      } else {
        showToast(getBusinessErrorMessage(e, '开通失败,请稍后重试'), 'error')
      }
    } finally {
      setBuyingId(0)
    }
  }

  return createPortal(
    <div className="mcm-mask" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="mcm" role="dialog" aria-label="会员中心">
        <button type="button" className="mcm-close" aria-label="关闭" onClick={onClose}>
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
        </button>
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
            <h2 className="mcm-title">扫码支付</h2>
            <div className="mcm-pay-plan">
              <span className="mcm-pay-plan-name">{payInfo.plan.name}</span>
              <span className="mcm-pay-plan-price">
                ￥{payInfo.plan.price}
                <i>{payInfo.plan.unit}</i>
              </span>
            </div>
            <div className="mcm-pay-qr">
              <QRCodeCanvas value={payInfo.signUrl} size={196} marginSize={1} fgColor="#333333" bgColor="#ffffff" />
            </div>
            <div className="mcm-pay-tip">请使用支付宝扫码完成签约支付</div>
            {payInfo.demo && <div className="mcm-pay-demo">预览模式:开发环境未接通后端,此为占位二维码</div>}
            <button
              type="button"
              className="mcm-pay-done"
              onClick={() => {
                showToast('如已完成支付,会员状态稍后自动更新', 'info')
                onClose()
              }}
            >
              我已完成支付
            </button>
          </div>
        ) : (
          <>
            <h2 className="mcm-title">会员中心</h2>
            {balance !== null && <div className="mcm-balance">当前积分余额:{balance}</div>}
            <div className="mcm-tabs">
              <button
                type="button"
                className={`mcm-tab${tab === 'personal' ? ' is-active' : ''}`}
                onClick={() => setTab('personal')}
              >
                个人版
              </button>
              <button
                type="button"
                className={`mcm-tab${tab === 'team' ? ' is-active' : ''}`}
                onClick={() => setTab('team')}
              >
                团队版
              </button>
            </div>

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
        )}
      </div>
    </div>,
    document.body,
  )
}
