/**
 * 智能成片 — 生成视频:把「所有分镜图 + 脚本 + 台词(旁白) + 字幕 + 音效 + 总时长」
 * 一次性喂给 seedance 出**整片**(对齐 2.0 useVideoGeneration,不是逐镜一段)。
 * 参考图取第一张分镜图(seedance 只收一张);带修改意见时把上次生成的整片当 role:'video' 输入再生成。
 */
// @ts-nocheck
import { createAiTask, waitForAiTask, listAssets, extractAssetPageItems } from './business'
import { buildVideoGenerationParams } from '@/utils/videoTasks'
import { normalizeSeedanceRatio, normalizeSeedanceDuration } from '@/utils/videoOptions'
import { resolveGeneratedMediaUrls } from '@/utils/taskMedia'

// 目前线上只有 Seedance 2.0
const VIDEO_MODEL_KEYWORDS = ['seedance']
const extractVideoAssetId = (task: any): number =>
  Number(task?.outputs?.find?.((o: any) => o?.asset_id)?.asset_id || 0)

// outputs 没带 asset_id 时按 task_id 反查视频资产(否则刷新水合换不了URL → 视频丢失)
async function findVideoAssetIdByTaskId(workspaceId: number, taskId: any): Promise<number> {
  const tId = Number(taskId || 0)
  if (!workspaceId || !tId) return 0
  try {
    const payload = await listAssets({ workspaceId, type: 'video', limit: 100 })
    const hit = extractAssetPageItems(payload).find((a: any) => Number(a?.task_id) === tId)
    return Number(hit?.id || 0) || 0
  } catch {
    return 0
  }
}

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
  /** 上次生成的整片 asset_id(带修改意见重生成时用) */
  prevVideoAssetId?: number
  /** 对整片的修改意见 */
  note?: string
  modelPlanCandidates?: string[]
}): Promise<{ url: string; assetId: number }> {
  const prompt =
    buildTimelinePrompt({ shots: args.shots, basePrompt: args.basePrompt, ratio: args.ratio, style: args.style }) +
    (args.note ? `\n额外修改要求:${args.note}` : '')
  const imgIds = (args.imageAssetIds || []).filter((n) => Number(n) > 0)
  // seedance 图生视频只收「一张首帧」:多传会被后端判为非法参数,createAiTask 会把图全丢掉
  // → 退化成纯文生视频、和分镜差别巨大。故对齐 2.0:只取第一张分镜图作首帧,其余靠时间线提示词描述。
  // 带修改意见且有上次整片时,改用该视频作输入(role:'video')。
  const inputAssets =
    args.note && args.prevVideoAssetId
      ? [{ asset_id: args.prevVideoAssetId, role: 'video' }]
      : imgIds.length
        ? [{ asset_id: imgIds[0], role: 'image' }]
        : []
  const task = await createAiTask({
    workspaceId: args.workspaceId,
    capability: 'video',
    operationCode: 'video.generate',
    preferredModelKeywords: VIDEO_MODEL_KEYWORDS,
    ...(args.modelPlanCandidates?.length ? { modelPlanCandidates: args.modelPlanCandidates } : {}),
    prompt,
    inputAssets,
    params: (model: any) => ({
      // 强制带音频:部分模型 schema 没声明 audio 字段会被丢弃,这里兜底显式带上 generate_audio
      generate_audio: true,
      ...buildVideoGenerationParams(model, {
        duration: normalizeSeedanceDuration(totalDurationSec(args.shots) || 10),
        resolution: '720p',
        ratio: normalizeSeedanceRatio(args.ratio || '16:9'),
        generateAudio: true,
      }),
    }),
  })
  // 视频生成耗时长,放宽轮询超时(实际不会误触发;默认 120s 会把正常生成判成超时)
  const completed = await waitForAiTask({
    workspaceId: args.workspaceId,
    task,
    intervalMs: 4000,
    timeoutMs: 60 * 60 * 1000,
  })
  let assetId = extractVideoAssetId(completed)
  if (!assetId) assetId = await findVideoAssetIdByTaskId(args.workspaceId, completed?.id || (task as any)?.id)
  const [url] = await resolveGeneratedMediaUrls({ workspaceId: args.workspaceId, task: completed, type: 'video' })
  if (!url) throw new Error('视频任务已完成,暂未返回可预览地址')
  return { url, assetId }
}
