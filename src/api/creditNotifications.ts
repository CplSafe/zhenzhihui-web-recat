import { BusinessApiError, requestBusinessJson } from './business'
import { runSharedSessionRefresh } from './sessionRefresh'

const NOTIFICATIONS_PATH = '/api/v1/credit-notifications'
const REQUEST_TIMEOUT_MS = 12_000
const MAX_UNFRAMED_EVENT_LENGTH = 16_384

export interface CreditNotification {
  id: number
  request_id: number
  kind: 'credit_request_received' | 'credit_request_approved' | 'credit_request_rejected'
  amount: number
  actor_name: string
  created_at: string
  read_at: string | null
}

export interface CreditNotificationSnapshot {
  items: CreditNotification[]
  unread_count: number
}

export async function listCreditNotifications(signal: AbortSignal) {
  const snapshot = await requestBusinessJson<CreditNotificationSnapshot>(NOTIFICATIONS_PATH, {
    signal,
    timeoutMs: REQUEST_TIMEOUT_MS,
  })
  if (!Array.isArray(snapshot?.items) || !Number.isSafeInteger(snapshot.unread_count) || snapshot.unread_count < 0) {
    throw new BusinessApiError('积分消息响应格式无效')
  }
  return snapshot
}

export function markCreditNotificationsRead(id: number, signal: AbortSignal) {
  return requestBusinessJson<void>(`${NOTIFICATIONS_PATH}/read`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
    signal,
    timeoutMs: REQUEST_TIMEOUT_MS,
  })
}

export async function streamCreditNotificationChanges(signal: AbortSignal, onChange: () => void) {
  const connect = () =>
    fetch(`${NOTIFICATIONS_PATH}/events`, {
      credentials: 'include',
      headers: { Accept: 'text/event-stream' },
      signal,
    })
  let response = await connect()
  if (response.status === 401) {
    void response.body?.cancel().catch(() => {})
    const refreshed = await runSharedSessionRefresh()
    if (!refreshed.ok || signal.aborted) return
    response = await connect()
  }
  if (!response.ok || !response.headers.get('Content-Type')?.startsWith('text/event-stream') || !response.body) {
    void response.body?.cancel().catch(() => {})
    return
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done || signal.aborted) break
      buffer += decoder.decode(value, { stream: true })
      let separator: RegExpExecArray | null
      while ((separator = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, separator.index)
        buffer = buffer.slice(separator.index + separator[0].length)
        if (/^event:[ \t]*changed[ \t]*\r?$/m.test(frame)) onChange()
      }
      if (buffer.length > MAX_UNFRAMED_EVENT_LENGTH) break
    }
  } finally {
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
