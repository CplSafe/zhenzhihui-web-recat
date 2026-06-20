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
