/**
 * 智能成片流程的本地草稿(localStorage)——便于测试时刷新/重进续上,不用从头再来。
 * 注意:blob: 临时图刷新后必失效,恢复时清掉;dataURL/http 图保留。localStorage 有配额,
 * 超限时退化为「不存图、只存文本结构」。
 */
const KEY = 'smart_create_draft_v1'

// 草稿按【用户】隔离:同一浏览器多个账号登录时,各存各的,避免"新用户读到上个用户的草稿 →
// 空白 /smart 拿别人的 projectId 去跳转 → 别人的项目 403/404 → 每次进来都报『项目加载失败』"。
// 由 store 会话变化时调 setSmartDraftUserScope(userId) 注入;未设置(未登录)用 'anon'。
let draftUserScope = ''
export function setSmartDraftUserScope(id: any) {
  draftUserScope = String(id || '')
}
let draftWorkspaceScope = 0
export function setSmartDraftWorkspaceScope(id: any) {
  draftWorkspaceScope = Number(id || 0) || 0
}
const legacyKeyOf = () => `${KEY}_u${draftUserScope || 'anon'}`
const keyOf = (workspaceId?: number) =>
  `${KEY}_u${draftUserScope || 'anon'}_ws${Math.floor(Number(workspaceId ?? draftWorkspaceScope) || 0)}`

export interface SmartDraft {
  workspaceId?: number
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
  /** 草稿归属(同一浏览器换账号/空间时校验,避免把别人的在制项目带给新用户 → 加载失败) */
  ownerUserId?: number
  /** 整片视频(seedance 一次生成) */
  fullVideoUrl?: string
  fullVideoAssetId?: number
  /** 进行中的整片生成任务 id:中途切路由/刷新后凭它续轮询(不重新生成);完成后清 0 */
  vidGenTaskId?: number
  /** 准备素材「一键生成」是否进行中:中途切走再回来据此自动续作未出图的素材 */
  materialBatchPending?: boolean
  /** 分镜脚本是否生成进行中:中途切走再回来据此自动续跑(重新生成脚本),避免"中断" */
  scriptPending?: boolean
  /** 整片视频历史版本(每版带 asset_id,供水合刷新签名URL) */
  videoVersions?: { url: string; assetId: number; createdAt?: string }[]
  /** 每次「重新生成」的独立记录:生成中 / 失败(成功的成片仍进 videoVersions)。
   *  让项目下能看到每次生成是一条草稿:processing=生成中、failed=失败(可重试)、published=已并入成片。 */
  videoGenerations?: {
    id: string
    status: string
    taskId?: number
    note?: string
    error?: string
    createdAt?: number
  }[]
  /** 多视频生成时尚未真正发出的排队任务:刷新/重进后据此继续串行发送,保证整批走完 */
  videoGenQueue?: {
    id: string
    note?: string
    variationIndex?: number
    variationTotal?: number
    opts?: { edit?: boolean }
  }[]
  /** 人脸脱敏开关(默认开;关闭后出片用原图,成片人脸清晰) */
  faceBlurEnabled?: boolean
  /** 营销思路拆解(选中 SKILL 时多出的第 1 步):是否停留在该步 + 生成的建议正文 + 结构化数据 */
  marketingOpen?: boolean
  marketingText?: string
  /** 结构化拆解(8 维度 desc+tags),用于「营销思路拆解」步表格回填 */
  marketingData?: any
  /** 制作图片(chat 模式)的消息流(用户提问 + AI 生成图,图带 asset_id 供水合) */
  imageMessages?: any[]
  /** 上一版整片成片所依据的「内容签名」(computeVideoContentSig):
   *  用于项目管理列表派生判断——当前草稿内容签名 ≠ 此值 ⇒ 内容已改、尚未出新片 ⇒ 显示为「草稿(在制)」。
   *  仅在成片落库时(persistVideoResult / 出片成功)盖章,不随普通编辑变化。 */
  lastVideoSig?: string
  /** 本次在途出片【发起时锁定】的内容签名(computeVideoContentSig):
   *  生成开始即算好并持久化,完成时用它盖 lastVideoSig —— 避免用"完成那一刻的当前分镜"盖章,
   *  否则用户在生成中/生成后改了内容,会把签名盖成新内容 ⇒ 列表误判"没变"、不显示草稿。
   *  完成落库后清空。 */
  pendingVideoSig?: string
  /** 保存时间戳(ms):用于「/smart/:id 恢复时本地草稿是否比后端更新」的比较 */
  savedAt?: number
}

// 整片视频的「内容签名」:参与视频的分镜稳定内容(优先 imageAssetId,其次去掉签名参数的图 URL,
// 避免 S3 预签名/工作空间参数变化导致误判)+ 时长/台词/字幕/音效/顺序 + 风格/比例/大纲。
// 与 SmartCreateView.videoInputSig 同口径,但只用「落盘后稳定」的字段,以便跨保存/刷新可靠比较。
export function computeVideoContentSig(shots: any[], entryMeta: any, base: string): string {
  const stableImg = (s: any): string => {
    const aid = Number(s?.imageAssetId || s?.asset_id || s?.assetId || 0) || 0
    if (aid) return `a:${aid}`
    const u = String(s?.image || s?.url || '').trim()
    // data:/blob: 落盘时被 stripHeavy 清空(只留 asset_id + http)→ 此处也视为空,否则锁定端(带 data:)
    // 与落盘后列表端(空)签名不等,又出现「明明没改却显示 · 草稿」的幻影。
    if (!u || /^(data:|blob:)/i.test(u)) return ''
    return `u:${u.split('?')[0]}`
  }
  return JSON.stringify({
    ratio: entryMeta?.ratio || '',
    style: entryMeta?.style || '',
    // trim:出片锁定端传原始 reqSummary(LLM 常带尾部换行/空格),项目列表端传 pickString 已 trim 的值。
    // 两端不一致会让签名不等 → 明明没改却永久显示「· 草稿(内容已改)」。统一在此 trim,两端一致。
    base: String(base || '').trim(),
    shots: (Array.isArray(shots) ? shots : [])
      .filter((s) => s?.includeInVideo !== false)
      .map((s) => ({
        id: s?.id,
        img: stableImg(s),
        duration: s?.duration || '',
        line: s?.line || '',
        subtitle: s?.subtitle || '',
        sfx: s?.sfx || '',
      })),
  })
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
      subjects: Array.isArray(s.subjects)
        ? s.subjects.map((x: any) => ({ ...x, image: killBlob(x.image), refImage: killBlob(x.refImage) }))
        : [],
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

export function loadSmartDraft(workspaceId?: number): SmartDraft | null {
  try {
    const scoped = localStorage.getItem(keyOf(workspaceId))
    if (scoped) return sanitize(JSON.parse(scoped))
    const legacy = localStorage.getItem(legacyKeyOf())
    if (!legacy) return null
    return sanitize(JSON.parse(legacy))
  } catch {
    return null
  }
}

export function saveSmartDraft(state: SmartDraft, workspaceId?: number) {
  // 与 2.0 一致:草稿不存 data:/blob:(体积大且会撑爆 localStorage 配额导致整盘清空);
  // 只存可持久的 http 图 + asset_id,刷新后按 asset_id 重换签名URL(见 SmartCreateView hydrate)。
  const ws = Number(workspaceId ?? draftWorkspaceScope) || 0
  const lean = { ...stripHeavy(state), workspaceId: ws, savedAt: Date.now() }
  try {
    localStorage.setItem(keyOf(ws), JSON.stringify(lean))
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
      localStorage.setItem(keyOf(ws), JSON.stringify(light))
    } catch {
      /* 放弃 */
    }
  }
}

export function clearSmartDraft(workspaceId?: number) {
  try {
    localStorage.removeItem(keyOf(workspaceId))
    localStorage.removeItem(legacyKeyOf())
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
      subjects: Array.isArray(s.subjects)
        ? s.subjects.map((x: any) => ({ ...x, image: killHeavy(x.image), refImage: killHeavy(x.refImage) }))
        : [],
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
  const videoVersions = (clean.videoVersions || []).map((v: any) => {
    if (typeof v === 'string') return { url: v, assetId: 0 }
    const out: any = { url: v?.url, assetId: v?.assetId }
    // 保留本版生成完成时间(项目管理按它展示每条视频的时间)
    if (v?.createdAt) out.createdAt = v.createdAt
    return out
  })
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
    // 智能成片原生快照(精确回填,见 parseSmartSnapshot);stamp savedAt 供恢复时与本地草稿比新旧
    smart: { ...clean, savedAt: Date.now() },
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
  const flow = String(obj?.smart?.flow || obj?.flow || '').toLowerCase()
  if (flow === 'hot-copy') return null
  const smart = obj.smart
  if (smart && typeof smart === 'object') return sanitize(smart as SmartDraft)
  return null
}
