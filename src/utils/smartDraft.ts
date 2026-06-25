/**
 * 智能成片流程的本地草稿(localStorage)——便于测试时刷新/重进续上,不用从头再来。
 * 注意:blob: 临时图刷新后必失效,恢复时清掉;dataURL/http 图保留。localStorage 有配额,
 * 超限时退化为「不存图、只存文本结构」。
 */
const KEY = 'smart_create_draft_v1'

export interface SmartDraft {
  started?: boolean
  requirement?: string
  reqSummary?: string
  entryMeta?: any
  projectName?: string
  nameTouched?: boolean
  step?: number
  maxReached?: number
  shots?: any[]
  subjectAssets?: Record<string, any>
  fields?: Record<string, string>
  projectId?: number
  /** 整片视频(seedance 一次生成) */
  fullVideoUrl?: string
  fullVideoAssetId?: number
  /** 整片视频历史版本(每版带 asset_id,供水合刷新签名URL) */
  videoVersions?: { url: string; assetId: number }[]
  /** 营销思路拆解(选中 SKILL 时多出的第 1 步):是否停留在该步 + 生成的建议正文 */
  marketingOpen?: boolean
  marketingText?: string
  /** 制作图片(chat 模式)的消息流(用户提问 + AI 生成图,图带 asset_id 供水合) */
  imageMessages?: any[]
}

const killBlob = (u: any) => (typeof u === 'string' && u.startsWith('blob:') ? '' : u)

// 清洗对话消息:去掉失效图 url(保留 assetId 供按需重换签名URL);
// 保存时仍在出图的 assistant(pending)落库会卡死「生成中」,转为可重试的错误态。
function cleanMessages(arr: any, killFn: (u: any) => any): any {
  if (!Array.isArray(arr)) return arr
  return arr
    .map((m: any) => {
      const images = Array.isArray(m?.images)
        ? m.images.map((im: any) => ({ ...im, url: killFn(im?.url) })).filter((im: any) => im.url || im.assetId)
        : m?.images
      const broken = m?.role === 'assistant' && m?.status === 'pending'
      return {
        ...m,
        images,
        ...(broken ? { status: 'error', error: '生成已中断,请重试' } : {}),
      }
    })
    .filter(
      (m: any) =>
        (typeof m?.text === 'string' && m.text.trim()) ||
        (Array.isArray(m?.images) && m.images.length) ||
        m?.status === 'error',
    )
}

function sanitize(d: SmartDraft): SmartDraft {
  const next: SmartDraft = { ...d }
  if (next.entryMeta?.images) {
    next.entryMeta = { ...next.entryMeta, images: next.entryMeta.images.map(killBlob).filter(Boolean) }
  }
  if (Array.isArray(next.shots)) {
    next.shots = next.shots.map((s: any) => ({
      ...s,
      image: killBlob(s.image),
      subjects: Array.isArray(s.subjects) ? s.subjects.map((x: any) => ({ ...x, image: killBlob(x.image) })) : [],
      extraRefs: Array.isArray(s.extraRefs)
        ? s.extraRefs.map((r: any) => ({ ...r, url: killBlob(r?.url) })).filter((r: any) => r.url)
        : s.extraRefs,
      selectedRefs: Array.isArray(s.selectedRefs) ? s.selectedRefs.map(killBlob).filter(Boolean) : s.selectedRefs,
    }))
  }
  if (next.subjectAssets && typeof next.subjectAssets === 'object') {
    const sa: Record<string, any> = {}
    for (const [k, v] of Object.entries(next.subjectAssets)) {
      const versions = (v?.versions || []).map(killBlob).filter(Boolean)
      const sources: Record<string, any> = {}
      if (v?.sources)
        for (const [u, src] of Object.entries(v.sources)) if (!String(u).startsWith('blob:')) sources[u] = src
      sa[k] = { ...v, versions, sources }
    }
    next.subjectAssets = sa
  }
  if (Array.isArray(next.imageMessages)) next.imageMessages = cleanMessages(next.imageMessages, killBlob)
  return next
}

export function loadSmartDraft(): SmartDraft | null {
  try {
    const s = localStorage.getItem(KEY)
    if (!s) return null
    return sanitize(JSON.parse(s))
  } catch {
    return null
  }
}

export function saveSmartDraft(state: SmartDraft) {
  // 与 2.0 一致:草稿不存 data:/blob:(体积大且会撑爆 localStorage 配额导致整盘清空);
  // 只存可持久的 http 图 + asset_id,刷新后按 asset_id 重换签名URL(见 SmartCreateView hydrate)。
  const lean = stripHeavy(state)
  try {
    localStorage.setItem(KEY, JSON.stringify(lean))
  } catch {
    // 仍超限(极端):退化为只存文本结构
    try {
      const light: SmartDraft = {
        ...lean,
        entryMeta: lean.entryMeta ? { ...lean.entryMeta, images: [] } : lean.entryMeta,
        shots: (lean.shots || []).map((s: any) => ({
          ...s,
          image: '',
          imageVersions: [],
          subjects: (s.subjects || []).map((x: any) => ({ ...x, image: '' })),
        })),
        subjectAssets: {},
      }
      localStorage.setItem(KEY, JSON.stringify(light))
    } catch {
      /* 放弃 */
    }
  }
}

export function clearSmartDraft() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}

// ── 后端草稿快照(写入 /creative/projects/:id/draft 的 draft_json)──
// 与 2.0 项目管理页(ProjectManagementView)的读取契约对齐:
//   - storyboardItems[].currentImage / versionHistory → 取封面 + 统计分镜数
//   - generatedVideoUrl / generatedVideoAssetId → 封面降级 + 版本预览取视频
//   - videoHistoryList → 多片段
// 另存原生 smart 块用于精确回填。data:/blob: 体积大且仅本地可用,后端快照里剥离,只留 http 图。
const killHeavy = (u: any) => (typeof u === 'string' && (u.startsWith('blob:') || u.startsWith('data:')) ? '' : u)

function stripHeavy(d: SmartDraft): SmartDraft {
  const next = sanitize(d)
  if (next.entryMeta?.images) {
    next.entryMeta = { ...next.entryMeta, images: (next.entryMeta.images || []).map(killHeavy).filter(Boolean) }
  }
  if (Array.isArray(next.shots)) {
    next.shots = next.shots.map((s: any) => ({
      ...s,
      image: killHeavy(s.image),
      imageVersions: Array.isArray(s.imageVersions)
        ? s.imageVersions
            .map((v: any) =>
              typeof v === 'string'
                ? { url: killHeavy(v), assetId: 0 }
                : { ...v, url: killHeavy(v?.url), ...(v?.refs ? { refs: v.refs.map(killHeavy).filter(Boolean) } : {}) },
            )
            .filter((v: any) => v.url)
        : s.imageVersions,
      subjects: Array.isArray(s.subjects) ? s.subjects.map((x: any) => ({ ...x, image: killHeavy(x.image) })) : [],
      extraRefs: Array.isArray(s.extraRefs)
        ? s.extraRefs.map((r: any) => ({ ...r, url: killHeavy(r?.url) })).filter((r: any) => r.url)
        : s.extraRefs,
      selectedRefs: Array.isArray(s.selectedRefs) ? s.selectedRefs.map(killHeavy).filter(Boolean) : s.selectedRefs,
    }))
  }
  if (Array.isArray(next.videoVersions)) {
    next.videoVersions = next.videoVersions
      .map((v: any) => (typeof v === 'string' ? { url: killHeavy(v), assetId: 0 } : { ...v, url: killHeavy(v?.url) }))
      .filter((v: any) => v.url)
  }
  if (next.subjectAssets && typeof next.subjectAssets === 'object') {
    const sa: Record<string, any> = {}
    for (const [k, v] of Object.entries(next.subjectAssets)) {
      const versions = (v?.versions || []).map(killHeavy).filter(Boolean)
      const sources: Record<string, any> = {}
      if (v?.sources) for (const [u, src] of Object.entries(v.sources)) if (killHeavy(u)) sources[u] = src
      sa[k] = { ...v, versions, sources }
    }
    next.subjectAssets = sa
  }
  if (Array.isArray(next.imageMessages)) next.imageMessages = cleanMessages(next.imageMessages, killHeavy)
  return next
}

const STEP_CODES = ['script', 'storyboard', 'video']

export function buildSmartSnapshot(d: SmartDraft): any {
  const clean = stripHeavy(d)
  const shots = clean.shots || []
  const storyboardItems = shots.map((s: any, i: number) => ({
    id: s.id ?? i,
    index: i,
    currentImage: s.image ? { url: s.image } : null,
    versionHistory: (s.imageVersions || []).map((v: any) =>
      typeof v === 'string' ? { url: v } : { url: v?.url, assetId: v?.assetId },
    ),
  }))
  const fvUrl = killHeavy(clean.fullVideoUrl || '')
  const fvId = Number(clean.fullVideoAssetId || 0) || 0
  const videoVersions = (clean.videoVersions || []).map((v: any) => ({
    url: typeof v === 'string' ? v : v?.url,
    assetId: typeof v === 'string' ? 0 : v?.assetId,
  }))
  return {
    flow: 'smart',
    title: clean.projectName || '',
    currentStep: STEP_CODES[clean.step || 0] || 'script',
    description: clean.requirement || '',
    reqSummary: clean.reqSummary || '',
    selectedDuration: clean.entryMeta?.duration || '',
    selectedRatio: clean.entryMeta?.ratio || '',
    selectedStyles: clean.entryMeta?.style ? [clean.entryMeta.style] : [],
    storyboardItems,
    generatedVideoUrl: fvUrl,
    generatedVideoAssetId: fvId,
    videoHistoryList: videoVersions.length ? videoVersions : fvUrl || fvId ? [{ url: fvUrl, assetId: fvId }] : [],
    // 智能成片原生快照(精确回填,见 parseSmartSnapshot)
    smart: clean,
  }
}

/** 从后端 draft_json 还原智能成片草稿。draft_json 可能是字符串或对象。 */
export function parseSmartSnapshot(draftJson: any): SmartDraft | null {
  let obj = draftJson
  if (typeof obj === 'string') {
    try {
      obj = JSON.parse(obj)
    } catch {
      return null
    }
  }
  if (!obj || typeof obj !== 'object') return null
  const smart = obj.smart
  if (smart && typeof smart === 'object') return sanitize(smart as SmartDraft)
  return null
}
