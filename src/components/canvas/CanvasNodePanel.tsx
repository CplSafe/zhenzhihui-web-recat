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
import {
  buildCanvasInputAssets,
  buildPolishImageRefs,
  canvasVideoReferenceMode,
  validateCanvasImageInputs,
  validateCanvasVideoInputs,
  type CanvasInputAsset,
  type CanvasAssetSource,
  type CanvasConnectionRole,
  type CanvasVideoMode,
} from '@/utils/canvasGeneration'
import { filterInputDerivedRatioOptions, resolveCanvasModelParamOption } from '@/utils/canvasModelParams'
import { resolveModelInputAssetRoleSafe } from '@/utils/modelInputAssetRole'
import { resolveModelVideoInputSupport, VIDEO_INPUT_UNSUPPORTED_REASON } from '@/utils/modelVideoInputSupport'
import { readModelAccentHue, readModelInitial, readModelPresentation } from '@/utils/modelPresentation'
import {
  buildModelRestrictionSummary,
  getModelDurationLimitLabel,
  getModelReferenceImageLimit,
} from '@/utils/modelRestrictions'
import { DEFAULT_MAX_REFS, FIRST_LAST_REF_SLOTS } from '@/utils/canvasNodeDefaults'
import type { SmartRealPersonReference } from '@/utils/smartRealPerson'
import WheelPicker, { type WheelPickerOption } from '@/components/common/WheelPicker'
import { requestConfirm } from '@/stores/ui'

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

/**
 * 前端一律不暴露的参数字段。
 *
 * 随机种子（seed / random_seed / noise_seed）对使用者没有可理解的含义：改它既不能稳定复现
 * 同一张图（同种子在服务端排队、版本变动下并不保证同结果），也不能让画面变好，
 * 只是在参数栏白占一格、还诱使用户以为它是个可调质量的旋钮。
 * 从 schemaFields 源头剔除，菜单不渲染、params 也不带上，交给后端用自己的默认值。
 */
const HIDDEN_PARAM_KEYS = new Set(['seed', 'randomseed', 'noiseseed', 'seednumber'])

/**
 * reference_mode 由「生成方式」分段控件（首尾帧 / 全能参考）驱动，不作为独立参数暴露：
 * 两个控件指向同一个开关，同屏出现必然打架。同时必须挡住 buildSchemaParams 用
 * schema 的 Default 填它——后端 ValidateParams 刻意不注入 Default，好让「不传」
 * 触发按素材数量的启发式；前端替它填 false 会把缺省探测变成「显式要首尾帧」，
 * 于是用户选了全能参考、图片仍被翻译成 first_frame / last_frame。
 */
const REFERENCE_MODE_KEYS = new Set(['referencemode'])

function isReferenceModeField(field: ParamsSchemaField): boolean {
  return REFERENCE_MODE_KEYS.has(normalizeParamKey(field.name))
}

function isHiddenParamField(field: ParamsSchemaField): boolean {
  const key = normalizeParamKey(field.name)
  return HIDDEN_PARAM_KEYS.has(key) || REFERENCE_MODE_KEYS.has(key)
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

/**
 * 时长字段的滚轮档位。
 * schema 给了 options 就照用；只给数字范围时按整秒展开，保证滚轮始终有可停的档位。
 */
function durationWheelOptions(field: ParamsSchemaField): WheelPickerOption[] {
  const declared = (field.options || []).map((option) => ({
    value: String(option),
    label: formatFieldValue(field, option),
  }))
  if (declared.length) return declared

  const min = Math.ceil(Number(field.min))
  const max = Math.floor(Number(field.max))
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return []
  // 上限保护：范围异常大时不生成上千个档位把面板拖垮。
  if (max - min > 120) return []
  return Array.from({ length: max - min + 1 }, (_, index) => ({
    value: String(min + index),
    label: formatFieldValue(field, min + index),
  }))
}

/** 滚轮回传的是字符串，需还原成 schema 声明的原始类型（时长档位通常是数字）。 */
function resolveDurationWheelValue(field: ParamsSchemaField, picked: string): string | number {
  const declared = (field.options || []).find((option) => String(option) === picked)
  if (declared !== undefined) return declared
  const numeric = Number(picked)
  return Number.isFinite(numeric) ? numeric : picked
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
  /** 视频来源的封面帧；视频的 thumbnailUrl 是 mp4 地址，不能直接当图片渲染。 */
  posterUrl?: string
  /** 来源节点的素材 asset_id（有素材内容时用于组装 input_assets） */
  assetId?: number
  source?: CanvasAssetSource
  workspaceId?: number
  /** 真人素材库引用：用于身份授权校验与生成时的身份约束注入。 */
  realPerson?: SmartRealPersonReference
  /** 该连接在目标节点中的用途，仅用于画布语义展示。 */
  role?: CanvasConnectionRole
}

interface InheritedPromptText {
  sourceId: string
  edgeId: string
  text: string
}

export interface CanvasNodeInfo {
  id: string
  kind: string
  /** 用户确认的文本提示词，供下游图片和视频节点直接使用。 */
  text?: string
  /** 图片/视频节点输入框里的提示词；随节点持久化，切换节点或刷新后仍要回显。 */
  prompt?: string
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
  /** 节点已有素材的 asset_id：视频生视频时作为源视频下发。 */
  assetId?: number
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
  /** 从画布上点选一个已有节点作为参考。slotIndex 标识槽位：0=首帧, 1=尾帧(视频)；其他节点按顺序 */
  onStartPickRef?: (slotIndex?: number) => void
  /**
   * 从素材库挑一条素材作为参考：会先落成新节点再连到本节点。
   *
   * 与 onStartPickRef 并列而不是取代它——两者解决的是不同处境：
   * 画布上已经有这条素材时点选最快，还没有时才需要从素材库取。
   * 以前只有前者，导致「素材在库里但画布上没有」时只能先手动加节点再连线。
   */
  onPickRefFromLibrary?: (slotIndex?: number) => void
  /** 打开真人素材库，真人素材只能作为视频生成的输入。 */
  onOpenRealPersonLibrary?: () => void
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
    /** 与积分预估完全相同的最终素材清单，调用方不得再次用另一套规则重建。 */
    inputAssets: CanvasInputAsset[]
    ratio?: string
    videoMode?: CanvasVideoMode
    /** 视频生视频的源视频（节点自己已有的那条）；为 0 表示从头生成。 */
    selfVideoAssetId?: number
  }) => void
  /** 费用预估判定积分不足时，由页面展示充值引导。 */
  onInsufficientCredits?: () => void
  onSaveText?: (text: string) => void
  /** 图片/视频节点输入框内容变更：由页面写回节点并持久化，切换节点/刷新后可回显。 */
  onPromptChange?: (prompt: string) => void
  /**
   * 生成参数变更：同样由页面写回节点并持久化。
   * 不持久化的话，调好的分辨率/时长刷新即退回模型默认值，而提示词却留着——
   * 同一个面板两种行为，用户只会当成丢数据。
   */
  onParamsChange?: (params: Record<string, unknown>) => void
  /**
   * 从上游文本节点继承来的提示词，按连线顺序。
   *
   * 输入框为空时会自动填进去（见下方 useEffect），所以它既是展示数据也是 prompt 的来源；
   * 拼接时会剔除输入框里已包含的段落，避免同一段内容被拼两遍。
   */
  inheritedTexts?: InheritedPromptText[]
  /** 将继承文本转为本节点自己的 prompt，并由页面断开对应文本连线。 */
  onAdoptInheritedText?: () => void
  onPolishText?: (params: {
    prompt: string
    kind: string
    /** 已连线的参考图地址，与 imageAssetIds 按下标对应。 */
    images?: string[]
    /** 已连线参考图的素材 ID，优先于地址复用，避免重复上传。 */
    imageAssetIds?: number[]
  }) => Promise<string>
}

type VideoMode = CanvasVideoMode

/** 稳定的默认值：内联 [] 会让依赖它的 memo/effect 每次渲染都失效，反复触发积分预估。 */
const EMPTY_INHERITED_TEXTS: InheritedPromptText[] = []

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

/**
 * 参考素材的「+」：点开给两条来源，而不是直接进入画布点选模式。
 *
 * 只有「从画布选择」时，素材已在库里但画布上还没有的情况下，用户得先自己加一个节点、
 * 传上素材、再回来连线——三步做一件事。这里把「从素材库选择」摆到同一层。
 */
function RefAddButton({
  disabled,
  title,
  onPickFromCanvas,
  onPickFromLibrary,
}: {
  disabled?: boolean
  title: string
  onPickFromCanvas: () => void
  onPickFromLibrary?: () => void
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (wrapRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // 没接素材库回调时退回原来的单一行为，不平白给一个只有一项的菜单
  if (!onPickFromLibrary) {
    return (
      <button className={styles.refAddBtn} disabled={disabled} title={title} onClick={onPickFromCanvas}>
        <PlusSmIcon />
      </button>
    )
  }

  return (
    <span className={styles.refAddWrap} ref={wrapRef}>
      <button
        className={styles.refAddBtn}
        disabled={disabled}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <PlusSmIcon />
      </button>
      {open && (
        <div className={styles.refAddMenu} role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onPickFromCanvas()
            }}
          >
            从画布选择
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onPickFromLibrary()
            }}
          >
            从素材库选择
          </button>
        </div>
      )}
    </span>
  )
}

export default function CanvasNodePanel({
  node,
  workspaceId,
  onStartPickRef,
  onPickRefFromLibrary,
  onOpenRealPersonLibrary,
  onRemoveRef,
  onRatioChange,
  onVideoModeChange,
  onModelChange,
  models,
  modelsLoading,
  onGenerate,
  onInsufficientCredits,
  onSaveText,
  onPromptChange,
  onParamsChange,
  inheritedTexts,
  onAdoptInheritedText,
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
  // 文本节点的内容存在 text，图片/视频节点的输入框存在 prompt；两者都随节点持久化。
  const [prompt, setPrompt] = useState(() => String((kind === 'text' ? node?.text : node?.prompt) || ''))
  const [polishing, setPolishing] = useState(false)
  const [polishError, setPolishError] = useState('')

  // 切换选中节点时回填该节点自己的文案：面板是所有节点共用的一个实例，
  // 不按 node.id 重新灌值就会把上一个节点的输入框内容留在这里。
  const restoredNodeIdRef = useRef<string | undefined>(node?.id)
  useEffect(() => {
    if (kind === 'text') {
      setPrompt(String(node?.text || ''))
      setPolishError('')
      restoredNodeIdRef.current = node?.id
      return
    }
    // 同一节点内不跟随 node.prompt 回灌，否则用户正在输入时会被持久化回来的值打断。
    if (restoredNodeIdRef.current === node?.id) return
    restoredNodeIdRef.current = node?.id
    setPrompt(String(node?.prompt || ''))
    setPolishError('')
  }, [kind, node?.id, node?.text, node?.prompt])
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
  // 素材来源引用数量（文本来源不计入数量限制）
  const mediaRefCount = useMemo(() => sourceRefs.filter((ref) => ref.kind !== 'text').length, [sourceRefs])
  const kindModels = useMemo(() => models?.[kind as 'text' | 'image' | 'video'] || [], [models, kind])
  const stableInheritedTexts = inheritedTexts || EMPTY_INHERITED_TEXTS
  const hasInheritedTexts = stableInheritedTexts.length > 0

  /**
   * 当前上下文应使用的 operation_code：
   * 文本节点 → responses.multimodal
   * 图片节点：无图片来源节点（参考图）→ image.text_to_image；有图片来源节点 → image.image_to_image
   * 视频节点：一律 video.generate——包括「视频生视频」（连线来源是视频/时间线，或在改自己那条）。
   *
   * 这里曾经在有视频输入时切成 video.edit，于是模型下拉只剩 happyhorse 那个视频编辑模型：
   * 用户想用哪个视频生成模型来做视频生视频都选不了，只能被塞给编辑模型。
   * 当初那么写的理由是「后端不接受 video.generate + role:'video'」，这个结论现在已经不成立——
   * 智能成片的视频生视频正是 video.generate + role:'video'（见 smartVideo.buildFullVideoInputAssets），
   * 一直在生产上跑。画布的 input_assets 本来就按来源类型下发 role（视频来源恒为 'video'，
   * 见 buildCanvasInputAssets），与 operation 无关，所以这里改回 video.generate 不影响素材角色。
   *
   * 改完之后画布不再产出 video.edit：视频节点的 operation 不复用持久化值（见下面 targetOperationCode），
   * 所以老节点重新生成时也会走 video.generate。happyhorse 那类只声明 video.edit 的模型
   * 因此不再出现在画布的模型下拉里——爆款复制仍在用 video.edit，那条通道不受影响。
   */
  const contextualOperationCode = useMemo((): string => {
    if (kind === 'text') return 'responses.multimodal'
    if (kind === 'image') {
      // 真人素材不是普通参考图：真人身份由生成层的身份约束处理，不能把它
      // 当作 image-to-image 参考图提交，否则大多数图片模型会直接拒绝该操作。
      const hasRealPersonSource = (node?.sourceRefs || []).some((ref) => ref.source === 'real_person')
      if (hasRealPersonSource) return 'image.text_to_image'
      const hasImageSource = (node?.sourceRefs || []).some((ref) => ref.kind === 'image')
      return hasImageSource ? 'image.image_to_image' : 'image.text_to_image'
    }
    // 视频一律 video.generate：有没有源视频只改 input_assets（多一条 role:'video'），不换 operation
    if (kind === 'video') return 'video.generate'
    return ''
  }, [kind, node?.sourceRefs])

  const targetOperationCode = useMemo((): string => {
    // 图片生成模式必须跟随当前参考链实时切换：接入（包括经文本节点继承的）参考图后，
    // 不能继续复用节点历史上保存的 image.text_to_image，否则参考素材不会进入模型。
    if (kind === 'image') return contextualOperationCode
    // 视频恒为 video.generate，不复用持久化值：历史节点上可能存着 video.edit，
    // 那是画布还在用编辑模型时留下的，继续复用会把用户重新拽回 happyhorse
    if (kind === 'video') return contextualOperationCode
    const persisted = String(node?.operationCode || '').trim()
    // 持久化的 operation_code 若仍被当前 kind 的模型支持，则复用；否则回退上下文推断
    if (persisted && kindModels.some((m) => (m.operationCodes as string[] | undefined)?.includes(persisted))) {
      return persisted
    }
    return contextualOperationCode
  }, [kind, node?.operationCode, kindModels, contextualOperationCode])

  /**
   * 本次生成是否要把一条视频作为输入素材下发（role:'video'）。
   * 两种来源：连线接了视频/时间线节点，或是在改节点自己那条视频。
   */
  const needsVideoInputAsset = useMemo(() => {
    if (kind !== 'video') return false
    if (isEditingVideo) return true
    return (node?.sourceRefs || []).some((ref) => ref.kind === 'video' || ref.kind === 'timeline')
  }, [kind, isEditingVideo, node?.sourceRefs])

  /**
   * 只显示支持目标 operation_code 的模型（模型可能同时支持多个 code）。
   *
   * 要下发视频素材时再筛一道「这个模型收不收视频」：光看 operation 是不够的——
   * 「参考生视频」这类同样声明 video.generate，但输入只认参考图，
   * 选中提交后要等后端回一句「素材类型不适用于当前操作」才知道，而那一步已经付过费了。
   * 不可用的模型仍留在列表里并写明原因，和会员/余额挡住时的处理一致：
   * 直接消失会让用户以为模型没配好，反而更难自查。
   */
  const availableModels = useMemo(() => {
    const matched = kindModels.filter((m) => m.operationCodes?.some((code) => code === targetOperationCode))
    if (!needsVideoInputAsset) return matched
    return matched.map((model) => {
      if (model.unavailableReason) return model
      if (resolveModelVideoInputSupport(model) !== 'unsupported') return model
      return { ...model, unavailableReason: VIDEO_INPUT_UNSUPPORTED_REASON }
    })
  }, [kindModels, targetOperationCode, needsVideoInputAsset])

  // 选中模型（按 modelVersionId 匹配，无匹配时取第一个可用；优先保留用户已选）
  const selectedModel: GenerationModelOption | undefined = useMemo(() => {
    if (!node?.modelVersionId) return availableModels.find((m) => !m.unavailableReason)
    return (
      availableModels.find((m) => m.modelVersionId === node.modelVersionId && !m.unavailableReason) ||
      availableModels.find((m) => !m.unavailableReason)
    )
  }, [availableModels, node?.modelVersionId])

  /**
   * 素材来源数量上限：跟随所选模型在 params schema 里声明的参考图上限。
   *
   * 模型没声明才回退到 DEFAULT_MAX_REFS（即改造前写死的 5），因为「后端没说」和
   * 「后端说了正好是 5」是两件事，不能让前端替模型编一个能力。
   *
   * 首尾帧是唯一不跟模型走的情况：它固定就是首帧 + 尾帧两槽，属于语义约束而非数量约束，
   * 模型即便声明能收 9 张，这个模式下也没有第三张的位置可放。
   * 文本来源同样不受这个上限约束（内容拼进 prompt），见 mediaRefCount 的过滤。
   */
  const maxRefs = useMemo(() => {
    if (kind === 'video' && videoMode === 'first-last') return FIRST_LAST_REF_SLOTS
    const constraints = buildModelRestrictionSummary(selectedModel?.source).constraints
    return getModelReferenceImageLimit(constraints) ?? DEFAULT_MAX_REFS
  }, [kind, videoMode, selectedModel])

  /** 视频节点顶部的参考槽位下标，数量跟随 maxRefs。 */
  const refSlots = useMemo(() => Array.from({ length: maxRefs }, (_, index) => index), [maxRefs])

  // 本次生成使用的 operation_code：目标 code 有可用模型时固定使用，否则为空（按钮禁用）
  const operationCode = useMemo(() => {
    if (!availableModels.some((m) => !m.unavailableReason)) return ''
    return targetOperationCode
  }, [availableModels, targetOperationCode])

  /** 缺模型时的说明文案：按目标 operation 指名道姓，不要笼统说「暂无可用模型」。 */
  const emptyModelLabel = useMemo(() => {
    const labels: Record<string, string> = {
      'image.image_to_image': '暂无可用的图生图模型',
      'image.text_to_image': '暂无可用的文生图模型',
      'video.edit': '暂无可用的视频修改模型',
      'video.generate': '暂无可用的视频生成模型',
    }
    // 视频输入是被筛掉的原因时要说清楚，否则用户对着「暂无可用的视频生成模型」
    // 只会以为模型没配好——而下拉里明明有一堆视频模型
    if (needsVideoInputAsset && targetOperationCode === 'video.generate') {
      return '暂无支持视频输入的视频生成模型'
    }
    return labels[targetOperationCode] || ''
  }, [targetOperationCode, needsVideoInputAsset])

  /** 是否有素材输入（图片/视频连线）；纯文本来源不算，它只会拼进 prompt。 */
  const hasMediaInput = useMemo(() => sourceRefs.some((ref) => ref.kind !== 'text'), [sourceRefs])

  // 选中模型的 params_schema.fields（视频菜单动态渲染来源）。
  // 没有素材输入时剔除「跟随素材」的比例档位（adaptive/auto）：模型无从推断画幅，官方 API 直接 400。
  // 在这里一次性剔除，下拉菜单、默认值收敛和最终 params 三处就都拿不到这个档位。
  //
  // 随机种子同样在这里整条剔除：它对使用者没有可理解的含义，调它既不能复现也不能改善画面，
  // 只是白占一格参数位。从 schemaFields 源头去掉，菜单不再渲染它，params 里也不会带上，
  // 后端未传时按其自身默认处理。
  const schemaFields = useMemo(() => {
    const fields = parseParamsSchema(selectedModel).filter((field) => !isHiddenParamField(field))
    if (hasMediaInput) return fields
    return fields.map((field) =>
      isRatioField(field) ? { ...field, options: filterInputDerivedRatioOptions(field.options, false) } : field,
    )
  }, [selectedModel, hasMediaInput])

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

  /**
   * 由 schema fields + 当前字段值构建 params。
   *
   * 抽成函数是为了让「渲染期用的 schemaParams」和「字段变更时持久化的那份」共用同一套规则：
   * 两处各写一遍迟早会漂移，届时提交的参数和存下来的参数就不是一回事了。
   *
   * 必须定义在 handleFieldChange 之前：useCallback 的依赖数组在渲染期就求值，
   * 定义在后面会直接撞上 const 的暂时性死区，整块面板崩掉。
   */
  const buildSchemaParams = useCallback(
    (values: Record<string, unknown>): Record<string, unknown> => {
      const params: Record<string, unknown> = {}
      for (const f of schemaFields) {
        if (kind === 'text' && ['max_output_tokens', 'maxOutputTokens', 'max_tokens', 'maxTokens'].includes(f.name)) {
          continue
        }
        params[f.name] = normalizeFieldValue(f, values[f.name] !== undefined ? values[f.name] : f.default)
      }
      return params
    },
    [schemaFields, kind],
  )

  // 字段值变更：回写状态；比例字段（ratio/aspect_ratio/aspectRatio）同步节点比例（保持节点尺寸联动）
  const handleFieldChange = useCallback(
    (name: string, value: unknown) => {
      const field = schemaFields.find((f) => f.name === name)
      const normalizedValue = field ? normalizeFieldValue(field, value) : value
      setFieldValues((prev) => ({ ...prev, [name]: normalizedValue }))
      if (field && isRatioField(field) && typeof normalizedValue === 'string') onRatioChange?.(normalizedValue)
      // 即时落到节点：只在用户真的改了字段时写，不在挂载/换模型时把默认值写进去，
      // 否则单纯点开一个节点就会把画布标记成 dirty 并触发一次云端同步。
      onParamsChange?.(buildSchemaParams({ ...fieldValues, [name]: normalizedValue }))
    },
    [schemaFields, onRatioChange, onParamsChange, buildSchemaParams, fieldValues],
  )

  // 图片节点的 schema 里若已含比例字段（ratio/aspect_ratio/aspectRatio），则由 schema 菜单控制比例，隐藏固定 RatioSelector
  const imageRatioInSchema = kind === 'image' && schemaFields.some(isRatioField)

  // 参数 params：由所选模型的 schema fields 动态构建（所有节点类型通用，不再写死 resolution/duration）
  //
  // 视频再按「生成方式」补上 reference_mode：它被 isHiddenParamField 挡在 schemaFields 之外
  // （避免与分段控件重复、也避免被 schema Default 顶成 false），只能在这里按模型声明的
  // 真实字段名注入，与智能成片 buildSmartVideoParams 同口径。未声明该字段的模型
  // （kling / minimax 各有自己的模式开关）不下发，免得塞入上游不认识的参数。
  const schemaParams = useMemo<Record<string, unknown>>(() => {
    const params = buildSchemaParams(fieldValues)
    if (kind !== 'video') return params
    const referenceMode = canvasVideoReferenceMode(videoMode)
    if (referenceMode === undefined) return params
    // 从未过滤的 schema 里找（schemaFields 已把它剔除），按模型声明的真实字段名下发。
    const field = parseParamsSchema(selectedModel).find(isReferenceModeField)
    if (field?.name) params[field.name] = referenceMode
    return params
  }, [buildSchemaParams, fieldValues, kind, videoMode, selectedModel])

  /**
   * 拼接最终 prompt：继承来的文本在前（按连线顺序），用户自己的提示词在后；
   * 图片/视频来源作为素材引用（input_assets）单独传参，不拼进 prompt。
   *
   * 这里刻意用 inheritedTexts 而不是再去读一次 window.__canvasTextContents：
   * 上方展示的就是这份数据，两处同源才能保证「看到的」等于「发出去的」。
   * 各自去读全局 Map 的话，一旦取值口径出现分歧（比如 trim 与否），
   * 用户就会对着一段显示正常的文本却拿到另一种结果，这类问题几乎无法排查。
   */
  const inheritedPromptText = useMemo(
    () => stableInheritedTexts.map((item) => item.text.trim()).filter(Boolean),
    [stableInheritedTexts],
  )
  /**
   * 上游文本自动落进输入框：连上文本节点后不用再点一次「转为可编辑」，改完直接点生成。
   *
   * 只在输入框为空时填，绝不覆盖用户已经写下的内容——这是唯一会丢字的方向。
   * 填完仍保留连线（画布上还看得见来源关系），因此提交时必须把这段从「继承」里排除掉，
   * 否则同一段文字会拼两遍。
   */
  useEffect(() => {
    if (kind === 'text' || !inheritedPromptText.length || prompt.trim()) return
    const filled = inheritedPromptText.join('\n\n')
    setPrompt(filled)
    onPromptChange?.(filled)
  }, [kind, inheritedPromptText, prompt, onPromptChange])

  /**
   * 还没进输入框的继承文本。已经落进输入框的那些不再重复拼接，也不再单独展示：
   * 输入框里那份才是用户看得见、改得动的，展示两份只会让人分不清最终发出去的是哪个。
   */
  const pendingInheritedText = useMemo(
    () => inheritedPromptText.filter((text) => !prompt.includes(text)),
    [inheritedPromptText, prompt],
  )

  const buildFullPrompt = useCallback(
    (userPrompt: string): string => {
      const userText = userPrompt.trim()
      return [...inheritedPromptText.filter((text) => !userText.includes(text)), userText].filter(Boolean).join('\n\n')
    },
    [inheritedPromptText],
  )

  // 估价必须和提交用同一份 input_assets：改片时节点自己的那条视频也要计入，
  // 否则源视频只在提交时下发，预估按「没有源视频」算，出现预估 ≠ 实扣。
  //
  // 只在真正改片时下发：「使用新模型重新生成」是从头再生成一次，
  // 把自己那条视频当输入发出去会让 video.generate 收到一个它不接受的视频素材而被拒。
  const selfVideoAssetId = isEditingVideo ? Number(node?.assetId || 0) : 0
  // 角色同样要与提交一致；这里在渲染期求值，模型配置有歧义时退回 image 而不是抛错炸掉面板。
  const declaredImageRole = useMemo(
    () => (selectedModel ? resolveModelInputAssetRoleSafe(selectedModel.source) : ''),
    [selectedModel],
  )
  const inputAssets = useMemo(
    () => buildCanvasInputAssets(sourceRefs, operationCode, selfVideoAssetId, declaredImageRole),
    [sourceRefs, operationCode, selfVideoAssetId, declaredImageRole],
  )
  const inputValidationError = useMemo(() => {
    if (kind === 'image' && sourceRefs.some((ref) => ref.source === 'real_person')) {
      return '真人素材图片节点仅用于素材展示/中转，不能直接生成图片；请连接到视频节点生成视频'
    }
    if (kind === 'image') {
      return validateCanvasImageInputs({ operationCode, sourceRefs, workspaceId, maxImageRefs: maxRefs })
    }
    if (kind === 'video') {
      return validateCanvasVideoInputs({ operationCode, videoMode, sourceRefs, maxImageRefs: maxRefs })
    }
    return null
  }, [kind, maxRefs, operationCode, sourceRefs, videoMode, workspaceId])

  const inputSummary = useMemo(() => {
    let images = 0
    let videos = 0
    let texts = 0
    for (const ref of sourceRefs) {
      if (ref.kind === 'image') images += 1
      else if (ref.kind === 'video' || ref.kind === 'timeline') videos += 1
      else if (ref.kind === 'text') texts += 1
    }
    return { images, videos, texts, total: images + videos + texts }
  }, [sourceRefs])

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
  // 视频生成前要等用户确认积分消耗，因此是异步的
  const handleGenerate = async () => {
    if (kind === 'text') {
      const value = prompt.trim()
      if (!value) return
      onSaveText?.(value)
      return
    }
    const modelVersionId = selectedModel?.modelVersionId
    if (!modelVersionId || !operationCode || inputValidationError) return
    if (costEstimate.can_afford === false) {
      onInsufficientCredits?.()
      return
    }
    if (taskRunning) return
    const cost = Number(costEstimate.estimated_cost || 0)
    if (kind === 'video' && cost > 0) {
      const operationLabel = isEditingVideo ? '修改当前视频' : '使用新模型生成视频'
      const confirmed = await requestConfirm(
        `${operationLabel}预计消耗 ${cost} 积分，当前余额 ${Number(costEstimate.balance || 0)} 积分，是否继续？`,
        { title: '确认消耗积分', confirmLabel: '继续生成', cancelLabel: '再想想' },
      )
      if (confirmed !== true) return
    }
    onGenerate?.({
      kind,
      prompt: buildFullPrompt(prompt),
      modelVersionId,
      operationCode,
      params: schemaParams,
      sourceRefs,
      inputAssets,
      ratio,
      videoMode: kind === 'video' ? videoMode : undefined,
      // 视频生视频：节点自己已有的那条视频作为源视频下发；新模型重生成则不带，等于从头生成
      selfVideoAssetId: isEditingVideo ? Number(node?.assetId || 0) || 0 : 0,
    })
  }

  const handlePolishText = async () => {
    const value = prompt.trim()
    if (!value || !onPolishText || polishing) return
    setPolishing(true)
    setPolishError('')
    try {
      // 已连线的参考图必须一并交给润色模型：润色看不到图时会凭空补出主体，
      // 生成的长描述随后会在图生图/图生视频里压过参考图，把原主体换掉。
      const polished = String(await onPolishText({ prompt: value, kind, ...buildPolishImageRefs(sourceRefs) })).trim()
      if (!polished) throw new Error('AI 未返回可用的润色内容')
      setPrompt(polished)
      // 润色结果同样要落到节点，否则润色完切走再回来就变回原文
      if (kind !== 'text') onPromptChange?.(polished)
    } catch (error: any) {
      setPolishError(String(error?.message || '润色失败，请稍后重试'))
    } finally {
      setPolishing(false)
    }
  }

  const handleAdoptInheritedText = () => {
    if (!hasInheritedTexts || taskRunning) return
    const merged = [...inheritedTexts.map((item) => item.text), prompt.trim()].filter(Boolean).join('\n\n')
    setPrompt(merged)
    if (kind !== 'text') onPromptChange?.(merged)
    onAdoptInheritedText?.()
  }

  return (
    <div className={styles.panel}>
      {/* tags / 缩略图 */}
      <div className={styles.tags}>
        {inputSummary.total > 1 && (
          <div className={styles.inputSummary} role="status" aria-live="polite">
            <span className={styles.inputSummaryTitle}>多资产汇合</span>
            {inputSummary.images > 0 && <span>{inputSummary.images} 张图片</span>}
            {inputSummary.videos > 0 && <span>{inputSummary.videos} 条视频</span>}
            {inputSummary.texts > 0 && <span>{inputSummary.texts} 段文本</span>}
          </div>
        )}
        {inputValidationError && (
          <div className={styles.inputError} role="alert">
            {inputValidationError}
          </div>
        )}
        {kind === 'video' ? (
          /* 视频节点：槽位随生成方式变化 —— 首尾帧=首帧+尾帧双槽（含交换）；
             全能参考=所选模型声明的参考图上限（未声明则回退默认值），见 maxRefs */
          <div className={styles.refImages}>
            {refSlots.map((slot) => {
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
                        <RefThumbMedia sourceRef={ref} label={title} />
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
                      <RefAddButton
                        disabled={taskRunning}
                        title={taskRunning ? '生成中不可修改素材' : title}
                        onPickFromCanvas={() => onStartPickRef?.(slot)}
                        onPickFromLibrary={onPickRefFromLibrary ? () => onPickRefFromLibrary(slot) : undefined}
                      />
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
                  <RefThumbMedia sourceRef={ref} label={ref.kind} />
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
              <RefAddButton
                disabled={taskRunning}
                title={taskRunning ? '生成中不可修改素材' : '添加参考'}
                onPickFromCanvas={() => onStartPickRef?.(sourceRefs.length)}
                onPickFromLibrary={onPickRefFromLibrary ? () => onPickRefFromLibrary(sourceRefs.length) : undefined}
              />
            )}
          </div>
        ) : (
          <RefAddButton
            disabled={taskRunning}
            title={taskRunning ? '生成中不可修改素材' : '添加参考'}
            onPickFromCanvas={() => onStartPickRef?.(0)}
            onPickFromLibrary={onPickRefFromLibrary ? () => onPickRefFromLibrary(0) : undefined}
          />
        )}
      </div>

      {/*
        继承自上游文本节点、但还没落进输入框的那部分。
        输入框为空时上游文本会自动填进去（见上方 useEffect），正常路径下这里不显示；
        只有用户自己清空或改写过输入框，剩下的那段才露出来——它提交时仍会被拼上，
        不显示就成了「发出去的和看到的不一致」。
      */}
      {pendingInheritedText.length > 0 && (
        <div className={styles.inheritedPrompt}>
          <div className={styles.inheritedPromptMain}>
            <span className={styles.inheritedPromptLabel}>继承文本</span>
            <span className={styles.inheritedPromptText}>{pendingInheritedText.join(' / ')}</span>
          </div>
          <button
            type="button"
            className={styles.inheritedPromptBtn}
            onClick={handleAdoptInheritedText}
            disabled={taskRunning || !onAdoptInheritedText}
          >
            转为本节点提示词
          </button>
        </div>
      )}

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
          // 文本节点的内容由「保存」显式落到 text；图片/视频节点边输入边写回 prompt，
          // 这样切到别的节点再切回来、以及刷新重进，输入框里的文案都还在。
          if (kind !== 'text') onPromptChange?.(e.target.value)
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
              // 缺模型时要说清缺的是哪一种能力：接了参考图走图生图、没接走文生图，
              // 两者在后端是不同的 operation_code，可用性也各自独立。
              // 只说一句「暂无可用模型」，用户会以为是素材或连线出了问题。
              emptyLabel={emptyModelLabel}
              onChange={(value) => {
                if (!taskRunning) onModelChange?.(value)
              }}
            />
          )}

          {kind === 'video' && onOpenRealPersonLibrary && (
            <button
              type="button"
              className={styles.polishBtn}
              onClick={onOpenRealPersonLibrary}
              disabled={taskRunning}
              title="打开真人素材库并选择真人素材"
            >
              真人素材库
            </button>
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
          disabled={
            taskRunning ||
            (kind === 'text' ? !prompt.trim() : !selectedModel || !operationCode || Boolean(inputValidationError))
          }
          // 按钮灰着时必须说明是被什么挡住的：缺模型和缺提示词是两回事，
          // 只写「发送生成」等于让用户对着一个点不动的按钮自己猜
          title={
            taskRunning
              ? '生成过程中不能修改，请添加新的节点使用其他模型'
              : kind === 'text'
                ? '保存提示词'
                : !selectedModel
                  ? emptyModelLabel || '暂无可用模型，请先在上方选择模型'
                  : inputValidationError || '发送生成'
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
  emptyLabel,
  onChange,
}: {
  models: GenerationModelOption[]
  value?: number
  loading?: boolean
  disabled?: boolean
  /** 没有可用模型时的说明，用于区分「目录还没加载出来」和「这个操作没有可用模型」。 */
  emptyLabel?: string
  onChange?: (modelVersionId: number) => void
}) {
  const [open, setOpen] = useState(false)
  const availableModels = models.filter((m) => !m.unavailableReason)
  /**
   * 目录里有、但当前用不了的模型（未开通会员、余额不足、套餐不含等）。
   *
   * 这些模型原来被直接滤掉，控件只剩一句「暂无可用模型」且连点都点不开——
   * 后端明明给了 unavailableReason，用户却看不到，只能以为是素材或连线出了毛病。
   * 有原因就把原因显示出来，让人知道下一步该做什么。
   */
  const blockedModels = models.filter((m) => m.unavailableReason)
  const blockedReason = String(blockedModels[0]?.unavailableReason || '')
  const selected =
    availableModels.find((m) => m.modelVersionId === value) || (availableModels.length ? availableModels[0] : undefined)
  const display = loading
    ? '加载中...'
    : selected?.displayName || (blockedModels.length ? '模型暂不可用' : emptyLabel || '暂无可用模型')
  // 有被挡住的模型时仍然允许展开：列表里逐条写明为什么用不了
  const canOpen = !disabled && (availableModels.length > 0 || blockedModels.length > 0)

  return (
    <div className={styles.selectorWrap}>
      <button
        className={`${styles.selector} ${canOpen ? '' : styles.selectorDisabled}`}
        title={selected ? undefined : blockedReason || emptyLabel || undefined}
        onClick={() => {
          if (!canOpen) return
          setOpen((v) => !v)
        }}
      >
        {display}
      </button>
      {open && canOpen && (
        <SelectorPopover open={open} onClose={() => setOpen(false)}>
          {/* 可用的排在前面：被锁住的混在中间会让人以为列表到此为止 */}
          {availableModels.map((m) => (
            <ModelOptionRow
              key={m.modelVersionId}
              model={m}
              selected={m.modelVersionId === (selected?.modelVersionId ?? value)}
              onSelect={() => {
                onChange?.(m.modelVersionId)
                setOpen(false)
              }}
            />
          ))}
          {blockedModels.map((m) => (
            <ModelOptionRow key={m.modelVersionId} model={m} blockedReason={String(m.unavailableReason)} />
          ))}
        </SelectorPopover>
      )}
    </div>
  )
}

/**
 * 模型列表里的一行。
 *
 * 一行承载四类信息：厂商标记 + 模型名（可带 NEW）、特点标签、耗时、单价。
 * 这些全部来自后端记录，读不到的就不渲染——宁可这一行只有名字，
 * 也不能凭前端猜一个「高质量」出来，用户会照着它做选择。
 *
 * 不可用的模型同样走这一行：右侧换成锁标记，原因写在下方。
 * 锁给出「点不了」的瞬时信号，文字回答「为什么、下一步做什么」，两者缺一不可。
 */
function ModelOptionRow({
  model,
  selected,
  blockedReason,
  onSelect,
}: {
  model: GenerationModelOption
  selected?: boolean
  blockedReason?: string
  onSelect?: () => void
}) {
  const info = readModelPresentation(model)
  const initial = readModelInitial(model.displayName, info.provider)
  const hue = readModelAccentHue(model.displayName)
  const blocked = Boolean(blockedReason)
  /*
   * 图标优先用后端给的 logo；加载失败再退回首字母。
   * 不做失败回退的话，链接一坏这一列就全是碎图占位——比没有图标更糟。
   */
  const [logoFailed, setLogoFailed] = useState(false)
  const showLogo = Boolean(info.logo) && !logoFailed
  /*
   * 模型的时长上限，直接展示在模型名下方。
   * 不展示的话，用户只能先选中模型、再去时长档位条里看还剩哪几档，选错了还得退回来重选——
   * 「我要的秒数它做不做得到」应当在选之前就看得见。
   * 只报上限：模型是 1 秒起、到上限为止，逐档列出反而会把可选范围说窄。
   */
  const durationSupport = getModelDurationLimitLabel(buildModelRestrictionSummary(model.source).constraints)

  const content = (
    <>
      <span className={styles.modelRowHead}>
        {showLogo ? (
          <img
            className={styles.modelRowLogo}
            src={info.logo}
            alt=""
            title={info.provider || undefined}
            loading="lazy"
            onError={() => setLogoFailed(true)}
          />
        ) : (
          initial && (
            <span
              className={styles.modelRowAvatar}
              // 厂商名放在 title 里：标记本身取的是模型名首字，厂商信息不该因此丢失
              title={info.provider || undefined}
              aria-hidden="true"
              style={
                blocked
                  ? undefined
                  : {
                      // 同一模型每次打开都是同一个颜色（按名称哈希，不用随机值）
                      background: `hsl(${hue} 62% 94%)`,
                      color: `hsl(${hue} 46% 38%)`,
                    }
              }
            >
              {initial}
            </span>
          )
        )}
        <span className={styles.modelRowName}>{model.displayName}</span>
        {info.isNew && !blocked && <span className={styles.modelRowNew}>NEW</span>}
        {blocked ? (
          <LockIcon />
        ) : selected ? (
          <span className={styles.modelRowCheck} aria-hidden="true">
            ✓
          </span>
        ) : null}
      </span>
      {(durationSupport || info.tags.length > 0 || info.durationLabel || info.priceLabel) && (
        <span className={styles.modelRowMeta}>
          {/* 支持的秒数排在最前：选视频模型时这是最先要判断的一项 */}
          {durationSupport && (
            <span className={`${styles.modelRowTag} ${styles.modelRowTagDuration}`}>{durationSupport}</span>
          )}
          {info.tags.map((tag) => (
            <span key={tag} className={styles.modelRowTag}>
              {tag}
            </span>
          ))}
          {info.durationLabel && <span className={styles.modelRowTag}>{info.durationLabel}</span>}
          {info.priceLabel && <span className={styles.modelRowTag}>{info.priceLabel}</span>}
        </span>
      )}
      {blocked && <em className={styles.modelRowReason}>{blockedReason}</em>}
    </>
  )

  if (blocked) {
    return (
      <span className={`${styles.modelRow} ${styles.modelRowBlocked}`} title={blockedReason}>
        {content}
      </span>
    )
  }

  return (
    <button
      type="button"
      role="option"
      aria-selected={Boolean(selected)}
      className={`${styles.modelRow} ${selected ? styles.modelRowActive : ''}`}
      onClick={onSelect}
    >
      {content}
    </button>
  )
}

/** 不可用模型的锁标记。 */
function LockIcon() {
  return (
    <svg className={styles.modelRowLock} viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5.8 7V5.4a2.2 2.2 0 0 1 4.4 0V7" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
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
                ) : isDurationField(f) && durationWheelOptions(f).length ? (
                  /* 时长：横向档位条吸附选择，与智能成片、爆款复制的时长交互一致 */
                  <WheelPicker
                    options={durationWheelOptions(f)}
                    value={String(current ?? '')}
                    onChange={(picked) => onFieldChange?.(f.name, resolveDurationWheelValue(f, picked))}
                    ariaLabel={f.displayName}
                    // 画布参数菜单比入口浮层窄，档位相应收窄一档宽度
                    visibleCount={5}
                    itemWidth={56}
                    className={styles.durationWheel}
                  />
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

/**
 * 来源缩略图。
 *
 * 视频来源的 thumbnailUrl 是 mp4 地址，塞进 <img> 只会得到一个碎图图标（这正是面板里
 * 出现两个「video」碎图的原因）。优先用封面帧；没有封面就用 <video> 取首帧
 * （#t=0.1 让浏览器 seek 到该位置并渲染出画面，否则可能只是一块黑底）；都没有才回落图标。
 */
function RefThumbMedia({ sourceRef, label }: { sourceRef: CanvasSourceRef; label: string }) {
  const isVideo = sourceRef.kind === 'video'

  if (sourceRef.posterUrl) {
    return <img className={styles.refThumbImg} src={sourceRef.posterUrl} alt={label} />
  }
  if (sourceRef.thumbnailUrl) {
    return isVideo ? (
      <video
        className={styles.refThumbImg}
        src={`${sourceRef.thumbnailUrl}#t=0.1`}
        muted
        playsInline
        preload="metadata"
        aria-label={label}
      />
    ) : (
      <img className={styles.refThumbImg} src={sourceRef.thumbnailUrl} alt={label} />
    )
  }
  if (sourceRef.kind === 'image') return <ImageRefIcon />
  if (sourceRef.kind === 'text') return <TextRefIcon />
  return <VideoRefIcon />
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
