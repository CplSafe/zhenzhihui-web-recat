import { useCallback, useEffect, useRef, useState } from 'react'
import {
  listCreditNotifications,
  markCreditNotificationsRead,
  streamCreditNotificationChanges,
  type CreditNotificationSnapshot,
} from '@/api/creditNotifications'
import { deriveCurrentWorkspace, useWorkspaceSessionStore } from '@/stores/workspaceSession'
import { createCanvasPullLoop } from '@/utils/canvasPullLoop'

const FALLBACK_REFRESH_MS = 60_000
const MIN_RECONNECT_MS = 2_000
const MAX_RECONNECT_MS = 30_000
const EMPTY_SNAPSHOT: CreditNotificationSnapshot = { items: [], unread_count: 0 }

interface BellSession {
  signal: AbortSignal
  refresh: () => void
  marking: boolean
}

export function useCreditNotifications(userKey: string) {
  const [snapshot, setSnapshot] = useState(EMPTY_SNAPSHOT)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [markingRead, setMarkingRead] = useState(false)
  const [readError, setReadError] = useState(false)
  const session = useRef<BellSession | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    let lastApprovalIds: Set<number> | undefined
    let retryTimer: number | undefined
    let retryDelay = MIN_RECONNECT_MS

    setSnapshot(EMPTY_SNAPSHOT)
    setLoading(true)
    setLoadError(false)
    setMarkingRead(false)
    setReadError(false)

    const loop = createCanvasPullLoop(async () => {
      try {
        const next = await listCreditNotifications(signal)
        if (signal.aborted) return
        setSnapshot(next)
        setLoadError(false)

        const approvals = next.items.filter((item) => item.kind === 'credit_request_approved')
        const hasNewApproval = approvals.some((item) =>
          lastApprovalIds ? !lastApprovalIds.has(item.id) : !item.read_at,
        )
        lastApprovalIds = new Set(approvals.map((item) => item.id))
        if (hasNewApproval) {
          const store = useWorkspaceSessionStore.getState()
          const workspace = deriveCurrentWorkspace(store)
          if (workspace?.type === 'personal') void store.refreshWallet(Number(workspace.id))
        }
      } catch {
        if (!signal.aborted) setLoadError(true)
      } finally {
        if (!signal.aborted) setLoading(false)
      }
    })
    session.current = { signal, refresh: loop.wake, marking: false }
    loop.wake()
    const connect = async () => {
      await streamCreditNotificationChanges(signal, () => {
        retryDelay = MIN_RECONNECT_MS
        loop.wake()
      }).catch(() => {})
      if (signal.aborted) return
      retryTimer = window.setTimeout(() => void connect(), retryDelay)
      retryDelay = Math.min(retryDelay * 2, MAX_RECONNECT_MS)
    }
    void connect()
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') loop.wake()
    }
    const pollTimer = window.setInterval(refreshIfVisible, FALLBACK_REFRESH_MS)
    window.addEventListener('focus', refreshIfVisible)
    document.addEventListener('visibilitychange', refreshIfVisible)

    return () => {
      session.current = null
      controller.abort()
      loop.dispose()
      window.clearInterval(pollTimer)
      window.clearTimeout(retryTimer)
      window.removeEventListener('focus', refreshIfVisible)
      document.removeEventListener('visibilitychange', refreshIfVisible)
    }
  }, [userKey])

  const refresh = useCallback(() => session.current?.refresh(), [])
  const markRead = useCallback(async (id: number) => {
    const current = session.current
    if (!current || current.marking) return null
    current.marking = true
    setMarkingRead(true)
    setReadError(false)
    try {
      await markCreditNotificationsRead(id, current.signal)
      if (current.signal.aborted) return null
      current.refresh()
      return true
    } catch {
      if (current.signal.aborted) return null
      setReadError(true)
      return false
    } finally {
      current.marking = false
      if (!current.signal.aborted) setMarkingRead(false)
    }
  }, [])
  return { snapshot, loading, loadError, markingRead, readError, refresh, markRead }
}
