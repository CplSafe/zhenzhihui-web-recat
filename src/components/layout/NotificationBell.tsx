/**
 * 顶栏通知铃铛（设计稿「通知」下拉）。
 *
 * 后端暂无独立通知接口，通知项由需求市场状态推导：
 * 我发布的需求已完成/被接单、我的接单申请被接受/拒绝。
 * 已读水位（时间戳）按用户存 localStorage，打开面板即视为全部已读。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { listMyApplications, listMyDemands, formatDemandDate } from '@/api/market'
import './NotificationBell.css'

interface NotificationItem {
  key: string
  text: string
  /** 排序与未读判断用的毫秒时间戳（解析失败为 0，视为已读旧消息） */
  ts: number
  dateLabel: string
}

const SEEN_STORAGE_PREFIX = 'zzh-market-notify-seen:'

function tsOf(value: string): number {
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

/** 从需求/申请状态推导通知列表（新在前，最多 20 条）。 */
async function loadNotifications(signal?: AbortSignal): Promise<NotificationItem[]> {
  const [demands, applications] = await Promise.all([
    listMyDemands({ signal }).catch(() => ({ items: [] as Awaited<ReturnType<typeof listMyDemands>>['items'] })),
    listMyApplications({ signal }).catch(() => ({
      items: [] as Awaited<ReturnType<typeof listMyApplications>>['items'],
    })),
  ])
  const items: NotificationItem[] = []
  for (const demand of demands.items) {
    const publishedLabel = formatDemandDate(demand.publishedAt || demand.createdAt)
    if (demand.status === 'completed') {
      const ts = tsOf(demand.completedAt || demand.publishedAt || demand.createdAt)
      items.push({
        key: `demand-completed-${demand.id}`,
        text: `你于${publishedLabel}发布的需求已完成，请注意查收`,
        ts,
        dateLabel: formatDemandDate(demand.completedAt) || publishedLabel,
      })
    } else if (demand.status === 'in_progress' && demand.assignee) {
      const ts = tsOf(demand.publishedAt || demand.createdAt)
      items.push({
        key: `demand-progress-${demand.id}`,
        text: `你发布的需求「${demand.title}」已由 ${demand.assignee.nickname} 接单，正在制作中`,
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
        text: `你的接单申请已被接受：「${title}」`,
        ts,
        dateLabel: formatDemandDate(application.respondedAt || application.createdAt),
      })
    } else if (application.status === 'rejected') {
      items.push({
        key: `app-rejected-${application.id}`,
        text: `你的接单申请未被采纳：「${title}」`,
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
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<NotificationItem[]>([])
  const [loading, setLoading] = useState(false)
  const [seenAt, setSeenAt] = useState(0)
  // 打开面板前的已读水位快照：面板里仍按它高亮未读项，同时水位推进让铃铛红点消失。
  const [panelSeenAt, setPanelSeenAt] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)
  const storageKey = `${SEEN_STORAGE_PREFIX}${userKey || 'anon'}`

  useEffect(() => {
    setSeenAt(Number(window.localStorage.getItem(storageKey) || 0) || 0)
  }, [storageKey])

  // 挂载后延迟拉一次（避免抢首屏请求），打开面板时再刷新。
  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      loadNotifications(controller.signal)
        .then((loaded) => {
          if (!controller.signal.aborted) setItems(loaded)
        })
        .catch(() => {})
    }, 1500)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [userKey])

  const unreadCount = useMemo(() => items.filter((item) => item.ts > seenAt).length, [items, seenAt])

  const toggleOpen = useCallback(() => {
    setOpen((current) => {
      const next = !current
      if (next) {
        setLoading(true)
        loadNotifications()
          .then(setItems)
          .catch(() => {})
          .finally(() => setLoading(false))
        // 打开即视为已读：面板高亮沿用旧水位，铃铛红点按新水位消失。
        setPanelSeenAt(Number(window.localStorage.getItem(storageKey) || 0) || 0)
        const now = Date.now()
        window.localStorage.setItem(storageKey, String(now))
        setSeenAt(now)
      }
      return next
    })
  }, [storageKey])

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
        {unreadCount > 0 && <span className="notify__dot" aria-hidden="true" />}
      </button>
      {open && (
        <div className="notify__panel" role="dialog" aria-label="通知列表">
          <div className="notify__panel-title">通知</div>
          {loading && !items.length ? (
            <div className="notify__empty">加载中…</div>
          ) : items.length ? (
            <div className="notify__list">
              {items.map((item) => (
                <div
                  className={`notify__item${item.ts > 0 && item.ts > panelSeenAt ? ' is-unread' : ''}`}
                  key={item.key}
                >
                  <p>{item.text}</p>
                  {item.dateLabel && <time>{item.dateLabel}</time>}
                  <span className="notify__item-dot" aria-hidden="true" />
                </div>
              ))}
            </div>
          ) : (
            <div className="notify__empty">暂无通知</div>
          )}
        </div>
      )}
    </div>
  )
}
