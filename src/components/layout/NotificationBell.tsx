/**
 * 顶栏通知铃铛（设计稿「通知」下拉）。
 *
 * 后端暂无独立通知接口，通知项由需求市场状态推导：
 * 我发布的需求已完成/被接单、我的接单申请被接受/拒绝。
 * 已读水位（时间戳）按用户存 localStorage，打开面板即视为全部已读。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listDemandApplications, listMyApplications, listMyDemands, formatDemandDate } from '@/api/market'
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
}

const READ_STORAGE_PREFIX = 'zzh-market-notify-read:v2:'

/** 「收到新申请」轮询的需求条数上限，避免铃铛为长列表打出请求风暴。 */
const RECEIVED_APPLICATION_DEMAND_LIMIT = 10

function tsOf(value: string): number {
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : 0
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

interface NotificationBellProps {
  /** 已读水位按用户隔离 */
  userKey: string
}

export default function NotificationBell({ userKey }: NotificationBellProps) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<NotificationItem[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [readKeys, setReadKeys] = useState<Set<string>>(() => new Set())
  const boxRef = useRef<HTMLDivElement>(null)
  const storageKey = `${READ_STORAGE_PREFIX}${userKey || 'anon'}`

  useEffect(() => {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(storageKey) || '[]')
      setReadKeys(new Set(Array.isArray(parsed) ? parsed.filter((key) => typeof key === 'string') : []))
    } catch {
      setReadKeys(new Set())
    }
  }, [storageKey])

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setLoadError(false)
    try {
      const loaded = await loadNotifications(signal)
      if (!signal?.aborted) setItems(loaded)
    } catch (error: any) {
      if (!signal?.aborted && error?.name !== 'AbortError') setLoadError(true)
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  // 挂载后延迟拉一次（避免抢首屏请求），打开面板时再刷新。
  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void refresh(controller.signal)
    }, 1500)
    const pollTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh(controller.signal)
    }, 60_000)
    return () => {
      window.clearTimeout(timer)
      window.clearInterval(pollTimer)
      controller.abort()
    }
  }, [refresh, userKey])

  const unreadCount = useMemo(() => items.filter((item) => !readKeys.has(item.key)).length, [items, readKeys])

  const persistReadKeys = useCallback(
    (next: Set<string>) => {
      const retained = [...next].slice(-200)
      window.localStorage.setItem(storageKey, JSON.stringify(retained))
      setReadKeys(new Set(retained))
    },
    [storageKey],
  )

  const markAllRead = useCallback(() => {
    persistReadKeys(new Set([...readKeys, ...items.map((item) => item.key)]))
  }, [items, persistReadKeys, readKeys])

  const openNotification = useCallback(
    (item: NotificationItem) => {
      persistReadKeys(new Set([...readKeys, item.key]))
      setOpen(false)
      navigate(item.href)
    },
    [navigate, persistReadKeys, readKeys],
  )

  const toggleOpen = useCallback(() => {
    setOpen((current) => {
      const next = !current
      if (next) {
        void refresh()
      }
      return next
    })
  }, [refresh])

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
          <span className="notify__badge" aria-hidden="true">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div className="notify__panel" role="dialog" aria-label="通知列表">
          <div className="notify__panel-head">
            <div>
              <strong>通知中心</strong>
              <span>{unreadCount ? `${unreadCount} 条未读` : '消息均已读'}</span>
            </div>
            {unreadCount > 0 && (
              <button type="button" onClick={markAllRead}>
                全部已读
              </button>
            )}
          </div>
          {loading && !items.length ? (
            <div className="notify__skeleton" aria-label="正在加载通知">
              <i />
              <i />
              <i />
            </div>
          ) : loadError ? (
            <div className="notify__empty notify__empty--error">
              <strong>通知加载失败</strong>
              <span>没有把请求失败误判为暂无通知</span>
              <button type="button" onClick={() => void refresh()}>
                重新加载
              </button>
            </div>
          ) : items.length ? (
            <div className="notify__list">
              {items.map((item) => (
                <button
                  type="button"
                  className={`notify__item notify__item--${item.tone}${!readKeys.has(item.key) ? ' is-unread' : ''}`}
                  key={item.key}
                  onClick={() => openNotification(item)}
                >
                  <span className="notify__item-icon" aria-hidden="true">
                    {item.tone === 'success' ? '✓' : item.tone === 'warning' ? '!' : 'i'}
                  </span>
                  <span className="notify__item-content">
                    <strong>{item.title}</strong>
                    <span>{item.text}</span>
                    {item.dateLabel && <time>{item.dateLabel}</time>}
                  </span>
                  {!readKeys.has(item.key) && <span className="notify__item-dot" aria-hidden="true" />}
                </button>
              ))}
            </div>
          ) : (
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
