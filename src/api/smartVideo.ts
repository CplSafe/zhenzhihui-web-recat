/**
 * 智能成片 — 生成视频:把「所有分镜图 + 脚本 + 台词(旁白) + 字幕 + 音效 + 总时长」
 * 一次性喂给 seedance 出**整片**(对齐 2.0 useVideoGeneration,不是逐镜一段)。
 * 参考图取第一张分镜图(seedance 只收一张);带修改意见时把上次生成的整片当 role:'video' 输入再生成。
 */
// @ts-nocheck
import { createAiTask, waitForAiTask } from './business'
import { buildVideoGenerationParams } from '@/utils/videoTasks'
import { normalizeSeedanceRatio, normalizeSeedanceDuration } from '@/utils/videoOptions'
import { resolveGeneratedMediaUrls } from '@/utils/taskMedia'

// 目前线上只有 Seedance 2.0
const VIDEO_MODEL_KEYWORDS = ['seedance']
const extractVideoAssetId = (task: any): number =>
  Number(task?.outputs?.find?.((o: any) => o?.asset_id)?.asset_id || 0)

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
  /** 第一张分镜图的 asset_id(图生视频参考) */
  imageAssetId?: number
  /** 上次生成的整片 asset_id(带修改意见重生成时用) */
  prevVideoAssetId?: number
  /** 对整片的修改意见 */
  note?: string
  modelPlanCandidates?: string[]
}): Promise<{ url: string; assetId: number }> {
  const prompt =
    buildTimelinePrompt({ shots: args.shots, basePrompt: args.basePrompt, ratio: args.ratio, style: args.style }) +
    (args.note ? `\n额外修改要求:${args.note}` : '')
  const inputAssets =
    args.note && args.prevVideoAssetId
      ? [{ asset_id: args.prevVideoAssetId, role: 'video' }]
      : args.imageAssetId
        ? [{ asset_id: args.imageAssetId, role: 'image' }]
        : []
  const task = await createAiTask({
    workspaceId: args.workspaceId,
    capability: 'video',
    operationCode: 'video.generate',
    preferredModelKeywords: VIDEO_MODEL_KEYWORDS,
    ...(args.modelPlanCandidates?.length ? { modelPlanCandidates: args.modelPlanCandidates } : {}),
    prompt,
    inputAssets,
    params: (model: any) =>
      buildVideoGenerationParams(model, {
        duration: normalizeSeedanceDuration(totalDurationSec(args.shots) || 10),
        resolution: '720p',
        ratio: normalizeSeedanceRatio(args.ratio || '16:9'),
        generateAudio: true,
      }),
  })
  // 视频生成耗时长,放宽轮询超时(实际不会误触发;默认 120s 会把正常生成判成超时)
  const completed = await waitForAiTask({
    workspaceId: args.workspaceId,
    task,
    intervalMs: 4000,
    timeoutMs: 60 * 60 * 1000,
  })
  const assetId = extractVideoAssetId(completed)
  const [url] = await resolveGeneratedMediaUrls({ workspaceId: args.workspaceId, task: completed, type: 'video' })
  if (!url) throw new Error('视频任务已完成,暂未返回可预览地址')
  return { url, assetId }
}
