import { runSharedSessionRefresh } from '@/api/sessionRefresh'

/** Public Studio contract. MCP credentials and private Skill bodies never reach this client. */
export type Data = Record<string, any>
export type RunStatus = 'running' | 'waiting' | 'complete' | 'paused' | 'error'
export interface StudioEvent {
  id: string
  kind: string
  text: string
  data?: Data
  at?: number
}
export interface StudioDocument {
  id: string
  title: string
  kind: string
  body: string
  revision: number
  delivery?: Data
}
export interface StudioBatch {
  id: string
  revision: number
  cancelled?: boolean
  nodes: Record<string, Data>
}
export interface StudioRun {
  history_events?: StudioEvent[]
  id: string
  title?: string
  status: RunStatus
  stop?: boolean
  cursor: number
  selection?: { image: number; video: number; chat?: number; mode: 'manual' | 'auto' }
  skill_name?: string
  events: StudioEvent[]
  documents?: StudioDocument[]
  nodes?: Data[]
  batches?: StudioBatch[]
  canvas?: Data | null
  context?: Data
  billing?: Data
  pending?: Data | null
  decision_id?: string
  active_batch?: string
  inference_failure?: Data | null
}
export interface StudioState {
  session_scope?: string | null
  connected: boolean
  workspace_id?: number
  runs: Array<{ id: string; title: string; status: RunStatus }>
  next_offset?: number | null
}
export interface StudioModel {
  id: number
  model: string
  display_name?: string
  description?: string
  operation_codes: string[]
}
export interface StudioCatalog {
  models: StudioModel[]
  context_defaults?: Data
  planning_model?: StudioModel
  skills: Array<{ id: number; name: string; description: string }>
}
export interface StudioAttachment {
  asset_id?: number
  id?: string
  name: string
  type?: string
  characters?: number
  error?: string
}
export interface StudioFrame {
  event: string
  cursor?: number
  data?: Data
}
export class StudioHTTPError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}

export interface StudioBusinessBinding {
  workspaceId: number
  canvasId: number
}

export function createStudioAPI(base = '/agent-studio', business?: StudioBusinessBinding) {
  // Same-origin only: a component prop must never send the user's cookie to another service.
  if (!base.startsWith('/') || base.startsWith('//') || /[?#\\]/.test(base))
    throw new Error('Agent 服务必须使用同源路径。')
  const prefix = base.replace(/\/$/, '')
  if (business && [business.workspaceId, business.canvasId].some((id) => !Number.isSafeInteger(id) || id <= 0))
    throw new Error('站内 DoDo Agent需要有效的工作空间与画布。')
  const authHeaders: Record<string, string> = business
    ? {
        'X-Agent-Auth': 'business',
        'X-Agent-Workspace-Id': String(business.workspaceId),
        'X-Agent-Canvas-Id': String(business.canvasId),
      }
    : {}
  async function request<T>(path: string, data?: unknown, signal?: AbortSignal, renewed = false): Promise<T> {
    const response = await fetch(prefix + path, {
      credentials: 'same-origin',
      signal,
      headers: {
        ...authHeaders,
        ...(data === undefined ? {} : { 'Content-Type': 'application/json', 'X-Agent-Request': '1' }),
      },
      ...(data === undefined
        ? {}
        : {
            method: 'POST',
            body: JSON.stringify(data),
          }),
    })
    // Only replay reads. A generation/approval with an uncertain response must
    // never be submitted again as a side effect of login renewal.
    if (business && data === undefined && response.status === 401 && !renewed) {
      const refresh = await runSharedSessionRefresh()
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      if (refresh.ok) return request<T>(path, undefined, signal, true)
    }
    const value = await response.json().catch(() => null)
    if (!response.ok)
      throw new StudioHTTPError(
        typeof value?.error === 'string'
          ? value.error
          : typeof value?.detail === 'string'
            ? value.detail
            : `服务暂不可用（${response.status}）`,
        response.status,
      )
    if (!value || typeof value !== 'object') throw new Error('服务响应无效，请查询历史会话，勿重复提交。')
    return value
  }
  return {
    request,
    async bootstrap(signal?: AbortSignal) {
      const response = await fetch(prefix + '/', { credentials: 'same-origin', signal })
      if (!response.ok) throw new StudioHTTPError('暂时无法连接创作服务，请稍后重试。', response.status)
    },
    async upload(file: File): Promise<StudioAttachment> {
      const response = await fetch(prefix + '/api/attachments?name=' + encodeURIComponent(file.name), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { ...authHeaders, 'X-Agent-Request': '1', 'Content-Type': 'application/octet-stream' },
        body: file,
      })
      const value = await response.json()
      if (!response.ok) throw new StudioHTTPError(value.error || value.detail || '上传失败', response.status)
      return { ...value, name: file.name }
    },
    socketURL(id: string, cursor: number) {
      const url = new URL(prefix + '/api/runs/' + encodeURIComponent(id) + '/ws', window.location.href)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      url.searchParams.set('after', String(cursor))
      if (business) {
        url.searchParams.set('auth', 'business')
        url.searchParams.set('workspace_id', String(business.workspaceId))
        url.searchParams.set('canvas_id', String(business.canvasId))
      }
      return url.toString()
    },
  }
}
export type StudioAPI = ReturnType<typeof createStudioAPI>
function upsert<T extends { id: string }>(items: T[] = [], item: T): T[] {
  return items.some((old) => old.id === item.id)
    ? items.map((old) => (old.id === item.id ? item : old))
    : [...items, item]
}
/** Persistent cursors and stable object IDs make reconnects read-only and duplicate-safe. */
export function applyStudioFrame(run: StudioRun, frame: StudioFrame): StudioRun {
  if (!Number.isSafeInteger(frame.cursor) || frame.cursor! < 0) return run
  if (frame.event === 'snapshot') {
    if (frame.cursor! < run.cursor || frame.data?.id !== run.id || !Array.isArray(frame.data.events)) return run
    return { ...frame.data, cursor: frame.cursor } as StudioRun
  }
  if (frame.event !== 'update' || frame.cursor! <= run.cursor || frame.data?.run_id !== run.id) return run
  const change = frame.data,
    data = change.data
  const next = { ...run, cursor: frame.cursor! }
  if (change.type === 'RUN_STATE') {
    for (const key of ['status', 'stop', 'pending', 'decision_id', 'active_batch', 'inference_failure']) {
      if (data && Object.prototype.hasOwnProperty.call(data, key)) (next as Data)[key] = data[key]
    }
  } else if (change.type === 'ACTIVITY_SNAPSHOT') next.billing = data
  else if (typeof data?.id === 'string' && typeof data?.kind === 'string') {
    next.events = upsert(run.events, data)
    if (data.kind === 'document' && data.data?.id) next.documents = upsert(run.documents, data.data)
    if (data.kind === 'batch' && data.data?.id) next.batches = upsert(run.batches, data.data)
    if (data.kind === 'node' && data.data?.id) next.nodes = upsert(run.nodes as Array<Data & { id: string }>, data.data)
    if (data.kind === 'canvas') next.canvas = data.data
    if (data.kind === 'context') next.context = data.data
  }
  return next
}
export interface MediaSource {
  url: string
  assetId?: number
}
export function mediaSources(data: unknown, canvas?: Data | null): MediaSource[] {
  const sources = new Map<string, MediaSource>()
  const refreshed = new Map<number, string>(
    (canvas?.nodes || [])
      .filter(
        (node: Data) =>
          Number.isSafeInteger(node.asset_id) && typeof node.url === 'string' && /^https?:\/\//.test(node.url),
      )
      .map((node: Data) => [node.asset_id, node.url]),
  )
  function visit(value: unknown, depth: number) {
    if (!value || typeof value !== 'object' || depth > 10) return
    const candidate = Number((value as Data).id)
    const assetId = Number.isSafeInteger(candidate) && candidate > 0 ? candidate : undefined
    const fresh = assetId && refreshed.get(assetId)
    if (fresh) {
      sources.set(String(assetId), { url: fresh, assetId })
      return
    }
    for (const [key, child] of Object.entries(value)) {
      if (['url', 'download_url', 'image_url', 'video_url'].includes(key) && typeof child === 'string') {
        try {
          const url = new URL(child)
          if (['http:', 'https:'].includes(url.protocol))
            sources.set(assetId ? String(assetId) : url.href, { url: url.href, assetId })
        } catch {
          /* Invalid provider URLs are not links. */
        }
      } else visit(child, depth + 1)
    }
  }
  visit(data, 0)
  return [...sources.values()]
}
export function mediaURLs(data: unknown, canvas?: Data | null): string[] {
  return mediaSources(data, canvas).map((source) => source.url)
}
export function isSettled(event: StudioEvent) {
  return ['succeeded', 'success', 'completed'].includes(event.data?.status)
}
export function defaultModel(catalog: StudioCatalog, kind: 'image' | 'video'): number | undefined {
  const operation = kind === 'image' ? 'image.text_to_image' : 'video.generate'
  const match = kind === 'image' ? /nano\s*banana\s*pro/i : /seedance\s*2\.5/i
  return catalog.models.find(
    (model) => model.operation_codes.includes(operation) && match.test(model.display_name || model.model),
  )?.id
}

/** Percentages require both provider-reported input usage and a verified capacity. */
export function contextInfo(run: StudioRun | null, catalog?: StudioCatalog) {
  const events = run?.events || []
  const defaults =
    !run || (typeof run.selection?.chat === 'number' && run.selection.chat === catalog?.planning_model?.id)
      ? catalog?.context_defaults
      : undefined
  const context =
    run?.context || [...events].reverse().find((event) => event.kind === 'context')?.data || defaults || {}
  const lastUsage = [...events]
    .reverse()
    .find(
      (event) =>
        event.kind === 'cost' &&
        event.data?.tool === 'model.generate_text' &&
        event.data?.purpose !== 'context_compaction' &&
        Number.isFinite(event.data?.usage?.input_tokens) &&
        event.data!.usage.input_tokens >= 0,
    )?.data?.usage
  const input =
    Number.isFinite(context.input_tokens) && context.input_tokens >= 0 ? context.input_tokens : lastUsage?.input_tokens
  const knownCapacity = context.capacity_tokens ??
    (context.model_id == null || context.model_id === defaults?.model_id ? defaults?.capacity_tokens : null)
  const capacity = Number.isFinite(knownCapacity) && knownCapacity > 0 ? knownCapacity : null
  const output = Number.isFinite(context.output_tokens) && context.output_tokens >= 0 ? context.output_tokens : 0
  const measured =
    context.measurement === 'provider_usage' && Number.isFinite(context.input_tokens) && context.input_tokens >= 0
  const remaining = capacity && measured ? Math.max(0, capacity - context.input_tokens - output) : null
  const percent = remaining !== null ? Math.round((remaining / capacity) * 1000) / 10 : null
  return { context, input, capacity, remaining, percent }
}
