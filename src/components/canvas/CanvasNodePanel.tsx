/**
 * 节点编辑面板 — 始终显示在页面底部，内容根据选中节点类型切换
 *
 * 文本：模型 + 生成
 * 图片：模型 + 比例 + 生成
 * 视频：模型 + 集合选择器(生成方式/比例/秒数/音频) + 生成
 */
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import styles from './CanvasNodePanel.module.css'
import type { GenerationModelOption } from '@/utils/generationModelCatalog'
import { estimateAiTaskCost } from '@/api/business'
import { buildCanvasInputAssets, type CanvasConnectionRole, type CanvasVideoMode } from '@/utils/canvasGeneration'
import { resolveCanvasModelParamOption } from '@/utils/canvasModelParams'

/** 读取可能为字符串/数字/布尔的值，返回字符串文本；非法输入返回空串。 */
function readText(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

/** 参数名归一化：aspect_ratio / aspectRatio / aspect-ratio 归一为同一键。 */
function normalizeParamKey(name: string | number): string {
  return String(name ?? '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

/** 布尔类型别名：boolean/bool/switch/toggle/checkbox，以及布尔语义 options 的字段（如 watermark）。 */
const BOOLEAN_TYPES = new Set(['boolean', 'bool', 'switch', 'toggle', 'checkbox'])
const BOOLEAN_OPTION_KEYS = new Set(['true', 'false', '1', '0', 'yes', 'no', 'on', 'off', '开', '关'])
const AUDIO_FIELD_KEYS = new Set(['generateaudio', 'audio', 'withaudio', 'enableaudio'])

function isBooleanField(field: ParamsSchemaField): boolean {
  if (BOOLEAN_TYPES.has(normalizeParamKey(field.type))) return true
  // 水印等常见开关字段兜底：无论 type 都渲染成开关
  if (normalizeParamKey(field.name).includes('watermark')) return true
  // options 为布尔语义（<=2 项且均为 true/false 等）也按开关渲染
  const opts = (field.options || []).map((o) => normalizeParamKey(o))
  return opts.length > 0 && opts.length <= 2 && opts.every((o) => BOOLEAN_OPTION_KEYS.has(o))
}

function isAudioField(field: ParamsSchemaField): boolean {
  return AUDIO_FIELD_KEYS.has(normalizeParamKey(field.name))
}

/** 数字类型别名：number/int/integer/float。 */
const NUMBER_TYPES = new Set(['number', 'int', 'integer', 'float'])

function isNumberField(field: ParamsSchemaField): boolean {
  return NUMBER_TYPES.has(normalizeParamKey(field.type))
}

/** 比例字段名别名（归一化后均相同）。 */
function isRatioField(field: ParamsSchemaField): boolean {
  return normalizeParamKey(field.name) === 'ratio' || normalizeParamKey(field.name) === 'aspectratio'
}

/** 视频时长字段名兼容：后端常见 duration / video_duration / duration_seconds。 */
function isDurationField(field: ParamsSchemaField): boolean {
  const key = normalizeParamKey(field.name)
  return key === 'duration' || key === 'videoduration' || key === 'durationseconds' || key === 'seconds'
}

/** 识别 seedream 5.0 模型：displayName + 原始记录中的名称/版本字段拼接后匹配。 */
function isSeedream50Model(model: { displayName?: string; source?: unknown } | undefined): boolean {
  if (!model) return false
  const source = (model.source || {}) as Readonly<Record<string, unknown>>
  const parts = [
    model.displayName,
    source.display_name,
    source.displayName,
    source.name,
    source.model_name,
    source.modelName,
    source.model,
    source.version_name,
    source.versionName,
    source.version,
  ]
  const name = parts
    .filter((v) => v !== undefined && v !== null)
    .map(String)
    .join(' ')
  return /seedream/i.test(name) && /5(\.0)?/i.test(name)
}

/**
 * 模型 params_schema.fields 中解析出的单个参数定义。
 * 字段：name=参数名（回传 key）、display_name=菜单组标题、type=类型（select/boolean/number 等）、
 * options=选择类型可选值、default=默认值、min/max=数字上下限、help=说明。
 */
export interface ParamsSchemaField {
  name: string
  displayName: string
  type: string
  options?: (string | number)[]
  default?: unknown
  min?: number
  max?: number
  help?: string
}

/** 解析单条字段定义 → ParamsSchemaField（字段不合法时返回 null）。 */
function parseFieldRecord(raw: unknown): ParamsSchemaField | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const name = readText(record.name)
  if (!name) return null
  // 选项既可能是字符串（"16:9"），也可能是数字（时长秒 5/10/15）；两者都必须保留。
  const options = Array.isArray(record.options)
    ? record.options.filter((o): o is string | number => typeof o === 'string' || typeof o === 'number')
    : undefined
  return {
    name,
    displayName: readText(record.display_name) || name,
    type: readText(record.type) || 'select',
    ...(options && options.length ? { options } : {}),
    ...(record.default !== undefined ? { default: record.default } : {}),
    ...(typeof record.min === 'number' ? { min: record.min } : {}),
    ...(typeof record.max === 'number' ? { max: record.max } : {}),
    ...(readText(record.help) ? { help: readText(record.help) } : {}),
  }
}

/** 解析字段数组 → ParamsSchemaField[]，过滤掉不合法条目。 */
function parseFieldArray(fields: unknown): ParamsSchemaField[] {
  if (!Array.isArray(fields)) return []
  const parsed: ParamsSchemaField[] = []
  for (const raw of fields) {
    const field = parseFieldRecord(raw)
    if (field) parsed.push(field)
  }
  return parsed
}

/**
 * 从模型原始记录解析 params_schema.fields。
 * 结构固定为对象容器：params_schema = { fields: [...] }（含字符串 JSON 包裹）。
 */
export function parseParamsSchema(model: { source?: unknown } | undefined): ParamsSchemaField[] {
  if (!model) return []
  const source = model.source as Readonly<Record<string, unknown>> | undefined
  const rawSchema = source?.params_schema ?? source?.paramsSchema
  if (rawSchema === undefined || rawSchema === null || rawSchema === '') return []

  let schema: unknown = rawSchema
  if (typeof rawSchema === 'string') {
    if (!rawSchema.trim()) return []
    try {
      schema = JSON.parse(rawSchema)
    } catch {
      return []
    }
  }

  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return []

  const containers = [
    schema as Record<string, unknown>,
    ((schema as Record<string, unknown>).params as Record<string, unknown> | undefined) ?? {},
    ((schema as Record<string, unknown>).parameters as Record<string, unknown> | undefined) ?? {},
    ((schema as Record<string, unknown>).schema as Record<string, unknown> | undefined) ?? {},
    ((schema as Record<string, unknown>).json_schema as Record<string, unknown> | undefined) ?? {},
    ((schema as Record<string, unknown>).jsonSchema as Record<string, unknown> | undefined) ?? {},
  ]
  for (const container of containers) {
    if (!container || typeof container !== 'object' || Array.isArray(container)) continue
    const parsed = parseFieldArray((container as Record<string, unknown>).fields)
    if (parsed.length) return parsed
  }
  return []
}

/** 按字段类型归一化参数值（default 或用户选择），保证回传类型正确。 */
function normalizeFieldValue(field: ParamsSchemaField, value: unknown): unknown {
  const canonicalValue = resolveCanvasModelParamOption(field.options, value, field.default)
  if (isBooleanField(field)) {
    return (
      canonicalValue === true ||
      canonicalValue === 'true' ||
      canonicalValue === '1' ||
      canonicalValue === 1 ||
      canonicalValue === '开' ||
      canonicalValue === 'on'
    )
  }
  if (isNumberField(field)) {
    const n = Number(canonicalValue)
    if (Number.isNaN(n)) return field.min ?? 0
    if (field.min !== undefined && n < field.min) return field.min
    if (field.max !== undefined && n > field.max) return field.max
    return n
  }
  // select/string 字段：数字值（如时长秒 5/10/15）保留数字类型，其余转字符串展示。
  if (typeof canonicalValue === 'number') return canonicalValue
  return String(canonicalValue ?? '')
}

/** 字段当前值 → 菜单按钮上显示的文本。 */
function formatFieldValue(field: ParamsSchemaField, value: unknown): string {
  if (isBooleanField(field)) return value ? '开' : '关'
  if (isDurationField(field)) return `${String(value ?? '')}秒`
  return String(value ?? '')
}

/** 连线来源引用信息 */
export interface CanvasSourceRef {
  kind: string
  /** 来源节点 id：文本来源拼接 prompt 时用于读取文本内容 */
  sourceId: string
  edgeId: string
  slotIndex: number
  /** 来源节点的实际图片/视频地址（有素材内容时用于缩略图显示） */
  thumbnailUrl?: string
  /** 来源节点的素材 asset_id（有素材内容时用于组装 input_assets） */
  assetId?: number
  /** 该连接在目标节点中的用途，仅用于画布语义展示。 */
  role?: CanvasConnectionRole
}

export interface CanvasNodeInfo {
  id: string
  kind: string
  /** 用户确认的文本提示词，供下游图片和视频节点直接使用。 */
  text?: string
  /** 连线来源引用列表，已按 slotIndex 排序 */
  sourceRefs?: CanvasSourceRef[]
  /** 当前比例（用于回显） */
  ratio?: string
  /** 视频生成方式（用于回显） */
  videoMode?: CanvasVideoMode
  /** 当前选中的模型版本 ID（用于回显） */
  modelVersionId?: number
  /** 节点已有素材/生成结果地址（视频节点判断「已有视频内容」用，上传或生成都会写入） */
  resultUrl?: string
  /** 节点持久化的 operation_code（生成时写入，刷新后回显/复用） */
  operationCode?: string
  /** 节点持久化的 params（生成时写入，刷新后回显/复用） */
  params?: Record<string, unknown>
  generationIntent?: 'edit' | 'new-model'
  taskId?: number
  taskStatus?: string
  taskProgress?: number
  taskError?: string
}

interface CanvasNodePanelProps {
  node: CanvasNodeInfo | null
  /** 工作空间 ID：预估费用 / 提交生成需要 */
  workspaceId: number
  /** slotIndex 标识槽位：0=首帧, 1=尾帧(视频)；其他节点按顺序 */
  onStartPickRef?: (slotIndex?: number) => void
  /** 点击删除引用回调 */
  onRemoveRef?: (edgeId: string) => void
  /** 比例变更回调，用于同步更新节点宽高 */
  onRatioChange?: (ratio: string) => void
  /** 视频生成方式变更回调 */
  onVideoModeChange?: (mode: CanvasVideoMode) => void
  /** 模型变更回调 */
  onModelChange?: (modelVersionId: number) => void
  /** 各节点类型对应的可选模型（来自 /api/v1/ai/models） */
  models?: Partial<Record<'text' | 'image' | 'video', GenerationModelOption[]>>
  /** 模型列表加载中 */
  modelsLoading?: boolean
  /** 点击生成按钮回调（面板内部先预估费用，调用方提交实际任务） */
  onGenerate?: (params: {
    kind: string
    prompt: string
    modelVersionId: number
    operationCode: string
    params: Record<string, unknown>
    /** 来源引用（含 assetId），由调用方按 role 约定组装 input_assets */
    sourceRefs: CanvasSourceRef[]
    ratio?: string
    videoMode?: CanvasVideoMode
  }) => void
  /** 费用预估判定积分不足时，由页面展示充值引导。 */
  onInsufficientCredits?: () => void
  onSaveText?: (text: string) => void
  onPolishText?: (params: { prompt: string; kind: string }) => Promise<string>
}

type VideoMode = CanvasVideoMode

/** 视频「自适应」比例的存储值（英文，避免中文写入节点数据/接口参数）。 */
export const AUTO_RATIO = 'auto'
/** 「自适应」比例的界面显示文案（中文）。 */
export const AUTO_RATIO_LABEL = '自适应'

/** 判断比例是否为自适应（兼容旧数据中的中文「自适应」存储值）。 */
export function isAutoRatio(ratio: string | undefined | null): boolean {
  return ratio === AUTO_RATIO || ratio === AUTO_RATIO_LABEL
}

/** 比例显示文案：自适应显示中文，其余（2:3 等）原样显示。 */
export function formatRatio(ratio: string): string {
  return isAutoRatio(ratio) ? AUTO_RATIO_LABEL : ratio
}

/** 根据比例字符串计算节点尺寸，baseSize 为短边基准 */
export function calcNodeSize(ratio: string, baseSize: number): { width: number; height: number } {
  if (isAutoRatio(ratio)) return { width: 444, height: 250 }
  const [w, h] = ratio.split(':').map(Number)
  if (!w || !h) return { width: baseSize, height: baseSize }
  if (w > h) return { width: (baseSize * w) / h, height: baseSize }
  return { width: baseSize, height: (baseSize * h) / w }
}

/** 从 sourceRefs 中找到指定 slotIndex 的引用 */
function findRefBySlot(refs: CanvasSourceRef[] | undefined, slot: number): CanvasSourceRef | undefined {
  return refs?.find((r) => r.slotIndex === slot)
}

export default function CanvasNodePanel({
  node,
  workspaceId,
  onStartPickRef,
  onRemoveRef,
  onRatioChange,
  onVideoModeChange,
  onModelChange,
  models,
  modelsLoading,
  onGenerate,
  onInsufficientCredits,
  onSaveText,
  onPolishText,
}: CanvasNodePanelProps) {
  const kind = node?.kind || 'text'
  const taskRunning = [
    'submitting',
    'queued',
    'pending',
    'processing',
    'running',
    'reconnecting',
    'result_pending',
  ].includes(String(node?.taskStatus || '').toLowerCase())
  const isNewModelGeneration = kind === 'video' && node?.generationIntent === 'new-model'
  const isEditingVideo = kind === 'video' && Boolean(node?.resultUrl) && !isNewModelGeneration
  const [prompt, setPrompt] = useState(() => (kind === 'text' ? String(node?.text || '') : ''))
  const [polishing, setPolishing] = useState(false)
  const [polishError, setPolishError] = useState('')

  useEffect(() => {
    if (kind !== 'text') return
    setPrompt(String(node?.text || ''))
    setPolishError('')
  }, [kind, node?.id, node?.text])
  // 受控回显：优先取节点数据中的比例/模式（存储值为英文 auto）
  const ratio = node?.ratio || (kind === 'video' ? AUTO_RATIO : '1:1')
  const videoMode = (node?.videoMode as VideoMode) || 'auto'
  // 按 edgeId 去重，兜底防止重复连线/重复记录渲染出重复缩略图
  const sourceRefs = useMemo(() => {
    const seen = new Set<string>()
    return (node?.sourceRefs || []).filter((ref) => {
      if (seen.has(ref.edgeId)) return false
      seen.add(ref.edgeId)
      return true
    })
  }, [node?.sourceRefs])
  // 来源数量上限只统计素材类来源（图片/视频节点），文本节点不计入（其内容拼入 prompt）：
  // 视频：全能参考最多 5 个图片参考；首尾帧 2 个（首帧+尾帧）。其他节点最多 5 个素材来源。
  const maxRefs = kind === 'video' ? (videoMode === 'first-last' ? 2 : 5) : 5
  // 素材来源引用数量（文本来源不计入数量限制）
  const mediaRefCount = useMemo(() => sourceRefs.filter((ref) => ref.kind !== 'text').length, [sourceRefs])
  const kindModels = useMemo(() => models?.[kind as 'text' | 'image' | 'video'] || [], [models, kind])

  /**
   * 当前上下文应使用的 operation_code：
   * 文本节点 → responses.multimodal
   * 图片节点：无图片来源节点（参考图）→ image.text_to_image；有图片来源节点 → image.image_to_image
   * 视频节点：无视频内容 → video.generate；已有视频内容（生成结果/上传）→ video.edit
   * 节点已持久化 operationCode 且所选模型仍支持时，优先复用（刷新后回显不变）
   */
  const contextualOperationCode = useMemo((): string => {
    if (kind === 'text') return 'responses.multimodal'
    if (kind === 'image') {
      const hasImageSource = (node?.sourceRefs || []).some((ref) => ref.kind === 'image')
      return hasImageSource ? 'image.image_to_image' : 'image.text_to_image'
    }
    if (kind === 'video') {
      const hasVideoContent = Boolean(node?.resultUrl)
      return node?.generationIntent === 'new-model'
        ? 'video.generate'
        : hasVideoContent
          ? 'video.edit'
          : 'video.generate'
    }
    return ''
  }, [kind, node?.sourceRefs, node?.resultUrl, node?.generationIntent])

  const targetOperationCode = useMemo((): string => {
    // 图片生成模式必须跟随当前参考链实时切换：接入（包括经文本节点继承的）参考图后，
    // 不能继续复用节点历史上保存的 image.text_to_image，否则参考素材不会进入模型。
    if (kind === 'image') return contextualOperationCode
    const persisted = String(node?.operationCode || '').trim()
    // 持久化的 operation_code 若仍被当前 kind 的模型支持，则复用；否则回退上下文推断
    if (persisted && kindModels.some((m) => (m.operationCodes as string[] | undefined)?.includes(persisted))) {
      return persisted
    }
    return contextualOperationCode
  }, [kind, node?.operationCode, kindModels, contextualOperationCode])

  // 只显示支持目标 operation_code 的模型（模型可能同时支持多个 code）
  const availableModels = useMemo(
    () => kindModels.filter((m) => m.operationCodes?.some((code) => code === targetOperationCode)),
    [kindModels, targetOperationCode],
  )

  // 选中模型（按 modelVersionId 匹配，无匹配时取第一个可用；优先保留用户已选）
  const selectedModel: GenerationModelOption | undefined = useMemo(() => {
    if (!node?.modelVersionId) return availableModels.find((m) => !m.unavailableReason)
    return (
      availableModels.find((m) => m.modelVersionId === node.modelVersionId && !m.unavailableReason) ||
      availableModels.find((m) => !m.unavailableReason)
    )
  }, [availableModels, node?.modelVersionId])

  // 本次生成使用的 operation_code：目标 code 有可用模型时固定使用，否则为空（按钮禁用）
  const operationCode = useMemo(() => {
    if (!availableModels.some((m) => !m.unavailableReason)) return ''
    return targetOperationCode
  }, [availableModels, targetOperationCode])

  // 选中模型的 params_schema.fields（视频菜单动态渲染来源）
  const schemaFields = useMemo(() => parseParamsSchema(selectedModel), [selectedModel])

  // 字段值状态：模型/schema 变化时重置为 default；优先读取节点已持久化的 params（刷新后回显用户选择）
  const [fieldValues, setFieldValues] = useState<Record<string, unknown>>({})
  useEffect(() => {
    const persisted = (node?.params || {}) as Record<string, unknown>
    const next: Record<string, unknown> = {}
    for (const f of schemaFields) {
      const hasPersistedValue = Object.prototype.hasOwnProperty.call(persisted, f.name)
      const initialValue = hasPersistedValue
        ? persisted[f.name]
        : kind === 'video' && isAudioField(f)
          ? true
          : f.default
      next[f.name] = normalizeFieldValue(f, initialValue)
    }
    setFieldValues(next)
  }, [kind, schemaFields, node?.params])

  // 字段值变更：回写状态；比例字段（ratio/aspect_ratio/aspectRatio）同步节点比例（保持节点尺寸联动）
  const handleFieldChange = useCallback(
    (name: string, value: unknown) => {
      const field = schemaFields.find((f) => f.name === name)
      const normalizedValue = field ? normalizeFieldValue(field, value) : value
      setFieldValues((prev) => ({ ...prev, [name]: normalizedValue }))
      if (field && isRatioField(field) && typeof normalizedValue === 'string') onRatioChange?.(normalizedValue)
    },
    [schemaFields, onRatioChange],
  )

  // 图片节点的 schema 里若已含比例字段（ratio/aspect_ratio/aspectRatio），则由 schema 菜单控制比例，隐藏固定 RatioSelector
  const imageRatioInSchema = kind === 'image' && schemaFields.some(isRatioField)

  // 参数 params：由所选模型的 schema fields 动态构建（所有节点类型通用，不再写死 resolution/duration）
  const schemaParams = useMemo<Record<string, unknown>>(() => {
    const params: Record<string, unknown> = {}
    for (const f of schemaFields) {
      if (kind === 'text' && ['max_output_tokens', 'maxOutputTokens', 'max_tokens', 'maxTokens'].includes(f.name)) {
        continue
      }
      params[f.name] = normalizeFieldValue(f, fieldValues[f.name] !== undefined ? fieldValues[f.name] : f.default)
    }
    return params
  }, [schemaFields, fieldValues, kind])

  // 拼接最终 prompt：文本来源节点的内容在前（按连线顺序），用户提示词在后；
  // 图片/视频来源作为素材引用（input_assets）单独传参，不拼进 prompt。
  const buildFullPrompt = useCallback(
    (userPrompt: string): string => {
      const textMap = (window as any).__canvasTextContents as Map<string, string> | undefined
      const sourceTexts = (node?.sourceRefs || [])
        .filter((ref) => ref.kind === 'text')
        .map((ref) => String(textMap?.get(ref.sourceId) || '').trim())
        .filter(Boolean)
      return [...sourceTexts, userPrompt.trim()].filter(Boolean).join('\n\n')
    },
    [node?.sourceRefs],
  )

  const inputAssets = useMemo(() => buildCanvasInputAssets(sourceRefs, operationCode), [sourceRefs, operationCode])

  // 预估积分：模型/提示词/参数变化后防抖 600ms 调用 estimateAiTaskCost
  const [costEstimate, setCostEstimate] = useState<{
    estimated_cost?: number
    balance?: number
    can_afford?: boolean
    loading: boolean
    error?: string
  }>({ loading: false })
  const costTimerRef = useRef<number | null>(null)

  useEffect(() => {
    if (costTimerRef.current) window.clearTimeout(costTimerRef.current)
    if (kind === 'text') {
      setCostEstimate({ loading: false })
      return
    }
    const modelVersionId = selectedModel?.modelVersionId
    if (!modelVersionId || !operationCode || !workspaceId) {
      setCostEstimate({ loading: false })
      return
    }
    setCostEstimate((prev) => ({ ...prev, loading: true }))
    costTimerRef.current = window.setTimeout(() => {
      estimateAiTaskCost({
        workspaceId,
        modelVersionId,
        operationCode,
        // 预估口径与实扣一致：同样使用拼接文本来源后的完整 prompt
        prompt: buildFullPrompt(prompt),
        params: schemaParams,
        inputAssets,
      })
        .then((result: any) => {
          setCostEstimate({
            estimated_cost: Number(result?.estimated_cost) || 0,
            balance: Number(result?.balance) || 0,
            can_afford: Boolean(result?.can_afford),
            loading: false,
          })
        })
        .catch((err: any) => {
          setCostEstimate({ loading: false, error: String(err?.message || '预估失败') })
        })
    }, 600)
    return () => {
      if (costTimerRef.current) window.clearTimeout(costTimerRef.current)
    }
  }, [
    selectedModel?.modelVersionId,
    operationCode,
    prompt,
    kind,
    schemaParams,
    inputAssets,
    workspaceId,
    buildFullPrompt,
  ])

  // 生成按钮点击：将文本来源节点的内容拼接进 prompt 后提交；图片/视频来源以 sourceRefs(含 assetId) 交给调用方组装 input_assets
  const handleGenerate = () => {
    if (kind === 'text') {
      const value = prompt.trim()
      if (!value) return
      onSaveText?.(value)
      return
    }
    const modelVersionId = selectedModel?.modelVersionId
    if (!modelVersionId || !operationCode) return
    if (costEstimate.can_afford === false) {
      onInsufficientCredits?.()
      return
    }
    if (taskRunning) return
    const cost = Number(costEstimate.estimated_cost || 0)
    if (kind === 'video' && cost > 0) {
      const operationLabel = isEditingVideo ? '修改当前视频' : '使用新模型生成视频'
      if (
        !window.confirm(
          `${operationLabel}预计消耗 ${cost} 积分，当前余额 ${Number(costEstimate.balance || 0)} 积分，是否继续？`,
        )
      )
        return
    }
    onGenerate?.({
      kind,
      prompt: buildFullPrompt(prompt),
      modelVersionId,
      operationCode,
      params: schemaParams,
      sourceRefs,
      ratio,
      videoMode: kind === 'video' ? videoMode : undefined,
    })
  }

  const handlePolishText = async () => {
    const value = prompt.trim()
    if (!value || !onPolishText || polishing) return
    setPolishing(true)
    setPolishError('')
    try {
      const polished = String(await onPolishText({ prompt: value, kind })).trim()
      if (!polished) throw new Error('AI 未返回可用的润色内容')
      setPrompt(polished)
    } catch (error: any) {
      setPolishError(String(error?.message || '润色失败，请稍后重试'))
    } finally {
      setPolishing(false)
    }
  }

  return (
    <div className={styles.panel}>
      {/* tags / 缩略图 */}
      <div className={styles.tags}>
        {kind === 'video' ? (
          /* 视频节点：槽位随生成方式变化 —— 首尾帧=首帧+尾帧双槽（含交换）；全能参考=最多 5 个参考槽 */
          <div className={styles.refImages}>
            {(videoMode === 'first-last' ? [0, 1] : [0, 1, 2, 3, 4]).map((slot) => {
              const ref = findRefBySlot(sourceRefs, slot)
              const title = videoMode === 'first-last' ? (slot === 0 ? '首帧' : '尾帧') : `参考 ${slot + 1}`
              return (
                <React.Fragment key={slot}>
                  {videoMode === 'first-last' && slot === 1 && (
                    <span className={styles.refSwapIcon}>
                      <SwapIcon />
                    </span>
                  )}
                  <div className={`${styles.refThumb} ${ref ? '' : styles.refThumbEmpty}`}>
                    {ref ? (
                      <>
                        {ref.thumbnailUrl ? (
                          <img className={styles.refThumbImg} src={ref.thumbnailUrl} alt={title} />
                        ) : ref.kind === 'image' ? (
                          <ImageRefIcon />
                        ) : ref.kind === 'text' ? (
                          <TextRefIcon />
                        ) : (
                          <VideoRefIcon />
                        )}
                        <button
                          className={styles.refDelete}
                          disabled={taskRunning}
                          onClick={(e) => {
                            e.stopPropagation()
                            onRemoveRef?.(ref.edgeId)
                          }}
                        >
                          &times;
                        </button>
                      </>
                    ) : (
                      <button
                        className={styles.refAddBtn}
                        disabled={taskRunning}
                        title={taskRunning ? '生成中不可修改素材' : title}
                        onClick={() => onStartPickRef?.(slot)}
                      >
                        <PlusSmIcon />
                      </button>
                    )}
                  </div>
                </React.Fragment>
              )
            })}
          </div>
        ) : sourceRefs.length > 0 ? (
          <div className={styles.refImages}>
            {/* 文本来源节点不显示缩略图（仅作为 prompt 文本引用），只展示图片/视频缩略图 */}
            {sourceRefs
              .filter((ref) => ref.kind !== 'text')
              .map((ref) => (
                <div key={ref.edgeId} className={styles.refThumb} title={ref.kind === 'image' ? '图片' : '视频'}>
                  {ref.thumbnailUrl ? (
                    <img className={styles.refThumbImg} src={ref.thumbnailUrl} alt={ref.kind} />
                  ) : ref.kind === 'image' ? (
                    <ImageRefIcon />
                  ) : (
                    <VideoRefIcon />
                  )}
                  <button
                    className={styles.refDelete}
                    disabled={taskRunning}
                    onClick={(e) => {
                      e.stopPropagation()
                      onRemoveRef?.(ref.edgeId)
                    }}
                  >
                    &times;
                  </button>
                </div>
              ))}
            {mediaRefCount < maxRefs && (
              <button
                className={styles.refAddBtn}
                disabled={taskRunning}
                title={taskRunning ? '生成中不可修改素材' : '添加参考'}
                onClick={() => onStartPickRef?.(sourceRefs.length)}
              >
                <PlusSmIcon />
              </button>
            )}
          </div>
        ) : (
          <button
            className={styles.refAddBtn}
            disabled={taskRunning}
            title={taskRunning ? '生成中不可修改素材' : '添加参考'}
            onClick={() => onStartPickRef?.(0)}
          >
            <PlusSmIcon />
          </button>
        )}
      </div>

      {/* textarea */}
      <textarea
        className={styles.textarea}
        placeholder={
          kind === 'text' ? '输入主题或完整的生图提示词...' : `描述你想要生成的${kind === 'video' ? '视频' : ''}内容...`
        }
        value={prompt}
        onChange={(e) => {
          if (taskRunning) return
          setPrompt(e.target.value)
          if (polishError) setPolishError('')
        }}
      />

      <div className={styles.textPromptTools}>
        <div className={`${styles.textPromptHint} ${polishError ? styles.textPromptError : ''}`}>
          {taskRunning
            ? '当前节点正在生成，模型、提示词和素材已锁定；如需更换模型，请添加新的节点。'
            : polishError ||
              (kind === 'text'
                ? '保存后将原文直接作为下游图片、视频的生成提示词'
                : kind === 'video'
                  ? '参考图片为可选项；不添加图片时将直接按文案生成视频'
                  : '润色后只更新图片描述，不会自动开始生成')}
        </div>
        <button
          type="button"
          className={styles.polishBtn}
          onClick={handlePolishText}
          disabled={taskRunning || !prompt.trim() || !onPolishText || polishing}
          title={`扩写为更完整的${kind === 'video' ? '视频' : '图片'}生成提示词`}
        >
          <span aria-hidden="true">✦</span>
          {polishing ? '润色中...' : 'AI 一键润色'}
        </button>
      </div>

      {/* 底部操作栏 */}
      <div className={styles.actions}>
        <div className={styles.selectors}>
          {kind !== 'text' && (
            <ModelSelector
              models={availableModels}
              value={node?.modelVersionId}
              loading={modelsLoading}
              disabled={taskRunning}
              onChange={(value) => {
                if (!taskRunning) onModelChange?.(value)
              }}
            />
          )}

          {/* 比例选择器：schema 已含比例字段时由菜单控制；seedream 5.0 模型不提供独立比例选项 */}
          {kind === 'image' && !imageRatioInSchema && !isSeedream50Model(selectedModel) && (
            <RatioSelector value={ratio} onRatioChange={taskRunning ? undefined : onRatioChange} />
          )}

          {/* 模型 params_schema 参数菜单：所有节点类型通用；视频额外含生成方式组 */}
          {kind !== 'text' && schemaFields.length > 0 && (
            <SchemaFieldMenu
              kind={kind}
              mode={kind === 'video' ? videoMode : undefined}
              fields={schemaFields}
              values={fieldValues}
              onModeChange={taskRunning ? undefined : onVideoModeChange}
              onFieldChange={taskRunning ? () => undefined : handleFieldChange}
            />
          )}
        </div>

        <button
          className={`${styles.generateBtn} ${styles.generatePill}`}
          onClick={handleGenerate}
          disabled={taskRunning || (kind === 'text' ? !prompt.trim() : !selectedModel || !operationCode)}
          title={
            taskRunning ? '生成过程中不能修改，请添加新的节点使用其他模型' : kind === 'text' ? '保存提示词' : '发送生成'
          }
        >
          {/* 左侧：预估积分数字 */}
          {kind === 'text' ? (
            <span className={styles.saveTextLabel}>保存提示词</span>
          ) : (
            <span
              className={`${styles.costBadge} ${
                costEstimate.loading
                  ? styles.costBadgeLoading
                  : costEstimate.estimated_cost !== undefined && !costEstimate.can_afford
                    ? styles.costBadgeInsufficient
                    : ''
              }`}
            >
              {costEstimate.loading
                ? '…'
                : costEstimate.estimated_cost !== undefined && costEstimate.estimated_cost > 0
                  ? costEstimate.estimated_cost
                  : '—'}
            </span>
          )}
          {/* 右侧：发送 icon（不显示文字） */}
          <span className={styles.sendIcon}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
              <path d="M3.4 20.4l17.45-7.48a1 1 0 0 0 0-1.84L3.4 3.6a.993.993 0 0 0-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87.99l.01 4.61c0 .71.73 1.2 1.39.92z" />
            </svg>
          </span>
        </button>
      </div>
    </div>
  )
}

/* ---------- 子组件：选择器 ---------- */

/** 通用选择器弹出层 */
function SelectorPopover({
  children,
  open,
  onClose,
}: {
  children: React.ReactNode
  open: boolean
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open, onClose])
  return open ? (
    <div className={styles.popover} ref={ref}>
      {children}
    </div>
  ) : null
}

/* ── 模型选择器（受控，数据来自 /api/v1/ai/models） ── */
function ModelSelector({
  models,
  value,
  loading,
  disabled,
  onChange,
}: {
  models: GenerationModelOption[]
  value?: number
  loading?: boolean
  disabled?: boolean
  onChange?: (modelVersionId: number) => void
}) {
  const [open, setOpen] = useState(false)
  const availableModels = models.filter((m) => !m.unavailableReason)
  const selected =
    availableModels.find((m) => m.modelVersionId === value) || (availableModels.length ? availableModels[0] : undefined)
  const display = loading ? '加载中...' : selected?.displayName || '暂无可用模型'

  return (
    <div className={styles.selectorWrap}>
      <button
        className={`${styles.selector} ${availableModels.length === 0 || disabled ? styles.selectorDisabled : ''}`}
        onClick={() => {
          if (availableModels.length === 0 || disabled) return
          setOpen((v) => !v)
        }}
      >
        {display}
      </button>
      {open && availableModels.length > 0 && (
        <SelectorPopover open={open} onClose={() => setOpen(false)}>
          {availableModels.map((m) => (
            <button
              key={m.modelVersionId}
              className={`${styles.popoverItem} ${m.modelVersionId === value ? styles.popoverItemActive : ''}`}
              onClick={() => {
                onChange?.(m.modelVersionId)
                setOpen(false)
              }}
            >
              {m.displayName}
            </button>
          ))}
        </SelectorPopover>
      )}
    </div>
  )
}

/* ── 比例选择器（图片，受控） ── */
function RatioSelector({ value, onRatioChange }: { value: string; onRatioChange?: (r: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={styles.selectorWrap}>
      <button className={styles.selector} onClick={() => setOpen((v) => !v)}>
        <span className={styles.ratioLabel}>{value}</span>
      </button>
      <SelectorPopover open={open} onClose={() => setOpen(false)}>
        {aspectRatios.map((r) => (
          <button
            key={r}
            className={`${styles.popoverItem} ${r === value ? styles.popoverItemActive : ''}`}
            onClick={() => {
              onRatioChange?.(r)
              setOpen(false)
            }}
          >
            {r}
          </button>
        ))}
      </SelectorPopover>
    </div>
  )
}

/* ── 模型参数菜单（生成方式[视频] + params_schema 动态参数，所有节点类型通用） ── */
function SchemaFieldMenu({
  kind,
  mode,
  fields,
  values,
  onModeChange,
  onFieldChange,
}: {
  kind: string
  mode?: VideoMode
  fields: ParamsSchemaField[]
  values: Record<string, unknown>
  onModeChange?: (m: VideoMode) => void
  onFieldChange?: (name: string, value: unknown) => void
}) {
  const [open, setOpen] = useState(false)

  // 按钮摘要：视频先显示生成方式，再拼接各字段当前值
  const modeLabel = mode === 'first-last' ? '首尾帧' : mode === 'full-ref' ? '全能参考' : '自由生成'
  const displayParts = kind === 'video' ? [modeLabel] : []
  for (const f of fields) {
    const v = values[f.name]
    if (v === undefined || v === null || v === '') continue
    displayParts.push(formatFieldValue(f, v))
  }
  const display = displayParts.join(' · ')

  /** number 滑块步进：default 带小数点则按小数位数（0.5→0.1，0.05→0.01），否则按 1 */
  const sliderStep = (f: ParamsSchemaField): number => {
    const s = String(f.default ?? '')
    const dot = s.indexOf('.')
    if (dot >= 0) {
      const dec = s.length - dot - 1
      if (dec > 0) return 1 / Math.pow(10, dec)
    }
    return 1
  }

  return (
    <div className={styles.selectorWrap}>
      <button className={styles.selector} onClick={() => setOpen((v) => !v)}>
        {display}
      </button>
      <SelectorPopover open={open} onClose={() => setOpen(false)}>
        <div className={styles.videoMenu}>
          {/* 生成方式（仅视频；保留首尾帧/全能参考切换，不由 schema 驱动） */}
          {kind === 'video' && (
            <div className={styles.videoMenuGroup}>
              <div className={styles.videoMenuTitle}>生成方式</div>
              <div className={styles.videoBtnGroup}>
                {(['auto', 'first-last', 'full-ref'] as VideoMode[]).map((m) => (
                  <button
                    key={m}
                    className={`${styles.videoBtnGroupItem} ${mode === m ? styles.videoBtnGroupItemActive : ''}`}
                    onClick={() => onModeChange?.(m)}
                  >
                    {m === 'auto' ? '自由生成' : m === 'first-last' ? '首尾帧' : '全能参考'}
                  </button>
                ))}
              </div>
              {mode === 'auto' && (
                <div className={styles.videoMenuHint}>不添加图片即文生视频，也可添加 1–5 张参考图。</div>
              )}
            </div>
          )}

          {/* 模型 params_schema.fields 动态参数 */}
          {fields.map((f) => {
            const current = values[f.name]
            const isActive = (v: unknown) => String(current) === String(v)
            return (
              <div key={f.name} className={styles.videoMenuGroup}>
                <div className={styles.videoMenuTitle}>
                  {f.displayName}
                  {/* help 字段：标题后显示 ? 图标，hover 展示说明气泡 */}
                  {f.help && (
                    <span className={styles.helpIconWrap}>
                      <span className={styles.helpIcon} aria-hidden="true">
                        ?
                      </span>
                      <span className={styles.helpTooltip} role="tooltip">
                        {f.help}
                      </span>
                    </span>
                  )}
                </div>
                {isBooleanField(f) ? (
                  <div className={styles.videoBtnGroup}>
                    <button
                      className={`${styles.videoBtnGroupItem} ${current ? styles.videoBtnGroupItemActive : ''}`}
                      onClick={() => onFieldChange?.(f.name, true)}
                    >
                      开
                    </button>
                    <button
                      className={`${styles.videoBtnGroupItem} ${!current ? styles.videoBtnGroupItemActive : ''}`}
                      onClick={() => onFieldChange?.(f.name, false)}
                    >
                      关
                    </button>
                  </div>
                ) : isNumberField(f) ? (
                  /* 数字类型：滑块，min/max 为范围，步进由 default 是否有小数点决定 */
                  <div className={styles.sliderWrap}>
                    <input
                      type="range"
                      className={styles.slider}
                      min={f.min ?? 0}
                      max={f.max ?? 100}
                      step={sliderStep(f)}
                      value={Number(current) || 0}
                      onChange={(e) => onFieldChange?.(f.name, Number(e.target.value))}
                    />
                    <span className={styles.sliderValue}>{formatFieldValue(f, current)}</span>
                  </div>
                ) : (
                  <div className={styles.videoBtnGroup}>
                    {(f.options || []).map((o) => (
                      <button
                        key={o}
                        className={`${styles.videoBtnGroupItem} ${isActive(o) ? styles.videoBtnGroupItemActive : ''}`}
                        onClick={() => onFieldChange?.(f.name, o)}
                      >
                        {formatFieldValue(f, o)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </SelectorPopover>
    </div>
  )
}

/* ── 常量 ── */
const aspectRatios = ['2:3', '1:1', '4:3', '16:9', '9:16']

/* ── 小图标 ── */
function PlusSmIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="8" y1="3" x2="8" y2="13" />
      <line x1="3" y1="8" x2="13" y2="8" />
    </svg>
  )
}

function TextRefIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="3" y="4" width="14" height="12" rx="2" />
      <line x1="6" y1="8" x2="14" y2="8" />
      <line x1="6" y1="12" x2="11" y2="12" />
    </svg>
  )
}

function ImageRefIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="2" y="2" width="16" height="16" rx="3" />
      <circle cx="7" cy="7" r="1.5" fill="currentColor" />
      <path d="M2 14l4.5-4.5 3 3 2.5-2.5 5 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function VideoRefIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="2" y="3" width="16" height="14" rx="2.5" />
      <polygon points="8,7 14,10 8,13" fill="currentColor" />
    </svg>
  )
}

function SwapIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10.5 2.85L13 5.35H3M5.5 13.1L3 10.6h10" />
    </svg>
  )
}
