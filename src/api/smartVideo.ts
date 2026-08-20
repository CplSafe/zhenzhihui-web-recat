/**
 * 智能成片 — 生成视频:把「所有分镜图 + 脚本 + 台词(旁白) + 字幕 + 音效 + 总时长」
 * 一次性喂给用户选择的视频模型出**整片**(未选择时兼容回退 Seedance；不是逐镜一段)。
 * 输入参考始终用当前分镜图,确保每次生成都基于最新镜头编排;修改意见只拼进 prompt,不复用旧视频。
 */
// @ts-nocheck
import { createAiTask, waitForAiTask, getAiTaskId, resolveTaskModel, estimateAiTaskCost } from './business'
import { buildVideoGenerationParams } from '@/utils/videoTasks'
import {
  findModelParamField,
  getModelParamFields,
  getModelParamOptionValues,
  normalizeModelParamName,
} from '@/utils/modelSchema'
import { getBackendGenerationModelVersionId } from '@/utils/generationModelCatalog'
import { resolveModelInputAssetRole } from '@/utils/modelInputAssetRole'
import { buildModelRestrictionSummary, getModelConstraintConflicts } from '@/utils/modelRestrictions'
import { normalizeSeedanceRatio } from '@/utils/videoOptions'
import { parseDurationSeconds, validateSmartVideoDuration } from '@/utils/videoDurationValue'
import { resolveTaskVideoResult } from '@/utils/taskMedia'
import { readAiTaskProgress } from '@/utils/taskProgress'
import { requireOrderedShotAssetIds } from '@/utils/smartGenerationGuards'

/** 整片生成与视频编辑的首选模型关键词。 */
const VIDEO_MODEL_KEYWORDS = ['seedance']
// 视频编辑能力:在原视频基础上按提示微调(happyhorse-1.0-video-edit)
const VIDEO_EDIT_MODEL_KEYWORDS = ['happyhorse']
/** 工作空间未开通 video.edit 能力时的统一错误文案。 */
const VIDEO_EDIT_MODEL_UNAVAILABLE =
  '当前工作空间/套餐暂无「视频编辑(video.edit)」可用模型(happyhorse-1.0-video-edit),请联系管理员开通'
/** 视频修改未填写提示词时，估价和正式提交共同使用的默认要求。 */
const DEFAULT_VIDEO_EDIT_PROMPT =
  '在保留原视频镜头内容、顺序与节奏的前提下,按要求微调画面(只改提到的部分,其余保持不变)。'

/** 归一化页面显式选择的模型；ID 与详情不一致时直接拦截，避免估价和提交串用模型。 */
function getExplicitVideoModel(args: { modelVersionId?: number; modelVersion?: any }): {
  id: number
  model: any
} | null {
  const model = args.modelVersion && typeof args.modelVersion === 'object' ? args.modelVersion : null
  const hasExplicitSelection = args.modelVersionId !== undefined || model !== null
  if (!hasExplicitSelection) return null

  const detailId = getBackendGenerationModelVersionId(model) || 0
  const requestedId = Number(args.modelVersionId !== undefined ? args.modelVersionId : detailId)
  if (!Number.isSafeInteger(requestedId) || requestedId <= 0) {
    throw new Error('已选择的视频模型无效，请重新选择')
  }

  if (detailId > 0 && detailId !== requestedId) {
    throw new Error('已选择的视频模型 ID 与模型详情不一致，请重新选择')
  }
  return {
    id: requestedId,
    model: model ? { ...model, id: requestedId } : { id: requestedId },
  }
}

/** 将 schema 中的布尔值选项归一化，避免把字符串 "false" 当成 true。 */
function readBooleanOption(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (
    value === 1 ||
    String(value ?? '')
      .trim()
      .toLocaleLowerCase() === 'true'
  )
    return true
  if (
    value === 0 ||
    String(value ?? '')
      .trim()
      .toLocaleLowerCase() === 'false'
  )
    return false
  return null
}

/**
 * 保留原有“支持时生成音频”的效果；模型显式只允许 false 时自动关闭。
 * schema 未声明音频字段时仍传 true 给通用构建器，由构建器负责省略未声明参数。
 */
function shouldGenerateAudio(model: any): boolean {
  const field = findModelParamField(getModelParamFields(model), [
    'generate_audio',
    'generateAudio',
    'audio',
    'with_audio',
    'withAudio',
    'enable_audio',
    'enableAudio',
  ])
  if (!field) return true
  const options = getModelParamOptionValues(field)
    .map(readBooleanOption)
    .filter((value): value is boolean => value !== null)
  if (!options.length || options.includes(true)) return true
  return false
}

/** 确认候选模型显式声明了 video.edit 操作。 */
function isVideoEditModel(model: any): boolean {
  return Array.isArray(model?.operation_codes) && model.operation_codes.includes('video.edit')
}

/** 按工作空间和套餐解析可用的 happyhorse 视频编辑模型。 */
async function resolveVideoEditModel(args: {
  workspaceId: number
  modelVersionId?: number
  modelVersion?: any
  modelPlanCandidates?: string[]
}): Promise<any> {
  const explicitModel = getExplicitVideoModel(args)
  if (explicitModel) {
    const operations = explicitModel.model?.operation_codes
    if (Array.isArray(operations) && operations.length && !operations.includes('video.edit')) {
      throw new Error('已选择的模型不支持视频修改(video.edit)')
    }
    return explicitModel.model
  }

  const model = await resolveTaskModel({
    workspaceId: args.workspaceId,
    capability: 'video',
    operationCode: 'video.edit',
    preferredModelKeywords: VIDEO_EDIT_MODEL_KEYWORDS,
    modelPlanCandidates: args.modelPlanCandidates,
  })
  const modelVersionId = getBackendGenerationModelVersionId(model)
  if (!modelVersionId || !isVideoEditModel(model)) throw new Error(VIDEO_EDIT_MODEL_UNAVAILABLE)
  return model?.id === modelVersionId ? model : { ...model, id: modelVersionId }
}

/**
 * video.edit 只下发模型 schema 明确声明的参数。
 * 某些编辑模型会在服务端应用最低计费时长，但 schema 不接受 duration/source_video_duration；
 * 向 provider 强塞未声明字段反而会导致任务失败。
 */
function buildVideoEditParams(
  model: any,
  args: { ratio?: string; durationSec?: number; sourceVideoDurationSec?: number; resolution?: string },
): Record<string, any> {
  const fields = getModelParamFields(model)
  if (!fields.length) return {}
  const declaredNames = new Set(fields.map((field: any) => String(field?.name || '')).filter(Boolean))
  const candidates = buildVideoGenerationParams(model, {
    duration: args.durationSec,
    durationMode: 'exact',
    sourceVideoDuration: args.sourceVideoDurationSec,
    // 用户在入口选择的分辨率；未选择时留空，由模型 schema 选 720p 或其首个支持值。
    resolution: String(args.resolution || '').trim(),
    ratio: normalizeSeedanceRatio(args.ratio || '9:16'),
    generateAudio: shouldGenerateAudio(model),
  })
  return Object.fromEntries(Object.entries(candidates).filter(([name]) => declaredNames.has(name)))
}

export interface VideoEditModelRequestCompilation {
  modelVersionId: number
  modelVersion: any
  prompt: string
  params: Record<string, any>
}

/**
 * 将视频修改模型和当前输入编译为估价、提交共用的请求快照。
 * 纯函数不会请求接口或创建任务，可在用户确认修改前提前校验模型配置。
 */
export function compileVideoEditModelRequest(
  model: any,
  args: {
    prompt?: string
    ratio?: string
    durationSec?: number
    sourceVideoDurationSec?: number
    resolution?: string
  },
): VideoEditModelRequestCompilation {
  const modelVersionId = getBackendGenerationModelVersionId(model)
  if (!modelVersionId) throw new Error('已选择的视频修改模型无效，请重新选择')
  const operations = model?.operation_codes
  if (Array.isArray(operations) && operations.length && !operations.includes('video.edit')) {
    throw new Error('已选择的模型不支持视频修改(video.edit)')
  }
  return {
    modelVersionId,
    modelVersion: model?.id === modelVersionId ? model : { ...model, id: modelVersionId },
    prompt: String(args.prompt || '').trim() || DEFAULT_VIDEO_EDIT_PROMPT,
    params: buildVideoEditParams(model, args),
  }
}

/** 将单镜头时长归一化为秒，缺失时按 5 秒处理。 */
const shotDurSec = (s: any): number => {
  return parseDurationSeconds(s?.duration) ?? 5
}

/** 计算所有参与成片的镜头总时长。 */
export function totalDurationSec(shots: any[]): number {
  return (shots || []).filter((shot) => shot?.includeInVideo !== false).reduce((a, s) => a + shotDurSec(s), 0)
}

/** 解析当前工作空间可用的 Seedance 整片生成模型。 */
async function resolveFullVideoModel(args: {
  workspaceId: number
  modelVersionId?: number
  modelVersion?: any
}): Promise<any> {
  const explicitModel = getExplicitVideoModel(args)
  if (explicitModel) {
    const operations = explicitModel.model?.operation_codes
    if (Array.isArray(operations) && operations.length && !operations.includes('video.generate')) {
      throw new Error('已选择的模型不支持视频生成(video.generate)')
    }
    return explicitModel.model
  }

  const model = await resolveTaskModel({
    workspaceId: args.workspaceId,
    capability: 'video',
    operationCode: 'video.generate',
    preferredModelKeywords: VIDEO_MODEL_KEYWORDS,
  })
  const modelVersionId = getBackendGenerationModelVersionId(model)
  if (!modelVersionId) throw new Error('暂无可用的视频生成模型(seedance)')
  return { ...model, id: modelVersionId }
}

/** 「以一条已有视频为输入」时使用的角色，与 video.edit 下发的角色保持一致。 */
export const SOURCE_VIDEO_INPUT_ROLE = 'video'

/**
 * 组装整片生成的 input_assets。
 *
 * 分镜图按模型 schema 声明的角色下发；「视频生视频」再追加一条源视频。
 * 两者角色不同，不能像早期实现那样把所有输入套用同一个 role——
 * 源视频套上 image 角色，后端会按 INPUT_ASSET_ROLE_NOT_ALLOWED 拒绝，或者更糟：当成参考图去读。
 */
export function buildFullVideoInputAssets(args: {
  imageAssetIds?: number[]
  imageRole?: string
  /** 源视频资产 ID；大于 0 时以 role:'video' 追加在图片之后。 */
  sourceVideoAssetId?: number
  /**
   * 多条参考视频的资产 ID（创作台支持最多 3 条）。
   * 与 sourceVideoAssetId 合并后按出现顺序去重，全部以 role:'video' 下发。
   */
  sourceVideoAssetIds?: number[]
}): Array<{ asset_id: number; role: string }> {
  const imageRole = String(args.imageRole || '').trim() || 'image'
  // 图片一律用同一个 role 下发：首尾帧与参考模式的区分走 params.reference_mode，
  // 由后端按数组顺序翻译成 first_frame / last_frame（见 volcengineImageRole）。
  const assets = (args.imageAssetIds || [])
    .map((id) => Math.floor(Number(id) || 0))
    .filter((id) => id > 0)
    .map((id) => ({ asset_id: id, role: imageRole }))

  // 单条与多条两个入口合并：老调用方继续传 sourceVideoAssetId，创作台传数组。
  const videoIds = [args.sourceVideoAssetId, ...(args.sourceVideoAssetIds || [])]
    .map((id) => Math.floor(Number(id) || 0))
    .filter((id) => id > 0)
  Array.from(new Set(videoIds)).forEach((id) => assets.push({ asset_id: id, role: SOURCE_VIDEO_INPUT_ROLE }))
  return assets
}

export interface FullVideoModelRequestCompilation {
  modelVersionId: number
  modelVersion: any
  params: Record<string, any>
  inputAssetRole: string
  referenceImageCount: number
}

/**
 * 将所选视频模型和当前镜头编译为可估价、可提交的稳定请求参数。
 *
 * 这是纯函数，不请求接口也不创建任务；SmartCreateView 可在入队/扣费前调用它做同口径校验。
 */
export function compileFullVideoModelRequest(
  model: any,
  args: {
    shots: any[]
    ratio?: string
    referenceImageCount?: number
    resolution?: string
    /**
     * 用户显式选择的音频开关；省略时沿用「模型支持即开」的自动推导。
     * 模型 schema 明确不允许开启时，这里传 true 也会被 shouldGenerateAudio 的结果否决。
     */
    generateAudio?: boolean
    /**
     * 参考模式（params.reference_mode）：false=首尾帧，true=参考图仅提供主体/风格。
     * 仅在模型 schema 声明了该字段时下发；省略时沿用 schema 默认值。
     */
    referenceMode?: boolean
  },
): FullVideoModelRequestCompilation {
  const modelVersionId = getBackendGenerationModelVersionId(model)
  if (!modelVersionId) throw new Error('已选择的视频模型无效，请重新选择')
  const operations = model?.operation_codes
  if (Array.isArray(operations) && operations.length && !operations.includes('video.generate')) {
    throw new Error('已选择的模型不支持视频生成(video.generate)')
  }

  const constraints = buildModelRestrictionSummary(model).constraints
  const duration = totalDurationSec(args.shots)
  const durationSeconds = parseDurationSeconds(duration)
  if (durationSeconds === null) {
    throw new Error('智能成片总时长无效，请调整分镜时长后重试')
  }
  // 时长以所选模型声明的档位为准：模型支持 30 秒时不能被前端的 1–15 秒挡下。
  // 仅当模型没有声明任何时长约束时，才回落到智能成片默认的 1–15 秒整数。
  if (constraints.duration) {
    const durationConflicts = getModelConstraintConflicts(constraints, { durationSec: durationSeconds })
    if (durationConflicts.length) {
      throw new Error(`所选视频模型不支持当前总时长：${durationConflicts[0]}`)
    }
  } else if (!validateSmartVideoDuration(durationSeconds).valid) {
    throw new Error('智能成片总时长必须是 1 至 15 秒内的整数')
  }

  const referenceImageCount =
    args.referenceImageCount === undefined
      ? (args.shots || []).filter((shot) => shot?.includeInVideo !== false).length
      : Number(args.referenceImageCount)
  if (!Number.isSafeInteger(referenceImageCount) || referenceImageCount < 0) {
    throw new Error('参考图数量无效，请重新准备分镜素材')
  }

  const referenceImageConflicts = getModelConstraintConflicts(constraints, {
    referenceImageCount,
  })
  if (referenceImageConflicts.length) {
    throw new Error(`所选视频模型不支持当前参考图：${referenceImageConflicts[0]}`)
  }

  // 模型是否允许开声是硬约束；用户开关只能在允许范围内关小，不能强行打开。
  const modelAllowsAudio = shouldGenerateAudio(model)
  const generateAudio = args.generateAudio === undefined ? modelAllowsAudio : args.generateAudio && modelAllowsAudio
  const params = buildVideoGenerationParams(model, {
    duration: durationSeconds,
    durationMode: 'exact',
    validateExactDuration: true,
    // 用户在入口选择的分辨率；未提供时让 schema 决定默认值，无 schema 的旧模型仍由通用构建器回退 720p。
    resolution: String(args.resolution || '').trim(),
    ratio: normalizeSeedanceRatio(args.ratio || '16:9'),
    generateAudio,
  })
  // reference_mode 不属于通用视频参数构建器的字段，按模型 schema 的真实字段名追加。
  // 未声明该字段的模型（如 kling / minimax 各有自己的模式开关）不下发，避免塞入未知参数。
  if (args.referenceMode !== undefined) {
    const referenceField = findModelParamField(getModelParamFields(model), ['reference_mode', 'referenceMode'])
    if (referenceField?.name) params[referenceField.name] = args.referenceMode
  }
  return {
    modelVersionId,
    modelVersion: model?.id === modelVersionId ? model : { ...model, id: modelVersionId },
    params,
    inputAssetRole: resolveModelInputAssetRole(model),
    referenceImageCount,
  }
}

/** 时间线脚本提示词:逐段对齐 画面/旁白/字幕/音效(端口自 2.0 buildVideoPromptFromTimeline)。 */
export function buildTimelinePrompt(args: {
  shots: any[]
  basePrompt?: string
  ratio?: string
  style?: string
  /** 真人成片的出镜身份约束正文；置于提示词最前，优先级高于时间线与广告描述。 */
  identityConstraint?: string
}): string {
  const lines: string[] = []
  const identityConstraint = String(args.identityConstraint || '').trim()
  if (identityConstraint) lines.push(identityConstraint)
  lines.push('请按照下面的时间线生成一条短视频广告,逐段对齐画面、旁白、字幕、音效。')
  if (args.basePrompt) lines.push(`广告描述:${args.basePrompt}`)
  let t = 0
  ;(args.shots || []).forEach((s, i) => {
    const dur = shotDurSec(s)
    const start = t
    const end = t + dur
    t = end
    const frag = [`图${i + 1}（${start}-${end}s）:${s?.desc || s?.no || `分镜${i + 1}`}`]
    if (s?.line) frag.push(`旁白:「${s.line}」`)
    if (s?.subtitle) frag.push(`字幕:「${s.subtitle}」`)
    if (s?.sfx) frag.push(`音效:${s.sfx}`)
    lines.push(frag.join(';'))
  })
  if (t > 0) lines.push(`总时长:${t}s。`)
  if (args.ratio) lines.push(`画面比例:${args.ratio}。`)
  if (args.style) lines.push(`整体风格:${args.style}。`)
  // 通用物理合理性约束(避免违反物理规律/形变穿模等)
  lines.push(
    '硬性要求:画面必须符合真实物理规律——运动自然连贯,遵循重力、惯性与碰撞;' +
      '物体的形状、数量、比例、材质在镜头内保持稳定一致,不变形、不融化、不穿模、不凭空出现或消失;' +
      '人物与动物结构正常(四肢/手指数量正确、关节弯曲合理,不扭曲、不多肢);' +
      '镜头运动与光影自然平滑,避免瞬移、抖动、鬼影、画面撕裂或不合理的速度突变。',
  )
  return lines.filter(Boolean).join('\n')
}

/**
 * 使用当前全部分镜图和时间线提示创建整片任务，并轮询至成片可用。
 * 每个参与镜头必须有按顺序对应的 asset_id，防止错位参考图创建计费任务。
 */
export async function generateFullVideo(args: {
  workspaceId: number
  shots: any[]
  basePrompt?: string
  ratio?: string
  /** 用户在入口选择的出片分辨率；留空时由模型 schema 决定。 */
  resolution?: string
  style?: string
  /** 所有分镜图的 asset_id(按镜头顺序;全部作为图生视频的参考帧) */
  imageAssetIds?: number[]
  /** 对整片的修改意见 */
  note?: string
  /** 多个视频生成时的变体序号(仅用于避免同 prompt 结果完全重复) */
  variationIndex?: number
  variationTotal?: number
  /** 用户显式选择的视频生成模型版本 ID。 */
  modelVersionId?: number
  /** 与 modelVersionId 对应的后端模型详情，用于按该模型 schema 构建参数。 */
  modelVersion?: any
  modelPlanCandidates?: string[]
  idempotencyKey?: string
  /**
   * 真人成片的出镜身份约束正文（见 utils/smartRealPerson）。
   * 整片由分镜图驱动，身份主要靠参考帧继承，但运动生成过程仍可能漂；这里把约束显式写进提示词。
   */
  identityConstraint?: string
  /**
   * 「视频生视频」的源视频资产 ID：以 role:'video' 与分镜图一起下发。
   * 需要模型的 operation 角色白名单允许 video 输入，否则后端按 INPUT_ASSET_ROLE_NOT_ALLOWED 拒绝。
   */
  sourceVideoAssetId?: number
  /** 多条参考视频（创作台最多 3 条）；与 sourceVideoAssetId 合并后一起以 role:'video' 下发。 */
  sourceVideoAssetIds?: number[]
  /** 任务一创建就回调 task_id,供上层持久化(切路由/刷新后凭它续轮询,不重新生成) */
  onTask?: (taskId: number) => void
  /** 后端任务返回的真实进度；后端未提供进度时不回调。 */
  onProgress?: (progress: number) => void
  /**
   * 参考模式开关（params.reference_mode）：
   * false=首尾帧（第 1 张首帧、第 2 张尾帧），true=参考图仅提供主体/风格。
   * 省略时沿用模型 schema 的默认值。
   */
  referenceMode?: boolean
  /** 用户选择的音频开关；省略时沿用「模型支持即开」。 */
  generateAudio?: boolean
}): Promise<{ url: string; assetId: number }> {
  const prompt =
    buildTimelinePrompt({
      shots: args.shots,
      basePrompt: args.basePrompt,
      ratio: args.ratio,
      style: args.style,
      identityConstraint: args.identityConstraint,
    }) +
    (args.note ? `\n额外修改要求:${args.note}` : '') +
    (args.variationTotal && args.variationTotal > 1
      ? `\n变体要求:这是同一需求下的第 ${args.variationIndex || 1}/${args.variationTotal} 个不同版本。请保持脚本主线一致，但在构图、镜头运动、人物状态、细节节奏上给出明显不同的创意变体，避免与其他版本完全相同。`
      : '')
  // 每个参与镜头必须按顺序对应一张已落库参考图；禁止静默过滤后拿错位/少图输入创建计费任务。
  const imgIds = requireOrderedShotAssetIds(args.shots || [], args.imageAssetIds || [])

  // 已显式选择时使用页面传入模型；旧调用未选择时仍自动解析 Seedance，保持原生成链路兼容。
  // 两种路径都会让 createAiTask 走“显式模型”分支，不会在失败后静默切换模型。
  const model = await resolveFullVideoModel(args)
  const request = compileFullVideoModelRequest(model, {
    shots: args.shots,
    ratio: args.ratio,
    resolution: args.resolution,
    referenceImageCount: imgIds.length,
    generateAudio: args.generateAudio,
    referenceMode: args.referenceMode,
  })
  // schema 未声明时继续使用 role:'image'；显式声明唯一角色时按模型要求下发。
  // 传了源视频（视频生视频）时，它以 role:'video' 追加，不跟着分镜图共用同一个角色。
  const inputAssets = buildFullVideoInputAssets({
    imageAssetIds: imgIds,
    imageRole: request.inputAssetRole,
    sourceVideoAssetId: args.sourceVideoAssetId,
    sourceVideoAssetIds: args.sourceVideoAssetIds,
  })
  const task = await createAiTask({
    workspaceId: args.workspaceId,
    capability: 'video',
    operationCode: 'video.generate',
    modelVersionId: request.modelVersionId,
    modelVersion: request.modelVersion,
    prompt,
    inputAssets,
    idempotencyKey: args.idempotencyKey,
    params: request.params,
  })
  // 任务一创建就把 task_id 抛给上层持久化(中途切路由/刷新后可凭它续轮询,而非重新生成)
  const taskId = getAiTaskId(task)
  if (!taskId) throw new Error('视频生成任务创建后未返回任务 ID')
  args.onTask?.(taskId)
  const completed = await waitForAiTask({
    workspaceId: args.workspaceId,
    task,
    intervalMs: 4000,
    timeoutMs: 60 * 60 * 1000,
    onPoll: (currentTask: any) => {
      const progress = readAiTaskProgress(currentTask)
      if (progress !== undefined) args.onProgress?.(progress)
    },
  })
  return resolveVideoTaskResult(args.workspaceId, completed, getAiTaskId(completed) || taskId)
}

/** 将已完成任务解析为视频资产；入库尚未完成时抛出可续试的待就绪错误。 */
async function resolveVideoTaskResult(
  workspaceId: number,
  completed: any,
  fallbackTaskId: any,
  pendingMessage = '视频任务已完成，视频仍在入库，请稍后自动重试',
): Promise<{ url: string; assetId: number }> {
  try {
    const { url, assetId } = await resolveTaskVideoResult(workspaceId, completed, fallbackTaskId)
    if (url) return { url, assetId }
  } catch (cause) {
    const error: any = new Error(pendingMessage)
    error.code = 'TASK_MEDIA_PENDING'
    error.smartVideoTaskId = Number(fallbackTaskId || 0) || 0
    error.cause = cause
    throw error
  }
  const error: any = new Error(pendingMessage)
  error.code = 'TASK_MEDIA_PENDING'
  error.smartVideoTaskId = Number(fallbackTaskId || 0) || 0
  throw error
}

/**
 * 续接一个【已提交但前端中途离开】的整片生成任务:不重新建任务,只按 taskId 继续轮询到完成,
 * 解析出 { url, assetId }。用于切路由/刷新后恢复「生成中」的项目。
 */
export async function resumeFullVideo(args: {
  workspaceId: number
  taskId: number
  onProgress?: (progress: number) => void
}): Promise<{ url: string; assetId: number }> {
  const taskId = getAiTaskId({ id: args.taskId })
  if (!taskId) throw new Error('视频生成任务 ID 无效')
  const completed = await waitForAiTask({
    workspaceId: args.workspaceId,
    task: { id: taskId },
    intervalMs: 4000,
    timeoutMs: 60 * 60 * 1000,
    onPoll: (currentTask: any) => {
      const progress = readAiTaskProgress(currentTask)
      if (progress !== undefined) args.onProgress?.(progress)
    },
  })
  return resolveVideoTaskResult(args.workspaceId, completed, taskId)
}

/**
 * 视频编辑(「确认修改」):在已生成的整片基础上,按修改提示微调画面。
 * 走后端 video.edit 能力(模型 happyhorse-1.0-video-edit):
 * 源视频 role:video + 修改提示 prompt;不复用爆款复制(video.replicate)逻辑,也不从分镜图重出整片。
 * 返回 { url, assetId }(编辑后的视频)。
 */
export async function editFullVideo(args: {
  workspaceId: number
  /** 待编辑的源视频 asset_id(上一次生成的整片) */
  videoAssetId: number
  /** 修改提示 */
  prompt?: string
  ratio?: string
  /** 用户在入口选择的出片分辨率；留空时由模型 schema 决定。 */
  resolution?: string
  durationSec?: number
  /** 源视频真实时长(秒):video.edit 按它计费(优先于 duration),前端读源视频 HTML5 元数据得到 */
  sourceVideoDurationSec?: number
  /** 用户显式选择的视频修改模型版本 ID。 */
  modelVersionId?: number
  /** 与 modelVersionId 对应的后端模型详情，用于按该模型 schema 构建参数。 */
  modelVersion?: any
  modelPlanCandidates?: string[]
  idempotencyKey?: string
  /** 任务创建后回调 task_id(供前端持久化、刷新/切换后续轮询) */
  onTask?: (taskId: number) => void
  /** 后端任务返回的真实进度；后端未提供进度时不回调。 */
  onProgress?: (progress: number) => void
}): Promise<{ url: string; assetId: number }> {
  const inputAssets = [{ asset_id: args.videoAssetId, role: 'video' }]
  const model = await resolveVideoEditModel(args)
  const request = compileVideoEditModelRequest(model, args)
  const task = await createAiTask({
    workspaceId: args.workspaceId,
    capability: 'video',
    operationCode: 'video.edit',
    // 提交和 estimate-cost 共用同一个显式模型，避免“预估模型 A、实际提交模型 B”。
    modelVersionId: request.modelVersionId,
    modelVersion: request.modelVersion,
    idempotencyKey: args.idempotencyKey,
    prompt: request.prompt,
    inputAssets,
    params: request.params,
  })
  const taskId = getAiTaskId(task)
  args.onTask?.(taskId)
  const completed = await waitForAiTask({
    workspaceId: args.workspaceId,
    task,
    intervalMs: 4000,
    timeoutMs: 60 * 60 * 1000,
    onPoll: (currentTask: any) => {
      const progress = readAiTaskProgress(currentTask)
      if (progress !== undefined) args.onProgress?.(progress)
    },
  })
  return resolveVideoTaskResult(
    args.workspaceId,
    completed,
    getAiTaskId(completed) || taskId,
    '视频编辑已完成，视频仍在入库，请稍后自动重试',
  )
}

/**
 * 视频编辑(video.edit)提交前估价。后端返回的 estimated_cost 是唯一展示口径；
 * 当模型 schema 不声明时长时，不会向 provider 添加未知参数。
 */
export async function estimateVideoEditCost(args: {
  workspaceId: number
  prompt?: string
  ratio?: string
  /** 用户在入口选择的出片分辨率；必须与提交保持一致，保证「预估 = 实扣」。 */
  resolution?: string
  durationSec?: number
  sourceVideoDurationSec?: number
  /** 用户显式选择的视频修改模型版本 ID。 */
  modelVersionId?: number
  /** 与 modelVersionId 对应的后端模型详情，用于保持估价与提交参数一致。 */
  modelVersion?: any
  modelPlanCandidates?: string[]
}): Promise<any> {
  const model = await resolveVideoEditModel(args)
  const request = compileVideoEditModelRequest(model, args)
  return estimateAiTaskCost({
    workspaceId: args.workspaceId,
    modelVersionId: request.modelVersionId,
    operationCode: 'video.edit',
    prompt: request.prompt,
    params: request.params,
  })
}

// ── 提交前积分预估(POST /ai/tasks/estimate-cost) ──
// 估价用的 model / operation / params 必须与真正提交(generateFullVideo / editFullVideo)一致,
// 否则「预估 ≠ 实扣」。params 同样走 buildVideoGenerationParams 的 schema 门控。

/** 整片生成(video.generate,图生视频)预估积分。返回 estimate 结果(含 estimated_cost 等)。 */
export async function estimateFullVideoCost(args: {
  workspaceId: number
  shots: any[]
  ratio?: string
  /** 用户在入口选择的出片分辨率；必须与提交保持一致，保证「预估 = 实扣」。 */
  resolution?: string
  /** 用户显式选择的视频生成模型版本 ID。 */
  modelVersionId?: number
  /** 与 modelVersionId 对应的后端模型详情，用于保持估价与提交参数一致。 */
  modelVersion?: any
  modelPlanCandidates?: string[]
  /** 用户选择的音频开关；必须与提交一致，否则「预估 ≠ 实扣」。 */
  generateAudio?: boolean
  /** 参考模式；必须与提交一致，否则「预估 ≠ 实扣」。 */
  referenceMode?: boolean
}): Promise<any> {
  const model = await resolveFullVideoModel(args)
  const request = compileFullVideoModelRequest(model, {
    shots: args.shots,
    ratio: args.ratio,
    resolution: args.resolution,
    generateAudio: args.generateAudio,
    referenceMode: args.referenceMode,
  })
  return estimateAiTaskCost({
    workspaceId: args.workspaceId,
    modelVersionId: request.modelVersionId,
    operationCode: 'video.generate',
    params: request.params,
  })
}
