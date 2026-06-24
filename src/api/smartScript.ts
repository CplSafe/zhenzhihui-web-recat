/**
 * 智能成片 — 分镜脚本生成。
 *
 * 走业务后端 AI 网关(/api/v1/ai/responses,operation_code: responses.multimodal),
 * 见 ./aiResponses。可结合上传素材图片(以 inputAssets 传入)生成更贴合的分镜。
 * (此前为临时直连「本地多模态 Qwen」,现已对齐 Vue 切回后端网关。)
 *
 * 返回映射为表格用的 Shot[](镜头/时长/画面描述/拆分主体)。
 */
// @ts-nocheck
import type { Shot } from '@/components/smart/ScriptStoryboardTable'
import { runResponseText, streamResponseText } from './aiResponses'

interface GenerateArgs {
  requirement: string
  style?: string
  ratio?: string
  duration?: string
  images?: string[] // objectURL / dataURL / http,送入后端前会上传成 asset(inputAssets)
  signal?: AbortSignal
}

const SYSTEM =
  '你是资深短视频(信息流广告)分镜脚本师。根据创作需求(及可能提供的素材图片)生成一条可执行的分镜脚本。' +
  '为每个镜头给出:镜头时长(如 5s)、画面描述(中文,具体、可拍摄),并拆分该镜头涉及的【视觉主体】(人物/场景/物体/产品),用于后续素材准备。' +
  '同时,结合整体剧情与该镜头画面,为每个镜头写出:台词/旁白(voiceover)、字幕(subtitle)、音效(sfx);没有就给空字符串。' +
  '台词字数必须 ≤ 该镜头时长(秒)×4(避免语速过快,如 5 秒镜头台词不超过 20 字);字幕要简短(通常 ≤15 字,不超过台词)。' +
  '【硬性要求】每个镜头的 subjects 数组都不能为空:必须列出该画面里出现的全部独立视觉元素(人物/场景/物体/产品),至少 1 个,通常 2~4 个;subjects 字段一律不可省略。' +
  '注意:只拆需要视觉素材的主体;不要把台词、旁白、字幕、文案、标语、口号、CTA、标题等文本类元素列为主体。' +
  '若提供了素材图片,请结合图片内容来设定主体与画面;并判断每个主体是否与某张素材图对应,' +
  '若对应,在该主体加 imageIndex 字段(从1开始,表示第几张素材图);不对应则省略该字段。' +
  '严格只输出 JSON(不要解释、不要 markdown 代码块),格式:' +
  '{"shots":[{"duration":"5s","desc":"画面描述","voiceover":"台词/旁白","subtitle":"字幕","sfx":"音效","subjects":[{"name":"小雅","kind":"人物","imageIndex":2},{"name":"室内场景","kind":"场景"}]}]}'

function buildUserText({ requirement, style, ratio, duration }: GenerateArgs): string {
  const totalSec = parseInt(String(duration || '10'), 10) || 10
  const approxShots = Math.max(1, Math.round(totalSec / 4)) // 每镜约 4 秒估算镜头数
  return [
    `创作需求:${requirement || '(未提供文字,请根据上传的参考图片构思一支完整广告短视频的分镜)'}`,
    `约束:风格 ${style || '商业'},画面比例 ${ratio || '16:9'}。`,
    `视频总时长约 ${totalSec} 秒:请切分为约 ${approxShots} 个镜头,每个镜头不少于 3 秒(通常 3~5 秒),` +
      `各镜头 duration 之和约等于总时长;不要切得过碎。`,
    '请按要求输出分镜 JSON。',
  ].join('\n')
}

// 文本类"主体"(无需上传素材)关键词
const TEXT_SUBJECT_RE = /文案|字幕|标语|口号|标题|文字|台词|旁白|cta|slogan|字样/i

// 容错:从(可能被截断的)文本里抢救出所有「完整」的顶层 {…} 对象
function salvageObjects(raw: string): any[] {
  const objs: any[] = []
  const arrStart = raw.indexOf('[')
  if (arrStart < 0) return objs
  let depth = 0
  let start = -1
  for (let i = arrStart + 1; i < raw.length; i++) {
    const ch = raw[i]
    if (ch === '{') {
      if (depth === 0) start = i
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0 && start >= 0) {
        try {
          objs.push(JSON.parse(raw.slice(start, i + 1)))
        } catch {
          /* 跳过坏块 */
        }
        start = -1
      }
    }
  }
  return objs
}

// 原始分镜对象数组 → Shot[](主体映射 + 文本类过滤)
function mapShots(list: any[], images: string[] = []): Shot[] {
  if (!Array.isArray(list)) return []
  return list.map((s: any, i: number) => ({
    id: i + 1,
    no: `镜头${i + 1}`,
    duration: String(s?.duration || s?.dur || '5s').trim() || '5s',
    desc: String(s?.desc || s?.prompt || s?.description || '').trim() || '画面描述',
    line: String(s?.line || s?.voiceover || s?.dialogue || '').trim(),
    subtitle: String(s?.subtitle || s?.caption || '').trim(),
    sfx: String(s?.sfx || s?.sound || s?.audio || '').trim(),
    subjects: Array.isArray(s?.subjects)
      ? s.subjects
          .map((x: any) => {
            const idx = Number(x?.imageIndex || x?.image_index || 0)
            const image = idx >= 1 && images[idx - 1] ? images[idx - 1] : undefined
            return {
              tag:
                '@' +
                String(x?.name || x?.tag || x?.subject || '主体')
                  .replace(/^@/, '')
                  .trim(),
              kind: String(x?.kind || x?.type || '').trim(),
              image,
            }
          })
          .filter((s: any) => !TEXT_SUBJECT_RE.test(s.tag) && !TEXT_SUBJECT_RE.test(s.kind))
      : [],
  }))
}

function parseShots(text: string, images: string[] = []): Shot[] {
  let raw = String(text || '').trim()
  if (!raw) return []
  raw = raw
    .replace(/^```(json)?/i, '')
    .replace(/```$/i, '')
    .trim()
  const m = raw.match(/\{[\s\S]*\}/)
  let list: any[] = []
  try {
    const parsed = JSON.parse(m ? m[0] : raw)
    list = Array.isArray(parsed) ? parsed : parsed?.shots || parsed?.storyboards || []
  } catch {
    /* 下面走容错抢救 */
  }
  if (!Array.isArray(list) || !list.length) list = salvageObjects(raw)
  return mapShots(list, images)
}

/** 生成分镜脚本,返回 Shot[](失败抛错)。 */
export async function generateScriptShots(args: GenerateArgs): Promise<Shot[]> {
  if (!args.requirement.trim() && !args.images?.length) throw new Error('请至少输入文案或上传图片')
  const images = args.images || []
  const text = await runResponseText({
    system: SYSTEM,
    user: buildUserText(args),
    images: images.slice(0, 6),
    temperature: 0.8,
    maxTokens: 4000,
    signal: args.signal,
  })
  // 用原始 objectURL(args.images)做展示映射(顺序与送模型/上传的一致)
  const shots = parseShots(text, images)
  if (!shots.length) throw new Error('未能解析分镜脚本,请重试')
  return shots
}

/**
 * 流式生成分镜脚本:边生成边增量解析,每当多出一个「完整」分镜就回调 onShots,
 * 用户看到镜头1即可开始修改。返回最终 Shot[]。
 * (流式失败时由 streamResponseText 自动回退非流式,届时拿到全文一次性解析。)
 */
export async function generateScriptShotsStream(args: GenerateArgs, onShots: (shots: Shot[]) => void): Promise<Shot[]> {
  if (!args.requirement.trim() && !args.images?.length) throw new Error('请至少输入文案或上传图片')
  const images = args.images || []
  let lastCount = 0

  // 用「到目前为止的全文」增量抢救出已完整的分镜,多出来就回调
  const emit = (acc: string) => {
    const shots = mapShots(salvageObjects(acc), images)
    if (shots.length > lastCount) {
      lastCount = shots.length
      onShots(shots)
    }
  }

  const finalText = await streamResponseText({
    system: SYSTEM,
    user: buildUserText(args),
    images: images.slice(0, 6),
    temperature: 0.8,
    maxTokens: 4000,
    signal: args.signal,
    onDelta: (_delta, aggregated) => emit(aggregated),
  })

  // 收尾:用完整解析兜底(可能比增量多解析出最后一个;非流式回退时这里是唯一解析)
  const finalShots = parseShots(finalText, images)
  const result = finalShots.length >= lastCount ? finalShots : mapShots(salvageObjects(finalText), images)
  if (!result.length) throw new Error('未能解析分镜脚本,请重试')
  return result
}
