/**
 * 按当前工作空间加载智能成片所需的后端模型目录，并转换为模型选择器可直接渲染的数据。
 *
 * 具体模型名称、说明、供应商和版本均来自 `/api/v1/ai/models`；前端只维护生成阶段与
 * operation_code 的对应关系。切换工作空间或手动重试时会重新拉取，过期请求不会覆盖新空间。
 *
 * 目录按工作空间在内存里缓存（见 MODEL_CATALOG_CACHE_TTL_MS）：智能成片、画布、
 * 项目管理、视频详情各自挂载时不再各拉一遍 5 个 operation；过期后先用旧目录渲染再后台刷新。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getBusinessErrorMessage, listAiModels } from '@/api/business'
import { createSharedRequestCache } from '@/utils/sharedRequestCache'
import type {
  GenerationModelGroup as PickerGroup,
  GenerationModelOption as PickerOption,
} from '@/components/smart/GenerationModelPicker'
import {
  GENERATION_OPERATION_CODES,
  MODEL_CATALOG_CACHE_TTL_MS,
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
import { readModelPresentation } from '@/utils/modelPresentation'
import { isHiddenCreativeVideoModel } from '@/utils/creativeVideoModelKind'

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

  const logo = readModelPresentation(model).logo

  return {
    id: model.modelVersionId,
    name: model.displayName,
    ...(logo ? { logo } : {}),
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
  /** 按 operation_code + 模型版本 ID 取回后端原始模型（含 params_schema）。 */
  resolveModel: (operationCode: string, modelVersionId: unknown) => BackendGenerationModel | null
}

/** 调用方所属的创作流程；智能成片有一条额外的临时屏蔽规则，画布等入口不受影响。 */
export type GenerationModelCatalogFlow = 'smart' | 'all'

/** 一次目录加载的完整结果：分组数据 + 每个 operation 的状态 + 全局错误。 */
interface GenerationModelCatalogSnapshot {
  groups: GenerationModelGroup[]
  operationStates: GenerationModelOperationStateMap
  error: string
}

const EMPTY_SNAPSHOT: GenerationModelCatalogSnapshot = {
  groups: [],
  operationStates: createGenerationModelOperationStateMap(),
  error: '',
}

/**
 * 按工作空间缓存目录。只有每个 operation 都拿到了明确答复（有模型 / 空 / 配置错误）才缓存；
 * 任一 operation 是网络层失败就不缓存，下次挂载照常重试，不把一次抖动钉死 5 分钟。
 */
const catalogCache = createSharedRequestCache<GenerationModelCatalogSnapshot>({
  ttlMs: MODEL_CATALOG_CACHE_TTL_MS,
  shouldCache: (snapshot) =>
    !snapshot.error && !GENERATION_OPERATION_CODES.some((code) => snapshot.operationStates[code].status === 'error'),
})

/** 清掉所有工作空间的目录缓存（例如套餐变更后）。下次挂载会重新拉取。 */
export function invalidateGenerationModelCatalogCache(): void {
  catalogCache.invalidate()
}

/**
 * 加载一个工作空间所有相关 operation 的模型。
 *
 * 每个 operation 独立容错：只要至少有一个可用模型，成功的类型就照常展示；只有所有请求失败
 * 或所有成功响应都没有可用模型时才给出全局错误，避免单个未开通能力拖垮整条创作流程。
 */
async function loadGenerationModelCatalog(
  workspaceId: number,
  signal: AbortSignal,
): Promise<GenerationModelCatalogSnapshot> {
  const results = await Promise.allSettled(
    GENERATION_OPERATION_CODES.map(async (operationCode) => {
      const response = await listAiModels({
        workspaceId,
        operationCode,
        plan: '',
        signal,
      })
      const list = unwrapGenerationModelCatalogResponse(response)
      // 目录以后端为权威：后端新增/开通的模型无需改前端即可展示。
      // 只保留一条屏蔽规则：全流程屏蔽 HappyHorse 图生视频 / 文生视频。
      return list
        .map((model) => bindQueriedOperation(model, operationCode))
        .filter((model): model is BackendGenerationModel => Boolean(model) && !isHiddenCreativeVideoModel(model))
    }),
  )
  const models = results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
  const groups = buildGenerationModelGroups(models)
  const operationStates = createGenerationModelOperationStateMap()

  results.forEach((result, index) => {
    const operationCode = GENERATION_OPERATION_CODES[index]
    if (result.status === 'rejected') {
      operationStates[operationCode] = {
        operationCode,
        status: 'error',
        availableModelCount: 0,
        message: getBusinessErrorMessage(result.reason, `${OPERATION_LABELS[operationCode]}加载失败，请重试`),
      }
      return
    }

    const operationModels =
      groups.flatMap((group) => group.operationGroups).find((group) => group.operationCode === operationCode)?.models ??
      []
    const availableModelCount = operationModels.filter((model) => !model.unavailableReason).length
    const configurationError = operationModels.find((model) => model.unavailableReason)?.unavailableReason

    operationStates[operationCode] = {
      operationCode,
      status: availableModelCount ? 'ready' : configurationError ? 'configuration-error' : 'empty',
      availableModelCount,
      message: availableModelCount
        ? ''
        : configurationError || `${OPERATION_LABELS[operationCode]}暂无可用模型，请联系管理员配置`,
    }
  })

  if (GENERATION_OPERATION_CODES.some((operationCode) => operationStates[operationCode].status === 'ready')) {
    return { groups, operationStates, error: '' }
  }

  const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
  const configurationError = GENERATION_OPERATION_CODES.map((operationCode) => operationStates[operationCode]).find(
    (state) => state.status === 'configuration-error',
  )
  return {
    groups,
    operationStates,
    error:
      rejected.length === results.length
        ? operationStates[GENERATION_OPERATION_CODES[0]].message
        : configurationError?.message || '当前工作空间没有可用的生成模型，请联系管理员配置后重试',
  }
}

/**
 * 当前工作空间的模型目录。命中缓存时首帧即有数据、不闪 loading；同一空间多个页面共用一次请求；
 * 切换工作空间或卸载时释放请求（最后一个持有者释放才真正中止）。
 */
export function useGenerationModelCatalog(
  workspaceId: number,
  // 目前各流程拿到的目录完全一致（2.5 已对智能成片开放），参数保留给将来的流程差异化屏蔽
  _flow: GenerationModelCatalogFlow = 'all',
): GenerationModelCatalogState {
  const normalizedWorkspaceId = Math.max(0, Math.floor(Number(workspaceId) || 0))
  const cacheKey = String(normalizedWorkspaceId)
  const [reloadToken, setReloadToken] = useState(0)
  const appliedReloadTokenRef = useRef(0)
  const [snapshot, setSnapshot] = useState<GenerationModelCatalogSnapshot>(
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
      setSnapshot({ ...EMPTY_SNAPSHOT, operationStates: createGenerationModelOperationStateMap('loading') })
      setLoading(true)
    }
    // 别的页面刷新到同一空间的新目录时跟着更新
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
    const lease = catalogCache.acquire(
      cacheKey,
      (signal) => loadGenerationModelCatalog(normalizedWorkspaceId, signal),
      {
        force,
      },
    )
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

  const { groups, operationStates, error } = snapshot
  const reload = useCallback(() => setReloadToken((value) => value + 1), [])
  const pickerGroups = useMemo(() => toGenerationModelPickerGroups(groups, operationStates), [groups, operationStates])

  /**
   * 按 operation_code + 模型版本 ID 取回后端原始模型。
   *
   * pickerGroups 的选项只保留展示字段与结构化 constraints，原始 params_schema
   * 只在数据层 groups 的 model.source 上。需要按 schema 判断能力（如是否声明
   * generate_audio）的调用方必须走这里，不能从选择器选项上推断。
   */
  const resolveModel = useCallback(
    (operationCode: string, modelVersionId: unknown): BackendGenerationModel | null => {
      const targetId = String(modelVersionId ?? '').trim()
      if (!targetId) return null
      for (const group of groups) {
        for (const operationGroup of group.operationGroups) {
          if (operationGroup.operationCode !== operationCode) continue
          const matched = operationGroup.models.find((model) => String(model.modelVersionId) === targetId)
          if (matched) return matched.source
        }
      }
      return null
    },
    [groups],
  )

  return { groups, pickerGroups, loading, error, operationStates, reload, resolveModel }
}
