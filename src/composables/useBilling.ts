import { useCallback, useMemo, useRef, useState } from 'react'
import {
  cancelSubscription as cancelSubscriptionRequest,
  createRechargeOrder,
  createSubscriptionSignUrl,
  getSubscription,
  getWallet,
  listBillingPlans,
  listCreditLedgers,
  listCreditPackages,
  listPaymentOrders,
} from '@/api/business'

// Payment is delegated to Alipay: the backend returns a signed gateway URL
// which we open in a new tab, then we poll wallet/subscription until the
// async notify credits the workspace server-side.

const POLL_INTERVAL_MS = 3000
const POLL_TIMEOUT_MS = 3 * 60 * 1000

const settledOr = <T>(result: PromiseSettledResult<T>, fallback: T): T =>
  result.status === 'fulfilled' ? (result.value ?? fallback) : fallback
const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))

export function useBilling(getWorkspaceId: () => number) {
  const [plans, setPlans] = useState<any[]>([])
  const [packages, setPackages] = useState<any[]>([])
  const [subscription, setSubscription] = useState<any>(null)
  const [wallet, setWallet] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [purchasing, setPurchasing] = useState(false)
  const [cancelingSubscription, setCancelingSubscription] = useState(false)
  const [error, setError] = useState('')

  const [creditLedgers, setCreditLedgers] = useState<any[]>([])
  const [creditLedgerKind, setCreditLedgerKind] = useState('')
  const [creditLedgerLimit, setCreditLedgerLimit] = useState(20)
  const [creditLedgerOffset, setCreditLedgerOffset] = useState(0)
  const [creditLedgerLoading, setCreditLedgerLoading] = useState(false)
  const [creditLedgerError, setCreditLedgerError] = useState('')

  const [paymentOrders, setPaymentOrders] = useState<any[]>([])
  const [paymentOrderType, setPaymentOrderType] = useState('')
  const [paymentOrderStatus, setPaymentOrderStatus] = useState('')
  const [paymentOrderLimit, setPaymentOrderLimit] = useState(20)
  const [paymentOrderOffset, setPaymentOrderOffset] = useState(0)
  const [paymentOrderLoading, setPaymentOrderLoading] = useState(false)
  const [paymentOrderError, setPaymentOrderError] = useState('')

  // 轮询 / 并发锁内部状态：用 ref 读取最新值，避免闭包拿到旧 state。
  const cancelledRef = useRef(false)
  const purchasingRef = useRef(false)
  const walletRef = useRef<any>(null)
  const subscriptionRef = useRef<any>(null)
  // 镜像分页游标/过滤项，供回调读取最新值。
  const creditLedgerKindRef = useRef('')
  const creditLedgerLimitRef = useRef(20)
  const creditLedgerOffsetRef = useRef(0)
  const paymentOrderTypeRef = useRef('')
  const paymentOrderStatusRef = useRef('')
  const paymentOrderLimitRef = useRef(20)
  const paymentOrderOffsetRef = useRef(0)

  const setWalletBoth = useCallback((value: any) => {
    walletRef.current = value
    setWallet(value)
  }, [])
  const setSubscriptionBoth = useCallback((value: any) => {
    subscriptionRef.current = value
    setSubscription(value)
  }, [])

  const workspaceId = useCallback(() => Number(getWorkspaceId?.()) || 0, [getWorkspaceId])
  const requireWorkspaceId = useCallback(() => {
    const id = workspaceId()
    if (!id) throw new Error('当前没有可用的空间')
    return id
  }, [workspaceId])

  const availableCreditsValue = () => Number(walletRef.current?.available ?? 0)
  const availableCredits = useMemo(() => Number(wallet?.available ?? 0), [wallet])
  const activePlanCode = useMemo(
    () => (subscription?.active ? subscription.plan_code || '' : ''),
    [subscription],
  )
  const hasLedgerPrev = creditLedgerOffset > 0
  const hasLedgerNext = creditLedgers.length >= creditLedgerLimit
  const hasOrderPrev = paymentOrderOffset > 0
  const hasOrderNext = paymentOrders.length >= paymentOrderLimit

  const refresh = useCallback(async () => {
    const id = workspaceId()
    setLoading(true)
    setError('')
    try {
      const [planList, pkgList, sub, wal] = await Promise.allSettled([
        listBillingPlans(),
        listCreditPackages(),
        id ? getSubscription(id) : Promise.resolve(null),
        id ? getWallet(id) : Promise.resolve(null),
      ])
      setPlans(settledOr(planList, []))
      setPackages(settledOr(pkgList, []))
      setSubscriptionBoth(settledOr(sub, null))
      setWalletBoth(settledOr(wal, null))
    } catch (err: any) {
      setError(err?.message || '加载计费信息失败')
    } finally {
      setLoading(false)
    }
  }, [workspaceId, setSubscriptionBoth, setWalletBoth])

  const refreshCreditLedgers = useCallback(
    async ({ kind, limit, offset }: { kind?: string; limit?: number; offset?: number } = {}) => {
      const id = workspaceId()
      setCreditLedgerLoading(true)
      setCreditLedgerError('')
      try {
        if (!id) {
          setCreditLedgers([])
          return
        }
        if (kind !== undefined) {
          creditLedgerKindRef.current = String(kind || '')
          setCreditLedgerKind(creditLedgerKindRef.current)
        }
        if (limit !== undefined) {
          creditLedgerLimitRef.current = Number(limit) || 20
          setCreditLedgerLimit(creditLedgerLimitRef.current)
        }
        if (offset !== undefined) {
          creditLedgerOffsetRef.current = Math.max(0, Number(offset) || 0)
          setCreditLedgerOffset(creditLedgerOffsetRef.current)
        }
        const rows = await listCreditLedgers({
          workspaceId: id,
          kind: creditLedgerKindRef.current,
          limit: creditLedgerLimitRef.current,
          offset: creditLedgerOffsetRef.current,
        } as any)
        setCreditLedgers(rows)
      } catch (err: any) {
        setCreditLedgerError(err?.message || '加载积分流水失败')
      } finally {
        setCreditLedgerLoading(false)
      }
    },
    [workspaceId],
  )

  const refreshPaymentOrders = useCallback(
    async ({
      type,
      status,
      limit,
      offset,
    }: { type?: string; status?: string; limit?: number; offset?: number } = {}) => {
      const id = workspaceId()
      setPaymentOrderLoading(true)
      setPaymentOrderError('')
      try {
        if (!id) {
          setPaymentOrders([])
          return
        }
        if (type !== undefined) {
          paymentOrderTypeRef.current = String(type || '')
          setPaymentOrderType(paymentOrderTypeRef.current)
        }
        if (status !== undefined) {
          paymentOrderStatusRef.current = String(status || '')
          setPaymentOrderStatus(paymentOrderStatusRef.current)
        }
        if (limit !== undefined) {
          paymentOrderLimitRef.current = Number(limit) || 20
          setPaymentOrderLimit(paymentOrderLimitRef.current)
        }
        if (offset !== undefined) {
          paymentOrderOffsetRef.current = Math.max(0, Number(offset) || 0)
          setPaymentOrderOffset(paymentOrderOffsetRef.current)
        }
        const rows = await listPaymentOrders({
          workspaceId: id,
          type: paymentOrderTypeRef.current,
          status: paymentOrderStatusRef.current,
          limit: paymentOrderLimitRef.current,
          offset: paymentOrderOffsetRef.current,
        } as any)
        setPaymentOrders(rows)
      } catch (err: any) {
        setPaymentOrderError(err?.message || '加载订单记录失败')
      } finally {
        setPaymentOrderLoading(false)
      }
    },
    [workspaceId],
  )

  const goLedgerPrev = useCallback(
    () =>
      refreshCreditLedgers({
        offset: Math.max(0, creditLedgerOffsetRef.current - creditLedgerLimitRef.current),
      }),
    [refreshCreditLedgers],
  )
  const goLedgerNext = useCallback(
    () => refreshCreditLedgers({ offset: creditLedgerOffsetRef.current + creditLedgerLimitRef.current }),
    [refreshCreditLedgers],
  )
  const goOrderPrev = useCallback(
    () =>
      refreshPaymentOrders({
        offset: Math.max(0, paymentOrderOffsetRef.current - paymentOrderLimitRef.current),
      }),
    [refreshPaymentOrders],
  )
  const goOrderNext = useCallback(
    () => refreshPaymentOrders({ offset: paymentOrderOffsetRef.current + paymentOrderLimitRef.current }),
    [refreshPaymentOrders],
  )

  const cancelPoll = useCallback(() => {
    cancelledRef.current = true
  }, [])

  // Polls refresh() until isSettled(), timeout, or cancel. The caller already
  // holds the purchasing lock; this only runs the loop.
  const pollLoop = useCallback(
    async (isSettled: () => boolean) => {
      const deadline = Date.now() + POLL_TIMEOUT_MS
      while (!cancelledRef.current && Date.now() < deadline) {
        await sleep(POLL_INTERVAL_MS)
        if (cancelledRef.current) break
        await refresh()
        if (isSettled()) return { settled: true }
      }
      return { settled: false }
    },
    [refresh],
  )

  // Runs `body` under the purchasing lock so concurrent purchases can't create
  // duplicate orders or race the same balance snapshot. The lock is held from
  // BEFORE order creation through the end of polling. Returns
  // { settled: false, busy: true } if a purchase is already in flight.
  const exclusive = useCallback(async (body: () => Promise<any>) => {
    if (purchasingRef.current) return { settled: false, busy: true }
    purchasingRef.current = true
    setPurchasing(true)
    cancelledRef.current = false
    try {
      return await body()
    } finally {
      purchasingRef.current = false
      setPurchasing(false)
    }
  }, [])

  // Opens the Alipay gateway in a new tab, then polls. Returns:
  //   { settled }                    — poll finished (true = credited)
  //   { blocked, payUrl }            — popup blocked; caller offers manual link
  //   { settled: false, busy: true } — another purchase already running
  const runPurchase = useCallback(
    (createUrl: (id: number) => Promise<string | undefined>, isSettled: () => boolean) =>
      exclusive(async () => {
        const payUrl = await createUrl(requireWorkspaceId())
        if (payUrl) {
          const win = window.open(payUrl, '_blank', 'noopener,noreferrer')
          if (!win) return { blocked: true, payUrl }
        }
        return pollLoop(isSettled)
      }),
    [exclusive, requireWorkspaceId, pollLoop],
  )

  // Subscribes to a plan: poll the subscription until plan_code activates.
  const subscribePlan = useCallback(
    (plan: any) =>
      runPurchase(
        (id) => createSubscriptionSignUrl({ workspaceId: id, planId: plan.id }).then((r: any) => r?.sign_url),
        () => !!subscriptionRef.current?.active && subscriptionRef.current.plan_code === plan.code,
      ),
    [runPurchase],
  )

  const cancelSubscription = useCallback(async () => {
    const id = requireWorkspaceId()
    const subscriptionId = Number(subscriptionRef.current?.id || 0)
    if (!subscriptionRef.current?.active) {
      throw new Error('当前没有可取消的有效订阅')
    }
    if (!subscriptionId) {
      throw new Error('当前订阅未返回订阅ID，暂时无法取消，请联系后端补充返回字段')
    }
    if (purchasingRef.current) {
      // 占位保持与原逻辑一致：cancelingSubscription 由独立标志控制
    }
    if (cancelingSubscription) {
      return { busy: true }
    }
    setCancelingSubscription(true)
    try {
      await cancelSubscriptionRequest({ workspaceId: id, subscriptionId })
      await refresh()
      return { canceled: true }
    } finally {
      setCancelingSubscription(false)
    }
  }, [requireWorkspaceId, cancelingSubscription, refresh])

  // Recharges via the open-tab flow: poll the wallet until the balance grows.
  const rechargePackage = useCallback(
    (pkg: any) => {
      const before = availableCreditsValue()
      return runPurchase(
        (id) => createRechargeOrder({ workspaceId: id, creditPackageId: pkg.id }).then((r: any) => r?.pay_url),
        () => availableCreditsValue() > before,
      )
    },
    [runPurchase],
  )

  // QR recharge flow: creates ONE recharge order and returns its pay_url for the
  // caller to render as a scannable QR, plus poll() that watches the wallet
  // until the scanned payment lands (reusing the same order — no second order,
  // no tab). Order creation runs under the purchasing lock so it can't race
  // other purchases; poll() then re-takes the lock for the watch loop. Returns
  // { busy: true } if a purchase is already running.
  const startRechargeViaQr = useCallback(
    (pkg: any) => {
      const before = availableCreditsValue()
      return exclusive(async () => {
        const res: any = await createRechargeOrder({
          workspaceId: requireWorkspaceId(),
          creditPackageId: pkg.id,
        })
        const payUrl = res?.pay_url || ''
        if (!payUrl) throw new Error('未获取到支付链接')
        return {
          payUrl,
          poll: () => exclusive(() => pollLoop(() => availableCreditsValue() > before)),
        }
      })
    },
    [exclusive, requireWorkspaceId, pollLoop],
  )

  // 团队套餐 QR 购买：创建订阅签约链接 → 生成支付二维码 → 轮询订阅状态。
  // 轮询期间只调 getSubscription（轻量），不触发 plans/wallet 刷新，避免页面每3秒闪烁。
  // 支付确认后再调一次完整 refresh() 同步全部计费信息。
  const startTeamPlanViaQr = useCallback(
    (plan: any) =>
      exclusive(async () => {
        const res: any = await createSubscriptionSignUrl({
          workspaceId: requireWorkspaceId(),
          planId: plan.id,
        })
        const payUrl = res?.sign_url || ''
        if (!payUrl) throw new Error('未获取到支付链接')
        return {
          payUrl,
          poll: () =>
            exclusive(async () => {
              const id = requireWorkspaceId()
              const deadline = Date.now() + POLL_TIMEOUT_MS
              while (!cancelledRef.current && Date.now() < deadline) {
                await sleep(POLL_INTERVAL_MS)
                if (cancelledRef.current) break
                try {
                  const sub = await getSubscription(id)
                  if (sub && typeof sub === 'object') {
                    setSubscriptionBoth(sub)
                  }
                } catch {
                  // 单次查询失败忽略，下一轮继续重试
                }
                if (
                  subscriptionRef.current?.active &&
                  subscriptionRef.current.plan_code === plan.code
                ) {
                  await refresh()
                  return { settled: true }
                }
              }
              return { settled: false }
            }),
        }
      }),
    [exclusive, requireWorkspaceId, refresh, setSubscriptionBoth],
  )

  return {
    plans,
    packages,
    subscription,
    wallet,
    loading,
    purchasing,
    cancelingSubscription,
    error,
    availableCredits,
    activePlanCode,
    refresh,
    cancelPoll,
    subscribePlan,
    cancelSubscription,
    rechargePackage,
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
  }
}
