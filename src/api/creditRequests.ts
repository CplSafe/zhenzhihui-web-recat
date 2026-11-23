import { requestBusinessJson } from './business'

const BASE = '/api/v1/credit-requests'

export type CreditRequestDirection = 'sent' | 'received'
export type CreditRequestDecision = 'approve' | 'reject'
export type CreditRequestStatus = 'pending' | 'approved' | 'rejected' | 'expired'

export interface CreditRequestPerson {
  id: number
  name: string
}

export interface CreditRequestWorkspace {
  id: number
  name: string
  type: 'personal' | 'team' | 'enterprise'
}

interface CanvasUsageTotals {
  credits_used: number
  image_count: number
  video_count: number
}

export interface CreditRequestCanvasUsage extends CanvasUsageTotals {
  canvas_count: number
  canvases: Array<
    CanvasUsageTotals & { canvas_id: number; canvas_name: string; workspace_id: number; workspace_name: string }
  >
}

export interface CreditRequest {
  id: number
  applicant: CreditRequestPerson
  superior: CreditRequestPerson
  workspace: CreditRequestWorkspace | null
  amount: number
  script_name?: string
  note: string
  canvas_usage?: CreditRequestCanvasUsage | null
  status: CreditRequestStatus
  created_at: string
  decided_at: string | null
}

export interface CreditRequestPage {
  items: CreditRequest[]
  has_more: boolean
}

export function getCreditRequestContext(signal?: AbortSignal) {
  return requestBusinessJson<{
    superior: CreditRequestPerson | null
    has_direct_subordinates: boolean
    workspaces: CreditRequestWorkspace[]
  }>(`${BASE}/context`, { signal })
}

export function listCreditRequests(direction: CreditRequestDirection, beforeId: number, signal?: AbortSignal) {
  const query = new URLSearchParams({ direction })
  if (beforeId > 0) query.set('before_id', String(beforeId))
  return requestBusinessJson<CreditRequestPage>(`${BASE}?${query}`, { signal })
}

export function getCreditRequest(id: number, signal?: AbortSignal) {
  return requestBusinessJson<CreditRequest>(`${BASE}/${id}`, { signal })
}

export function createCreditRequest(
  body: {
    amount: number
    script_name: string
    note: string
    request_key: string
    expected_superior_id: number
    workspace_id: number
  },
  signal?: AbortSignal,
) {
  return requestBusinessJson<CreditRequest>(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
}

export function decideCreditRequest(id: number, decision: CreditRequestDecision, signal?: AbortSignal) {
  return requestBusinessJson<CreditRequest>(`${BASE}/${id}/decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision }),
    signal,
  })
}
