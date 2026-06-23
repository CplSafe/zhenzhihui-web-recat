/*
  BillingModal — 计费与套餐管理弹窗（项目最大组件）
  集成套餐选购、积分钱包、订单记录、兑换码充值、开发空间管理等全部计费功能。
*/
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { QRCodeCanvas } from 'qrcode.react'
import { createWorkspaceInvitation } from '@/api/business'
import { useBilling } from '@/composables/useBilling'
import BillingAdminPanel from './BillingAdminPanel'
import './BillingModal.css'

export interface BillingModalProps {
  open?: boolean
  initialTab?: string
  workspaceId?: number
  user?: any
  onClose?: () => void
  onToast?: (message: string, type?: any) => void
}

export default function BillingModal(props: BillingModalProps) {
  const { open = false, initialTab = 'plans', workspaceId = 0, user = null } = props
  const emitClose = () => props.onClose?.()
  const emitToast = (message: string, type?: string) => props.onToast?.(message, type)

  // 用 ref 保存最新的 workspaceId，供 useBilling 的 getter 读取。
  const workspaceIdRef = useRef(workspaceId)
  workspaceIdRef.current = workspaceId
  const getWorkspaceId = useCallback(() => workspaceIdRef.current, [])

  const {
    plans,
    packages,
    subscription,
    loading,
    purchasing,
    cancelingSubscription,
    availableCredits,
    activePlanCode,
    refresh,
    cancelPoll,
    cancelSubscription,
    startRechargeViaQr,
    startTeamPlanViaQr,
    creditLedgers,
    creditLedgerKind,
    creditLedgerLimit,
    creditLedgerOffset,
    creditLedgerLoading,
    creditLedgerError,
    hasLedgerPrev,
    hasLedgerNext,
    refreshCreditLedgers,
    goLedgerPrev,
    goLedgerNext,
    paymentOrders,
    paymentOrderType,
    paymentOrderStatus,
    paymentOrderLimit,
    paymentOrderOffset,
    paymentOrderLoading,
    paymentOrderError,
    hasOrderPrev,
    hasOrderNext,
    refreshPaymentOrders,
    goOrderPrev,
    goOrderNext,
  } = useBilling(getWorkspaceId)

  const [view, setView] = useState<string>(initialTab)
  const [selectedPackageId, setSelectedPackageId] = useState(0)
  // QR：原 Vue 用 qrcode 库生成 dataURL，现改用 qrcode.react 直接渲染 canvas，故只存 payUrl 字符串。
  const [qrPayUrl, setQrPayUrl] = useState('')
  const [qrLoading, setQrLoading] = useState(false)
  // 协议勾选（原 Vue 模板里隐式声明的 agreed）
  const [agreed, setAgreed] = useState(false)

  // 套餐购买弹窗状态：选套餐 → QR 码 → 轮询支付 → 团队套餐展示邀请码
  const [purchasingPlanId, setPurchasingPlanId] = useState(0)
  const [planQrPayUrl, setPlanQrPayUrl] = useState('')
  const [planQrLoading, setPlanQrLoading] = useState(false)
  const [planInviteCode, setPlanInviteCode] = useState('')
  const [planPaid, setPlanPaid] = useState(false)

  const yuan = (cents: any, minFrac = 0) =>
    (Number(cents || 0) / 100).toLocaleString('zh-CN', {
      minimumFractionDigits: minFrac,
      maximumFractionDigits: 2,
    })
  const num = (n: any) => Number(n || 0).toLocaleString('zh-CN')
  const timeText = (value: any) => {
    if (!value) return ''
    const dt = new Date(value)
    if (Number.isNaN(dt.getTime())) return String(value)
    return dt.toLocaleString('zh-CN', { hour12: false })
  }

  const ledgerKindOptions = [
    { value: '', label: '全部类型' },
    { value: 'freeze', label: '冻结' },
    { value: 'settle', label: '结算' },
    { value: 'release', label: '解冻' },
    { value: 'recharge', label: '充值' },
    { value: 'grant', label: '发放' },
  ]
  const ledgerKindLabel = (kind: any) =>
    ledgerKindOptions.find((item) => item.value === kind)?.label || String(kind || '')

  const orderTypeOptions = [
    { value: '', label: '全部类型' },
    { value: 'credit_recharge', label: '积分充值' },
    { value: 'subscription_initial', label: '订阅开通' },
    { value: 'subscription_renewal', label: '订阅续费' },
  ]
  const orderTypeLabel = (type: any) =>
    orderTypeOptions.find((item) => item.value === type)?.label || String(type || '')

  const orderStatusOptions = [
    { value: '', label: '全部状态' },
    { value: 'pending', label: '处理中' },
    { value: 'paid', label: '已支付' },
    { value: 'failed', label: '失败' },
    { value: 'canceled', label: '已取消' },
  ]
  const orderStatusLabel = (status: any) =>
    orderStatusOptions.find((item) => item.value === status)?.label || String(status || '')

  const userName = useMemo(
    () => user?.nickname || user?.mobile || user?.email || '未登录用户',
    [user],
  )
  const avatarInitial = useMemo(() => userName.trim().charAt(0).toUpperCase() || '帧', [userName])
  const planStatus = useMemo(
    () => (subscription?.active ? subscription?.plan_name || '已开通套餐' : '尚未开通套餐'),
    [subscription],
  )

  // 设计稿三档（Starter/Basic/Pro）的纯视觉配色，按价格升序套用。文案（副标题/储存/团队/
  // 卖点等）来自后端套餐 entitlements_json.display，不再前端写死。
  const TIER_VISUALS = [
    {
      accent: 'rgba(91, 107, 232, 0.04)',
      blob: 'blue',
      ctaGradient: 'linear-gradient(180deg, rgba(213, 218, 255, 0.12) 0%, rgba(213, 218, 255, 0.32) 100%)',
    },
    {
      accent: 'rgba(194, 122, 255, 0.04)',
      blob: 'purple',
      ctaGradient: 'linear-gradient(180deg, rgba(194, 122, 255, 0.03) 0%, rgba(194, 122, 255, 0.10) 100%)',
    },
    {
      accent: 'rgba(255, 186, 97, 0.04)',
      blob: 'orange',
      ctaGradient: 'linear-gradient(180deg, rgba(255, 186, 97, 0.04) 0%, rgba(255, 186, 97, 0.12) 100%)',
    },
  ]

  // 套餐展示文案来自后端 entitlements_json.display；缺字段时回落空串/默认，保证渲染不崩。
  const planDisplay = (plan: any) => {
    const d = plan?.entitlements_json?.display || {}
    return {
      subtitle: d.subtitle || '',
      rate: d.credit_rate || '',
      storage: d.storage || '',
      team: d.team || '',
      teamEnabled: d.team_enabled === true,
      features: Array.isArray(d.features) ? d.features : [],
    }
  }

  // 计费周期：year→年 / week→周 / 其它→月。
  const PERIOD_LABELS: Record<string, string> = { year: '年', week: '周', month: '月' }
  const periodLabel = (period: any) => PERIOD_LABELS[period] || '月'

  // periodLabel 为稳定的纯函数，刻意省略以保持依赖最小，复刻原 Vue computed 语义
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const subscriptionPeriod = useMemo(() => periodLabel(subscription?.period), [subscription])
  const canCancelCurrentSubscription = !!subscription?.active
  const subscriptionCancelHint = useMemo(() => {
    if (!subscription?.active) return ''
    if (subscription?.current_period_end)
      return `取消后可使用至 ${timeText(subscription.current_period_end)}`
    return '取消后当前周期结束前仍可继续使用'
  }, [subscription])

  const isPlansSurface = view === 'plans' || view === 'credits'

  // ── effects ──

  // watch(() => props.open)
  useEffect(() => {
    let aborted = false
    if (!open) {
      cancelPoll()
      setQrPayUrl('')
      return
    }
    ;(async () => {
      setView(initialTab)
      await refresh()
      if (aborted) return
    })()
    return () => {
      aborted = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // open 后 refresh 完成、packages 变化时，选默认积分档（credits===1000 优先）。
  // 仅在弹窗打开后首次同步一次默认包，避免覆盖用户选择。
  const defaultPkgSyncedRef = useRef(false)
  useEffect(() => {
    if (!open) {
      defaultPkgSyncedRef.current = false
      return
    }
    if (defaultPkgSyncedRef.current) return
    if (!packages.length) return
    const preferred = packages.find((p) => p.credits === 1000) || packages[0] || null
    setSelectedPackageId(preferred?.id || 0)
    defaultPkgSyncedRef.current = true
  }, [open, packages])

  // 打开时根据 initialTab 拉对应数据列表。
  useEffect(() => {
    if (!open) return
    if (initialTab === 'ledgers') refreshCreditLedgers({ offset: 0 })
    if (initialTab === 'orders') refreshPaymentOrders({ offset: 0 })
    // admin 视图的初始化由 BillingAdminPanel 挂载时自行处理。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // 键盘 Esc 处理
  useEffect(() => {
    function onKeydown(e: KeyboardEvent) {
      if (e.key !== 'Escape' || !open) return
      // 先关积分弹窗，再关整页。
      if (view === 'credits') setView('plans')
      else emitClose()
    }
    document.addEventListener('keydown', onKeydown)
    return () => document.removeEventListener('keydown', onKeydown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, view])

  // watch(view) — 切换主视图时拉数据。仅在弹窗打开时生效。
  const prevViewRef = useRef(view)
  useEffect(() => {
    if (prevViewRef.current === view) {
      prevViewRef.current = view
      return
    }
    prevViewRef.current = view
    if (!open) return
    if (view === 'ledgers') refreshCreditLedgers({ offset: 0 })
    if (view === 'orders') refreshPaymentOrders({ offset: 0 })
    // admin 视图：切到 admin 时挂载 BillingAdminPanel，由其自行拉取数据。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])

  const subscriptionBaseCredits = Number(subscription?.base_credits ?? 0)
  const subscriptionConcurrency = Number(subscription?.concurrency ?? 0)
  const subscriptionMaxMembers = Number(subscription?.max_members ?? 0)
  const subscriptionMemberCount = Number(subscription?.current_member_count ?? 0)
  const seatLabel = useMemo(() => {
    if (!subscription?.active) return ''
    const max = subscriptionMaxMembers
    const used = subscriptionMemberCount
    return `${used}/${max > 0 ? max : '不限'}`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscription])
  const subscriptionMetaItems = useMemo(() => {
    if (!subscription?.active) return []
    const items: string[] = []
    if (subscription?.period) items.push(`周期：${subscriptionPeriod}`)
    if (subscriptionBaseCredits > 0 && subscription?.period)
      items.push(`赠送：${num(subscriptionBaseCredits)}积分/${subscriptionPeriod}`)
    else if (subscriptionBaseCredits > 0) items.push(`赠送：${num(subscriptionBaseCredits)}积分`)
    if (subscriptionConcurrency > 0) items.push(`并发：${subscriptionConcurrency}`)
    if (seatLabel) items.push(`席位：${seatLabel}`)
    return items
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscription, subscriptionPeriod, seatLabel])

  // 按价格升序取最多三档（先剔除免费档），套用设计稿三档配色；文案读后端 display。
  const tierCards = useMemo(
    () =>
      plans
        .filter((plan) => Number(plan.price_cents) > 0)
        .slice()
        .sort((a, b) => Number(a.price_cents) - Number(b.price_cents))
        .slice(0, 3)
        .map((plan, i) => ({
          plan,
          visual: TIER_VISUALS[i] || TIER_VISUALS[TIER_VISUALS.length - 1],
          display: planDisplay(plan),
          period: periodLabel(plan.period),
          isCurrent: !!activePlanCode && plan.code === activePlanCode,
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plans, activePlanCode],
  )

  const selectedPackage = useMemo(
    () => packages.find((p) => p.id === selectedPackageId) || null,
    [packages, selectedPackageId],
  )

  // 点击"立即开通"不再直接拉起支付，而是打开购买弹窗（和购买积分流程一致）
  function onSubscribe(plan: any) {
    if (!plan) return
    setPurchasingPlanId(plan.id)
    setPlanQrPayUrl('')
    setPlanQrLoading(false)
    setPlanInviteCode('')
    setPlanPaid(false)
    setView('planPurchase')
  }

  async function onCancelSubscription() {
    if (!canCancelCurrentSubscription || cancelingSubscription) return
    const confirmed = window.confirm('确认取消当前订阅吗？取消后当前周期结束前仍可继续使用。')
    if (!confirmed) return
    try {
      const result: any = await cancelSubscription()
      if (result?.busy) return
      emitToast('订阅已取消', 'success')
    } catch (err: any) {
      emitToast(err?.message || '取消订阅失败', 'error')
    }
  }

  // 切到积分购买视图。
  function openCredits() {
    setView('credits')
  }

  function selectPackage(pkg: any) {
    setSelectedPackageId(pkg.id)
  }

  // ── 套餐购买弹窗（统一：普通套餐 + 团队套餐）──

  // 从 tierCards 找到当前选中的套餐
  const purchasingPlan = useMemo(
    () => plans.find((p) => p.id === purchasingPlanId) || null,
    [plans, purchasingPlanId],
  )

  // 判断当前购买的套餐是否为团队套餐
  const isTeamPlan = !!(purchasingPlan && planDisplay(purchasingPlan).teamEnabled)

  // 生成支付二维码：创建订阅签约 → sign_url 渲染 QR → 轮询订阅激活 → 团队套餐自动生成邀请码。
  async function refreshPlanQr() {
    const plan = purchasingPlan
    if (!plan || !workspaceId || planQrLoading) return

    setPlanQrLoading(true)
    setPlanQrPayUrl('')
    let order: any
    try {
      order = await startTeamPlanViaQr(plan)
      if (order?.busy) {
        emitToast('有支付正在进行中，请稍候再试', 'error')
        return
      }
      // qrcode.react 直接渲染 canvas，无需生成 dataURL，存 payUrl 即可。
      setPlanQrPayUrl(order.payUrl)
    } catch (err: any) {
      emitToast(err?.message || '生成二维码失败', 'error')
      return
    } finally {
      setPlanQrLoading(false)
    }

    // 轮询订阅状态，团队套餐支付成功后自动生成邀请码
    try {
      const result: any = await order.poll()
      if (result?.busy) return
      if (result?.settled) {
        setPlanPaid(true)
        if (isTeamPlan) {
          try {
            const invitation: any = await createWorkspaceInvitation({
              workspaceId,
              expiryDays: 7,
              role: 'member',
            } as any)
            setPlanInviteCode(invitation?.code || '')
          } catch {
            setPlanInviteCode('')
          }
        }
        emitToast('支付成功，套餐已开通', 'success')
      } else {
        emitToast('未检测到支付结果，请稍候刷新', 'error')
      }
    } catch (err: any) {
      emitToast(err?.message || '支付失败', 'error')
    }
  }

  // 将邀请码格式化为 XXXX XXXX 展示
  function formatInviteCode(code: any) {
    const raw = String(code || '').replace(/\s/g, '')
    if (raw.length <= 4) return raw
    return raw.slice(0, 4) + ' ' + raw.slice(4)
  }

  // 为选中的积分档位生成真实支付二维码：创建一笔充值订单 → 渲染 QR →
  // 轮询钱包到账（复用同一笔订单，不重复下单）；扫码支付成功后弹窗自动关闭。
  async function refreshQrAndPoll() {
    const pkg = selectedPackage
    if (!pkg || !workspaceId || qrLoading) return

    setQrLoading(true)
    setQrPayUrl('')
    let order: any
    try {
      order = await startRechargeViaQr(pkg)
      if (order?.busy) {
        emitToast('有支付正在进行中，请稍候再试', 'error')
        return
      }
      setQrPayUrl(order.payUrl)
    } catch (err: any) {
      emitToast(err?.message || '生成二维码失败', 'error')
      return
    } finally {
      setQrLoading(false)
    }

    // 后台轮询到账（复用本次订单，不再下单/拉起新标签页）：到账后提示并关闭。
    try {
      const result: any = await order.poll()
      if (result?.busy) return
      if (result?.settled) {
        emitToast('积分已到账', 'success')
        emitClose()
      } else {
        emitToast('未检测到到账，支付成功后请稍候刷新', 'error')
      }
    } catch (err: any) {
      emitToast(err?.message || '充值失败', 'error')
    }
  }

  if (!open) return null

  return (
    <div className="bm-page" role="dialog" aria-modal="true" aria-label="会员中心">
      {/* 顶部：用户 + 剩余积分 + 购买积分入口 */}
      <header className="bm-top">
        <div className="bm-user">
          <span className="bm-avatar" aria-hidden="true">{avatarInitial}</span>
          <span className="bm-user-meta">
            <span className="bm-user-name">{userName}</span>
            <span className="bm-user-plan">{planStatus}</span>
            {subscriptionMetaItems.length > 0 && (
              <span className="bm-user-subinfo">
                {subscriptionMetaItems.map((item, idx) => (
                  <span key={idx} className="bm-user-chip">{item}</span>
                ))}
              </span>
            )}
            {canCancelCurrentSubscription && (
              <span className="bm-user-subaction">
                <button type="button" className="bm-sub-cancel" disabled={cancelingSubscription} onClick={onCancelSubscription}>
                  {cancelingSubscription ? '取消中…' : '取消订阅'}
                </button>
                <span className="bm-user-subhint">{subscriptionCancelHint}</span>
              </span>
            )}
          </span>
        </div>

        <div className="bm-wallet">
          <span className="bm-wallet-label">剩余积分</span>
          <span className="bm-wallet-val">
            <svg className="bm-bolt" width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
              <path
                d="M15.5787 8.52973H11.3028L13.2124 3.09333C13.494 2.29131 12.4261 1.71038 11.8827 2.37059L5.59939 10.0107C5.04037 10.6906 5.53257 11.7032 6.42224 11.7032H9.9764L7.20341 18.8843C6.89361 19.6864 7.96461 20.2963 8.51955 19.6341L16.3953 10.2285C16.9627 9.55067 16.4724 8.52973 15.5787 8.52973Z"
                fill="url(#bm-bolt-grad)"
              />
              <defs>
                <linearGradient id="bm-bolt-grad" x1="11" y1="2.08" x2="11" y2="19.92" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#C27AFF" />
                  <stop offset="1" stopColor="#5B6BE8" />
                </linearGradient>
              </defs>
            </svg>
            <strong>{num(availableCredits)}</strong>
            <span className="bm-wallet-unit">积分</span>
          </span>
        </div>

        <button type="button" className="bm-buy-credits" onClick={openCredits}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M13.8095 4.77148H2.19035C2.04115 4.77146 1.89361 4.80274 1.75725 4.8633C1.6209 4.92386 1.49876 5.01235 1.39874 5.12305C1.29872 5.23376 1.22303 5.36421 1.17657 5.50599C1.13011 5.64777 1.11391 5.79772 1.12902 5.94615L1.91115 13.6262C1.9379 13.889 2.06127 14.1326 2.25735 14.3097C2.45342 14.4868 2.70826 14.5849 2.97248 14.5848H13.0277C13.2919 14.5849 13.5467 14.4868 13.7428 14.3097C13.9389 14.1326 14.0623 13.889 14.089 13.6262L14.8709 5.94615C14.886 5.79772 14.8698 5.64777 14.8233 5.50599C14.7769 5.36421 14.7012 5.23376 14.6012 5.12305C14.5011 5.01235 14.379 4.92386 14.2426 4.8633C14.1063 4.80274 13.9587 4.77146 13.8095 4.77148ZM2.19035 5.83815H13.8095L13.0277 13.5182H2.97222L2.19035 5.83815Z"
              fill="#444444"
            />
            <path
              d="M9.4934 1.33331C9.90737 1.3333 10.3052 1.49373 10.6034 1.7809C10.9016 2.06808 11.0768 2.45964 11.0923 2.87331L11.0934 2.93331V6.50265C11.0931 6.64041 11.0395 6.77271 10.9438 6.87182C10.8481 6.97093 10.7178 7.02917 10.5801 7.03434C10.4424 7.03951 10.3081 6.99121 10.2052 6.89955C10.1024 6.8079 10.039 6.68 10.0283 6.54265L10.0267 6.50265V2.93331C10.0267 2.79881 9.97587 2.66927 9.88438 2.57067C9.7929 2.47206 9.66753 2.41167 9.53341 2.40158L9.4934 2.39998H6.50674C6.37219 2.40001 6.24262 2.45089 6.14401 2.54243C6.0454 2.63397 5.98503 2.7594 5.975 2.89358L5.9734 2.93358V6.50265C5.97308 6.64041 5.91946 6.77271 5.82377 6.87182C5.72808 6.97093 5.59776 7.02917 5.46009 7.03434C5.32242 7.03951 5.18809 6.99121 5.08524 6.89955C4.98239 6.8079 4.919 6.68 4.90834 6.54265L4.90674 6.50265V2.93331C4.90679 2.51939 5.06726 2.1216 5.35442 1.82349C5.64159 1.52539 6.03311 1.35017 6.44674 1.33465L6.50674 1.33331H9.4934Z"
              fill="#444444"
            />
            <path
              d="M10.9336 11.4667V12C10.9336 12.1415 10.8774 12.2771 10.7774 12.3771C10.6773 12.4772 10.5417 12.5333 10.4002 12.5333H5.60023C5.45878 12.5333 5.32312 12.4772 5.2231 12.3771C5.12309 12.2771 5.06689 12.1415 5.06689 12V11.4667H10.9336Z"
              fill="#5B6BE8"
            />
          </svg>
          购买积分
        </button>

        <button type="button" className="bm-close" aria-label="关闭" onClick={emitClose}>
          <svg width="30" height="30" viewBox="0 0 30 30" fill="none" aria-hidden="true">
            <path
              d="M27.1377 9.89941C26.4756 8.33789 25.5322 6.93457 24.3252 5.73047C23.1211 4.52637 21.7178 3.58008 20.1562 2.91797C18.5391 2.23242 16.8193 1.88672 15.0498 1.88672C13.2803 1.88672 11.5605 2.23242 9.94043 2.91797C8.37891 3.58008 6.97559 4.52344 5.77148 5.73047C4.56738 6.93457 3.62109 8.33789 2.95898 9.89941C2.27344 11.5166 1.92773 13.2363 1.92773 15.0059C1.92773 16.7754 2.27344 18.4951 2.95898 20.1123C3.62109 21.6738 4.56445 23.0771 5.77148 24.2812C6.97559 25.4853 8.37891 26.4316 9.94043 27.0937C11.5576 27.7793 13.2773 28.125 15.0469 28.125C16.8164 28.125 18.5361 27.7793 20.1533 27.0937C21.7148 26.4316 23.1182 25.4883 24.3223 24.2812C25.5264 23.0771 26.4727 21.6738 27.1348 20.1123C27.8203 18.4951 28.166 16.7754 28.166 15.0059C28.1689 13.2363 27.8203 11.5166 27.1377 9.89941ZM15.0498 25.7549C9.12305 25.7549 4.30078 20.9326 4.30078 15.0059C4.30078 9.0791 9.12305 4.25684 15.0498 4.25684C20.9766 4.25684 25.7988 9.0791 25.7988 15.0059C25.7988 20.9326 20.9766 25.7549 15.0498 25.7549Z"
              fill="currentColor"
            />
            <path
              d="M20.4463 9.6416C19.9893 9.18457 19.2451 9.18457 18.7881 9.6416L15.0293 13.4004L11.2705 9.6416C10.8135 9.18457 10.0693 9.18457 9.6123 9.6416C9.15527 10.0986 9.15527 10.8428 9.6123 11.2998L13.3711 15.0586L9.6123 18.8174C9.15527 19.2744 9.15527 20.0186 9.6123 20.4756C10.0693 20.9326 10.8135 20.9326 11.2705 20.4756L15.0293 16.7168L18.7881 20.4756C19.2451 20.9326 19.9893 20.9326 20.4463 20.4756C20.9033 20.0186 20.9033 19.2744 20.4463 18.8174L16.6875 15.0586L20.4463 11.2998C20.9033 10.8428 20.9033 10.0957 20.4463 9.6416Z"
              fill="currentColor"
            />
          </svg>
        </button>
      </header>

      <nav className="bm-tabs" aria-label="计费导航">
        <button type="button" className={`bm-tab${view === 'plans' || view === 'credits' ? ' active' : ''}`} onClick={() => setView('plans')}>
          套餐
        </button>
        <button type="button" className={`bm-tab${view === 'ledgers' ? ' active' : ''}`} onClick={() => setView('ledgers')}>
          流水
        </button>
        <button type="button" className={`bm-tab${view === 'orders' ? ' active' : ''}`} onClick={() => setView('orders')}>
          订单
        </button>
        <button type="button" className={`bm-tab${view === 'admin' ? ' active' : ''}`} onClick={() => setView('admin')}>
          运营
        </button>
      </nav>

      {/* 套餐三档 */}
      {isPlansSurface && loading ? (
        <p className="bm-loading">加载中…</p>
      ) : isPlansSurface ? (
        <section className="bm-cards" aria-label="会员套餐">
          {tierCards.map((card) => (
            <article
              key={card.plan.id}
              className={`bm-card bm-card--${card.visual.blob}`}
              style={{ ['--accent' as any]: card.visual.accent }}
            >
              <span className={`bm-blob bm-blob--${card.visual.blob}`} aria-hidden="true"></span>

              <header className="bm-card-head">
                <h3 className="bm-card-name">{card.plan.name}</h3>
                <p className="bm-card-sub">{card.display.subtitle}</p>
              </header>

              <p className="bm-price">
                <span className="bm-cur">￥</span>
                <span className="bm-amt">{yuan(card.plan.price_cents)}</span>
                <span className="bm-per">/{card.period}</span>
              </p>

              <div className="bm-credits-row">
                <span className="bm-credits-num">{num(card.plan.base_credits)}</span>
                <span className="bm-credits-unit">积分/{card.period}</span>
                <span className="bm-rate">{card.display.rate}</span>
              </div>

              <p className="bm-capacity">
                最多生成约 202000 张图片 | 10100 个视频
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <path
                    d="M7 14C3.14043 14 0 10.8601 0 7C0 3.14047 3.14043 0 7 0C10.8601 0 14 3.13991 14 7C14 10.8601 10.8601 14 7 14ZM7 1.00445C3.69388 1.00445 1.00443 3.69388 1.00443 7.00001C1.00443 10.3057 3.69388 12.9956 6.99999 12.9956C10.3057 12.9956 12.9956 10.3061 12.9956 7.00001C12.9956 3.69388 10.3057 1.00445 6.99999 1.00445H7ZM6.24668 3.73557C6.24668 3.53832 6.32785 3.34231 6.46732 3.2029C6.6068 3.06344 6.80274 2.98219 6.99999 2.98219C7.19726 2.98219 7.39319 3.06343 7.53268 3.2029C7.67214 3.34231 7.75331 3.53832 7.75331 3.73557C7.75331 3.93276 7.67215 4.12877 7.53268 4.26826C7.3932 4.40772 7.19726 4.48889 6.99999 4.48889C6.80274 4.48889 6.6068 4.40773 6.46733 4.26826C6.32785 4.12877 6.24669 3.93276 6.24669 3.73557H6.24668ZM7 11.0178C6.72273 11.0178 6.49775 10.7933 6.49775 10.5156V5.99558C6.49775 5.71832 6.72275 5.49332 6.99999 5.49332C7.27725 5.49332 7.50225 5.71832 7.50225 5.99558V10.5156C7.50225 10.7933 7.27725 11.0178 6.99999 11.0178H7Z"
                    fill="#666666"
                  />
                </svg>
              </p>

              <button
                type="button"
                className="bm-card-cta"
                style={{ background: card.visual.ctaGradient }}
                disabled={purchasing}
                onClick={() => onSubscribe(card.plan)}
              >
                {card.isCurrent ? '续费当前套餐' : '立即开通'}
              </button>

              <hr className="bm-divider" />

              <ul className="bm-feats">
                <li className="bm-feat--storage">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path
                      d="M13.453 10.735C13.743 10.735 13.998 10.992 13.998 11.281V14.009C13.998 14.0806 13.9839 14.1516 13.9565 14.2178C13.929 14.284 13.8888 14.3441 13.8381 14.3947C13.7874 14.4453 13.7272 14.4855 13.6609 14.5128C13.5947 14.5401 13.5237 14.5541 13.452 14.554H2.54405C2.39941 14.554 2.26069 14.4966 2.15832 14.3944C2.05595 14.2922 1.99831 14.1536 1.99805 14.009V11.28C1.99805 10.98 2.24305 10.734 2.54405 10.734H13.454L13.453 10.735ZM3.45305 13.245H4.72605V12.045H3.45305V13.245ZM13.453 6.18999C13.743 6.18999 13.998 6.44699 13.998 6.73599V9.46399C13.997 9.76399 13.753 10.009 13.452 10.009H2.54405C2.39941 10.009 2.26069 9.9516 2.15832 9.84942C2.05595 9.74724 1.99831 9.60862 1.99805 9.46399V6.73599C1.99805 6.43599 2.24305 6.19099 2.54405 6.18999H13.454H13.453ZM3.45305 8.69999H4.72605V7.49999H3.45305V8.69999ZM13.453 1.64499C13.743 1.64499 13.998 1.90099 13.998 2.18999V4.91799C13.998 4.98964 13.9839 5.0606 13.9565 5.12678C13.929 5.19297 13.8888 5.25309 13.8381 5.30372C13.7874 5.35434 13.7272 5.39446 13.6609 5.42179C13.5947 5.44912 13.5237 5.46312 13.452 5.46299H2.54405C2.39941 5.46299 2.26069 5.4056 2.15832 5.30342C2.05595 5.20124 1.99831 5.06262 1.99805 4.91799V2.18999C1.99805 1.88999 2.24305 1.64499 2.54405 1.64499H13.454H13.453ZM3.45305 4.15299H4.72605V2.95399H3.45305V4.15399V4.15299Z"
                      fill="url(#bm-storage-grad)"
                    />
                    <defs>
                      <linearGradient
                        id="bm-storage-grad"
                        x1="8"
                        y1="1.64"
                        x2="8"
                        y2="14.55"
                        gradientUnits="userSpaceOnUse"
                      >
                        <stop stopColor="#7AC3FF" />
                        <stop offset="1" stopColor="#5B6BE8" />
                      </linearGradient>
                    </defs>
                  </svg>
                  {card.display.storage}
                </li>
                <li className={`bm-feat--team${!card.display.teamEnabled ? ' bm-feat--off' : ''}`}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path
                      d="M9.38661 7.89332C11.3066 8.31999 13.4933 9.65332 13.4933 13.4933C13.4933 14.5067 12.2133 14.5067 8.05328 14.5067C3.83995 14.5067 2.61328 14.5067 2.61328 13.4933C2.61328 9.70665 4.79995 8.31999 6.71995 7.89332C5.22661 7.09332 4.69328 5.17332 5.43995 3.62665C6.13328 2.07999 7.94661 1.54665 9.33328 2.34665C10.7199 3.14665 11.3066 5.06665 10.5066 6.55999C10.2933 7.19999 9.86661 7.62665 9.38661 7.89332Z"
                      fill={card.display.teamEnabled ? 'url(#bm-team-grad)' : '#666666'}
                      fillOpacity={card.display.teamEnabled ? 1 : 0.4}
                    />
                    <path
                      d="M5.11982 7.84C5.27982 7.78666 5.33316 7.57333 5.17316 7.46666C3.99982 6.56 3.62649 4.85333 4.26649 3.46666C4.37316 3.25333 4.47982 3.09333 4.58649 2.88C4.69316 2.72 4.58649 2.56 4.42649 2.56C3.67982 2.66666 2.93316 3.09333 2.55982 3.89333C2.02649 5.01333 2.29316 6.34666 3.25316 7.09333C3.35982 7.2 3.35982 7.41333 3.19982 7.46666C1.75982 7.89333 0.319824 9.12 0.319824 11.8933C0.319824 12.32 0.586491 12.5333 1.27982 12.64C1.38649 12.64 1.49316 12.5867 1.49316 12.48C1.75982 9.6 3.46649 8.32 5.11982 7.84ZM10.8798 7.84C10.7198 7.78666 10.6665 7.57333 10.8265 7.46666C11.9998 6.56 12.3732 4.85333 11.7332 3.46666C11.6265 3.25333 11.5198 3.09333 11.4132 2.88C11.3065 2.72 11.4132 2.56 11.5732 2.56C12.3198 2.61333 13.0665 3.09333 13.4398 3.89333C13.9732 5.01333 13.7065 6.34666 12.7465 7.09333C12.6398 7.2 12.6398 7.41333 12.7998 7.46666C14.2398 7.89333 15.6798 9.12 15.6798 11.8933C15.6798 12.32 15.4132 12.5333 14.7198 12.64C14.6132 12.64 14.5065 12.5867 14.5065 12.48C14.1865 9.6 12.4798 8.32 10.8798 7.84Z"
                      fill={card.display.teamEnabled ? 'url(#bm-team-grad)' : '#666666'}
                      fillOpacity={card.display.teamEnabled ? 1 : 0.4}
                    />
                    <defs>
                      <linearGradient id="bm-team-grad" x1="8" y1="2" x2="8" y2="14.5" gradientUnits="userSpaceOnUse">
                        <stop stopColor="#7AC3FF" />
                        <stop offset="1" stopColor="#5B6BE8" />
                      </linearGradient>
                    </defs>
                  </svg>
                  {card.display.team}
                </li>
              </ul>

              <ul className="bm-perks">
                {card.display.features.map((perk: any, pi: number) => (
                  <li key={pi}>
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                      <path
                        d="M4.92533 9.99692C2.20925 9.99692 0.00732422 7.79467 0.00732422 5.0786C0.00732422 2.36276 2.20925 0.160583 4.92533 0.160583C5.90669 0.160583 6.8189 0.451298 7.58674 0.946926L6.62071 1.9126C6.11324 1.63979 5.54172 1.47074 4.92503 1.47074C2.93319 1.47074 1.31851 3.08572 1.31851 5.07727C1.31851 7.06917 2.93319 8.68417 4.92503 8.68417C6.73088 8.68417 8.21298 7.3525 8.47685 5.62037L9.7787 4.31874C9.81746 4.56692 9.84335 4.81955 9.84335 5.0786C9.84335 7.79468 7.64147 9.99692 4.92533 9.99692ZM4.78927 7.18057C4.64942 7.04072 2.82206 5.21341 2.82206 5.21341L3.74964 4.28642L4.92504 5.46183L8.7237 1.66288L9.6513 2.59046L5.06081 7.18057C5.06081 7.18057 4.92911 7.32041 4.78927 7.18057Z"
                        fill="#5B6BE8"
                      />
                    </svg>
                    {perk}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </section>
      ) : view === 'ledgers' ? (
        <section className="bm-list" aria-label="积分流水">
          <div className="bm-list-toolbar">
            <div className="bm-filters">
              <select
                className="bm-select"
                value={creditLedgerKind}
                onChange={(e) => refreshCreditLedgers({ kind: e.target.value, offset: 0 })}
              >
                {ledgerKindOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <select
                className="bm-select"
                value={creditLedgerLimit}
                onChange={(e) => refreshCreditLedgers({ limit: Number(e.target.value), offset: 0 })}
              >
                <option value={10}>10/页</option>
                <option value={20}>20/页</option>
                <option value={50}>50/页</option>
              </select>
            </div>
            <button type="button" className="bm-refresh" disabled={creditLedgerLoading} onClick={() => refreshCreditLedgers()}>
              刷新
            </button>
          </div>

          {creditLedgerLoading ? (
            <p className="bm-loading">加载中…</p>
          ) : creditLedgerError ? (
            <p className="bm-error">{creditLedgerError}</p>
          ) : !creditLedgers.length ? (
            <p className="bm-empty">暂无流水记录</p>
          ) : (
            <div className="bm-table" role="table" aria-label="积分流水列表">
              <div className="bm-tr bm-th" role="row">
                <div className="bm-td bm-col-amt" role="columnheader">变动</div>
                <div className="bm-td bm-col-kind" role="columnheader">类型</div>
                <div className="bm-td bm-col-reason" role="columnheader">原因</div>
                <div className="bm-td bm-col-time" role="columnheader">时间</div>
              </div>
              {creditLedgers.map((row) => (
                <div key={row.id} className="bm-tr" role="row">
                  <div className={`bm-td bm-col-amt${row.amount > 0 ? ' pos' : ''}${row.amount < 0 ? ' neg' : ''}`} role="cell">
                    {row.amount > 0 ? `+${num(row.amount)}` : num(row.amount)}
                  </div>
                  <div className="bm-td bm-col-kind" role="cell">{ledgerKindLabel(row.kind)}</div>
                  <div className="bm-td bm-col-reason" role="cell">{row.reason || '-'}</div>
                  <div className="bm-td bm-col-time" role="cell">{timeText(row.created_at)}</div>
                </div>
              ))}
            </div>
          )}

          <div className="bm-pager">
            <button type="button" className="bm-page-btn" disabled={!hasLedgerPrev || creditLedgerLoading} onClick={goLedgerPrev}>
              上一页
            </button>
            <span className="bm-page-meta">第 {Math.floor(creditLedgerOffset / creditLedgerLimit) + 1} 页</span>
            <button type="button" className="bm-page-btn" disabled={!hasLedgerNext || creditLedgerLoading} onClick={goLedgerNext}>
              下一页
            </button>
          </div>
        </section>
      ) : view === 'orders' ? (
        <section className="bm-list" aria-label="订单记录">
          <div className="bm-list-toolbar">
            <div className="bm-filters">
              <select
                className="bm-select"
                value={paymentOrderType}
                onChange={(e) => refreshPaymentOrders({ type: e.target.value, offset: 0 })}
              >
                {orderTypeOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <select
                className="bm-select"
                value={paymentOrderStatus}
                onChange={(e) => refreshPaymentOrders({ status: e.target.value, offset: 0 })}
              >
                {orderStatusOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <select
                className="bm-select"
                value={paymentOrderLimit}
                onChange={(e) => refreshPaymentOrders({ limit: Number(e.target.value), offset: 0 })}
              >
                <option value={10}>10/页</option>
                <option value={20}>20/页</option>
                <option value={50}>50/页</option>
              </select>
            </div>
            <button type="button" className="bm-refresh" disabled={paymentOrderLoading} onClick={() => refreshPaymentOrders()}>
              刷新
            </button>
          </div>

          {paymentOrderLoading ? (
            <p className="bm-loading">加载中…</p>
          ) : paymentOrderError ? (
            <p className="bm-error">{paymentOrderError}</p>
          ) : !paymentOrders.length ? (
            <p className="bm-empty">暂无订单记录</p>
          ) : (
            <div className="bm-table" role="table" aria-label="订单列表">
              <div className="bm-tr bm-th" role="row">
                <div className="bm-td bm-col-ord" role="columnheader">订单</div>
                <div className="bm-td bm-col-type" role="columnheader">类型</div>
                <div className="bm-td bm-col-status" role="columnheader">状态</div>
                <div className="bm-td bm-col-time" role="columnheader">时间</div>
              </div>
              {paymentOrders.map((row) => (
                <div key={row.id} className="bm-tr" role="row">
                  <div className="bm-td bm-col-ord" role="cell">
                    <div className="bm-order-main">
                      <span className="bm-order-amt">¥{yuan(row.amount_cents, 2)}</span>
                      {row.credits ? <span className="bm-order-credits">{num(row.credits)} 积分</span> : null}
                    </div>
                    <div className="bm-order-sub">#{row.id} {row.provider_trade_no ? `· ${row.provider_trade_no}` : ''}</div>
                  </div>
                  <div className="bm-td bm-col-type" role="cell">{orderTypeLabel(row.type)}</div>
                  <div className={`bm-td bm-col-status st-${row.status || 'unknown'}`} role="cell">
                    {orderStatusLabel(row.status)}
                  </div>
                  <div className="bm-td bm-col-time" role="cell">{timeText(row.created_at)}</div>
                </div>
              ))}
            </div>
          )}

          <div className="bm-pager">
            <button type="button" className="bm-page-btn" disabled={!hasOrderPrev || paymentOrderLoading} onClick={goOrderPrev}>
              上一页
            </button>
            <span className="bm-page-meta">第 {Math.floor(paymentOrderOffset / paymentOrderLimit) + 1} 页</span>
            <button type="button" className="bm-page-btn" disabled={!hasOrderNext || paymentOrderLoading} onClick={goOrderNext}>
              下一页
            </button>
          </div>
        </section>
      ) : view === 'admin' ? (
        <BillingAdminPanel workspaceId={workspaceId} onToast={props.onToast} />
      ) : null}

      {/* 积分购买弹窗 */}
      {view === 'credits' && (
        <div className="bm-scrim" onClick={(e) => { if (e.target === e.currentTarget) setView('plans') }}>
          <div className="bm-dialog" role="dialog" aria-modal="true" aria-label="购买积分">
            <button type="button" className="bm-dialog-close" aria-label="关闭" onClick={() => setView('plans')}>
              <svg width="22" height="22" viewBox="0 0 30 30" fill="none" aria-hidden="true">
                <path
                  d="M27.1377 9.89941C26.4756 8.33789 25.5322 6.93457 24.3252 5.73047C23.1211 4.52637 21.7178 3.58008 20.1562 2.91797C18.5391 2.23242 16.8193 1.88672 15.0498 1.88672C13.2803 1.88672 11.5605 2.23242 9.94043 2.91797C8.37891 3.58008 6.97559 4.52344 5.77148 5.73047C4.56738 6.93457 3.62109 8.33789 2.95898 9.89941C2.27344 11.5166 1.92773 13.2363 1.92773 15.0059C1.92773 16.7754 2.27344 18.4951 2.95898 20.1123C3.62109 21.6738 4.56445 23.0771 5.77148 24.2812C6.97559 25.4853 8.37891 26.4316 9.94043 27.0937C11.5576 27.7793 13.2773 28.125 15.0469 28.125C16.8164 28.125 18.5361 27.7793 20.1533 27.0937C21.7148 26.4316 23.1182 25.4883 24.3223 24.2812C25.5264 23.0771 26.4727 21.6738 27.1348 20.1123C27.8203 18.4951 28.166 16.7754 28.166 15.0059C28.1689 13.2363 27.8203 11.5166 27.1377 9.89941ZM15.0498 25.7549C9.12305 25.7549 4.30078 20.9326 4.30078 15.0059C4.30078 9.0791 9.12305 4.25684 15.0498 4.25684C20.9766 4.25684 25.7988 9.0791 25.7988 15.0059C25.7988 20.9326 20.9766 25.7549 15.0498 25.7549Z"
                  fill="currentColor"
                />
                <path
                  d="M20.4463 9.6416C19.9893 9.18457 19.2451 9.18457 18.7881 9.6416L15.0293 13.4004L11.2705 9.6416C10.8135 9.18457 10.0693 9.18457 9.6123 9.6416C9.15527 10.0986 9.15527 10.8428 9.6123 11.2998L13.3711 15.0586L9.6123 18.8174C9.15527 19.2744 9.15527 20.0186 9.6123 20.4756C10.0693 20.9326 10.8135 20.9326 11.2705 20.4756L15.0293 16.7168L18.7881 20.4756C19.2451 20.9326 19.9893 20.9326 20.4463 20.4756C20.9033 20.0186 20.9033 19.2744 20.4463 18.8174L16.6875 15.0586L20.4463 11.2998C20.9033 10.8428 20.9033 10.0957 20.4463 9.6416Z"
                  fill="currentColor"
                />
              </svg>
            </button>

            <div className="bm-dialog-head">
              <span className="bm-avatar bm-avatar--sm" aria-hidden="true">{avatarInitial}</span>
              <span className="bm-dialog-name">{userName}</span>
              <span className="bm-dialog-wallet">
                <svg className="bm-bolt" width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
                  <path
                    d="M15.5787 8.52973H11.3028L13.2124 3.09333C13.494 2.29131 12.4261 1.71038 11.8827 2.37059L5.59939 10.0107C5.04037 10.6906 5.53257 11.7032 6.42224 11.7032H9.9764L7.20341 18.8843C6.89361 19.6864 7.96461 20.2963 8.51955 19.6341L16.3953 10.2285C16.9627 9.55067 16.4724 8.52973 15.5787 8.52973Z"
                    fill="url(#bm-bolt-grad)"
                  />
                </svg>
                <span className="bm-dialog-wallet-label">剩余积分</span>
                <strong>{num(availableCredits)}</strong>
                <span className="bm-wallet-unit">积分</span>
              </span>
            </div>

            <div className="bm-packs">
              {packages.map((pkg) => (
                <button
                  key={pkg.id}
                  type="button"
                  className={`bm-pack${pkg.id === selectedPackageId ? ' selected' : ''}`}
                  onClick={() => selectPackage(pkg)}
                >
                  <span className="bm-pack-credits">
                    <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden="true">
                      <path
                        d="M18.4108 10.0805H13.3576L15.6143 3.6557C15.9471 2.70787 14.685 2.0213 14.0428 2.80156L6.61711 11.8307C5.95644 12.6343 6.53814 13.831 7.58957 13.831H11.7899L8.51277 22.3178C8.14664 23.2656 9.41236 23.9865 10.0682 23.2039L19.3759 12.0882C20.0465 11.2871 19.467 10.0805 18.4108 10.0805Z"
                        fill="url(#bm-pack-grad)"
                      />
                      <defs>
                        <linearGradient
                          id="bm-pack-grad"
                          x1="13"
                          y1="2.46"
                          x2="13"
                          y2="23.54"
                          gradientUnits="userSpaceOnUse"
                        >
                          <stop stopColor="#C27AFF" />
                          <stop offset="1" stopColor="#5B6BE8" />
                        </linearGradient>
                      </defs>
                    </svg>
                    <strong>{num(pkg.credits)}</strong>
                    <span>积分</span>
                  </span>
                  <span className="bm-pack-price">¥{yuan(pkg.amount_cents, 2)}</span>
                </button>
              ))}
            </div>

            <p className="bm-pack-note">积分不可兑换会员，不可转增与提现，不支持退换。</p>

            <div className="bm-pay">
              <div className="bm-pay-left">
                <p className="bm-pay-amount">
                  <span className="bm-pay-cur">¥</span>
                  <span className="bm-pay-num">{yuan(selectedPackage?.amount_cents)}</span>
                </p>
                <p className="bm-pay-hint">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path
                      d="M12.3973 16H3.60267C1.62133 16 0 14.3787 0 12.3973V3.60267C0 1.62133 1.62133 0 3.60267 0H12.3973C14.3787 0 16 1.62133 16 3.60267V12.3973C16 14.3787 14.3787 16 12.3973 16Z"
                      fill="#57B74B"
                    />
                    <path
                      d="M6.18544 9.99069L4.86211 6.1307L6.70944 7.53736L12.6134 4.8227C11.5968 3.5827 9.91011 2.77136 8.00011 2.77136C4.89477 2.77136 2.37744 4.91603 2.37744 7.56203C2.37744 9.18336 3.32211 10.6154 4.76744 11.4827L4.30477 13.1147L6.25944 12.1194C6.80744 12.2714 7.39278 12.3534 8.00011 12.3534C11.1061 12.3534 13.6234 10.2087 13.6234 7.5627C13.6214 6.78745 13.4055 6.0278 12.9994 5.36736L6.18677 9.99069H6.18544Z"
                      fill="white"
                    />
                  </svg>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path
                      d="M16.0008 10.9536V3.076C16.0004 2.26019 15.6761 1.47792 15.0991 0.901125C14.5222 0.324332 13.7398 0.000211955 12.924 0L3.076 0C2.26032 0.000423948 1.47818 0.324638 0.901408 0.901408C0.324638 1.47818 0.000423948 2.26032 0 3.076V12.924C0.000212074 13.7397 0.324358 14.522 0.901174 15.0988C1.47799 15.6756 2.26026 15.9998 3.076 16H12.924C13.6456 15.9995 14.3441 15.7456 14.8976 15.2827C15.4512 14.8198 15.8246 14.1773 15.9528 13.4672C15.1368 13.1136 11.6008 11.5872 9.7584 10.7072C8.3568 12.4056 6.888 13.4248 4.6752 13.4248C2.4624 13.4248 0.9848 12.0616 1.1624 10.3928C1.2792 9.2984 2.0304 7.5088 5.292 7.8152C7.012 7.9768 7.7984 8.2976 9.2008 8.7608C9.5632 8.0952 9.8648 7.3632 10.0936 6.5848H3.876V5.9688H6.9528V4.8616H3.2V4.184H6.952V2.588C6.952 2.588 6.9856 2.3384 7.2616 2.3384H8.8V4.184H12.8V4.8624H8.8V5.968H12.0632C11.7817 7.13317 11.3354 8.2522 10.7376 9.2912C11.6856 9.6352 16 10.9536 16 10.9536H16.0008Z"
                      fill="#009FE8"
                    />
                  </svg>
                  请使用微信或支付宝扫码支付
                </p>
                <label className="bm-agree">
                  <input checked={agreed} onChange={(e) => setAgreed(e.target.checked)} type="checkbox" />
                  <span>我已阅读并同意 <a href="#" onClick={(e) => e.preventDefault()}>《帧智汇AI付费服务协议》</a></span>
                </label>
              </div>

              <div className="bm-qr">
                {qrPayUrl ? (
                  <QRCodeCanvas value={qrPayUrl} size={200} marginSize={1} fgColor="#333333" bgColor="#ffffff" />
                ) : (
                  <div className={`bm-qr-placeholder${qrLoading ? ' is-loading' : ''}`}>
                    {qrLoading ? (
                      <span>生成中…</span>
                    ) : (
                      <button type="button" className="bm-qr-gen" disabled={!selectedPackage} onClick={refreshQrAndPoll}>
                        生成支付二维码
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 套餐购买弹窗（点击"立即开通"进入，和购买积分流程一致） */}
      {view === 'planPurchase' && (
        <div className="bm-scrim" onClick={(e) => { if (e.target === e.currentTarget) setView('plans') }}>
          <div className="bm-dialog" role="dialog" aria-modal="true" aria-label="开通套餐">
            <button type="button" className="bm-dialog-close" aria-label="关闭" onClick={() => setView('plans')}>
              <svg width="22" height="22" viewBox="0 0 30 30" fill="none" aria-hidden="true">
                <path d="M27.1377 9.89941C26.4756 8.33789 25.5322 6.93457 24.3252 5.73047C23.1211 4.52637 21.7178 3.58008 20.1562 2.91797C18.5391 2.23242 16.8193 1.88672 15.0498 1.88672C13.2803 1.88672 11.5605 2.23242 9.94043 2.91797C8.37891 3.58008 6.97559 4.52344 5.77148 5.73047C4.56738 6.93457 3.62109 8.33789 2.95898 9.89941C2.27344 11.5166 1.92773 13.2363 1.92773 15.0059C1.92773 16.7754 2.27344 18.4951 2.95898 20.1123C3.62109 21.6738 4.56445 23.0771 5.77148 24.2812C6.97559 25.4853 8.37891 26.4316 9.94043 27.0937C11.5576 27.7793 13.2773 28.125 15.0469 28.125C16.8164 28.125 18.5361 27.7793 20.1533 27.0937C21.7148 26.4316 23.1182 25.4883 24.3223 24.2812C25.5264 23.0771 26.4727 21.6738 27.1348 20.1123C27.8203 18.4951 28.166 16.7754 28.166 15.0059C28.1689 13.2363 27.8203 11.5166 27.1377 9.89941ZM15.0498 25.7549C9.12305 25.7549 4.30078 20.9326 4.30078 15.0059C4.30078 9.0791 9.12305 4.25684 15.0498 4.25684C20.9766 4.25684 25.7988 9.0791 25.7988 15.0059C25.7988 20.9326 20.9766 25.7549 15.0498 25.7549Z" fill="currentColor"/>
                <path d="M20.4463 9.6416C19.9893 9.18457 19.2451 9.18457 18.7881 9.6416L15.0293 13.4004L11.2705 9.6416C10.8135 9.18457 10.0693 9.18457 9.6123 9.6416C9.15527 10.0986 9.15527 10.8428 9.6123 11.2998L13.3711 15.0586L9.6123 18.8174C9.15527 19.2744 9.15527 20.0186 9.6123 20.4756C10.0693 20.9326 10.8135 20.9326 11.2705 20.4756L15.0293 16.7168L18.7881 20.4756C19.2451 20.9326 19.9893 20.9326 20.4463 20.4756C20.9033 20.0186 20.9033 19.2744 20.4463 18.8174L16.6875 15.0586L20.4463 11.2998C20.9033 10.8428 20.9033 10.0957 20.4463 9.6416Z" fill="currentColor"/>
              </svg>
            </button>

            <div className="bm-dialog-head">
              <span className="bm-avatar bm-avatar--sm" aria-hidden="true">{avatarInitial}</span>
              <span className="bm-dialog-name">{userName}</span>
              <span className="bm-dialog-wallet">
                <span className="bm-dialog-wallet-label">开通套餐</span>
                <strong>{purchasingPlan?.name || ''}</strong>
              </span>
            </div>

            {/* 套餐详情 */}
            <div className="bm-pack-note">
              {purchasingPlan?.name} · ¥{yuan(purchasingPlan?.price_cents)}/{periodLabel(purchasingPlan?.period)}
              {purchasingPlan?.base_credits ? <> · {num(purchasingPlan.base_credits)}积分/{periodLabel(purchasingPlan?.period)}</> : null}
            </div>

            {/* 支付区：QR 码 + 团队邀请码 */}
            <div className="bm-pay">
              <div className="bm-pay-left">
                <p className="bm-pay-amount">
                  <span className="bm-pay-cur">¥</span>
                  <span className="bm-pay-num">{yuan(purchasingPlan?.price_cents)}</span>
                </p>
                <p className="bm-pay-hint">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M12.3973 16H3.60267C1.62133 16 0 14.3787 0 12.3973V3.60267C0 1.62133 1.62133 0 3.60267 0H12.3973C14.3787 0 16 1.62133 16 3.60267V12.3973C16 14.3787 14.3787 16 12.3973 16Z" fill="#57B74B"/>
                    <path d="M6.18544 9.99069L4.86211 6.1307L6.70944 7.53736L12.6134 4.8227C11.5968 3.5827 9.91011 2.77136 8.00011 2.77136C4.89477 2.77136 2.37744 4.91603 2.37744 7.56203C2.37744 9.18336 3.32211 10.6154 4.76744 11.4827L4.30477 13.1147L6.25944 12.1194C6.80744 12.2714 7.39278 12.3534 8.00011 12.3534C11.1061 12.3534 13.6234 10.2087 13.6234 7.5627C13.6214 6.78745 13.4055 6.0278 12.9994 5.36736L6.18677 9.99069H6.18544Z" fill="white"/>
                  </svg>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M16.0008 10.9536V3.076C16.0004 2.26019 15.6761 1.47792 15.0991 0.901125C14.5222 0.324332 13.7398 0.000211955 12.924 0L3.076 0C2.26032 0.000423948 1.47818 0.324638 0.901408 0.901408C0.324638 1.47818 0.000423948 2.26032 0 3.076V12.924C0.000212074 13.7397 0.324358 14.522 0.901174 15.0988C1.47799 15.6756 2.26026 15.9998 3.076 16H12.924C13.6456 15.9995 14.3441 15.7456 14.8976 15.2827C15.4512 14.8198 15.8246 14.1773 15.9528 13.4672C15.1368 13.1136 11.6008 11.5872 9.7584 10.7072C8.3568 12.4056 6.888 13.4248 4.6752 13.4248C2.4624 13.4248 0.9848 12.0616 1.1624 10.3928C1.2792 9.2984 2.0304 7.5088 5.292 7.8152C7.012 7.9768 7.7984 8.2976 9.2008 8.7608C9.5632 8.0952 9.8648 7.3632 10.0936 6.5848H3.876V5.9688H6.9528V4.8616H3.2V4.184H6.952V2.588C6.952 2.588 6.9856 2.3384 7.2616 2.3384H8.8V4.184H12.8V4.8624H8.8V5.968H12.0632C11.7817 7.13317 11.3354 8.2522 10.7376 9.2912C11.6856 9.6352 16 10.9536 16 10.9536H16.0008Z" fill="#009FE8"/>
                  </svg>
                  请使用微信或支付宝扫码支付
                </p>
                <label className="bm-agree">
                  <input checked={agreed} onChange={(e) => setAgreed(e.target.checked)} type="checkbox" />
                  <span>我已阅读并同意 <a href="#" onClick={(e) => e.preventDefault()}>《帧智汇AI付费服务协议》</a></span>
                </label>
              </div>

              <div className="bm-qr">
                {planQrPayUrl ? (
                  <QRCodeCanvas value={planQrPayUrl} size={200} marginSize={1} fgColor="#333333" bgColor="#ffffff" />
                ) : (
                  <div className={`bm-qr-placeholder${planQrLoading ? ' is-loading' : ''}`}>
                    {planQrLoading ? (
                      <span>生成中…</span>
                    ) : (
                      <button type="button" className="bm-qr-gen" disabled={!purchasingPlan} onClick={refreshPlanQr}>
                        生成支付二维码
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* 团队邀请码展示区：仅团队套餐支付成功后显示 */}
            {planPaid && isTeamPlan && (
              <div className="bm-invite">
                <p className="bm-invite-label">团队邀请码</p>
                <div className="bm-invite-row">
                  <strong className="bm-invite-code">{formatInviteCode(planInviteCode) || '—'}</strong>
                  {planInviteCode && (
                    <button
                      type="button"
                      className="bm-invite-copy"
                      onClick={() => navigator.clipboard.writeText(planInviteCode).then(() => emitToast('已复制邀请码', 'success'))}
                    >
                      复制
                    </button>
                  )}
                </div>
                <p className="bm-invite-hint">将此邀请码发送给团队成员，即可加入团队空间</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
