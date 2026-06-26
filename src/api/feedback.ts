/**
 * 意见反馈 API。
 * - GET  /api/v1/feedback-types  反馈类型列表(公开,管理员后台配置)
 * - POST /api/v1/feedback        提交意见反馈(feedback_type + content + contact + asset_ids)
 * - GET  /api/v1/feedback        我的反馈历史
 * 标准业务信封 { code, message, data }。
 */

async function readJson(res: Response): Promise<any> {
  try {
    return await res.json()
  } catch {
    return null
  }
}

export interface FeedbackType {
  id: number
  name: string
  position: number
}

export async function listFeedbackTypes(): Promise<FeedbackType[]> {
  try {
    const res = await fetch('/api/v1/feedback-types', {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return []
    const payload = await readJson(res)
    const list = Array.isArray(payload?.data) ? payload.data : []
    return list
      .filter((t: any) => t && t.enabled !== false)
      .map(
        (t: any): FeedbackType => ({
          id: Number(t?.id || 0),
          name: String(t?.name || '').trim(),
          position: Number(t?.position || 0),
        }),
      )
      .filter((t: FeedbackType) => t.id > 0 && t.name)
      .sort((a: FeedbackType, b: FeedbackType) => a.position - b.position)
  } catch {
    return []
  }
}

export interface SubmitFeedbackInput {
  feedbackType: number
  content: string
  contact?: string
  assetIds?: number[]
}

export async function submitFeedback(input: SubmitFeedbackInput): Promise<void> {
  const res = await fetch('/api/v1/feedback', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      feedback_type: Number(input.feedbackType) || 0,
      content: input.content,
      contact: input.contact || '',
      asset_ids: (input.assetIds || []).map(Number).filter(Boolean),
    }),
  })
  const payload = await readJson(res)
  if (!res.ok || (payload && typeof payload.code === 'number' && payload.code !== 0)) {
    throw new Error(payload?.message || `提交失败 (${res.status})`)
  }
}

export interface FeedbackRecord {
  id: number
  feedbackType: number
  content: string
  contact: string
  status: string
  createdAt: string
  assetIds: number[]
}

export async function listMyFeedback({ limit = 20, offset = 0 } = {}): Promise<FeedbackRecord[]> {
  try {
    const q = new URLSearchParams({ limit: String(limit), offset: String(offset) })
    const res = await fetch(`/api/v1/feedback?${q}`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return []
    const payload = await readJson(res)
    const data = payload?.data
    const list = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : []
    return list.map(
      (f: any): FeedbackRecord => ({
        id: Number(f?.id || 0),
        feedbackType: Number(f?.feedback_type || 0),
        content: String(f?.content || ''),
        contact: String(f?.contact || ''),
        status: String(f?.status || ''),
        createdAt: String(f?.created_at || ''),
        assetIds: Array.isArray(f?.asset_ids_json) ? f.asset_ids_json.map(Number).filter(Boolean) : [],
      }),
    )
  } catch {
    return []
  }
}
