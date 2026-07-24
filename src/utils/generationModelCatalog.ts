/**
 * 智能成片各生成阶段共用的模型目录数据层。
 *
 * 这里只负责把 `/api/v1/ai/models` 返回的后端数据整理成稳定的页面模型：
 * - 四个阶段只是展示分组，不代表四个阶段只能各选一个模型；
 * - 真实选择始终按 operation_code 保存，文生图和图生图可以分别选择；
 * - 模型名称、版本和可用状态完全来自后端，不在前端维护具体模型名称；
 * - 不发请求、不读工作空间状态，也不参与生成任务提交，便于页面按需接入。
 */

/** 当前智能成片需要展示和选择模型的后端操作码。 */
export const GENERATION_OPERATION_CODES = [
  'responses.multimodal',
  'image.text_to_image',
  'image.image_to_image',
  'video.generate',
  'video.edit',
] as const

export type GenerationOperationCode = (typeof GENERATION_OPERATION_CODES)[number]
export type ImageGenerationOperationCode = Extract<
  GenerationOperationCode,
  'image.text_to_image' | 'image.image_to_image'
>

/** 首页视频与图片两种创作模式各自必须具备的固定 operation 集合。 */
export const VIDEO_REQUIRED_GENERATION_OPERATION_CODES = GENERATION_OPERATION_CODES
export const IMAGE_REQUIRED_GENERATION_OPERATION_CODES = [
  'image.text_to_image',
  'image.image_to_image',
] as const satisfies readonly GenerationOperationCode[]

export type GenerationModelCatalogMode = 'video' | 'image'

export const REQUIRED_GENERATION_OPERATION_CODES_BY_MODE: Readonly<
  Record<GenerationModelCatalogMode, readonly GenerationOperationCode[]>
> = {
  video: VIDEO_REQUIRED_GENERATION_OPERATION_CODES,
  image: IMAGE_REQUIRED_GENERATION_OPERATION_CODES,
}

/** 页面面向用户展示的四个模型类型。 */
export type GenerationModelGroupKey = 'script' | 'image' | 'video' | 'videoEdit'

/** 后端可提交的模型版本 ID；目录会把纯数字字符串统一转换为正整数。 */
export type GenerationModelVersionId = number

/**
 * 后端模型的兼容输入类型。
 *
 * 目录接口在不同版本中存在 snake_case / camelCase 差异，所以数据层不把
 * 某一种响应结构写死；规范化后页面只需使用 GenerationModelOption。
 */
export type BackendGenerationModel = Readonly<Record<string, unknown>>

/**
 * 兼容模型目录的常见响应包装：数组、`{ items }`、`{ list }`、`{ data }`
 * 以及 data 内的嵌套包装。错误对象和非数组叶子不会被当成模型记录。
 */
export function unwrapGenerationModelCatalogResponse(response: unknown, depth = 0): unknown[] {
  if (Array.isArray(response)) return response
  if (!response || typeof response !== 'object' || depth > 3) return []

  const record = response as Readonly<Record<string, unknown>>
  for (const key of ['items', 'list', 'data'] as const) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue
    const unwrapped = unwrapGenerationModelCatalogResponse(record[key], depth + 1)
    if (unwrapped.length || Array.isArray(record[key])) return unwrapped
  }
  return []
}

/** 页面可直接渲染的单个模型选项。 */
export interface GenerationModelOption {
  /** 创建任务和费用预估时需要回传的真实后端模型版本 ID。 */
  modelVersionId: GenerationModelVersionId
  /** 后端提供的展示名称；前端不会生成“默认模型”等替代名称。 */
  displayName: string
  /** 该模型实际声明支持的 operation_code。 */
  operationCodes: GenerationOperationCode[]
  /** 保留一份原始记录，供后续读取后端参数 schema、供应商等扩展信息。 */
  source: BackendGenerationModel
  /** 后端参数配置不合法时保留记录用于展示诊断，但禁止选择和提交。 */
  unavailableReason?: string
}

/** 一个具体 operation 下可选择的模型；图片阶段会生成两个这样的子分组。 */
export interface GenerationModelOperationGroup {
  operationCode: GenerationOperationCode
  models: GenerationModelOption[]
}

/** 页面展示的阶段分组；没有任何可用模型的阶段不会出现在结果中。 */
export interface GenerationModelGroup {
  key: GenerationModelGroupKey
  label: string
  operationCodes: GenerationOperationCode[]
  operationGroups: GenerationModelOperationGroup[]
  /** 阶段内去重后的模型合集，可用于阶段卡片摘要。 */
  models: GenerationModelOption[]
}

/**
 * 用户选择必须按 operation_code 保存。
 *
 * 不能只按 image 阶段保存一个 ID：同一批镜头可能同时包含文生图和图生图，
 * 两种任务必须能分别选择并锁定自己的模型版本。
 */
export type GenerationModelSelectionMap = Partial<Record<GenerationOperationCode, GenerationModelVersionId | string>>

/** 校验选择后得到的 operation → 完整模型选项映射。 */
export type ResolvedGenerationModelSelectionMap = Partial<Record<GenerationOperationCode, GenerationModelOption>>

export type GenerationModelOperationStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error' | 'configuration-error'

/** 一次目录加载后，每个固定 operation 都必须保留一份独立状态。 */
export interface GenerationModelOperationState {
  operationCode: GenerationOperationCode
  status: GenerationModelOperationStatus
  availableModelCount: number
  message: string
}

export type GenerationModelOperationStateMap = Record<GenerationOperationCode, GenerationModelOperationState>

interface GenerationModelGroupDefinition {
  key: GenerationModelGroupKey
  label: string
  operationCodes: readonly GenerationOperationCode[]
}

interface ModelNameCandidate {
  value: string
  /** 数字越小，越接近后端明确提供的展示名称。 */
  priority: number
}

const OPERATION_CODE_SET = new Set<string>(GENERATION_OPERATION_CODES)
const OPERATION_DECLARATION_KEYS = [
  'operation_codes',
  'operationCodes',
  'operation_code',
  'operationCode',
  'operations',
] as const
const MODEL_CONFIGURATION_ERROR = '模型参数配置错误，暂不可用，请联系管理员'

/** 只包含产品阶段名称和 operation 映射，不包含任何具体模型名称。 */
export const GENERATION_MODEL_GROUP_DEFINITIONS: readonly GenerationModelGroupDefinition[] = [
  {
    key: 'script',
    label: '生成脚本',
    operationCodes: ['responses.multimodal'],
  },
  {
    key: 'image',
    label: '生成图片',
    operationCodes: ['image.text_to_image', 'image.image_to_image'],
  },
  {
    key: 'video',
    label: '生成视频',
    operationCodes: ['video.generate'],
  },
  {
    key: 'videoEdit',
    label: '修改视频',
    operationCodes: ['video.edit'],
  },
]

const DISABLED_VALUES = new Set([
  '0',
  'false',
  'no',
  'off',
  'disabled',
  'inactive',
  'unavailable',
  'archived',
  'deleted',
])

/** 将未知值收窄为目录支持的 operation_code。 */
export function isGenerationOperationCode(value: unknown): value is GenerationOperationCode {
  return typeof value === 'string' && OPERATION_CODE_SET.has(value.trim())
}

/** 为每个固定 operation 创建独立状态，避免空/失败响应从非空分组中消失。 */
export function createGenerationModelOperationStateMap(
  status: GenerationModelOperationStatus = 'idle',
): GenerationModelOperationStateMap {
  const createState = (operationCode: GenerationOperationCode): GenerationModelOperationState => ({
    operationCode,
    status,
    availableModelCount: 0,
    message: '',
  })

  return {
    'responses.multimodal': createState('responses.multimodal'),
    'image.text_to_image': createState('image.text_to_image'),
    'image.image_to_image': createState('image.image_to_image'),
    'video.generate': createState('video.generate'),
    'video.edit': createState('video.edit'),
  }
}

/**
 * 根据当前有效引用图数量确定图片生成操作。
 *
 * 入口可能从表单、草稿或 URL 中读取数量，因此兼容有限的正数字符串；
 * 负数、空值、NaN、Infinity 和其他无效值都按“没有引用图”处理。
 */
export function getImageGenerationOperationCode(referenceImageCount: unknown): ImageGenerationOperationCode {
  const normalizedCount =
    typeof referenceImageCount === 'number'
      ? referenceImageCount
      : typeof referenceImageCount === 'string' && referenceImageCount.trim()
        ? Number(referenceImageCount)
        : 0

  return Number.isFinite(normalizedCount) && normalizedCount > 0 ? 'image.image_to_image' : 'image.text_to_image'
}

/** 返回指定 operation 集合中尚未加载为 ready 的项。 */
export function getUnavailableGenerationOperations(
  states: Readonly<GenerationModelOperationStateMap>,
  operations: readonly GenerationOperationCode[],
): GenerationOperationCode[] {
  return operations.filter((operationCode) => states[operationCode]?.status !== 'ready')
}

/** 判断指定 operation 集合是否都已加载为 ready。 */
export function areGenerationModelOperationsReady(
  states: Readonly<GenerationModelOperationStateMap>,
  operations: readonly GenerationOperationCode[],
): boolean {
  return getUnavailableGenerationOperations(states, operations).length === 0
}

/** 返回指定创作模式下尚不可用的固定 operation，可直接用于入口门禁与诊断。 */
export function getUnavailableRequiredGenerationOperations(
  states: Readonly<GenerationModelOperationStateMap>,
  mode: GenerationModelCatalogMode,
): GenerationOperationCode[] {
  return getUnavailableGenerationOperations(states, REQUIRED_GENERATION_OPERATION_CODES_BY_MODE[mode])
}

export function isGenerationModelCatalogReadyForMode(
  states: Readonly<GenerationModelOperationStateMap>,
  mode: GenerationModelCatalogMode,
): boolean {
  return areGenerationModelOperationsReady(states, REQUIRED_GENERATION_OPERATION_CODES_BY_MODE[mode])
}

/** 读取非空后端文本；不提供任何前端兜底名称。 */
function readText(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return ''
  }

  return String(value).trim()
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = readText(value)
    if (text) return text
  }

  return ''
}

/**
 * 从后端字段计算页面展示名称。
 *
 * 优先使用后端显式展示名，其次使用 name；只有缺少这两类字段时，才把
 * 后端 model 与 version 拼接。没有可展示字段的记录直接不进入目录。
 */
function readModelNameCandidate(model: BackendGenerationModel): ModelNameCandidate | null {
  const displayName = firstText(model.display_name, model.displayName)
  if (displayName) {
    return { value: displayName, priority: 0 }
  }

  const name = firstText(model.name, model.model_name, model.modelName)
  if (name) {
    return { value: name, priority: 1 }
  }

  const modelName = firstText(model.model)
  const version = firstText(model.version_name, model.versionName, model.version)

  if (modelName && version) {
    const normalizedModel = modelName.toLocaleLowerCase()
    const normalizedVersion = version.toLocaleLowerCase()
    return {
      value: normalizedModel.includes(normalizedVersion) ? modelName : `${modelName} ${version}`,
      priority: 2,
    }
  }

  if (modelName) {
    return { value: modelName, priority: 3 }
  }

  if (version) {
    return { value: version, priority: 4 }
  }

  return null
}

/** 提供给展示层或诊断代码复用的后端名称规范化函数。 */
export function getBackendGenerationModelName(model: BackendGenerationModel | null | undefined): string {
  if (!model) return ''
  return readModelNameCandidate(model)?.value || ''
}

/**
 * enabled 兼容规则：
 * - 显式 false / 0 / disabled 等值一定过滤；
 * - enabled 缺失时，再读取 status；
 * - 两者都缺失时认为接口已按工作空间权限过滤，保留该记录。
 */
export function isBackendGenerationModelEnabled(model: BackendGenerationModel | null | undefined): boolean {
  if (!model) return false

  const explicitEnabled = model.enabled ?? model.is_enabled ?? model.isEnabled
  if (explicitEnabled !== undefined && explicitEnabled !== null && explicitEnabled !== '') {
    if (typeof explicitEnabled === 'boolean') return explicitEnabled
    if (typeof explicitEnabled === 'number') return explicitEnabled !== 0
    return !DISABLED_VALUES.has(readText(explicitEnabled).toLocaleLowerCase())
  }

  const status = firstText(model.status, model.state)
  return !status || !DISABLED_VALUES.has(status.toLocaleLowerCase())
}

/** 将未知版本 ID 收窄为可提交的正安全整数。 */
export function normalizeGenerationModelVersionId(value: unknown): GenerationModelVersionId | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null
  }

  const text = readText(value)
  if (!text) return null

  if (/^\d+$/.test(text)) {
    const numericId = Number(text)
    return Number.isSafeInteger(numericId) && numericId > 0 ? numericId : null
  }

  return null
}

/** 读取并规范化后端模型版本 ID，供不同 operation 的目录复用。 */
export function getBackendGenerationModelVersionId(
  model: BackendGenerationModel | null | undefined,
): GenerationModelVersionId | null {
  if (!model) return null
  return normalizeGenerationModelVersionId(model.model_version_id ?? model.modelVersionId ?? model.id)
}

/** 兼容 operation 数组、单值、逗号字符串和 `{ code }` 等常见后端结构。 */
function collectOperationCodes(value: unknown, result: Set<GenerationOperationCode>): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectOperationCodes(item, result))
    return
  }

  if (value && typeof value === 'object') {
    const record = value as Readonly<Record<string, unknown>>
    collectOperationCodes(record.code ?? record.operation_code ?? record.operationCode ?? record.value, result)
    return
  }

  const text = readText(value)
  if (!text) return

  if (text.startsWith('[')) {
    try {
      collectOperationCodes(JSON.parse(text), result)
      return
    } catch {
      // 非法 JSON 继续按普通分隔字符串解析，避免整份目录加载失败。
    }
  }

  text.split(/[\s,|]+/).forEach((candidate) => {
    const normalized = candidate.trim()
    if (isGenerationOperationCode(normalized)) {
      result.add(normalized)
    }
  })
}

/** 区分“接口省略 operation 字段”和“接口显式声明了空值/不匹配 operation”。 */
export function hasBackendGenerationModelOperationDeclaration(model: BackendGenerationModel): boolean {
  return OPERATION_DECLARATION_KEYS.some((key) => Object.prototype.hasOwnProperty.call(model, key))
}

export function getBackendGenerationModelOperationCodes(model: BackendGenerationModel): GenerationOperationCode[] {
  const result = new Set<GenerationOperationCode>()

  collectOperationCodes(model.operation_codes, result)
  collectOperationCodes(model.operationCodes, result)
  collectOperationCodes(model.operation_code, result)
  collectOperationCodes(model.operationCode, result)
  collectOperationCodes(model.operations, result)

  return GENERATION_OPERATION_CODES.filter((operationCode) => result.has(operationCode))
}

function modelOperationKey(modelVersionId: GenerationModelVersionId, operationCode: GenerationOperationCode): string {
  return `${operationCode}:${modelVersionId}`
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * 在模型进入可选目录前校验明显损坏的 params_schema。
 * 未提供 schema 与合法空对象均允许；非法 JSON、非对象 schema、非数组 fields、
 * 以及缺少 name 的 fields 记录会被标记为后端配置错误。
 */
export function getBackendGenerationModelConfigurationError(model: BackendGenerationModel): string {
  const rawSchema = model.params_schema ?? model.paramsSchema
  if (rawSchema === undefined || rawSchema === null || rawSchema === '') return ''

  let schema: unknown = rawSchema
  if (typeof rawSchema === 'string') {
    if (!rawSchema.trim()) return ''
    try {
      schema = JSON.parse(rawSchema)
    } catch {
      return MODEL_CONFIGURATION_ERROR
    }
  }

  if (!isRecord(schema)) return MODEL_CONFIGURATION_ERROR

  const schemaContainers = [
    schema,
    schema.params,
    schema.parameters,
    schema.schema,
    schema.json_schema,
    schema.jsonSchema,
  ]
  const hasMalformedFields = schemaContainers.some((container) => {
    if (!isRecord(container) || !Object.prototype.hasOwnProperty.call(container, 'fields')) return false
    return (
      !Array.isArray(container.fields) || container.fields.some((field) => !isRecord(field) || !readText(field.name))
    )
  })
  if (hasMalformedFields) return MODEL_CONFIGURATION_ERROR

  const hasMalformedProperties = schemaContainers.some(
    (container) =>
      isRecord(container) &&
      Object.prototype.hasOwnProperty.call(container, 'properties') &&
      !isRecord(container.properties),
  )

  return hasMalformedProperties ? MODEL_CONFIGURATION_ERROR : ''
}

/**
 * 把后端模型目录规范化为页面选项。
 *
 * 只有同时具备“可提交 ID、后端名称、受支持 operation”的可用记录才会保留。
 * 去重键包含 operation，避免同一 modelVersionId 在不同 operation 下的 source/params_schema
 * 被全局折叠；同一 operation 内的重复记录仍优先采用合法 schema 和更明确的后端展示名称。
 */
export function normalizeGenerationModels(
  models: readonly (BackendGenerationModel | null | undefined)[] | null | undefined,
): GenerationModelOption[] {
  if (!Array.isArray(models)) return []

  const normalizedByOperation = new Map<
    string,
    GenerationModelOption & {
      namePriority: number
      sourceNamePriority: number
      sourcePriority: number
    }
  >()

  models.forEach((model) => {
    if (!model || !isBackendGenerationModelEnabled(model)) return

    const modelVersionId = getBackendGenerationModelVersionId(model)
    const nameCandidate = readModelNameCandidate(model)
    const operationCodes = getBackendGenerationModelOperationCodes(model)

    if (modelVersionId === null || !nameCandidate || !operationCodes.length) return

    const configurationError = getBackendGenerationModelConfigurationError(model)
    const hasSchema =
      (model.params_schema !== undefined && model.params_schema !== null && model.params_schema !== '') ||
      (model.paramsSchema !== undefined && model.paramsSchema !== null && model.paramsSchema !== '')
    const sourcePriority = configurationError ? 2 : hasSchema ? 0 : 1

    operationCodes.forEach((operationCode) => {
      const key = modelOperationKey(modelVersionId, operationCode)
      const existing = normalizedByOperation.get(key)
      const source = {
        ...model,
        operation_codes: [operationCode],
      }

      if (!existing) {
        normalizedByOperation.set(key, {
          modelVersionId,
          displayName: nameCandidate.value,
          operationCodes: [operationCode],
          source,
          ...(configurationError ? { unavailableReason: configurationError } : {}),
          namePriority: nameCandidate.priority,
          sourceNamePriority: nameCandidate.priority,
          sourcePriority,
        })
        return
      }

      if (nameCandidate.priority < existing.namePriority) {
        existing.displayName = nameCandidate.value
        existing.namePriority = nameCandidate.priority
      }

      if (
        sourcePriority < existing.sourcePriority ||
        (sourcePriority === existing.sourcePriority && nameCandidate.priority < existing.sourceNamePriority)
      ) {
        existing.source = source
        existing.sourceNamePriority = nameCandidate.priority
        existing.sourcePriority = sourcePriority
        if (configurationError) existing.unavailableReason = configurationError
        else delete existing.unavailableReason
      }
    })
  })

  return Array.from(
    normalizedByOperation.values(),
    ({
      namePriority: _namePriority,
      sourceNamePriority: _sourceNamePriority,
      sourcePriority: _sourcePriority,
      ...model
    }) => model,
  )
}

/**
 * 按“生成脚本 / 生成图片 / 生成视频 / 修改视频”生成展示目录。
 *
 * 对有效数组输入始终保留全部固定阶段与 operation 子分组；空 models 本身就是
 * 可校验的不可用状态，不能因为其他分组非空而从入口门禁中消失。
 */
export function buildGenerationModelGroups(
  models: readonly (BackendGenerationModel | null | undefined)[] | null | undefined,
): GenerationModelGroup[] {
  if (!Array.isArray(models)) return []
  const normalizedModels = normalizeGenerationModels(models)

  return GENERATION_MODEL_GROUP_DEFINITIONS.map((definition) => {
    const operationGroups = definition.operationCodes.map<GenerationModelOperationGroup>((operationCode) => ({
      operationCode,
      models: normalizedModels.filter((model) => model.operationCodes.includes(operationCode)),
    }))

    return {
      key: definition.key,
      label: definition.label,
      operationCodes: [...definition.operationCodes],
      operationGroups,
      models: operationGroups.flatMap((group) => group.models),
    }
  })
}

/**
 * 将页面保存的 ID 选择校验并映射回完整模型。
 *
 * 只有模型仍存在且明确支持对应 operation 时才会返回；模型下架、工作空间切换
 * 或旧草稿中的无效 ID 会被自然丢弃，页面可据此要求用户重新选择。
 */
export function resolveGenerationModelSelections(
  groups: readonly GenerationModelGroup[],
  selections: GenerationModelSelectionMap | null | undefined,
): ResolvedGenerationModelSelectionMap {
  if (!selections) return {}

  const resolved: ResolvedGenerationModelSelectionMap = {}

  groups.forEach((group) => {
    group.operationGroups.forEach(({ operationCode, models }) => {
      const selectedId = normalizeGenerationModelVersionId(selections[operationCode])
      if (selectedId === null) return

      const selectedModel = models.find((model) => !model.unavailableReason && model.modelVersionId === selectedId)
      if (selectedModel) {
        resolved[operationCode] = selectedModel
      }
    })
  })

  return resolved
}
