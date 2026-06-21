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
// 专用视觉模型(图片解析更准),用于素材分析/智能预填
const VL_MODEL_NAME = (import.meta.env.VITE_AI_VL_NAME as string) || 'Qwen3-VL-30B-A3B'
const VL_ENDPOINT = '/aimodel-vl/v1/chat/completions'

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
 * 为引导某一项生成「最可能的 5 个」简短候选(纯文本模型),可排除已展示项(换一批)。
 */
export async function suggestOptions(
  input: { label: string; hint?: string; context?: string; exclude?: string[] },
  signal?: AbortSignal,
): Promise<string[]> {
  const { label, hint = '', context = '', exclude = [] } = input
  const system =
    '你是信息流广告策划助手。针对给定的「要素」给出最可能的 5 个简短候选(每个不超过 8 个字,中文,彼此不同)。' +
    '务必紧扣该要素的定义与已知产品/语境,候选要具体、可直接使用,且只属于这个要素本身——' +
    '不要给放之四海而皆准的促销口号(如"限时优惠/官方正品"),也不要和其他要素混淆。' +
    '只输出 JSON 数组,例如 ["A","B","C","D","E"];不要解释、不要代码块标记。'
  const user =
    `要素:${label}${hint ? `(${hint})` : ''}\n已知信息:${context || '(暂无,请结合该要素定义给通用但具体的候选)'}` +
    (exclude.length ? `\n请避免与这些重复:${exclude.join('、')}` : '')
  let raw = ''
  try {
    raw = await chatOnce(system, user, signal, 200)
  } catch {
    return []
  }
  raw = raw.replace(/^```(json)?/i, '').replace(/```$/i, '').trim()
  const m = raw.match(/\[[\s\S]*\]/)
  try {
    const arr = JSON.parse(m ? m[0] : raw)
    if (Array.isArray(arr)) {
      return arr
        .map((x) => String(x).replace(/["'\s]/g, '').trim())
        .filter(Boolean)
        .slice(0, 5)
    }
  } catch {
    /* ignore */
  }
  return []
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

export interface GuideSuggestions {
  product?: string
  sellpoint?: string
  audience?: string
  pain?: string
  scene?: string
  goal?: string
  plot?: string
  tone?: string
}

/**
 * 智能预填:根据用户的想法(文字)+ 素材图片(多模态),推断信息流广告各要素的建议,
 * 用于 AI 引导对话框的预填(因材施教,不再千篇一律)。images 传 base64 data URL。
 */
export async function analyzeForGuide(
  input: { text?: string; images?: string[] },
  signal?: AbortSignal,
): Promise<GuideSuggestions> {
  const text = (input.text || '').trim()
  const images = input.images || []
  if (!text && !images.length) return {}

  const userContent: any[] = [
    {
      type: 'text',
      text:
        `用户的创作想法:${text || '(未填写)'}\n` +
        (images.length ? '用户还上传了素材图片(见下)。请务必结合图片中实际出现的物体/场景/人物来推断。' : '') +
        '请为这条信息流广告推断各要素建议。',
    },
  ]
  for (const u of images) userContent.push({ type: 'image_url', image_url: { url: u } })

  const system =
    '你是资深信息流广告策划。根据用户的想法和(若有)素材图片,推断以下要素并给出简短建议(中文,每项不超过20字):' +
    'product(产品/品牌)、sellpoint(核心卖点)、audience(目标人群)、pain(用户痛点)、scene(使用场景)、' +
    'goal(营销目标与CTA)、plot(表现形式/剧情类型)、tone(风格调性)。' +
    '紧扣用户素材与想法,不要臆造;某项看不出就留空字符串。' +
    '只输出严格 JSON 对象(键为上述英文,值为字符串),不要解释、不要代码块标记。'

  // 有图片走专用视觉模型(VL),纯文字走通用模型
  const useVl = images.length > 0
  const res = await fetch(useVl ? VL_ENDPOINT : ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      model: useVl ? VL_MODEL_NAME : MODEL_NAME,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userContent },
      ],
      temperature: 0.5,
      max_tokens: 400,
      chat_template_kwargs: { enable_thinking: false },
    }),
  })
  if (!res.ok) throw new Error(`分析服务异常(${res.status})`)
  const data = (await res.json()) as ChatResponse
  let raw = data?.choices?.[0]?.message?.content?.trim() || ''
  raw = raw
    .replace(/^```(json)?/i, '')
    .replace(/```$/, '')
    .trim()
  const m = raw.match(/\{[\s\S]*\}/)
  if (!m) return {}
  try {
    return JSON.parse(m[0]) as GuideSuggestions
  } catch {
    return {}
  }
}

/**
 * 镜头编排:根据整体需求 + 该镜头画面描述,生成该镜头的 台词/旁白、字幕、音效。
 */
export async function generateShotCopy(
  input: { requirement?: string; desc: string; durationSec?: number },
  signal?: AbortSignal,
): Promise<{ line: string; subtitle: string; sfx: string }> {
  const dur = Number(input.durationSec || 0)
  const maxLine = dur > 0 ? dur * 4 : 0
  const system =
    '你是短视频(信息流广告)文案。根据【整体需求】和【该镜头画面描述】,为这个镜头写出贴合的:' +
    '台词/旁白(line)、字幕(subtitle)、音效说明(sfx)。' +
    (maxLine ? `镜头时长约 ${dur} 秒,台词/旁白不超过 ${maxLine} 个字(避免语速过快);` : '') +
    '字幕要简短(不超过台词、通常 ≤15 个字);没有就给空字符串。' +
    '只输出严格 JSON:{"line":"...","subtitle":"...","sfx":"..."},不要解释、不要代码块标记。'
  const user = `【整体需求】${input.requirement || ''}\n【画面描述】${input.desc || ''}`
  const raw = (await chatOnce(system, user, signal, 300))
    .replace(/^```(json)?/i, '')
    .replace(/```$/i, '')
    .trim()
  const m = raw.match(/\{[\s\S]*\}/)
  try {
    const o = JSON.parse(m ? m[0] : raw)
    return {
      line: String(o?.line || o?.voiceover || '').trim(),
      subtitle: String(o?.subtitle || '').trim(),
      sfx: String(o?.sfx || o?.sound || '').trim(),
    }
  } catch {
    throw new Error('文案生成解析失败,请重试')
  }
}

/**
 * 优化「分镜图」的生成提示词:据该镜画面描述 + 包含的主体元素,产出干净可用的画面提示词。
 * 只含给定主体,不臆造无关产品(避免把全局产品塞进无关镜头)。失败由调用方兜底。
 */
export async function refineShotPrompt(
  input: {
    desc?: string
    outline?: string
    style?: string
    ratio?: string
    /** 该镜「选中参与出图」的素材:看图识别真实外观;有 url 走 VL 读图 */
    materials?: { name?: string; kind?: string; url?: string }[]
  },
  signal?: AbortSignal,
): Promise<{ prompt: string; debug: any }> {
  const desc = (input.desc || '').trim()
  const outline = (input.outline || '').trim()
  const mats = (input.materials || []).filter((m) => m && (m.name || m.url))
  const withImg = mats.filter((m) => m.url)
  if (!desc && !mats.length) return { prompt: desc, debug: { note: '无可用输入' } }

  const useVl = withImg.length > 0
  const clean = (s: string) =>
    s
      .replace(/^```(\w+)?/i, '')
      .replace(/```$/i, '')
      .replace(/^["'《》「」“”‘’]+|["'《》「」“”‘’]+$/g, '')
      .replace(/\s*\n+\s*/g, ',')
      .trim()

  let system = ''
  let textPart = ''
  let raw = ''
  let prompt = ''

  if (useVl) {
    // 让 VL 看清每张素材,写出「有故事性、连贯」的单幅画面,把所有选中素材有机编织进本镜叙事意图
    system =
      '你是资深分镜师 + AI 绘画提示词专家。下面给【整体大纲(仅调性参考,不可照搬其产品)】、' +
      '【这一个分镜的画面描述=脚本(它体现本镜的叙事意图,如对比/转折/情绪)】和【按顺序的选中素材图】。' +
      '请写出一段【有故事性、连贯的单幅画面】中文文生图提示词:' +
      '①逐张看素材图,如实理解每个主体的真实外观(普通/破旧就如实写,不要美化成大纲里的高端产品);' +
      '②把每一张素材主体都自然、有机地编织进这一个画面,服务于本镜的叙事意图(如对比镜要让两者在画面里形成对比关系),' +
      '一张素材都不能遗漏;③但不要写成"画面包含A、B、C"式的罗列,要像描述一个真实发生的场景那样,' +
      '让主体之间有主次、有位置关系、有情绪与故事感;④描述主体、动作、相互关系、场景、构图景别、光线氛围、关键细节;' +
      '⑤只写画面里正向有什么,严禁"不/不要/没有/排除/避免/无"等否定词;不要编号、引号、解释、换行,直接输出一段提示词。'
    textPart = [
      outline && `整体大纲(仅调性参考):${outline}`,
      `画面描述/脚本(本镜叙事意图,以此为准):${desc || '(未填写)'}`,
      input.style && `风格:${input.style}`,
      input.ratio && `画面比例:${input.ratio}`,
      `下面按顺序是 ${withImg.length} 张选中素材图(都要编织进画面,一张都别漏),请逐张看清真实外观:`,
    ]
      .filter(Boolean)
      .join('\n')
    const userContent: any[] = [{ type: 'text', text: textPart }]
    withImg.forEach((m, i) => {
      userContent.push({ type: 'text', text: `第${i + 1}张素材(${m.name || ''}${m.kind ? `/${m.kind}` : ''}):` })
      userContent.push({ type: 'image_url', image_url: { url: m.url } })
    })
    const res = await fetch(VL_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        model: VL_MODEL_NAME,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userContent },
        ],
        temperature: 0.6,
        max_tokens: 400,
        chat_template_kwargs: { enable_thinking: false },
      }),
    })
    if (!res.ok) throw new Error(`分析服务异常(${res.status})`)
    const data = (await res.json()) as ChatResponse
    raw = data?.choices?.[0]?.message?.content || ''
    prompt = clean(raw) || desc
  } else {
    // 无素材图:纯文本据脚本+大纲生成
    system =
      '你是 AI 绘画提示词专家。据【整体大纲(仅调性)】和【这一个分镜的画面描述】输出一段只含正向内容的中文文生图提示词:' +
      '紧扣画面描述,描述主体/动作/场景/构图景别/光线氛围;不把大纲里的产品强塞;严禁"不/不要/没有/排除"等否定词;' +
      '不要编号、引号、解释、换行,直接输出。'
    textPart = [
      outline && `整体大纲(仅调性):${outline}`,
      `画面描述:${desc || '(未填写)'}`,
      input.style && `风格:${input.style}`,
      input.ratio && `画面比例:${input.ratio}`,
    ]
      .filter(Boolean)
      .join('\n')
    raw = await chatOnce(system, textPart, signal, 300)
    prompt = clean(raw) || desc
  }
  return {
    prompt,
    debug: {
      model: useVl ? VL_MODEL_NAME : MODEL_NAME,
      endpoint: useVl ? 'VL(读图)' : '纯文本',
      system,
      userText: textPart,
      materials: mats.map((m) => ({ name: m.name, kind: m.kind, url: m.url })),
      raw,
      prompt,
    },
  }
}

/**
 * 按【参考图】(真实产品/主体照片)+ 意图,用 VL 模型读图后产出"图生图"提示词。
 * 忠实还原参考图中主体外观(品牌/logo/配色/造型/材质),只调背景/光线/角度。失败由调用方兜底。
 */
export async function refineElementPromptWithImage(
  intent: string,
  imageUrl: string,
  opts: { name?: string; kind?: string; style?: string; signal?: AbortSignal } = {},
): Promise<string> {
  const src = (intent || '').trim()
  if (!imageUrl) return src
  const system =
    '你是 AI 绘画提示词专家。用户提供了一张【参考图】(通常是真实产品/主体照片)和生成意图。' +
    '请仔细观察参考图中该主体的真实外观——品牌标识/logo、颜色、造型、材质、关键细节,' +
    '据此输出一段简洁、可直接用于「图生图」的中文画面提示词:' +
    '①忠实还原参考图中主体的外观特征(尤其品牌/logo/配色/造型),不得臆造或改变产品本身;' +
    '②可结合生成意图调整背景、光线、角度、氛围;' +
    '③画面只含该单一主体,背景简洁干净;' +
    '④不要出现"广告/营销/目的/用途"等与画面无关的词;不要编号、不要引号、不要换行,直接输出提示词。'
  const userContent: any[] = [
    {
      type: 'text',
      text: [
        opts.name && `主体:${opts.name}`,
        opts.kind && `类型:${opts.kind}`,
        opts.style && `视觉风格:${opts.style}`,
        `生成意图:${src}`,
      ]
        .filter(Boolean)
        .join('\n'),
    },
    { type: 'image_url', image_url: { url: imageUrl } },
  ]
  const res = await fetch(VL_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: opts.signal,
    body: JSON.stringify({
      model: VL_MODEL_NAME,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userContent },
      ],
      temperature: 0.5,
      max_tokens: 280,
      chat_template_kwargs: { enable_thinking: false },
    }),
  })
  if (!res.ok) throw new Error(`分析服务异常(${res.status})`)
  const data = (await res.json()) as ChatResponse
  const out = (data?.choices?.[0]?.message?.content || '')
    .replace(/^```(\w+)?/i, '')
    .replace(/```$/i, '')
    .replace(/^["'《》「」“”‘’]+|["'《》「」“”‘’]+$/g, '')
    .replace(/\s*\n+\s*/g, ',')
    .trim()
  return out || src
}

/**
 * 把(可能很长的)创作需求浓缩成 100 字以内的核心摘要(纯文本,用于页面展示)。
 */
export async function summarizeRequirement(text: string, signal?: AbortSignal): Promise<string> {
  const req = (text || '').trim()
  if (!req) return ''
  const system =
    '你是文案助手。把下面的创作需求浓缩成一段核心摘要,100字以内,点明产品+人群+核心卖点+目标即可。' +
    '纯文本,不要 markdown 符号(不要 *、#、- 等)、不要标题、不要分点,直接输出摘要。'
  const out = await chatOnce(system, req, signal, 200)
  // 不再清洗 markdown(前端按 md 渲染),仅去代码块围栏与裁剪长度
  return out
    .replace(/^```(json)?/i, '')
    .replace(/```$/i, '')
    .trim()
    .slice(0, 160)
}

/**
 * 把"生成某个独立元素(素材)的意图/目的/语境"交给本地 Qwen,
 * 润成一版**干净、可直接用于文生图模型**的画面提示词。
 * 关键:只保留画面本身(主体/外形/材质/姿态/光线/纯色简洁背景/便于抠图),
 * 剔除"广告目的、用途、营销、为了…"等会干扰出图的非画面性文字。
 * 失败由调用方兜底(退回原意图文本)。
 */
export async function refineElementPrompt(
  intent: string,
  opts: { name?: string; kind?: string; style?: string; signal?: AbortSignal } = {},
): Promise<string> {
  const src = (intent || '').trim()
  if (!src) return ''
  const system =
    '你是 AI 绘画提示词专家。下面是用户对【一个独立元素】的生成意图(可能含广告目的、用途、语境等说明)。' +
    '请据此输出一段简洁、具体、可直接用于文生图模型的中文画面提示词。要求:' +
    '①只描述这一个元素本身——主体、外形、材质、颜色、姿态/形态、景别、光线氛围、关键细节;' +
    '②画面只含该单一元素,背景简洁干净;' +
    '③不要出现"广告/营销/目的/用途/为了/吸引/卖点"等与画面无关的词;' +
    '④不要编号、不要引号、不要解释、不要换行,直接输出一段提示词。'
  const user = [
    opts.name && `元素:${opts.name}`,
    opts.kind && `类型:${opts.kind}`,
    opts.style && `视觉风格:${opts.style}`,
    `生成意图:${src}`,
  ]
    .filter(Boolean)
    .join('\n')
  const out = await chatOnce(system, user, opts.signal, 220)
  const cleaned = out
    .replace(/^```(\w+)?/i, '')
    .replace(/```$/i, '')
    .replace(/^["'《》「」“”‘’]+|["'《》「」“”‘’]+$/g, '')
    .replace(/\s*\n+\s*/g, ',')
    .trim()
  return cleaned || src
}
