/**
 * 加载爆款复制 video.replicate 模型，并投影为首页通用模型下拉的数据。
 * 目录只保留产品当前开放的参考生视频与 Seedance 2.0，完整后端记录用于费用预估和正式提交。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getBusinessErrorMessage, listAiModels } from '@/api/business'
import type { GenerationModelGroup, GenerationModelOption } from '@/components/smart/GenerationModelPicker'
import {
  getBackendGenerationModelConfigurationError,
  getBackendGenerationModelName,
  getBackendGenerationModelVersionId,
  isBackendGenerationModelEnabled,
  unwrapGenerationModelCatalogResponse,
  type BackendGenerationModel,
} from '@/utils/generationModelCatalog'
import { filterFeaturedCreativeVideoModels, isFeaturedCreativeVideoModel } from '@/utils/featuredVideoModels'
import { buildModelRestrictionSummary } from '@/utils/modelRestrictions'

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
  if (
    !isBackendGenerationModelEnabled(model) ||
    !matchesReplicateOperation(model) ||
    !isFeaturedCreativeVideoModel(model)
  ) {
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

  return {
    id,
    source,
    option: {
      id,
      name,
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

export function useHotCopyModelCatalog(workspaceId: number): HotCopyModelCatalogState {
  const normalizedWorkspaceId = Math.max(0, Math.floor(Number(workspaceId) || 0))
  const requestSequenceRef = useRef(0)
  const [reloadToken, setReloadToken] = useState(0)
  const [models, setModels] = useState<HotCopyCatalogModel[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const requestSequence = ++requestSequenceRef.current
    if (!normalizedWorkspaceId) {
      setModels([])
      setLoading(false)
      setError('')
      return
    }

    setModels([])
    setLoading(true)
    setError('')
    const abortController = new AbortController()
    const isStale = () => abortController.signal.aborted || requestSequenceRef.current !== requestSequence
    void listAiModels({
      workspaceId: normalizedWorkspaceId,
      operationCode: HOT_COPY_MODEL_OPERATION_CODE,
      plan: '',
      signal: abortController.signal,
    })
      .then((response) => {
        if (isStale()) return
        const operationModels = unwrapGenerationModelCatalogResponse(response).filter(
          (model): model is BackendGenerationModel =>
            Boolean(model) &&
            typeof model === 'object' &&
            !Array.isArray(model) &&
            matchesReplicateOperation(model as BackendGenerationModel),
        )
        const normalized = dedupeModels(
          filterFeaturedCreativeVideoModels(operationModels)
            .map((model) =>
              model && typeof model === 'object' && !Array.isArray(model)
                ? normalizeCatalogModel(model as BackendGenerationModel)
                : null,
            )
            .filter((model): model is HotCopyCatalogModel => Boolean(model)),
        )
        setModels(normalized)
        const available = normalized.filter((model) => !model.option.disabled)
        if (available.length) return
        const configurationError = normalized.find((model) => model.option.unavailableReason)?.option.unavailableReason
        setError(configurationError || '当前工作空间暂无可用的参考生视频或 Seedance 2.0 模型')
      })
      .catch((reason) => {
        if (isStale()) return
        setModels([])
        setError(getBusinessErrorMessage(reason, '爆款复制模型加载失败，请重试'))
      })
      .finally(() => {
        if (!isStale()) setLoading(false)
      })

    return () => abortController.abort()
  }, [normalizedWorkspaceId, reloadToken])

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
                    unavailableReason: error || '暂无可用的参考生视频或 Seedance 2.0 模型',
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
