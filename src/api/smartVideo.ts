/**
 * 智能成片 — 生成视频:把「所有分镜图 + 脚本 + 台词(旁白) + 字幕 + 音效 + 总时长」
 * 一次性喂给 seedance 出**整片**(对齐 2.0 useVideoGeneration,不是逐镜一段)。
 * 输入参考始终用当前分镜图,确保每次生成都基于最新镜头编排;修改意见只拼进 prompt,不复用旧视频。
 */
// @ts-nocheck
import { createAiTask, waitForAiTask, getAssetDownloadUrl } from './business'
import { buildVideoGenerationParams } from '@/utils/videoTasks'
import { getModelParamFields } from '@/utils/modelSchema'
import { normalizeSeedanceRatio, normalizeSeedanceDuration } from '@/utils/videoOptions'
import { resolveGeneratedMediaUrls, findAssetIdByTaskId } from '@/utils/taskMedia'

// 目前线上只有 Seedance 2.0
const VIDEO_MODEL_KEYWORDS = ['seedance']
// 视频编辑能力:在原视频基础上按提示微调(happyhorse-1.0-video-edit)
const VIDEO_EDIT_MODEL_KEYWORDS = ['happyhorse']
const extractVideoAssetId = (task: any): number => Number(task?.outputs?.find?.((o: any) => o?.asset_id)?.asset_id || 0)

const shotDurSec = (s: any): number => {
  const n = parseInt(String(s?.duration || '').replace(/[^0-9]/g, ''), 10)
  return Number.isFinite(n) && n > 0 ? n : 5
}

export function totalDurationSec(shots: any[]): number {
  return (shots || []).reduce((a, s) => a + shotDurSec(s), 0)
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
  modelPlanCandidates?: string[]
  /** 任务一创建就回调 task_id,供上层持久化(切路由/刷新后凭它续轮询,不重新生成) */
  onTask?: (taskId: number) => void
}): Promise<{ url: string; assetId: number }> {
  const prompt =
    buildTimelinePrompt({ shots: args.shots, basePrompt: args.basePrompt, ratio: args.ratio, style: args.style }) +
    (args.note ? `\n额外修改要求:${args.note}` : '')
  const imgIds = (args.imageAssetIds || []).filter((n) => Number(n) > 0)

  // 输入参考:始终把「全部当前分镜图」按镜头顺序作参考帧送入(干净格式 {asset_id, role:'image'},
  // 不加非标准字段)。即便带修改意见也不复用上次整片,确保每次都基于最新镜头编排重新出片。
  const inputAssets = imgIds.map((id) => ({ asset_id: id, role: 'image' }))

  // 只跑一次,不做静默重试(视频模型很贵,失败直接抛错由用户决定)
  const task = await createAiTask({
    workspaceId: args.workspaceId,
    capability: 'video',
    operationCode: 'video.generate',
    preferredModelKeywords: VIDEO_MODEL_KEYWORDS,
    ...(args.modelPlanCandidates?.length ? { modelPlanCandidates: args.modelPlanCandidates } : {}),
    prompt,
    inputAssets,
    params: (model: any) => ({
      generate_audio: true, // 兜底:部分模型 schema 没声明 audio 字段会被丢弃 → 无声
      ...buildVideoGenerationParams(model, {
        duration: normalizeSeedanceDuration(totalDurationSec(args.shots) || 10),
        resolution: '720p',
        ratio: normalizeSeedanceRatio(args.ratio || '16:9'),
        generateAudio: true,
      }),
    }),
  })
  // 任务一创建就把 task_id 抛给上层持久化(中途切路由/刷新后可凭它续轮询,而非重新生成)
  args.onTask?.(Number((task as any)?.id) || 0)
  const completed = await waitForAiTask({
    workspaceId: args.workspaceId,
    task,
    intervalMs: 4000,
    timeoutMs: 60 * 60 * 1000,
  })
  return resolveVideoTaskResult(args.workspaceId, completed, (task as any)?.id)
}

// 把已完成的视频任务解析成 { url, assetId }(generate 与 resume 共用)
async function resolveVideoTaskResult(
  workspaceId: number,
  completed: any,
  fallbackTaskId: any,
): Promise<{ url: string; assetId: number }> {
  let assetId = extractVideoAssetId(completed)
  if (!assetId) assetId = await findAssetIdByTaskId(workspaceId, completed?.id || fallbackTaskId)
  const [url] = await resolveGeneratedMediaUrls({ workspaceId, task: completed, type: 'video' })
  if (!url) throw new Error('视频任务已完成,暂未返回可预览地址')
  return { url, assetId }
}

/**
 * 续接一个【已提交但前端中途离开】的整片生成任务:不重新建任务,只按 taskId 继续轮询到完成,
 * 解析出 { url, assetId }。用于切路由/刷新后恢复「生成中」的项目。
 */
export async function resumeFullVideo(args: {
  workspaceId: number
  taskId: number
}): Promise<{ url: string; assetId: number }> {
  const completed = await waitForAiTask({
    workspaceId: args.workspaceId,
    task: { id: args.taskId },
    intervalMs: 4000,
    timeoutMs: 60 * 60 * 1000,
  })
  return resolveVideoTaskResult(args.workspaceId, completed, args.taskId)
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
  modelPlanCandidates?: string[]
  /** 任务创建后回调 task_id(供前端持久化、刷新/切换后续轮询) */
  onTask?: (taskId: number) => void
}): Promise<{ url: string; assetId: number }> {
  const inputAssets = [{ asset_id: args.videoAssetId, role: 'video' }]
  const task = await createAiTask({
    workspaceId: args.workspaceId,
    capability: 'video',
    operationCode: 'video.edit',
    preferredModelKeywords: VIDEO_EDIT_MODEL_KEYWORDS,
    // 仅允许真正支持 video.edit 的模型(happyhorse-1.0-video-edit);
    // 否则后端会回退到任意视频模型 → 提交后 provider 直接失败。
    modelValidator: (model: any) =>
      Array.isArray(model?.operation_codes) && model.operation_codes.includes('video.edit')
        ? true
        : '当前工作空间/套餐暂无「视频编辑(video.edit)」可用模型(happyhorse-1.0-video-edit),请联系管理员开通',
    ...(args.modelPlanCandidates?.length ? { modelPlanCandidates: args.modelPlanCandidates } : {}),
    prompt: args.prompt || '在保留原视频镜头内容、顺序与节奏的前提下,按要求微调画面(只改提到的部分,其余保持不变)。',
    inputAssets,
    // 画面/时长主要由源视频决定:仅按模型 params_schema 填字段,无 schema 时不塞参数(否则 provider 报「参数有误」)。
    params: (model: any) => {
      const fields = getModelParamFields(model)
      if (!fields.length) return {}
      return buildVideoGenerationParams(model, {
        duration: normalizeSeedanceDuration(args.durationSec || 10),
        resolution: '720p',
        ratio: normalizeSeedanceRatio(args.ratio || '9:16'),
        generateAudio: true,
      })
    },
  })
  args.onTask?.(Number(task?.id || 0) || 0)
  const completed = await waitForAiTask({
    workspaceId: args.workspaceId,
    task,
    intervalMs: 4000,
    timeoutMs: 60 * 60 * 1000,
  })
  let assetId = extractVideoAssetId(completed)
  if (!assetId) assetId = await findAssetIdByTaskId(args.workspaceId, completed?.id || (task as any)?.id)
  let [url] = await resolveGeneratedMediaUrls({ workspaceId: args.workspaceId, task: completed, type: 'video' })
  if (!url && assetId) url = await getAssetDownloadUrl({ workspaceId: args.workspaceId, assetId }).catch(() => '')
  if (!url) throw new Error('视频编辑已完成,暂未返回可预览地址')
  return { url, assetId }
}
