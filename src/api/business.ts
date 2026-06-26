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

const DEFAULT_BUSINESS_API_BASE_URL = ''
const DEFAULT_BUSINESS_REMOTE_ORIGIN = ''

const businessRemoteOrigin = normalizeBaseUrl(import.meta.env.VITE_ZZH_REMOTE_ORIGIN || DEFAULT_BUSINESS_REMOTE_ORIGIN)
const businessApiBaseUrl = resolveProxyFriendlyBaseUrl(
  import.meta.env.VITE_ZZH_API_BASE_URL || DEFAULT_BUSINESS_API_BASE_URL,
  '',
  businessRemoteOrigin,
)
const extraAllowedUploadOrigins = String(import.meta.env.VITE_ZZH_ALLOWED_UPLOAD_ORIGINS || '')
  .split(',')
  .map((item) => normalizeBaseUrl(item.trim()))
  .filter(Boolean)

const MODEL_CACHE_TTL_MS = 30_000
const modelCache = new Map()
const PROVIDER_TASK_RETRY_LIMIT = 2
const PROVIDER_TASK_RETRY_BACKOFF_MS = [700, 1400]

// Whitelist for uploadAssetFile destinations. Blocks redirect-to-internal-host attacks.
const ALLOWED_UPLOAD_HOST_PATTERNS = [
  // Configured business origin (e.g. MinIO behind same domain)
  businessRemoteOrigin,
  ...extraAllowedUploadOrigins,
  // Common object-storage providers used in this project
  /\.amazonaws\.com$/i,
  /\.tos-cn-[a-z0-9-]+\.volces\.com$/i,
  /\.aliyuncs\.com$/i,
  /\.myqcloud\.com$/i,
]

function isAllowedUploadUrl(url) {
  if (!url || typeof url !== 'string') {
    return false
  }

  // Same-origin relative URL — always allowed (will route via current page origin).
  if (url.startsWith('/')) {
    return true
  }

  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return false
  }

  // 开发环境:本机连的是开发者自己的后端/对象存储,放行任意 http(s) 上传地址
  // (省去为每个后端的 MinIO 端口手配白名单)。生产构建仍走下面的严格白名单。
  if (import.meta.env.DEV) {
    return true
  }

  const normalizedOrigin = normalizeBaseUrl(parsed.origin)
  const hostname = parsed.hostname

  return ALLOWED_UPLOAD_HOST_PATTERNS.some((pattern) => {
    if (!pattern) return false
    if (pattern instanceof RegExp) return pattern.test(hostname)
    return normalizedOrigin === pattern
  })
}

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

export function isAbortedTaskError(error) {
  return Boolean(error && error.cause === 'aborted')
}

export function getBusinessErrorMessage(error, fallback = '业务接口请求失败，请稍后重试') {
  if (error instanceof BusinessApiError && error.message) {
    if (error.status === 401) {
      return '登录状态已失效，请重新登录'
    }

    if (error.status === 409) {
      const code = String(error.code || '').toUpperCase()
      const responseMessage = String(
        error.response?.message || error.response?.error?.message || error.response?.data?.message || '',
      ).trim()
      const message = responseMessage || error.message
      if (code === 'CONFLICT' || /owner|所有者|转让|退出|离开/i.test(message)) {
        return message
      }
      return '草稿保存冲突：项目可能不属于当前工作空间，请切换工作空间后重试'
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
function devMock(flag) {
  if (!import.meta.env.DEV) return false
  try {
    return String(window.localStorage.getItem('zzh_mock') || '').includes(flag)
  } catch {
    return false
  }
}

export async function listAiModels({ capability = '', operationCode = '', plan = 'pro' }: any = {}) {
  // 开发 mock:模拟"当前套餐不允许该模型"(用于手测前端受限 UI / 报错提示)
  if (devMock('model-locked')) {
    throw new BusinessApiError('当前模型需要开通对应套餐后才能使用（mock）', {
      status: 403,
      code: 'MODEL_NOT_ALLOWED_BY_PLAN',
    })
  }

  const query = new URLSearchParams()

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
    return await requestJson(`/api/v1/ai/models${query.toString() ? `?${query}` : ''}`)
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

export async function getModelForOperation(
  operationCode,
  preferredKeywords = [],
  planCandidates = DEFAULT_MODEL_PLAN_CANDIDATES,
) {
  return getModelFromPlanCandidates(planCandidates, (plan) =>
    getModelForOperationFromPlan(operationCode, preferredKeywords, plan),
  )
}

export async function getModelForCapability(
  capability,
  preferredOperationCode = '',
  preferredKeywords = [],
  planCandidates = DEFAULT_MODEL_PLAN_CANDIDATES,
) {
  return getModelFromPlanCandidates(planCandidates, (plan) =>
    getModelForCapabilityFromPlan(capability, preferredOperationCode, preferredKeywords, plan),
  )
}

export function getModelForOperationFromPlan(operationCode, preferredKeywords = []) {
  // Same rationale as getModelForCapabilityFromPlan: backend resolves the
  // caller's subscription server-side; we just ask for the operation we want.
  const cacheKey = `op:${operationCode}:${preferredKeywords.join('|')}`

  return getCachedModel(cacheKey, async () => {
    const models = await listAiModels({ operationCode })
    return pickModel(models, operationCode, preferredKeywords)
  })
}

export function getModelForCapabilityFromPlan(capability, preferredOperationCode = '', preferredKeywords = []) {
  // Backend filters by the caller's actual subscription server-side; passing
  // `plan` from the client only causes false-negative empty lists when the
  // local plan candidate list is wrong or stale.
  const key = ['cap', capability, preferredOperationCode, preferredKeywords.join('|')].filter(Boolean).join(':')

  return getCachedModel(key, async () => {
    const models = await listAiModels({ capability })
    return pickModel(models, preferredOperationCode, preferredKeywords)
  })
}

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
}: any) {
  if (modelVersionId) {
    let lastError = null
    for (let attempt = 0; attempt <= PROVIDER_TASK_RETRY_LIMIT; attempt += 1) {
      try {
        return await submitAiResponse({
          workspaceId,
          modelId: modelVersionId,
          operationCode,
          idempotencyKey: createIdempotencyKey('resp'),
          prompt,
          messages,
          inputAssets,
          params,
          stream,
        })
      } catch (error) {
        lastError = error
        if (!isProviderTaskFailedError(error) || attempt >= PROVIDER_TASK_RETRY_LIMIT) {
          throw error
        }
        await sleep(PROVIDER_TASK_RETRY_BACKOFF_MS[attempt] || 1400)
      }
    }
    throw lastError || new BusinessApiError('AI 请求失败，请稍后重试')
  }

  return submitWithPlanCandidates(modelPlanCandidates, async (plan) => {
    const models = await listAiModels({ operationCode, plan })
    const candidates = getEligibleModelsForOperation(models, operationCode)
    const preferred = pickModel(candidates, operationCode, [])
    const ordered = buildOrderedModelCandidates(candidates, preferred)
    let lastError = null

    for (const model of ordered) {
      for (let attempt = 0; attempt <= PROVIDER_TASK_RETRY_LIMIT; attempt += 1) {
        try {
          return await submitAiResponse({
            workspaceId,
            modelId: model.id,
            operationCode,
            idempotencyKey: createIdempotencyKey('resp'),
            prompt,
            messages,
            inputAssets,
            params,
            stream,
          })
        } catch (error) {
          lastError = error
          if (isProviderTaskFailedError(error) && attempt < PROVIDER_TASK_RETRY_LIMIT) {
            await sleep(PROVIDER_TASK_RETRY_BACKOFF_MS[attempt] || 1400)
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

export async function streamAiResponse({
  workspaceId,
  operationCode,
  prompt,
  messages,
  inputAssets,
  params,
  modelPlanCandidates = DEFAULT_MODEL_PLAN_CANDIDATES,
  onDelta,
  signal,
}: any) {
  return submitWithPlanCandidates(modelPlanCandidates, async (plan) => {
    const models = await listAiModels({ operationCode, plan })
    const candidates = getEligibleModelsForOperation(models, operationCode)
    const preferred = pickModel(candidates, operationCode, [])
    const ordered = buildOrderedModelCandidates(candidates, preferred)
    let lastError = null

    for (const model of ordered) {
      for (let attempt = 0; attempt <= PROVIDER_TASK_RETRY_LIMIT; attempt += 1) {
        try {
          return await openAiResponseStream({
            workspaceId,
            modelId: model.id,
            operationCode,
            idempotencyKey: createIdempotencyKey('resp'),
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
            await sleep(PROVIDER_TASK_RETRY_BACKOFF_MS[attempt] || 1400)
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
      if (payload?.task_id || payload?.id) {
        finalTask = {
          ...(finalTask || {}),
          id: payload?.task_id || payload?.id,
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
    } else if (payload?.id && payload?.status) {
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
}: any) {
  const submitTask = async ({ idempotencyKey, modelId, resolvedParams, resolvedInputAssets }) => {
    try {
      return await submitAiTask({
        workspaceId,
        modelId,
        operationCode,
        idempotencyKey,
        prompt,
        params: resolvedParams,
        inputAssets: resolvedInputAssets,
      })
    } catch (error) {
      const shouldDropInputAssets = shouldDropInputAssetsForOperationError(error, operationCode, resolvedInputAssets)

      if (shouldDropInputAssets) {
        try {
          return await submitAiTask({
            workspaceId,
            modelId,
            operationCode,
            idempotencyKey: createIdempotencyKey('task'),
            prompt,
            params: resolvedParams,
            inputAssets: [],
          })
        } catch (nextError) {
          if (!shouldDropVideoParamsForOperationError(nextError, operationCode)) {
            throw nextError
          }
          return submitAiTask({
            workspaceId,
            modelId,
            operationCode,
            idempotencyKey: createIdempotencyKey('task'),
            prompt,
            params: simplifyVideoTaskParams(resolvedParams),
            inputAssets: [],
          })
        }
      }

      if (!shouldDropVideoParamsForOperationError(error, operationCode)) {
        throw error
      }

      return submitAiTask({
        workspaceId,
        modelId,
        operationCode,
        idempotencyKey: createIdempotencyKey('task'),
        prompt,
        params: simplifyVideoTaskParams(resolvedParams),
        inputAssets: resolvedInputAssets,
      })
    }
  }

  if (modelVersionId) {
    const model = await resolveExplicitTaskModel({
      modelVersionId,
      modelVersion,
      capability,
      operationCode,
    })
    const resolvedParams = resolveTaskField(params, model)
    const resolvedInputAssets = resolveTaskField(inputAssets, model)

    return submitTask({
      idempotencyKey: createIdempotencyKey('task'),
      modelId: model.id || modelVersionId,
      resolvedParams,
      resolvedInputAssets,
    })
  }

  return submitWithPlanCandidates(modelPlanCandidates, async (plan) => {
    const models = await listAiModels({ capability, operationCode, plan })
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
          idempotencyKey: createIdempotencyKey('task'),
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

function resolveTaskField(value, model) {
  return typeof value === 'function' ? value(model) : value
}

function getEligibleModelsForOperation(models, operationCode = '') {
  const list = Array.isArray(models) ? models : []
  const filtered = list.filter((model) => {
    if (!model?.enabled) return false
    if (!operationCode) return true
    return Array.isArray(model.operation_codes) && model.operation_codes.includes(operationCode)
  })
  return filtered.length ? filtered : list
}

function buildOrderedModelCandidates(models, preferredModel) {
  const list = Array.isArray(models) ? models : []
  const preferredId = Number(preferredModel?.id || 0)
  const preferred = list.find((model) => Number(model?.id || 0) === preferredId)
  const rest = list.filter((model) => Number(model?.id || 0) !== preferredId)
  return preferred ? [preferred, ...rest] : rest
}

function shouldRetryWithNextModel(error) {
  if (!error) return false
  if (isRetryableModelSelectionError(error)) return true
  if (!(error instanceof BusinessApiError)) return false
  const message = String(error.message || '').toLowerCase()
  const responseMessage = String(
    error.response?.message || error.response?.error?.message || error.response?.data?.message || '',
  ).toLowerCase()
  const code = String(error.code || '').toUpperCase()
  if (error.status >= 500) return true
  if (code === 'INTERNAL_ERROR' || code === '50008') return true
  return /provider task failed|status failed|upstream|model.*(failed|error)|internal_error|服务内部错误|服务器内部错误/i.test(
    `${message} ${responseMessage}`,
  )
}

function isProviderTaskFailedError(error) {
  if (!(error instanceof BusinessApiError)) return false
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

function shouldDropInputAssetsForOperationError(error, operationCode, inputAssets) {
  if (!(error instanceof BusinessApiError)) return false
  if (!operationCode || !String(operationCode).startsWith('video.')) return false
  if (!Array.isArray(inputAssets) || inputAssets.length === 0) return false
  const message = String(error.message || '').toLowerCase()
  const responseMessage = String(error.response?.message || '').toLowerCase()
  return /input asset role .*not allowed|invalidparameter/.test(`${message} ${responseMessage}`)
}

function shouldDropVideoParamsForOperationError(error, operationCode) {
  if (!(error instanceof BusinessApiError)) return false
  if (!operationCode || !String(operationCode).startsWith('video.')) return false
  const message = String(error.message || '').toLowerCase()
  const responseMessage = String(error.response?.message || '').toLowerCase()
  return /invalidparameter/.test(`${message} ${responseMessage}`)
}

function simplifyVideoTaskParams(params) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return params
  }
  const payload = {}
  if (Object.prototype.hasOwnProperty.call(params, 'duration')) {
    payload.duration = params.duration
  }
  if (Object.prototype.hasOwnProperty.call(params, 'seconds')) {
    payload.seconds = params.seconds
  }
  return payload
}

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

async function resolveExplicitTaskModel({ modelVersionId, modelVersion, capability, operationCode }) {
  if (modelVersion && typeof modelVersion === 'object') {
    return modelVersion
  }

  if (modelVersionId && typeof modelVersionId === 'object') {
    return modelVersionId
  }

  const modelId = Number(modelVersionId || 0)

  if (modelId > 0) {
    try {
      const models = await listAiModels({ capability, operationCode })
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
}: any) {
  const normalizedMessages = normalizeResponseMessages(messages)
  return requestJson(`/api/v1/ai/responses${stream ? '?stream=true' : ''}`, {
    method: 'POST',
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

function submitAiTask({ workspaceId, modelId, operationCode, idempotencyKey, prompt, params, inputAssets }) {
  return requestJson('/api/v1/ai/tasks', {
    method: 'POST',
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
  })
}

export function getAiTask({ workspaceId, taskId }) {
  return requestJson(`/api/v1/ai/tasks/${taskId}?workspace_id=${workspaceId}`)
}

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

export function cancelAiTask({ workspaceId, taskId }: any = {}) {
  const wsId = Number(workspaceId || 0)
  const id = Number(taskId || 0)
  if (!Number.isFinite(wsId) || wsId <= 0) {
    throw new BusinessApiError('工作空间 ID 无效')
  }
  if (!Number.isFinite(id) || id <= 0) {
    throw new BusinessApiError('任务 ID 无效')
  }
  return requestJson(`/api/v1/ai/tasks/${Math.floor(id)}/cancel?workspace_id=${Math.floor(wsId)}`, { method: 'POST' })
}

export async function waitForAiTask({ workspaceId, task, intervalMs = 1600, timeoutMs = 120000, onPoll, signal }) {
  let currentTask = task
  const startedAt = Date.now()

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

  while (currentTask?.id && !isFinalTaskStatus(currentTask.status)) {
    ensureNotAborted()

    if (Date.now() - startedAt > timeoutMs) {
      throw new BusinessApiError('AI 任务生成超时，请稍后在历史记录中查看')
    }

    await sleep(intervalMs)
    ensureNotAborted()
    currentTask = await getAiTask({ workspaceId, taskId: currentTask.id })

    if (typeof onPoll === 'function' && currentTask) {
      try {
        onPoll(currentTask)
      } catch {
        /* swallow listener error */
      }
    }
  }

  if (['failed', 'payment_failed', 'cancelled', 'expired'].includes(currentTask?.status)) {
    // payment_failed 通常是积分不足；把 code/状态透传给 getBusinessErrorMessage 做中文映射。
    const code =
      currentTask?.code ??
      currentTask?.code_string ??
      (currentTask?.status === 'payment_failed' ? 'INSUFFICIENT_CREDITS' : null)
    throw new BusinessApiError(currentTask?.error_message || 'AI 任务生成失败', {
      code,
      response: currentTask,
    })
  }

  return currentTask || task
}

export function listBillingPlans() {
  return requestJson('/api/v1/billing/plans')
}

export function getAdminSession() {
  return requestJson('/api/v1/admin/session')
}

export function getAdminOverview({ from = '', to = '' }: any = {}) {
  const query = new URLSearchParams()
  if (from) query.set('from', String(from))
  if (to) query.set('to', String(to))
  return requestJson(`/api/v1/admin/overview${query.toString() ? `?${query}` : ''}`)
}

export function listAdminAuditLogs({
  actorAdminUserId = '',
  action = '',
  resourceType = '',
  resourceId = '',
  from = '',
  to = '',
  limit = 20,
  offset = 0,
}: any = {}) {
  const query = new URLSearchParams({
    limit: String(Math.max(1, Math.min(Number(limit) || 20, 100))),
    offset: String(Math.max(0, Number(offset) || 0)),
  })
  if (actorAdminUserId !== '' && actorAdminUserId !== null && actorAdminUserId !== undefined) {
    query.set('actor_admin_user_id', String(actorAdminUserId))
  }
  if (action) query.set('action', String(action))
  if (resourceType) query.set('resource_type', String(resourceType))
  if (resourceId) query.set('resource_id', String(resourceId))
  if (from) query.set('from', String(from))
  if (to) query.set('to', String(to))
  return requestJson(`/api/v1/admin/audit-logs?${query}`)
}

export function listAdminProviders() {
  return requestJson('/api/v1/admin/settings/providers')
}

export function updateAdminProvider(provider, request = {}) {
  const providerName = String(provider || '').trim()
  if (!providerName) {
    throw new BusinessApiError('服务商标识不能为空')
  }
  return requestJson(`/api/v1/admin/settings/providers/${encodeURIComponent(providerName)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request && typeof request === 'object' ? removeEmptyFields(request) : {}),
  })
}

export function testAdminProviderConnection(provider, request = {}) {
  const providerName = String(provider || '').trim()
  if (!providerName) {
    throw new BusinessApiError('服务商标识不能为空')
  }
  return requestJson(`/api/v1/admin/settings/providers/${encodeURIComponent(providerName)}/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request && typeof request === 'object' ? removeEmptyFields(request) : {}),
  })
}

export function listAdminModels({ provider = '', enabled = '', limit = 20, offset = 0 }: any = {}) {
  const query = new URLSearchParams({
    limit: String(Math.max(1, Math.min(Number(limit) || 20, 100))),
    offset: String(Math.max(0, Number(offset) || 0)),
  })
  if (provider) query.set('provider', String(provider))
  if (enabled !== '' && enabled !== null && enabled !== undefined) query.set('enabled', String(enabled))
  return requestJson(`/api/v1/admin/models?${query}`)
}

export function createAdminModel(request = {}) {
  return requestJson('/api/v1/admin/models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request && typeof request === 'object' ? removeEmptyFields(request) : {}),
  })
}

export function getAdminModelDetail(id) {
  const modelId = Number(id || 0)
  if (!Number.isFinite(modelId) || modelId <= 0) {
    throw new BusinessApiError('模型 ID 无效')
  }
  return requestJson(`/api/v1/admin/models/${Math.floor(modelId)}`)
}

export function updateAdminModel(id, request = {}) {
  const modelId = Number(id || 0)
  if (!Number.isFinite(modelId) || modelId <= 0) {
    throw new BusinessApiError('模型 ID 无效')
  }
  return requestJson(`/api/v1/admin/models/${Math.floor(modelId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request && typeof request === 'object' ? removeEmptyFields(request) : {}),
  })
}

export function enableAdminModel(id) {
  const modelId = Number(id || 0)
  if (!Number.isFinite(modelId) || modelId <= 0) {
    throw new BusinessApiError('模型 ID 无效')
  }
  return requestJson(`/api/v1/admin/models/${Math.floor(modelId)}/enable`, { method: 'POST' })
}

export function disableAdminModel(id) {
  const modelId = Number(id || 0)
  if (!Number.isFinite(modelId) || modelId <= 0) {
    throw new BusinessApiError('模型 ID 无效')
  }
  return requestJson(`/api/v1/admin/models/${Math.floor(modelId)}/disable`, { method: 'POST' })
}

export function testEstimateAdminModel(id, request = {}) {
  const modelId = Number(id || 0)
  if (!Number.isFinite(modelId) || modelId <= 0) {
    throw new BusinessApiError('模型 ID 无效')
  }
  return requestJson(`/api/v1/admin/models/${Math.floor(modelId)}/test-estimate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request && typeof request === 'object' ? removeEmptyFields(request) : {}),
  })
}

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

export function listCreditLedgers({ workspaceId, kind = '', limit = 20, offset = 0 }: any = {}) {
  const wsId = Number(workspaceId || 0)
  if (!Number.isFinite(wsId) || wsId <= 0) {
    throw new BusinessApiError('工作空间 ID 无效')
  }
  const query = new URLSearchParams({
    workspace_id: String(Math.floor(wsId)),
    limit: String(Math.max(1, Math.min(Number(limit) || 20, 100))),
    offset: String(Math.max(0, Number(offset) || 0)),
  })
  if (kind) {
    query.set('kind', String(kind))
  }
  return requestJson(`/api/v1/billing/credit-ledgers?${query}`)
}

export function listPaymentOrders({ workspaceId, type = '', status = '', limit = 20, offset = 0 }: any = {}) {
  const wsId = Number(workspaceId || 0)
  if (!Number.isFinite(wsId) || wsId <= 0) {
    throw new BusinessApiError('工作空间 ID 无效')
  }
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

/**
 * Lists the workspaces (个人空间 / 团队) the current user belongs to.
 * @returns {Promise<Array<{ id: number, type: string, name: string, owner_user_id: number, status: string }>>}
 */
export function listWorkspaces() {
  return requestJson('/api/v1/workspaces')
}

/**
 * Creates a team workspace.
 * @param {{ name: string, type?: string }} params
 * @returns {Promise<{ id: number, type: string, name: string, owner_user_id: number, status: string }>}
 */
export function createWorkspace({ name, type = 'team' }) {
  return requestJson('/api/v1/workspaces', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: String(name || '').trim(), type }),
  })
}

/**
 * Redeems an invitation code and joins the corresponding workspace.
 * @param {{ inviteCode: string }} params
 * @returns {Promise<any>}
 */
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
export function leaveWorkspace({ workspaceId }: any = {}) {
  const id = Number(workspaceId || 0)
  if (!Number.isFinite(id) || id <= 0) {
    throw new BusinessApiError('工作空间 ID 无效')
  }
  return requestJson(`/api/v1/workspaces/${Math.floor(id)}/leave`, {
    method: 'POST',
  })
}

export function listWorkspaceInvitations(workspaceId) {
  const id = Number(workspaceId || 0)
  if (!Number.isFinite(id) || id <= 0) {
    throw new BusinessApiError('工作空间 ID 无效')
  }
  return requestJson(`/api/v1/workspaces/${Math.floor(id)}/invitations`)
}

export function createWorkspaceInvitation({ workspaceId, expiryDays, role = 'member' }: any = {}) {
  const id = Number(workspaceId || 0)
  if (!Number.isFinite(id) || id <= 0) {
    throw new BusinessApiError('工作空间 ID 无效')
  }
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

export function deleteWorkspaceInvitation({ workspaceId, invitationId }: any = {}) {
  const id = Number(workspaceId || 0)
  const invId = Number(invitationId || 0)
  if (!Number.isFinite(id) || id <= 0) {
    throw new BusinessApiError('工作空间 ID 无效')
  }
  if (!Number.isFinite(invId) || invId <= 0) {
    throw new BusinessApiError('邀请 ID 无效')
  }
  return requestJson(`/api/v1/workspaces/${Math.floor(id)}/invitations/${Math.floor(invId)}`, {
    method: 'DELETE',
  })
}

export function removeWorkspaceMember({ workspaceId, userId }: any = {}) {
  const id = Number(workspaceId || 0)
  const uid = Number(userId || 0)
  if (!Number.isFinite(id) || id <= 0) {
    throw new BusinessApiError('工作空间 ID 无效')
  }
  if (!Number.isFinite(uid) || uid <= 0) {
    throw new BusinessApiError('成员 ID 无效')
  }
  return requestJson(`/api/v1/workspaces/${Math.floor(id)}/members/${Math.floor(uid)}`, {
    method: 'DELETE',
  })
}

export function updateWorkspaceMemberRole({ workspaceId, userId, role }: any = {}) {
  const id = Number(workspaceId || 0)
  const uid = Number(userId || 0)
  const nextRole = String(role || '').trim()
  if (!Number.isFinite(id) || id <= 0) {
    throw new BusinessApiError('工作空间 ID 无效')
  }
  if (!Number.isFinite(uid) || uid <= 0) {
    throw new BusinessApiError('成员 ID 无效')
  }
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

export function updateWorkspaceMemberQuota({
  workspaceId,
  userId,
  canGenerate,
  maxTaskCredits,
  monthlyCreditLimit,
}: any = {}) {
  const id = Number(workspaceId || 0)
  const uid = Number(userId || 0)
  if (!Number.isFinite(id) || id <= 0) {
    throw new BusinessApiError('工作空间 ID 无效')
  }
  if (!Number.isFinite(uid) || uid <= 0) {
    throw new BusinessApiError('成员 ID 无效')
  }
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

export function transferWorkspaceOwnership({ workspaceId, userId }: any = {}) {
  const id = Number(workspaceId || 0)
  const uid = Number(userId || 0)
  if (!Number.isFinite(id) || id <= 0) {
    throw new BusinessApiError('工作空间 ID 无效')
  }
  if (!Number.isFinite(uid) || uid <= 0) {
    throw new BusinessApiError('成员 ID 无效')
  }
  return requestJson(`/api/v1/workspaces/${Math.floor(id)}/transfer-ownership`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to_user_id: uid,
    }),
  })
}

/**
 * Lists purchasable credit packages (one-off recharge options).
 * @returns {Promise<Array<{ id: number, code: string, name: string, amount_cents: number, credits: number, status: string }>>}
 */
export function listCreditPackages() {
  return requestJson('/api/v1/billing/credit-packages')
}

/**
 * Current subscription for a workspace.
 * @param {number} workspaceId
 * @returns {Promise<{ active: boolean, plan_code: string, plan_name: string, current_period_end: string, period?: string, base_credits?: number, concurrency?: number, max_members?: number, current_member_count?: number }>}
 */
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

/**
 * Credit wallet balance for a workspace.
 * @param {number} workspaceId
 * @returns {Promise<{ workspace_id: number, balance: number, frozen: number, available: number }>}
 */
export function getWallet(workspaceId) {
  return requestJson(`/api/v1/billing/wallet?workspace_id=${encodeURIComponent(String(workspaceId))}`)
}

/**
 * Creates a one-off credit recharge order. Returns the order plus an Alipay
 * gateway pay_url the caller opens in the system browser.
 * @param {{ workspaceId: number, creditPackageId: number }} params
 * @returns {Promise<{ order: object, pay_url: string }>}
 */
export function createRechargeOrder({ workspaceId, creditPackageId }) {
  return requestJson('/api/v1/billing/recharge-orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspace_id: Number(workspaceId),
      credit_package_id: Number(creditPackageId),
    }),
  })
}

/**
 * 开通普通订阅(一次性付款)。返回订单 + 支付宝 pay_url(一次性网站支付,非周期扣款签约)。
 * 这是会员套餐「立即开通」用的接口;签约(sign-url)是周期扣款,暂未开通权限。
 * @param {{ workspaceId: number, planId: number }} params
 * @returns {Promise<{ order: object, pay_url: string }>}
 */
export function createSubscriptionOrder({ workspaceId, planId }) {
  return requestJson('/api/v1/billing/subscription-orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspace_id: Number(workspaceId),
      plan_id: Number(planId),
    }),
  })
}

/**
 * 待支付续费账单列表(订阅周期到期 / 待支付的续费单)。
 * @param {number} workspaceId
 * @returns {Promise<Array<object>>}
 */
export function listRenewalOrders(workspaceId) {
  return requestJson(`/api/v1/billing/renewal-orders?workspace_id=${encodeURIComponent(String(workspaceId))}`)
}

/**
 * 为某条待支付续费账单生成支付链接,返回支付宝 pay_url。
 * @param {{ workspaceId: number, renewalOrderId: number }} params
 * @returns {Promise<{ order?: object, pay_url: string }>}
 */
export function createRenewalPayUrl({ workspaceId, renewalOrderId }) {
  const wsq = workspaceId ? `?workspace_id=${encodeURIComponent(String(workspaceId))}` : ''
  return requestJson(`/api/v1/billing/renewal-orders/${Math.floor(Number(renewalOrderId))}/pay-url${wsq}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspace_id: Number(workspaceId) }),
  })
}

/**
 * Creates a recurring-subscription sign URL. Returns the plan plus an Alipay
 * agreement sign_url the caller opens in the system browser.
 * @param {{ workspaceId: number, planId: number }} params
 * @returns {Promise<{ plan: object, sign_url: string }>}
 */
export function createSubscriptionSignUrl({ workspaceId, planId }) {
  return requestJson('/api/v1/billing/subscriptions/sign-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspace_id: Number(workspaceId),
      plan_id: Number(planId),
    }),
  })
}

export function cancelSubscription({ workspaceId, subscriptionId }) {
  const wsId = Number(workspaceId || 0)
  const subId = Number(subscriptionId || 0)
  if (!Number.isFinite(wsId) || wsId <= 0) {
    throw new BusinessApiError('工作空间 ID 无效')
  }
  if (!Number.isFinite(subId) || subId <= 0) {
    throw new BusinessApiError('订阅 ID 无效')
  }
  return requestJson(
    `/api/v1/billing/subscriptions/${Math.floor(subId)}/cancel?workspace_id=${encodeURIComponent(String(Math.floor(wsId)))}`,
    { method: 'POST' },
  )
}

export function listAssets({ workspaceId, type = '', status = 'active', source = '', limit = 100, offset = 0 }) {
  const query = new URLSearchParams({
    workspace_id: String(workspaceId),
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

export async function uploadAssetFile({ workspaceId, file, prompt = '', source = 'upload' }) {
  const created = await requestJson('/api/v1/assets', {
    method: 'POST',
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
  const upload = created?.upload

  if (!upload?.url) {
    throw new BusinessApiError('素材上传凭证缺失')
  }

  if (!created?.asset?.id) {
    throw new BusinessApiError('素材元数据创建失败')
  }

  if (!isAllowedUploadUrl(upload.url)) {
    let blockedHost = upload.url
    try {
      blockedHost = new URL(upload.url).host
    } catch {
      /* ignore */
    }
    throw new BusinessApiError(
      `素材上传地址不在受信任的存储域名列表中:${blockedHost}（请把该域名加入 .env 的 VITE_ZZH_ALLOWED_UPLOAD_ORIGINS）`,
    )
  }

  const formData = new FormData()
  Object.entries(upload.form_fields || {}).forEach(([key, value]) => {
    formData.append(key, value)
  })
  formData.append('file', file)

  let uploadResponse

  try {
    uploadResponse = await fetch(upload.url, {
      method: 'POST',
      body: formData,
      // 预签名上传不应发生跳转；fail-closed 避免被允许的存储域 3xx 重定向到
      // 内网/任意主机后浏览器自动跟随并把文件体重新 POST 过去（绕过上方 allowlist）。
      redirect: 'error',
    })
  } catch (error) {
    const isFetchTypeError = typeof TypeError !== 'undefined' && error instanceof TypeError
    throw new BusinessApiError(
      isFetchTypeError
        ? '素材文件上传失败（可能是对象存储未配置 CORS、发生了非预期跳转，或被浏览器拦截）'
        : '素材文件上传失败，请检查对象存储服务',
      { response: error },
    )
  }

  if (!uploadResponse.ok) {
    throw new BusinessApiError(`素材文件上传失败 (${uploadResponse.status})`, {
      status: uploadResponse.status,
    })
  }

  const asset = created.asset
  const completed = await completeAssetUpload({
    workspaceId,
    assetId: asset.id,
  })

  return {
    asset: completed || asset,
    upload,
  }
}

export function completeAssetUpload({ workspaceId, assetId }) {
  return requestJson(`/api/v1/assets/${assetId}/complete?workspace_id=${workspaceId}`, {
    method: 'POST',
  })
}

export async function getAssetDownloadUrl({ workspaceId, assetId }) {
  const payload = await requestJson(`/api/v1/assets/${assetId}/download-url?workspace_id=${workspaceId}`)
  // 服务端可能返回 JSON { download_url: "..." } 或直接返回 URL 字符串
  if (typeof payload === 'string' && payload.trim()) {
    return sanitizeMediaUrl(payload.trim())
  }
  return sanitizeMediaUrl(payload?.download_url || payload?.url || '')
}

export async function downloadAssetFile({ workspaceId, assetId }) {
  const wsId = Number(workspaceId || 0)
  const id = Number(assetId || 0)
  if (!Number.isFinite(wsId) || wsId <= 0) {
    throw new BusinessApiError('工作空间 ID 无效')
  }
  if (!Number.isFinite(id) || id <= 0) {
    throw new BusinessApiError('素材 ID 无效')
  }

  let response
  try {
    response = await fetch(
      buildUrl(businessApiBaseUrl, `/api/v1/assets/${Math.floor(id)}/download?workspace_id=${Math.floor(wsId)}`),
      {
        credentials: 'include',
      },
    )
  } catch (error) {
    throw new BusinessApiError('网络请求失败，请检查接口服务或本地代理配置', {
      response: error,
    })
  }

  if (!response.ok) {
    const payload = await readJsonResponse(response)
    throw new BusinessApiError(payload?.message || `请求失败 (${response.status})`, {
      status: response.status,
      code: payload?.code ?? payload?.code_string ?? null,
      response: payload,
    })
  }

  const blob = await response.blob()
  return {
    blob,
    fileName: parseDownloadFileName(response.headers.get('content-disposition')),
    mimeType: response.headers.get('content-type') || blob.type || '',
  }
}

export function deleteAsset({ workspaceId, assetId }) {
  return requestJson(`/api/v1/assets/${assetId}?workspace_id=${workspaceId}`, {
    method: 'DELETE',
  })
}

export function updateCreativeProjectDraft({ projectId, workspaceId, draft, draftRevision }) {
  const id = Number(projectId || 0)
  if (!Number.isFinite(id) || id <= 0) {
    throw new BusinessApiError('项目 ID 无效')
  }

  const wsId = Number(workspaceId || 0)
  const query = Number.isFinite(wsId) && wsId > 0 ? `?workspace_id=${wsId}` : ''
  const revisionNumber = Number(draftRevision)
  const hasRevision = Number.isFinite(revisionNumber) && revisionNumber >= 0
  return requestJson(`/api/v1/creative/projects/${id}/draft${query}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      draft: typeof draft === 'string' ? draft : JSON.stringify(draft ?? {}),
      ...(hasRevision ? { draft_revision: Math.floor(revisionNumber) } : {}),
    }),
  })
}

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

export function getCreativeProject({ projectId, workspaceId }: any = {}) {
  const id = Number(projectId || 0)
  if (!Number.isFinite(id) || id <= 0) {
    throw new BusinessApiError('项目 ID 无效')
  }
  const wsId = Number(workspaceId || 0)
  const query = Number.isFinite(wsId) && wsId > 0 ? `?workspace_id=${wsId}` : ''
  return requestJson(`/api/v1/creative/projects/${id}${query}`)
}

export function patchCreativeProject({ projectId, workspaceId, title, name }: any = {}) {
  const id = Number(projectId || 0)
  if (!Number.isFinite(id) || id <= 0) {
    throw new BusinessApiError('项目 ID 无效')
  }

  const wsId = Number(workspaceId || 0)
  if (!Number.isFinite(wsId) || wsId <= 0) {
    throw new BusinessApiError('workspace_id 缺失')
  }

  const payload = {}
  const nextTitle = String(title || '').trim()
  const nextName = String(name || '').trim()
  if (nextTitle) payload.title = nextTitle
  if (nextName) payload.name = nextName

  return requestJson(`/api/v1/creative/projects/${id}?workspace_id=${Math.floor(wsId)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

export function listCreativeProjectVersions({ projectId, workspaceId, offset = 0, limit = 50 }: any = {}) {
  const id = Number(projectId || 0)
  if (!Number.isFinite(id) || id <= 0) {
    throw new BusinessApiError('项目 ID 无效')
  }
  const wsId = Number(workspaceId || 0)
  if (!Number.isFinite(wsId) || wsId <= 0) {
    throw new BusinessApiError('workspace_id 缺失')
  }
  const params = new URLSearchParams()
  params.set('workspace_id', String(Math.floor(wsId)))
  const off = Number(offset || 0)
  const lim = Number(limit || 0)
  if (Number.isFinite(off) && off > 0) params.set('offset', String(Math.floor(off)))
  if (Number.isFinite(lim) && lim > 0) params.set('limit', String(Math.floor(lim)))
  return requestJson(`/api/v1/creative/projects/${id}/versions?${params.toString()}`)
}

export function createCreativeProjectVersion({ projectId, workspaceId, ...payload }: any = {}) {
  const id = Number(projectId || 0)
  if (!Number.isFinite(id) || id <= 0) {
    throw new BusinessApiError('项目 ID 无效')
  }
  const wsId = Number(workspaceId || 0)
  if (!Number.isFinite(wsId) || wsId <= 0) {
    throw new BusinessApiError('workspace_id 缺失')
  }
  const body = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}
  return requestJson(`/api/v1/creative/projects/${id}/versions?workspace_id=${Math.floor(wsId)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

export function getCreativeProjectVersion({ projectId, versionId, vid, workspaceId }: any = {}) {
  const id = Number(projectId || 0)
  if (!Number.isFinite(id) || id <= 0) {
    throw new BusinessApiError('项目 ID 无效')
  }
  const resolvedVid = Number(versionId || vid || 0)
  if (!Number.isFinite(resolvedVid) || resolvedVid <= 0) {
    throw new BusinessApiError('版本 ID 无效')
  }
  const wsId = Number(workspaceId || 0)
  if (!Number.isFinite(wsId) || wsId <= 0) {
    throw new BusinessApiError('workspace_id 缺失')
  }
  return requestJson(
    `/api/v1/creative/projects/${id}/versions/${Math.floor(resolvedVid)}?workspace_id=${Math.floor(wsId)}`,
  )
}

export function deleteCreativeProjectVersion({ projectId, versionId, vid, workspaceId }: any = {}) {
  const id = Number(projectId || 0)
  if (!Number.isFinite(id) || id <= 0) {
    throw new BusinessApiError('项目 ID 无效')
  }
  const resolvedVid = Number(versionId || vid || 0)
  if (!Number.isFinite(resolvedVid) || resolvedVid <= 0) {
    throw new BusinessApiError('版本 ID 无效')
  }
  const wsId = Number(workspaceId || 0)
  if (!Number.isFinite(wsId) || wsId <= 0) {
    throw new BusinessApiError('workspace_id 缺失')
  }
  return requestJson(
    `/api/v1/creative/projects/${id}/versions/${Math.floor(resolvedVid)}?workspace_id=${Math.floor(wsId)}`,
    {
      method: 'DELETE',
    },
  )
}

export function restoreCreativeProjectVersion({ projectId, versionId, vid, workspaceId }: any = {}) {
  const id = Number(projectId || 0)
  if (!Number.isFinite(id) || id <= 0) {
    throw new BusinessApiError('项目 ID 无效')
  }
  const resolvedVid = Number(versionId || vid || 0)
  if (!Number.isFinite(resolvedVid) || resolvedVid <= 0) {
    throw new BusinessApiError('版本 ID 无效')
  }
  const wsId = Number(workspaceId || 0)
  if (!Number.isFinite(wsId) || wsId <= 0) {
    throw new BusinessApiError('workspace_id 缺失')
  }
  return requestJson(
    `/api/v1/creative/projects/${id}/versions/${Math.floor(resolvedVid)}/restore?workspace_id=${Math.floor(wsId)}`,
    {
      method: 'POST',
    },
  )
}

export function createCreativeProject(payload = {}) {
  const body = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}
  const workspaceId = Number(body.workspace_id || body.workspaceId || 0)
  const query = Number.isFinite(workspaceId) && workspaceId > 0 ? `?workspace_id=${workspaceId}` : ''
  return requestJson(`/api/v1/creative/projects${query}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

export function deleteCreativeProject({ projectId, workspaceId }: any = {}) {
  const id = Number(projectId || 0)
  if (!Number.isFinite(id) || id <= 0) {
    throw new BusinessApiError('项目 ID 无效')
  }
  const wsId = Number(workspaceId || 0)
  if (!Number.isFinite(wsId) || wsId <= 0) {
    throw new BusinessApiError('workspace_id 缺失')
  }
  return requestJson(`/api/v1/creative/projects/${id}?workspace_id=${Math.floor(wsId)}`, {
    method: 'DELETE',
  })
}

export function extractTaskText(task) {
  const raw = normalizeResultJson(task?.result_json)

  return findTextOutput(raw) || task?.output_text || ''
}

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

export function extractPageItems(payload) {
  if (Array.isArray(payload)) {
    return payload
  }

  if (Array.isArray(payload?.items)) {
    return payload.items
  }

  return []
}

export function extractAssetPageItems(payload) {
  return extractPageItems(payload)
}

// 素材接口返回 { items, total, offset, limit }（requestJson 已解包 data）。
// 翻页需要 total/offset 判断是否还有下一页，单独抽出带元信息的版本。
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

async function getModelFromPlanCandidates(planCandidates, loadModel) {
  return submitWithPlanCandidates(planCandidates, loadModel)
}

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

const AUTH_REFRESH_PATH = '/api/v1/auth/refresh'
// 401 自动续期:同一时刻多个请求都 401 时共用一次刷新,避免并发刷新风暴。
let sessionRefreshPromise = null
function refreshBusinessSession() {
  if (!sessionRefreshPromise) {
    sessionRefreshPromise = fetch(buildUrl(businessApiBaseUrl, AUTH_REFRESH_PATH), {
      method: 'POST',
      credentials: 'include',
    })
      .then((res) => res.ok)
      .catch(() => false)
    // 结束后清空,后续再 401 可再次触发刷新
    sessionRefreshPromise.finally(() => {
      sessionRefreshPromise = null
    })
  }
  return sessionRefreshPromise
}

async function requestJson(path, options = {}, _retried = false) {
  let response

  try {
    response = await fetch(buildUrl(businessApiBaseUrl, path), {
      credentials: 'include',
      ...options,
    })
  } catch (error) {
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

  const payload = await readJsonResponse(response)

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

function parseDownloadFileName(contentDisposition) {
  const value = String(contentDisposition || '').trim()
  if (!value) return ''

  const utf8Match = value.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]).trim()
    } catch {
      return utf8Match[1].trim()
    }
  }

  const plainMatch = value.match(/filename\s*=\s*"([^"]+)"/i) || value.match(/filename\s*=\s*([^;]+)/i)
  return String(plainMatch?.[1] || '')
    .trim()
    .replace(/^["']|["']$/g, '')
}

function isBusinessError(payload) {
  if (!payload || typeof payload !== 'object') {
    return false
  }

  if (typeof payload.code === 'number' && payload.code !== 0) {
    return true
  }

  return typeof payload.code_string === 'string' && payload.code_string !== 'OK'
}

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

function isFinalTaskStatus(status) {
  return ['succeeded', 'failed', 'payment_failed', 'cancelled', 'expired'].includes(String(status || '').toLowerCase())
}

// sleep imported from ../utils/common.js

function createIdempotencyKey(prefix) {
  const randomId = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `${prefix}_${randomId}`
}

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

function toProxiedBusinessUrl(url) {
  try {
    const parsedUrl = new URL(url)

    if (normalizeBaseUrl(parsedUrl.origin) === businessRemoteOrigin) {
      return `${parsedUrl.pathname}${parsedUrl.search}`
    }
  } catch {
    return url
  }

  return url
}

function normalizeBaseUrl(url) {
  return String(url || '').replace(/\/+$/, '')
}

function resolveProxyFriendlyBaseUrl(configuredBaseUrl, proxyBaseUrl, remoteOrigin) {
  const normalizedConfigured = normalizeBaseUrl(configuredBaseUrl)
  const normalizedProxy = normalizeBaseUrl(proxyBaseUrl)
  if (!import.meta.env.DEV) {
    return normalizedConfigured || normalizedProxy
  }
  if (!normalizedConfigured) {
    return normalizedProxy
  }
  if (remoteOrigin && normalizedConfigured === remoteOrigin) {
    return normalizedProxy
  }
  return normalizedConfigured
}

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
