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
}

const killBlob = (u: any) => (typeof u === 'string' && u.startsWith('blob:') ? '' : u)

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
    }))
  }
  if (next.subjectAssets && typeof next.subjectAssets === 'object') {
    const sa: Record<string, any> = {}
    for (const [k, v] of Object.entries(next.subjectAssets)) {
      const versions = (v?.versions || []).map(killBlob).filter(Boolean)
      const sources: Record<string, any> = {}
      if (v?.sources) for (const [u, src] of Object.entries(v.sources)) if (!String(u).startsWith('blob:')) sources[u] = src
      sa[k] = { ...v, versions, sources }
    }
    next.subjectAssets = sa
  }
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
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // 配额超限:退化为只存文本结构(去掉所有图)
    try {
      const light: SmartDraft = {
        ...state,
        entryMeta: state.entryMeta ? { ...state.entryMeta, images: [] } : state.entryMeta,
        shots: (state.shots || []).map((s: any) => ({
          ...s,
          image: '',
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
