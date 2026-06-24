/**
 * 模板库 API — 对接后端 creative/projects，按条件筛选用作模板展示。
 * 后续若后端提供 /api/v1/templates 独立端点，切换数据源即可。
 */
import { listCreativeProjects, type BusinessApiError } from './business'

export interface TemplateItem {
  id: number
  title: string
  /** 首帧缩略图 */
  thumbnailUrl: string
  /** 视频源地址（hover 预览） */
  videoUrl: string
  /** 宽高比字符串，如 '9 / 16' */
  ratio: string
  /** 原始宽度 */
  width?: number
  /** 原始高度 */
  height?: number
  /** 视频时长（秒） */
  duration?: number
  /** 视频风格（写实/动漫 等） */
  style: string
  /** 使用/引用次数 */
  useCount: number
  /** 创建时间 */
  createdAt: string
  /** 渐变色兜底（无缩略图时用） */
  grad: string
}

const FALLBACK_GRADS = [
  'linear-gradient(160deg, #e0d4f5, #f5ecfd)',
  'linear-gradient(160deg, #d4e8f0, #ecf8fb)',
  'linear-gradient(160deg, #f0d4d8, #fbeaed)',
  'linear-gradient(160deg, #d4f0e2, #eafbf1)',
  'linear-gradient(160deg, #f0e8d4, #fbf6ea)',
  'linear-gradient(160deg, #d4d8f0, #eaeefb)',
]

function pickGrad(index: number): string {
  return FALLBACK_GRADS[index % FALLBACK_GRADS.length]
}

function deriveRatio(w?: number, h?: number): string {
  if (!w || !h) return '9 / 16'
  const g = gcd(w, h)
  return `${w / g} / ${h / g}`
}

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a))
  let y = Math.abs(Math.round(b))
  while (y) {
    ;[x, y] = [y, x % y]
  }
  return x || 1
}

function pickFirstText(...values: any[]): string {
  for (const v of values) {
    const s = String(v ?? '').trim()
    if (s) return s
  }
  return ''
}

function toNumber(v: any): number {
  return Number(v) || 0
}

/** 从嵌套 JSON 字符串/对象中解析出纯对象 */
function toPlainObject(value: any): Record<string, any> | null {
  if (!value) return null
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, any>
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
    } catch {
      return null
    }
  }
  return null
}

/** 解析项目的 draft_json，提取可用作封面的图片 URL */
function extractCoverFromDraft(raw: any): string {
  const candidates = [raw?.draft_json, raw?.draftJson, raw?.draft, raw?.data?.draft_json, raw?.data?.draft]
  for (const item of candidates) {
    const draft = toPlainObject(item)
    if (!draft) continue
    const smart = toPlainObject(draft.smart) || draft
    const em = smart?.entryMeta || smart?.entry_meta || {}
    // ① 入口素材
    const imgs = Array.isArray(em.images) ? em.images : []
    if (imgs.length) {
      const u = String(imgs[0] || '').trim()
      if (u) return u
    }
    // ② 分镜图 — smart.shots[].image
    const shots = Array.isArray(smart?.shots) ? smart.shots : []
    for (const s of shots) {
      const u = pickFirstText(s?.image, s?.imageUrl, s?.image_url, s?.src, s?.url)
      if (u) return u
    }
    // ③ 元素图 — smart.shots[].subjects[].image
    for (const s of shots) {
      const subs = Array.isArray(s?.subjects) ? s.subjects : []
      for (const su of subs) {
        const u = pickFirstText(su?.image, su?.imageUrl, su?.image_url, su?.src, su?.url)
        if (u) return u
      }
    }
  }
  return ''
}

/** 解析项目的 draft_json，提取入口选定的比例 */
function extractRatioFromDraft(raw: any): string {
  const candidates = [raw?.draft_json, raw?.draftJson, raw?.draft, raw?.data?.draft_json, raw?.data?.draft]
  for (const item of candidates) {
    const draft = toPlainObject(item)
    if (!draft) continue
    const smart = toPlainObject(draft.smart) || draft
    // 智能成片入口比例
    const r = pickFirstText(smart?.entryMeta?.ratio, smart?.entry_meta?.ratio)
    if (r) return normalizeRatio(r)
    // 旧版 2.0 选定比例
    const sr = pickFirstText(draft?.selectedRatio)
    if (sr) return normalizeRatio(sr)
  }
  return ''
}

function normalizeRatio(val: string): string {
  // "9:16" → "9 / 16", "16/9" → "16 / 9"
  return val.replace(/\s*[:/]\s*/g, ' / ')
}

/** 解析项目的 draft_json，提取视频风格 */
function extractStyleFromDraft(raw: any): string {
  const candidates = [raw?.draft_json, raw?.draftJson, raw?.draft, raw?.data?.draft_json, raw?.data?.draft]
  for (const item of candidates) {
    const draft = toPlainObject(item)
    if (!draft) continue
    const smart = toPlainObject(draft.smart) || draft
    const s = pickFirstText(smart?.entryMeta?.style, smart?.entry_meta?.style)
    if (s) return s
    const styles = draft?.selectedStyles
    if (Array.isArray(styles) && styles.length) return String(styles[0] || '').trim()
    if (typeof styles === 'string' && styles.trim()) return styles.split(',')[0].trim()
  }
  return ''
}

/** 解析项目的 draft_json，提取生成视频 URL */
function extractVideoFromDraft(raw: any): string {
  const candidates = [raw?.draft_json, raw?.draftJson, raw?.draft, raw?.data?.draft_json, raw?.data?.draft]
  for (const item of candidates) {
    const draft = toPlainObject(item)
    if (!draft) continue
    const smart = toPlainObject(draft.smart) || draft
    // videoVersions
    const vv = Array.isArray(smart?.videoVersions) ? smart.videoVersions : []
    for (const v of vv) {
      const u = pickFirstText(v?.url, v?.src, v?.videoUrl, v?.video_url)
      if (u) return u
    }
    // generatedVideo
    const gv = pickFirstText(
      draft?.generatedVideoUrl,
      draft?.generated_video_url,
      smart?.generatedVideoUrl,
      smart?.generated_video_url,
      smart?.fullVideoUrl,
      smart?.full_video_url,
    )
    if (gv) return gv
  }
  return ''
}

/** 把后端返回的项目记录归一化成 TemplateItem */
function normalizeProject(raw: any, index: number): TemplateItem {
  // 先从顶层字段取，再从 draft 里补
  let thumbnailUrl = pickFirstText(raw?.thumbnailUrl, raw?.thumbnail_url, raw?.coverUrl, raw?.cover_url, raw?.cover)
  if (!thumbnailUrl) thumbnailUrl = extractCoverFromDraft(raw)

  let videoUrl = pickFirstText(raw?.videoUrl, raw?.video_url, raw?.outputUrl, raw?.output_url, raw?.url)
  if (!videoUrl) videoUrl = extractVideoFromDraft(raw)

  const w = toNumber(raw?.width || raw?.video_width || raw?.output_width)
  const h = toNumber(raw?.height || raw?.video_height || raw?.output_height)
  let ratio = deriveRatio(w, h)

  // 宽高缺失时，从草稿里提取入口选定的比例
  if (ratio === '9 / 16' && !w && !h) {
    const draftRatio = extractRatioFromDraft(raw)
    if (draftRatio) ratio = draftRatio
  }

  const style = extractStyleFromDraft(raw)

  return {
    id: toNumber(raw?.id || raw?.project_id || raw?.projectId),
    title: pickFirstText(raw?.title, raw?.name, raw?.project_name) || '未命名项目',
    thumbnailUrl,
    videoUrl,
    ratio,
    width: w || undefined,
    height: h || undefined,
    duration: toNumber(raw?.duration || raw?.video_duration) || undefined,
    style,
    useCount: toNumber(raw?.useCount || raw?.use_count || raw?.usage || raw?.used_count),
    createdAt: pickFirstText(raw?.createdAt, raw?.created_at, raw?.createTime) || new Date().toISOString(),
    grad: pickGrad(index),
  }
}

export interface ListTemplatesOptions {
  workspaceId?: number
  offset?: number
  limit?: number
}

export interface ListTemplatesResult {
  items: TemplateItem[]
  total: number
}

/**
 * 拉取模板列表（当前复用 creative/projects 端点）。
 * 后续替换为 /api/v1/templates 即可。
 */
export async function listTemplates(opts: ListTemplatesOptions = {}): Promise<ListTemplatesResult> {
  const rawItems: any[] = await listCreativeProjects({
    workspaceId: opts.workspaceId,
    offset: opts.offset ?? 0,
    limit: opts.limit ?? 50,
  })

  const items = (Array.isArray(rawItems) ? rawItems : [])
    .map((raw: any, i: number) => normalizeProject(raw, i))
    .filter((t) => Boolean(t.videoUrl))

  return { items, total: items.length }
}
