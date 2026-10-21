import { BusinessApiError, requestBusinessJson } from './business'

/** 对齐 124.174.95.225:9000 Swagger voices.View。 */
export interface Voice {
  id: number
  name: string
  source: string
  status: string
  workspace_id?: number
  user_id?: number
  description?: string
  gender?: string
  language?: string
  tags?: string[]
  provider?: string
  sample_asset_id?: number
  is_favorite?: boolean
  preview_url?: string
  preview_expires_at?: string
  last_error?: string
  remaining_training_times?: number
  supported_versions?: string[]
  consent_confirmed_at?: string
  created_at?: string
  updated_at?: string
}
export interface VoicePage {
  items: Voice[]
  total: number
  limit: number
  offset: number
}
export interface VoiceContext {
  workspaceId: number
  signal?: AbortSignal
}
export interface VoiceMetadata {
  name: string
  description?: string
  gender?: string
  language?: string
  tags?: string[]
}
export interface VoiceListOptions extends VoiceContext {
  modelVersionId?: number
  source?: 'public' | 'cloned'
  q?: string
  language?: string
  favorites?: boolean
  limit?: number
  offset?: number
}
function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new BusinessApiError(`${label}无效`)
  return value
}
function path(context: VoiceContext, voiceId?: number, suffix = ''): string {
  return `/api/v1/voices${voiceId === undefined ? '' : `/${positive(voiceId, '音色 ID')}`}${suffix}?workspace_id=${positive(context.workspaceId, '工作空间 ID')}`
}
function normalize(value: unknown): Voice {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BusinessApiError('音色返回格式不正确')
  const record = value as Record<string, unknown>
  return {
    ...record,
    id: positive(Number(record.id), '音色 ID'),
    name: String(record.name || '未命名音色'),
    source: String(record.source || ''),
    status: String(record.status || ''),
  } as Voice
}
function json(method: string, body: unknown, signal?: AbortSignal): RequestInit {
  return { method, signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}
export async function listVoices(options: VoiceListOptions): Promise<VoicePage> {
  const query = new URLSearchParams({ workspace_id: String(positive(options.workspaceId, '工作空间 ID')) })
  if (options.modelVersionId !== undefined)
    query.set('model_version_id', String(positive(options.modelVersionId, '模型 ID')))
  for (const key of ['source', 'q', 'language', 'favorites'] as const)
    if (options[key] !== undefined && options[key] !== '') query.set(key, String(options[key]))
  const limit = options.limit ?? 20
  const offset = options.offset ?? 0
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0)
    throw new BusinessApiError('音色分页参数无效')
  query.set('limit', String(limit))
  query.set('offset', String(offset))
  const value = await requestBusinessJson<unknown>(`/api/v1/voices?${query}`, { signal: options.signal })
  const page = value as VoicePage
  if (!page || !Array.isArray(page.items) || !Number.isSafeInteger(page.total) || page.total < 0)
    throw new BusinessApiError('音色列表返回格式不正确')
  return { items: page.items.map(normalize), total: page.total, limit, offset }
}
export async function getVoice(context: VoiceContext, voiceId: number): Promise<Voice> {
  return normalize(await requestBusinessJson<unknown>(path(context, voiceId), { signal: context.signal }))
}
export async function createVoice(
  context: VoiceContext,
  input: VoiceMetadata & { sample_asset_id: number; consent_confirmed: true; idempotency_key: string },
): Promise<Voice> {
  if (!input.name.trim() || input.consent_confirmed !== true || !input.idempotency_key.trim())
    throw new BusinessApiError('请填写音色名称并确认授权')
  positive(input.sample_asset_id, '样本素材 ID')
  return normalize(
    await requestBusinessJson<unknown>(
      path(context),
      json('POST', { ...input, name: input.name.trim(), workspace_id: context.workspaceId }, context.signal),
    ),
  )
}
export async function updateVoice(context: VoiceContext, voiceId: number, input: VoiceMetadata): Promise<void> {
  if (!input.name.trim()) throw new BusinessApiError('音色名称不能为空')
  await requestBusinessJson(path(context, voiceId), json('PUT', { ...input, name: input.name.trim() }, context.signal))
}
export async function deleteVoice(context: VoiceContext, voiceId: number): Promise<void> {
  await requestBusinessJson(path(context, voiceId), { method: 'DELETE', signal: context.signal })
}
export async function setVoiceFavorite(context: VoiceContext, voiceId: number, favorite: boolean): Promise<void> {
  await requestBusinessJson(path(context, voiceId, '/favorite'), {
    method: favorite ? 'PUT' : 'DELETE',
    signal: context.signal,
  })
}
export async function retryVoice(context: VoiceContext, voiceId: number, sampleAssetId?: number): Promise<Voice> {
  if (sampleAssetId !== undefined) positive(sampleAssetId, '样本素材 ID')
  return normalize(
    await requestBusinessJson<unknown>(
      path(context, voiceId, '/retry'),
      json('POST', sampleAssetId === undefined ? {} : { sample_asset_id: sampleAssetId }, context.signal),
    ),
  )
}
export async function syncVoice(context: VoiceContext, voiceId: number): Promise<Voice> {
  return normalize(
    await requestBusinessJson<unknown>(path(context, voiceId, '/sync'), { method: 'POST', signal: context.signal }),
  )
}

/** 未知状态不视为可用，仍原样显示；服务端负责最终授权与模型兼容校验。 */
export function isVoiceReady(voice: Voice): boolean {
  return ['ready', 'active', 'succeeded', 'success'].includes(voice.status)
}
export function isVoiceTraining(voice: Voice): boolean {
  return ['pending', 'queued', 'training', 'processing'].includes(voice.status)
}
