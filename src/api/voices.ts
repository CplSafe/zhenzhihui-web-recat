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
export interface VoiceFilterQuery extends VoiceContext {
  modelVersionId?: number
  source?: 'public' | 'cloned'
  q?: string
  language?: string
  favorites?: boolean
  provider?: string
  gender?: string
  age?: string
  resource_id?: string
  accent?: string[]
  voice_feature?: string[]
  scenario?: string[]
  category?: string[]
  label?: string[]
  emotion?: string[]
  tag?: string[]
}
export interface VoiceListOptions extends VoiceFilterQuery {
  limit?: number
  offset?: number
}
export const VOICE_FILTER_FIELDS = [
  { key: 'language', options: 'languages', label: '语种' },
  { key: 'provider', options: 'providers', label: '供应商' },
  { key: 'gender', options: 'genders', label: '性别' },
  { key: 'age', options: 'ages', label: '年龄' },
  { key: 'resource_id', options: 'resource_ids', label: '模型资源' },
  { key: 'accent', options: 'accents', label: '口音', multiple: true },
  { key: 'voice_feature', options: 'voice_features', label: '声音特征', multiple: true },
  { key: 'scenario', options: 'scenarios', label: '使用场景', multiple: true },
  { key: 'category', options: 'categories', label: '分类', multiple: true },
  { key: 'label', options: 'labels', label: '标签', multiple: true },
  { key: 'emotion', options: 'emotions', label: '情绪', multiple: true },
  { key: 'tag', options: 'tags', label: '本地标签', multiple: true },
] as const
export type VoiceFilterOptions = Record<(typeof VOICE_FILTER_FIELDS)[number]['options'] | 'sources', string[]>
export type VoiceFilterValues = Partial<Pick<VoiceFilterQuery, (typeof VOICE_FILTER_FIELDS)[number]['key']>>
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
function filterQuery(options: VoiceFilterQuery): URLSearchParams {
  const query = new URLSearchParams({ workspace_id: String(positive(options.workspaceId, '工作空间 ID')) })
  if (options.modelVersionId !== undefined)
    query.set('model_version_id', String(positive(options.modelVersionId, '模型 ID')))
  for (const key of ['source', 'q', 'language', 'favorites', 'provider', 'gender', 'age', 'resource_id'] as const)
    if (options[key] !== undefined && options[key] !== '') query.set(key, String(options[key]))
  for (const key of ['accent', 'voice_feature', 'scenario', 'category', 'label', 'emotion', 'tag'] as const)
    for (const value of new Set(options[key] || [])) if (value) query.append(key, value)
  return query
}
export async function getVoiceFilters(options: VoiceFilterQuery): Promise<VoiceFilterOptions> {
  const value = await requestBusinessJson<unknown>(`/api/v1/voices/filters?${filterQuery(options)}`, {
    signal: options.signal,
  })
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new BusinessApiError('音色筛选选项返回格式不正确')
  const record = value as Record<string, unknown>
  const result = {} as VoiceFilterOptions
  for (const key of ['sources', ...VOICE_FILTER_FIELDS.map((field) => field.options)] as const) {
    const values = record[key]
    // 后端未提供的维度不展示；null 与空数组均表示没有可选值。
    if (values == null) result[key] = []
    else if (Array.isArray(values) && values.every((item) => typeof item === 'string'))
      result[key] = [...new Set(values.filter(Boolean))]
    else throw new BusinessApiError('音色筛选选项返回格式不正确')
  }
  return result
}
export async function listVoices(options: VoiceListOptions): Promise<VoicePage> {
  const query = filterQuery(options)
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
/** 可选信息未填写时省略，不把空字符串或空白标签当成有效元数据。 */
function cloneMetadata(input: VoiceMetadata): VoiceMetadata {
  const result: VoiceMetadata = { name: input.name.trim() }
  for (const field of ['description', 'language', 'gender'] as const) {
    const value = input[field]?.trim()
    if (value) result[field] = value
  }
  const tags = [...new Set((input.tags || []).map((tag) => tag.trim()).filter(Boolean))]
  if (tags.length) result.tags = tags
  return result
}
export async function createVoice(
  context: VoiceContext,
  input: VoiceMetadata & {
    provider?: 'minimax' | 'volcengine-speech'
    sample_asset_id: number
    consent_confirmed: true
    idempotency_key: string
  },
): Promise<Voice> {
  if (!input.name.trim() || input.consent_confirmed !== true || !input.idempotency_key.trim())
    throw new BusinessApiError('请填写音色名称并确认授权')
  positive(input.sample_asset_id, '样本素材 ID')
  return normalize(
    await requestBusinessJson<unknown>(
      path(context),
      json(
        'POST',
        {
          ...cloneMetadata(input),
          ...(input.provider ? { provider: input.provider } : {}),
          sample_asset_id: input.sample_asset_id,
          consent_confirmed: input.consent_confirmed,
          idempotency_key: input.idempotency_key,
          workspace_id: context.workspaceId,
        },
        context.signal,
      ),
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
