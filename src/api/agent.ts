/**
 * Agent 会话 API —— 对接后端 /api/v1/agent/*。
 *
 * 与普通 AI 调用的区别:agent 是多轮 tool-use 循环,一次请求内会反复
 * 搜索、思考、调用工具,过程通过 SSE 实时推送。请求结束不代表会话结束——
 * 撞上「等待用户确认生成」或「Agent 提问」时流会正常关闭,
 * 需要用 continueSession 带着用户的答复续跑。
 *
 * SSE 是单向流,无法在流内回传用户输入,因此交互必须拆成
 * 「结束一个流 + 用新请求续跑」,中间状态由后端落库。
 */
import { BusinessApiError } from './business'

/** Agent 会话类型。 */
export type AgentKind = 'product_analysis' | 'trend_tracking' | 'script_writing'

/** 执行模式:manual 每次生成前确认,auto 由 Agent 自主执行。 */
export type AgentExecMode = 'manual' | 'auto'

/** 会话状态。awaiting_confirm 表示正等用户确认生成或回答提问。 */
export type AgentStatus = 'idle' | 'running' | 'awaiting_confirm' | 'completed' | 'failed'

export interface AgentSession {
  id: number
  workspace_id: number
  user_id: number
  kind: AgentKind
  title: string
  status: AgentStatus
  model_version_id: number
  exec_mode: AgentExecMode
  credit_cap: number
  spent_credits: number
  total_tokens: number
  last_error?: string
  created_at: string
  updated_at: string
}

export interface AgentMessage {
  id: number
  session_id: number
  seq: number
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: unknown
  tool_call_id?: string
  tool_name?: string
  assets?: string[]
  tokens_used: number
  created_at: string
}

export interface AgentArtifact {
  id: number
  session_id: number
  kind: string
  title: string
  data?: unknown
  ai_task_id?: number
}

export interface AgentChatModel {
  id: number
  provider: string
  model: string
  display_name: string
  default: boolean
}

/** 待确认的生成调用,由 await_confirm 事件携带。 */
/** 确认框里的一个可调参数,由后端按模型 schema 下发。 */
export interface AgentPendingField {
  name: string
  display_name?: string
  type: string
  /** 模型给出的建议值,作为控件默认选中项。 */
  value?: unknown
  options?: unknown[]
  min?: number
  max?: number
  help?: string
}

export interface AgentPendingCall {
  call_id: string
  name: string
  args: Record<string, unknown>
  estimated_credits: number
  /** 可调参数。为空时确认框退化成只读展示。 */
  fields?: AgentPendingField[]
  /** 实际会用到的模型展示名。 */
  model_name?: string
  /** 可切换的生成模型。 */
  models?: AgentPendingModel[]
}

/** 确认框里可选的生成模型。 */
export interface AgentPendingModel {
  /** 提交时填回 args.model。 */
  value: string
  display_name: string
  selected: boolean
}

/** SSE 事件。type 决定 data 的形状。 */
export type AgentEvent =
  | { type: 'session'; data: { session_id: number; title: string } }
  | { type: 'turn'; data: { turn: number; max_turns: number; tokens: number } }
  | { type: 'delta'; data: { text: string } }
  | { type: 'thinking'; data: { content: string } }
  | { type: 'tool_call'; data: { name: string; args: Record<string, unknown> } }
  | { type: 'tool_result'; data: { name: string; preview: string } }
  | { type: 'await_confirm'; data: AgentPendingCall }
  | { type: 'await_input'; data: { call_id: string; question: string; options?: string[] } }
  | { type: 'generating'; data: { call_id: string; estimated_credits: number } }
  | {
      type: 'subagent'
      data: {
        stage: 'start' | 'running' | 'tool' | 'done'
        topics?: string[]
        topic?: string
        name?: string
        query?: string
        finished?: number
        total?: number
        failed?: boolean
      }
    }
  | { type: 'compaction'; data: { stage: string; saved_chars?: number; replaced?: number } }
  | { type: 'done'; data: { content: string } }
  | { type: 'error'; data: { message: string } }

const API_BASE = '/api/v1/agent'

async function parseJson(response: Response) {
  try {
    return await response.json()
  } catch {
    return null
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, {
      credentials: 'include',
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    })
  } catch (error) {
    throw new BusinessApiError('网络请求失败，请检查接口服务或本地代理配置', {
      response: error,
    })
  }
  const payload = await parseJson(response)
  if (!response.ok || payload?.code !== 0) {
    throw new BusinessApiError(payload?.message || `请求失败 (${response.status})`, {
      status: response.status,
      code: payload?.code ?? null,
      response: payload,
    })
  }
  return payload.data as T
}

/** 可选对话模型列表,供模型选择器使用。 */
export function listChatModels() {
  return requestJson<{ items: AgentChatModel[] }>(`${API_BASE}/models`)
}

export function listSessions(workspaceId: number, kind?: AgentKind) {
  const params = new URLSearchParams({ workspace_id: String(workspaceId) })
  if (kind) params.set('kind', kind)
  return requestJson<{ items: AgentSession[]; total: number }>(`${API_BASE}/sessions?${params}`)
}

/** 切换会话执行模式。会话已存在时必须同步到后端,否则续跑仍按旧模式判断闸门。 */
export function setExecMode(sessionId: number, workspaceId: number, execMode: AgentExecMode) {
  return requestJson<{ exec_mode: AgentExecMode }>(`${API_BASE}/sessions/${sessionId}/exec-mode`, {
    method: 'PUT',
    body: JSON.stringify({ workspace_id: workspaceId, exec_mode: execMode }),
  })
}

export function getSession(sessionId: number, workspaceId: number) {
  return requestJson<{
    session: AgentSession
    messages: AgentMessage[]
    artifacts: AgentArtifact[]
  }>(`${API_BASE}/sessions/${sessionId}?workspace_id=${workspaceId}`)
}

/**
 * 解析 SSE 流并逐个回调事件。
 *
 * 后端在 await_confirm / await_input 后会正常关闭流,这里不视为异常——
 * 调用方根据最后收到的事件类型决定下一步。
 */
async function consumeStream(response: Response, onEvent: (e: AgentEvent) => void) {
  if (!response.body) return
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  const flush = (raw: string) => {
    if (!raw.trim()) return
    let eventName = ''
    const dataLines: string[] = []
    for (const line of raw.split(/\r?\n/)) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^\s/, ''))
    }
    const text = dataLines.join('\n')
    if (!text || text === '[DONE]') return
    try {
      onEvent({ type: eventName, data: JSON.parse(text) } as AgentEvent)
    } catch {
      // 单条事件解析失败不该中断整个流:后续事件仍可能有用。
    }
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    // SSE 以空行分隔事件块。
    let idx: number
    while ((idx = buffer.search(/\r?\n\r?\n/)) !== -1) {
      const raw = buffer.slice(0, idx)
      buffer = buffer.slice(idx).replace(/^\r?\n\r?\n/, '')
      flush(raw)
    }
  }
  flush(buffer)
}

async function openStream(url: string, body: unknown, onEvent: (e: AgentEvent) => void, signal?: AbortSignal) {
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      signal,
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(body),
    })
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') return
    throw new BusinessApiError('网络请求失败，请检查接口服务或本地代理配置', {
      response: error,
    })
  }
  if (!response.ok) {
    const payload = await parseJson(response)
    throw new BusinessApiError(payload?.message || `请求失败 (${response.status})`, {
      status: response.status,
      code: payload?.code ?? null,
      response: payload,
    })
  }
  await consumeStream(response, onEvent)
}

export interface StartSessionInput {
  workspaceId: number
  kind: AgentKind
  message: string
  modelVersionId?: number
  execMode?: AgentExecMode
  creditCap?: number
  /** 商品图的资产 ID(上传后由 /api/v1/assets 返回)。 */
  assetIds?: number[]
}

/**
 * 开新会话并推进第一轮。
 *
 * 会话建好后后端会立刻推一个 session 事件带上 session_id,
 * 即便随后循环出错也能拿到 id 续跑或排查——调用方应监听该事件保存 id。
 */
export function startSession(input: StartSessionInput, onEvent: (e: AgentEvent) => void, signal?: AbortSignal) {
  return openStream(
    `${API_BASE}/sessions`,
    {
      workspace_id: input.workspaceId,
      kind: input.kind,
      message: input.message,
      model_version_id: input.modelVersionId,
      exec_mode: input.execMode ?? 'manual',
      credit_cap: input.creditCap,
      asset_ids: input.assetIds,
    },
    onEvent,
    signal,
  )
}

export interface ContinueSessionInput {
  workspaceId: number
  sessionId: number
  message?: string
  /** 本轮追加的商品图资产 ID。续跑同样要能带图。 */
  assetIds?: number[]
  /** 显式确认执行待定的生成。只带 message 的追问不会被当作确认。 */
  confirm?: boolean
  /** 用户在确认框里改过的参数;为空则用模型原本给的。 */
  confirmedArgs?: Record<string, unknown>
  /** 用户在确认框里改过的参数,为空则用模型原本给的。 */
  confirmedArgs?: Record<string, unknown>
  cancel?: boolean
  /** 非零时切换本会话后续使用的对话模型。 */
  modelVersionId?: number
}

export function continueSession(input: ContinueSessionInput, onEvent: (e: AgentEvent) => void, signal?: AbortSignal) {
  return openStream(
    `${API_BASE}/sessions/${input.sessionId}/continue`,
    {
      workspace_id: input.workspaceId,
      message: input.message,
      asset_ids: input.assetIds,
      confirm: input.confirm,
      confirmed_args: input.confirmedArgs,
      cancel: input.cancel,
      model_version_id: input.modelVersionId,
    },
    onEvent,
    signal,
  )
}
