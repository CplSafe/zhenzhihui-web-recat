/**
 * 智能成片 — 生成视频:把「所有分镜图 + 脚本 + 台词(旁白) + 字幕 + 音效 + 总时长」
 * 一次性喂给 seedance 出**整片**(对齐 2.0 useVideoGeneration,不是逐镜一段)。
 * 输入参考始终用当前分镜图,确保每次生成都基于最新镜头编排;修改意见只拼进 prompt,不复用旧视频。
 */
// @ts-nocheck
import { createAiTask, waitForAiTask, getAiTaskId, resolveTaskModel, estimateAiTaskCost } from './business'
import { buildVideoGenerationParams } from '@/utils/videoTasks'
import { getModelParamFields } from '@/utils/modelSchema'
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

/** 确认候选模型显式声明了 video.edit 操作。 */
function isVideoEditModel(model: any): boolean {
  return Array.isArray(model?.operation_codes) && model.operation_codes.includes('video.edit')
}

/** 按工作空间和套餐解析可用的 happyhorse 视频编辑模型。 */
async function resolveVideoEditModel(args: { workspaceId: number; modelPlanCandidates?: string[] }): Promise<any> {
  const model = await resolveTaskModel({
    workspaceId: args.workspaceId,
    capability: 'video',
    operationCode: 'video.edit',
    preferredModelKeywords: VIDEO_EDIT_MODEL_KEYWORDS,
    modelPlanCandidates: args.modelPlanCandidates,
  })
  if (!model?.id || !isVideoEditModel(model)) throw new Error(VIDEO_EDIT_MODEL_UNAVAILABLE)
  return model
}

/**
 * video.edit 只下发模型 schema 明确声明的参数。
 * 某些编辑模型会在服务端应用最低计费时长，但 schema 不接受 duration/source_video_duration；
 * 向 provider 强塞未声明字段反而会导致任务失败。
 */
function buildVideoEditParams(
  model: any,
  args: { ratio?: string; durationSec?: number; sourceVideoDurationSec?: number },
): Record<string, any> {
  const fields = getModelParamFields(model)
  if (!fields.length) return {}
  const declaredNames = new Set(fields.map((field: any) => String(field?.name || '')).filter(Boolean))
  const candidates = buildVideoGenerationParams(model, {
    duration: args.durationSec,
    durationMode: 'exact',
    sourceVideoDuration: args.sourceVideoDurationSec,
    resolution: '720p',
    ratio: normalizeSeedanceRatio(args.ratio || '9:16'),
    generateAudio: true,
  })
  return Object.fromEntries(Object.entries(candidates).filter(([name]) => declaredNames.has(name)))
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
async function resolveFullVideoModel(args: { workspaceId: number }): Promise<any> {
  const model = await resolveTaskModel({
    workspaceId: args.workspaceId,
    capability: 'video',
    operationCode: 'video.generate',
    preferredModelKeywords: VIDEO_MODEL_KEYWORDS,
  })
  if (!model?.id) throw new Error('暂无可用的视频生成模型(seedance)')
  return model
}

/** 用与正式提交一致的镜头总时长、比例和分辨率构建生成参数。 */
function buildFullVideoParams(model: any, args: { shots: any[]; ratio?: string }): Record<string, any> {
  const duration = totalDurationSec(args.shots)
  const durationValidation = validateSmartVideoDuration(duration)
  if (!durationValidation.valid) {
    throw new Error('智能成片总时长必须是 1 至 15 秒内的整数')
  }
  return {
    generate_audio: true,
    ...buildVideoGenerationParams(model, {
      duration: durationValidation.seconds,
      durationMode: 'exact',
      resolution: '720p',
      ratio: normalizeSeedanceRatio(args.ratio || '16:9'),
      generateAudio: true,
    }),
  }
}

/** 时间线脚本提示词:逐段对齐 画面/旁白/字幕/音效(端口自 2.0 buildVideoPromptFromTimeline)。 */
export function buildTimelinePrompt(args: {
  shots: any[]
  basePrompt?: string
  ratio?: string
  style?: string
}): string {
  const lines = ['请按照下面的时间线生成一条短视频广告,逐段对齐画面、旁白、字幕、音效。']
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
  style?: string
  /** 所有分镜图的 asset_id(按镜头顺序;全部作为图生视频的参考帧) */
  imageAssetIds?: number[]
  /** 对整片的修改意见 */
  note?: string
  /** 多个视频生成时的变体序号(仅用于避免同 prompt 结果完全重复) */
  variationIndex?: number
  variationTotal?: number
  modelPlanCandidates?: string[]
  idempotencyKey?: string
  /** 任务一创建就回调 task_id,供上层持久化(切路由/刷新后凭它续轮询,不重新生成) */
  onTask?: (taskId: number) => void
  /** 后端任务返回的真实进度；后端未提供进度时不回调。 */
  onProgress?: (progress: number) => void
}): Promise<{ url: string; assetId: number }> {
  const prompt =
    buildTimelinePrompt({ shots: args.shots, basePrompt: args.basePrompt, ratio: args.ratio, style: args.style }) +
    (args.note ? `\n额外修改要求:${args.note}` : '') +
    (args.variationTotal && args.variationTotal > 1
      ? `\n变体要求:这是同一需求下的第 ${args.variationIndex || 1}/${args.variationTotal} 个不同版本。请保持脚本主线一致，但在构图、镜头运动、人物状态、细节节奏上给出明显不同的创意变体，避免与其他版本完全相同。`
      : '')
  // 每个参与镜头必须按顺序对应一张已落库参考图；禁止静默过滤后拿错位/少图输入创建计费任务。
  const imgIds = requireOrderedShotAssetIds(args.shots || [], args.imageAssetIds || [])

  // 输入参考:始终把「全部当前分镜图」按镜头顺序作参考帧送入(干净格式 {asset_id, role:'image'},
  // 不加非标准字段)。即便带修改意见也不复用上次整片,确保每次都基于最新镜头编排重新出片。
  const inputAssets = imgIds.map((id) => ({ asset_id: id, role: 'image' }))

  // 钉死 seedance,不做跨模型退避:先显式解析 seedance 模型,再用 modelVersionId 提交。
  // 这样 createAiTask 走「显式模型」分支(无「换下一个模型」循环),seedance 失败直接抛错由用户决定。
  const model = await resolveFullVideoModel(args)
  const task = await createAiTask({
    workspaceId: args.workspaceId,
    capability: 'video',
    operationCode: 'video.generate',
    modelVersionId: model.id,
    modelVersion: model,
    prompt,
    inputAssets,
    idempotencyKey: args.idempotencyKey,
    params: buildFullVideoParams(model, args),
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
  durationSec?: number
  /** 源视频真实时长(秒):video.edit 按它计费(优先于 duration),前端读源视频 HTML5 元数据得到 */
  sourceVideoDurationSec?: number
  modelPlanCandidates?: string[]
  idempotencyKey?: string
  /** 任务创建后回调 task_id(供前端持久化、刷新/切换后续轮询) */
  onTask?: (taskId: number) => void
  /** 后端任务返回的真实进度；后端未提供进度时不回调。 */
  onProgress?: (progress: number) => void
}): Promise<{ url: string; assetId: number }> {
  const inputAssets = [{ asset_id: args.videoAssetId, role: 'video' }]
  const model = await resolveVideoEditModel(args)
  const task = await createAiTask({
    workspaceId: args.workspaceId,
    capability: 'video',
    operationCode: 'video.edit',
    // 提交和 estimate-cost 共用同一个显式模型，避免“预估模型 A、实际提交模型 B”。
    modelVersionId: model.id,
    modelVersion: model,
    idempotencyKey: args.idempotencyKey,
    prompt: args.prompt || '在保留原视频镜头内容、顺序与节奏的前提下,按要求微调画面(只改提到的部分,其余保持不变)。',
    inputAssets,
    params: buildVideoEditParams(model, args),
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
  durationSec?: number
  sourceVideoDurationSec?: number
  modelPlanCandidates?: string[]
}): Promise<any> {
  const model = await resolveVideoEditModel(args)
  return estimateAiTaskCost({
    workspaceId: args.workspaceId,
    modelVersionId: model.id,
    operationCode: 'video.edit',
    prompt: args.prompt || '',
    params: buildVideoEditParams(model, args),
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
  modelPlanCandidates?: string[]
}): Promise<any> {
  const model = await resolveFullVideoModel(args)
  const params = buildFullVideoParams(model, args)
  return estimateAiTaskCost({
    workspaceId: args.workspaceId,
    modelVersionId: model.id,
    operationCode: 'video.generate',
    params,
  })
}
