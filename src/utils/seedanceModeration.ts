export type SeedanceModerationState = 'approved' | 'pending' | 'rejected' | 'unknown' | 'unreviewed'

export interface SeedanceModerationResult {
  state: SeedanceModerationState
  rawStatus: string
  reason: string
}

/** Interpret only explicit terminal states; unknown backend values fail closed. */
export function normalizeSeedanceModerationResult(payload: unknown): SeedanceModerationResult {
  const root = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
  const data = root.data && typeof root.data === 'object' ? (root.data as Record<string, unknown>) : root
  const statusValue =
    data.moderation_status ?? data.review_status ?? data.status ?? data.state ?? data.result_status ?? data.result
  const rawStatus = typeof statusValue === 'string' ? statusValue : ''
  const normalized = rawStatus
    .trim()
    .toLowerCase()
    .replace(/[\s.-]+/g, '_')
  const approved =
    data.approved === true ||
    data.passed === true ||
    ['approved', 'approve', 'passed', 'pass', '审核通过', 'active'].includes(normalized)
  const rejected =
    data.approved === false ||
    data.passed === false ||
    ['rejected', 'reject', 'denied', 'blocked', '审核未通过', '审核拒绝'].includes(normalized)
  const pending = [
    'pending',
    'processing',
    'queued',
    'in_progress',
    'reviewing',
    'submitted',
    '审核中',
    '待审核',
  ].includes(normalized)
  const unreviewed = ['', 'unreviewed', 'not_reviewed', 'none'].includes(normalized)
  const reasonValue = data.reason ?? data.message ?? data.error_message ?? data.reject_reason ?? data.failure_reason
  return {
    state: approved ? 'approved' : rejected ? 'rejected' : pending ? 'pending' : unreviewed ? 'unreviewed' : 'unknown',
    rawStatus,
    reason: typeof reasonValue === 'string' ? reasonValue.trim() : '',
  }
}
