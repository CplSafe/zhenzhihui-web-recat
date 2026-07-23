/**
 * AI responses 客户端封装(对齐 Vue):统一走业务后端 AI 网关
 * POST /api/v1/ai/responses(operation_code: responses.multimodal)。
 *
 * - 文本:拼成单个 prompt 送入(后端按 operation + 套餐选模型)。
 * - 素材图:先上传成后端 asset,再以 inputAssets(asset_id,role:'image')传入
 *   —— 与 Vue 一致;不再像本地 Qwen 那样把 base64 内联进 messages。
 * - workspaceId / modelPlanCandidates 从 workspaceSession store 非响应式读取,
 *   调用方(润色/脚本生成等)无需感知。
 *
 * 替代此前直连「本地 vLLM Qwen」(/aimodel、/aimodel-vl)的临时实现。
 */
import { createAiResponse, streamAiResponse, getBusinessErrorMessage, extractTaskText } from './business'
import { ensureAssetId } from './smartShotImage'
import { useWorkspaceSessionStore, deriveWorkspaceId, deriveModelPlanCandidates } from '@/stores/workspaceSession'

/** 文本与图片多模态请求在业务网关中的能力代码。 */
const OPERATION_CODE = 'responses.multimodal'

/** 从当前会话解析工作空间和套餐模型候选，套餐加载失败时保留已有候选。 */
async function resolveContext(): Promise<{ workspaceId: number; modelPlanCandidates: string[] }> {
  const store = useWorkspaceSessionStore.getState()
  try {
    await store.ensureModelPlanCandidatesLoaded()
  } catch {
    /* 加载失败则用当前已有候选 */
  }
  const s = useWorkspaceSessionStore.getState()
  return {
    workspaceId: Number(deriveWorkspaceId(s) || 0),
    modelPlanCandidates: (deriveModelPlanCandidates(s) as string[]) || [],
  }
}

/** 将图片 URL 转换为后端 asset 引用；单张失败只跳过该图，保留其他可用输入。 */
async function toInputAssets(
  workspaceId: number,
  images?: string[],
): Promise<{ asset_id: number; role: string }[] | undefined> {
  const list = (images || []).filter(Boolean)
  if (!workspaceId || !list.length) return undefined
  const cache: Record<string, number> = {}
  const assets: { asset_id: number; role: string }[] = []
  for (const url of list) {
    try {
      const id = await ensureAssetId(workspaceId, url, cache)
      if (id) assets.push({ asset_id: id, role: 'image' })
    } catch {
      /* 单张上传失败则跳过该图 */
    }
  }
  return assets.length ? assets : undefined
}

/**
 * 从非流式响应的不同后端结构中提取纯文本。
 * 同时兼容任务结果、Vue 旧字段和 Responses 风格输出，避免后端渐进升级导致空内容。
 */
function extractText(result: any): string {
  if (!result) return ''
  if (typeof result === 'string') return result.trim()
  // 1) 任务对象:result_json / output_text(非流式最常见)
  const fromTask = extractTaskText(result) || (result.task ? extractTaskText(result.task) : '')
  if (fromTask && String(fromTask).trim()) return String(fromTask).trim()
  // 2) Vue 习惯:直接带 text
  if (typeof result.text === 'string' && result.text.trim()) return result.text.trim()
  // 3) responses 风格:output_text / output[].content[].text
  const resp = result.response || result
  if (typeof resp.output_text === 'string' && resp.output_text.trim()) return resp.output_text.trim()
  if (Array.isArray(resp.output)) {
    const joined = resp.output
      .map((it: any) =>
        Array.isArray(it?.content)
          ? it.content.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('')
          : typeof it?.text === 'string'
            ? it.text
            : '',
      )
      .filter(Boolean)
      .join('')
    if (joined.trim()) return joined.trim()
  }
  return ''
}

/** 将系统设定和用户内容合并为网关所需的单一 prompt。 */
const buildPrompt = (system?: string, user?: string) => [system, user].filter(Boolean).join('\n\n')

/** 非流式多模态文本请求参数。 */
export interface ResponseTextArgs {
  /** 角色/任务设定(并入 prompt 顶部) */
  system?: string
  /** 用户内容/待处理文本 */
  user: string
  /** 随请求一起送入的素材图(url/dataURL),会先上传成 asset 再以 inputAssets 传 */
  images?: string[]
  temperature?: number
  /** 映射为后端 params.max_output_tokens */
  maxTokens?: number
  signal?: AbortSignal
}

/** 非流式:发一轮 responses.multimodal,返回纯文本(失败抛错,调用方兜底)。 */
export async function runResponseText(args: ResponseTextArgs): Promise<string> {
  const { workspaceId, modelPlanCandidates } = await resolveContext()
  if (!workspaceId) throw new Error('未选择工作空间,无法调用 AI')
  const inputAssets = await toInputAssets(workspaceId, args.images)
  const payload = {
    workspaceId,
    operationCode: OPERATION_CODE,
    prompt: buildPrompt(args.system, args.user),
    inputAssets,
    modelPlanCandidates,
    params: {
      temperature: args.temperature ?? 0.7,
      max_output_tokens: args.maxTokens ?? 512,
    },
  }
  const result = await createAiResponse(payload)
  const text = extractText(result)
  if (text) return text
  // 安全网:个别后端非流式返回不含可解析文本时,回退到已验证可用的流式聚合路径。
  const streamed = await streamAiResponse({ ...payload, signal: args.signal })
  return String(streamed?.text || extractText(streamed) || '').trim()
}

/** 流式文本请求参数，可通过 onDelta 接收增量和已聚合全文。 */
export interface ResponseStreamArgs extends ResponseTextArgs {
  /** 流式增量回调:(本次增量, 到目前为止的全文) */
  onDelta?: (delta: string, aggregated: string) => void
}

/** 判断流式错误是否可安全回退到非流式；用户取消和 401 不重试。 */
function shouldFallback(error: any, signal?: AbortSignal): boolean {
  if (signal?.aborted || error?.name === 'AbortError' || error?.code === 'ABORT_ERR') return false
  const status = Number(error?.status || 0)
  if (status === 401) return false
  const msg = getBusinessErrorMessage(error, String(error?.message || ''))
  const raw = String(error?.message || '')
  const re = /internal_error|服务内部错误|服务器内部错误|stream|event-stream|sse|响应流|bad_request|请求失败\s*\(400\)/i
  return status === 400 || (status >= 500 && status < 600) || re.test(msg) || re.test(raw)
}

/**
 * 流式:优先流式,5xx/流相关错误回退非流式(对齐 Vue requestCreativeScriptWithFallback)。
 * 返回最终全文;增量通过 onDelta 回调。
 */
export async function streamResponseText(args: ResponseStreamArgs): Promise<string> {
  const { workspaceId, modelPlanCandidates } = await resolveContext()
  if (!workspaceId) throw new Error('未选择工作空间,无法调用 AI')
  const inputAssets = await toInputAssets(workspaceId, args.images)
  const payload = {
    workspaceId,
    operationCode: OPERATION_CODE,
    prompt: buildPrompt(args.system, args.user),
    inputAssets,
    modelPlanCandidates,
    params: {
      temperature: args.temperature ?? 0.8,
      max_output_tokens: args.maxTokens ?? 4000,
    },
  }
  try {
    const result = await streamAiResponse({ ...payload, onDelta: args.onDelta, signal: args.signal })
    return String(result?.text || '').trim()
  } catch (error) {
    if (!shouldFallback(error, args.signal)) throw error
    const result = await createAiResponse(payload)
    return extractText(result).trim()
  }
}
