/**
 * MemberCenterModal — 会员中心(弹窗,按 Figma 521:3541)。
 * 覆盖在当前页之上(portal),关闭即回到原页面。
 * 个人版/团队版 Tab + 套餐卡片(名称/副标题/价格[含折扣]/积分/额度/立即开通/功能✓✗/1积分=0.09元)。
 * 套餐为前端占位数据,接计费接口后替换。
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useToast } from '@/composables/useToast'
import './MemberCenterModal.css'

interface Feature {
  text: string
  ok: boolean
}
interface Plan {
  id: string
  name: string
  subtitle: string
  price: string
  unit: string
  origin?: string
  discount?: string
  credits: string
  creditUnit: string
  quota: string
  features: Feature[]
  recommend?: boolean
}

const PERSONAL: Plan[] = [
  {
    id: 'trial',
    name: '7天试用会员',
    subtitle: '解锁全量核心功能,7天快速验证增长效果',
    price: '299',
    unit: '/7天',
    credits: '800',
    creditUnit: '积分/月',
    quota: '最多生成约 24 张图片 | 10 条视频',
    features: [
      { text: '素材库任意用', ok: true },
      { text: '超清 1080P 导出', ok: true },
      { text: '去除品牌水印,商用无忧', ok: true },
      { text: '云端储存空间 5GB', ok: true },
      { text: '不可创建团队', ok: false },
    ],
  },
  {
    id: 'monthly',
    name: '月度会员',
    subtitle: '多成员共享创作,素材高效管理',
    price: '899',
    unit: '/月',
    origin: '￥999',
    discount: '8.8折',
    credits: '3000',
    creditUnit: '积分/月',
    quota: '最多生成约 80 张图片 | 30 个视频',
    recommend: true,
    features: [
      { text: '素材库任意用', ok: true },
      { text: '超清 1080P 导出', ok: true },
      { text: '去除品牌水印,商用无忧', ok: true },
      { text: '云端储存空间 10GB', ok: true },
      { text: '不可创建团队', ok: false },
    ],
  },
]

const TEAM: Plan[] = [
  {
    id: 'team-month',
    name: '团队月度版',
    subtitle: '多成员协作,统一素材与权限管理',
    price: '1999',
    unit: '/月',
    credits: '8000',
    creditUnit: '积分/月',
    quota: '最多生成约 200 张图片 | 80 个视频',
    features: [
      { text: '素材库任意用', ok: true },
      { text: '超清 1080P 导出', ok: true },
      { text: '去除品牌水印,商用无忧', ok: true },
      { text: '云端储存空间 50GB', ok: true },
      { text: '可创建团队、邀请成员', ok: true },
    ],
  },
  {
    id: 'team-year',
    name: '团队年度版',
    subtitle: '年付更省,适合长期规模化生产',
    price: '19999',
    unit: '/年',
    origin: '￥23988',
    discount: '8.3折',
    credits: '100000',
    creditUnit: '积分/年',
    quota: '最多生成约 2500 张图片 | 1000 个视频',
    recommend: true,
    features: [
      { text: '素材库任意用', ok: true },
      { text: '超清 1080P 导出', ok: true },
      { text: '去除品牌水印,商用无忧', ok: true },
      { text: '云端储存空间 200GB', ok: true },
      { text: '可创建团队、邀请成员', ok: true },
    ],
  },
]

function Check({ ok }: { ok: boolean }) {
  return ok ? (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M3 8.5l3.2 3.2L13 5" fill="none" stroke="#32c7a6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="#c4c4c4" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function PlanCard({ plan, onBuy }: { plan: Plan; onBuy: (p: Plan) => void }) {
  return (
    <div className={`mc-card${plan.recommend ? ' mc-card--rec' : ''}`}>
      {plan.discount && <span className="mc-card-badge">{plan.discount}</span>}
      <div className="mc-card-name">{plan.name}</div>
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
        <span className="mc-card-rate">1积分=0.09元</span>
      </div>
      <div className="mc-card-quota">{plan.quota}</div>
      <button type="button" className="mc-card-buy" onClick={() => onBuy(plan)}>
        立即开通
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
  const [tab, setTab] = useState<'personal' | 'team'>('personal')

  // Esc 关闭
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  const plans = tab === 'personal' ? PERSONAL : TEAM
  const onBuy = (p: Plan) => showToast(`「${p.name}」开通功能待接入支付`, 'info')

  return createPortal(
    <div className="mcm-mask" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="mcm" role="dialog" aria-label="会员中心">
        <button type="button" className="mcm-close" aria-label="关闭" onClick={onClose}>
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
        </button>
        <h2 className="mcm-title">会员中心</h2>
        <div className="mcm-tabs">
          <button type="button" className={`mcm-tab${tab === 'personal' ? ' is-active' : ''}`} onClick={() => setTab('personal')}>
            个人版
          </button>
          <button type="button" className={`mcm-tab${tab === 'team' ? ' is-active' : ''}`} onClick={() => setTab('team')}>
            团队版
          </button>
        </div>
        <div className="mcm-cards">
          {plans.map((p) => (
            <PlanCard key={p.id} plan={p} onBuy={onBuy} />
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}
