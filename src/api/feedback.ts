/**
 * 意见反馈 API。
 * - GET  /api/v1/feedback-types  反馈类型列表(公开,管理员后台配置)
 * - POST /api/v1/feedback        提交意见反馈(feedback_type + content + contact + asset_ids)
 * - GET  /api/v1/feedback        我的反馈历史
 * 标准业务信封 { code, message, data }。
 */

/** 容错读取响应 JSON，空响应或非 JSON 响应统一返回 null。 */
async function readJson(res: Response): Promise<any> {
  try {
    return await res.json()
  } catch {
    return null
  }
}

/** 可供用户选择的反馈类型。 */
export interface FeedbackType {
  id: number
  name: string
  position: number
}

/** 读取已启用的反馈类型，接口不可用时降级为空列表。 */
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

/** 提交反馈时的文本、联系方式与附件参数。 */
export interface SubmitFeedbackInput {
  feedbackType: number
  content: string
  contact?: string
  assetIds?: number[]
}

/** 提交一条用户反馈，HTTP 或业务码失败时抛出可展示错误。 */
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

/** “我的反馈”列表中的标准化记录。 */
export interface FeedbackRecord {
  id: number
  feedbackType: number
  content: string
  contact: string
  status: string
  createdAt: string
  assetIds: number[]
}

/** 分页读取当前用户的反馈历史，读取失败时返回空列表。 */
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
