import { isAllowedUploadUrl } from '@/utils/uploadUrlSafety'

/** 学生剧本工作流：接口中的接入状态与审批进度分别处理。 */
export interface Application {
  id: number
  state: string
  name?: string
  school?: string
  creative?: string
  data?: ScriptFormData
  created_at?: number | string
  updated_at?: number | string
  title?: string
  genre?: string
  current_stage?: string
  review_status?: string
  flow_version?: number
  card_grade?: string
}
export interface WorkflowVersion {
  version: number
  stage: string
  content: string
  task_id: string
  submitted_at: number
  data?: ScriptFormData
}
export interface WorkflowReview {
  task_id?: string
  node_key?: string
  name?: string
  stage?: string
  status: number
  reason?: string
  version?: number
  finished_at?: number
}
export interface Detail {
  application: Application
  progress_available: boolean
  workflow?: {
    status: number
    stage: string
    current_stage?: string
    review_status?: string
    flow_version?: number
    structured?: boolean
    stage_statuses?: Record<string, string>
    can_withdraw?: boolean
    withdraw_task_id?: string
    card_grade?: string
    card_grades?: Array<{ version: number; grade: string; reviewer_name?: string; reviewed_at?: number | string }>
    production_assignment?: {
      revision?: number
      producer_name?: string
      director_name?: string
      assigned_at?: number | string
      remark?: string
    }
    current_task?: { task_id: string; stage: string; content?: string; data?: ScriptFormData } | null
    versions?: WorkflowVersion[]
    reviews?: WorkflowReview[]
  }
}
export interface ScriptAttachment {
  file_id: number
  file_name?: string
  file_size?: number
  mime_type?: string
  sha256?: string
}
export type ScriptFormData = { attachments?: ScriptAttachment[]; [key: string]: unknown }
export type FirstBody = {
  name?: string
  phone?: string
  school?: string
  creative?: string
  title?: string
  genre?: string
  data?: ScriptFormData
}
export type StageBody = { task_id: string; stage: string; content?: string; data?: ScriptFormData }
type ScriptFile = {
  id: number
  file_name: string
  file_size: number
  mime_type?: string
  sha256?: string
  status: string
}
type FileTicket = { file: ScriptFile; url: string; form_fields: Record<string, string>; upload_required: boolean }

export class StudentApplicationError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/v1/student-applications${path}`, {
    ...options,
    credentials: 'include',
    headers: { Accept: 'application/json', ...options.headers },
  })
  const data = await response.json().catch(() => null)
  if (!response.ok || data?.code !== 0)
    throw new StudentApplicationError(data?.message || `请求失败（${response.status}）`, response.status)
  return data.data as T
}
export const listApplications = (
  offset: number,
  filters: { q?: string; stage?: string; review_status?: string; genre?: string } = {},
) => {
  const query = new URLSearchParams({ limit: '20', offset: String(offset) })
  for (const [key, value] of Object.entries(filters)) if (value?.trim()) query.set(key, value.trim())
  return request<{ items: Application[]; total: number; stats?: Record<string, number> }>(`?${query}`)
}
export type CreatorProfile = {
  real_name: string
  identity_type: string
  school: string
  grade_major?: string
  city?: string
  phone: string
  email: string
  contact_im?: string
  specialties: string[]
}
export type CreatorResponse = {
  profile: CreatorProfile | null
  agreement_version: string
  originality_version: string
  workflow_synced: boolean
}
async function creatorRequest<T>(options: RequestInit = {}): Promise<T> {
  const response = await fetch('/api/v1/script-creators/me', {
    ...options,
    credentials: 'include',
    headers: { Accept: 'application/json', ...options.headers },
  })
  const data = await response.json().catch(() => null)
  if (!response.ok || data?.code !== 0)
    throw new StudentApplicationError(data?.message || `请求失败（${response.status}）`, response.status)
  return data.data as T
}
export const getCreator = () => creatorRequest<CreatorResponse>()
export const saveCreator = (body: CreatorProfile & { agreement_accepted: true; agreement_version: string }) =>
  creatorRequest<CreatorResponse>({
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
export const withdrawApplication = (id: string, taskId: string, reason: string, key: string) =>
  request(`/${encodeURIComponent(id)}/withdraw`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': key },
    body: JSON.stringify({ task_id: taskId, reason }),
  })
export const getApplication = (id: string, signal?: AbortSignal) =>
  request<Detail>(`/${encodeURIComponent(id)}`, { signal })
export const postApplication = (body: FirstBody, key: string) =>
  request<Application>('', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': key },
    body: JSON.stringify(body),
  })
export const postStage = (id: string, body: StageBody, key: string) =>
  request<WorkflowVersion>(`/${encodeURIComponent(id)}/stages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': key },
    body: JSON.stringify(body),
  })

export async function deleteScriptFile(id: number): Promise<void> {
  const response = await fetch(`/api/v1/script-files/${id}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })
  const result = await response.json().catch(() => null)
  if (!response.ok || (result && result.code !== 0))
    throw new StudentApplicationError(result?.message || `删除附件失败（${response.status}）`, response.status)
}

/** 直传完成并经服务端校验后才能将文件 ID 关联申请。 */
export async function uploadScriptFile(file: File, key: string): Promise<ScriptAttachment> {
  const api = async <T>(path: string, options: RequestInit): Promise<T> => {
    const response = await fetch(`/api/v1/script-files${path}`, {
      ...options,
      credentials: 'include',
      headers: { Accept: 'application/json', ...options.headers },
    })
    const result = await response.json().catch(() => null)
    if (!response.ok || result?.code !== 0)
      throw new StudentApplicationError(result?.message || `文件请求失败（${response.status}）`, response.status)
    return result.data as T
  }
  const ticket = await api<FileTicket>('/uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': key },
    body: JSON.stringify({ file_name: file.name, file_size: file.size }),
  })
  if (!ticket.file?.id) throw new Error('上传凭证缺少文件编号')
  if (ticket.upload_required) {
    const extraOrigins = String(import.meta.env.VITE_ZZH_ALLOWED_UPLOAD_ORIGINS || '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean)
    if (
      !isAllowedUploadUrl(ticket.url, {
        pageOrigin: globalThis.location?.origin || '',
        allowAnyHttp: import.meta.env.DEV,
        allowedHostPatterns: [
          /\.aliyuncs\.com$/i,
          /\.myqcloud\.com$/i,
          /\.amazonaws\.com$/i,
          /\.tos-cn-[a-z0-9-]+\.volces\.com$/i,
          ...extraOrigins,
        ],
      })
    )
      throw new Error('文件上传地址不在受信任的存储域名列表中')
    const body = new FormData()
    for (const [name, value] of Object.entries(ticket.form_fields || {})) body.append(name, value)
    body.append('file', file)
    const response = await fetch(ticket.url, { method: 'POST', body, credentials: 'omit', redirect: 'error' })
    if (!response.ok) throw new Error(`文件上传失败（${response.status}）`)
  }
  let completed: ScriptFile
  try {
    completed = await api<ScriptFile>(`/${ticket.file.id}/complete`, { method: 'POST' })
  } catch (error) {
    if (!(error instanceof StudentApplicationError) || error.status !== 409) throw error
    completed = await api<ScriptFile>(`/${ticket.file.id}`, { method: 'GET' })
  }
  if (!completed?.id || completed.id !== ticket.file.id || completed.status !== 'ready')
    throw new Error('文件尚未通过服务端校验')
  return {
    file_id: completed.id,
    file_name: completed.file_name,
    file_size: completed.file_size,
    mime_type: completed.mime_type,
    sha256: completed.sha256,
  }
}
