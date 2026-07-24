/**
 * 项目视频聚合与操作层。
 * 从智能成片/爆款复制草稿派生历史视频，合并人工归类记录和状态覆盖，并以乐观锁安全写回项目草稿。
 */
import { getCreativeProject, updateCreativeProjectDraft } from '@/api/business'
import { computeVideoContentSig, isVideoContentSigMatch } from '@/utils/smartDraft'
import { assetStreamUrl } from '@/utils/assetUrl'
import { enqueueCreativeProjectDraftSave } from '@/utils/creativeDraftSaveQueue'
import {
  getCreativeProjectDraft,
  normalizeArray,
  resolveCreativeProjectOwnerId,
  resolveUserId,
  toPlainObject,
} from '@/utils/creativeDraftMetadata'
import { sanitizePersistentProjectVideoStore } from '@/utils/persistentMediaUrl'
import {
  isDraftConflictError,
  isRetryableDraftSaveError,
  waitForDraftSaveRetry,
} from '@/utils/creativeDraftPersistence'

/** 项目视频在任务中心的归一化状态。 */
export type ProjectVideoStatus = 'draft' | 'processing' | 'published' | 'failed'
/** 视频来源分类，用于页面图标与入口分流。 */
export type ProjectVideoSourceType = 'smart' | 'creative'

/** 项目详情和任务中心共用的标准化视频记录。 */
export interface ProjectVideo {
  id: string
  projectId: number
  workspaceId: number
  title: string
  coverUrl: string
  videoUrl: string
  /** 成片素材 ID；任务中心用它在签名地址失效后重新取得播放地址。 */
  videoAssetId?: number
  /** 生成时使用的画面比例，例如 16:9。 */
  ratio?: string
  durationSeconds: number
  status: ProjectVideoStatus
  createdByName: string
  /** 创建者用户 ID(来自 project.user_id),用于前端权限判断 */
  createdByUserId: number
  createdAt: string
  updatedAt: string
  sourceType: ProjectVideoSourceType
  /** 真实创作流程标识(draft.flow):'smart' | 'hot-copy' | 'creative' …,用于「进入编辑」路由分流 */
  flow: string
  publishUrl?: string
  /** 手动新建 / 归类进来的记录(随项目草稿存云端),用于和派生视频区分 */
  manual?: boolean
  /** 归类来源视频的稳定 key(videoKeyOf),供「待分类」去重隐藏 */
  sourceKey?: string
}

/** 用户手动归类到项目的持久化视频记录。 */
interface LocalProjectVideoRecord extends ProjectVideo {
  manual: true
}

/** 对草稿派生视频的隐藏、状态和标题覆盖。 */
interface ProjectVideoOverride {
  hidden?: boolean
  status?: ProjectVideoStatus
  title?: string
  updatedAt?: string
}

/** 随项目草稿保存的手动记录与派生项覆盖集合。 */
export interface ProjectVideoStore {
  records: LocalProjectVideoRecord[]
  overrides: Record<string, ProjectVideoOverride>
}

/** 视频清单存档字段、旧版派生 ID 别名与内部派生记录类型。 */
const STORE_DRAFT_KEY = 'projectVideoStore'
/** 挂在派生视频上的旧版 ID 别名私有键。 */
const LEGACY_OVERRIDE_ID = Symbol('legacyProjectVideoOverrideId')
/** 内部派生视频类型，可携带旧版覆盖 ID。 */
type DerivedProjectVideo = ProjectVideo & { [LEGACY_OVERRIDE_ID]?: string }

/** 从已解析草稿中容错读取视频清单存档。 */
function readStoreFromDraft(draft: any): ProjectVideoStore {
  const raw = toPlainObject(draft?.[STORE_DRAFT_KEY])
  if (!raw) return { records: [], overrides: {} }
  return {
    records: normalizeArray(raw.records),
    overrides: raw.overrides && typeof raw.overrides === 'object' && !Array.isArray(raw.overrides) ? raw.overrides : {},
  }
}

/** 从已加载的项目对象里取该项目的「视频清单」存档(随项目草稿存云端,无 localStorage)。 */
export function readProjectVideoStore(project: any): ProjectVideoStore {
  return readStoreFromDraft(getCreativeProjectDraft(project) || {})
}

/**
 * 读最新项目草稿 → 修改其中的视频清单存档 → 整体写回云端(随项目草稿持久化)。
 * 用乐观锁(draft_revision)+ 409 冲突重试一次,避免覆盖期间别处对草稿的写入。
 * 注意:写回时保留草稿其余内容(分镜/视频版本等),只增改 projectVideoStore 字段。
 */
async function mutateProjectVideoStore(
  projectId: number,
  workspaceId: number,
  mutate: (store: ProjectVideoStore, project: any) => void,
): Promise<void> {
  const id = Number(projectId || 0)
  const wsId = Number(workspaceId || 0)
  if (!id || !wsId) return
  await enqueueCreativeProjectDraftSave({
    projectId: id,
    workspaceId: wsId,
    task: async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const project: any = await getCreativeProject({ projectId: id, workspaceId: wsId })
          const rev = Number(project?.draft_revision ?? project?.data?.draft_revision ?? 0) || 0
          const draft = getCreativeProjectDraft(project) || {}
          const store = readStoreFromDraft(draft)
          mutate(store, project)
          draft[STORE_DRAFT_KEY] = sanitizePersistentProjectVideoStore(store, wsId)
          await updateCreativeProjectDraft({ projectId: id, workspaceId: wsId, draft, draftRevision: rev })
          return
        } catch (error) {
          const conflict = isDraftConflictError(error)
          const retryable = isRetryableDraftSaveError(error)
          if ((!conflict && !retryable) || attempt >= 2) throw error
          if (retryable && !conflict) await waitForDraftSaveRetry(attempt)
        }
      }
    },
  })
}

/** 按候选顺序返回首个非空字符串。 */
function pickString(...values: any[]): string {
  for (const value of values) {
    const text = String(value || '').trim()
    if (text) return text
  }
  return ''
}

/** 按候选顺序返回首个可解析的日期字符串。 */
function pickDateString(...values: any[]): string {
  for (const value of values) {
    const text = String(value || '').trim()
    if (text && !Number.isNaN(Date.parse(text))) return text
  }
  return ''
}

/** 将日期字符串转为毫秒时间戳，无效值归零。 */
function toTimestamp(value: string): number {
  const time = Date.parse(String(value || ''))
  return Number.isFinite(time) ? time : 0
}

/** 将日期格式化为任务中心所需的分钟精度文本。 */
function formatDateTime(value: string): string {
  const time = toTimestamp(value)
  if (!time) return '--'
  const date = new Date(time)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(
    2,
    '0',
  )} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** 将视频秒数格式化为 mm:ss，缺失时显示占位符。 */
export function formatVideoDuration(durationSeconds: number): string {
  const total = Math.max(0, Math.floor(Number(durationSeconds || 0)))
  if (!total) return '--:--'
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

/** 兼容数值、“5s”、“5秒”和 mm:ss 视频时长。 */
function parseDurationSeconds(value: any): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.floor(value)
  const text = String(value || '').trim()
  if (!text) return 0
  if (/^\d+$/.test(text)) return Math.floor(Number(text))
  const secondsMatch = text.match(/^(\d+(?:\.\d+)?)\s*(?:s|秒)$/i)
  if (secondsMatch) return Math.max(0, Math.round(Number(secondsMatch[1])))
  const parts = text.split(':').map((part) => Number(part))
  if (parts.length === 2 && parts.every((part) => Number.isFinite(part))) {
    return Math.max(0, parts[0] * 60 + parts[1])
  }
  return 0
}

/** 识别空名或系统默认的“未命名”项目标题。 */
function isUnnamedProjectTitle(value: string): boolean {
  const title = String(value || '').trim()
  return !title || /^(未命名|未命名创意|未命名项目|新建创意|新建项目)$/i.test(title)
}

/** 优先选取真实项目名，未命名时用需求摘要作为可识别标题。 */
function resolveProjectTitle(project: any, draft: any, smart: any): string {
  const candidates = [project?.title, project?.name, draft?.title, smart?.projectName, smart?.title]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
  const named = candidates.find((value) => !isUnnamedProjectTitle(value))
  if (named) return named

  const description = pickString(draft?.description, smart?.basePrompt, smart?.reqSummary, smart?.requirement).trim()
  if (description) return description.length > 18 ? `${description.slice(0, 18)}…` : description
  return '历史视频'
}

/** 将各生成流程的状态文本归一化；已有可播放成片默认视为已发布。 */
function normalizeStatus(value: any, hasVideoUrl: boolean): ProjectVideoStatus {
  const text = String(value || '')
    .trim()
    .toLowerCase()
  if (
    text.includes('fail') ||
    text.includes('error') ||
    text.includes('reject') ||
    text.includes('cancel') ||
    text.includes('abort')
  ) {
    return 'failed'
  }
  if (text.includes('unpublish') || text.includes('draft')) return 'draft'
  if (text === 'published' || text === 'publish' || text.includes('publish_success')) {
    return 'published'
  }
  if (
    text.includes('processing') ||
    text.includes('pending') ||
    text.includes('running') ||
    text.includes('queue') ||
    text.includes('publishing')
  ) {
    return 'processing'
  }
  // 当前项目没有独立的视频发布接口：已有可播放成片即表示生成完成，可在项目管理中展示为已发布。
  return hasVideoUrl ? 'published' : 'draft'
}

/** 将草稿流程映射为任务中心的 smart/creative 二级来源。 */
function resolveProjectSourceType(draft: any): ProjectVideoSourceType {
  const flow = pickString(draft?.flow, draft?.smart?.flow).toLowerCase()
  return flow && flow !== 'smart' ? 'creative' : 'smart'
}

/** 保留用于“进入编辑”分流的真实流程标识，缺省为 smart。 */
function resolveProjectFlow(draft: any): string {
  return pickString(draft?.flow, draft?.smart?.flow).toLowerCase() || 'smart'
}

/** 按项目封面、入口素材和首分镜的优先级解析封面地址。 */
function resolveProjectCoverUrl(project: any, draft: any): string {
  const fromProject = pickString(
    project?.cover_url,
    project?.coverUrl,
    project?.thumbnail_url,
    project?.thumbnailUrl,
    project?.cover,
  )
  if (fromProject) return fromProject

  const smart = toPlainObject(draft?.smart) || draft
  const entryMeta = toPlainObject(smart?.entryMeta) || {}
  const entryImages = normalizeArray(entryMeta?.images)
  const entryImage = pickString(entryImages[0])
  if (entryImage) return entryImage

  const firstShot = normalizeArray(smart?.shots)[0]
  const shotImage = pickString(
    firstShot?.cover_url,
    firstShot?.thumbnail_url,
    firstShot?.poster,
    firstShot?.image,
    firstShot?.src,
  )
  return shotImage
}

/** 从工作空间成员列表中按 user_id 查找成员显示名(昵称优先) */
function resolveMemberNameByUserId(userId: number, members: any[]): string {
  if (!userId || !members?.length) return ''
  const found = members.find((member: any) => resolveUserId(member) === userId)
  if (!found) return ''
  return pickString(
    found?.nickname,
    found?.name,
    found?.user?.nickname,
    found?.user?.name,
    found?.user?.mobile,
    found?.mobile,
  )
}

/** 为缺少后端 ID 的旧视频生成跨刷新稳定的短哈希。 */
function stableKeyHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

/** 优先使用显式 ID/asset_id，否则以地址、时间和标题派生稳定视频 ID。 */
export function stableDerivedVideoId(item: any, videoAssetId: number, videoUrl: string, createdAt: string): string {
  const explicitId = pickString(item?.id, item?.videoId, item?.video_id, videoAssetId)
  if (explicitId) return explicitId.startsWith('derived-') ? explicitId : `derived-${explicitId}`
  const stableUrl = pickString(videoUrl).split(/[?#]/, 1)[0]
  const seed = [stableUrl, createdAt, pickString(item?.label, item?.title, item?.name)].join('|')
  return `derived-fallback-${stableKeyHash(seed)}`
}

/** 优先取当前视频 ID 的覆盖，并只在不与新 ID 冲突时兼容旧版数组下标别名。 */
function resolveVideoOverrides(
  overrides: Record<string, ProjectVideoOverride>,
  item: DerivedProjectVideo,
  canonicalIds: ReadonlySet<string>,
): ProjectVideoOverride | undefined {
  if (overrides[item.id]) return overrides[item.id]
  // Compatibility with the previous `derived-<rawId>-<arrayIndex>` IDs.
  // Only use the exact alias produced by that historical array position, and
  // never reinterpret an ID that is canonical for another current video.
  const legacyId = item[LEGACY_OVERRIDE_ID]
  return legacyId && !canonicalIds.has(legacyId) ? overrides[legacyId] : undefined
}

/**
 * 从项目草稿的视频版本、生成中状态、内容变更与单条成片字段派生视频列表。
 * 创建者 ID 与名称从项目所有者和工作空间成员中解析，供权限判断使用。
 */
function buildDerivedVideos({
  project,
  workspaceId,
  currentUserName,
  currentUserId,
  workspaceMembers,
}: {
  project: any
  workspaceId: number
  currentUserName?: string
  currentUserId?: number
  workspaceMembers?: any[]
}): ProjectVideo[] {
  const draft = getCreativeProjectDraft(project) || {}
  const smart = toPlainObject(draft?.smart) || draft
  const sourceType = resolveProjectSourceType(draft)
  const flow = resolveProjectFlow(draft)
  const projectTitle = resolveProjectTitle(project, draft, smart)
  const entryMeta = toPlainObject(smart?.entryMeta) || toPlainObject(draft?.entryMeta) || {}
  const videoRatio = pickString(smart?.genRatio, entryMeta?.ratio, draft?.selectedRatio, smart?.ratio)
  const shotDurationSeconds = normalizeArray(smart?.shots).reduce(
    (total, shot) => total + parseDurationSeconds(shot?.duration),
    0,
  )
  const defaultDurationSeconds =
    parseDurationSeconds(smart?.genDurationSec) ||
    parseDurationSeconds(entryMeta?.duration) ||
    parseDurationSeconds(draft?.selectedDuration) ||
    parseDurationSeconds(smart?.duration) ||
    shotDurationSeconds
  const projectCoverUrl = resolveProjectCoverUrl(project, draft)
  const createdAt = pickDateString(project?.created_at, project?.createdAt)
  const updatedAt = pickDateString(project?.updated_at, project?.updatedAt, project?.last_saved_at, createdAt)
  // 创建者用户 ID:来自 project.user_id,用于前端权限判断(比 createdByName 可靠,不受昵称影响)
  const createdByUserId = resolveCreativeProjectOwnerId(project)
  // 归属人:后端优先 creator_nickname;若未返回,仅当查看者=项目归属人时才用 currentUserName 兜底
  const createdByName =
    pickString(
      project?.creator_nickname,
      project?.creatorNickname,
      project?.owner_name,
      project?.ownerName,
      project?.created_by_name,
      project?.createdByName,
      project?.creator_name,
      project?.creatorName,
      project?.user?.nickname,
      project?.user?.name,
      project?.owner?.nickname,
      project?.owner?.name,
      project?.creator?.nickname,
      project?.creator?.name,
    ) ||
    // 后端未返回 creator_nickname 时:先用当前用户(若是归属人本人),再从成员列表查找
    (currentUserId && createdByUserId && currentUserId === createdByUserId
      ? currentUserName || ''
      : resolveMemberNameByUserId(createdByUserId, workspaceMembers || []))

  // 每次「重新生成」的独立记录(仅生成中)→ 项目下置顶展示成「草稿」条目(成功的成片仍走 videoVersions)。
  // 失败记录不再跨页面/刷新持久展示，因此这里也不再把 failed 派生到列表里。
  // 兼容旧数据:没有 generations 但残留 vidGenTaskId>0 → 也兜底显示一条「草稿」。
  // 草稿里存的字段名是 videoGenerations(兼容历史 generations)
  const generationsRaw = normalizeArray(smart?.videoGenerations || smart?.generations).filter((g: any) => {
    const status = pickString(g?.status)
    const isStaleReeditPlaceholder =
      status === 'processing' &&
      !(Number(g?.taskId ?? g?.task_id ?? 0) > 0) &&
      pickString(g?.note).trim() === '重新编辑'
    return status === 'processing' && !isStaleReeditPlaceholder
  })
  const makeGenItem = (g: any, i: number): ProjectVideo => ({
    id: `derived-gen-${pickString(
      g?.id,
      g?.taskId,
      g?.task_id,
      stableKeyHash([pickString(g?.createdAt, g?.created_at), pickString(g?.note), String(i)].join('|')),
    )}`,
    projectId: Number(project?.id || 0),
    workspaceId,
    title: `${projectTitle} · 草稿`,
    coverUrl: projectCoverUrl,
    videoUrl: '',
    ratio: videoRatio,
    durationSeconds: defaultDurationSeconds,
    status: 'draft',
    createdByName,
    createdByUserId,
    createdAt,
    updatedAt,
    sourceType,
    flow,
    publishUrl: '',
  })
  const genItems: ProjectVideo[] = generationsRaw.length
    ? generationsRaw.map(makeGenItem)
    : Number(smart?.vidGenTaskId || 0) > 0
      ? [makeGenItem({ id: `legacy-${project?.id || 0}`, status: 'processing' }, 0)]
      : []
  const generating = genItems.length > 0

  // 「在制/草稿」判定:草稿当前内容签名 ≠ 上一版成片盖章的签名 ⇒ 内容改了但没出新片 → 顶部并排一条草稿。
  // 只对智能成片(有 lastVideoSig 盖章)生效;老数据无签名 → 不误报。有进行中记录(generating)时不重复加。
  const lastVideoSig = pickString(smart?.lastVideoSig)
  const currentVideoSig = lastVideoSig
    ? computeVideoContentSig(
        normalizeArray(smart?.shots),
        smart?.entryMeta || draft?.entryMeta,
        pickString(smart?.reqSummary, smart?.requirement, draft?.description),
      )
    : ''
  const contentDirty = !!lastVideoSig && !!currentVideoSig && !isVideoContentSigMatch(lastVideoSig, currentVideoSig)
  const dirtyItems: ProjectVideo[] =
    !generating && contentDirty ? [makeGenItem({ id: `dirty-${project?.id || 0}` }, 0)] : []

  const candidates = normalizeArray(smart?.videoVersions)
  const historyList =
    candidates.length > 0
      ? candidates
      : normalizeArray(draft?.videoHistoryList).length > 0
        ? normalizeArray(draft?.videoHistoryList)
        : normalizeArray(draft?.video_history_list)

  const records: ProjectVideo[] = historyList
    .map((item: any, index: number) => {
      // 优先用 asset 直传地址(不过期);没有 assetId 才退回草稿里的(可能已过期的)URL
      const videoAssetId = Number(item?.assetId || item?.asset_id || item?.videoAssetId || 0) || 0
      const videoUrl =
        videoAssetId && workspaceId
          ? assetStreamUrl(videoAssetId, workspaceId)
          : pickString(item?.url, item?.src, item?.video_url)
      const coverAssetId =
        Number(item?.cover_asset_id || item?.coverAssetId || item?.thumbnail_asset_id || item?.thumbnailAssetId || 0) ||
        0
      const coverUrl =
        coverAssetId && workspaceId
          ? assetStreamUrl(coverAssetId, workspaceId)
          : pickString(
              item?.cover_url,
              item?.coverUrl,
              item?.thumbnail_url,
              item?.thumbnailUrl,
              item?.poster,
              projectCoverUrl,
            )
      const durationSeconds = parseDurationSeconds(item?.duration_seconds ?? item?.durationSeconds ?? item?.duration)
      const status = normalizeStatus(item?.status, Boolean(videoUrl))
      const itemCreatedAt = pickDateString(item?.created_at, item?.createdAt, createdAt)
      const itemUpdatedAt = pickDateString(item?.updated_at, item?.updatedAt, updatedAt, itemCreatedAt)
      const legacyRawId = pickString(item?.id, item?.assetId, item?.asset_id, item?.videoId)
      const rawLabel = pickString(item?.label, item?.title, item?.name)
      const label = isUnnamedProjectTitle(rawLabel) ? `视频 ${index + 1}` : rawLabel || `视频 ${index + 1}`
      const itemCreatedByUserId = resolveCreativeProjectOwnerId(item) || createdByUserId
      const video: DerivedProjectVideo = {
        id: stableDerivedVideoId(item, videoAssetId, videoUrl, itemCreatedAt),
        // Index-only legacy IDs cannot be mapped safely after the history is
        // reordered. Preserve compatibility only when the old ID included a
        // durable ID from the version itself.
        ...(legacyRawId ? { [LEGACY_OVERRIDE_ID]: `derived-${legacyRawId}-${index + 1}` } : {}),
        projectId: Number(project?.id || 0),
        workspaceId,
        title: label === projectTitle ? label : `${projectTitle} · ${label}`,
        coverUrl,
        videoUrl,
        videoAssetId,
        ratio: pickString(item?.ratio, item?.aspect_ratio, item?.aspectRatio, videoRatio),
        durationSeconds: durationSeconds || defaultDurationSeconds,
        status,
        // 版本级归属人优先（后端 /versions 每个版本带 creator_nickname），没有则用项目级
        createdByName: pickString(item?.creator_nickname, item?.creatorNickname, createdByName),
        createdByUserId: itemCreatedByUserId,
        createdAt: itemCreatedAt || createdAt,
        updatedAt: itemUpdatedAt || updatedAt || itemCreatedAt,
        sourceType,
        flow,
        publishUrl: pickString(item?.publish_url, item?.publishUrl),
      }
      return video
    })
    .filter((item) => item.videoUrl || item.coverUrl)

  // 有已出版本:正在重新生成时,置顶一个「生成中」项(旧版本保留自身发布状态)
  if (records.length)
    return generating ? [...genItems, ...records] : dirtyItems.length ? [...dirtyItems, ...records] : records

  const generatedVideoAssetId =
    Number(draft?.generatedVideoAssetId || draft?.generated_video_asset_id || smart?.fullVideoAssetId || 0) || 0
  const generatedVideoUrl =
    generatedVideoAssetId && workspaceId
      ? assetStreamUrl(generatedVideoAssetId, workspaceId)
      : pickString(draft?.generatedVideoUrl, draft?.generated_video_url, smart?.fullVideoUrl, smart?.videoUrl)
  if (!generatedVideoUrl) {
    // 没有最终视频,但草稿里有在制内容(分镜 / 进行中的生成任务)→ 返回一个「草稿」占位项,
    // 让项目在管理页可见、可点进编辑续作(进入后由 SmartCreateView 续轮询生成中的任务)。
    // 有生成中/失败记录 → 直接用这些记录(每次重新生成是一条草稿)
    if (genItems.length) return genItems
    const hasWork = normalizeArray(smart?.shots).length > 0 || normalizeArray(draft?.storyboardItems).length > 0
    if (!hasWork) return []
    return [
      {
        id: `derived-draft-${project?.id || 0}`,
        projectId: Number(project?.id || 0),
        workspaceId,
        title: `${projectTitle} · 草稿`,
        coverUrl: projectCoverUrl,
        videoUrl: '',
        ratio: videoRatio,
        durationSeconds: defaultDurationSeconds,
        status: 'draft',
        createdByName,
        createdByUserId,
        createdAt,
        updatedAt,
        sourceType,
        flow,
        publishUrl: '',
      },
    ]
  }

  const finalItem: ProjectVideo = {
    id: `derived-generated-${project?.id || 0}`,
    projectId: Number(project?.id || 0),
    workspaceId,
    title: `${projectTitle} · 最终视频`,
    coverUrl: projectCoverUrl,
    videoUrl: generatedVideoUrl,
    videoAssetId: generatedVideoAssetId || undefined,
    ratio: videoRatio,
    durationSeconds: defaultDurationSeconds,
    status: 'published',
    createdByName,
    createdByUserId,
    createdAt,
    updatedAt,
    sourceType,
    flow,
    publishUrl: pickString(draft?.publishUrl, smart?.publishUrl),
  }
  // 有旧成片但正在重新生成 → 置顶「生成中」项;否则若内容已改未出新片(contentDirty)→ 置顶一条「草稿」。
  // (与 records 分支同口径:成片只挂在 fullVideoUrl / generatedVideoUrl、videoVersions 为空时,dirtyItems 也要生效。)
  return generating ? [...genItems, finalItem] : dirtyItems.length ? [...dirtyItems, finalItem] : [finalItem]
}

/**
 * 用项目列表接口已经返回的项目对象同步派生视频，避免任务中心为了历史成片再逐项目请求详情。
 */
export function deriveProjectVideos({ project, workspaceId }: { project: any; workspaceId: number }): ProjectVideo[] {
  const derived = buildDerivedVideos({ project, workspaceId })
  const canonicalIds = new Set(derived.map((item) => item.id))
  const store = readProjectVideoStore(project)
  return sortByUpdatedAt([
    ...derived
      .map((item) => applyOverrides(item, resolveVideoOverrides(store.overrides, item, canonicalIds)))
      .filter(Boolean)
      .map((item) => item as ProjectVideo),
    ...store.records.filter((item) => !store.overrides[item.id]?.hidden),
  ])
}

/** 不可变地应用视频覆盖，hidden 项返回 null 从列表移除。 */
function applyOverrides(item: ProjectVideo, overrides: ProjectVideoOverride | undefined): ProjectVideo | null {
  if (!overrides) return item
  if (overrides.hidden) return null
  return {
    ...item,
    title: pickString(overrides.title, item.title),
    status: overrides.status || item.status,
    updatedAt: pickString(overrides.updatedAt, item.updatedAt),
  }
}

/** 按最后更新时间倒序排列，缺失时回退到创建时间。 */
function sortByUpdatedAt(list: ProjectVideo[]): ProjectVideo[] {
  return [...list].sort((a, b) => {
    const at = toTimestamp(a.updatedAt) || toTimestamp(a.createdAt)
    const bt = toTimestamp(b.updatedAt) || toTimestamp(b.createdAt)
    return bt - at
  })
}

/** 读取项目详情，合并草稿派生视频、状态覆盖和人工归类记录。 */
export async function listProjectVideos({
  projectId,
  workspaceId,
  currentUserName,
  currentUserId,
  workspaceMembers,
}: {
  projectId: number
  workspaceId: number
  currentUserName?: string
  currentUserId?: number
  workspaceMembers?: any[]
}): Promise<{ project: any; videos: ProjectVideo[] }> {
  const project = await getCreativeProject({ projectId, workspaceId })
  const derived = buildDerivedVideos({ project, workspaceId, currentUserName, currentUserId, workspaceMembers })
  const canonicalIds = new Set(derived.map((item) => item.id))
  const store = readProjectVideoStore(project)
  const merged = [
    ...derived
      .map((item) => applyOverrides(item, resolveVideoOverrides(store.overrides, item, canonicalIds)))
      .filter(Boolean)
      .map((item) => item as ProjectVideo),
    ...store.records.filter((item) => !store.overrides[item.id]?.hidden),
  ]
  return {
    project,
    videos: sortByUpdatedAt(merged),
  }
}

/**
 * 用已加载的项目对象(列表项即可)同步计算该项目「视频条数」——与 listProjectVideos 的 merged 口径一致:
 * 派生视频(成片版本/单条成片/草稿占位)+ 本地归类清单,扣除隐藏项。
 * 用于项目卡上的数量,避免用分镜数(shots.length)当条数导致「卡片显示 3、点开只有 1」。
 */
export function countProjectVideos({ project, workspaceId }: { project: any; workspaceId: number }): number {
  return deriveProjectVideos({ project, workspaceId }).length
}

/** 按 videoId 精确读取项目视频；错误或过期 ID 返回 null，绝不回退到第一条。 */
export async function getProjectVideo({
  projectId,
  workspaceId,
  videoId,
  currentUserName,
  currentUserId,
  workspaceMembers,
}: {
  projectId: number
  workspaceId: number
  videoId: string
  currentUserName?: string
  currentUserId?: number
  workspaceMembers?: any[]
}): Promise<{ project: any; video: ProjectVideo | null }> {
  const payload = await listProjectVideos({ projectId, workspaceId, currentUserName, currentUserId, workspaceMembers })
  const requestedVideoId = String(videoId || '').trim()
  return {
    project: payload.project,
    // 详情路由必须精确匹配。错误、过期或已删除的 ID 返回 null，绝不回退到其他视频，
    // 避免用户在错误详情页继续执行下载、发布或删除操作。
    video: requestedVideoId ? payload.videos.find((item) => String(item.id) === requestedVideoId) || null : null,
  }
}

/**
 * 把「待归类」里的一条视频归类(写入)到目标项目的视频清单 —— 随项目草稿存云端(不再用 localStorage)。
 * sourceKey:来源视频的稳定 key(videoKeyOf),写入后「待分类」据此把该视频隐藏。
 */
export async function addClassifiedVideo({
  projectId,
  workspaceId,
  title,
  videoUrl,
  videoAssetId,
  coverUrl,
  createdByName,
  createdByUserId,
  sourceKey,
}: {
  projectId: number
  workspaceId: number
  title?: string
  videoUrl?: string
  videoAssetId?: number
  coverUrl?: string
  createdByName?: string
  createdByUserId?: number
  sourceKey?: string
}): Promise<void> {
  const now = new Date().toISOString()
  const durableVideoAssetId = Number(videoAssetId || 0) || 0
  const url = durableVideoAssetId ? assetStreamUrl(durableVideoAssetId, workspaceId) : pickString(videoUrl)
  const record: LocalProjectVideoRecord = {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    projectId,
    workspaceId,
    title: pickString(title, '归类视频'),
    coverUrl: pickString(coverUrl),
    videoUrl: url,
    ...(durableVideoAssetId ? { videoAssetId: durableVideoAssetId } : {}),
    durationSeconds: 0,
    // 「待归类 → 拖入项目」语义是把已存在的视频归档进项目，而不是新建一个待继续编辑的草稿。
    status: 'published',
    createdByName: pickString(createdByName, '当前用户'),
    createdByUserId: Number(createdByUserId ?? 0) || 0,
    createdAt: now,
    updatedAt: now,
    sourceType: 'smart',
    flow: 'smart',
    manual: true,
    sourceKey: pickString(sourceKey),
  }
  await mutateProjectVideoStore(projectId, workspaceId, (store) => {
    // 同一视频已在该项目清单里则不重复添加(优先按来源 key,其次按 url)
    const key = record.sourceKey
    if (key && store.records.some((item) => item.sourceKey === key)) return
    if (url && store.records.some((item) => item.videoUrl === url)) return
    store.records.unshift(record)
  })
}

/** 将手动记录或派生视频标记为已发布，不存在的 ID 显式报错。 */
export async function publishProjectVideo({
  projectId,
  workspaceId,
  videoId,
}: {
  projectId: number
  workspaceId: number
  videoId: string
}): Promise<void> {
  const now = new Date().toISOString()
  await mutateProjectVideoStore(projectId, workspaceId, (store, project) => {
    const index = store.records.findIndex((item) => item.id === videoId)
    if (index >= 0) {
      store.records[index] = {
        ...store.records[index],
        status: 'published',
        updatedAt: now,
      }
    } else if (buildDerivedVideos({ project, workspaceId }).some((item) => item.id === videoId)) {
      store.overrides[videoId] = {
        ...(store.overrides[videoId] || {}),
        status: 'published',
        updatedAt: now,
      }
    } else {
      throw createInvalidProjectVideoIdError()
    }
  })
}

/** 创建统一的无效项目视频 ID 错误，防止误操作其他视频。 */
function createInvalidProjectVideoIdError(): Error & { status: number; code: string } {
  return Object.assign(new Error('视频不存在或标识已失效'), {
    status: 400,
    code: 'PROJECT_VIDEO_NOT_FOUND',
  })
}

/**
 * 删除手动归类记录，或对草稿派生视频写入 hidden 覆盖。
 * 只接受精确存在的 videoId；写入响应丢失后的同一手动记录重试视为成功。
 */
export async function deleteProjectVideo({
  projectId,
  workspaceId,
  videoId,
}: {
  projectId: number
  workspaceId: number
  videoId: string
}): Promise<void> {
  let validatedManualRecord = false
  await mutateProjectVideoStore(projectId, workspaceId, (store, project) => {
    const index = store.records.findIndex((item) => item.id === videoId)
    if (index >= 0) {
      validatedManualRecord = true
      store.records.splice(index, 1)
    } else if (validatedManualRecord) {
      // The previous PUT may have committed even if its response was lost.
      // A retry that observes the already-removed manual record is success.
      return
    } else if (buildDerivedVideos({ project, workspaceId }).some((item) => item.id === videoId)) {
      store.overrides[videoId] = {
        ...(store.overrides[videoId] || {}),
        hidden: true,
        updatedAt: new Date().toISOString(),
      }
    } else {
      throw createInvalidProjectVideoIdError()
    }
  })
}

/** 将归一化状态转为中文界面文案。 */
export function getVideoStatusText(status: ProjectVideoStatus): string {
  if (status === 'published') return '已发布'
  if (status === 'processing') return '生成中'
  if (status === 'failed') return '生成失败'
  return '草稿'
}

/** 将视频日期格式化为任务中心的日期时间文本。 */
export function formatVideoDate(value: string): string {
  return formatDateTime(value)
}
