/**
 * AI 文案/提示词辅助客户端。
 *
 * 统一走业务后端 AI 网关(/api/v1/ai/responses,operation_code: responses.multimodal),
 * 见 ./aiResponses。workspaceId / 套餐候选由其内部从 store 读取,调用方无需关心。
 * (此前为临时直连「本地 vLLM Qwen」,现已对齐 Vue 切回后端网关。)
 */
import { runResponseText, type AiResponseRequestContext } from './aiResponses'
// skill 方法论说明书(原样导入 .md,不在此硬编码长文本,便于维护)
import skillEcommerceManual from './skills/信息电商.md?raw'
import skillLocalLifeManual from './skills/本地生活.md?raw'
import { SMART_SCRIPT_OPTIONS, normalizeSmartScriptName, type SmartScriptOption } from '@/utils/smartScriptOptions'

/** 不同修改框的润色侧重,用于系统提示词。 */
export type PolishKind = 'script' | 'line' | 'subtitle' | 'sound' | 'segment' | 'generic'

/** 按润色场景隔离的系统提示词，约束模型只输出可直接回填的文本。 */
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

/** 单次文本润色的场景、上下文与取消配置。 */
export interface PolishOptions {
  kind?: PolishKind
  /** 额外上下文(如所属分镜主体/场景),拼到用户消息里帮助润色 */
  context?: string
  /** 智能成片入口锁定的 responses.multimodal 模型版本。 */
  modelVersionId?: number
  /** 与模型版本绑定的工作空间和 schema 快照。 */
  requestContext?: AiResponseRequestContext
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
    modelVersionId: opts.modelVersionId,
    requestContext: opts.requestContext,
    signal: opts.signal,
  })
  const cleaned = cleanPolishOutput(out)
  if (!cleaned) throw new Error('润色结果为空,请重试')
  return cleaned
}

/**
 * 低层:发一轮纯文本对话,返回纯文本(供起名等复用)。
 */
async function chatOnce(
  system: string,
  user: string,
  signal?: AbortSignal,
  maxTokens = 64,
  modelVersionId?: number,
  requestContext?: AiResponseRequestContext,
): Promise<string> {
  return runResponseText({ system, user, temperature: 0.6, maxTokens, modelVersionId, requestContext, signal })
}

/** 智能成片与爆款复制两种项目命名语境。 */
export type ProjectNameFlow = 'smart' | 'hot-copy'

/** 用于校验和生成项目名的流程与目标时长上下文。 */
export interface ProjectNameContext {
  flow?: ProjectNameFlow
  durationSec?: number
  /** 智能成片入口锁定的 responses.multimodal 模型版本。 */
  modelVersionId?: number
  /** 与模型版本绑定的工作空间和 schema 快照。 */
  requestContext?: AiResponseRequestContext
}

/** 通过文字需求生成项目名的参数。 */
export interface GenerateProjectNameOptions extends ProjectNameContext {
  requirement: string
  signal?: AbortSignal
}

/** 项目名规则校验结果，reason 供页面展示或回退。 */
export interface ProjectNameValidationResult {
  valid: boolean
  reason?: string
}

/** 项目名中的时长与跨流程词识别规则。 */
const PROJECT_NAME_DURATION_PATTERN = /(?:\d+(?:\.\d+)?|[零〇一二两三四五六七八九十百千]+)\s*秒(?:钟)?/
/** 智能成片项目名中不应出现的爆款复制跨流程词。 */
const SMART_CROSS_FLOW_PATTERN = /爆款(?:复制|复刻|仿拍|克隆|命名助手)|(?:复制|复刻)爆款/
/** 爆款复制项目名中不应出现的智能成片跨流程词。 */
const HOT_COPY_CROSS_FLOW_PATTERN = /智能成片|智能制片/

/** 克隆一个带全局标志的正则，避免复用时 lastIndex 相互影响。 */
function globalPattern(pattern: RegExp): RegExp {
  return new RegExp(pattern.source, 'g')
}

/** 清理 AI 命名输出的换行、空白、引号和标点。 */
function cleanProjectNameOutput(raw: string): string {
  return (raw || '')
    .split(/\r?\n/)[0]
    .replace(/["'《》「」“”‘’\s]/g, '')
    .replace(/[。,，.!！?？:：;；]/g, '')
    .trim()
}

/** 将常见中文数字表达转为阿拉伯数字，用于项目名时长校验。 */
function parseChineseNumber(value: string): number | undefined {
  const digits: Record<string, number> = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  }
  const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000 }
  if (!/[十百千]/.test(value)) {
    const joined = Array.from(value)
      .map((char) => digits[char])
      .join('')
    const parsed = Number(joined)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  let total = 0
  let current = 0
  for (const char of value) {
    if (char in digits) {
      current = digits[char]
      continue
    }
    const unit = units[char]
    if (!unit) return undefined
    total += (current || 1) * unit
    current = 0
  }
  return total + current
}

/** 提取项目名中所有“若干秒”表达并转为数值。 */
function projectNameDurations(name: string): number[] {
  const matches = name.match(globalPattern(PROJECT_NAME_DURATION_PATTERN)) || []
  return matches
    .map((match) => match.replace(/\s*秒(?:钟)?$/, ''))
    .map((value) => (/^\d/.test(value) ? Number(value) : parseChineseNumber(value)))
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
}

/** 校验项目名是否符合当前创作流程和目标时长，不会触发 AI 请求。 */
export function validateProjectName(name: string, context: ProjectNameContext = {}): ProjectNameValidationResult {
  const value = (name || '').trim()
  if (!value) return { valid: false, reason: '项目名称为空' }
  if (value.includes('命名助手')) return { valid: false, reason: '项目名称不能包含“命名助手”' }
  if (context.flow === 'smart' && SMART_CROSS_FLOW_PATTERN.test(value)) {
    return { valid: false, reason: '智能成片项目名称不能包含爆款复制或爆款复刻等跨流程词' }
  }
  if (context.flow === 'hot-copy' && HOT_COPY_CROSS_FLOW_PATTERN.test(value)) {
    return { valid: false, reason: '爆款复制项目名称不能包含“智能成片”等跨流程词' }
  }

  const durations = projectNameDurations(value)
  if (durations.length) {
    const expected = Number(context.durationSec)
    if (!Number.isFinite(expected) || expected <= 0) {
      return { valid: false, reason: '项目名称不应包含秒数' }
    }
    const mismatched = durations.find((duration) => Math.abs(duration - expected) > 0.001)
    if (mismatched !== undefined) {
      return {
        valid: false,
        reason: `项目名称中的 ${mismatched} 秒与目标时长 ${expected} 秒不一致`,
      }
    }
  }
  return { valid: true }
}

/** 本地兜底命名所需的文字需求和流程上下文。 */
export interface CreateProjectNameFallbackOptions extends ProjectNameContext {
  requirement: string
}

/** 根据需求在本地生成安全兜底名称，不会触发 AI 请求。 */
export function createProjectNameFallback(requirement: string, context?: ProjectNameContext): string
/** 使用对象参数生成本地兜底项目名。 */
export function createProjectNameFallback(options: CreateProjectNameFallbackOptions): string
/** 兼容字符串和对象两种调用形式的兜底命名实现。 */
export function createProjectNameFallback(
  input: string | CreateProjectNameFallbackOptions,
  suppliedContext: ProjectNameContext = {},
): string {
  const requirement = typeof input === 'string' ? input : input?.requirement || ''
  const context = typeof input === 'string' ? suppliedContext : input
  const crossFlowPattern =
    context.flow === 'smart'
      ? globalPattern(SMART_CROSS_FLOW_PATTERN)
      : context.flow === 'hot-copy'
        ? globalPattern(HOT_COPY_CROSS_FLOW_PATTERN)
        : undefined
  let name = cleanProjectNameOutput(requirement).replace(globalPattern(PROJECT_NAME_DURATION_PATTERN), '')
  if (crossFlowPattern) name = name.replace(crossFlowPattern, '')
  name = name.replace(/命名助手/g, '').trim()
  name = Array.from(name).slice(0, 12).join('')

  const fallback = context.flow === 'hot-copy' ? '爆款复制项目' : '智能成片项目'
  return name && validateProjectName(name, context).valid ? name : fallback
}

/** 按当前流程和时长规则组装项目命名系统提示词。 */
function projectNameSystemPrompt(context: ProjectNameContext): string {
  const flowRule =
    context.flow === 'smart'
      ? '当前业务是“智能成片”，名称必须围绕用户的智能成片创作主题，严禁出现“爆款复制”“爆款复刻”“爆款仿拍”等其他流程词。'
      : context.flow === 'hot-copy'
        ? '当前业务是“爆款复制”，名称应围绕源视频的复刻或改编主题，严禁出现“智能成片”等其他流程词。'
        : '名称应准确概括用户的短视频创作主题。'
  const durationRule =
    Number.isFinite(Number(context.durationSec)) && Number(context.durationSec) > 0
      ? `目标视频时长是 ${Number(context.durationSec)} 秒，该时长只用于理解创作约束，不要写入项目名称。`
      : '不要在项目名称中写视频秒数。'
  return (
    '你是短视频项目命名专家。根据用户的创作需求，起一个简洁、贴切、有吸引力的中文项目名称。' +
    flowRule +
    durationRule +
    '所有流程的名称都不得包含“命名助手”。要求:尽量简洁(大约 6 到 12 个字,完整表达即可),不含标点、引号、书名号、空格、序号,不要任何解释。只输出名称本身。'
  )
}

/**
 * 根据用户的创作需求,自动生成简洁贴切的项目名称。
 * 失败抛错;调用方自行兜底(保留原名)。
 */
export function generateProjectName(requirement: string, signal?: AbortSignal): Promise<string>
/** 使用结构化上下文生成项目名。 */
export function generateProjectName(options: GenerateProjectNameOptions, signal?: AbortSignal): Promise<string>
/** 兼容字符串和对象参数的 AI 命名实现。 */
export async function generateProjectName(
  input: string | GenerateProjectNameOptions,
  signal?: AbortSignal,
): Promise<string> {
  const options = typeof input === 'string' ? undefined : input
  const req = (typeof input === 'string' ? input : input?.requirement || '').trim()
  if (!req) throw new Error('请输入创作需求')
  const context: ProjectNameContext = {
    flow: options?.flow,
    durationSec: options?.durationSec,
    modelVersionId: options?.modelVersionId,
    requestContext: options?.requestContext,
  }
  const name = cleanProjectNameOutput(
    await chatOnce(
      projectNameSystemPrompt(context),
      req,
      signal ?? options?.signal,
      32,
      context.modelVersionId,
      context.requestContext,
    ),
  )
  // 兜底清洗:去引号/标点/空白,只取首行(不截断字数,保留完整名称)
  if (!name) throw new Error('生成名称为空,请重试')
  const validation = validateProjectName(name, context)
  if (!validation.valid) throw new Error(`生成名称不符合要求：${validation.reason}`)
  return name
}

/**
 * 据用户上传的素材图(多模态)自动生成项目名称。
 * 用于「未填写创作需求、仅上传了素材」时:看图识别实际产品/主体/场景后命名。
 * 可选附上需求文字作为补充语境。失败抛错;调用方自行兜底(保留原名)。
 */
export interface GenerateProjectNameFromImagesOptions extends ProjectNameContext {
  requirement?: string
  signal?: AbortSignal
}

/** 结合素材图和可选文字需求生成项目名，并执行与文本命名相同的规则校验。 */
export function generateProjectNameFromImages(
  images: string[],
  requirement?: string,
  signal?: AbortSignal,
): Promise<string>
/** 使用图片和结构化上下文生成项目名。 */
export function generateProjectNameFromImages(
  images: string[],
  options?: GenerateProjectNameFromImagesOptions,
  signal?: AbortSignal,
): Promise<string>
/** 兼容文字和对象补充信息的多模态命名实现。 */
export async function generateProjectNameFromImages(
  images: string[],
  input?: string | GenerateProjectNameFromImagesOptions,
  signal?: AbortSignal,
): Promise<string> {
  const imgs = (images || []).filter(Boolean)
  if (!imgs.length) throw new Error('请先上传素材')
  const options = typeof input === 'string' ? undefined : input
  const requirement = typeof input === 'string' ? input : options?.requirement
  const context: ProjectNameContext = {
    flow: options?.flow,
    durationSec: options?.durationSec,
    modelVersionId: options?.modelVersionId,
    requestContext: options?.requestContext,
  }
  const system =
    '你是素材理解专家。下面随请求附上了用户上传的素材图(产品/主体/场景)。请逐张看清图中实际出现的物体/品牌/场景,' +
    '据此为这条短视频项目起一个简洁、贴切、有吸引力的中文项目名称。' +
    '要求:紧扣素材实际内容、不臆造。' +
    projectNameSystemPrompt(context)
  const user =
    (requirement?.trim() ? `用户补充想法:${requirement.trim()}\n` : '') +
    `已随请求附上 ${imgs.length} 张素材图,请据图为项目命名。`
  const name = cleanProjectNameOutput(
    await runResponseText({
      system,
      user,
      images: imgs,
      temperature: 0.6,
      maxTokens: 48,
      modelVersionId: context.modelVersionId,
      requestContext: context.requestContext,
      signal: signal ?? options?.signal,
    }),
  )
  // 与 generateProjectName 一致的兜底清洗:去引号/标点/空白,只取首行
  if (!name) throw new Error('生成名称为空,请重试')
  const validation = validateProjectName(name, context)
  if (!validation.valid) throw new Error(`生成名称不符合要求：${validation.reason}`)
  return name
}

/**
 * 主推产品锚定(多图版):一次性看用户上传的【多张】素材图 + 分镜主体清单,综合判断:
 *  - 把同一件产品的多张图归为一组(imageIndexes,1-based);不同产品分到不同组;
 *  - 每组给出 product 名称、kind,以及命中的主体名 matches(产品本身/局部/细节/穿戴它的人;场景/背景/无关道具不算);
 *  - 每个主体最多归一个产品(互斥)。
 * 返回 { products: [{ product, kind, imageIndexes, matches }] }。失败返回空。
 */
export async function matchUploadsToSubjects(
  images: string[],
  subjectNames: string[],
  signal?: AbortSignal,
  modelVersionId?: number,
  requestContext?: AiResponseRequestContext,
): Promise<{ products: { product: string; kind: string; imageIndexes: number[]; matches: string[] }[] }> {
  const imgs = (images || []).filter(Boolean)
  if (!imgs.length) return { products: [] }
  const names = (subjectNames || []).map((n) => String(n || '').trim()).filter(Boolean)
  const system =
    '你是电商短视频「主推产品」识别助手。下面随请求按顺序附上用户上传的多张素材图(第1张、第2张…)。请综合所有图:' +
    '①把【同一件产品】的多张图归为一组(它们的序号写进同一个 imageIndexes 数组,从1开始);不同产品分到不同组;' +
    '②为每组给出简短具体的中文名称 product 与类型 kind(如 服饰/数码/食品/箱包);' +
    '③从给定【分镜主体清单】里,为每组选出「就是该产品本身、或它的局部/细节/穿戴它的人」的主体名 matches——' +
    '例如产品是旗袍:旗袍、立领、盘扣、印花、面料特写、穿着它的模特,都算同一产品;但场景/背景/与产品无关的道具(室内背景、桌子、团扇等)不算;' +
    '每个主体最多归一个产品,选不到就给空数组。' +
    '只输出严格 JSON:{"products":[{"product":"...","kind":"...","imageIndexes":[1,2],"matches":["..."]}]},不要解释、不要代码块标记。'
  const user = `共 ${imgs.length} 张素材图(按顺序附上)。分镜主体清单:${names.length ? names.join('、') : '(空)'}`
  let raw = ''
  try {
    raw = await runResponseText({
      system,
      user,
      images: imgs,
      temperature: 0.3,
      maxTokens: 500,
      modelVersionId,
      requestContext,
      signal,
    })
  } catch (error) {
    if (signal?.aborted || (error as any)?.name === 'AbortError') throw error
    return { products: [] }
  }
  raw = raw
    .replace(/^```(json)?/i, '')
    .replace(/```$/i, '')
    .trim()
  const m = raw.match(/\{[\s\S]*\}/)
  try {
    const o = JSON.parse(m ? m[0] : raw)
    const arr = Array.isArray(o?.products) ? o.products : []
    const used = new Set<string>() // 主体互斥:已归某产品的不再归其它
    const products = arr
      .map((p: any) => {
        const product = String(p?.product || '')
          .replace(/["'《》「」“”‘’\s]/g, '')
          .trim()
        const kind = String(p?.kind || '').trim()
        const imageIndexes = (Array.isArray(p?.imageIndexes) ? p.imageIndexes : [])
          .map((x: any) => Number(x) || 0)
          .filter((n: number) => n >= 1 && n <= imgs.length)
          .filter((n: number, index: number, all: number[]) => all.indexOf(n) === index)
        const matchesRaw = Array.isArray(p?.matches) ? p.matches : []
        const matches: string[] = []
        for (const rawN of matchesRaw) {
          const x = String(rawN || '')
            .replace(/^@/, '')
            .trim()
          if (!x) continue
          const hit = names.find((n) => n === x) || names.find((n) => n.includes(x) || x.includes(n))
          if (hit && !used.has(hit)) {
            used.add(hit)
            matches.push(hit)
          }
        }
        // 兜底:没给 imageIndexes 时,默认整组用全部图(单产品场景最常见)
        return { product, kind, imageIndexes: imageIndexes.length ? imageIndexes : imgs.map((_, i) => i + 1), matches }
      })
      .filter((p: any) => p.product || p.matches.length)
    return { products }
  } catch {
    return { products: [] }
  }
}

/**
 * 为引导某一项生成「最可能的 5 个」简短候选(纯文本),可排除已展示项(换一批)。
 */
export async function suggestOptions(
  input: { label: string; hint?: string; context?: string; exclude?: string[] },
  signal?: AbortSignal,
  modelVersionId?: number,
  requestContext?: AiResponseRequestContext,
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
    raw = await chatOnce(system, user, signal, 200, modelVersionId, requestContext)
  } catch (error) {
    if (signal?.aborted || (error as any)?.name === 'AbortError') throw error
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
      const normalizeOption = (value: unknown) =>
        String(value)
          .replace(/["'\s]/g, '')
          .trim()
      const excluded = new Set(exclude.map(normalizeOption).filter(Boolean))
      const seen = new Set<string>()
      return arr
        .map(normalizeOption)
        .filter((value) => {
          if (!value || excluded.has(value) || seen.has(value)) return false
          seen.add(value)
          return true
        })
        .slice(0, 5)
    }
  } catch {
    /* ignore */
  }
  return []
}

/**
 * 营销 SKILLS:可选的营销技能包。key 为下拉选项文案,system 为该技能的拆解侧重。
 * 选择某 skill 后,把「用户想法 + 素材」交给对应技能,自动拆分生成「营销思路拆解」建议。
 */
/** 将每个 skill 的完整方法论说明书映射为系统提示词。 */
const SKILL_SYSTEM: Record<SmartScriptOption, string> = {
  电商广告: skillEcommerceManual,
  本地生活广告: skillLocalLifeManual,
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
  /** 用户点击候选后选中的标签:展示在标题行右侧(不改动 desc 原文案) */
  picked?: string[]
}

/** 营销拆解中的一个动态分类及其维度。 */
export interface MarketingGroup {
  label: string
  fields: MarketingField[]
}

/** 营销方法论生成的分组化结构数据。 */
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
  input: {
    skill: string
    requirement: string
    images?: string[]
    modelVersionId?: number
    requestContext?: AiResponseRequestContext
  },
  signal?: AbortSignal,
): Promise<MarketingBreakdownData> {
  const req = (input.requirement || '').trim()
  const images = (input.images || []).filter(Boolean)
  if (!req && !images.length) throw new Error('请先输入想法或上传素材')

  // skill 说明书本身已包含【拆解方法 + 维度字段规则 + 严格 JSON 输出格式 + 示例】,直接作为 system,
  // 不再叠加旧的格式说明(避免与说明书里的规则重复打架)。
  const normalizedSkill = normalizeSmartScriptName(input.skill)
  const system = SKILL_SYSTEM[normalizedSkill as SmartScriptOption] || SKILL_SYSTEM[SMART_SCRIPT_OPTIONS[0]]
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
    modelVersionId: input.modelVersionId,
    requestContext: input.requestContext,
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
            ? Array.from(
                new Set<string>(
                  f.tags
                    .map((t: any) =>
                      String(t)
                        .replace(/["'\s]/g, '')
                        .trim(),
                    )
                    .filter(Boolean),
                ),
              ).slice(0, 4)
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
      const picked = (f.picked || []).filter(Boolean)
      const body = [d, ...picked].filter(Boolean).join('、')
      if (body) lines.push(`${f.label}:${body}`)
    }
  return lines.join('\n')
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
    /** 智能成片入口锁定的 responses.multimodal 模型版本。 */
    modelVersionId?: number
    /** 与模型版本绑定的工作空间和 schema 快照。 */
    requestContext?: AiResponseRequestContext
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
      .trim()
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
      modelVersionId: input.modelVersionId,
      requestContext: input.requestContext,
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
    raw = await chatOnce(system, textPart, signal, 300, input.modelVersionId, input.requestContext)
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
  opts: {
    name?: string
    kind?: string
    style?: string
    modelVersionId?: number
    requestContext?: AiResponseRequestContext
    signal?: AbortSignal
  } = {},
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
      modelVersionId: opts.modelVersionId,
      requestContext: opts.requestContext,
      signal: opts.signal,
    })
  )
    .replace(/^```(\w+)?/i, '')
    .replace(/```$/i, '')
    .trim()
    .replace(/^["'《》「」“”‘’]+|["'《》「」“”‘’]+$/g, '')
    .replace(/\s*\n+\s*/g, ',')
    .trim()
  return out || src
}

/**
 * 把(可能很长的)创作需求浓缩成 100 字以内的核心摘要(纯文本,用于页面展示)。
 */
export async function summarizeRequirement(
  text: string,
  signal?: AbortSignal,
  modelVersionId?: number,
  requestContext?: AiResponseRequestContext,
): Promise<string> {
  const req = (text || '').trim()
  if (!req) return ''
  const system =
    '你是文案助手。把下面的创作需求浓缩成一段核心摘要,100字以内,点明产品+人群+核心卖点+目标即可。' +
    '纯文本,不要 markdown 符号(不要 *、#、- 等)、不要标题、不要分点,直接输出摘要。'
  const out = await chatOnce(system, req, signal, 200, modelVersionId, requestContext)
  // 不再清洗 markdown(前端按 md 渲染),仅去代码块围栏与裁剪长度
  const cleaned = out
    .replace(/^```(\w+)?/i, '')
    .replace(/```$/i, '')
    .trim()
  return Array.from(cleaned).slice(0, 100).join('')
}

/**
 * 把"生成某个独立元素(素材)的意图/目的/语境"润成一版**干净、可直接用于文生图模型**的画面提示词。
 * 关键:只保留画面本身(主体/外形/材质/姿态/光线/纯色简洁背景/便于抠图),
 * 剔除"广告目的、用途、营销、为了…"等会干扰出图的非画面性文字。
 * 失败由调用方兜底(退回原意图文本)。
 */
export async function refineElementPrompt(
  intent: string,
  opts: {
    name?: string
    kind?: string
    style?: string
    modelVersionId?: number
    requestContext?: AiResponseRequestContext
    signal?: AbortSignal
  } = {},
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
  const out = await chatOnce(system, user, opts.signal, 220, opts.modelVersionId, opts.requestContext)
  const cleaned = out
    .replace(/^```(\w+)?/i, '')
    .replace(/```$/i, '')
    .trim()
    .replace(/^["'《》「」“”‘’]+|["'《》「」“”‘’]+$/g, '')
    .replace(/\s*\n+\s*/g, ',')
    .trim()
  return cleaned || src
}
