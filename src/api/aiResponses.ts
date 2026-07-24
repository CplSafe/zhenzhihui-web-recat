/**
 * AI responses 客户端封装(对齐 Vue):统一走业务后端 AI 网关
 * POST /api/v1/ai/responses(operation_code: responses.multimodal)。
 *
 * - 文本:拼成单个 prompt 送入；调用方可传 modelVersionId 固定使用后端返回的指定模型，
 *   未传时仍沿用后端按 operation + 套餐自动选模型的旧流程。
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
import {
  findFirstField,
  getModelParamFields,
  getModelParamOptionValues,
  hasModelParamSchema,
} from '@/utils/modelSchema'
import { getBackendGenerationModelVersionId } from '@/utils/generationModelCatalog'

/** 文本与图片多模态请求在业务网关中的能力代码。 */
const OPERATION_CODE = 'responses.multimodal'

/**
 * 一次 AI 调用锁定的会话上下文。
 *
 * 长链路必须显式传入该对象，避免调用过程中切换工作空间后出现
 * “旧模型 ID + 新 workspaceId”的交叉请求。
 */
export interface AiResponseRequestContext {
  workspaceId: number
  modelPlanCandidates?: readonly string[]
  /** 与 modelVersion 快照绑定的规范化模型版本 ID。 */
  modelVersionId?: number
  /** 与 modelVersionId 对应的不可变目录快照，用来按同一 schema 编译参数。 */
  modelVersion?: Record<string, unknown>
}

/** 从显式快照或当前会话解析工作空间和套餐模型候选。 */
async function resolveContext(
  explicit?: AiResponseRequestContext,
): Promise<{ workspaceId: number; modelPlanCandidates: string[] }> {
  if (explicit) {
    return {
      workspaceId: Math.max(0, Math.floor(Number(explicit.workspaceId) || 0)),
      modelPlanCandidates: Array.from(explicit.modelPlanCandidates || [], String).filter(Boolean),
    }
  }
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
  signal?: AbortSignal,
): Promise<{ asset_id: number; role: string }[] | undefined> {
  const list = (images || []).filter(Boolean)
  if (!workspaceId || !list.length) return undefined
  const cache: Record<string, number> = {}
  const assets: { asset_id: number; role: string }[] = []
  for (const url of list) {
    throwIfResponseRequestAborted(signal)
    try {
      const id = await ensureAssetId(workspaceId, url, cache, signal)
      throwIfResponseRequestAborted(signal)
      if (id) assets.push({ asset_id: id, role: 'image' })
    } catch {
      throwIfResponseRequestAborted(signal)
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

/** 兼容 Safari 13 等尚未实现 AbortSignal.throwIfAborted 的浏览器。 */
function throwIfResponseRequestAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  if (typeof DOMException === 'function') throw new DOMException('请求已取消', 'AbortError')
  const error = new Error('请求已取消')
  error.name = 'AbortError'
  throw error
}

function normalizePositiveModelVersionId(value: unknown): number | null {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/**
 * 将调用参数、上下文 ID 与模型快照绑定成同一个模型。
 * 任何一个来源冲突都在上传素材或创建付费任务前失败，不能出现“模型 A 的 schema + 模型 B 的 ID”。
 */
function resolveResponseModelVersionId(args: ResponseTextArgs): number | undefined {
  const argumentId = normalizePositiveModelVersionId(args.modelVersionId)
  const contextId = normalizePositiveModelVersionId(args.requestContext?.modelVersionId)
  const snapshot = args.requestContext?.modelVersion
  const snapshotId = snapshot ? getBackendGenerationModelVersionId(snapshot) : null
  const suppliedIds = [argumentId, contextId, snapshotId].filter((id): id is number => id !== null)

  if (args.modelVersionId !== undefined && argumentId === null) {
    throw new Error('已选择的脚本模型版本 ID 无效，请返回首页重新选择')
  }
  if (args.requestContext?.modelVersionId !== undefined && contextId === null) {
    throw new Error('脚本模型请求上下文中的模型版本 ID 无效，请重新发起')
  }
  if (snapshot && snapshotId === null) {
    throw new Error('脚本模型快照缺少有效模型版本 ID，请返回首页重新选择')
  }
  if (new Set(suppliedIds).size > 1) {
    throw new Error('脚本模型版本 ID 与模型参数快照不一致，请返回首页重新选择')
  }
  return suppliedIds[0]
}

function modelDisplayName(model: Record<string, unknown> | undefined): string {
  return String(model?.display_name || model?.displayName || model?.name || '当前脚本模型').trim()
}

function readFiniteBoundary(field: Record<string, unknown>, names: string[]): number | undefined {
  for (const name of names) {
    const value = Number(field[name])
    if (Number.isFinite(value)) return value
  }
  return undefined
}

function validatedResponseParamValue(
  field: Record<string, unknown>,
  requested: number,
): number | string | boolean | undefined {
  const options = getModelParamOptionValues(field)
  if (options.length) {
    const exact = options.find((option) => String(option) === String(requested))
    if (exact !== undefined) return exact as number | string | boolean
    const fallback = field.default ?? (field.required === true && options.length === 1 ? options[0] : undefined)
    return fallback as number | string | boolean | undefined
  }
  const minimum = readFiniteBoundary(field, ['minimum', 'min', 'min_value', 'minValue'])
  const maximum = readFiniteBoundary(field, ['maximum', 'max', 'max_value', 'maxValue'])
  if ((minimum !== undefined && requested < minimum) || (maximum !== undefined && requested > maximum)) {
    const fallback = Number(field.default)
    return Number.isFinite(fallback) ? fallback : undefined
  }
  return requested
}

/**
 * 只构造模型 schema 明确支持的 Responses 参数。
 * 未知必填字段在发起任务前直接阻止，避免把目录里“可选”的模型留到 provider 才失败。
 */
export function buildResponseModelParams(
  model: Record<string, unknown> | undefined,
  requested: { temperature: number; maxOutputTokens: number },
): Record<string, unknown> {
  if (!model || !hasModelParamSchema(model)) {
    return {
      temperature: requested.temperature,
      max_output_tokens: requested.maxOutputTokens,
    }
  }
  const fields = getModelParamFields(model)
  const params: Record<string, unknown> = {}
  const temperatureField = findFirstField(fields, ['temperature'])
  const maxTokensField = findFirstField(fields, ['max_output_tokens', 'maxOutputTokens', 'max_tokens', 'maxTokens'])

  for (const field of fields) {
    const isTemperature = temperatureField === field
    const isMaxTokens = maxTokensField === field
    const requestedValue = isTemperature ? requested.temperature : isMaxTokens ? requested.maxOutputTokens : undefined
    if (requestedValue !== undefined) {
      const value = validatedResponseParamValue(field, requestedValue)
      if (value !== undefined) {
        params[field.name] = value
        continue
      }
      if (field.required === true) {
        throw new Error(`${modelDisplayName(model)} 的必填参数 ${field.name} 没有可用值，请联系管理员检查模型配置`)
      }
      continue
    }

    if (field.default !== undefined) {
      params[field.name] = field.default
      continue
    }
    const options = getModelParamOptionValues(field)
    if (field.required === true && options.length === 1) {
      params[field.name] = options[0]
      continue
    }
    if (field.required === true) {
      throw new Error(`${modelDisplayName(model)} 要求参数 ${field.name}，当前创作流程尚未提供该参数`)
    }
  }
  return params
}

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
  /** 用户显式选择的模型版本 ID；传入后流式与非流式回退都固定使用该模型。 */
  modelVersionId?: number
  /** 长流程发起时锁定的工作空间上下文；传入后不会再读取全局当前空间。 */
  requestContext?: AiResponseRequestContext
  signal?: AbortSignal
}

/** 非流式:发一轮 responses.multimodal,返回纯文本(失败抛错,调用方兜底)。 */
export async function runResponseText(args: ResponseTextArgs): Promise<string> {
  throwIfResponseRequestAborted(args.signal)
  const modelVersionId = resolveResponseModelVersionId(args)
  const { workspaceId, modelPlanCandidates } = await resolveContext(args.requestContext)
  if (!workspaceId) throw new Error('未选择工作空间,无法调用 AI')
  const inputAssets = await toInputAssets(workspaceId, args.images, args.signal)
  throwIfResponseRequestAborted(args.signal)
  const modelVersion = args.requestContext?.modelVersion
  const payload = {
    workspaceId,
    operationCode: OPERATION_CODE,
    prompt: buildPrompt(args.system, args.user),
    inputAssets,
    modelPlanCandidates,
    ...(modelVersionId ? { modelVersionId } : {}),
    ...(args.signal ? { signal: args.signal } : {}),
    params: buildResponseModelParams(modelVersion, {
      temperature: args.temperature ?? 0.7,
      maxOutputTokens: args.maxTokens ?? 512,
    }),
  }
  const result = await createAiResponse(payload)
  const text = extractText(result)
  if (text) return text
  // 非流式请求已经可能创建并计费；成功响应无法解析时禁止换成流式再发一单。
  throw new Error('AI 请求已完成但未返回可解析文本，已停止重试以避免重复生成')
}

/** 流式文本请求参数，可通过 onDelta 接收增量和已聚合全文。 */
export interface ResponseStreamArgs extends ResponseTextArgs {
  /** 流式增量回调:(本次增量, 到目前为止的全文) */
  onDelta?: (delta: string, aggregated: string) => void
}

const STREAM_CAPABILITY_REJECTION_STATUSES = new Set([400, 405, 406, 415, 422, 501])

/**
 * 只有后端明确在创建任务前拒绝流式能力时，才允许改用非流式。
 * 5xx、断流和普通网络错误都有“任务已被接受但响应丢失”的可能，必须 fail closed。
 */
function shouldFallback(error: any, signal?: AbortSignal): boolean {
  if (signal?.aborted || error?.name === 'AbortError' || error?.code === 'ABORT_ERR') return false
  const status = Number(error?.status || 0)
  if (!STREAM_CAPABILITY_REJECTION_STATUSES.has(status)) return false
  const msg = getBusinessErrorMessage(error, String(error?.message || ''))
  const details = [
    msg,
    error?.message,
    error?.code,
    error?.code_string,
    error?.codeString,
    error?.data?.code,
    error?.data?.code_string,
    error?.response?.code,
    error?.response?.code_string,
    error?.response?.message,
    error?.response?.error?.code,
    error?.response?.error?.message,
    error?.response?.data?.code,
    error?.response?.data?.code_string,
    error?.response?.data?.message,
  ]
    .filter(Boolean)
    .join(' ')
  const streamMarker = '(?:stream(?:ing)?|sse|event[-_\\s]?stream|响应流|流式)'
  const unsupportedMarker =
    '(?:not[-_\\s]?(?:supported|implemented|available|enabled)|unsupported|unimplemented|disabled|不支持|未实现|不可用|未启用)'
  return (
    new RegExp(`${streamMarker}.{0,48}${unsupportedMarker}`, 'i').test(details) ||
    new RegExp(`${unsupportedMarker}.{0,48}${streamMarker}`, 'i').test(details)
  )
}

/**
 * 流式:优先流式；仅明确的“流式能力不支持”预创建拒绝回退非流式。
 * 返回最终全文;增量通过 onDelta 回调。
 */
export async function streamResponseText(args: ResponseStreamArgs): Promise<string> {
  throwIfResponseRequestAborted(args.signal)
  const modelVersionId = resolveResponseModelVersionId(args)
  const { workspaceId, modelPlanCandidates } = await resolveContext(args.requestContext)
  if (!workspaceId) throw new Error('未选择工作空间,无法调用 AI')
  const inputAssets = await toInputAssets(workspaceId, args.images, args.signal)
  throwIfResponseRequestAborted(args.signal)
  const modelVersion = args.requestContext?.modelVersion
  const payload = {
    workspaceId,
    operationCode: OPERATION_CODE,
    prompt: buildPrompt(args.system, args.user),
    inputAssets,
    modelPlanCandidates,
    ...(modelVersionId ? { modelVersionId } : {}),
    ...(args.signal ? { signal: args.signal } : {}),
    params: buildResponseModelParams(modelVersion, {
      temperature: args.temperature ?? 0.8,
      maxOutputTokens: args.maxTokens ?? 4000,
    }),
  }
  try {
    const result = await streamAiResponse({ ...payload, onDelta: args.onDelta })
    return String(result?.text || '').trim()
  } catch (error) {
    if (!shouldFallback(error, args.signal)) throw error
    const result = await createAiResponse(payload)
    return extractText(result).trim()
  }
}
