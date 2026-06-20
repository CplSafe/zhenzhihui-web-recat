/**
 * AI 文案润色客户端。
 *
 * 当前对接「本地部署模型」(vLLM,OpenAI 兼容 /v1/chat/completions)。
 * dev 经 Vite `/aimodel` 代理转发以规避浏览器 CORS;后端正式接入后,
 * 改 VITE_AI_MODEL_ORIGIN / VITE_AI_MODEL_NAME(或把 BASE 换成业务网关)即可,
 * 调用方(EditField 等)无需改动。
 */

// dev 默认走代理前缀;如配置了完整 origin(且非本地代理)也可直连。
const MODEL_NAME = (import.meta.env.VITE_AI_MODEL_NAME as string) || 'Qwen3.6-35B-A3B'
const ENDPOINT = '/aimodel/v1/chat/completions'

/** 不同修改框的润色侧重,用于系统提示词。 */
export type PolishKind = 'script' | 'line' | 'subtitle' | 'sound' | 'segment' | 'generic'

const SYSTEM_PROMPTS: Record<PolishKind, string> = {
  script: '你是专业的短视频分镜脚本润色助手。在保持原意与画面信息的前提下,让文案更生动、专业、有镜头感。只输出润色后的脚本正文,不要加解释、不要加引号。',
  line: '你是专业的影视台词润色助手。在保持原意的前提下,让台词更自然、口语化、有感染力。只输出润色后的台词,不要解释、不要引号。',
  subtitle: '你是专业的视频字幕润色助手。让字幕更简洁、准确、易读,长度适合屏幕显示。只输出润色后的字幕文本,不要解释。',
  sound: '你是专业的音效描述润色助手。让音效/配乐描述更具体、专业、可执行。只输出润色后的描述,不要解释。',
  segment: '你是专业的视频片段编辑助手。根据用户对这一片段的修改诉求,润色为清晰、可执行的画面编辑指令。只输出润色后的指令,不要解释。',
  generic: '你是专业的中文文案润色助手。在保持原意的前提下让表达更清晰、生动、专业。只输出润色后的文本,不要解释、不要引号。',
}

export interface PolishOptions {
  kind?: PolishKind
  /** 额外上下文(如所属分镜主体/场景),拼到用户消息里帮助润色 */
  context?: string
  signal?: AbortSignal
  maxTokens?: number
}

interface ChatChoice {
  message?: { content?: string }
}
interface ChatResponse {
  choices?: ChatChoice[]
  error?: { message?: string }
}

/**
 * 润色一段文本,返回润色后的结果(失败抛错,调用方提示并保留原文)。
 */
export async function polishText(text: string, opts: PolishOptions = {}): Promise<string> {
  const input = (text || '').trim()
  if (!input) throw new Error('请输入内容后再润色')

  const kind = opts.kind || 'generic'
  const userContent = opts.context ? `【上下文】${opts.context}\n【待润色文本】${input}` : input

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: opts.signal,
    body: JSON.stringify({
      model: MODEL_NAME,
      messages: [
        { role: 'system', content: SYSTEM_PROMPTS[kind] },
        { role: 'user', content: userContent },
      ],
      temperature: 0.7,
      max_tokens: opts.maxTokens ?? 512,
      // Qwen3 关闭思考链,直接输出结果(避免返回 reasoning)
      chat_template_kwargs: { enable_thinking: false },
    }),
  })

  if (!res.ok) {
    let detail = ''
    try {
      detail = (await res.json())?.error?.message || ''
    } catch {
      /* ignore */
    }
    throw new Error(detail || `润色服务异常(${res.status})`)
  }

  const data = (await res.json()) as ChatResponse
  const out = data?.choices?.[0]?.message?.content?.trim()
  if (!out) throw new Error('润色结果为空,请重试')
  return out
}

/**
 * 低层:发一轮 chat,返回纯文本(供起名等复用)。
 */
async function chatOnce(system: string, user: string, signal?: AbortSignal, maxTokens = 64): Promise<string> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      model: MODEL_NAME,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.6,
      max_tokens: maxTokens,
      chat_template_kwargs: { enable_thinking: false },
    }),
  })
  if (!res.ok) throw new Error(`模型服务异常(${res.status})`)
  const data = (await res.json()) as ChatResponse
  return data?.choices?.[0]?.message?.content?.trim() || ''
}

/**
 * 根据用户的创作需求,自动生成简洁贴切的项目名称(本地 Qwen)。
 * 失败抛错;调用方自行兜底(保留原名)。
 */
export async function generateProjectName(requirement: string, signal?: AbortSignal): Promise<string> {
  const req = (requirement || '').trim()
  if (!req) throw new Error('请输入创作需求')
  const system =
    '你是项目命名助手。根据用户的短视频创作需求,起一个简洁、贴切、有吸引力的中文项目名称。' +
    '要求:4到8个字,不含标点、引号、书名号、空格、序号,不要任何解释。只输出名称本身。'
  let name = await chatOnce(system, req, signal, 32)
  // 兜底清洗:去引号/标点/空白,截断到 8 字
  name = name.replace(/["'《》「」“”‘’\s]/g, '').replace(/[。,，.!！?？:：;；]/g, '').trim()
  name = name.split('\n')[0].slice(0, 8)
  if (!name) throw new Error('生成名称为空,请重试')
  return name
}

/**
 * AI 引导(入口页):把用户粗略的创作需求梳理、补全成更清晰可执行的"创作需求"。
 * 注意:这不是写分镜脚本/台词,只是帮用户把 brief 想得更专业完整(信息流广告视角)。
 */
export async function guideRequirement(text: string, signal?: AbortSignal): Promise<string> {
  const req = (text || '').trim()
  if (!req) throw new Error('请先输入创作需求')
  const system =
    '你是资深信息流广告策划。用户会提供产品及若干要素(可能不全)。请基于"信息流需求三角(创造需求→介绍产品→呼吁行动)"' +
    '和"前3秒钩子→痛点→产品卖点→信任→行动号召(CTA)"的逻辑,把它整理、补全成一份清晰可执行的"创作需求"。' +
    '需覆盖:【产品/品牌】【目标人群】【用户痛点/诉求】【核心卖点(利益点)】【使用场景】【营销目标与CTA】【表现形式/剧情类型】【风格调性】;' +
    '用户没提到的要素,基于信息流广告经验补充合理建议(但必须紧扣其产品,不要脱离产品臆造)。' +
    '输出一份结构清晰的"创作需求"(供后续生成分镜脚本使用),用简洁要点分条呈现;' +
    '不要直接写分镜脚本/台词/镜头画面,不要额外解释说明。'
  const out = await chatOnce(system, req, signal, 800)
  if (!out) throw new Error('生成为空,请重试')
  return out
}
