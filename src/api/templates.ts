/**
 * 案例库 API — 对接后端 creative/projects，按条件筛选用作模板展示。
 * 后续若后端提供 /api/v1/templates 独立端点，切换数据源即可。
 */
import { listCreativeProjects, type BusinessApiError } from './business'
import { isSafeMediaUrl } from '@/utils/urlSafety'
import { assetStreamUrl } from '@/utils/assetUrl'

export interface TemplateItem {
  id: number
  title: string
  /** 首帧缩略图 */
  thumbnailUrl: string
  /** 封面图素材 assetId(草稿里多为过期预签名 URL,用 assetId 重新换取签名) */
  thumbnailAssetId?: number
  /** 视频源地址（hover 预览） */
  videoUrl: string
  /** 视频素材 assetId（草稿里只存 assetId 时,用于换取签名 URL） */
  videoAssetId?: number
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

/** 解析项目封面图的 assetId(顶层 cover_asset_id → 入口素材 → 分镜图 → 元素图),用于换取新签名 URL */
function extractCoverAssetId(raw: any): number {
  const top = toNumber(raw?.cover_asset_id || raw?.coverAssetId || raw?.thumbnail_asset_id || raw?.thumbnailAssetId)
  if (top) return top
  const candidates = [raw?.draft_json, raw?.draftJson, raw?.draft, raw?.data?.draft_json, raw?.data?.draft]
  for (const item of candidates) {
    const draft = toPlainObject(item)
    if (!draft) continue
    const smart = toPlainObject(draft.smart) || draft
    // ① 入口素材 assetId
    const em = smart?.entryMeta || smart?.entry_meta || {}
    const aids = Array.isArray(em.imageAssetIds || em.imageAssetIDs) ? em.imageAssetIds || em.imageAssetIDs : []
    for (const a of aids) {
      const n = toNumber(a)
      if (n) return n
    }
    // ② 分镜图 assetId
    const shots = Array.isArray(smart?.shots) ? smart.shots : []
    for (const s of shots) {
      const n = toNumber(s?.imageAssetId || s?.image_asset_id)
      if (n) return n
    }
    // ③ 元素图 assetId
    for (const s of shots) {
      const subs = Array.isArray(s?.subjects) ? s.subjects : []
      for (const su of subs) {
        const n = toNumber(su?.assetId || su?.asset_id)
        if (n) return n
      }
    }
  }
  return 0
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

/**
 * 解析项目里的「全部」生成视频(url + assetId),与项目管理「待归类」extractUnclassified 对齐:
 * 逐条收集 videoVersions / videoHistoryList / generatedVideo,以及顶层直链字段;
 * url 或 assetId 任一存在即算一条视频(成片常只存 assetId,签名 URL 按需换取)。按 assetId/url 去重。
 */
function extractProjectVideos(raw: any): { url: string; assetId: number }[] {
  const out: { url: string; assetId: number }[] = []
  const seen = new Set<string>()
  const push = (rawUrl: string, assetId: number) => {
    const url = isSafeMediaUrl(rawUrl) ? rawUrl : ''
    if (!url && !assetId) return
    const key = assetId ? `a${assetId}` : `u${url}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ url, assetId })
  }

  // 顶层直链视频字段
  push(pickFirstText(raw?.videoUrl, raw?.video_url, raw?.outputUrl, raw?.output_url, raw?.url), 0)

  // draft 内的视频(取第一个有内容的 draft 候选)
  const candidates = [raw?.draft_json, raw?.draftJson, raw?.draft, raw?.data?.draft_json, raw?.data?.draft]
  for (const item of candidates) {
    const draft = toPlainObject(item)
    if (!draft) continue
    const smart = toPlainObject(draft.smart) || draft
    const before = out.length

    const vv = Array.isArray(smart?.videoVersions || draft?.videoVersions)
      ? smart?.videoVersions || draft?.videoVersions
      : []
    for (const v of vv)
      push(pickFirstText(v?.url, v?.src, v?.videoUrl, v?.video_url), toNumber(v?.assetId || v?.asset_id))

    const vh = Array.isArray(draft?.videoHistoryList || draft?.video_history_list)
      ? draft?.videoHistoryList || draft?.video_history_list
      : []
    for (const v of vh)
      push(pickFirstText(v?.url, v?.src, v?.videoUrl, v?.video_url), toNumber(v?.assetId || v?.asset_id))

    push(
      pickFirstText(
        draft?.generatedVideoUrl,
        draft?.generated_video_url,
        smart?.fullVideoUrl,
        smart?.full_video_url,
        smart?.generatedVideoUrl,
        smart?.generated_video_url,
      ),
      toNumber(draft?.generatedVideoAssetId || smart?.fullVideoAssetId || smart?.generatedVideoAssetId),
    )

    if (out.length > before) break // 这个 draft 候选已有视频 → 不再看其它候选,避免重复
  }
  return out
}

/** 把后端返回的项目记录归一化成 TemplateItem */
function normalizeProject(raw: any, index: number): TemplateItem {
  // 先从顶层字段取，再从 draft 里补
  let thumbnailUrl = pickFirstText(raw?.thumbnailUrl, raw?.thumbnail_url, raw?.coverUrl, raw?.cover_url, raw?.cover)
  if (!thumbnailUrl) thumbnailUrl = extractCoverFromDraft(raw)

  // 默认取第一条视频(listTemplates 会逐视频覆盖)
  const firstVideo = extractProjectVideos(raw)[0] || { url: '', assetId: 0 }
  const videoUrl = firstVideo.url
  const videoAssetId = firstVideo.assetId

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
    thumbnailAssetId: extractCoverAssetId(raw) || undefined,
    videoUrl,
    ratio,
    width: w || undefined,
    height: h || undefined,
    videoAssetId: videoAssetId || undefined,
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

  // 逐视频展开(对齐项目管理「待归类」:一个项目里每条视频都出一张卡片)
  const items: TemplateItem[] = []
  ;(Array.isArray(rawItems) ? rawItems : []).forEach((raw: any, pIdx: number) => {
    const videos = extractProjectVideos(raw)
    if (!videos.length) return
    const meta = normalizeProject(raw, pIdx)
    videos.forEach((v) => {
      items.push({ ...meta, videoUrl: v.url, videoAssetId: v.assetId || undefined })
    })
  })

  // 草稿里的 URL 多为已过期的 S3 预签名链接(X-Amz-Expires 很短,会 403 加载不出)。
  // 凡有 assetId 的封面图/视频,改用「鉴权直传」地址 /api/v1/assets/{id}/download:
  // 它走 cookie 鉴权、后端实时流式返回,不是预签名 → 永不过期,适合 <img>/<video> 长期显示。
  const wsId = Number(opts.workspaceId || 0)
  if (wsId) {
    for (const t of items) {
      if (t.thumbnailAssetId) t.thumbnailUrl = assetStreamUrl(t.thumbnailAssetId, wsId)
      if (t.videoAssetId) t.videoUrl = assetStreamUrl(t.videoAssetId, wsId)
    }
  }

  return { items, total: items.length }
}
