/**
 * 画布节点标题
 *
 * 节点头部原先只显示类型名，于是画布上十几个节点全叫「图片」「视频」，
 * 标题栏说不出任何区分信息——要认出哪个是哪个只能去看缩略图。
 *
 * 这里把标题拆成两层：
 * - 用户改过名（data.title 有值）→ 永远优先，人写的名字胜过任何推断；
 * - 没改过名 → 由内容推导一个摘要（提示词 / 真人素材 / 片段数），类型名退居图标与兜底。
 *
 * 推导结果刻意不写回 data：它是随内容变化的派生值，固化下来就跟不上内容了。
 * 详见 canvasElements.ts 中 SerializableNodeData.title 的注释。
 */
import { parseCanvasStructuredText } from '@/utils/canvasStructuredText'

/** 节点类型 → 中文类型名。头部图标与兜底标题共用这一份。 */
export const CANVAS_KIND_LABELS: Record<string, string> = {
  text: '文本',
  image: '图片',
  video: '视频',
  timeline: '视频剪辑',
}

/** 自动摘要的最大字数：超过一行就失去「一眼扫过」的意义，反而挤占画面。 */
export const CANVAS_TITLE_SUMMARY_MAX = 18

/** 用户自定义名的最大字数，与分组改名（40）保持一致。 */
export const CANVAS_TITLE_MAX_LENGTH = 40

/** 取类型名；未知类型直接回显原始 kind，便于排查异常数据。 */
export function getCanvasKindLabel(kind: string): string {
  return CANVAS_KIND_LABELS[kind] || kind
}

/**
 * 压成单行摘要：折行、连续空白都会让标题在一行里露出断裂感，先抹平再截断。
 * 截断时补省略号，明确告诉用户后面还有内容。
 */
function toSummary(raw: string): string {
  const flat = raw.replace(/\s+/g, ' ').trim()
  if (!flat) return ''
  if (flat.length <= CANVAS_TITLE_SUMMARY_MAX) return flat
  return `${flat.slice(0, CANVAS_TITLE_SUMMARY_MAX)}…`
}

/** 文本节点的摘要：分镜脚本取首条镜头标题，普通文本取正文开头。 */
function deriveTextSummary(text: string): string {
  if (!text.trim()) return ''
  const structured = parseCanvasStructuredText(text)
  if (structured.kind === 'storyboard') {
    const first = structured.items[0]
    // 分镜正文往往上千字，逐字截断只会得到一段没有信息量的开头；
    // 首条镜头标题才是这个节点真正在讲的东西。
    if (first) {
      const extra = structured.items.length > 1 ? ` 等 ${structured.items.length} 镜` : ''
      return toSummary(`${first.title}${extra}`)
    }
  }
  return toSummary(text)
}

/** 计算节点标题所需的最小数据切片，避免调用方传整个 node。 */
export interface CanvasTitleSource {
  kind: string
  /** 用户手动命名（data.title） */
  title?: unknown
  /** 生成提示词（data.prompt） */
  prompt?: unknown
  /** 文本节点正文：存在 window.__canvasTextContents，由调用方取出后传入 */
  text?: string
  /** 真人素材引用（data.realPerson） */
  realPerson?: unknown
  /** 素材来源（data.assetSource） */
  assetSource?: unknown
  /** 剪辑时间线（data.timeline），用于数出片段数 */
  timeline?: unknown
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * 推导默认标题（用户未改名时使用）。
 *
 * 优先级：真人素材身份 > 提示词/正文摘要 > 片段数 > 类型名。
 * 返回空串表示无可用摘要，交由调用方回退到类型名。
 */
export function deriveCanvasNodeSummary(source: CanvasTitleSource): string {
  const { kind } = source

  // 真人素材：身份就是这个节点最强的识别信息，胜过提示词
  const realPerson = source.realPerson as Record<string, unknown> | null | undefined
  if (realPerson && typeof realPerson === 'object') {
    const personName = asString(realPerson.name) || asString((realPerson as any).person_name)
    if (personName.trim()) return toSummary(personName)
  }
  if (source.assetSource === 'real_person') return '真人素材'

  if (kind === 'text') {
    const summary = deriveTextSummary(source.text || '')
    if (summary) return summary
  }

  const prompt = asString(source.prompt)
  if (prompt.trim()) return toSummary(prompt)

  if (kind === 'timeline') {
    const timeline = source.timeline as Record<string, unknown> | null | undefined
    const clips = Array.isArray((timeline as any)?.clips) ? ((timeline as any).clips as unknown[]) : []
    if (clips.length > 0) return `${clips.length} 个片段`
  }

  return ''
}

/**
 * 节点头部最终展示的标题。
 *
 * 用户改过名就用改的；否则「类型名 · 摘要」，摘要缺失时只留类型名。
 */
export function resolveCanvasNodeTitle(source: CanvasTitleSource): string {
  const custom = asString(source.title).trim()
  if (custom) return custom
  const label = getCanvasKindLabel(source.kind)
  const summary = deriveCanvasNodeSummary(source)
  return summary ? `${label} · ${summary}` : label
}
