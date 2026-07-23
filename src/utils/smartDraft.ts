/**
 * 智能成片流程的本地草稿(localStorage)——便于测试时刷新/重进续上,不用从头再来。
 * 注意:blob: 临时图刷新后必失效,恢复时清掉;dataURL/http 图保留。localStorage 有配额,
 * 超限时退化为「不存图、只存文本结构」。
 */
import { sanitizePersistentMediaUrl } from './persistentMediaUrl'
import { sanitizeTelemetryText } from './observabilitySanitizer'
import { isLogoutDraftWriteBlocked } from './logoutBarrier'

/** 智能成片本地草稿存储键基础前缀。 */
const KEY = 'smart_create_draft_v1'

// 草稿按【用户】隔离:同一浏览器多个账号登录时,各存各的,避免"新用户读到上个用户的草稿 →
// 空白 /smart 拿别人的 projectId 去跳转 → 别人的项目 403/404 → 每次进来都报『项目加载失败』"。
// 由 store 会话变化时调 setSmartDraftUserScope(userId) 注入;未设置(未登录)用 'anon'。
let draftUserScope = ''
/** 设置当前草稿用户作用域，防止同浏览器不同账号之间串稿。 */
export function setSmartDraftUserScope(id: any) {
  draftUserScope = String(id || '')
}
/** 当前草稿默认工作区作用域。 */
let draftWorkspaceScope = 0
/** 设置当前工作区作用域，后续未显式传参的读写均使用该空间。 */
export function setSmartDraftWorkspaceScope(id: any) {
  draftWorkspaceScope = Number(id || 0) || 0
}
/** 旧版仅按用户隔离的草稿键，用于兼容迁移。 */
const legacyKeyOf = () => `${KEY}_u${draftUserScope || 'anon'}`
/** 构建按用户和工作区双重隔离的草稿键。 */
const keyOf = (workspaceId?: number) =>
  `${KEY}_u${draftUserScope || 'anon'}_ws${Math.floor(Number(workspaceId ?? draftWorkspaceScope) || 0)}`

/** 从新版存储键反向读取草稿用户，无法确认时返回 null。 */
function scopedDraftOwnerOf(storageKey: string | null): string | null {
  const prefix = `${KEY}_u`
  if (!storageKey?.startsWith(prefix)) return null
  const suffix = storageKey.slice(prefix.length)
  const workspaceSeparator = suffix.lastIndexOf('_ws')
  if (workspaceSeparator <= 0 || !/^-?\d+$/.test(suffix.slice(workspaceSeparator + 3))) return null
  return suffix.slice(0, workspaceSeparator)
}

/** 智能成片从入口到视频生成的可恢复会话状态。 */
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
  /** 流式脚本未完整结束时的错误；恢复后继续阻止把部分分镜误当作完整脚本确认。 */
  scriptError?: string
  /** 整片视频历史版本(每版带 asset_id,供水合刷新签名URL) */
  videoVersions?: { url: string; assetId: number; createdAt?: string }[]
  /** 每次「重新生成」的独立记录:生成中 / 失败(成功的成片仍进 videoVersions)。
   *  让项目下能看到每次生成是一条草稿:processing=生成中、failed=失败(可重试)、published=已并入成片。 */
  videoGenerations?: {
    id: string
    status: string
    taskId?: number
    idempotencyKey?: string
    note?: string
    modificationNote?: string
    error?: string
    createdAt?: number
  }[]
  /** 当前主视频对应的最近完成 generation；兼容旧草稿的单值终态标记。 */
  lastCompletedVideoGenerationId?: string
  /** 最近已完成的生成记录 ID；用于阻止旧 autosave/localStorage 把终态重新合并为 processing。 */
  completedVideoGenerationIds?: string[]
  /** 多视频生成时尚未真正发出的排队任务:刷新/重进后据此继续串行发送,保证整批走完 */
  videoGenQueue?: {
    id: string
    idempotencyKey?: string
    batchId?: string
    note?: string
    variationIndex?: number
    variationTotal?: number
    sourceImageAssetIds?: number[]
    preparedImageAssetIds?: number[]
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
  /** 图片对话尚未发送的文字、参考图、比例和单轮生成数量。 */
  imageComposerDraft?: {
    text?: string
    ratio?: string
    images?: Array<{ url?: string; assetId?: number }>
    outputCount?: number
  }
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

/**
 * 仅在权威项目快照或明确的新会话状态已应用、且用户确实开始创作后允许写草稿。
 * 该守卫可阻止页面首次重挂载时的空编辑器在恢复完成前覆盖有效云端草稿。
 */
export function canPersistSmartProjectDraft(args: {
  applied: boolean
  started: boolean
  projectId: unknown
  workspaceId: unknown
}): boolean {
  return (
    args.applied &&
    args.started &&
    Math.floor(Number(args.projectId) || 0) > 0 &&
    Math.floor(Number(args.workspaceId) || 0) > 0
  )
}

/** 保留的已完成生成墓碑数量上限，避免长期使用后草稿无限增长。 */
const MAX_COMPLETED_VIDEO_GENERATION_IDS = 50

/**
 * 合并已完成 generation 的 tombstone，并限制数量，避免草稿随长期使用无限增长。
 * 参数可传单个 ID 或 ID 数组；靠后的来源代表更新状态。
 */
export function mergeCompletedVideoGenerationIds(...sources: unknown[]): string[] {
  const merged: string[] = []
  const seen = new Set<string>()
  const append = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(append)
      return
    }
    const id = typeof value === 'string' ? value.trim() : ''
    if (!id || seen.has(id)) return
    seen.add(id)
    merged.push(id)
  }
  sources.forEach(append)
  return merged.slice(-MAX_COMPLETED_VIDEO_GENERATION_IDS)
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

/** 删除刷新后必然失效的 blob 地址，同时保留其他可恢复地址。 */
const killBlob = (u: any) => (typeof u === 'string' && u.startsWith('blob:') ? '' : u)

// 清洗对话消息:去掉失效图 url(保留 assetId 供按需重换签名URL)。
// 已拿到 taskId 的 pending 消息代表后端任务已经创建，必须原样保留供刷新后续轮询；
// 只有尚未创建后端任务的临时 pending 占位才转为可重试错误，避免界面永久卡住。
function cleanMessages(arr: any, killFn: (u: any) => any): any {
  if (!Array.isArray(arr)) return arr
  return arr
    .map((m: any) => {
      const images = Array.isArray(m?.images)
        ? m.images.map((im: any) => ({ ...im, url: killFn(im?.url) })).filter((im: any) => im.url || im.assetId)
        : m?.images
      const request = m?.request && typeof m.request === 'object' ? m.request : null
      const requestAssetIds = Array.isArray(request?.refAssetIds) ? request.refAssetIds : []
      const requestRefImages = Array.isArray(request?.refImages)
        ? request.refImages
            .map((image: any, index: number) => {
              const assetId = Number(image?.assetId || requestAssetIds[index] || 0) || 0
              return { ...image, assetId, url: killFn(image?.url) }
            })
            .filter((image: any) => image.url || image.assetId)
        : []
      const taskId = Math.max(0, Math.floor(Number(m?.taskId || 0) || 0))
      const pending = m?.role === 'assistant' && m?.status === 'pending'
      const queuedBatchItem =
        pending && taskId === 0 && String(m?.batchId || '').trim() && String(m?.idempotencyKey || '').trim() && request
      const resumable = pending && (taskId > 0 || !!queuedBatchItem)
      return {
        ...m,
        ...(taskId ? { taskId } : {}),
        images,
        ...(request
          ? {
              request: {
                ...request,
                refImages: requestRefImages,
                refAssetIds: requestRefImages.map((image: any) => Number(image.assetId || 0) || 0),
              },
            }
          : {}),
        ...(pending && !resumable ? { status: 'error', error: '生成已中断,请重试' } : {}),
      }
    })
    .filter(
      (m: any) =>
        (typeof m?.text === 'string' && m.text.trim()) ||
        (Array.isArray(m?.images) && m.images.length) ||
        (m?.status === 'pending' &&
          (Number(m?.taskId || 0) > 0 ||
            (String(m?.batchId || '').trim() && String(m?.idempotencyKey || '').trim() && m?.request))) ||
        m?.status === 'error',
    )
}

/** 清洗本地草稿的临时媒体、对话和生成记录，保证刷新后状态可恢复。 */
function sanitize(d: SmartDraft): SmartDraft {
  const next: SmartDraft = { ...d }
  next.completedVideoGenerationIds = mergeCompletedVideoGenerationIds(
    next.completedVideoGenerationIds,
    next.lastCompletedVideoGenerationId,
  )
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
  if (next.imageComposerDraft && typeof next.imageComposerDraft === 'object') {
    next.imageComposerDraft = {
      ...next.imageComposerDraft,
      images: (Array.isArray(next.imageComposerDraft.images) ? next.imageComposerDraft.images : [])
        .map((image: any) => ({ ...image, url: killBlob(image?.url) }))
        .filter((image: any) => image.url || Number(image.assetId || 0) > 0),
    }
  }
  if (Array.isArray(next.videoGenerations)) {
    next.videoGenerations = next.videoGenerations
      .filter((g: any) => String(g?.status || '').trim() === 'processing')
      .map((g: any) => {
        const idempotencyKey = String(g?.idempotencyKey || g?.idempotency_key || '').trim()
        return {
          ...g,
          taskId: Number(g?.taskId || 0) || 0,
          ...(idempotencyKey ? { idempotencyKey } : {}),
          ...(g?.error ? { error: sanitizeTelemetryText(String(g.error)).slice(0, 500) } : { error: undefined }),
        }
      })
  }
  if (Array.isArray(next.videoGenQueue)) {
    const liveGenerationIds = new Set(
      (next.videoGenerations || []).map((g: any) => String(g?.id || '').trim()).filter(Boolean),
    )
    next.videoGenQueue = next.videoGenQueue.filter((job: any) => liveGenerationIds.has(String(job?.id || '').trim()))
  }
  return next
}

/** 读取当前用户与工作区的本地草稿，并安全迁移同空间的旧版数据。 */
export function loadSmartDraft(workspaceId?: number): SmartDraft | null {
  try {
    const ws = Math.floor(Number(workspaceId ?? draftWorkspaceScope) || 0)
    const scopedKey = keyOf(ws)
    const scoped = localStorage.getItem(scopedKey)
    if (scoped) return sanitize(sanitizeSmartLocalDraft(JSON.parse(scoped), ws))
    const legacy = localStorage.getItem(legacyKeyOf())
    if (!legacy) return null
    const parsed = sanitize(sanitizeSmartLocalDraft(JSON.parse(legacy), ws))
    const storedWorkspaceId = Math.floor(Number(parsed.workspaceId || 0) || 0)
    // User-only legacy drafts may migrate only when their recorded workspace
    // matches. An ambiguous draft must never cross workspace boundaries.
    if (!ws || !storedWorkspaceId || storedWorkspaceId !== ws) return null
    const migrated = sanitizeSmartLocalDraft(parsed, ws)
    localStorage.setItem(scopedKey, JSON.stringify(migrated))
    localStorage.removeItem(legacyKeyOf())
    return migrated
  } catch {
    return null
  }
}

/** 保存精简后的本地草稿；超出配额时进一步移除图片数据后重试。 */
export function saveSmartDraft(state: SmartDraft, workspaceId?: number) {
  if (isLogoutDraftWriteBlocked(draftUserScope)) return
  // 与 2.0 一致:草稿不存 data:/blob:(体积大且会撑爆 localStorage 配额导致整盘清空);
  // 只存可持久的 http 图 + asset_id,刷新后按 asset_id 重换签名URL(见 SmartCreateView hydrate)。
  const ws = Number(workspaceId ?? draftWorkspaceScope) || 0
  const lean = {
    ...stripHeavy(sanitizeSmartLocalDraft(state, ws)),
    workspaceId: ws,
    savedAt: Date.now(),
  }
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

/** 清除指定工作区的智能成片草稿及可兼容旧键。 */
export function clearSmartDraft(workspaceId?: number) {
  try {
    localStorage.removeItem(keyOf(workspaceId))
    localStorage.removeItem(legacyKeyOf())
  } catch {
    /* ignore */
  }
}

/** 清除指定账号拥有的全部工作区草稿，不影响其他账号。 */
export function clearSmartDraftsForUser(userId: unknown): void {
  const userScope = String(userId || '').trim()
  if (!userScope) return
  const userLegacyKey = `${KEY}_u${userScope}`
  try {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index)
      if (scopedDraftOwnerOf(key) === userScope || key === userLegacyKey || key === KEY) {
        localStorage.removeItem(key)
      }
    }
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
/** 删除不适合写入云端快照的 data 与 blob 地址。 */
const killHeavy = (u: any) => (typeof u === 'string' && (u.startsWith('blob:') || u.startsWith('data:')) ? '' : u)

/** 构建适合云端持久化的轻量草稿，保留素材 ID 以便刷新地址。 */
function stripHeavy(d: SmartDraft): SmartDraft {
  const next = sanitize(d)
  if (next.entryMeta?.images) {
    const assetIds = Array.isArray(next.entryMeta.imageAssetIds) ? next.entryMeta.imageAssetIds : []
    const pairs = (next.entryMeta.images || [])
      .map((url: string, index: number) => ({
        url: killHeavy(url),
        assetId: Number(assetIds[index] || 0) || 0,
      }))
      .filter((item: { url: string; assetId: number }) => item.url || item.assetId)
    next.entryMeta = {
      ...next.entryMeta,
      images: pairs.map((item: { url: string }) => item.url),
      ...(assetIds.length ? { imageAssetIds: pairs.map((item: { assetId: number }) => item.assetId) } : {}),
    }
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
            .filter((v: any) => v.url || Number(v.assetId || 0) > 0)
        : s.imageVersions,
      subjects: Array.isArray(s.subjects)
        ? s.subjects.map((x: any) => ({ ...x, image: killHeavy(x.image), refImage: killHeavy(x.refImage) }))
        : [],
      extraRefs: Array.isArray(s.extraRefs)
        ? s.extraRefs
            .map((r: any) => ({ ...r, url: killHeavy(r?.url) }))
            .filter((r: any) => r.url || Number(r.assetId || 0) > 0)
        : s.extraRefs,
      selectedRefs: Array.isArray(s.selectedRefs) ? s.selectedRefs.map(killHeavy).filter(Boolean) : s.selectedRefs,
    }))
  }
  if (Array.isArray(next.videoVersions)) {
    next.videoVersions = next.videoVersions
      .map((v: any) => (typeof v === 'string' ? { url: killHeavy(v), assetId: 0 } : { ...v, url: killHeavy(v?.url) }))
      .filter((v: any) => v.url || Number(v.assetId || 0) > 0)
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
  if (next.imageComposerDraft && typeof next.imageComposerDraft === 'object') {
    next.imageComposerDraft = {
      ...next.imageComposerDraft,
      images: (Array.isArray(next.imageComposerDraft.images) ? next.imageComposerDraft.images : [])
        .map((image: any) => ({ ...image, url: killHeavy(image?.url) }))
        .filter((image: any) => image.url || Number(image.assetId || 0) > 0),
    }
  }
  return next
}

/** 将草稿中的媒体引用统一为当前工作区可长期恢复的安全地址。 */
function sanitizeSmartLocalDraft(draft: SmartDraft, workspaceId: number): SmartDraft {
  const next: SmartDraft = { ...draft }
  const cleanUrl = (value: unknown, assetId: unknown = 0) =>
    sanitizePersistentMediaUrl(value, { assetId: Number(assetId || 0) || 0, workspaceId })

  if (next.entryMeta?.images) {
    const imageAssetIds = Array.isArray(next.entryMeta.imageAssetIds) ? next.entryMeta.imageAssetIds : []
    const pairs = next.entryMeta.images
      .map((url: string, index: number) => {
        const assetId = Number(imageAssetIds[index] || 0) || 0
        return { url: cleanUrl(url, assetId), assetId }
      })
      .filter((item: { url: string; assetId: number }) => item.url || item.assetId)
    next.entryMeta = {
      ...next.entryMeta,
      images: pairs.map((item: { url: string }) => item.url),
      ...(imageAssetIds.length ? { imageAssetIds: pairs.map((item: { assetId: number }) => item.assetId) } : {}),
    }
  }

  if (Array.isArray(next.shots)) {
    next.shots = next.shots.map((shot: any) => ({
      ...shot,
      image: cleanUrl(shot.image, shot.imageAssetId),
      blurredImageUrl: cleanUrl(shot.blurredImageUrl, shot.blurredImageAssetId),
      imageVersions: Array.isArray(shot.imageVersions)
        ? shot.imageVersions
            .map((value: any) => {
              const version = typeof value === 'string' ? { url: value, assetId: 0 } : value || {}
              const assetId = Number(version.assetId || 0) || 0
              return {
                ...version,
                assetId,
                url: cleanUrl(version.url, assetId),
                ...(Array.isArray(version.refs)
                  ? { refs: version.refs.map((url: string) => cleanUrl(url)).filter(Boolean) }
                  : {}),
              }
            })
            .filter((version: any) => version.url || version.assetId)
        : shot.imageVersions,
      subjects: Array.isArray(shot.subjects)
        ? shot.subjects.map((subject: any) => ({
            ...subject,
            image: cleanUrl(subject.image, subject.assetId),
            refImage: cleanUrl(subject.refImage, subject.refAssetId),
          }))
        : [],
      extraRefs: Array.isArray(shot.extraRefs)
        ? shot.extraRefs
            .map((ref: any) => ({
              ...ref,
              url: cleanUrl(ref?.url, ref?.assetId),
            }))
            .filter((ref: any) => ref.url || Number(ref.assetId || 0) > 0)
        : shot.extraRefs,
      selectedRefs: Array.isArray(shot.selectedRefs)
        ? shot.selectedRefs.map((url: string) => cleanUrl(url)).filter(Boolean)
        : shot.selectedRefs,
    }))
  }

  if (next.subjectAssets && typeof next.subjectAssets === 'object') {
    const subjectAssets: Record<string, any> = {}
    for (const [name, value] of Object.entries(next.subjectAssets)) {
      const oldIds = value?.ids || {}
      const oldSources = value?.sources || {}
      const ids: Record<string, number> = {}
      const sources: Record<string, any> = {}
      const versions = (Array.isArray(value?.versions) ? value.versions : [])
        .map((url: string) => {
          const assetId = Number(oldIds[url] || 0) || 0
          const nextUrl = cleanUrl(url, assetId)
          if (nextUrl && assetId) ids[nextUrl] = assetId
          if (nextUrl && oldSources[url]) sources[nextUrl] = oldSources[url]
          return nextUrl
        })
        .filter(Boolean)
      subjectAssets[name] = { ...value, versions, ids, sources }
    }
    next.subjectAssets = subjectAssets
  }

  if (Array.isArray(next.imageMessages)) {
    next.imageMessages = next.imageMessages.map((message: any) => ({
      ...message,
      images: Array.isArray(message?.images)
        ? message.images
            .map((image: any) => {
              const assetId = Number(image?.assetId || 0) || 0
              return { ...image, assetId, url: cleanUrl(image?.url, assetId) }
            })
            .filter((image: any) => image.url || image.assetId)
        : message?.images,
      ...(message?.request && typeof message.request === 'object'
        ? {
            request: (() => {
              const refAssetIds = Array.isArray(message.request.refAssetIds) ? message.request.refAssetIds : []
              const refImages = (Array.isArray(message.request.refImages) ? message.request.refImages : [])
                .map((image: any, index: number) => {
                  const assetId = Number(image?.assetId || refAssetIds[index] || 0) || 0
                  return { ...image, assetId, url: cleanUrl(image?.url, assetId) }
                })
                .filter((image: any) => image.url || image.assetId)
              return {
                ...message.request,
                refImages,
                refAssetIds: refImages.map((image: any) => Number(image.assetId || 0) || 0),
              }
            })(),
          }
        : {}),
    }))
  }

  if (next.imageComposerDraft && typeof next.imageComposerDraft === 'object') {
    next.imageComposerDraft = {
      ...next.imageComposerDraft,
      images: (Array.isArray(next.imageComposerDraft.images) ? next.imageComposerDraft.images : [])
        .map((image: any) => {
          const assetId = Number(image?.assetId || 0) || 0
          return { ...image, assetId, url: cleanUrl(image?.url, assetId) }
        })
        .filter((image: any) => image.url || image.assetId),
    }
  }

  const fullVideoAssetId = Number(next.fullVideoAssetId || 0) || 0
  next.fullVideoUrl = cleanUrl(next.fullVideoUrl, fullVideoAssetId)
  if (Array.isArray(next.videoVersions)) {
    next.videoVersions = next.videoVersions
      .map((value: any) => {
        const version = typeof value === 'string' ? { url: value, assetId: 0 } : value || {}
        const assetId = Number(version.assetId || 0) || 0
        return { ...version, assetId, url: cleanUrl(version.url, assetId) }
      })
      .filter((version: any) => version.url || version.assetId)
  }
  return next
}

/** 页面步骤索引与云端草稿步骤码的映射。 */
const STEP_CODES = ['script', 'material', 'storyboard', 'video']

/** 将原生智能成片状态投影为项目管理兼容的云端草稿快照。 */
export function buildSmartSnapshot(d: SmartDraft, workspaceId = Number(d.workspaceId || 0)): any {
  const clean = sanitizeSmartLocalDraft(stripHeavy(d), workspaceId)
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
