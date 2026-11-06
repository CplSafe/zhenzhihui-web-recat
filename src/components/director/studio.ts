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
  id: string
  title?: string
  status: RunStatus
  stop?: boolean
  cursor: number
  selection?: { image: number; video: number; mode: 'manual' | 'auto' }
  skill_name?: string
  events: StudioEvent[]
  documents?: StudioDocument[]
  nodes?: Data[]
  batches?: StudioBatch[]
  canvas?: Data | null
  billing?: Data
  pending?: Data | null
  decision_id?: string
  active_batch?: string
  inference_failure?: Data | null
}
export interface StudioState {
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
  planning_model?: StudioModel
  skills: Array<{ id: number; name: string; description: string }>
}
export interface StudioAttachment {
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

export function createStudioAPI(base = '/agent-studio') {
  // Same-origin only: a component prop must never send the user's cookie to another service.
  if (!base.startsWith('/') || base.startsWith('//') || /[?#\\]/.test(base))
    throw new Error('Agent 服务必须使用同源路径。')
  const prefix = base.replace(/\/$/, '')
  async function request<T>(path: string, data?: unknown, signal?: AbortSignal): Promise<T> {
    const response = await fetch(prefix + path, {
      credentials: 'same-origin',
      signal,
      ...(data === undefined
        ? {}
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Agent-Request': '1' },
            body: JSON.stringify(data),
          }),
    })
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
        headers: { 'X-Agent-Request': '1', 'Content-Type': 'application/octet-stream' },
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
