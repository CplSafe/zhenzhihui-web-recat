/**
 * AI 文案/提示词辅助客户端。
 *
 * 统一走业务后端 AI 网关(/api/v1/ai/responses,operation_code: responses.multimodal),
 * 见 ./aiResponses。workspaceId / 套餐候选由其内部从 store 读取,调用方无需关心。
 * (此前为临时直连「本地 vLLM Qwen」,现已对齐 Vue 切回后端网关。)
 */
import { runResponseText } from './aiResponses'

/** 不同修改框的润色侧重,用于系统提示词。 */
export type PolishKind = 'script' | 'line' | 'subtitle' | 'sound' | 'segment' | 'generic'

const SYSTEM_PROMPTS: Record<PolishKind, string> = {
  script:
    '你是专业的短视频分镜脚本润色助手。在保持原意与画面信息的前提下,让文案更生动、专业、有镜头感。只输出润色后的脚本正文,不要加解释、不要加引号。',
  line: '你是专业的影视台词润色助手。在保持原意的前提下,让台词更自然、口语化、有感染力。只输出润色后的台词,不要解释、不要引号。',
  subtitle: '你是专业的视频字幕润色助手。让字幕更简洁、准确、易读,长度适合屏幕显示。只输出润色后的字幕文本,不要解释。',
  sound: '你是专业的音效描述润色助手。让音效/配乐描述更具体、专业、可执行。只输出润色后的描述,不要解释。',
  segment:
    '你是专业的视频片段编辑助手。根据用户对这一片段的修改诉求,润色为一句话清晰、可执行的画面编辑指令。' +
    '只输出这一句润色后的纯文本指令,严禁输出 JSON、数组、代码块、分镜脚本或 <<<STORYBOARD_JSON>>> 等任何标记,不要解释、不要引号。',
  generic:
    '你是专业的中文文案润色助手。在保持原意的前提下让表达更清晰、生动、专业。' +
    '只输出润色后的纯文本,严禁输出 JSON、数组、代码块、分镜脚本或 <<<STORYBOARD_JSON>>> 等任何标记,不要解释、不要引号。',
}

export interface PolishOptions {
  kind?: PolishKind
  /** 额外上下文(如所属分镜主体/场景),拼到用户消息里帮助润色 */
  context?: string
  signal?: AbortSignal
  maxTokens?: number
}

/**
 * 统一清洗润色输出,保证只返回纯文案。
 * 共享网关模型有时会"惯性"吐出旧版分镜脚本(<<<STORYBOARD_JSON>>>[{prompt,voiceover,...}])或代码块,
 * 这里剥掉标记/围栏;若仍是分镜 JSON,则解析出其中可读字段(prompt/voiceover/subtitle...)拼成纯文本。
 */
function cleanPolishOutput(raw: string): string {
  let s = (raw || '').trim()
  if (!s) return ''
  // 1) 去掉 <<<STORYBOARD_JSON>>> ... <<<END_STORYBOARD_JSON>>> 标记(保留中间内容待进一步解析)
  s = s
    .replace(/<<<\s*STORYBOARD_JSON\s*>>>/gi, '')
    .replace(/<<<\s*END_STORYBOARD_JSON\s*>>>/gi, '')
    .trim()
  // 2) 去掉代码块围栏
  s = s
    .replace(/^```(\w+)?/i, '')
    .replace(/```$/i, '')
    .trim()
  // 3) 若是分镜 JSON(数组/对象,含 prompt/voiceover 等),解析出可读文案
  if (/^[[{]/.test(s)) {
    const m = s.match(/[[{][\s\S]*[\]}]/)
    if (m) {
      try {
        const parsed = JSON.parse(m[0])
        const arr = Array.isArray(parsed) ? parsed : [parsed]
        const pick = (o: any) =>
          String(o?.prompt || o?.voiceover || o?.line || o?.subtitle || o?.desc || o?.title || '').trim()
        const texts = arr.map(pick).filter(Boolean)
        if (texts.length) return texts.join('\n')
      } catch {
        /* 解析失败则走兜底:返回去标记后的文本 */
      }
    }
  }
  // 4) 去掉首尾包裹引号
  return s.replace(/^["'《》「」“”‘’]+|["'《》「」“”‘’]+$/g, '').trim()
}

/**
 * 润色一段文本,返回润色后的结果(失败抛错,调用方提示并保留原文)。
 */
export async function polishText(text: string, opts: PolishOptions = {}): Promise<string> {
  const input = (text || '').trim()
  if (!input) throw new Error('请输入内容后再润色')

  const kind = opts.kind || 'generic'
  const userContent = opts.context ? `【上下文】${opts.context}\n【待润色文本】${input}` : input

  const out = await runResponseText({
    system: SYSTEM_PROMPTS[kind],
    user: userContent,
    temperature: 0.7,
    maxTokens: opts.maxTokens ?? 512,
    signal: opts.signal,
  })
  const cleaned = cleanPolishOutput(out)
  if (!cleaned) throw new Error('润色结果为空,请重试')
  return cleaned
}

/**
 * 低层:发一轮纯文本对话,返回纯文本(供起名等复用)。
 */
async function chatOnce(system: string, user: string, signal?: AbortSignal, maxTokens = 64): Promise<string> {
  return runResponseText({ system, user, temperature: 0.6, maxTokens, signal })
}

/**
 * 根据用户的创作需求,自动生成简洁贴切的项目名称。
 * 失败抛错;调用方自行兜底(保留原名)。
 */
export async function generateProjectName(requirement: string, signal?: AbortSignal): Promise<string> {
  const req = (requirement || '').trim()
  if (!req) throw new Error('请输入创作需求')
  const system =
    '你是项目命名助手。根据用户的短视频创作需求,起一个简洁、贴切、有吸引力的中文项目名称。' +
    '要求:尽量简洁(大约 6 到 12 个字,完整表达即可),不含标点、引号、书名号、空格、序号,不要任何解释。只输出名称本身。'
  let name = await chatOnce(system, req, signal, 32)
  // 兜底清洗:去引号/标点/空白,只取首行(不截断字数,保留完整名称)
  name = name
    .replace(/["'《》「」“”‘’\s]/g, '')
    .replace(/[。,，.!！?？:：;；]/g, '')
    .trim()
  name = name.split('\n')[0]
  if (!name) throw new Error('生成名称为空,请重试')
  return name
}

/**
 * 为引导某一项生成「最可能的 5 个」简短候选(纯文本),可排除已展示项(换一批)。
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
  raw = raw
    .replace(/^```(json)?/i, '')
    .replace(/```$/i, '')
    .trim()
  const m = raw.match(/\[[\s\S]*\]/)
  try {
    const arr = JSON.parse(m ? m[0] : raw)
    if (Array.isArray(arr)) {
      return arr
        .map((x) =>
          String(x)
            .replace(/["'\s]/g, '')
            .trim(),
        )
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

/**
 * 营销 SKILLS:可选的营销技能包。key 为下拉选项文案,system 为该技能的拆解侧重。
 * 选择某 skill 后,把「用户想法 + 素材」交给对应技能,自动拆分生成「营销思路拆解」建议。
 */
export const SKILL_OPTIONS = ['电商营销广告skills', '本地餐饮营销skills'] as const
export type SkillOption = (typeof SKILL_OPTIONS)[number]

const SKILL_SYSTEM: Record<SkillOption, string> = {
  电商营销广告skills:
    '你是资深电商营销操盘手,擅长信息流/短视频电商广告。请基于「人货场 + 前3秒钩子→痛点→卖点→信任→促单CTA」的电商带货逻辑,' +
    '把用户的想法与素材拆解成可执行的营销思路。',
  本地餐饮营销skills:
    '你是资深本地生活/餐饮营销策划,擅长到店引流与门店短视频。请基于「门店人群 + 到店动机(味/价/景/聚)→种草→信任(真实出品)→到店核销CTA」的本地餐饮逻辑,' +
    '把用户的想法与素材拆解成可执行的营销思路。',
}

/**
 * 用所选 SKILL 把「产品信息」拆解成「营销思路拆解」建议。
 *
 * 方案 A(多模态直喂):把
 *   - 说明书(该 skill 的营销方法论 → system)
 *   - 产品信息 = 用户文字 + 上传素材图(user 文本 + 图片随请求作多模态附上)
 * 一次性交给后端 responses.multimodal,据说明书 + 产品信息产出拆解(不臆造、不脱离素材)。
 * 产出与 AI 引导的「创作需求」同类:结构清晰、可直接用于后续生成分镜脚本。
 * images 传图片地址(url/dataURL)。
 */
export async function skillBreakdown(
  input: { skill: string; requirement: string; images?: string[] },
  signal?: AbortSignal,
): Promise<string> {
  const req = (input.requirement || '').trim()
  const images = (input.images || []).filter(Boolean)
  if (!req && !images.length) throw new Error('请先输入想法或上传素材')

  // 说明书:该 skill 对应的营销方法论(主导 system)
  const manual = SKILL_SYSTEM[input.skill as SkillOption] || SKILL_SYSTEM['电商营销广告skills']
  const system =
    manual +
    '\n你只能依据用户提供的【产品信息】(下方文字 + 随请求附上的素材图)来分析,严禁脱离素材臆造不存在的产品/卖点;素材里没有的信息不要编。' +
    '请输出一份结构清晰的「营销思路拆解」,用要点分条呈现,至少覆盖:' +
    '【核心洞察】(目标人群+真实痛点/动机)、【创意概念】(一句话主创意/记忆点)、' +
    '【卖点&信任】(核心卖点与信任背书)、【行动号召CTA】、【表现形式/风格调性】。' +
    '不要直接写分镜脚本/台词/镜头画面,不要额外解释说明。'

  // 产品信息:用户文字 + 素材说明(图片随请求作多模态附上)
  const user =
    '【产品信息】\n' +
    `· 用户文字:${req || '(未填写,请基于素材图给出合理方向)'}\n` +
    (images.length
      ? `· 素材:已随请求附上 ${images.length} 张产品/场景图,请逐张看清实际出现的物体/品牌/场景/人物,据此拆解。`
      : '· 素材:无(仅据文字)')

  const out = await runResponseText({
    system,
    user,
    images: images.length ? images : undefined, // 多模态:说明书(system)+文字(user)+图片 一次性喂入
    temperature: 0.6,
    maxTokens: 4000,
    signal,
  })
  if (!out) throw new Error('生成为空,请重试')
  return out
}

/**
 * 营销思路拆解(结构化,动态):由模型按产品 / skill 自行拆出若干「分类 → 维度」。
 * 不再写死固定 8 维度——不同产品/skill 可拆出不同的模块。组件只按返回结构渲染(保留表格样式)。
 */
export interface MarketingField {
  /** 稳定标识(按位置生成 g{gi}-f{fi}),用于定位编辑 / 换一批 */
  key: string
  label: string
  hint?: string
  desc: string
  tags: string[]
}
export interface MarketingGroup {
  label: string
  fields: MarketingField[]
}
export interface MarketingBreakdownData {
  groups: MarketingGroup[]
}
/** 字段 key:动态结构里就是字符串 */
export type MarketingFieldKey = string

/** 按 key 找字段 */
export function marketingFieldByKey(data: MarketingBreakdownData | null, key: string): MarketingField | undefined {
  if (!data) return undefined
  for (const g of data.groups || []) for (const f of g.fields || []) if (f.key === key) return f
  return undefined
}

/** 按 key 局部更新某字段,返回新数据(不可变) */
export function patchMarketingField(
  data: MarketingBreakdownData,
  key: string,
  patch: Partial<MarketingField>,
): MarketingBreakdownData {
  return {
    groups: (data.groups || []).map((g) => ({
      ...g,
      fields: g.fields.map((f) => (f.key === key ? { ...f, ...patch } : f)),
    })),
  }
}

/**
 * 方案 A(多模态直喂)结构化版:把 说明书(system)+ 产品信息(文字+素材图,多模态)交给模型,
 * 由模型按产品 / skill 自行拆出若干「分类 → 维度」,每维度 {label, hint, desc:一句话, tags:候选标签[]}。
 * 维度不写死——不同产品/skill 拆出的模块可不同;前端只按返回结构渲染(保留表格样式)。
 */
export async function skillBreakdownStructured(
  input: { skill: string; requirement: string; images?: string[] },
  signal?: AbortSignal,
): Promise<MarketingBreakdownData> {
  const req = (input.requirement || '').trim()
  const images = (input.images || []).filter(Boolean)
  if (!req && !images.length) throw new Error('请先输入想法或上传素材')

  const manual = SKILL_SYSTEM[input.skill as SkillOption] || SKILL_SYSTEM['电商营销广告skills']
  const system =
    manual +
    '\n你只能依据用户提供的【产品信息】(下方文字 + 随请求附上的素材图)来分析,严禁脱离素材臆造。' +
    '请把产品信息拆解成若干「营销点」:先分成 2~4 个【分类】,每个分类下 1~3 个【维度】;' +
    '分类名与维度名请结合该产品 / 该 skill 自行确定(不同产品/skill 拆出的维度可不同,不必套用固定模板)。' +
    '每个维度给:label=维度名(≤8字)、hint=一句提示(≤12字,可留空)、desc=一句话描述(≤30字,具体紧扣素材)、' +
    'tags=3~4个候选短标签(每个≤8字,互不相同,可直接选用)。' +
    '只输出严格 JSON:{"groups":[{"label":"分类名","fields":[{"label":"维度名","hint":"提示","desc":"一句话","tags":["",""]}]}]};不要解释、不要代码块标记。'
  const user =
    '【产品信息】\n' +
    `· 用户文字:${req || '(未填写,请基于素材图给出合理方向)'}\n` +
    (images.length
      ? `· 素材:已随请求附上 ${images.length} 张产品/场景图,请逐张看清实际物体/品牌/场景/人物。`
      : '· 素材:无(仅据文字)')

  let raw = await runResponseText({
    system,
    user,
    images: images.length ? images : undefined,
    temperature: 0.6,
    maxTokens: 2200,
    signal,
  })
  raw = (raw || '')
    .replace(/^```(json)?/i, '')
    .replace(/```$/i, '')
    .trim()
  const m = raw.match(/\{[\s\S]*\}/)
  try {
    const parsed = JSON.parse(m ? m[0] : raw)
    const groupsRaw = Array.isArray(parsed?.groups) ? parsed.groups : []
    const groups: MarketingGroup[] = groupsRaw
      .map((g: any, gi: number) => ({
        label: String(g?.label || `分类${gi + 1}`).trim(),
        fields: (Array.isArray(g?.fields) ? g.fields : []).map((f: any, fi: number) => ({
          key: `g${gi}-f${fi}`,
          label: String(f?.label || `维度${fi + 1}`).trim(),
          hint: String(f?.hint || '').trim() || undefined,
          desc: String(f?.desc || '').trim(),
          tags: Array.isArray(f?.tags)
            ? f.tags
                .map((t: any) =>
                  String(t)
                    .replace(/["'\s]/g, '')
                    .trim(),
                )
                .filter(Boolean)
                .slice(0, 4)
            : [],
        })),
      }))
      .filter((g: MarketingGroup) => g.fields.length)
    if (!groups.length) throw new Error('empty')
    return { groups }
  } catch {
    throw new Error('营销思路拆解解析失败,请重试')
  }
}

/** 把结构化拆解拼成纯文本,作为后续「生成分镜脚本」的输入(比原始需求更完整)。 */
export function marketingDataToText(data: MarketingBreakdownData): string {
  const lines: string[] = []
  for (const g of data?.groups || [])
    for (const f of g.fields || []) {
      const d = (f.desc || '').trim()
      if (d) lines.push(`${f.label}:${d}`)
    }
  return lines.join('\n')
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
 * 用于 AI 引导对话框的预填(因材施教,不再千篇一律)。images 传图片地址(url/dataURL)。
 */
export async function analyzeForGuide(
  input: { text?: string; images?: string[] },
  signal?: AbortSignal,
): Promise<GuideSuggestions> {
  const text = (input.text || '').trim()
  const images = (input.images || []).filter(Boolean)
  if (!text && !images.length) return {}

  const user =
    `用户的创作想法:${text || '(未填写)'}\n` +
    (images.length ? '用户还上传了素材图片(已随请求附上)。请务必结合图片中实际出现的物体/场景/人物来推断。' : '') +
    '请为这条信息流广告推断各要素建议。'

  const system =
    '你是资深信息流广告策划。根据用户的想法和(若有)素材图片,推断以下要素并给出简短建议(中文,每项不超过20字):' +
    'product(产品/品牌)、sellpoint(核心卖点)、audience(目标人群)、pain(用户痛点)、scene(使用场景)、' +
    'goal(营销目标与CTA)、plot(表现形式/剧情类型)、tone(风格调性)。' +
    '紧扣用户素材与想法,不要臆造;某项看不出就留空字符串。' +
    '只输出严格 JSON 对象(键为上述英文,值为字符串),不要解释、不要代码块标记。'

  let raw = ''
  try {
    raw = await runResponseText({
      system,
      user,
      images: images.length ? images : undefined,
      temperature: 0.5,
      maxTokens: 400,
      signal,
    })
  } catch {
    return {}
  }
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
    /** 该镜「选中参与出图」的素材:看图识别真实外观;有 url 走多模态读图 */
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
    // 让模型看清每张素材,写出「有故事性、连贯」的单幅画面,把所有选中素材有机编织进本镜叙事意图
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
      `随请求附上 ${withImg.length} 张选中素材图(顺序如下,都要编织进画面,一张都别漏),请逐张看清真实外观:`,
      ...withImg.map((m, i) => `第${i + 1}张素材:${m.name || ''}${m.kind ? `/${m.kind}` : ''}`),
    ]
      .filter(Boolean)
      .join('\n')
    raw = await runResponseText({
      system,
      user: textPart,
      images: withImg.map((m) => m.url as string),
      temperature: 0.6,
      maxTokens: 400,
      signal,
    })
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
      endpoint: useVl ? '后端 responses.multimodal(含素材图)' : '后端 responses.multimodal(纯文本)',
      system,
      userText: textPart,
      materials: mats.map((m) => ({ name: m.name, kind: m.kind, url: m.url })),
      raw,
      prompt,
    },
  }
}

/**
 * 按【参考图】(真实产品/主体照片)+ 意图,读图后产出"图生图"提示词。
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
  const user = [
    opts.name && `主体:${opts.name}`,
    opts.kind && `类型:${opts.kind}`,
    opts.style && `视觉风格:${opts.style}`,
    `生成意图:${src}`,
    '参考图已随请求附上。',
  ]
    .filter(Boolean)
    .join('\n')
  const out = (
    await runResponseText({
      system,
      user,
      images: [imageUrl],
      temperature: 0.5,
      maxTokens: 280,
      signal: opts.signal,
    })
  )
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
 * 把"生成某个独立元素(素材)的意图/目的/语境"润成一版**干净、可直接用于文生图模型**的画面提示词。
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
