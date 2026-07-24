// @ts-nocheck — 逐字移植自框架无关的 JS API 客户端；类型化为后续增量工作。
/**
 * Business API 客户端（项目最大 API 层）
 * AI 任务提交/轮询（图片/视频/脚本）、素材资产管理、创意项目 CRUD、版本历史、
 * 计费套餐/钱包/订单、团队空间管理、存储上传。全部请求经过 requestJson 统一错误处理。
 */
import { MODEL_NOT_FOUND_CODE, chooseModelCandidate, isRetryableModelSelectionError } from '../utils/modelSelection'
import { DEFAULT_MODEL_PLAN_CANDIDATES, normalizePlanCandidates } from '../utils/modelPlans'
import { sleep } from '../utils/common'
import { sanitizeMediaUrl } from '../utils/urlSafety'
import { isAllowedUploadUrl as isUploadUrlAllowedByPolicy } from '../utils/uploadUrlSafety'
import { DEFAULT_API_REQUEST_TIMEOUT_MS, RequestAbortError, withRequestTimeout } from './requestTimeout'

/** 业务 API 固定经同源代理访问，真实后端主机不编译进浏览器代码。 */
const businessApiBaseUrl = ''
/** 部署方显式允许的额外对象存储源，会与内置白名单合并。 */
const extraAllowedUploadOrigins = String(import.meta.env.VITE_ZZH_ALLOWED_UPLOAD_ORIGINS || '')
  .split(',')
  .map((item) => normalizeBaseUrl(item.trim()))
  .filter(Boolean)

/** 模型查询缓存的有效时间。 */
const MODEL_CACHE_TTL_MS = 30_000
/** 按工作空间和能力隔离的模型查询缓存。 */
const modelCache = new Map()
/** 供应商任务失败时的最大重试次数。 */
const PROVIDER_TASK_RETRY_LIMIT = 2
/** 供应商任务重试的固定退避表。 */
const PROVIDER_TASK_RETRY_BACKOFF_MS = [700, 1400]
/** AI 任务状态轮询连续失败的容忍上限。 */
const AI_TASK_POLL_RETRY_LIMIT = 5
/** AI 任务轮询重试的初始退避时间。 */
const AI_TASK_POLL_RETRY_BASE_MS = 1000
/** AI 任务轮询指数退避的最大等待时间。 */
const AI_TASK_POLL_RETRY_MAX_MS = 8000
/** 非流式 AI 等长任务接口的请求超时。 */
const LONG_RUNNING_API_REQUEST_TIMEOUT_MS = 120_000
/** 对象存储大文件上传的超时上限。 */
const OBJECT_STORAGE_UPLOAD_TIMEOUT_MS = 15 * 60 * 1000
/** 上传凭证在前端续传缓存中的最大复用时间。 */
const ASSET_UPLOAD_CREDENTIAL_TTL_MS = 10 * 60 * 1000
/** 对象已上传但资产完成回调失败时的重试上限。 */
const ASSET_COMPLETE_RETRY_LIMIT = 2

/**
 * 以 File 对象为键保留上传凭证：对象存储超时时无法确定服务端是否已接收文件。
 * 用户重试必须复用同一资产与对象键，避免重复分配资产或重复上传。
 */
const resumableAssetUploads = new WeakMap()

/** 上传目标主机白名单，用于拦截后端重定向到内网或非授权主机的攻击。 */
const ALLOWED_UPLOAD_HOST_PATTERNS = [
  ...extraAllowedUploadOrigins,
  // Common object-storage providers used in this project
  /\.amazonaws\.com$/i,
  /\.tos-cn-[a-z0-9-]+\.volces\.com$/i,
  /\.aliyuncs\.com$/i,
  /\.myqcloud\.com$/i,
]

/** 用统一上传 URL 策略校验协议、主机、同源与环境白名单。 */
function isAllowedUploadUrl(url) {
  return isUploadUrlAllowedByPolicy(url, {
    pageOrigin: globalThis.location?.origin || '',
    // 开发环境仍允许任意绝对 http(s) 上传地址，方便连接开发者自己的 MinIO；
    // 协议相对地址、反斜杠变体和危险协议会在此规则之前统一拒绝。
    allowAnyHttp: import.meta.env.DEV,
    allowedHostPatterns: ALLOWED_UPLOAD_HOST_PATTERNS,
  })
}

/** 携带 HTTP 状态、业务码、原始响应和中断原因的统一业务异常。 */
export class BusinessApiError extends Error {
  constructor(message, { status = 0, code = null, response = null, cause = null }: any = {}) {
    super(message)
    this.name = 'BusinessApiError'
    this.status = status
    this.code = code
    this.response = response
    this.cause = cause
  }
}

/** 校验工作空间、任务等 ID 为正安全整数，否则立即报错。 */
function requirePositiveInteger(value, message) {
  const normalized = Number(value)
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw new BusinessApiError(message)
  }
  return normalized
}

/** 判断业务异常是否由调用方主动取消引起。 */
export function isAbortedTaskError(error) {
  return Boolean(error && error.cause === 'aborted')
}

/** 识别内容安全、隐私和版权拦截，这类确定性失败不得换模型重试。 */
function isNonRetryableContentSafetyError(error) {
  if (!(error instanceof BusinessApiError)) return false
  const response = error.response && typeof error.response === 'object' ? error.response : {}
  const data = response?.data && typeof response.data === 'object' ? response.data : {}
  const message = [
    error.message,
    response?.message,
    response?.error?.message,
    response?.error_message,
    data?.message,
    data?.error_message,
  ]
    .filter(Boolean)
    .join(' ')
  return /安全审核|内容审核|内容安全|未通过.{0,8}审核|审核未通过|敏感内容|版权限制|SensitiveContentDetected|PrivacyInformation|copyright|content policy|policy violation|moderation|safety review/i.test(
    message,
  )
}

/** 将常见业务码、权限、并发和内容安全错误转为准确的中文用户提示。 */
export function getBusinessErrorMessage(error, fallback = '业务接口请求失败，请稍后重试') {
  if (error instanceof BusinessApiError && error.message) {
    const responseMessage = String(
      error.response?.message || error.response?.error?.message || error.response?.data?.message || '',
    ).trim()
    const fullMessage = `${error.message} ${responseMessage}`.trim()
    const seatFullPattern =
      /team.*full|workspace.*full|max[_\s-]*members|member.*limit|seat.*full|full capacity|成员.*已满|团队.*已满|人数.*已满|满员/i

    if (error.status === 401) {
      return '登录状态已失效，请重新登录'
    }

    if ([400, 403, 409, 422].includes(Number(error.status || 0)) && seatFullPattern.test(fullMessage)) {
      return '团队已满，暂时无法加入'
    }

    if (error.status === 409) {
      const responseMessage = String(
        error.response?.message || error.response?.error?.message || error.response?.data?.message || '',
      ).trim()
      // 各类 409 后端都给了明确中文原因(草稿乐观锁「草稿已被其他端更新」/「你已经是该 workspace 成员」/
      // 「席位已满」/「不能移除 owner」等),直接回显。此前默认套用「草稿保存冲突」文案,导致加入团队、
      // 成员管理等非草稿 409 显示错误提示(如加入已被使用的邀请码却提示草稿冲突)。
      return responseMessage || error.message || '操作冲突，请刷新后重试'
    }

    // 业务错误码优先按 code/code_string 映射（后端 message 多为英文）。
    const code = String(error.code || '')
    if (code === 'INSUFFICIENT_CREDITS' || code === '10402' || /insufficient credits/i.test(error.message)) {
      return '积分不足，请先购买积分或开通套餐后再试'
    }
    if (
      code === 'WORKSPACE_CONCURRENCY_LIMIT' ||
      code === '10401' ||
      /concurrency limit reached/i.test(error.message)
    ) {
      return '当前空间有任务正在生成中，请等待上一个任务完成后再试'
    }
    if (/not available without an active subscription/i.test(error.message)) {
      return '当前模型需要开通对应套餐后才能使用；如果只用积分包也要可用，需要后端放开无套餐用户的模型授权'
    }

    if (/SensitiveContentDetected|PrivacyInformation/i.test(error.message)) {
      return '输入图片包含人脸或隐私信息，已被内容安全审核拦截。请更换不含真实人物、证件、车牌等敏感内容的分镜图后重试'
    }

    return error.message
  }

  return fallback
}

// 仅开发环境:无真实订阅时手测「席位限制 / 模型限制」UI。浏览器控制台设置后刷新即可,测完清除:
//   localStorage.setItem('zzh_mock', 'seat-full')      → 席位满(getSubscription 返回 3/3)
//   localStorage.setItem('zzh_mock', 'model-locked')   → 模型受限(listAiModels 抛 403)
//   两个一起:localStorage.setItem('zzh_mock', 'seat-full,model-locked')
//   清除:localStorage.removeItem('zzh_mock')
/** 仅在开发环境读取本地 mock 开关，用于手工验证席位和模型限制界面。 */
function devMock(flag) {
  if (!import.meta.env.DEV) return false
  try {
    return String(window.localStorage.getItem('zzh_mock') || '').includes(flag)
  } catch {
    return false
  }
}

/** 当前活跃工作空间；模型列表必须携带它，后端才能按该空间的订阅授权返回可用模型。 */
let activeWorkspaceId = 0
/** 在工作空间初始化或切换时同步模块级模型查询上下文。 */
export function setActiveWorkspaceId(id) {
  activeWorkspaceId = Number(id) || 0
}

/** 按工作空间、能力和操作码列出当前订阅真正可用的 AI 模型。 */
export async function listAiModels({
  capability = '',
  operationCode = '',
  plan = 'pro',
  workspaceId = 0,
  signal,
}: any = {}) {
  // 开发 mock:模拟"当前套餐不允许该模型"(用于手测前端受限 UI / 报错提示)
  if (devMock('model-locked')) {
    throw new BusinessApiError('当前模型需要开通对应套餐后才能使用（mock）', {
      status: 403,
      code: 'MODEL_NOT_ALLOWED_BY_PLAN',
    })
  }

  const query = new URLSearchParams()

  // workspace_id:显式传入优先,否则用模块级当前 workspace。必须带,否则后端返回空模型列表。
  const ws = Number(workspaceId || activeWorkspaceId || 0)
  if (ws > 0) {
    query.set('workspace_id', String(Math.floor(ws)))
  }

  if (plan) {
    query.set('plan', plan)
  }

  if (capability) {
    query.set('capability', capability)
  }

  if (operationCode) {
    query.set('operation_code', operationCode)
  }

  try {
    return await requestJson(`/api/v1/ai/models${query.toString() ? `?${query}` : ''}`, {
      signal,
    })
  } catch (error) {
    if (
      error instanceof BusinessApiError &&
      (error.status === 401 || error.status === 403) &&
      plan &&
      plan !== 'free'
    ) {
      throw new BusinessApiError(error.message || '模型套餐不可用', {
        status: error.status,
        code: 'MODEL_NOT_ALLOWED_BY_PLAN',
        response: error.response,
        cause: error.cause,
      })
    }

    throw error
  }
}

/** 按操作码与偏好关键词从套餐候选中解析模型，并按工作空间缓存。 */
export async function getModelForOperation(
  operationCode,
  preferredKeywords = [],
  planCandidates = DEFAULT_MODEL_PLAN_CANDIDATES,
  workspaceId = 0, // 显式 workspace(查 /ai/models 必带);缺省回退模块级 activeWorkspaceId
) {
  return getModelFromPlanCandidates(planCandidates, (plan) =>
    getModelForOperationFromPlan(operationCode, preferredKeywords, plan, workspaceId),
  )
}

/** 以与 createAiTask 完全相同的 capability/operation 口径解析模型，供提交前估价保持“预估 = 实扣”。 */
export async function resolveTaskModel({
  capability = '',
  operationCode = '',
  preferredModelKeywords = [],
  workspaceId = 0, // 显式 workspace(查 /ai/models 必带);缺省回退模块级 activeWorkspaceId
} = {}) {
  // 实验:不带 plan 查(显式 plan:'' → listAiModels 不下发 plan 参数;默认是 'pro' 故必须显式置空),
  // 让后端返回全部模型再 pick,规避「plan=pro 写死」导致明明有模型却查不到。
  const models = await listAiModels({ capability, operationCode, plan: '', workspaceId })
  return pickModel(models, operationCode, preferredModelKeywords)
}

/** 不向后端写死 plan，按服务端真实订阅筛选结果选模型并分空间缓存。 */
function getModelForOperationFromPlan(operationCode, preferredKeywords = [], _plan = '', workspaceId = 0) {
  // 后端按调用者实际订阅在服务端过滤模型,客户端不该再传 plan。
  // 注意:listAiModels 的 plan 默认是 'pro',不显式置空就会被顶成 plan=pro —— 那样若模型挂在非 pro 套餐下就查不到
  // (正是「明明有 seedance 模型却报没有匹配」的根因)。故显式 plan:'' 不下发 plan,交后端按订阅决定。
  // 缓存键必须含 workspace:查 /ai/models 按 workspace 返回不同的「已启用模型」,
  // 否则 workspace 还没就绪(=0)时查到空列表会被缓存,切到真实 workspace 后仍返回这份空结果 → 误报「没有可用模型」。
  const ws = Number(workspaceId || activeWorkspaceId || 0)
  const cacheKey = `op:${ws}:${operationCode}:${preferredKeywords.join('|')}`

  return getCachedModel(cacheKey, async () => {
    const models = await listAiModels({ operationCode, plan: '', workspaceId: ws })
    return pickModel(models, operationCode, preferredKeywords)
  })
}

/**
 * 发起非流式 AI Responses 请求；显式模型只在供应商暂时失败时原模型重试。
 * 自动选模型只对明确的模型选择错误切换候选；网络、5xx 与内容安全错误均 fail closed。
 */
export async function createAiResponse({
  workspaceId,
  operationCode,
  prompt,
  messages,
  inputAssets,
  params,
  modelVersionId,
  modelPlanCandidates = DEFAULT_MODEL_PLAN_CANDIDATES,
  stream = false,
  signal,
}: any) {
  if (modelVersionId) {
    // 同一次显式模型调用的非流式重试必须复用幂等键，防止首请求已被供应商接收后重复计费。
    const idempotencyKey = createIdempotencyKey('resp')
    let lastError = null
    for (let attempt = 0; attempt <= PROVIDER_TASK_RETRY_LIMIT; attempt += 1) {
      try {
        return await submitAiResponse({
          workspaceId,
          modelId: modelVersionId,
          operationCode,
          idempotencyKey,
          prompt,
          messages,
          inputAssets,
          params,
          stream,
          signal,
        })
      } catch (error) {
        lastError = error
        if (!isProviderTaskFailedError(error) || attempt >= PROVIDER_TASK_RETRY_LIMIT) {
          throw error
        }
        await sleepWithSignal(PROVIDER_TASK_RETRY_BACKOFF_MS[attempt] || 1400, signal)
      }
    }
    throw lastError || new BusinessApiError('AI 请求失败，请稍后重试')
  }

  return submitWithPlanCandidates(modelPlanCandidates, async (plan) => {
    const models = await listAiModels({ workspaceId, operationCode, plan, signal })
    const candidates = getEligibleModelsForOperation(models, operationCode)
    const preferred = pickModel(candidates, operationCode, [])
    const ordered = buildOrderedModelCandidates(candidates, preferred)
    let lastError = null

    for (const model of ordered) {
      // 同一候选模型的重试必须复用幂等键；只有明确切换候选模型时才生成新键。
      const idempotencyKey = createIdempotencyKey('resp')
      for (let attempt = 0; attempt <= PROVIDER_TASK_RETRY_LIMIT; attempt += 1) {
        try {
          return await submitAiResponse({
            workspaceId,
            modelId: model.id,
            operationCode,
            idempotencyKey,
            prompt,
            messages,
            inputAssets,
            params,
            stream,
            signal,
          })
        } catch (error) {
          lastError = error
          if (isProviderTaskFailedError(error) && attempt < PROVIDER_TASK_RETRY_LIMIT) {
            await sleepWithSignal(PROVIDER_TASK_RETRY_BACKOFF_MS[attempt] || 1400, signal)
            continue
          }
          if (!shouldRetryWithNextModel(error)) {
            throw error
          }
          break
        }
      }
    }

    throw lastError || new BusinessApiError('AI 请求失败，请稍后重试')
  })
}

/** 发起 SSE AI Responses 请求，同一模型的重试复用幂等键，避免供应商重复计费。 */
export async function streamAiResponse({
  workspaceId,
  operationCode,
  prompt,
  messages,
  inputAssets,
  params,
  modelVersionId,
  modelPlanCandidates = DEFAULT_MODEL_PLAN_CANDIDATES,
  onDelta,
  signal,
}: any) {
  if (modelVersionId) {
    // 用户已明确选择模型时，流式重试只能复用这个模型；不能因瞬时故障静默切换成其他模型。
    const idempotencyKey = createIdempotencyKey('resp')
    let lastError = null
    for (let attempt = 0; attempt <= PROVIDER_TASK_RETRY_LIMIT; attempt += 1) {
      try {
        return await openAiResponseStream({
          workspaceId,
          modelId: modelVersionId,
          operationCode,
          idempotencyKey,
          prompt,
          messages,
          inputAssets,
          params,
          onDelta,
          signal,
        })
      } catch (error) {
        lastError = error
        if (!isProviderTaskFailedError(error) || attempt >= PROVIDER_TASK_RETRY_LIMIT) {
          throw error
        }
        await sleepWithSignal(PROVIDER_TASK_RETRY_BACKOFF_MS[attempt] || 1400, signal)
      }
    }
    throw lastError || new BusinessApiError('AI 流式响应失败，请稍后重试')
  }

  return submitWithPlanCandidates(modelPlanCandidates, async (plan) => {
    const models = await listAiModels({ workspaceId, operationCode, plan, signal })
    const candidates = getEligibleModelsForOperation(models, operationCode)
    const preferred = pickModel(candidates, operationCode, [])
    const ordered = buildOrderedModelCandidates(candidates, preferred)
    let lastError = null

    for (const model of ordered) {
      // 同一模型的多次重试复用一个幂等键(换模型才换),避免首请求已到 provider 时重试重复计费
      const idempotencyKey = createIdempotencyKey('resp')
      for (let attempt = 0; attempt <= PROVIDER_TASK_RETRY_LIMIT; attempt += 1) {
        try {
          return await openAiResponseStream({
            workspaceId,
            modelId: model.id,
            operationCode,
            idempotencyKey,
            prompt,
            messages,
            inputAssets,
            params,
            onDelta,
            signal,
          })
        } catch (error) {
          lastError = error
          if (isProviderTaskFailedError(error) && attempt < PROVIDER_TASK_RETRY_LIMIT) {
            await sleepWithSignal(PROVIDER_TASK_RETRY_BACKOFF_MS[attempt] || 1400, signal)
            continue
          }
          if (!shouldRetryWithNextModel(error)) {
            throw error
          }
          break
        }
      }
    }

    throw lastError || new BusinessApiError('AI 流式响应失败，请稍后重试')
  })
}

/** 打开并解析一次 SSE 响应流，聚合文本增量并返回最终任务。 */
async function openAiResponseStream({
  workspaceId,
  modelId,
  operationCode,
  idempotencyKey,
  prompt,
  messages,
  inputAssets,
  params,
  onDelta,
  signal,
}: any) {
  let response
  const normalizedMessages = normalizeResponseMessages(messages)

  try {
    response = await fetch(buildUrl(businessApiBaseUrl, '/api/v1/ai/responses?stream=true'), {
      method: 'POST',
      credentials: 'include',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(
        removeEmptyFields({
          workspace_id: workspaceId,
          model_version_id: modelId,
          operation_code: operationCode,
          idempotency_key: idempotencyKey,
          prompt,
          messages: normalizedMessages,
          input_assets: inputAssets,
          params,
        }),
      ),
    })
  } catch (error) {
    throw new BusinessApiError('网络请求失败，请检查接口服务或本地代理配置', {
      response: error,
    })
  }

  if (!response.ok || !response.body) {
    const payload = await readJsonResponse(response).catch(() => null)
    throw new BusinessApiError(payload?.message || `请求失败 (${response.status})`, {
      status: response.status,
      code: payload?.code ?? payload?.code_string ?? null,
      response: payload,
    })
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let aggregated = ''
  let finalTask = null

  const replaceAggregated = (fullText) => {
    if (typeof fullText !== 'string' || !fullText) {
      return
    }

    if (fullText.length <= aggregated.length) {
      return
    }

    const delta = fullText.slice(aggregated.length)
    aggregated = fullText

    if (typeof onDelta === 'function') {
      onDelta(delta, aggregated)
    }
  }

  const flushEvent = (rawEvent) => {
    if (!rawEvent) {
      return
    }

    const dataLines = []
    let eventName = ''

    for (const line of rawEvent.split(/\r?\n/)) {
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim()
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).replace(/^\s/, ''))
      }
    }

    const dataText = dataLines.join('\n')

    if (!dataText || dataText === '[DONE]') {
      return
    }

    let payload

    try {
      payload = JSON.parse(dataText)
    } catch {
      const delta = dataText
      aggregated += delta

      if (typeof onDelta === 'function') {
        onDelta(delta, aggregated)
      }

      return
    }

    if (eventName === 'response.error' || eventName === 'error' || payload?.error) {
      throw new BusinessApiError(payload?.error?.message || payload?.message || 'AI 流式响应失败', {
        response: payload,
      })
    }

    if (eventName === 'response.completed') {
      const completedText = collectResponseText(payload?.response || payload)

      if (completedText) {
        replaceAggregated(completedText)
      }

      if (payload?.task) {
        finalTask = payload.task
      } else if (payload?.id) {
        finalTask = payload
      }
      return
    }

    if (eventName === 'response.incomplete') {
      const incompleteText = collectResponseText(payload?.response || payload)

      if (incompleteText) {
        replaceAggregated(incompleteText)
      }
      return
    }

    if (eventName === 'response.output_item.done') {
      const itemText = collectItemText(payload?.item)

      if (itemText) {
        replaceAggregated(itemText)
      }
      return
    }

    if (eventName === 'response.output_text.done') {
      if (typeof payload?.text === 'string') {
        replaceAggregated(payload.text)
      }
      return
    }

    if (eventName === 'response.created') {
      const taskId = getAiTaskId(payload)
      if (taskId) {
        finalTask = {
          ...(finalTask || {}),
          id: taskId,
        }
      }
      return
    }

    const delta = extractStreamDelta(payload)

    if (delta) {
      aggregated += delta

      if (typeof onDelta === 'function') {
        onDelta(delta, aggregated)
      }
    }

    if (payload?.task) {
      finalTask = payload.task
    } else if (getAiTaskId(payload) && payload?.status) {
      finalTask = payload
    }
  }

  try {
    while (true) {
      const { value, done } = await reader.read()

      if (done) {
        break
      }

      buffer += decoder.decode(value, { stream: true })

      let match = buffer.match(/\r?\n\r?\n/)

      while (match) {
        const rawEvent = buffer.slice(0, match.index)
        buffer = buffer.slice(match.index + match[0].length)
        flushEvent(rawEvent)
        match = buffer.match(/\r?\n\r?\n/)
      }
    }

    if (buffer.trim()) {
      flushEvent(buffer)
    }
  } catch (streamError) {
    try {
      await reader.cancel()
    } catch {
      /* swallow reader cancel */
    }
    throw streamError
  }

  if (!aggregated) {
    aggregated = extractTaskText(finalTask) || ''
  }

  return {
    text: aggregated,
    task: finalTask,
  }
}

/** 从 Responses 单个 output 项中聚合直接文本或 content 分段。 */
function collectItemText(item) {
  if (!item || typeof item !== 'object') {
    return ''
  }

  if (typeof item.text === 'string' && item.text) {
    return item.text
  }

  if (Array.isArray(item.content)) {
    return item.content
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .filter(Boolean)
      .join('')
  }

  return ''
}

/** 从 Responses 最终响应中兼容提取 output_text 或 output[] 文本。 */
function collectResponseText(response) {
  if (!response || typeof response !== 'object') {
    return ''
  }

  if (typeof response.output_text === 'string' && response.output_text) {
    return response.output_text
  }

  if (!Array.isArray(response.output)) {
    return ''
  }

  return response.output
    .map((item) => collectItemText(item))
    .filter(Boolean)
    .join('')
}

/** 从多种 SSE/provider 事件字段中提取本次文本增量。 */
function extractStreamDelta(payload) {
  if (!payload || typeof payload !== 'object') {
    return ''
  }

  const directKeys = ['delta', 'text_delta', 'output_text_delta', 'content_delta']

  for (const key of directKeys) {
    const value = payload[key]

    if (typeof value === 'string' && value) {
      return value
    }
  }

  if (typeof payload.text === 'string' && payload.type && /delta/i.test(payload.type)) {
    return payload.text
  }

  if (Array.isArray(payload.choices)) {
    let delta = ''

    payload.choices.forEach((choice) => {
      const piece = choice?.delta?.content || choice?.delta?.text || ''

      if (typeof piece === 'string') {
        delta += piece
      }
    })

    if (delta) {
      return delta
    }
  }

  return ''
}

/**
 * 创建异步 AI 任务，支持显式模型或按工作空间能力选模型。
 * 网络类重试始终复用同一幂等键；业务参数或输入资产被拒绝时原样失败，
 * 禁止在付费请求后静默改变素材或参数再创建另一个任务。
 */
export async function createAiTask({
  workspaceId,
  capability,
  operationCode,
  prompt,
  params,
  inputAssets,
  modelVersionId,
  modelVersion,
  preferredModelKeywords = [],
  modelValidator,
  modelPlanCandidates = DEFAULT_MODEL_PLAN_CANDIDATES,
  idempotencyKey: providedIdempotencyKey,
  signal,
}: any) {
  const submitTask = ({ idempotencyKey, modelId, resolvedParams, resolvedInputAssets }) =>
    submitAiTask({
      workspaceId,
      modelId,
      operationCode,
      idempotencyKey,
      prompt,
      params: resolvedParams,
      inputAssets: resolvedInputAssets,
      signal,
    })

  // 幂等键:同一次 createAiTask 操作全程复用一个 key。后端按 (workspace, idempotency_key) 去重——
  // 换新键会新建任务并再次冻结积分(= 重复扣费,尤其"provider 实际成功但响应 5xx"时换模型重试会双扣);
  // 复用同键则命中已建任务、不重复冻结,是唯一能兜住"成功但响应丢失"的做法。
  const taskIdempotencyKey = providedIdempotencyKey || createIdempotencyKey('task')

  if (modelVersionId) {
    const model = await resolveExplicitTaskModel({
      modelVersionId,
      modelVersion,
      capability,
      operationCode,
      workspaceId,
    })
    const resolvedParams = resolveTaskField(params, model)
    const resolvedInputAssets = resolveTaskField(inputAssets, model)

    return submitTask({
      idempotencyKey: taskIdempotencyKey,
      modelId: model.id || modelVersionId,
      resolvedParams,
      resolvedInputAssets,
    })
  }

  return submitWithPlanCandidates(modelPlanCandidates, async (plan) => {
    const models = await listAiModels({ capability, operationCode, plan, workspaceId })
    const candidates = getEligibleModelsForOperation(models, operationCode)
    const preferred = pickModel(candidates, operationCode, preferredModelKeywords)
    const ordered = buildOrderedModelCandidates(candidates, preferred)
    let lastError = null

    for (const model of ordered) {
      if (modelValidator) {
        const validationResult = modelValidator(model)

        if (validationResult === false) {
          lastError = new BusinessApiError('当前模型参数不支持，请切换模型或参数', {
            code: MODEL_NOT_FOUND_CODE,
          })
          continue
        }

        if (typeof validationResult === 'string' && validationResult) {
          lastError = new BusinessApiError(validationResult, {
            code: MODEL_NOT_FOUND_CODE,
          })
          continue
        }
      }

      const resolvedParams = resolveTaskField(params, model)
      const resolvedInputAssets = resolveTaskField(inputAssets, model)

      try {
        return await submitTask({
          idempotencyKey: taskIdempotencyKey,
          modelId: model.id,
          resolvedParams,
          resolvedInputAssets,
        })
      } catch (error) {
        lastError = error
        if (import.meta.env.DEV) {
          console.warn('[createAiTask:model-failed]', {
            capability,
            operationCode,
            workspaceId,
            plan,
            modelId: model?.id,
            modelVersion: model?.version,
            code: error?.code || null,
            status: error?.status || 0,
            message: error?.message || '',
            response: error?.response || null,
          })
        }
        if (!shouldRetryWithNextModel(error)) {
          throw error
        }
      }
    }

    throw (
      lastError ||
      new BusinessApiError('当前没有可用的 AI 模型', {
        code: MODEL_NOT_FOUND_CODE,
      })
    )
  })
}

/** 解析直接参数或依赖已选模型的延迟参数构建器。 */
function resolveTaskField(value, model) {
  return typeof value === 'function' ? value(model) : value
}

/** 筛出已启用且声明支持目标操作码的模型。 */
function getEligibleModelsForOperation(models, operationCode = '') {
  const list = Array.isArray(models) ? models : []
  const filtered = list.filter((model) => {
    if (!model?.enabled) return false
    if (!operationCode) return true
    return Array.isArray(model.operation_codes) && model.operation_codes.includes(operationCode)
  })
  return filtered.length ? filtered : list
}

/** 将首选模型置顶，其余候选保持原始顺序。 */
function buildOrderedModelCandidates(models, preferredModel) {
  const list = Array.isArray(models) ? models : []
  const preferredId = Number(preferredModel?.id || 0)
  const preferred = list.find((model) => Number(model?.id || 0) === preferredId)
  const rest = list.filter((model) => Number(model?.id || 0) !== preferredId)
  return preferred ? [preferred, ...rest] : rest
}

/**
 * 仅在服务端明确表示当前候选模型不可用或套餐不允许时切换模型。
 * 网络、超时、5xx 和 provider task failed 都可能发生在请求已被接收之后；
 * 此时切换模型会绕过原模型的幂等范围并造成重复生成或重复计费，必须原样失败。
 */
function shouldRetryWithNextModel(error) {
  return isRetryableModelSelectionError(error)
}

/** 识别可在同一模型上重试的供应商暂时故障。 */
function isProviderTaskFailedError(error) {
  if (!(error instanceof BusinessApiError)) return false
  if (isNonRetryableContentSafetyError(error)) return false
  const message = String(error.message || '').toLowerCase()
  const responseMessage = String(
    error.response?.message || error.response?.error?.message || error.response?.data?.message || '',
  ).toLowerCase()
  const code = String(error.code || '').toUpperCase()
  if (error.status >= 500) return true
  if (code === 'INTERNAL_ERROR' || code === '50008') return true
  return /provider task failed|status failed|internal_error|服务内部错误|服务器内部错误/i.test(
    `${message} ${responseMessage}`,
  )
}

/** 将多段消息内容归一化为后端 Responses 端点可接受的单文本 content。 */
function normalizeResponseMessages(messages) {
  if (!messages) {
    return messages
  }

  const message = Array.isArray(messages) ? messages[0] || null : messages

  if (!message || typeof message !== 'object') {
    return message
  }

  const content = message.content
  if (typeof content === 'string') {
    return message
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (typeof part === 'string') return part
        if (typeof part?.text === 'string') return part.text
        if (typeof part?.content === 'string') return part.content
        return ''
      })
      .filter(Boolean)
      .join('')
    return {
      ...message,
      content: text,
    }
  }

  if (content && typeof content === 'object') {
    if (typeof content.text === 'string') {
      return {
        ...message,
        content: content.text,
      }
    }
  }

  return message
}

/** 解析调用方指定的模型详情，查询失败时保留 ID 交由正式提交返回真实错误。 */
async function resolveExplicitTaskModel({ modelVersionId, modelVersion, capability, operationCode, workspaceId }) {
  if (modelVersion && typeof modelVersion === 'object') {
    return modelVersion
  }

  if (modelVersionId && typeof modelVersionId === 'object') {
    return modelVersionId
  }

  const modelId = Number(modelVersionId || 0)

  if (modelId > 0) {
    try {
      const models = await listAiModels({ capability, operationCode, plan: '', workspaceId })
      const model = Array.isArray(models) ? models.find((item) => Number(item?.id || 0) === modelId) : null

      if (model) {
        return model
      }
    } catch {
      // Submission below will surface the real business API error if the explicit model is unusable.
    }
  }

  return { id: modelVersionId }
}

/** 将已选模型的 Responses 请求序列化并交给统一请求层。 */
function submitAiResponse({
  workspaceId,
  modelId,
  operationCode,
  idempotencyKey,
  prompt,
  messages,
  inputAssets,
  params,
  stream = false,
  signal,
}: any) {
  const normalizedMessages = normalizeResponseMessages(messages)
  return requestJson(`/api/v1/ai/responses${stream ? '?stream=true' : ''}`, {
    method: 'POST',
    signal,
    // 流式响应由调用方主动取消；非流式 AI 响应需要比普通接口更长的等待窗口。
    timeoutMs: stream ? 0 : LONG_RUNNING_API_REQUEST_TIMEOUT_MS,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(
      removeEmptyFields({
        workspace_id: workspaceId,
        model_version_id: modelId,
        operation_code: operationCode,
        idempotency_key: idempotencyKey,
        prompt,
        messages: normalizedMessages,
        input_assets: inputAssets,
        params,
      }),
    ),
  })
}

/** 任务创建仅对网络、限流和服务端错误重试，主动取消和安全拦截不重试。 */
function isRetryableAiCreateTaskError(error) {
  if (!(error instanceof BusinessApiError)) return false
  if (error.cause === 'aborted') return false
  if (isNonRetryableContentSafetyError(error)) return false
  const status = Number(error.status || 0)
  if (status >= 500) return true
  if (status === 0) return true
  if (status === 429) return true
  return false
}

/** 轮询仅对网络、限流、超时和服务端短暂错误重试。 */
function isRetryableAiTaskPollError(error) {
  if (!(error instanceof BusinessApiError)) return false
  if (isNonRetryableContentSafetyError(error)) return false
  const status = Number(error.status || 0)
  if (status >= 500) return true
  if (status === 0) return true
  if (status === 429) return true
  if (error.cause === 'timeout') return true
  return false
}

/** 计算带抖动且有上限的轮询指数退避，避免多客户端同时重试。 */
function getAiTaskPollRetryDelay(attempt) {
  const base = AI_TASK_POLL_RETRY_BASE_MS * Math.pow(2, Math.max(0, Number(attempt || 0)))
  const jitter = Math.floor(Math.random() * 400)
  return Math.min(AI_TASK_POLL_RETRY_MAX_MS, base + jitter)
}

/** 可被 AbortSignal 中断的延迟，结束后清理计时器和监听器。 */
function sleepWithSignal(ms, signal) {
  if (!signal) return sleep(ms)
  if (signal.aborted) return Promise.reject(new BusinessApiError('请求已取消', { cause: 'aborted' }))
  return new Promise((resolve, reject) => {
    let timer = 0
    const cleanup = () => {
      if (timer) clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      cleanup()
      reject(new BusinessApiError('请求已取消', { cause: 'aborted' }))
    }
    timer = setTimeout(
      () => {
        cleanup()
        resolve()
      },
      Math.max(0, Number(ms) || 0),
    )
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/** 在单一请求语义内按指定判定器和指数退避重试，同时尊重调用方取消。 */
async function requestJsonWithRetry(path, options: any = {}, cfg: any = {}) {
  const retries = Math.max(0, Number(cfg.retries ?? 0) || 0)
  const hasTimeoutOverride = Object.prototype.hasOwnProperty.call(cfg, 'timeoutMs')
  const timeoutMs = Math.max(0, Number(cfg.timeoutMs) || 0)
  const baseDelayMs = Math.max(0, Number(cfg.baseDelayMs ?? 800) || 0)
  const shouldRetry = typeof cfg.shouldRetry === 'function' ? cfg.shouldRetry : () => false
  let attempt = 0
  for (;;) {
    if (options?.signal?.aborted) {
      throw new BusinessApiError('请求已取消', { cause: 'aborted' })
    }
    try {
      return await requestJson(path, {
        ...options,
        ...(hasTimeoutOverride ? { timeoutMs } : {}),
      })
    } catch (error) {
      if (attempt >= retries || !shouldRetry(error)) throw error
      const backoff = baseDelayMs * Math.pow(2, attempt)
      const jitter = Math.floor(Math.random() * 250)
      attempt += 1
      await sleepWithSignal(backoff + jitter, options?.signal)
    }
  }
}

/** 使用稳定幂等键提交一个 AI 任务，并验证响应中存在有效 task_id。 */
async function submitAiTask({
  workspaceId,
  modelId,
  operationCode,
  idempotencyKey,
  prompt,
  params,
  inputAssets,
  signal,
}) {
  const payload = await requestJsonWithRetry(
    '/api/v1/ai/tasks',
    {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(
        removeEmptyFields({
          workspace_id: workspaceId,
          model_version_id: modelId,
          operation_code: operationCode,
          idempotency_key: idempotencyKey,
          prompt,
          params,
          input_assets: inputAssets,
        }),
      ),
    },
    {
      retries: 2,
      timeoutMs: LONG_RUNNING_API_REQUEST_TIMEOUT_MS,
      baseDelayMs: 800,
      shouldRetry: isRetryableAiCreateTaskError,
    },
  )
  const task = normalizeAiTask(payload)
  if (!getAiTaskId(task)) {
    throw new BusinessApiError('AI 任务创建后未返回有效任务 ID', {
      code: 'INVALID_TASK_ID',
      response: payload,
    })
  }
  return task
}

/** 按工作空间与任务 ID 读取最新 AI 任务并归一化响应结构。 */
export async function getAiTask({ workspaceId, taskId, signal = undefined }) {
  const wsId = requirePositiveInteger(workspaceId, '工作空间 ID 无效')
  const id = requirePositiveInteger(taskId, '任务 ID 无效')
  const payload = await requestJson(`/api/v1/ai/tasks/${id}?workspace_id=${wsId}`, { signal })
  return normalizeAiTask(payload)
}

/** 按工作空间、状态、操作码和创建者分页列出 AI 任务。 */
export function listAiTasks({ workspaceId, status = '', operationCode = '', mine, limit = 20, offset = 0 }: any = {}) {
  const wsId = Number(workspaceId || 0)
  if (!Number.isFinite(wsId) || wsId <= 0) {
    throw new BusinessApiError('工作空间 ID 无效')
  }
  const query = new URLSearchParams({
    workspace_id: String(Math.floor(wsId)),
    limit: String(Math.max(1, Math.min(Number(limit) || 20, 100))),
    offset: String(Math.max(0, Number(offset) || 0)),
  })
  if (status) query.set('status', String(status))
  if (operationCode) query.set('operation_code', String(operationCode))
  if (mine !== undefined && mine !== null && mine !== '') query.set('mine', String(mine))
  return requestJson(`/api/v1/ai/tasks?${query}`)
}

/** 取消指定工作空间中的 AI 任务。 */
export function cancelAiTask({ workspaceId, taskId }: any = {}) {
  const wsId = requirePositiveInteger(workspaceId, '工作空间 ID 无效')
  const id = requirePositiveInteger(taskId, '任务 ID 无效')
  return requestJson(`/api/v1/ai/tasks/${id}/cancel?workspace_id=${wsId}`, { method: 'POST' })
}

/** 从各供应商响应形态中读取正安全整数任务 ID。 */
export function getAiTaskId(task) {
  if (!task || typeof task !== 'object') return 0
  for (const value of [task.id, task.task_id, task.taskId]) {
    const parsed = Number(value || 0)
    if (Number.isSafeInteger(parsed) && parsed > 0) return parsed
  }
  return 0
}

/** 归一化供应商状态的大小写、分隔符和 canceled/cancelled 拼写差异。 */
export function normalizeAiTaskStatus(status) {
  const normalized = String(status || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
  return normalized === 'canceled' ? 'cancelled' : normalized
}

/** 递归解开常见任务信封，并将 ID 和状态写成统一字段。 */
function normalizeAiTask(task) {
  if (!task || typeof task !== 'object') return task
  let normalizedTask = task

  // Lifecycle endpoints are deployed with both a direct task body and envelope
  // variants (`{ task }` / `{ data: { task } }`). requestJson unwraps one
  // `data` level, but keeping this recursive extraction here also covers direct
  // callers and prevents waitForAiTask from mistaking an envelope for a task
  // without an id.
  for (let depth = 0; depth < 3; depth += 1) {
    if (!normalizedTask || typeof normalizedTask !== 'object') break
    if (normalizedTask.task && typeof normalizedTask.task === 'object' && !Array.isArray(normalizedTask.task)) {
      normalizedTask = normalizedTask.task
      continue
    }
    if (
      !getAiTaskId(normalizedTask) &&
      normalizedTask.status == null &&
      normalizedTask.state == null &&
      normalizedTask.data &&
      typeof normalizedTask.data === 'object' &&
      !Array.isArray(normalizedTask.data)
    ) {
      normalizedTask = normalizedTask.data
      continue
    }
    break
  }

  const id = getAiTaskId(normalizedTask)
  const status = normalizeAiTaskStatus(normalizedTask.status ?? normalizedTask.state)
  return {
    ...normalizedTask,
    ...(id ? { id } : {}),
    ...(status ? { status } : {}),
  }
}

/**
 * 轮询已创建的 AI 任务直到成功或失败终态，不会重新提交 provider 任务。
 * 状态查询的短暂失败按有界指数退避恢复，整体超时与 AbortSignal 保证页面可及时停止等待。
 */
export async function waitForAiTask({
  workspaceId,
  task,
  intervalMs = 2000,
  timeoutMs = 120000,
  onPoll = undefined,
  signal = undefined,
}) {
  let currentTask = normalizeAiTask(task)
  const startedAt = Date.now()
  let pollErrorCount = 0

  if (!getAiTaskId(currentTask)) {
    throw new BusinessApiError('任务 ID 无效', {
      code: 'INVALID_TASK_ID',
      response: currentTask,
    })
  }

  const ensureNotAborted = () => {
    if (signal?.aborted) {
      throw new BusinessApiError('AI 任务等待已取消', { cause: 'aborted' })
    }
  }

  ensureNotAborted()

  if (typeof onPoll === 'function' && currentTask) {
    try {
      onPoll(currentTask)
    } catch {
      /* swallow listener error */
    }
  }

  while (getAiTaskId(currentTask) && !isFinalTaskStatus(currentTask.status)) {
    ensureNotAborted()

    if (Date.now() - startedAt > timeoutMs) {
      throw new BusinessApiError('AI 任务生成超时，请稍后在历史记录中查看')
    }

    await sleepWithSignal(intervalMs, signal)
    ensureNotAborted()
    try {
      const taskId = getAiTaskId(currentTask)
      currentTask = normalizeAiTask(await getAiTask({ workspaceId, taskId, signal }))
      pollErrorCount = 0
    } catch (error) {
      if (!isRetryableAiTaskPollError(error)) {
        throw error
      }
      pollErrorCount += 1
      if (pollErrorCount > AI_TASK_POLL_RETRY_LIMIT) {
        throw new BusinessApiError('AI 任务状态查询连续失败，请稍后重试', {
          status: error?.status,
          code: error?.code,
          response: error?.response,
          cause: error,
        })
      }
      if (import.meta.env.DEV) {
        console.warn('[waitForAiTask] task polling failed, retrying', {
          taskId: getAiTaskId(currentTask),
          status: error?.status,
          code: error?.code,
          attempt: pollErrorCount,
        })
      }
      await sleepWithSignal(getAiTaskPollRetryDelay(Math.min(pollErrorCount - 1, AI_TASK_POLL_RETRY_LIMIT)), signal)
      continue
    }

    // DEV: 排查「一直轮询不停」——仅当后端返回了不在已知名单里的状态才 warn。
    // submitting/pending/processing/queued/running 都是正常的非终态,不需要 warn。
    if (import.meta.env.DEV && currentTask?.status) {
      const s = normalizeAiTaskStatus(currentTask.status)
      const known = [
        'succeeded',
        'completed',
        'success', // 成功终态
        'failed',
        'error',
        'payment_failed',
        'cancelled',
        'canceled',
        'expired', // 失败终态
        'submitting',
        'pending',
        'processing',
        'queued',
        'running', // 正常非终态
      ]
      if (!known.includes(s)) {
        console.warn('[waitForAiTask] 未识别的任务状态,轮询继续', {
          taskId: getAiTaskId(currentTask),
          status: currentTask.status,
          operationCode: currentTask.operation_code,
        })
      }
    }

    if (typeof onPoll === 'function' && currentTask) {
      try {
        onPoll(currentTask)
      } catch {
        /* swallow listener error */
      }
    }
  }

  // 失败态统一抛错(与 isFinalTaskStatus 的失败列表对齐)
  const finalStatus = normalizeAiTaskStatus(currentTask?.status)
  if (['failed', 'error', 'payment_failed', 'cancelled', 'expired'].includes(finalStatus)) {
    // payment_failed 通常是积分不足；把 code/状态透传给 getBusinessErrorMessage 做中文映射。
    // cancelled / expired = 后端主动中断（非前端 abort），前端应显示"已中断"而非"生成失败"
    const code =
      currentTask?.code ??
      currentTask?.code_string ??
      (finalStatus === 'payment_failed' ? 'INSUFFICIENT_CREDITS' : null) ??
      (finalStatus === 'cancelled' || finalStatus === 'expired' ? 'TASK_CANCELLED' : null)
    throw new BusinessApiError(currentTask?.error_message || 'AI 任务生成失败', {
      code,
      response: currentTask,
    })
  }

  return currentTask || task
}

/** 列出可购买的计费套餐。 */
export function listBillingPlans() {
  return requestJson('/api/v1/billing/plans')
}

/** 按与正式提交一致的模型、操作码和参数预估 AI 任务积分。 */
export function estimateAiTaskCost({ workspaceId, modelVersionId, operationCode, prompt = '', params = {} }: any = {}) {
  const wsId = Number(workspaceId || 0)
  const modelId = Number(modelVersionId || 0)
  const op = String(operationCode || '').trim()
  if (!Number.isFinite(wsId) || wsId <= 0) {
    throw new BusinessApiError('工作空间 ID 无效')
  }
  if (!Number.isFinite(modelId) || modelId <= 0) {
    throw new BusinessApiError('模型 ID 无效')
  }
  if (!op) {
    throw new BusinessApiError('操作类型不能为空')
  }
  return requestJson('/api/v1/ai/tasks/estimate-cost', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      removeEmptyFields({
        workspace_id: wsId,
        model_version_id: modelId,
        operation_code: op,
        prompt: String(prompt || ''),
        params: params && typeof params === 'object' ? params : {},
      }),
    ),
  })
}

/** 按类型和状态分页列出工作空间支付订单。 */
export function listPaymentOrders({ workspaceId, type = '', status = '', limit = 20, offset = 0 }: any = {}) {
  const wsId = requirePositiveInteger(workspaceId, '工作空间 ID 无效')
  const query = new URLSearchParams({
    workspace_id: String(Math.floor(wsId)),
    limit: String(Math.max(1, Math.min(Number(limit) || 20, 100))),
    offset: String(Math.max(0, Number(offset) || 0)),
  })
  if (type) {
    query.set('type', String(type))
  }
  if (status) {
    query.set('status', String(status))
  }
  return requestJson(`/api/v1/billing/payment-orders?${query}`)
}

// 主动对账:让后端去支付宝核对该订单真实状态并更新本地订单,返回更新后的订单(带 status)。
// 比被动等支付宝异步通知/回跳可靠——本地测试付完直接对账即可确认到账。POST /payment-orders/{id}/reconcile
/** 主动与支付渠道对账一笔订单，用于用户付款后状态延迟。 */
export function reconcilePaymentOrder({ workspaceId, orderId }: any = {}) {
  const id = requirePositiveInteger(orderId, '订单 ID 无效')
  const wsId = requirePositiveInteger(workspaceId, '工作空间 ID 无效')
  return requestJson(`/api/v1/billing/payment-orders/${id}/reconcile?workspace_id=${wsId}`, {
    method: 'POST',
  })
}

/**
 * Lists the workspaces (个人空间 / 团队) the current user belongs to.
 * @returns {Promise<Array<{ id: number, type: string, name: string, owner_user_id: number, status: string }>>}
 */
/** 列出当前用户可访问的工作空间。 */
export function listWorkspaces() {
  return requestJson('/api/v1/workspaces')
}

/**
 * Creates a team workspace.
 * @param {{ name: string, type?: string }} params
 * @returns {Promise<{ id: number, type: string, name: string, owner_user_id: number, status: string }>}
 */
/** 创建个人或团队工作空间。 */
export function createWorkspace({ name, type = 'team' }) {
  return requestJson('/api/v1/workspaces', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: String(name || '').trim(), type }),
  })
}

/**
 * 修改空间名称。PATCH /api/v1/workspaces/{id}
 * @param {{ workspaceId: number, name: string }} params
 * @returns {Promise<{ id: number, name: string }>}
 */
/** 修改指定工作空间的名称。 */
export function updateWorkspace({ workspaceId, name }: any = {}) {
  const id = requirePositiveInteger(workspaceId, '工作空间 ID 无效')
  const nextName = String(name || '').trim()
  if (!nextName) {
    throw new BusinessApiError('空间名称不能为空')
  }
  return requestJson(`/api/v1/workspaces/${Math.floor(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nextName }),
  })
}

/**
 * Redeems an invitation code and joins the corresponding workspace.
 * @param {{ inviteCode: string }} params
 * @returns {Promise<any>}
 */
/** 核销邀请码加入工作空间。 */
export function redeemWorkspaceInvitation({ inviteCode }: any = {}) {
  const code = String(inviteCode || '')
    .replace(/\s+/g, '')
    .trim()
  if (!code) {
    throw new BusinessApiError('邀请码不能为空')
  }
  return requestJson('/api/v1/invitations/redeem', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
    }),
  })
}

/**
 * Leaves a workspace.
 * @param {{ workspaceId: number }} params
 * @returns {Promise<any>}
 */
/** 当前成员主动退出指定工作空间。 */
export function leaveWorkspace({ workspaceId }: any = {}) {
  const id = requirePositiveInteger(workspaceId, '工作空间 ID 无效')
  return requestJson(`/api/v1/workspaces/${Math.floor(id)}/leave`, {
    method: 'POST',
  })
}

// 解散空间(仅所有者):真删空间,连同其素材/项目/数据一并清空。POST /workspaces/{id}/disband
/** 所有者解散指定工作空间。 */
export function disbandWorkspace({ workspaceId }: any = {}) {
  const id = requirePositiveInteger(workspaceId, '工作空间 ID 无效')
  return requestJson(`/api/v1/workspaces/${Math.floor(id)}/disband`, {
    method: 'POST',
  })
}

/** 列出工作空间当前的邀请链接/邀请码。 */
export function listWorkspaceInvitations(workspaceId) {
  const id = requirePositiveInteger(workspaceId, '工作空间 ID 无效')
  return requestJson(`/api/v1/workspaces/${Math.floor(id)}/invitations`)
}

/** 为工作空间创建指定角色和有效期的邀请。 */
export function createWorkspaceInvitation({ workspaceId, expiryDays, role = 'member' }: any = {}) {
  const id = requirePositiveInteger(workspaceId, '工作空间 ID 无效')
  const days = Number(expiryDays || 0)
  return requestJson(`/api/v1/workspaces/${Math.floor(id)}/invitations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      removeEmptyFields({
        expires_in_days: Number.isFinite(days) && days > 0 ? Math.floor(days) : undefined,
        role: String(role || 'member').trim() || 'member',
      }),
    ),
  })
}

/** 撤销指定工作空间邀请。 */
export function deleteWorkspaceInvitation({ workspaceId, invitationId }: any = {}) {
  const id = requirePositiveInteger(workspaceId, '工作空间 ID 无效')
  const invId = requirePositiveInteger(invitationId, '邀请 ID 无效')
  return requestJson(`/api/v1/workspaces/${Math.floor(id)}/invitations/${Math.floor(invId)}`, {
    method: 'DELETE',
  })
}

/** 从工作空间移除指定成员，所有者等限制由后端强制。 */
export function removeWorkspaceMember({ workspaceId, userId }: any = {}) {
  const id = requirePositiveInteger(workspaceId, '工作空间 ID 无效')
  const uid = requirePositiveInteger(userId, '成员 ID 无效')
  return requestJson(`/api/v1/workspaces/${Math.floor(id)}/members/${Math.floor(uid)}`, {
    method: 'DELETE',
  })
}

/** 更新成员在工作空间中的角色。 */
export function updateWorkspaceMemberRole({ workspaceId, userId, role }: any = {}) {
  const id = requirePositiveInteger(workspaceId, '工作空间 ID 无效')
  const uid = requirePositiveInteger(userId, '成员 ID 无效')
  const nextRole = String(role || '').trim()
  if (!nextRole) {
    throw new BusinessApiError('成员角色不能为空')
  }
  return requestJson(`/api/v1/workspaces/${Math.floor(id)}/members/${Math.floor(uid)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      role: nextRole,
    }),
  })
}

/** 调整成员在工作空间中的积分或任务额度。 */
export function updateWorkspaceMemberQuota({
  workspaceId,
  userId,
  canGenerate,
  maxTaskCredits,
  monthlyCreditLimit,
}: any = {}) {
  const id = requirePositiveInteger(workspaceId, '工作空间 ID 无效')
  const uid = requirePositiveInteger(userId, '成员 ID 无效')
  const resolvedMaxTaskCredits =
    maxTaskCredits === undefined || maxTaskCredits === null || maxTaskCredits === ''
      ? undefined
      : Number(maxTaskCredits)
  const resolvedMonthlyCreditLimit =
    monthlyCreditLimit === undefined || monthlyCreditLimit === null || monthlyCreditLimit === ''
      ? undefined
      : Number(monthlyCreditLimit)
  if (
    resolvedMaxTaskCredits !== undefined &&
    (!Number.isFinite(resolvedMaxTaskCredits) || resolvedMaxTaskCredits < 0)
  ) {
    throw new BusinessApiError('单任务额度必须为非负数字')
  }
  if (
    resolvedMonthlyCreditLimit !== undefined &&
    (!Number.isFinite(resolvedMonthlyCreditLimit) || resolvedMonthlyCreditLimit < 0)
  ) {
    throw new BusinessApiError('月度额度必须为非负数字')
  }
  return requestJson(`/api/v1/workspaces/${Math.floor(id)}/members/${Math.floor(uid)}/quota`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      removeEmptyFields({
        can_generate: typeof canGenerate === 'boolean' ? canGenerate : undefined,
        max_task_credits: resolvedMaxTaskCredits,
        monthly_credit_limit: resolvedMonthlyCreditLimit,
      }),
    ),
  })
}

/** 将工作空间所有权转移给指定成员。 */
export function transferWorkspaceOwnership({ workspaceId, userId }: any = {}) {
  const id = requirePositiveInteger(workspaceId, '工作空间 ID 无效')
  const uid = requirePositiveInteger(userId, '成员 ID 无效')
  return requestJson(`/api/v1/workspaces/${Math.floor(id)}/transfer-ownership`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to_user_id: uid,
    }),
  })
}

// 团队数据总览(owner/admin):成员数 + 总消耗 + 总作品数(本月+累计)。GET /workspaces/{id}/overview
/** 读取工作空间的成员、订阅和用量概览。 */
export function getWorkspaceOverview(workspaceId: any) {
  const id = requirePositiveInteger(workspaceId, '工作空间 ID 无效')
  return requestJson(`/api/v1/workspaces/${Math.floor(id)}/overview`)
}

// 团队成员统计(owner/admin):每个成员本月/累计消耗积分 + 作品数。GET /workspaces/{id}/member-statistics
/** 读取工作空间成员统计数据。 */
export function getWorkspaceMemberStatistics(workspaceId: any) {
  const id = requirePositiveInteger(workspaceId, '工作空间 ID 无效')
  return requestJson(`/api/v1/workspaces/${Math.floor(id)}/member-statistics`)
}

/** 列出可一次性购买的积分包。 */
export function listCreditPackages() {
  return requestJson('/api/v1/billing/credit-packages')
}

/** 读取工作空间当前的订阅套餐、周期、并发与席位信息。 */
export function getSubscription(workspaceId) {
  // 开发 mock:模拟"团队套餐 + 席位已满 3/3"(用于手测席位限制 UI)
  if (devMock('seat-full')) {
    return Promise.resolve({
      active: true,
      plan_code: 'team-mock',
      plan_name: '团队版（mock）',
      current_period_end: '',
      period: 'month',
      base_credits: 8000,
      concurrency: 3,
      max_members: 3,
      current_member_count: 3,
    })
  }
  return requestJson(`/api/v1/billing/subscription?workspace_id=${encodeURIComponent(String(workspaceId))}`)
}

/** 读取工作空间积分钱包的总额、冻结额和可用额。 */
export function getWallet(workspaceId) {
  return requestJson(`/api/v1/billing/wallet?workspace_id=${encodeURIComponent(String(workspaceId))}`)
}

/** 分页读取积分流水；kind=settle 才是实际消耗，freeze/release 不得计入用量。 */
export function listCreditLedgers({ workspaceId, kind = '', limit = 100, offset = 0 }: any = {}) {
  const wsId = Number(workspaceId || 0)
  if (!Number.isFinite(wsId) || wsId <= 0) {
    throw new BusinessApiError('工作空间 ID 无效')
  }
  const query = new URLSearchParams({
    workspace_id: String(Math.floor(wsId)),
    limit: String(Math.max(1, Math.min(Number(limit) || 100, 100))),
    offset: String(Math.max(0, Number(offset) || 0)),
  })
  if (kind) query.set('kind', String(kind))
  return requestJson(`/api/v1/billing/credit-ledgers?${query}`)
}

/** 创建一次性积分充值订单，返回订单和可在系统浏览器打开的支付宝地址。 */
export function createRechargeOrder({ workspaceId, creditPackageId }) {
  const wsId = requirePositiveInteger(workspaceId, '工作空间 ID 无效')
  const packageId = requirePositiveInteger(creditPackageId, '积分包 ID 无效')
  return requestJson('/api/v1/billing/recharge-orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspace_id: wsId,
      credit_package_id: packageId,
    }),
  })
}

/**
 * 开通普通订阅(一次性付款)。返回订单 + 支付宝 pay_url(一次性网站支付,非周期扣款签约)。
 * 这是会员套餐「立即开通」用的接口;签约(sign-url)是周期扣款,暂未开通权限。
 * @param {{ workspaceId: number, planId: number }} params
 * @returns {Promise<{ order: object, pay_url: string }>}
 */
// 开通订阅(一次性付款,按 intent 分流):
//   intent='subscribe' 为某空间开通/续费(后端按订阅历史自决)——个人版、团队续费用它;
//   intent='new_team'  买 team 套餐【开新团队空间】——下单即建 activation_pending 空间、付款激活,必须带 newWorkspaceName;
//   intent='upgrade'   占位未实现。
// idempotencyKey 幂等去重,防重复下单。
export function createSubscriptionOrder({
  workspaceId,
  planId,
  intent = 'subscribe',
  newWorkspaceName = '',
  idempotencyKey = '',
}) {
  const op = String(intent || 'subscribe')
  const normalizedPlanId = requirePositiveInteger(planId, '套餐 ID 无效')
  const body = {
    plan_id: normalizedPlanId,
    intent: op,
  }
  // 开新团队(new_team)不属于任何现有空间,后端不接受 workspace_id;其余(subscribe/upgrade)必须带当前空间
  if (op !== 'new_team') {
    body.workspace_id = requirePositiveInteger(workspaceId, '工作空间 ID 无效')
  }
  const name = String(newWorkspaceName || '').trim()
  if (name) body.new_workspace_name = name
  const key = String(idempotencyKey || '').trim()
  if (key) body.idempotency_key = key
  return requestJson('/api/v1/billing/subscription-orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** 取消指定工作空间的订阅。 */
export function cancelSubscription({ workspaceId, subscriptionId }) {
  const wsId = requirePositiveInteger(workspaceId, '工作空间 ID 无效')
  const subId = requirePositiveInteger(subscriptionId, '订阅 ID 无效')
  return requestJson(
    `/api/v1/billing/subscriptions/${Math.floor(subId)}/cancel?workspace_id=${encodeURIComponent(String(Math.floor(wsId)))}`,
    { method: 'POST' },
  )
}

// 关闭自动续费:到期不再自动扣款(当前周期权益不受影响)。POST /subscriptions/{id}/disable-auto-renew
/** 关闭指定订阅的自动续费。 */
export function disableSubscriptionAutoRenew({ workspaceId, subscriptionId }) {
  const wsId = requirePositiveInteger(workspaceId, '工作空间 ID 无效')
  const subId = requirePositiveInteger(subscriptionId, '订阅 ID 无效')
  return requestJson(
    `/api/v1/billing/subscriptions/${Math.floor(subId)}/disable-auto-renew?workspace_id=${encodeURIComponent(String(Math.floor(wsId)))}`,
    { method: 'POST' },
  )
}

/** 按类型、状态和来源分页列出工作空间素材资产。 */
export function listAssets({ workspaceId, type = '', status = 'active', source = '', limit = 100, offset = 0 }) {
  const wsId = requirePositiveInteger(workspaceId, '工作空间 ID 无效')
  const query = new URLSearchParams({
    workspace_id: String(wsId),
    limit: String(limit),
    offset: String(offset),
  })

  if (type) {
    query.set('type', type)
  }

  if (status) {
    query.set('status', status)
  }

  if (source) {
    query.set('source', source)
  }

  return requestJson(`/api/v1/assets?${query}`)
}

/** 按工作空间和素材语义生成续传缓存键。 */
function assetUploadResumeKey(workspaceId, prompt, source) {
  return `${Math.floor(Number(workspaceId) || 0)}:${String(source || '')}:${String(prompt || '')}`
}

/** 读取同一 File 与业务键对应的未过期续传状态。 */
function getResumableAssetUpload(file, key) {
  return resumableAssetUploads.get(file)?.get(key) || null
}

/** 将新分配的资产和上传凭证绑定到 File 对象供重试复用。 */
function setResumableAssetUpload(file, key, value) {
  let entries = resumableAssetUploads.get(file)
  if (!entries) {
    entries = new Map()
    resumableAssetUploads.set(file, entries)
  }
  entries.set(key, value)
}

/** 仅在缓存仍为预期状态时清理续传记录，避免误删更新的请求。 */
function clearResumableAssetUpload(file, key, expectedValue = null) {
  const entries = resumableAssetUploads.get(file)
  if (!entries) return
  if (expectedValue && entries.get(key) !== expectedValue) return
  entries.delete(key)
  if (!entries.size) resumableAssetUploads.delete(file)
}

/** 判断资产完成回调是否可在不重传文件的前提下重试。 */
function isRetryableAssetCompleteError(error) {
  if (!error || error?.cause === 'aborted') return false
  const status = Number(error?.status || 0)
  return status === 0 || status === 408 || status === 425 || status === 429 || status >= 500
}

/** 将共享上传阶段的等待超时/取消转为携带资产进度的业务错误。 */
function createAssetUploadWaitError({ cause, assetId = 0, uploadSucceeded = null }) {
  const cancelled = cause === 'aborted'
  return new BusinessApiError(cancelled ? '素材文件上传已取消' : '素材文件上传超时，请重试', {
    code: cancelled ? 'ASSET_UPLOAD_ABORTED' : 'ASSET_UPLOAD_TIMEOUT',
    response: {
      asset_id: Number(assetId || 0),
      upload_succeeded: uploadSucceeded,
      retryable: true,
    },
    cause,
  })
}

/** 将分配、上传或完成阶段封装为可被多个调用方共享的单一 Promise。 */
function createSharedAssetUploadStage(execute, onSettled) {
  const controller = new AbortController()
  const stage = {
    controller,
    promise: null,
    settled: false,
    waiters: 0,
  }
  stage.promise = Promise.resolve()
    .then(() => execute(controller.signal))
    .finally(() => {
      stage.settled = true
      onSettled?.(stage)
    })
  // A caller can stop waiting before the shared request settles. Keep a
  // rejection observer attached so that aborting the final waiter never creates
  // an unhandled rejection while preserving the original promise for joiners.
  void stage.promise.catch(() => {})
  return stage
}

/**
 * 每个调用方拥有独立的取消/超时，同时对共享请求做引用计数。
 * 单个调用方不能取消其他等待者仍需要的工作；最后一个等待者离开后才中断底层阶段。
 */
function waitForSharedAssetUpload(stage, { signal, timeoutMs = 0, createWaitError }) {
  const normalizedTimeoutMs = Math.max(0, Math.floor(Number(timeoutMs) || 0))
  if (signal?.aborted) return Promise.reject(createWaitError('aborted'))
  if (!stage?.promise) return Promise.reject(createWaitError('aborted'))

  stage.waiters += 1

  return new Promise((resolve, reject) => {
    let settled = false
    let released = false
    let timeoutId = null

    const cleanup = () => {
      if (timeoutId !== null) globalThis.clearTimeout(timeoutId)
      signal?.removeEventListener('abort', abortWait)
    }
    const release = (cancelUnderlying) => {
      if (released) return
      released = true
      stage.waiters = Math.max(0, Number(stage.waiters || 0) - 1)
      if (cancelUnderlying && stage.waiters === 0 && !stage.settled && !stage.controller.signal.aborted) {
        stage.controller.abort()
      }
    }
    const settle = (callback, value, cancelUnderlying = false) => {
      if (settled) return
      settled = true
      cleanup()
      release(cancelUnderlying)
      callback(value)
    }
    const abortWait = () => settle(reject, createWaitError('aborted'), true)

    signal?.addEventListener('abort', abortWait, { once: true })
    if (normalizedTimeoutMs > 0) {
      timeoutId = globalThis.setTimeout(() => settle(reject, createWaitError('timeout'), true), normalizedTimeoutMs)
    }
    stage.promise.then(
      (value) => settle(resolve, value),
      (error) => settle(reject, error),
    )
  })
}

/**
 * 创建资产、上传对象存储并回调完成状态，支持多调用方共享和超时后续传。
 * 上传地址必须通过协议与主机白名单；对象存储超时不会立即创建新资产，以避免重复上传和孤儿记录。
 */
export async function uploadAssetFile({
  workspaceId,
  file,
  prompt = '',
  source = 'upload',
  signal = undefined,
  uploadTimeoutMs = OBJECT_STORAGE_UPLOAD_TIMEOUT_MS,
}) {
  if (signal?.aborted) {
    throw createAssetUploadWaitError({ cause: 'aborted' })
  }

  const resumeKey = assetUploadResumeKey(workspaceId, prompt, source)
  let pendingUpload = getResumableAssetUpload(file, resumeKey)
  if (pendingUpload && !pendingUpload.created && pendingUpload.createStage?.controller.signal.aborted) {
    clearResumableAssetUpload(file, resumeKey, pendingUpload)
    pendingUpload = null
  }
  if (
    pendingUpload &&
    !pendingUpload.uploaded &&
    !pendingUpload.createStage &&
    !pendingUpload.uploadStage &&
    Number(pendingUpload.createdAt || 0) > 0 &&
    Date.now() - Number(pendingUpload.createdAt) >= ASSET_UPLOAD_CREDENTIAL_TTL_MS
  ) {
    clearResumableAssetUpload(file, resumeKey, pendingUpload)
    pendingUpload = null
  }
  if (!pendingUpload) {
    pendingUpload = {
      created: null,
      createdAt: 0,
      createStage: null,
      uploadStage: null,
      completeStage: null,
      completed: null,
      uploaded: false,
    }
    setResumableAssetUpload(file, resumeKey, pendingUpload)
  }

  if (!pendingUpload.created) {
    if (!pendingUpload.createStage || pendingUpload.createStage.controller.signal.aborted) {
      const createStage = createSharedAssetUploadStage(
        (stageSignal) =>
          requestJson('/api/v1/assets', {
            method: 'POST',
            signal: stageSignal,
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              workspace_id: workspaceId,
              type: inferAssetType(file),
              source,
              name: file.name || '未命名素材',
              mime_type: file.type || 'application/octet-stream',
              size_bytes: file.size || 0,
              prompt,
            }),
          })
            .then((createdAsset) => {
              if (pendingUpload.createStage === createStage) {
                pendingUpload.created = createdAsset
                pendingUpload.createdAt = Date.now()
              }
              return createdAsset
            })
            .catch((error) => {
              if (pendingUpload.createStage === createStage) {
                clearResumableAssetUpload(file, resumeKey, pendingUpload)
              }
              throw error
            }),
        (settledStage) => {
          if (pendingUpload.createStage === settledStage) pendingUpload.createStage = null
        },
      )
      pendingUpload.createStage = createStage
    }
    await waitForSharedAssetUpload(pendingUpload.createStage, {
      signal,
      createWaitError: (cause) => createAssetUploadWaitError({ cause }),
    })
  }
  const created = pendingUpload.created
  const upload = created?.upload

  if (!upload?.url) {
    clearResumableAssetUpload(file, resumeKey, pendingUpload)
    throw new BusinessApiError('素材上传凭证缺失')
  }

  if (!created?.asset?.id) {
    clearResumableAssetUpload(file, resumeKey, pendingUpload)
    throw new BusinessApiError('素材元数据创建失败')
  }

  if (!isAllowedUploadUrl(upload.url)) {
    let blockedHost = upload.url
    try {
      blockedHost = new URL(upload.url).host
    } catch {
      /* ignore */
    }
    clearResumableAssetUpload(file, resumeKey, pendingUpload)
    throw new BusinessApiError(
      `素材上传地址不在受信任的存储域名列表中:${blockedHost}（请把该域名加入 .env 的 VITE_ZZH_ALLOWED_UPLOAD_ORIGINS）`,
    )
  }

  if (!pendingUpload.uploaded) {
    if (!pendingUpload.uploadStage || pendingUpload.uploadStage.controller.signal.aborted) {
      const uploadStage = createSharedAssetUploadStage(
        async (stageSignal) => {
          const formData = new FormData()
          Object.entries(upload.form_fields || {}).forEach(([key, value]) => {
            formData.append(key, value)
          })
          formData.append('file', file)

          let uploadResponse

          try {
            uploadResponse = await withRequestTimeout(
              (requestSignal) =>
                fetch(upload.url, {
                  method: 'POST',
                  body: formData,
                  // 预签名上传不应发生跳转；fail-closed 避免被允许的存储域 3xx 重定向到
                  // 内网/任意主机后浏览器自动跟随并把文件体重新 POST 过去（绕过上方 allowlist）。
                  redirect: 'error',
                  ...(requestSignal ? { signal: requestSignal } : {}),
                }),
              {
                signal: stageSignal,
                timeoutMs: OBJECT_STORAGE_UPLOAD_TIMEOUT_MS,
                defaultTimeoutMs: OBJECT_STORAGE_UPLOAD_TIMEOUT_MS,
              },
            )
          } catch (error) {
            if (error instanceof RequestAbortError) {
              const abortedByCaller = error.abortCause === 'aborted'
              throw new BusinessApiError(abortedByCaller ? '素材文件上传已取消' : '素材文件上传超时，请重试', {
                code: abortedByCaller ? 'ASSET_UPLOAD_ABORTED' : 'ASSET_UPLOAD_TIMEOUT',
                response: {
                  asset_id: Number(created.asset.id),
                  upload_succeeded: null,
                  retryable: true,
                },
                cause: error.abortCause,
              })
            }
            const isFetchTypeError = typeof TypeError !== 'undefined' && error instanceof TypeError
            throw new BusinessApiError(
              isFetchTypeError
                ? '素材文件上传失败（可能是对象存储未配置 CORS、发生了非预期跳转，或被浏览器拦截）'
                : '素材文件上传失败，请检查对象存储服务',
              {
                code: 'ASSET_UPLOAD_RETRYABLE',
                response: {
                  asset_id: Number(created.asset.id),
                  upload_succeeded: null,
                  retryable: true,
                },
                cause: error,
              },
            )
          }

          if (!uploadResponse.ok) {
            // A concrete 4xx response means the credential/object write was rejected.
            // Discard only the local retry credential; never delete the remote asset or
            // object because the storage service remains the source of truth.
            if (
              uploadResponse.status >= 400 &&
              uploadResponse.status < 500 &&
              pendingUpload.uploadStage === uploadStage
            ) {
              clearResumableAssetUpload(file, resumeKey, pendingUpload)
            }
            throw new BusinessApiError(`素材文件上传失败 (${uploadResponse.status})`, {
              status: uploadResponse.status,
              code: uploadResponse.status >= 500 ? 'ASSET_UPLOAD_RETRYABLE' : 'ASSET_UPLOAD_REJECTED',
              response: {
                asset_id: Number(created.asset.id),
                upload_succeeded: false,
                retryable: uploadResponse.status >= 500,
              },
            })
          }

          if (pendingUpload.uploadStage === uploadStage) pendingUpload.uploaded = true
        },
        (settledStage) => {
          if (pendingUpload.uploadStage === settledStage) pendingUpload.uploadStage = null
        },
      )
      pendingUpload.uploadStage = uploadStage
    }
    await waitForSharedAssetUpload(pendingUpload.uploadStage, {
      signal,
      timeoutMs: uploadTimeoutMs,
      createWaitError: (cause) =>
        createAssetUploadWaitError({
          cause,
          assetId: created.asset.id,
          uploadSucceeded: null,
        }),
    })
  }

  const asset = created.asset
  let completed = pendingUpload.completed
  try {
    if (!completed && (!pendingUpload.completeStage || pendingUpload.completeStage.controller.signal.aborted)) {
      const completeStage = createSharedAssetUploadStage(
        (stageSignal) =>
          completeAssetUpload({
            workspaceId,
            assetId: asset.id,
            signal: stageSignal,
          }).then((completedAsset) => {
            if (pendingUpload.completeStage === completeStage) pendingUpload.completed = completedAsset
            return completedAsset
          }),
        (settledStage) => {
          if (pendingUpload.completeStage === settledStage) pendingUpload.completeStage = null
        },
      )
      pendingUpload.completeStage = completeStage
    }
    if (!completed) {
      completed = await waitForSharedAssetUpload(pendingUpload.completeStage, {
        signal,
        createWaitError: (cause) =>
          createAssetUploadWaitError({
            cause,
            assetId: asset.id,
            uploadSucceeded: true,
          }),
      })
    }
  } catch (error) {
    if (error?.cause === 'aborted') {
      throw error
    }
    // The object is already present. Keep the same asset in the File-scoped
    // resume cache so the next retry only repeats /complete and cannot duplicate
    // storage or billing. Never issue an automatic DELETE for this state.
    if (!isRetryableAssetCompleteError(error)) {
      clearResumableAssetUpload(file, resumeKey, pendingUpload)
      throw new BusinessApiError('素材文件已上传，但素材状态确认失败，请重新选择文件上传', {
        status: error?.status,
        code: 'ASSET_COMPLETE_FAILED',
        response: {
          asset_id: Number(asset.id),
          upload_succeeded: true,
          retryable: false,
        },
        cause: error,
      })
    }
    throw new BusinessApiError('素材文件已上传，正在确认素材状态，请重试', {
      status: error?.status,
      code: 'ASSET_COMPLETE_PENDING',
      response: {
        asset_id: Number(asset.id),
        upload_succeeded: true,
        retryable: true,
      },
      cause: error,
    })
  }

  clearResumableAssetUpload(file, resumeKey, pendingUpload)

  return {
    asset: completed || asset,
    upload,
  }
}

/** 通知后端对象已上传完成，触发资产入库和元数据处理。 */
export function completeAssetUpload({ workspaceId, assetId, signal }: any = {}) {
  return requestJsonWithRetry(
    `/api/v1/assets/${assetId}/complete?workspace_id=${workspaceId}`,
    {
      method: 'POST',
      signal,
    },
    {
      retries: ASSET_COMPLETE_RETRY_LIMIT,
      baseDelayMs: 600,
      shouldRetry: isRetryableAssetCompleteError,
    },
  )
}

/** 为指定资产读取同源下载/流式地址，避免持久化过期预签名 URL。 */
export async function getAssetDownloadUrl({ workspaceId, assetId }) {
  // 直接返回【同源流式地址】(/download,后端鉴权流式返回),而非 OSS 预签名(/download-url)。
  // 预签名 URL 是 http + IP 主机:① 在 HTTPS 页面会被浏览器当 Mixed Content 拦掉(IP 主机不自动升级)→ 破图;
  // ② 带 X-Amz-Expires 短期过期 → 一会儿就 403。流式地址同源、走 HTTPS、不过期,从根上规避这两个问题。
  // 仅用于浏览器内显示/下载(本函数所有调用点都是 img/video src 与封面刷新),不作为传给后端的生成输入。
  const id = requirePositiveInteger(assetId, '素材 ID 无效')
  const ws = requirePositiveInteger(workspaceId, '工作空间 ID 无效')
  return `/api/v1/assets/${id}/download?workspace_id=${ws}`
}

/** 删除指定工作空间的素材资产。 */
export function deleteAsset({ workspaceId, assetId }) {
  const id = requirePositiveInteger(assetId, '素材 ID 无效')
  const wsId = requirePositiveInteger(workspaceId, '工作空间 ID 无效')
  return requestJson(`/api/v1/assets/${id}?workspace_id=${wsId}`, {
    method: 'DELETE',
  })
}

/** 以 draft_revision 乐观锁更新创意项目草稿，并可同步持久化封面资产。 */
export function updateCreativeProjectDraft({ projectId, workspaceId, draft, draftRevision, coverAssetId = 0 }) {
  const id = requirePositiveInteger(projectId, '项目 ID 无效')
  const wsId = requirePositiveInteger(workspaceId, '工作空间 ID 无效')
  const revisionNumber = Number(draftRevision)
  const hasRevision = Number.isFinite(revisionNumber) && revisionNumber >= 0
  // 封面:省略=保留现有,整数=替换。只在有正整数 asset_id 时下发,避免误清空。
  const coverId = Number(coverAssetId || 0)
  const hasCover = Number.isFinite(coverId) && coverId > 0
  return requestJson(`/api/v1/creative/projects/${id}/draft?workspace_id=${wsId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      draft: typeof draft === 'string' ? draft : JSON.stringify(draft ?? {}),
      ...(hasRevision ? { draft_revision: Math.floor(revisionNumber) } : {}),
      ...(hasCover ? { cover_asset_id: Math.floor(coverId) } : {}),
    }),
  })
}

/** 分页列出工作空间中的创意项目。 */
export async function listCreativeProjects({ workspaceId, offset = 0, limit = 50 }: any = {}) {
  const params = new URLSearchParams()
  const wsId = Number(workspaceId || 0)
  if (Number.isFinite(wsId) && wsId > 0) {
    params.set('workspace_id', String(Math.floor(wsId)))
  }
  const off = Number(offset || 0)
  const lim = Number(limit || 0)
  if (Number.isFinite(off) && off > 0) params.set('offset', String(Math.floor(off)))
  if (Number.isFinite(lim) && lim > 0) params.set('limit', String(Math.floor(lim)))
  const suffix = params.toString() ? `?${params.toString()}` : ''
  const payload = await requestJson(`/api/v1/creative/projects${suffix}`)
  return extractPageItems(payload)
}

/** 读取指定工作空间下的单个创意项目详情。 */
export function getCreativeProject({ projectId, workspaceId }: any = {}) {
  const id = requirePositiveInteger(projectId, '项目 ID 无效')
  const wsId = requirePositiveInteger(workspaceId, '工作空间 ID 无效')
  return requestJson(`/api/v1/creative/projects/${id}?workspace_id=${wsId}`)
}

// 我的专属推广码(GET /api/v1/referral/my-code)。会话鉴权、无参数。
// 返回 data:{ code:"ZZH-XXXX" };这里直接取出推广码字符串,拿不到则空串。
/** 读取当前用户的推广邀请码。 */
export async function getReferralMyCode(): Promise<string> {
  const data: any = await requestJson('/api/v1/referral/my-code')
  return String(data?.code || '').trim()
}

/** 局部修改项目标题/名称，不覆盖草稿其他内容。 */
export function patchCreativeProject({ projectId, workspaceId, title, name }: any = {}) {
  const id = requirePositiveInteger(projectId, '项目 ID 无效')
  const wsId = requirePositiveInteger(workspaceId, 'workspace_id 缺失')

  const payload = {}
  const nextTitle = String(title || '').trim()
  const nextName = String(name || '').trim()
  if (nextTitle) payload.title = nextTitle
  if (nextName) payload.name = nextName

  return requestJson(`/api/v1/creative/projects/${id}?workspace_id=${wsId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

/** 创建创意项目，并保留调用方给出的流程和初始草稿。 */
export function createCreativeProject(payload = {}) {
  const body = payload && typeof payload === 'object' && !Array.isArray(payload) ? { ...payload } : {}
  const workspaceId = requirePositiveInteger(body.workspace_id ?? body.workspaceId, '工作空间 ID 无效')
  body.workspace_id = workspaceId
  delete body.workspaceId
  return requestJson(`/api/v1/creative/projects?workspace_id=${workspaceId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

/** 将创意项目删除到回收站。 */
export function deleteCreativeProject({ projectId, workspaceId }: any = {}) {
  const id = requirePositiveInteger(projectId, '项目 ID 无效')
  const wsId = requirePositiveInteger(workspaceId, 'workspace_id 缺失')
  return requestJson(`/api/v1/creative/projects/${id}?workspace_id=${wsId}`, {
    method: 'DELETE',
  })
}

/** 从回收站永久删除指定创意项。 */
export function deleteCreativeTrashItem({ id, trashId, workspaceId }: any = {}) {
  const resolvedId = Number(id || trashId || 0)
  if (!Number.isFinite(resolvedId) || resolvedId <= 0) {
    throw new BusinessApiError('垃圾桶条目 ID 无效')
  }
  const wsId = Number(workspaceId || 0)
  const query = Number.isFinite(wsId) && wsId > 0 ? `?workspace_id=${Math.floor(wsId)}` : ''
  return requestJson(`/api/v1/creative/trash/${Math.floor(resolvedId)}${query}`, {
    method: 'DELETE',
  })
}

/** 将指定创意项从回收站恢复到项目列表。 */
export function restoreCreativeTrashItem({ id, trashId, workspaceId }: any = {}) {
  const resolvedId = Number(id || trashId || 0)
  if (!Number.isFinite(resolvedId) || resolvedId <= 0) {
    throw new BusinessApiError('垃圾桶条目 ID 无效')
  }
  const wsId = Number(workspaceId || 0)
  const query = Number.isFinite(wsId) && wsId > 0 ? `?workspace_id=${Math.floor(wsId)}` : ''
  return requestJson(`/api/v1/creative/trash/${Math.floor(resolvedId)}/restore${query}`, {
    method: 'POST',
  })
}

/** 从 AI 任务的直接字段或 result_json 中提取最终文本。 */
export function extractTaskText(task) {
  const raw = normalizeResultJson(task?.result_json)

  return findTextOutput(raw) || task?.output_text || ''
}

/** 从 AI 任务 outputs 与 result_json 中收集并去重媒体地址。 */
export function extractTaskMediaUrls(task) {
  const urls = []

  if (Array.isArray(task?.outputs)) {
    task.outputs.forEach((output) => {
      if (typeof output?.url === 'string' && output.url) {
        urls.push(output.url)
      }
    })
  }

  collectUrls(normalizeResultJson(task?.result_json), urls)

  return [...new Set(urls)]
}

/** 从数组或常见分页信封中提取 items 列表。 */
export function extractPageItems(payload) {
  if (Array.isArray(payload)) {
    return payload
  }

  if (Array.isArray(payload?.items)) {
    return payload.items
  }

  return []
}

/** 从资产列表响应中兼容提取素材数组。 */
export function extractAssetPageItems(payload) {
  return extractPageItems(payload)
}

// 素材接口返回 { items, total, offset, limit }（requestJson 已解包 data）。
// 翻页需要 total/offset 判断是否还有下一页，单独抽出带元信息的版本。
/** 将资产分页响应归一化为 items、total、limit 和 offset。 */
export function extractAssetPage(payload) {
  const items = extractPageItems(payload)
  const toNum = (value, fallback) => {
    const n = Number(value)
    return Number.isFinite(n) ? n : fallback
  }
  return {
    items,
    total: toNum(payload?.total, items.length),
    offset: toNum(payload?.offset, 0),
    limit: toNum(payload?.limit, items.length),
  }
}

/** 根据 MIME、文件名或资产字段推断 image/video/audio 类型。 */
export function inferAssetType(fileOrAsset) {
  const mimeType = fileOrAsset?.type || fileOrAsset?.mime_type || ''

  if (mimeType.startsWith('image/')) {
    return 'image'
  }

  if (mimeType.startsWith('video/')) {
    return 'video'
  }

  if (mimeType.startsWith('audio/')) {
    return 'audio'
  }

  return 'prompt'
}

/** 从可用模型中先按操作码过滤，再按偏好关键词选出最佳模型。 */
function pickModel(models, operationCode = '', preferredKeywords = []) {
  const model = chooseModelCandidate(models, {
    operationCode,
    preferredKeywords,
  })

  if (model) {
    return model
  }

  if (preferredKeywords.length) {
    throw new BusinessApiError(
      `当前业务系统没有启用匹配 ${preferredKeywords.join(' / ')} 的模型，请先在管理后台配置模型和价格`,
      {
        code: MODEL_NOT_FOUND_CODE,
      },
    )
  }

  if (operationCode) {
    throw new BusinessApiError(`当前业务系统没有启用支持 ${operationCode} 的模型，请先在管理后台配置模型和价格`, {
      code: MODEL_NOT_FOUND_CODE,
    })
  }

  throw new BusinessApiError('当前没有可用的 AI 模型', {
    code: MODEL_NOT_FOUND_CODE,
  })
}

/** 将套餐候选归一化后逐个尝试加载模型。 */
async function getModelFromPlanCandidates(planCandidates, loadModel) {
  return submitWithPlanCandidates(planCandidates, loadModel)
}

/** 按套餐候选提交操作，只在明确的模型/套餐不可用错误下切换。 */
async function submitWithPlanCandidates(planCandidates, attempt) {
  const candidates = normalizePlanCandidates(planCandidates)
  let lastError = null

  for (const plan of candidates) {
    try {
      return await attempt(plan)
    } catch (error) {
      if (!isRetryableModelSelectionError(error)) {
        throw error
      }

      lastError = error
    }
  }

  throw lastError || new BusinessApiError('当前没有可用的 AI 模型')
}

/** 读取有 TTL 的模型缓存，未命中时加载并仅缓存成功结果。 */
async function getCachedModel(cacheKey, loader) {
  const cached = modelCache.get(cacheKey)
  const now = Date.now()

  if (cached && now - cached.createdAt < MODEL_CACHE_TTL_MS) {
    return cached.promise
  }

  const promise = loader().catch((error) => {
    if (modelCache.get(cacheKey)?.promise === promise) {
      modelCache.delete(cacheKey)
    }

    throw error
  })

  modelCache.set(cacheKey, {
    createdAt: now,
    promise,
  })

  return promise
}

/** requestJson 遇到 401 时用于刷新业务会话的同源路径。 */
const AUTH_REFRESH_PATH = '/api/v1/auth/refresh'
/** 全局单飞会话刷新 Promise，避免多个 401 同时触发刷新风暴。 */
let sessionRefreshPromise = null
/** 发起或复用一次业务会话刷新，结束后只清理当次 Promise。 */
function refreshBusinessSession() {
  if (!sessionRefreshPromise) {
    sessionRefreshPromise = withRequestTimeout(
      (signal) =>
        fetch(buildUrl(businessApiBaseUrl, AUTH_REFRESH_PATH), {
          method: 'POST',
          credentials: 'include',
          ...(signal ? { signal } : {}),
        }),
      { defaultTimeoutMs: DEFAULT_API_REQUEST_TIMEOUT_MS },
    )
      .then((res) => res.ok)
      .catch(() => false)
    // 结束后清空,后续再 401 可再次触发刷新
    sessionRefreshPromise.finally(() => {
      sessionRefreshPromise = null
    })
  }
  return sessionRefreshPromise
}

/**
 * 业务 API 的统一 JSON 请求层：同源 cookie、超时/取消、业务信封解包与错误归一。
 * 401 最多经单飞 refresh 重放一次，且不对 refresh 本身递归重放，防止无限鉴权循环。
 */
async function requestJson(path, options: any = {}, _retried = false) {
  let response
  let payload
  const hasTimeoutOverride = Object.prototype.hasOwnProperty.call(options || {}, 'timeoutMs')
  const { timeoutMs: _timeoutMs, signal: externalSignal, ...fetchOptions } = options || {}

  try {
    const result = await withRequestTimeout(
      async (signal) => {
        const nextResponse = await fetch(buildUrl(businessApiBaseUrl, path), {
          credentials: 'include',
          ...fetchOptions,
          ...(signal ? { signal } : {}),
        })
        const nextPayload = await readJsonResponse(nextResponse)
        return { response: nextResponse, payload: nextPayload }
      },
      {
        signal: externalSignal,
        defaultTimeoutMs: DEFAULT_API_REQUEST_TIMEOUT_MS,
        ...(hasTimeoutOverride ? { timeoutMs: _timeoutMs } : {}),
      },
    )
    response = result.response
    payload = result.payload
  } catch (error) {
    if (error instanceof RequestAbortError) {
      const abortedByCaller = error.abortCause === 'aborted'
      throw new BusinessApiError(abortedByCaller ? '网络请求已取消' : '网络请求超时，请稍后重试', {
        response: error.originalError,
        cause: error.abortCause,
      })
    }
    throw new BusinessApiError('网络请求失败，请检查接口服务或本地代理配置', {
      response: error,
    })
  }

  // 401 → 先静默续期一次再重试原请求;排除续期接口本身,避免死循环。
  // 这样短命 access token 过期时用户无感(自动续上重试),只有续期也失败才真正报「登录失效」。
  if (response.status === 401 && !_retried && !String(path).includes(AUTH_REFRESH_PATH)) {
    const ok = await refreshBusinessSession()
    if (ok) return requestJson(path, options, true)
  }

  if (!response.ok || isBusinessError(payload)) {
    throw new BusinessApiError(payload?.message || `请求失败 (${response.status})`, {
      status: response.status,
      code: payload?.code ?? payload?.code_string ?? null,
      response: payload,
    })
  }

  // 用字段存在性判断而非 ?? ：避免把合法的 data:null（成功但无数据）回退成整个包裹对象。
  return payload && typeof payload === 'object' && 'data' in payload ? payload.data : payload
}

/** 先读取响应文本再解析 JSON，空响应返回 null，非 JSON 转为统一业务异常。 */
async function readJsonResponse(response) {
  const text = await response.text()

  if (!text) {
    return null
  }

  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/** 识别 HTTP 成功但 code/code_string 表示失败的业务信封。 */
function isBusinessError(payload) {
  if (!payload || typeof payload !== 'object') {
    return false
  }

  if (typeof payload.code === 'number' && payload.code !== 0) {
    return true
  }

  return typeof payload.code_string === 'string' && payload.code_string !== 'OK'
}

/** 将任务 result_json 的对象或 JSON 字符串容错转为可遍历结构。 */
function normalizeResultJson(resultJson) {
  if (!resultJson) {
    return null
  }

  if (typeof resultJson === 'string') {
    try {
      return JSON.parse(resultJson)
    } catch {
      return resultJson
    }
  }

  return resultJson
}

/** 在嵌套任务结果中递归查找首个可用文本输出。 */
function findTextOutput(value) {
  if (!value) {
    return ''
  }

  if (typeof value === 'string') {
    return value.trim()
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const text = findTextOutput(item)

      if (text) {
        return text
      }
    }

    return ''
  }

  if (typeof value !== 'object') {
    return ''
  }

  for (const key of ['output_text', 'text', 'content', 'message']) {
    const text = findTextOutput(value[key])

    if (text) {
      return text
    }
  }

  for (const key of ['response', 'data', 'output', 'choices']) {
    const text = findTextOutput(value[key])

    if (text) {
      return text
    }
  }

  return ''
}

/** 在嵌套任务结果中递归收集经安全清洗的媒体 URL。 */
function collectUrls(value, urls) {
  if (!value) {
    return
  }

  if (typeof value === 'string') {
    if (/^https?:\/\//i.test(value)) {
      urls.push(value)
    }

    return
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectUrls(item, urls))
    return
  }

  if (typeof value !== 'object') {
    return
  }

  Object.entries(value).forEach(([key, fieldValue]) => {
    if (typeof fieldValue === 'string' && /url|uri|link/i.test(key) && /^https?:\/\//i.test(fieldValue)) {
      urls.push(fieldValue)
      return
    }

    collectUrls(fieldValue, urls)
  })
}

/** 判断归一化 AI 任务状态是否为成功或失败终态。 */
function isFinalTaskStatus(status) {
  // 注意:后端不同 provider 返回的终态值可能不同(succeeded/completed/success 均为成功,error 为失败);
  // 必须与 useTaskPolling.isSuccessStatus / isFailedStatus 保持一致,否则 waitForAiTask 会无限轮询。
  return ['succeeded', 'completed', 'success', 'failed', 'error', 'payment_failed', 'cancelled', 'expired'].includes(
    normalizeAiTaskStatus(status),
  )
}

// sleep imported from ../utils/common.js

/** 用 Web Crypto 或时间随机兜底为单次提交创建幂等键。 */
function createIdempotencyKey(prefix) {
  const randomId = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `${prefix}_${randomId}`
}

/** 构造同源业务 URL，对绝对后端地址只保留 path 和 query。 */
function buildUrl(baseUrl, path) {
  if (!path) {
    return baseUrl
  }

  if (/^https?:\/\//.test(path)) {
    return toProxiedBusinessUrl(path)
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`

  if (!baseUrl) {
    return normalizedPath
  }

  return `${normalizeBaseUrl(baseUrl)}${normalizedPath}`
}

/** 将绝对业务地址转为当前站点代理可访问的相对路径。 */
function toProxiedBusinessUrl(url) {
  try {
    const parsedUrl = new URL(url)
    return `${parsedUrl.pathname}${parsedUrl.search}`
  } catch {
    return '/'
  }
}

/** 去除基础地址尾部斜杠，避免 URL 拼接出双斜杠。 */
function normalizeBaseUrl(url) {
  return String(url || '').replace(/\/+$/, '')
}

/** 移除请求对象中的 null、undefined、空字符串和空数组，保留 0/false。 */
function removeEmptyFields(value) {
  if (!value || typeof value !== 'object') {
    return value
  }

  return Object.fromEntries(
    Object.entries(value).filter(([, fieldValue]) => {
      if (fieldValue === undefined || fieldValue === null) {
        return false
      }

      if (typeof fieldValue === 'string') {
        return fieldValue.trim() !== ''
      }

      if (Array.isArray(fieldValue)) {
        return fieldValue.length > 0
      }

      return true
    }),
  )
}
