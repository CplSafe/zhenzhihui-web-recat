import { requestBusinessJson } from './business'

const BASE = '/api/v1/credit-requests'

export type CreditRequestDirection = 'sent' | 'received'
export type CreditRequestDecision = 'approve' | 'reject'
export type CreditRequestStatus = 'pending' | 'approved' | 'rejected' | 'expired'

export interface CreditRequestPerson {
  id: number
  name: string
}

export interface CreditRequest {
  id: number
  applicant: CreditRequestPerson
  superior: CreditRequestPerson
  amount: number
  note: string
  status: CreditRequestStatus
  created_at: string
  decided_at: string | null
}

export interface CreditRequestPage {
  items: CreditRequest[]
  has_more: boolean
}

export function getCreditRequestContext(signal?: AbortSignal) {
  return requestBusinessJson<{ superior: CreditRequestPerson | null }>(`${BASE}/context`, { signal })
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
  body: { amount: number; note: string; request_key: string; expected_superior_id: number },
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
