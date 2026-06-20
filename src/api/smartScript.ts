/**
 * 智能成片 — 分镜脚本生成。
 *
 * 当前走「本地多模态模型」(Qwen, /aimodel 代理),可结合上传素材图片生成更贴合的分镜。
 * 业务后端的 AI 网关(/ai/responses, operationCode: responses.multimodal)需先在管理后台
 * 启用对应模型才能用;待其就绪后可切回(见文件末尾注释)。
 *
 * 返回映射为表格用的 Shot[](镜头/时长/画面描述/拆分主体)。
 */
// @ts-nocheck
import type { Shot } from '@/components/smart/ScriptStoryboardTable'

const MODEL_NAME = (import.meta.env.VITE_AI_MODEL_NAME as string) || 'Qwen3.6-35B-A3B'
const ENDPOINT = '/aimodel/v1/chat/completions'

interface GenerateArgs {
  requirement: string
  style?: string
  ratio?: string
  duration?: string
  images?: string[] // objectURL 或 data URL,自动转 base64 后多模态送入
}

const SYSTEM =
  '你是资深短视频(信息流广告)分镜脚本师。根据创作需求(及可能提供的素材图片)生成一条可执行的分镜脚本。' +
  '为每个镜头给出:镜头时长(如 5s)、画面描述(中文,具体、可拍摄),并拆分该镜头涉及的【视觉主体】(人物/场景/物体/产品),用于后续素材准备。' +
  '注意:只拆需要视觉素材的主体;不要把台词、旁白、字幕、文案、标语、口号、CTA、标题等文本类元素列为主体。' +
  '若提供了素材图片,请结合图片内容来设定主体与画面;并判断每个主体是否与某张素材图对应,' +
  '若对应,在该主体加 imageIndex 字段(从1开始,表示第几张素材图);不对应则省略该字段。' +
  '严格只输出 JSON(不要解释、不要 markdown 代码块),格式:' +
  '{"shots":[{"duration":"5s","desc":"画面描述","subjects":[{"name":"小雅","kind":"人物","imageIndex":2},{"name":"室内场景","kind":"场景"}]}]}'

/** objectURL → 缩放后的 base64 data url(控制体积) */
function urlToDataUrl(url: string, max = 1024): Promise<string | null> {
  if (url.startsWith('data:')) return Promise.resolve(url)
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height))
      const w = Math.max(1, Math.round(img.width * scale))
      const h = Math.max(1, Math.round(img.height * scale))
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const ctx = c.getContext('2d')
      if (!ctx) return resolve(null)
      ctx.drawImage(img, 0, 0, w, h)
      try {
        resolve(c.toDataURL('image/jpeg', 0.82))
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = url
  })
}

function buildUserText({ requirement, style, ratio, duration }: GenerateArgs): string {
  return [
    `创作需求:${requirement}`,
    `约束:风格 ${style || '商业'},画面比例 ${ratio || '16:9'},单个镜头时长约 ${duration || '5s'}。`,
    '请按要求输出分镜 JSON。',
  ].join('\n')
}

// 文本类"主体"(无需上传素材)关键词
const TEXT_SUBJECT_RE = /文案|字幕|标语|口号|标题|文字|台词|旁白|cta|slogan|字样/i

function parseShots(text: string, images: string[] = []): Shot[] {
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
      ? s.subjects
          .map((x: any) => {
            const idx = Number(x?.imageIndex || x?.image_index || 0)
            const image = idx >= 1 && images[idx - 1] ? images[idx - 1] : undefined
            return {
              tag: '@' + String(x?.name || x?.tag || x?.subject || '主体').replace(/^@/, '').trim(),
              kind: String(x?.kind || x?.type || '').trim(),
              image,
            }
          })
          // 兜底:过滤文本类元素(文案/字幕/口号/CTA…),它们不需要上传素材
          .filter((s: any) => !TEXT_SUBJECT_RE.test(s.tag) && !TEXT_SUBJECT_RE.test(s.kind))
      : [],
  }))
}

/** 生成分镜脚本,返回 Shot[](失败抛错)。 */
export async function generateScriptShots(args: GenerateArgs): Promise<Shot[]> {
  if (!args.requirement.trim()) throw new Error('创作需求为空')

  const dataUrls = (
    await Promise.all((args.images || []).slice(0, 6).map((u) => urlToDataUrl(u)))
  ).filter(Boolean) as string[]

  const userText = buildUserText(args)
  const userContent: any = dataUrls.length
    ? [{ type: 'text', text: userText }, ...dataUrls.map((u) => ({ type: 'image_url', image_url: { url: u } }))]
    : userText

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL_NAME,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: userContent },
      ],
      temperature: 0.8,
      max_tokens: 2000,
      chat_template_kwargs: { enable_thinking: false },
    }),
  })
  if (!res.ok) throw new Error(`脚本生成服务异常(${res.status})`)
  const data = await res.json()
  const text = data?.choices?.[0]?.message?.content || ''
  // 用原始 objectURL(args.images)做展示映射(顺序与送模型的一致)
  const shots = parseShots(text, args.images || [])
  if (!shots.length) throw new Error('未能解析分镜脚本,请重试')
  return shots
}

/*
 * 切回业务后端网关(待管理后台启用 responses.multimodal 模型后):
 *   import { createAiResponse, getBusinessErrorMessage } from './business'
 *   const result = await createAiResponse({ workspaceId, operationCode: 'responses.multimodal',
 *     prompt: SYSTEM + '\n' + userText, params: { temperature: 0.8, max_output_tokens: 4000 } })
 *   const shots = parseShots(String(result?.text || ''))
 */
