/**
 * 按当前工作空间加载智能成片所需的后端模型目录，并转换为模型选择器可直接渲染的数据。
 *
 * 具体模型名称、说明、供应商和版本均来自 `/api/v1/ai/models`；前端只维护生成阶段与
 * operation_code 的对应关系。切换工作空间或手动重试时会重新拉取，过期请求不会覆盖新空间。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getBusinessErrorMessage, listAiModels } from '@/api/business'
import type {
  GenerationModelGroup as PickerGroup,
  GenerationModelOption as PickerOption,
} from '@/components/smart/GenerationModelPicker'
import {
  GENERATION_OPERATION_CODES,
  buildGenerationModelGroups,
  createGenerationModelOperationStateMap,
  getBackendGenerationModelOperationCodes,
  hasBackendGenerationModelOperationDeclaration,
  unwrapGenerationModelCatalogResponse,
  type BackendGenerationModel,
  type GenerationModelGroup,
  type GenerationModelOperationStateMap,
  type GenerationOperationCode,
} from '@/utils/generationModelCatalog'
export { unwrapGenerationModelCatalogResponse } from '@/utils/generationModelCatalog'
import { buildModelRestrictionSummary } from '@/utils/modelRestrictions'
import { filterFeaturedCreativeVideoModels } from '@/utils/featuredVideoModels'

/** 各 operation 的用户可读名称；这里只描述业务能力，不包含任何具体模型名称。 */
const OPERATION_LABELS: Record<GenerationOperationCode, string> = {
  'responses.multimodal': '脚本生成模型',
  'image.text_to_image': '文生图模型',
  'image.image_to_image': '图生图模型',
  'video.generate': '视频生成模型',
  'video.edit': '视频修改模型',
}

/** 阶段说明用于帮助用户理解选中的模型会在哪一步生效。 */
const GROUP_DESCRIPTIONS: Record<string, string> = {
  script: '用于理解需求并生成分镜脚本',
  image: '文生图与图生图分别选择，实际任务按是否携带参考图使用',
  video: '用于把已确认的分镜生成完整视频',
  videoEdit: '用于在已有成片基础上执行修改',
}

function readBackendText(source: BackendGenerationModel, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' || typeof value === 'number') {
      const text = String(value).trim()
      if (text) return text
    }
  }
  return ''
}

/**
 * 把一次按 operation 查询到的记录绑定到该 operation。
 * 只有完全省略 operation 字段时才补齐；显式声明为空或不匹配必须丢弃，避免跨 operation 污染元数据。
 */
function bindQueriedOperation(model: unknown, operationCode: GenerationOperationCode): BackendGenerationModel | null {
  if (!model || typeof model !== 'object' || Array.isArray(model)) return null
  const source = model as BackendGenerationModel

  if (
    hasBackendGenerationModelOperationDeclaration(source) &&
    !getBackendGenerationModelOperationCodes(source).includes(operationCode)
  ) {
    return null
  }

  return {
    ...source,
    operation_codes: [operationCode],
    operationCodes: undefined,
    operation_code: undefined,
    operationCode: undefined,
    operations: undefined,
  }
}

/** 将后端模型元数据投影为纯展示选项，名称不做前端兜底。 */
function toPickerOption(model: GenerationModelGroup['models'][number]): PickerOption {
  const description = readBackendText(
    model.source,
    'description',
    'display_description',
    'displayDescription',
    'model_description',
    'modelDescription',
  )
  const tags = [
    readBackendText(model.source, 'provider_name', 'providerName', 'provider'),
    readBackendText(model.source, 'version_name', 'versionName', 'version'),
  ].filter((tag, index, all) => tag && all.indexOf(tag) === index)
  const restrictionSummary = model.unavailableReason
    ? { messages: [], constraints: {} }
    : buildModelRestrictionSummary(model.source)

  return {
    id: model.modelVersionId,
    name: model.displayName,
    ...(description ? { description } : {}),
    ...(tags.length ? { tags } : {}),
    ...(restrictionSummary.messages.length ? { restrictions: restrictionSummary.messages } : {}),
    ...(Object.keys(restrictionSummary.constraints).length ? { constraints: restrictionSummary.constraints } : {}),
    ...(model.unavailableReason
      ? {
          disabled: true,
          unavailableReason: model.unavailableReason,
        }
      : {}),
  }
}

/** 目录数据层 → 通用模型选择器的展示结构；所有 operation 都保留为独立选择槽位。 */
export function toGenerationModelPickerGroups(
  groups: readonly GenerationModelGroup[],
  operationStates?: Readonly<GenerationModelOperationStateMap>,
): PickerGroup[] {
  return groups.map((group) => ({
    key: group.key,
    label: group.label,
    description: GROUP_DESCRIPTIONS[group.key],
    subgroups: group.operationGroups.map((operationGroup) => {
      const operationCode = operationGroup.operationCode
      const models = operationGroup.models.map(toPickerOption)
      return {
        key: operationCode,
        label: OPERATION_LABELS[operationCode],
        models: models.length
          ? models
          : [
              {
                id: `__unavailable_generation_model__:${operationCode}`,
                name: '暂无可用模型',
                disabled: true,
                unavailableReason:
                  operationStates?.[operationCode].message || `${OPERATION_LABELS[operationCode]}暂无可用模型`,
              },
            ],
        required: true,
      }
    }),
  }))
}

export interface GenerationModelCatalogState {
  groups: GenerationModelGroup[]
  pickerGroups: PickerGroup[]
  loading: boolean
  error: string
  operationStates: GenerationModelOperationStateMap
  reload: () => void
}

/**
 * 加载当前工作空间所有相关 operation 的模型。
 *
 * 每个 operation 独立容错：只要至少有一个可用模型，成功的类型就照常展示；只有所有请求失败
 * 或所有成功响应都没有可用模型时才显示全局错误，避免单个未开通能力拖垮整条创作流程。
 */
export function useGenerationModelCatalog(workspaceId: number): GenerationModelCatalogState {
  const normalizedWorkspaceId = Math.max(0, Math.floor(Number(workspaceId) || 0))
  const requestSequenceRef = useRef(0)
  const [reloadToken, setReloadToken] = useState(0)
  const [groups, setGroups] = useState<GenerationModelGroup[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [operationStates, setOperationStates] = useState<GenerationModelOperationStateMap>(() =>
    createGenerationModelOperationStateMap(),
  )

  useEffect(() => {
    const requestSequence = ++requestSequenceRef.current
    if (!normalizedWorkspaceId) {
      setGroups([])
      setLoading(false)
      setError('')
      setOperationStates(createGenerationModelOperationStateMap())
      return
    }
    const abortController = new AbortController()
    const isStale = () => abortController.signal.aborted || requestSequenceRef.current !== requestSequence

    setGroups([])
    setLoading(true)
    setError('')
    setOperationStates(createGenerationModelOperationStateMap('loading'))

    void Promise.allSettled(
      GENERATION_OPERATION_CODES.map(async (operationCode) => {
        const response = await listAiModels({
          workspaceId: normalizedWorkspaceId,
          operationCode,
          plan: '',
          signal: abortController.signal,
        })
        const list = unwrapGenerationModelCatalogResponse(response)
        const boundModels = list
          .map((model) => bindQueriedOperation(model, operationCode))
          .filter((model): model is BackendGenerationModel => Boolean(model))
        if (operationCode !== 'video.generate') return boundModels

        return filterFeaturedCreativeVideoModels(boundModels)
      }),
    )
      .then((results) => {
        if (isStale()) return
        const models = results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
        const nextGroups = buildGenerationModelGroups(models)
        const nextOperationStates = createGenerationModelOperationStateMap()

        results.forEach((result, index) => {
          const operationCode = GENERATION_OPERATION_CODES[index]
          if (result.status === 'rejected') {
            nextOperationStates[operationCode] = {
              operationCode,
              status: 'error',
              availableModelCount: 0,
              message: getBusinessErrorMessage(result.reason, `${OPERATION_LABELS[operationCode]}加载失败，请重试`),
            }
            return
          }

          const operationModels =
            nextGroups.flatMap((group) => group.operationGroups).find((group) => group.operationCode === operationCode)
              ?.models ?? []
          const availableModelCount = operationModels.filter((model) => !model.unavailableReason).length
          const configurationError = operationModels.find((model) => model.unavailableReason)?.unavailableReason

          nextOperationStates[operationCode] = {
            operationCode,
            status: availableModelCount ? 'ready' : configurationError ? 'configuration-error' : 'empty',
            availableModelCount,
            message: availableModelCount
              ? ''
              : configurationError || `${OPERATION_LABELS[operationCode]}暂无可用模型，请联系管理员配置`,
          }
        })

        setGroups(nextGroups)
        setOperationStates(nextOperationStates)
        if (GENERATION_OPERATION_CODES.some((operationCode) => nextOperationStates[operationCode].status === 'ready')) {
          return
        }

        const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        const configurationError = GENERATION_OPERATION_CODES.map(
          (operationCode) => nextOperationStates[operationCode],
        ).find((state) => state.status === 'configuration-error')
        setError(
          rejected.length === results.length
            ? nextOperationStates[GENERATION_OPERATION_CODES[0]].message
            : configurationError?.message || '当前工作空间没有可用的生成模型，请联系管理员配置后重试',
        )
      })
      .finally(() => {
        if (!isStale()) setLoading(false)
      })

    return () => abortController.abort()
  }, [normalizedWorkspaceId, reloadToken])

  const reload = useCallback(() => setReloadToken((value) => value + 1), [])
  const pickerGroups = useMemo(() => toGenerationModelPickerGroups(groups, operationStates), [groups, operationStates])

  return { groups, pickerGroups, loading, error, operationStates, reload }
}
