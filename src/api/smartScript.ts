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
import { runResponseText, streamResponseText, type AiResponseRequestContext } from './aiResponses'

/** 整条分镜脚本生成所需的需求、样式、比例、时长和素材。 */
interface GenerateArgs {
  requirement: string
  style?: string
  ratio?: string
  duration?: string
  images?: string[] // objectURL / dataURL / http,送入后端前会上传成 asset(inputAssets)
  /** 用户在“生成脚本”阶段显式选择的模型版本。 */
  modelVersionId?: number
  /** 本轮脚本生成锁定的工作空间，后续主体提取和合并必须复用。 */
  requestContext?: AiResponseRequestContext
  signal?: AbortSignal
}

/** 整条信息流广告分镜的结构、主体命名和输出格式约束。 */
const SYSTEM =
  '你是资深短视频(信息流广告)分镜脚本师。根据创作需求(及可能提供的素材图片)生成一条可执行的分镜脚本。' +
  '为每个镜头给出:镜头时长(如 5s)、画面描述(中文,具体、可拍摄),并拆分该镜头涉及的【视觉主体】(人物/场景/物体/产品),用于后续素材准备。' +
  '同时,结合整体剧情与该镜头画面,为每个镜头写出:台词/旁白(voiceover)、字幕(subtitle)、音效(sfx);没有就给空字符串。' +
  '台词字数必须 ≤ 该镜头时长(秒)×4(避免语速过快,如 5 秒镜头台词不超过 20 字);字幕要简短(通常 ≤15 字,不超过台词)。' +
  '【硬性要求】每个镜头的 subjects 数组都不能为空:必须列出该画面里出现的全部独立视觉元素(人物/场景/物体/产品),至少 1 个,通常 2~4 个;subjects 字段一律不可省略。' +
  '【命名硬性要求】每个主体的 name 必须是【具体名词】(如「年轻女性」「皮肤管理师」「护肤仪器」「咨询区」「精华液瓶」),' +
  '严禁使用「素材」「主体」「元素」「图片」「画面」「对象」「内容」这类泛指词,也不要只写编号(素材1/素材2);否则视为无效。' +
  '注意:只拆需要视觉素材的主体;不要把台词、旁白、字幕、文案、标语、口号、CTA、标题等文本类元素列为主体。' +
  '若提供了素材图片,务必逐张判断它对应哪个主体:对应的主体必须加 imageIndex 字段(从1开始,表示第几张素材图),' +
  '尽量让每张素材图都被某个主体引用(场景图配场景主体、产品图配产品主体);确实无对应的主体才省略该字段。' +
  '严格只输出 JSON(不要解释、不要 markdown 代码块);下面格式中的字段值均为占位示例,' +
  '必须替换为真实内容,严禁原样输出「画面描述」「台词/旁白」「字幕」「音效」这类字段名作为值:' +
  '{"shots":[{"duration":"5s","desc":"<具体可拍摄的画面描述>","voiceover":"<台词或旁白,无则空字符串>","subtitle":"<字幕,无则空字符串>","sfx":"<音效,无则空字符串>","subjects":[{"name":"小雅","kind":"人物","imageIndex":2},{"name":"室内场景","kind":"场景"}]}]}'

/** 按目标总时长生成镜头数量、单镜时长和台词字数约束。 */
function buildDurationPromptLines(totalSec: number): string[] {
  if (totalSec === 15) {
    return [
      '视频总时长 15 秒(硬性要求)。',
      '时长分配规则:开头镜头固定 3 秒,结尾镜头固定 3 秒,中间部分合计固定 9 秒。',
      '中间部分的脚本内容、分镜个数和每镜时长按叙事需要分配,不做固定模板;但所有中间镜头 duration 相加必须等于 9 秒。',
      '请至少生成 3 个镜头,总镜头数尽量控制在 3~5 个之间,不要切得过碎,避免出现多个 1s 镜头。',
    ]
  }
  if (totalSec === 10) {
    return [
      '视频总时长 10 秒(硬性要求)。',
      '时长分配规则固定为 3 秒-4 秒-3 秒。',
      '请优先输出 3 个镜头,且 duration 必须依次为 3s、4s、3s;如确需更多镜头,总镜头数最多 4 个,避免出现多个 1s。',
    ]
  }
  if (totalSec === 5) {
    return [
      '视频总时长 5 秒(硬性要求)。',
      '时长按脚本内容需要自由分配,不做固定模板;但所有镜头 duration 相加必须严格等于 5 秒,绝对不能超过。',
      '总镜头数尽量控制在 1~2 个之间,不要切得过碎,避免出现多个 1s。',
    ]
  }
  // 通用兜底:限制镜头数别太碎，避免大量 1s。
  const approxShots = Math.max(1, Math.floor(totalSec / 4))
  const perShot = Math.max(1, Math.round(totalSec / approxShots))
  return [
    `视频总时长 ${totalSec} 秒(硬性要求):请切分为约 ${approxShots} 个镜头,每镜约 ${perShot} 秒,` +
      `所有镜头 duration 相加必须严格等于 ${totalSec} 秒,绝对不能超过;不要切得过碎。`,
    '除非叙事表达确有必要，否则避免出现多个 1s 镜头，尤其不要连续出现多个 1s。',
  ]
}

/** 将页面选项组装为可供模型理解的用户输入。 */
function buildUserText({ requirement, style, ratio, duration }: GenerateArgs): string {
  const totalSec = parseInt(String(duration || '10'), 10) || 10
  return [
    `创作需求:${requirement || '(未提供文字,请根据上传的参考图片构思一支完整广告短视频的分镜)'}`,
    `约束:风格 ${style || '商业'},画面比例 ${ratio || '16:9'}。`,
    ...buildDurationPromptLines(totalSec),
    '请按要求输出分镜 JSON。',
  ].join('\n')
}

// 文本类"主体"(无需上传素材)关键词
/** 用于排除文案类“假视觉主体”和模板占位字段的规则。 */
const TEXT_SUBJECT_RE = /文案|字幕|标语|口号|标题|文字|台词|旁白|cta|slogan|字样/i

// 模型有时把示例里的字段名当值原样输出(如 desc 直接写"画面描述")→ 视为无效占位,置空
const PLACEHOLDER_FIELD_RE = /^(画面描述|台词\/?旁白|旁白|台词|字幕|音效|desc|voiceover|subtitle|sfx|无|none|n\/a)$/i
/** 清理脚本字段，将空值、占位词和外层引号归一化为可编辑文本。 */
const cleanField = (v: any): string => {
  const t = String(v || '').trim()
  return PLACEHOLDER_FIELD_RE.test(t) ? '' : t
}

// 时长字符串 → 秒(失败回退 0)
/** 从“5s”等时长字段中提取正数秒值。 */
const durToSec = (d: any): number => {
  const n = parseFloat(String(d || '').replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** 判断镜头是否含有至少一项可展示脚本内容。 */
const hasScriptContent = (shot: Shot): boolean =>
  [shot?.desc, shot?.line, shot?.subtitle, shot?.sfx].some((value) => String(value || '').trim())

/** 删除空镜头后重新生成连续镜头编号。 */
function renumberScriptShots(shots: Shot[]): Shot[] {
  return (shots || []).map((shot, index) => ({
    ...shot,
    id: index + 1,
    no: `镜头${index + 1}`,
  }))
}

/** 按总时长计算允许的最大镜头数，避免出现过多 1 秒碎镜。 */
function maxShotCountForDuration(totalSec: number): number {
  if (!(totalSec > 0)) return 0
  // 每个镜头至少 1 秒；按约 3 秒一个镜头限制碎片数量，并延续 5/10/15 秒原有的 2/4/5 镜上限。
  return Math.min(Math.floor(totalSec), 5, Math.ceil(totalSec / 3))
}

/** 将脚本裁剪到目标时长可承载的镜头数，并保留有内容的镜头。 */
function limitShotsForDuration(shots: Shot[], totalSec: number): Shot[] {
  const useful = renumberScriptShots((shots || []).filter(hasScriptContent))
  const maxCount = maxShotCountForDuration(totalSec)
  if (!maxCount || useful.length <= maxCount) return useful

  if ((totalSec === 10 || totalSec === 15) && maxCount >= 3) {
    const middle = useful.slice(1, -1).slice(0, maxCount - 2)
    return renumberScriptShots([useful[0], ...middle, useful[useful.length - 1]])
  }

  return renumberScriptShots(useful.slice(0, maxCount))
}

/** 将整数总时长尽量均匀分配到指定镜头数。 */
function distributeEvenly(totalSec: number, count: number): number[] {
  if (!(totalSec > 0) || !(count > 0) || totalSec < count) return []
  const base = Math.floor(totalSec / count)
  const remainder = totalSec - base * count
  return Array.from({ length: count }, (_v, index) => base + (index < remainder ? 1 : 0))
}

/** 在总时长不变的前提下减少多个 1 秒镜头，改善剪辑可用性。 */
function reduceMultipleOneSeconds(values: number[], totalSec: number): number[] {
  if (!Array.isArray(values) || !values.length) return values
  const next = values.map((value) => Math.max(1, Math.round(value || 0)))
  if (next.length === 1) return [Math.max(1, totalSec)]
  // 若总时长本身不足以支撑“至多一个 1s”，则只能接受多 1s。
  if (totalSec < next.length * 2 - 1) return next

  let oneIndexes = next.map((value, index) => (value <= 1 ? index : -1)).filter((index) => index >= 0)
  while (oneIndexes.length > 1) {
    const target = oneIndexes[0]
    const donor = next.findIndex((value, index) => index !== target && value > 2)
    if (donor < 0) break
    next[target] += 1
    next[donor] -= 1
    oneIndexes = next.map((value, index) => (value <= 1 ? index : -1)).filter((index) => index >= 0)
  }
  return next
}

/** 按比例缩放各镜头时长，再用余数补齐保证和精确等于目标值。 */
function scaleDurationsToTotal(values: number[], totalSec: number): number[] {
  if (!Array.isArray(values) || !values.length || !(totalSec > 0) || totalSec < values.length) return []
  const normalized = values.map((value) => (value > 0 ? Math.round(value) : 1))
  const sum = normalized.reduce((acc, value) => acc + value, 0)
  if (sum <= 0) return distributeEvenly(totalSec, values.length)

  const factor = totalSec / sum
  const scaled = normalized.map((value) => Math.max(1, Math.round(value * factor)))
  let drift = totalSec - scaled.reduce((acc, value) => acc + value, 0)

  while (drift > 0) {
    for (let i = scaled.length - 1; i >= 0 && drift > 0; i -= 1) {
      scaled[i] += 1
      drift -= 1
    }
  }
  while (drift < 0) {
    let changed = false
    for (let i = scaled.length - 1; i >= 0 && drift < 0; i -= 1) {
      if (scaled[i] <= 1) continue
      scaled[i] -= 1
      drift += 1
      changed = true
    }
    if (!changed) return distributeEvenly(totalSec, values.length)
  }

  return reduceMultipleOneSeconds(scaled, totalSec)
}

/** 对常见短视频时长应用可剪辑的镜头分配，其他时长按原比例归一。 */
function applyDurationPattern(totalSec: number, secs: number[]): number[] {
  if (!Array.isArray(secs) || !secs.length || !(totalSec > 0)) return []

  if (totalSec === 10) {
    if (secs.length === 3) return [3, 4, 3]
    if (secs.length > 3 && secs.length <= 4) {
      const middle = scaleDurationsToTotal(secs.slice(1, -1), 4)
      return middle.length ? [3, ...middle, 3] : []
    }
    return []
  }

  if (totalSec === 15) {
    if (secs.length >= 3 && secs.length <= 5) {
      const middle = scaleDurationsToTotal(secs.slice(1, -1), 9)
      return middle.length ? [3, ...middle, 3] : []
    }
    return []
  }

  return []
}

// 强制各镜 duration 之和 = 目标总时长(模型常超/欠):优先匹配指定分配规则,否则按比例缩放。
/** 将 AI 生成的各镜时长校正到用户指定的精确总时长。 */
function normalizeDurations(shots: Shot[], totalSec: number): Shot[] {
  if (!Array.isArray(shots) || !shots.length || !(totalSec > 0)) return shots
  const boundedShots = limitShotsForDuration(shots, totalSec)
  if (!boundedShots.length) return boundedShots
  const secs = boundedShots.map((s) => durToSec(s.duration))
  const sum = secs.reduce((a, b) => a + b, 0)
  // 模型没给有效时长 → 平均分配
  if (sum <= 0) {
    const patterned = applyDurationPattern(totalSec, secs)
    if (patterned.length === boundedShots.length) {
      return boundedShots.map((s, i) => ({ ...s, duration: `${patterned[i]}s` }))
    }
    const evenly = distributeEvenly(totalSec, boundedShots.length)
    if (!evenly.length) return boundedShots
    return boundedShots.map((s, i) => ({ ...s, duration: `${evenly[i]}s` }))
  }
  const patterned = applyDurationPattern(totalSec, secs)
  if (patterned.length === boundedShots.length) {
    return boundedShots.map((s, i) => ({ ...s, duration: `${patterned[i]}s` }))
  }
  // 只有真正相等时才保留，避免 6.8 秒等近似结果进入“选择 7 秒”的生成请求。
  if (Math.abs(sum - totalSec) < 0.001) return boundedShots
  const scaled = scaleDurationsToTotal(secs, totalSec)
  if (!scaled.length) return boundedShots
  return boundedShots.map((s, i) => ({ ...s, duration: `${scaled[i]}s` }))
}

// 容错:从(可能被截断的)文本里抢救出所有「完整」的顶层 {…} 对象
/** 当完整 JSON 解析失败时，从流式残片中抢救已闭合的镜头对象。 */
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
/** 将模型原始字段映射为页面 Shot，清理占位文本并关联 imageIndex。 */
function mapShots(list: any[], images: string[] = [], options: { filterEmpty?: boolean } = {}): Shot[] {
  if (!Array.isArray(list)) return []
  const filterEmpty = options.filterEmpty !== false
  const shots = list.map((s: any, i: number) => ({
    id: i + 1,
    no: `镜头${i + 1}`,
    duration: String(s?.duration || s?.dur || '5s').trim() || '5s',
    // 占位字段名(画面描述/台词/字幕/音效…)被原样吐出时一律置空,不再硬填"画面描述"四个字
    desc: cleanField(s?.desc || s?.prompt || s?.description),
    line: cleanField(s?.line || s?.voiceover || s?.dialogue),
    subtitle: cleanField(s?.subtitle || s?.caption),
    sfx: cleanField(s?.sfx || s?.sound || s?.audio),
    // 注意:不再用 imageIndex 把上传图直接绑成 image(否则一张产品海报会被模型标到几乎所有主体上 →「全是产品图」)。
    // 上传素材改由 anchorUploadsToSubjects(VL 识别主推产品)决定绑到哪些主体的 refImage,再图生图抠成干净单品。
    subjects: Array.isArray(s?.subjects)
      ? s.subjects
          .map((x: any) => ({
            tag:
              '@' +
              String(x?.name || x?.tag || x?.subject || '主体')
                .replace(/^@/, '')
                .trim(),
            kind: String(x?.kind || x?.type || '').trim(),
          }))
          .filter((s: any) => !TEXT_SUBJECT_RE.test(s.tag) && !TEXT_SUBJECT_RE.test(s.kind))
      : [],
  }))
  return renumberScriptShots(filterEmpty ? shots.filter(hasScriptContent) : shots)
}

/** 从可能包含代码围栏的模型输出中解析完整分镜列表。 */
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

/** 单镜头新增/编辑提示词，要求模型结合全部现有分镜保持剧情、风格和节奏连贯。 */
const ONE_SHOT_SYSTEM =
  '你是资深短视频(信息流广告)分镜脚本师。下面会给你整条广告已有的全部分镜(画面/台词/字幕/音效)。' +
  '请为指定位置的【单个镜头】(新增或修改)生成内容,使其与前后镜头的剧情、风格、节奏、配色保持连贯。' +
  '为该镜头给出:镜头时长(如 5s)、画面描述(中文,具体、可拍摄)、台词/旁白(voiceover)、字幕(subtitle)、音效(sfx);没有就给空字符串。' +
  '台词字数必须 ≤ 该镜头时长(秒)×4(如 5 秒镜头台词不超过 20 字);字幕要简短(通常 ≤15 字,不超过台词)。' +
  '【硬性要求】subjects 数组不能为空:列出该画面出现的全部独立视觉元素(人物/场景/物体/产品),至少 1 个,通常 2~4 个。' +
  '不要把台词/旁白/字幕/文案/标语/口号/CTA/标题等文本类元素列为主体。' +
  '若提供了上传素材图片,请据图设定主体并判断每个主体是否与某张素材图对应,对应则加 imageIndex(从1开始),不对应则省略。' +
  '严格只输出这一个镜头的 JSON(不要解释、不要 markdown 代码块);下面字段值均为占位示例,' +
  '必须替换为真实内容,严禁原样输出「画面描述」「台词/旁白」「字幕」「音效」这类字段名作为值:' +
  '{"duration":"5s","desc":"<具体可拍摄的画面描述>","voiceover":"<台词或旁白,无则空字符串>","subtitle":"<字幕,无则空字符串>","sfx":"<音效,无则空字符串>","subjects":[{"name":"小雅","kind":"人物","imageIndex":1}]}'

/** 单个分镜生成后可直接回填的完整脚本信息。 */
export interface ShotInfo {
  duration: string
  desc: string
  line: string
  subtitle: string
  sfx: string
  subjects: Shot['subjects']
}

/**
 * 生成/修改单个分镜的完整信息(带全部现有分镜上下文)。
 * - shots:整条广告现有的全部分镜(完整信息,作上下文);
 * - targetIndex:目标镜头位置(insert=插入到该位置之前;edit=该位置的镜头);
 * - intent:用户的新增/修改描述;images:本次上传的素材(用于主体对应 imageIndex)。
 */
export async function generateShotInfo(args: {
  shots: Shot[]
  targetIndex: number
  mode: 'edit' | 'insert'
  intent: string
  style?: string
  ratio?: string
  images?: string[]
  /** 用户在“生成脚本”阶段显式选择的模型版本。 */
  modelVersionId?: number
  /** 本轮请求锁定的工作空间上下文。 */
  requestContext?: AiResponseRequestContext
  signal?: AbortSignal
}): Promise<ShotInfo> {
  const { shots, targetIndex, mode, intent, style, ratio, images = [] } = args
  const ctx = shots.map((s, i) => ({
    no: i + 1,
    duration: s.duration,
    desc: s.desc,
    voiceover: s.line || '',
    subtitle: s.subtitle || '',
    sfx: s.sfx || '',
  }))
  const pos = Math.max(0, Math.min(shots.length, targetIndex))
  const user = [
    `整条广告现有分镜(共 ${shots.length} 个),按顺序如下:`,
    JSON.stringify(ctx),
    mode === 'insert'
      ? `现在要【新增】一个镜头,插入到第 ${pos + 1} 个位置(排在原第 ${pos} 个之后)。`
      : `现在要【修改】第 ${pos + 1} 个镜头。`,
    `用户的${mode === 'insert' ? '新增' : '修改'}描述:${intent || '(未填写,请结合上传素材与上下文合理生成)'}`,
    `约束:风格 ${style || '商业'},画面比例 ${ratio || '16:9'};务必与前后镜头剧情/风格/节奏连贯。`,
    images.length ? `已提供 ${images.length} 张上传素材图片,请据图设定主体并标 imageIndex(从1开始)。` : '',
    '只输出这一个镜头的 JSON。',
  ]
    .filter(Boolean)
    .join('\n')

  const text = await runResponseText({
    system: ONE_SHOT_SYSTEM,
    user,
    images: images.slice(0, 6),
    temperature: 0.7,
    maxTokens: 1500,
    modelVersionId: args.modelVersionId,
    requestContext: args.requestContext,
    signal: args.signal,
  })

  const raw = String(text || '')
    .trim()
    .replace(/^```(json)?/i, '')
    .replace(/```$/i, '')
    .trim()
  const m = raw.match(/\{[\s\S]*\}/)
  let obj: any = {}
  try {
    obj = JSON.parse(m ? m[0] : raw)
  } catch {
    obj = salvageObjects('[' + raw + ']')[0] || {}
  }
  if (obj && Array.isArray(obj.shots)) obj = obj.shots[0] || {}
  const mapped = mapShots([obj], images, { filterEmpty: false })[0]
  return {
    duration: mapped?.duration || '5s',
    desc: mapped?.desc || '',
    line: mapped?.line || '',
    subtitle: mapped?.subtitle || '',
    sfx: mapped?.sfx || '',
    subjects: mapped?.subjects || [],
  }
}

/**
 * 流式生成分镜脚本:边生成边增量解析,每当多出一个「完整」分镜就回调 onShots,
 * 用户看到镜头1即可开始修改。返回最终 Shot[]。
 * (流式失败时由 streamResponseText 自动回退非流式,届时拿到全文一次性解析。)
 */
export async function generateScriptShotsStream(args: GenerateArgs, onShots: (shots: Shot[]) => void): Promise<Shot[]> {
  if (!args.requirement.trim() && !args.images?.length) throw new Error('请至少输入文案或上传图片')
  const images = args.images || []
  const totalSec = parseInt(String(args.duration || '10'), 10) || 10
  let lastCount = 0
  let lastSig = ''

  // 用「到目前为止的全文」增量抢救出已完整的分镜,多出来就回调
  const emit = (acc: string) => {
    const shots = limitShotsForDuration(mapShots(salvageObjects(acc), images), totalSec)
    const sig = shots.map((s) => [s.duration, s.desc, s.line, s.subtitle, s.sfx].join('\u0001')).join('\u0002')
    if (shots.length && sig !== lastSig) {
      lastCount = shots.length
      lastSig = sig
      onShots(shots)
    }
  }

  const finalText = await streamResponseText({
    system: SYSTEM,
    user: buildUserText(args),
    images: images.slice(0, 6),
    temperature: 0.8,
    maxTokens: 4000,
    modelVersionId: args.modelVersionId,
    requestContext: args.requestContext,
    signal: args.signal,
    onDelta: (_delta, aggregated) => emit(aggregated),
  })

  // 收尾:用完整解析兜底(可能比增量多解析出最后一个;非流式回退时这里是唯一解析)
  const finalShots = parseShots(finalText, images)
  const result = finalShots.length >= lastCount ? finalShots : mapShots(salvageObjects(finalText), images)
  if (!result.length) throw new Error('未能解析分镜脚本,请重试')
  // 流式中间态不归一,只在最终结果对齐;同时尽量避免出现多个 1s。
  return normalizeDurations(result, totalSec)
}

// ── 主体提取兜底 ──
// 弱模型生成整条脚本 JSON 时,常整体不给 / 给空 subjects(导致表格里每镜没主体)。
// 对这类镜头单独跑一个【聚焦的小任务】:只从一句画面描述里抽主体——简单任务弱模型也能稳定完成。
/** 从画面描述中拆分视觉主体的系统提示词。 */
const SUBJECT_SYSTEM =
  '你是分镜「视觉主体」提取器。给你一句镜头画面描述,提取其中出现的、需要准备视觉素材的主体(人物/场景/物体/产品)。' +
  '命名必须是【具体名词】(如「年轻女性」「皮肤管理师」「护肤仪器」「咨询区」「精华液瓶」),' +
  '严禁使用「素材/主体/元素/图片/画面/对象/内容」等泛指词,也不要只写编号。' +
  '不要提取台词/字幕/文案/标语/口号/CTA/标题等文本类元素。通常 1~4 个。' +
  '严格只输出 JSON(无解释、无 markdown):{"subjects":[{"name":"年轻女性","kind":"人物"},{"name":"咨询区","kind":"场景"}]}'

// 纯泛指词(可带编号)——这类不算有效主体,过滤掉
/** 识别“主体1”“素材2”等不可用的泛化主体名。 */
const GENERIC_SUBJECT_RE = /^(素材|主体|元素|图片|画面|对象|内容|视觉元素|物体|场景|产品|人物)\d*$/

/** 调用 AI 从单镜画面描述中提取去重后的具体视觉主体。 */
export async function extractSubjects(
  desc: string,
  signal?: AbortSignal,
  modelVersionId?: number,
  requestContext?: AiResponseRequestContext,
): Promise<Shot['subjects']> {
  const d = String(desc || '').trim()
  if (!d) return []
  let text = ''
  try {
    text = await runResponseText({
      system: SUBJECT_SYSTEM,
      user: `镜头画面描述:${d}`,
      temperature: 0.4,
      maxTokens: 300,
      modelVersionId,
      requestContext,
      signal,
    })
  } catch (error) {
    if (signal?.aborted || (error as any)?.name === 'AbortError') throw error
    return []
  }
  let arr: any[] = []
  try {
    const m = String(text).match(/\{[\s\S]*\}/)
    const parsed = JSON.parse(m ? m[0] : text)
    arr = Array.isArray(parsed) ? parsed : parsed?.subjects || []
  } catch {
    arr = salvageObjects(text)
  }
  return (Array.isArray(arr) ? arr : [])
    .map((x: any) => ({
      tag:
        '@' +
        String(x?.name || x?.tag || x?.subject || '')
          .replace(/^@/, '')
          .trim(),
      kind: String(x?.kind || x?.type || '').trim(),
    }))
    .filter(
      (s: any) =>
        s.tag.length > 1 &&
        !TEXT_SUBJECT_RE.test(s.tag) &&
        !TEXT_SUBJECT_RE.test(s.kind) &&
        !GENERIC_SUBJECT_RE.test(s.tag.replace(/^@/, '')),
    )
}

// ── 主体合并:把「只在单个镜头里出现一次」的多个主体,按该镜画面语义合并成 1 个组合主体 ──
// 动机:主体拆得过细 → 素材生成变多,但很多主体只服务于某一帧画面(最终都是为合成镜头),没必要单独出图。
// 规则:
//  - 跨镜复用的主体(出现在 ≥2 个不同镜头)必须保持独立 —— 否则无法保证它在各镜里是同一个人/物(一致性);
//  - 已绑定用户上传图(su.image)的主体不合并 —— 那是用户指定的真实产品/人物,合进场景会丢真实性;
//  - 同一镜头里「仅出现一次、且未绑定上传图」的主体若 ≥2 个 → 合并成 1 个组合主体(据画面描述命名)。
/** 为仅出现一次的相关主体生成更可复用合并名的提示词。 */
const MERGE_NAME_SYSTEM =
  '你是分镜主体命名助手。给你一句镜头画面描述,以及该镜头里若干「只在这一个镜头出现」的视觉主体名。' +
  '请把它们合并成【一个】能直接合成该画面的组合主体名:用中文具体短语体现主体之间的关系/动作/场景' +
  '(例如把「学生」「台灯」合成「在台灯下看书的学生」),而不是简单罗列堆砌。' +
  '只输出这个组合主体名本身,不超过 16 个字,不含标点、引号、书名号、空格、序号,不要任何解释。'

// 据画面描述 + 待合并主体名,生成一个组合主体名(失败返回空,调用方用模板兜底)
/** 根据镜头语境为一组一次性主体生成简短、具体的合并名。 */
async function mergeNameFor(
  desc: string,
  names: string[],
  signal?: AbortSignal,
  modelVersionId?: number,
  requestContext?: AiResponseRequestContext,
): Promise<string> {
  const user = `画面描述:${String(desc || '').trim() || '(无)'}\n要合并的主体:${names.join('、')}`
  let name = ''
  try {
    name = await runResponseText({
      system: MERGE_NAME_SYSTEM,
      user,
      temperature: 0.5,
      maxTokens: 48,
      modelVersionId,
      requestContext,
      signal,
    })
  } catch (error) {
    if (signal?.aborted || (error as any)?.name === 'AbortError') throw error
    return ''
  }
  return (name || '')
    .replace(/["'《》「」“”‘’\s]/g, '')
    .replace(/[。,，.!！?？:：;；]/g, '')
    .trim()
    .split('\n')[0]
}

/**
 * 合并各镜头里「单次出现」的主体(减少不必要的素材)。在脚本生成 + 主体兜底之后、展示给「准备素材」之前调用。
 * 跨镜统计需要完整 Shot[];失败/无可合并则原样返回。组合命名为各镜并发,降低延迟。
 */
export async function mergeSingleUseSubjects(
  shots: Shot[],
  signal?: AbortSignal,
  modelVersionId?: number,
  requestContext?: AiResponseRequestContext,
): Promise<Shot[]> {
  if (!Array.isArray(shots) || shots.length < 1) return shots
  const norm = (t: string) =>
    String(t || '')
      .replace(/^@/, '')
      .trim()

  // 1) 统计每个主体名出现在多少个【不同镜头】
  const shotCount = new Map<string, number>()
  for (const sh of shots) {
    const seen = new Set<string>()
    for (const su of sh.subjects || []) {
      const n = norm(su.tag)
      if (!n || seen.has(n)) continue
      seen.add(n)
      shotCount.set(n, (shotCount.get(n) || 0) + 1)
    }
  }

  // 2) 逐镜算出「保留」与「待合并」的主体:待合并 = 跨镜只出现 1 次 且 未绑定上传图
  const plans = shots.map((sh) => {
    const subs = sh.subjects || []
    // 可合并 = 跨镜只出现 1 次 且 未绑定上传图(image)且 非主推产品锚定(refImage)
    const mergeable = subs.filter((su) => (shotCount.get(norm(su.tag)) || 0) <= 1 && !su.image && !su.refImage)
    const keep = subs.filter((su) => !mergeable.includes(su))
    return { sh, keep, mergeable }
  })

  // 3) 并发为需要合并(待合并 ≥2)的镜头生成组合名
  const names = await Promise.all(
    plans.map(async (p) => {
      if (p.mergeable.length < 2) return ''
      const ns = p.mergeable.map((su) => norm(su.tag)).filter(Boolean)
      const nm = await mergeNameFor(p.sh.desc, ns, signal, modelVersionId, requestContext)
      return nm || ns.join('的') // 模板兜底:如「台灯的学生」
    }),
  )

  // 4) 组装:不足 2 个可合并的镜头原样;其余把待合并主体替换为 1 个组合主体(置于保留主体之后)
  return plans.map((p, i) => {
    if (p.mergeable.length < 2 || !names[i]) return p.sh
    return { ...p.sh, subjects: [...p.keep, { tag: '@' + names[i], kind: '场景' }] }
  })
}
