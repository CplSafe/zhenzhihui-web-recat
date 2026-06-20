/**
 * 智能成片 — 分镜脚本生成(走业务后端 AI 网关 /ai/responses, operationCode: responses.multimodal)。
 * 输入创作需求 + 约束,返回分镜列表(镜头时长/画面描述/拆分主体),映射为表格用的 Shot[]。
 */
// @ts-nocheck
import { createAiResponse, getBusinessErrorMessage } from './business'
import type { Shot } from '@/components/smart/ScriptStoryboardTable'

interface GenerateArgs {
  workspaceId: number
  requirement: string
  style?: string
  ratio?: string
  duration?: string
  signal?: AbortSignal
}

function buildPrompt({ requirement, style, ratio, duration }: GenerateArgs): string {
  return [
    '你是资深短视频(信息流广告)分镜脚本师。根据创作需求生成一条可执行的分镜脚本。',
    `创作需求:${requirement}`,
    `约束:风格 ${style || '商业'},画面比例 ${ratio || '16:9'},单个镜头时长约 ${duration || '5s'}。`,
    '为每个镜头给出:镜头时长(如 5s)、画面描述(中文,具体、可拍摄),',
    '并拆分出该镜头涉及的主体(人物/场景),用于后续素材准备。',
    '严格只输出 JSON(不要解释、不要 markdown 代码块),格式:',
    '{"shots":[{"duration":"5s","desc":"画面描述","subjects":[{"name":"小雅","kind":"人物"},{"name":"室内场景","kind":"场景"}]}]}',
  ].join('\n')
}

function parseShots(text: string): Shot[] {
  let raw = String(text || '').trim()
  if (!raw) return []
  raw = raw
    .replace(/^```(json)?/i, '')
    .replace(/```$/i, '')
    .trim()
  const m = raw.match(/\{[\s\S]*\}/)
  let parsed: any = null
  try {
    parsed = JSON.parse(m ? m[0] : raw)
  } catch {
    return []
  }
  const list = Array.isArray(parsed) ? parsed : parsed?.shots || parsed?.storyboards || []
  if (!Array.isArray(list)) return []
  return list.map((s: any, i: number) => ({
    id: i + 1,
    no: `镜头${i + 1}`,
    duration: String(s?.duration || s?.dur || '5s').trim() || '5s',
    desc: String(s?.desc || s?.prompt || s?.description || '').trim() || '画面描述',
    subjects: Array.isArray(s?.subjects)
      ? s.subjects.map((x: any) => ({
          tag: '@' + String(x?.name || x?.tag || x?.subject || '主体').replace(/^@/, '').trim(),
          kind: String(x?.kind || x?.type || '').trim(),
        }))
      : [],
  }))
}

/** 生成分镜脚本,返回 Shot[](失败抛错,message 已业务化)。 */
export async function generateScriptShots(args: GenerateArgs): Promise<Shot[]> {
  const wsId = Number(args.workspaceId || 0)
  if (!Number.isFinite(wsId) || wsId <= 0) throw new Error('未选择工作空间,无法生成脚本')
  if (!args.requirement.trim()) throw new Error('创作需求为空')

  let result: any
  try {
    result = await createAiResponse({
      workspaceId: wsId,
      operationCode: 'responses.multimodal',
      prompt: buildPrompt(args),
      params: { temperature: 0.8, max_output_tokens: 4000 },
    })
  } catch (e) {
    throw new Error(getBusinessErrorMessage(e, '脚本生成失败,请重试'))
  }

  const text = String(result?.text || '').trim()
  const shots = parseShots(text)
  if (!shots.length) throw new Error('未能解析分镜脚本,请重试')
  return shots
}
