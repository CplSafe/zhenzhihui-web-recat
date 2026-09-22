/**
 * 加载爆款复制 video.replicate 模型，并投影为首页通用模型下拉的数据。
 * 目录以后端为权威：展示当前工作空间已启用且明确支持 video.replicate 的全部模型，
 * 完整后端记录用于参数校验、费用预估和正式提交。
 *
 * 与 useGenerationModelCatalog 同样按工作空间做内存缓存：爆款复制页来回切不再每次重拉。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getBusinessErrorMessage, listAiModels } from '@/api/business'
import { createSharedRequestCache } from '@/utils/sharedRequestCache'
import type { GenerationModelGroup, GenerationModelOption } from '@/components/smart/GenerationModelPicker'
import {
  MODEL_CATALOG_CACHE_TTL_MS,
  getBackendGenerationModelConfigurationError,
  getBackendGenerationModelName,
  getBackendGenerationModelVersionId,
  isBackendGenerationModelEnabled,
  unwrapGenerationModelCatalogResponse,
  type BackendGenerationModel,
} from '@/utils/generationModelCatalog'
import { buildModelRestrictionSummary } from '@/utils/modelRestrictions'
import { readModelPresentation } from '@/utils/modelPresentation'

export const HOT_COPY_MODEL_OPERATION_CODE = 'video.replicate'

interface HotCopyCatalogModel {
  id: number
  source: BackendGenerationModel
  option: GenerationModelOption
}

export interface HotCopyModelCatalogState {
  pickerGroups: GenerationModelGroup[]
  loading: boolean
  error: string
  ready: boolean
  reload: () => void
  resolveModel: (modelVersionId: unknown) => BackendGenerationModel | null
}

const OPERATION_KEYS = ['operation_codes', 'operationCodes', 'operation_code', 'operationCode', 'operations'] as const

function collectOperationTexts(value: unknown, result: Set<string>): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectOperationTexts(item, result))
    return
  }
  if (value && typeof value === 'object') {
    const record = value as Readonly<Record<string, unknown>>
    collectOperationTexts(record.code ?? record.operation_code ?? record.operationCode ?? record.value, result)
    return
  }
  if (typeof value !== 'string' && typeof value !== 'number') return
  const text = String(value).trim()
  if (!text) return
  if (text.startsWith('[')) {
    try {
      collectOperationTexts(JSON.parse(text), result)
      return
    } catch {
      // 非法 JSON 继续按分隔字符串处理。
    }
  }
  text.split(/[\s,|]+/).forEach((operationCode) => {
    const normalized = operationCode.trim()
    if (normalized) result.add(normalized)
  })
}

function matchesReplicateOperation(model: BackendGenerationModel): boolean {
  const declaresOperation = OPERATION_KEYS.some((key) => Object.prototype.hasOwnProperty.call(model, key))
  if (!declaresOperation) return false
  const operations = new Set<string>()
  OPERATION_KEYS.forEach((key) => collectOperationTexts(model[key], operations))
  return operations.has(HOT_COPY_MODEL_OPERATION_CODE)
}

function readBackendText(source: BackendGenerationModel, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key]
    if (typeof value !== 'string' && typeof value !== 'number') continue
    const text = String(value).trim()
    if (text) return text
  }
  return ''
}

function normalizeCatalogModel(model: BackendGenerationModel): HotCopyCatalogModel | null {
  if (!isBackendGenerationModelEnabled(model) || !matchesReplicateOperation(model)) {
    return null
  }
  const id = getBackendGenerationModelVersionId(model)
  const name = getBackendGenerationModelName(model)
  if (!id || !name) return null
  const unavailableReason = getBackendGenerationModelConfigurationError(model)
  const source: BackendGenerationModel = {
    ...model,
    id,
  }
  const restrictionSummary = unavailableReason
    ? { messages: [], constraints: {} }
    : buildModelRestrictionSummary(source)
  const description = readBackendText(
    source,
    'description',
    'display_description',
    'displayDescription',
    'model_description',
    'modelDescription',
  )
  const tags = [
    readBackendText(source, 'provider_name', 'providerName', 'provider'),
    readBackendText(source, 'version_name', 'versionName', 'version'),
  ].filter((tag, index, all) => tag && all.indexOf(tag) === index)

  const logo = readModelPresentation(source).logo

  return {
    id,
    source,
    option: {
      id,
      name,
      ...(logo ? { logo } : {}),
      ...(description ? { description } : {}),
      ...(tags.length ? { tags } : {}),
      ...(restrictionSummary.messages.length ? { restrictions: restrictionSummary.messages } : {}),
      ...(Object.keys(restrictionSummary.constraints).length ? { constraints: restrictionSummary.constraints } : {}),
      ...(unavailableReason ? { disabled: true, unavailableReason } : {}),
    },
  }
}

function dedupeModels(models: HotCopyCatalogModel[]): HotCopyCatalogModel[] {
  const byId = new Map<number, HotCopyCatalogModel>()
  models.forEach((model) => {
    const existing = byId.get(model.id)
    if (!existing || (existing.option.disabled && !model.option.disabled)) byId.set(model.id, model)
  })
  return Array.from(byId.values())
}

/** 一次目录加载的结果：可用模型列表 + 无可用模型时的原因。 */
interface HotCopyCatalogSnapshot {
  models: HotCopyCatalogModel[]
  error: string
}

const EMPTY_SNAPSHOT: HotCopyCatalogSnapshot = { models: [], error: '' }

// 只缓存拿到了可用模型的结果：空目录 / 配置错误 / 请求失败都留给下次挂载重试
const catalogCache = createSharedRequestCache<HotCopyCatalogSnapshot>({
  ttlMs: MODEL_CATALOG_CACHE_TTL_MS,
  shouldCache: (snapshot) => !snapshot.error,
})

/** 清掉所有工作空间的爆款复制目录缓存。下次挂载会重新拉取。 */
export function invalidateHotCopyModelCatalogCache(): void {
  catalogCache.invalidate()
}

async function loadHotCopyModelCatalog(workspaceId: number, signal: AbortSignal): Promise<HotCopyCatalogSnapshot> {
  let response: unknown
  try {
    response = await listAiModels({
      workspaceId,
      operationCode: HOT_COPY_MODEL_OPERATION_CODE,
      plan: '',
      signal,
    })
  } catch (reason) {
    return { models: [], error: getBusinessErrorMessage(reason, '爆款复制模型加载失败，请重试') }
  }
  const operationModels = unwrapGenerationModelCatalogResponse(response).filter(
    (model): model is BackendGenerationModel =>
      Boolean(model) &&
      typeof model === 'object' &&
      !Array.isArray(model) &&
      matchesReplicateOperation(model as BackendGenerationModel),
  )
  const models = dedupeModels(
    operationModels
      .map((model) => normalizeCatalogModel(model))
      .filter((model): model is HotCopyCatalogModel => Boolean(model)),
  )
  if (models.some((model) => !model.option.disabled)) return { models, error: '' }
  const configurationError = models.find((model) => model.option.unavailableReason)?.option.unavailableReason
  return { models, error: configurationError || '当前套餐暂无可用的爆款复制视频模型，请充值或开通会员后使用' }
}

export function useHotCopyModelCatalog(workspaceId: number): HotCopyModelCatalogState {
  const normalizedWorkspaceId = Math.max(0, Math.floor(Number(workspaceId) || 0))
  const cacheKey = String(normalizedWorkspaceId)
  const [reloadToken, setReloadToken] = useState(0)
  const appliedReloadTokenRef = useRef(0)
  const [snapshot, setSnapshot] = useState<HotCopyCatalogSnapshot>(
    () => (normalizedWorkspaceId ? catalogCache.peek(cacheKey)?.value : undefined) ?? EMPTY_SNAPSHOT,
  )
  const [loading, setLoading] = useState(() => Boolean(normalizedWorkspaceId) && !catalogCache.peek(cacheKey))

  useEffect(() => {
    if (!normalizedWorkspaceId) {
      setSnapshot(EMPTY_SNAPSHOT)
      setLoading(false)
      return
    }
    // reload() 才强制重拉；换工作空间只是换 key，命中缓存就直接用
    const force = reloadToken !== appliedReloadTokenRef.current
    appliedReloadTokenRef.current = reloadToken

    let disposed = false
    const cached = force ? null : catalogCache.peek(cacheKey)
    if (cached) {
      setSnapshot(cached.value)
      setLoading(false)
    } else {
      setSnapshot(EMPTY_SNAPSHOT)
      setLoading(true)
    }
    const unsubscribe = catalogCache.subscribe(cacheKey, (next) => {
      if (!disposed) setSnapshot(next)
    })
    if (cached?.fresh) {
      return () => {
        disposed = true
        unsubscribe()
      }
    }

    // 无缓存：正常加载；缓存过期：拿着旧目录后台刷新，不亮 loading
    const lease = catalogCache.acquire(cacheKey, (signal) => loadHotCopyModelCatalog(normalizedWorkspaceId, signal), {
      force,
    })
    lease.promise
      .then((next) => {
        if (!disposed) setSnapshot(next)
      })
      .catch(() => undefined)
      .finally(() => {
        if (!disposed) setLoading(false)
      })
    return () => {
      disposed = true
      unsubscribe()
      lease.release()
    }
  }, [cacheKey, normalizedWorkspaceId, reloadToken])

  const { models, error } = snapshot

  const pickerGroups = useMemo<GenerationModelGroup[]>(
    () => [
      {
        key: 'hotCopyVideo',
        label: '生成视频',
        description: '用于根据参考视频与替换素材生成完整视频',
        subgroups: [
          {
            key: HOT_COPY_MODEL_OPERATION_CODE,
            label: '视频生成模型',
            models: models.length
              ? models.map((model) => model.option)
              : [
                  {
                    id: '__unavailable_hot_copy_video_model__',
                    name: '暂无可用模型',
                    disabled: true,
                    unavailableReason: error || '当前套餐暂无可用的爆款复制视频模型，请充值或开通会员后使用',
                  },
                ],
            required: true,
          },
        ],
      },
    ],
    [error, models],
  )
  const modelsById = useMemo(
    () => new Map(models.filter((model) => !model.option.disabled).map((model) => [model.id, model.source])),
    [models],
  )
  const reload = useCallback(() => setReloadToken((value) => value + 1), [])
  const resolveModel = useCallback(
    (modelVersionId: unknown) => {
      const id = Number(modelVersionId)
      return Number.isSafeInteger(id) && id > 0 ? modelsById.get(id) || null : null
    },
    [modelsById],
  )

  return {
    pickerGroups,
    loading,
    error,
    ready: modelsById.size > 0,
    reload,
    resolveModel,
  }
}
