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
import { resolveTaskModel, estimateAiTaskCost } from './business'

/**
 * 文本生成(responses.multimodal:分镜脚本 / AI 润色 / 镜头信息等)提交前积分预估。
 * 注意:文本走 /ai/responses,而 estimate-cost 在 /ai/tasks —— 若后端不支持文本 op 估价会抛错,
 * 调用方需 try/catch 优雅降级(显示"暂不支持预估")。
 */
export async function estimateResponsesCost(args: {
  workspaceId: number
  prompt?: string
  modelPlanCandidates?: string[]
}): Promise<any> {
  const model = await resolveTaskModel({
    operationCode: 'responses.multimodal',
    modelPlanCandidates: args.modelPlanCandidates,
  })
  if (!model?.id) throw new Error('暂无可用的文本模型')
  return estimateAiTaskCost({
    workspaceId: args.workspaceId,
    modelVersionId: model.id,
    operationCode: 'responses.multimodal',
    prompt: args.prompt || '',
    params: {},
  })
}

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
  '【命名硬性要求】每个主体的 name 必须是【具体名词】(如「年轻女性」「皮肤管理师」「护肤仪器」「咨询区」「精华液瓶」),' +
  '严禁使用「素材」「主体」「元素」「图片」「画面」「对象」「内容」这类泛指词,也不要只写编号(素材1/素材2);否则视为无效。' +
  '注意:只拆需要视觉素材的主体;不要把台词、旁白、字幕、文案、标语、口号、CTA、标题等文本类元素列为主体。' +
  '若提供了素材图片,务必逐张判断它对应哪个主体:对应的主体必须加 imageIndex 字段(从1开始,表示第几张素材图),' +
  '尽量让每张素材图都被某个主体引用(场景图配场景主体、产品图配产品主体);确实无对应的主体才省略该字段。' +
  '严格只输出 JSON(不要解释、不要 markdown 代码块);下面格式中的字段值均为占位示例,' +
  '必须替换为真实内容,严禁原样输出「画面描述」「台词/旁白」「字幕」「音效」这类字段名作为值:' +
  '{"shots":[{"duration":"5s","desc":"<具体可拍摄的画面描述>","voiceover":"<台词或旁白,无则空字符串>","subtitle":"<字幕,无则空字符串>","sfx":"<音效,无则空字符串>","subjects":[{"name":"小雅","kind":"人物","imageIndex":2},{"name":"室内场景","kind":"场景"}]}]}'

function buildUserText({ requirement, style, ratio, duration }: GenerateArgs): string {
  const totalSec = parseInt(String(duration || '10'), 10) || 10
  // 向下取整(每镜约 5 秒),避免镜头数偏多导致各镜时长之和超过总时长
  const approxShots = Math.max(1, Math.floor(totalSec / 5))
  const perShot = Math.max(3, Math.round(totalSec / approxShots))
  return [
    `创作需求:${requirement || '(未提供文字,请根据上传的参考图片构思一支完整广告短视频的分镜)'}`,
    `约束:风格 ${style || '商业'},画面比例 ${ratio || '16:9'}。`,
    `视频总时长 ${totalSec} 秒(硬性要求):请切分为约 ${approxShots} 个镜头,每镜约 ${perShot} 秒(不少于 3 秒),` +
      `所有镜头 duration 相加必须严格等于 ${totalSec} 秒,绝对不能超过;不要切得过碎。`,
    '请按要求输出分镜 JSON。',
  ].join('\n')
}

// 文本类"主体"(无需上传素材)关键词
const TEXT_SUBJECT_RE = /文案|字幕|标语|口号|标题|文字|台词|旁白|cta|slogan|字样/i

// 模型有时把示例里的字段名当值原样输出(如 desc 直接写"画面描述")→ 视为无效占位,置空
const PLACEHOLDER_FIELD_RE = /^(画面描述|台词\/?旁白|旁白|台词|字幕|音效|desc|voiceover|subtitle|sfx|无|none|n\/a)$/i
const cleanField = (v: any): string => {
  const t = String(v || '').trim()
  return PLACEHOLDER_FIELD_RE.test(t) ? '' : t
}

// 时长字符串 → 秒(失败回退 0)
const durToSec = (d: any): number => {
  const n = parseFloat(String(d || '').replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : 0
}

// 强制各镜 duration 之和 = 目标总时长(模型常超/欠):按比例缩放,取整漂移修正到尾镜。
function normalizeDurations(shots: Shot[], totalSec: number): Shot[] {
  if (!Array.isArray(shots) || !shots.length || !(totalSec > 0)) return shots
  const secs = shots.map((s) => durToSec(s.duration))
  let sum = secs.reduce((a, b) => a + b, 0)
  // 模型没给有效时长 → 平均分配
  if (sum <= 0) {
    const each = Math.max(1, Math.round(totalSec / shots.length))
    secs.fill(each)
    sum = each * shots.length
  }
  // 已基本对齐(±0.5s)则不动,避免无谓改动
  if (Math.abs(sum - totalSec) < 0.5) return shots
  const factor = totalSec / sum
  const scaled = secs.map((s) => Math.max(1, Math.round(s * factor)))
  // 取整漂移修正:差值并到最后一个镜头,保证总和精确 = totalSec
  const drift = totalSec - scaled.reduce((a, b) => a + b, 0)
  if (drift !== 0) scaled[scaled.length - 1] = Math.max(1, scaled[scaled.length - 1] + drift)
  return shots.map((s, i) => ({ ...s, duration: `${scaled[i]}s` }))
}

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

// ── 单个分镜「新增 / 编辑」:带【全部现有分镜的完整信息】作上下文,产出该镜头完整内容 ──
// 解决「新插入的分镜跟其他没关系」+「后端没返回台词/字幕/音效」:LLM 看到整条广告所有分镜,
// 据用户描述 + 上传素材,生成/修改这一个镜头的 画面描述/台词/字幕/音效/主体,与前后连贯。
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
  const mapped = mapShots([obj], images)[0]
  return {
    duration: mapped?.duration || '5s',
    desc: mapped?.desc || '',
    line: mapped?.line || '',
    subtitle: mapped?.subtitle || '',
    sfx: mapped?.sfx || '',
    subjects: mapped?.subjects || [],
  }
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
  // 强制各镜时长之和 = 用户要求的总时长(模型常超时)
  return normalizeDurations(shots, parseInt(String(args.duration || '10'), 10) || 10)
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
  // 强制各镜时长之和 = 用户要求的总时长(模型常超时);流式中间态不归一,只在最终结果对齐
  return normalizeDurations(result, parseInt(String(args.duration || '10'), 10) || 10)
}

// ── 主体提取兜底 ──
// 弱模型生成整条脚本 JSON 时,常整体不给 / 给空 subjects(导致表格里每镜没主体)。
// 对这类镜头单独跑一个【聚焦的小任务】:只从一句画面描述里抽主体——简单任务弱模型也能稳定完成。
const SUBJECT_SYSTEM =
  '你是分镜「视觉主体」提取器。给你一句镜头画面描述,提取其中出现的、需要准备视觉素材的主体(人物/场景/物体/产品)。' +
  '命名必须是【具体名词】(如「年轻女性」「皮肤管理师」「护肤仪器」「咨询区」「精华液瓶」),' +
  '严禁使用「素材/主体/元素/图片/画面/对象/内容」等泛指词,也不要只写编号。' +
  '不要提取台词/字幕/文案/标语/口号/CTA/标题等文本类元素。通常 1~4 个。' +
  '严格只输出 JSON(无解释、无 markdown):{"subjects":[{"name":"年轻女性","kind":"人物"},{"name":"咨询区","kind":"场景"}]}'

// 纯泛指词(可带编号)——这类不算有效主体,过滤掉
const GENERIC_SUBJECT_RE = /^(素材|主体|元素|图片|画面|对象|内容|视觉元素|物体|场景|产品|人物)\d*$/

export async function extractSubjects(desc: string, signal?: AbortSignal): Promise<Shot['subjects']> {
  const d = String(desc || '').trim()
  if (!d) return []
  let text = ''
  try {
    text = await runResponseText({
      system: SUBJECT_SYSTEM,
      user: `镜头画面描述:${d}`,
      temperature: 0.4,
      maxTokens: 300,
      signal,
    })
  } catch {
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
const MERGE_NAME_SYSTEM =
  '你是分镜主体命名助手。给你一句镜头画面描述,以及该镜头里若干「只在这一个镜头出现」的视觉主体名。' +
  '请把它们合并成【一个】能直接合成该画面的组合主体名:用中文具体短语体现主体之间的关系/动作/场景' +
  '(例如把「学生」「台灯」合成「在台灯下看书的学生」),而不是简单罗列堆砌。' +
  '只输出这个组合主体名本身,不超过 16 个字,不含标点、引号、书名号、空格、序号,不要任何解释。'

// 据画面描述 + 待合并主体名,生成一个组合主体名(失败返回空,调用方用模板兜底)
async function mergeNameFor(desc: string, names: string[], signal?: AbortSignal): Promise<string> {
  const user = `画面描述:${String(desc || '').trim() || '(无)'}\n要合并的主体:${names.join('、')}`
  let name = ''
  try {
    name = await runResponseText({ system: MERGE_NAME_SYSTEM, user, temperature: 0.5, maxTokens: 48, signal })
  } catch {
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
export async function mergeSingleUseSubjects(shots: Shot[], signal?: AbortSignal): Promise<Shot[]> {
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
      const nm = await mergeNameFor(p.sh.desc, ns, signal)
      return nm || ns.join('的') // 模板兜底:如「台灯的学生」
    }),
  )

  // 4) 组装:不足 2 个可合并的镜头原样;其余把待合并主体替换为 1 个组合主体(置于保留主体之后)
  return plans.map((p, i) => {
    if (p.mergeable.length < 2 || !names[i]) return p.sh
    return { ...p.sh, subjects: [...p.keep, { tag: '@' + names[i], kind: '场景' }] }
  })
}
