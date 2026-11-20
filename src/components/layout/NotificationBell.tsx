/**
 * 顶栏通知铃铛（设计稿「通知」下拉）。
 *
 * 积分申请通知由服务端推送并保存已读状态，其他通知保留各自的业务来源与本地已读状态。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listDemandApplications, listMyApplications, listMyDemands, formatDemandDate } from '@/api/market'
import { getApplication, listApplications, type Application } from '@/api/studentApplications'
import type { CreditNotification } from '@/api/creditNotifications'
import { withRequestTimeout } from '@/api/requestTimeout'
import { useToast } from '@/composables/useToast'
import { formatCredits } from '@/utils/creditsFormat'
import { MANUAL_DELIVERY_ENABLED, PROMO_DELIVERY_ENABLED } from '@/utils/manualDeliveryVisibility'
import { loadManualDeliveryNotifications, loadPromoDeliveryNotifications } from './deliveryNotifications'
import { useCreditNotifications } from './useCreditNotifications'
import DeliveryNotificationDetail from './DeliveryNotificationDetail'
import './NotificationBell.css'

export interface NotificationItem {
  key: string
  title: string
  text: string
  tone: 'success' | 'info' | 'warning'
  href: string
  /** 排序与未读判断用的毫秒时间戳（解析失败为 0，视为已读旧消息） */
  ts: number
  dateLabel: string
  delivery?: { kind: 't1' | 't5'; id: number }
  credit?: CreditNotification
}

const READ_STORAGE_PREFIX = 'zzh-market-notify-read:v2:'

/** 「收到新申请」轮询的需求条数上限，避免铃铛为长列表打出请求风暴。 */
const RECEIVED_APPLICATION_DEMAND_LIMIT = 10
const NOTIFICATION_LOAD_TIMEOUT_MS = 12_000

function tsOf(value: string): number {
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

function creditNotificationItem(credit: CreditNotification): NotificationItem {
  const amount = `${formatCredits(credit.amount, 3)} 积分`
  const actor = credit.actor_name
  const workspace = credit.workspace?.name
  const received = credit.kind === 'credit_request_received'
  const approved = credit.kind === 'credit_request_approved'
  return {
    key: `credit-notification-${credit.id}`,
    title: received ? '收到积分申请' : approved ? '积分申请已通过' : '积分申请未通过',
    text: received
      ? `${actor} 向你申请 ${amount}${workspace ? `，到账空间「${workspace}」` : ''}`
      : approved
        ? `${actor} 已同意你的申请，${amount}已发放至${workspace ? `「${workspace}」` : '你的个人空间'}`
        : `${actor} 未同意你的 ${amount}申请${workspace ? `，到账空间「${workspace}」` : ''}`,
    tone: received ? 'info' : approved ? 'success' : 'warning',
    href: `/settings/credit-requests?tab=${received ? 'received' : 'sent'}&request_id=${credit.request_id}`,
    ts: tsOf(credit.created_at),
    dateLabel: formatDemandDate(credit.created_at),
    credit,
  }
}

/** 从需求/申请状态推导通知列表（新在前，最多 20 条）。导出仅供单测使用。 */
export async function loadNotifications(signal?: AbortSignal): Promise<NotificationItem[]> {
  // 任一事实来源失败时让整次刷新失败：不能把“没拉到”伪装成“确实没有通知”。
  const [demands, applications] = await Promise.all([listMyDemands({ signal }), listMyApplications({ signal })])
  const items: NotificationItem[] = []
  // 我发布的报名中需求收到的待处理申请 → 通知发布者（后端无推送，限量轮询）。
  const openDemands = demands.items
    .filter((demand) => demand.status === 'open')
    .slice(0, RECEIVED_APPLICATION_DEMAND_LIMIT)
  const receivedPages = await Promise.all(
    openDemands.map((demand) =>
      listDemandApplications(demand.id, { signal }).then((page) => ({ demand, received: page.items })),
    ),
  )
  for (const { demand, received } of receivedPages) {
    for (const application of received) {
      if (application.status !== 'pending') continue
      items.push({
        key: `app-received-${application.id}`,
        title: '收到新的接单申请',
        text: `你发布的需求「${demand.title}」收到 ${application.applicant.nickname} 的接单申请`,
        tone: 'info',
        href: `/demand/${demand.id}`,
        ts: tsOf(application.createdAt),
        dateLabel: formatDemandDate(application.createdAt),
      })
    }
  }
  for (const demand of demands.items) {
    const publishedLabel = formatDemandDate(demand.publishedAt || demand.createdAt)
    if (demand.status === 'completed') {
      const ts = tsOf(demand.completedAt || demand.publishedAt || demand.createdAt)
      items.push({
        key: `demand-completed-${demand.id}`,
        title: '需求已完成',
        text: `你于${publishedLabel}发布的需求已完成，请注意查收`,
        tone: 'success',
        href: `/demand/${demand.id}`,
        ts,
        dateLabel: formatDemandDate(demand.completedAt) || publishedLabel,
      })
    } else if (demand.status === 'in_progress' && demand.assignee) {
      const ts = tsOf(demand.publishedAt || demand.createdAt)
      items.push({
        key: `demand-progress-${demand.id}`,
        title: '需求已被接单',
        text: `你发布的需求「${demand.title}」已由 ${demand.assignee.nickname} 接单，正在制作中`,
        tone: 'info',
        href: `/demand/${demand.id}`,
        ts,
        dateLabel: publishedLabel,
      })
    }
  }
  for (const application of applications.items) {
    const title = application.demand?.title || `需求 #${application.demandId}`
    const ts = tsOf(application.respondedAt || application.createdAt)
    if (application.status === 'accepted') {
      items.push({
        key: `app-accepted-${application.id}`,
        title: '接单申请已通过',
        text: `你的接单申请已被接受：「${title}」`,
        tone: 'success',
        href: `/demand/${application.demandId}`,
        ts,
        dateLabel: formatDemandDate(application.respondedAt || application.createdAt),
      })
    } else if (application.status === 'rejected') {
      items.push({
        key: `app-rejected-${application.id}`,
        title: '接单申请未通过',
        text: `你的接单申请未被采纳：「${title}」`,
        tone: 'warning',
        href: `/demand/${application.demandId}`,
        ts,
        dateLabel: formatDemandDate(application.respondedAt || application.createdAt),
      })
    }
  }
  return items.sort((a, b) => b.ts - a.ts).slice(0, 20)
}

/** 审核意见仅由服务端真实的通过记录生成；按申请分页并限制详情并发。 */
export async function loadScriptApprovalNotifications(signal?: AbortSignal): Promise<NotificationItem[]> {
  const applications: Application[] = []
  const seenIds = new Set<number>()
  let offset = 0
  while (true) {
    const page = await listApplications(offset, {}, signal)
    if (page.items.length && page.items.every((item) => seenIds.has(item.id))) {
      throw new Error('剧本申请分页未向前推进')
    }
    page.items.forEach((item) => seenIds.add(item.id))
    applications.push(...page.items)
    offset += page.items.length
    if (!page.items.length || offset >= page.total) break
  }
  const items: NotificationItem[] = []
  const stages: Record<string, string> = {
    creative: '创意',
    draft: '一卡',
    card: '一卡',
    script: '剧本',
    revision: '完善剧本',
    final: '终稿',
  }
  for (let start = 0; start < applications.length; start += 5) {
    const details = await Promise.all(
      applications.slice(start, start + 5).map((item) => getApplication(String(item.id), signal)),
    )
    for (const detail of details) {
      if (!detail.progress_available || !detail.application?.id) continue
      const app = detail.application
      for (const review of detail.workflow?.reviews || []) {
        if (review.status !== 2) continue
        const stage =
          review.stage || detail.workflow?.versions?.find((version) => version.version === review.version)?.stage || ''
        const rawTime = Number(review.finished_at || 0)
        const ts = Number.isFinite(rawTime) && rawTime > 0 ? (rawTime < 1e12 ? rawTime * 1000 : rawTime) : 0
        const title = app.title || String(app.data?.title || '') || `申请 #${app.id}`
        const reason = review.reason?.trim()
        items.push({
          key: `script-approved-${app.id}-${review.version ?? ''}-${review.task_id || ''}-${review.node_key || ''}-${ts}`,
          title: '剧本创意审核通过',
          text: `「${title}」${stages[stage] || '申请'}审核通过${reason ? `；审核备注：${reason}` : '；暂无审核备注'}`,
          tone: 'success',
          href: `/script-ideas/${encodeURIComponent(String(app.id))}`,
          ts,
          dateLabel: ts ? formatDemandDate(new Date(ts).toISOString()) : '',
        })
      }
    }
  }
  return [...new Map(items.map((item) => [item.key, item])).values()]
}

interface NotificationBellProps {
  /** 已读水位按用户隔离 */
  userKey: string
  workspaceId?: number
}

export default function NotificationBell({ userKey, workspaceId = 0 }: NotificationBellProps) {
  const navigate = useNavigate()
  const { showToast } = useToast()
  const {
    snapshot: creditSnapshot,
    loading: creditLoading,
    loadError: creditLoadError,
    markingRead: markingCreditRead,
    readError: creditReadError,
    refresh: refreshCredit,
    markRead: markCreditRead,
  } = useCreditNotifications(userKey)
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<NotificationItem[]>([])
  const [manualItems, setManualItems] = useState<NotificationItem[]>([])
  const [promoItems, setPromoItems] = useState<NotificationItem[]>([])
  const [deliveryLoading, setDeliveryLoading] = useState(false)
  const [deliveryErrors, setDeliveryErrors] = useState<string[]>([])
  const [selectedDelivery, setSelectedDelivery] = useState<NotificationItem | null>(null)
  const [marketLoading, setMarketLoading] = useState(false)
  const [scriptLoading, setScriptLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [scriptLoadError, setScriptLoadError] = useState(false)
  const [readKeys, setReadKeys] = useState<Set<string>>(() => new Set())
  const boxRef = useRef<HTMLDivElement>(null)
  const refreshSequence = useRef(0)
  const storageKey = `${READ_STORAGE_PREFIX}${userKey || 'anon'}`

  useEffect(() => {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(storageKey) || '[]')
      setReadKeys(new Set(Array.isArray(parsed) ? parsed.filter((key) => typeof key === 'string') : []))
    } catch {
      setReadKeys(new Set())
    }
  }, [storageKey])

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const sequence = ++refreshSequence.current
      setMarketLoading(true)
      setScriptLoading(true)
      setLoadError(false)
      setScriptLoadError(false)
      if (workspaceId) {
        setDeliveryLoading(true)
        setDeliveryErrors([])
      }
      const valid = () => !signal?.aborted && sequence === refreshSequence.current
      const loadSource = async (script: boolean) => {
        try {
          const loaded = await withRequestTimeout(
            (requestSignal) =>
              script ? loadScriptApprovalNotifications(requestSignal) : loadNotifications(requestSignal),
            { signal, timeoutMs: NOTIFICATION_LOAD_TIMEOUT_MS },
          )
          if (!valid()) return
          setItems((previous) =>
            [...previous.filter((item) => item.key.startsWith('script-approved-') !== script), ...loaded]
              .sort((a, b) => b.ts - a.ts)
              .slice(0, 20),
          )
        } catch {
          if (valid()) (script ? setScriptLoadError : setLoadError)(true)
        } finally {
          if (valid()) (script ? setScriptLoading : setMarketLoading)(false)
        }
      }
      const loadDelivery = async () => {
        if (!workspaceId) return
        const results = await Promise.allSettled([
          MANUAL_DELIVERY_ENABLED
            ? withRequestTimeout(
                (requestSignal) => loadManualDeliveryNotifications(workspaceId, requestSignal, Number(userKey) || 0),
                { signal, timeoutMs: NOTIFICATION_LOAD_TIMEOUT_MS },
              )
            : Promise.resolve([]),
          PROMO_DELIVERY_ENABLED
            ? withRequestTimeout((requestSignal) => loadPromoDeliveryNotifications(workspaceId, requestSignal), {
                signal,
                timeoutMs: NOTIFICATION_LOAD_TIMEOUT_MS,
              })
            : Promise.resolve([]),
        ])
        if (!valid()) return
        if (results[0].status === 'fulfilled') setManualItems(results[0].value)
        if (results[1].status === 'fulfilled') setPromoItems(results[1].value)
        setDeliveryErrors(
          results.flatMap((result, index) =>
            result.status === 'rejected' ? [index === 0 ? 'T+1 任务' : 'T+5 订单'] : [],
          ),
        )
        setDeliveryLoading(false)
      }
      await Promise.all([loadSource(false), loadSource(true), loadDelivery()])
    },
    [workspaceId, userKey],
  )

  // 挂载后延迟拉一次（避免抢首屏请求），打开面板时再刷新。
  useEffect(() => {
    const controller = new AbortController()
    const sequenceRef = refreshSequence
    setItems([])
    setManualItems([])
    setPromoItems([])
    setSelectedDelivery(null)
    setDeliveryErrors([])
    setLoadError(false)
    setScriptLoadError(false)
    const timer = window.setTimeout(() => {
      void refresh(controller.signal)
    }, 1500)
    const pollTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh(controller.signal)
    }, 60_000)
    return () => {
      sequenceRef.current++
      window.clearTimeout(timer)
      window.clearInterval(pollTimer)
      controller.abort()
    }
  }, [refresh, userKey])

  const visibleItems = useMemo(
    () =>
      [...items, ...manualItems, ...promoItems, ...creditSnapshot.items.map(creditNotificationItem)]
        .sort((a, b) => b.ts - a.ts)
        .slice(0, 60),
    [items, manualItems, promoItems, creditSnapshot.items],
  )
  const unreadCount =
    creditSnapshot.unread_count + visibleItems.filter((item) => !item.credit && !readKeys.has(item.key)).length
  const isUnread = (item: NotificationItem) => (item.credit ? !item.credit.read_at : !readKeys.has(item.key))

  const persistReadKeys = useCallback(
    (next: Set<string>) => {
      const retained = [...next].slice(-200)
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(retained))
      } catch {
        // 存储不可用时仍更新当前面板。
      }
      setReadKeys(new Set(retained))
    },
    [storageKey],
  )

  const markAllRead = useCallback(() => {
    persistReadKeys(new Set([...readKeys, ...visibleItems.filter((item) => !item.credit).map((item) => item.key)]))
    if (creditSnapshot.unread_count) void markCreditRead(0)
  }, [visibleItems, persistReadKeys, readKeys, creditSnapshot.unread_count, markCreditRead])

  const openNotification = useCallback(
    async (item: NotificationItem) => {
      if (item.credit) {
        if (!item.credit.read_at) {
          const marked = await markCreditRead(item.credit.id)
          if (marked === null) return
          if (!marked) showToast('积分通知仍未读，请稍后重试', 'error')
        }
      } else {
        persistReadKeys(new Set([...readKeys, item.key]))
      }
      if (item.delivery) {
        setSelectedDelivery(item)
        return
      }
      setOpen(false)
      navigate(item.href)
    },
    [navigate, persistReadKeys, readKeys, markCreditRead, showToast],
  )

  // 副作用不能放进 setState 的 updater 里(StrictMode 下 updater 会被调用两次 → 双份请求)。
  const toggleOpen = useCallback(() => {
    const next = !open
    setOpen(next)
    if (next) {
      void refresh()
      refreshCredit()
    }
  }, [open, refresh, refreshCredit])

  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => {
      if (boxRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="notify" ref={boxRef}>
      <button
        type="button"
        className="notify__bell"
        aria-label={unreadCount ? `通知（${unreadCount} 条未读）` : '通知'}
        aria-expanded={open}
        onClick={toggleOpen}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
          <path d="M12 22a2.3 2.3 0 0 0 2.3-2.3H9.7A2.3 2.3 0 0 0 12 22Zm7-5.3v-1l-1.5-1.6v-4.3c0-3-1.9-5.5-4.7-6.2V3a.8.8 0 1 0-1.6 0v.6C8.4 4.3 6.5 6.8 6.5 9.8v4.3L5 15.7v1Z" />
        </svg>
        {unreadCount > 0 && (
          <span className={`notify__badge${unreadCount > 99 ? ' notify__badge--overflow' : ''}`} aria-hidden="true">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div className="notify__panel" role="dialog" aria-label="通知列表">
          <div className="notify__panel-head">
            <div>
              <strong>通知中心</strong>
              <span>{unreadCount ? `${unreadCount} 条未读` : creditLoadError ? '部分消息未加载' : '消息均已读'}</span>
            </div>
            {unreadCount > 0 && (
              <button type="button" onClick={markAllRead} disabled={markingCreditRead}>
                全部已读
              </button>
            )}
          </div>
          {creditReadError && (
            <div className="notify__partial-error" role="status">
              积分消息标记已读失败，请重试
            </div>
          )}
          {creditLoadError && (
            <div className="notify__partial-error" role="status">
              积分消息加载失败，
              <button type="button" onClick={refreshCredit}>
                重新加载积分消息
              </button>
            </div>
          )}
          {selectedDelivery?.delivery ? (
            <DeliveryNotificationDetail
              kind={selectedDelivery.delivery.kind}
              id={selectedDelivery.delivery.id}
              workspaceId={workspaceId}
              onBack={() => setSelectedDelivery(null)}
              onOpen={() => {
                if (selectedDelivery.delivery?.kind === 't1' && Number(userKey) > 0) {
                  try {
                    const key = `zzh.manual.tasks.${Number(userKey)}.${workspaceId}`
                    const stored: unknown = JSON.parse(localStorage.getItem(key) || '[]')
                    const ids = Array.isArray(stored) ? stored.filter((id) => Number.isSafeInteger(id) && id > 0) : []
                    localStorage.setItem(
                      key,
                      JSON.stringify(
                        [
                          selectedDelivery.delivery.id,
                          ...ids.filter((id) => id !== selectedDelivery.delivery?.id),
                        ].slice(0, 100),
                      ),
                    )
                  } catch {
                    /* 历史缓存不可用时仍可打开任务 */
                  }
                }
                setOpen(false)
                navigate(selectedDelivery.href)
              }}
            />
          ) : marketLoading && scriptLoading && !visibleItems.length ? (
            <div className="notify__skeleton" aria-label="正在加载通知">
              <i />
              <i />
              <i />
            </div>
          ) : loadError && scriptLoadError && !visibleItems.length && !deliveryLoading && !deliveryErrors.length ? (
            <div className="notify__empty notify__empty--error">
              <strong>通知加载失败</strong>
              <span>没有把请求失败误判为暂无通知</span>
              <button type="button" onClick={() => void refresh()}>
                重新加载
              </button>
            </div>
          ) : visibleItems.length ? (
            <>
              {(marketLoading || scriptLoading) && (
                <div className="notify__partial-error" role="status">
                  {marketLoading ? '需求消息' : '剧本消息'}加载中…
                </div>
              )}
              {(loadError || scriptLoadError) && (
                <div className="notify__partial-error" role="status">
                  {loadError ? '需求消息加载失败' : '剧本消息加载失败'}，
                  <button type="button" onClick={() => void refresh()}>
                    重新加载
                  </button>
                </div>
              )}
              {deliveryErrors.length > 0 && (
                <div className="notify__partial-error" role="status">
                  {deliveryErrors.join('、')}消息加载失败，
                  <button type="button" onClick={() => void refresh()}>
                    重新加载
                  </button>
                </div>
              )}
              <div className="notify__list">
                {visibleItems.map((item) => (
                  <button
                    type="button"
                    className={`notify__item notify__item--${item.tone}${isUnread(item) ? ' is-unread' : ''}`}
                    key={item.key}
                    disabled={markingCreditRead && !!item.credit && isUnread(item)}
                    aria-description={item.credit ? (isUnread(item) ? '未读' : '已读') : undefined}
                    onClick={() => void openNotification(item)}
                  >
                    <span className="notify__item-icon" aria-hidden="true">
                      {item.tone === 'success' ? '✓' : item.tone === 'warning' ? '!' : 'i'}
                    </span>
                    <span className="notify__item-content">
                      <strong>{item.title}</strong>
                      <span>{item.text}</span>
                      {item.dateLabel && <time>{item.dateLabel}</time>}
                    </span>
                    {isUnread(item) && <span className="notify__item-dot" aria-hidden="true" />}
                  </button>
                ))}
              </div>
            </>
          ) : loadError || scriptLoadError || deliveryErrors.length ? (
            <div className="notify__empty notify__empty--error">
              <strong>
                {loadError
                  ? '需求消息加载失败'
                  : scriptLoadError
                    ? '剧本消息加载失败'
                    : `${deliveryErrors.join('、')}消息加载失败`}
              </strong>
              <button type="button" onClick={() => void refresh()}>
                重新加载
              </button>
            </div>
          ) : marketLoading || scriptLoading || deliveryLoading || creditLoading ? (
            <div className="notify__empty" role="status">
              <strong>
                {marketLoading ? '需求消息' : scriptLoading ? '剧本消息' : deliveryLoading ? '交付消息' : '积分消息'}
                加载中…
              </strong>
            </div>
          ) : creditLoadError ? null : (
            <div className="notify__empty">
              <strong>暂无通知</strong>
              <span>这里只展示业务接口中真实存在的消息</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
