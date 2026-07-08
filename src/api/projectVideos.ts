import { getCreativeProject, updateCreativeProjectDraft } from '@/api/business'
import { computeVideoContentSig } from '@/utils/smartDraft'

export type ProjectVideoStatus = 'draft' | 'processing' | 'published' | 'failed'
export type ProjectVideoSourceType = 'smart' | 'creative'

export interface ProjectVideo {
  id: string
  projectId: number
  workspaceId: number
  title: string
  coverUrl: string
  videoUrl: string
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

interface LocalProjectVideoRecord extends ProjectVideo {
  manual: true
}

interface ProjectVideoOverride {
  hidden?: boolean
  status?: ProjectVideoStatus
  title?: string
  updatedAt?: string
}

export interface ProjectVideoStore {
  records: LocalProjectVideoRecord[]
  overrides: Record<string, ProjectVideoOverride>
}

// 视频清单存档随项目草稿(draft_json)持久化到云端的字段名。
const STORE_DRAFT_KEY = 'projectVideoStore'

function toPlainObject(value: any): any {
  if (!value) return null
  if (typeof value === 'object') return value
  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch {
      return null
    }
  }
  return null
}

function normalizeArray(value: any): any[] {
  return Array.isArray(value) ? value : []
}

function normalizeCreativeProjectDraft(payload: any): any {
  const candidates = [
    payload?.draft_json,
    payload?.draftJson,
    payload?.draft,
    payload?.data?.draft_json,
    payload?.data?.draft,
  ]
  for (const item of candidates) {
    const parsed = toPlainObject(item)
    if (parsed) return parsed
  }
  return null
}

// 鉴权直传地址:cookie 鉴权、非预签名,永不过期。用它替换草稿里会过期(X-Amz-Expires=900)的 S3 视频 URL。
function assetStreamUrl(assetId: number, workspaceId: number): string {
  return `/api/v1/assets/${Math.floor(assetId)}/download?workspace_id=${Math.floor(workspaceId)}`
}

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
  return readStoreFromDraft(normalizeCreativeProjectDraft(project) || {})
}

/**
 * 读最新项目草稿 → 修改其中的视频清单存档 → 整体写回云端(随项目草稿持久化)。
 * 用乐观锁(draft_revision)+ 409 冲突重试一次,避免覆盖期间别处对草稿的写入。
 * 注意:写回时保留草稿其余内容(分镜/视频版本等),只增改 projectVideoStore 字段。
 */
async function mutateProjectVideoStore(
  projectId: number,
  workspaceId: number,
  mutate: (store: ProjectVideoStore) => void,
): Promise<void> {
  const id = Number(projectId || 0)
  const wsId = Number(workspaceId || 0)
  if (!id || !wsId) return
  const doSave = async () => {
    const project: any = await getCreativeProject({ projectId: id, workspaceId: wsId })
    const rev = Number(project?.draft_revision ?? project?.data?.draft_revision ?? 0) || 0
    const draft = normalizeCreativeProjectDraft(project) || {}
    const store = readStoreFromDraft(draft)
    mutate(store)
    draft[STORE_DRAFT_KEY] = store
    await updateCreativeProjectDraft({ projectId: id, workspaceId: wsId, draft, draftRevision: rev })
  }
  try {
    await doSave()
  } catch (e: any) {
    if (e?.status === 409) {
      await doSave()
    } else {
      throw e
    }
  }
}

function pickString(...values: any[]): string {
  for (const value of values) {
    const text = String(value || '').trim()
    if (text) return text
  }
  return ''
}

function pickDateString(...values: any[]): string {
  for (const value of values) {
    const text = String(value || '').trim()
    if (text && !Number.isNaN(Date.parse(text))) return text
  }
  return ''
}

function toTimestamp(value: string): number {
  const time = Date.parse(String(value || ''))
  return Number.isFinite(time) ? time : 0
}

function formatDateTime(value: string): string {
  const time = toTimestamp(value)
  if (!time) return '--'
  const date = new Date(time)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(
    2,
    '0',
  )} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function formatVideoDuration(durationSeconds: number): string {
  const total = Math.max(0, Math.floor(Number(durationSeconds || 0)))
  if (!total) return '--:--'
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function parseDurationSeconds(value: any): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.floor(value)
  const text = String(value || '').trim()
  if (!text) return 0
  if (/^\d+$/.test(text)) return Math.floor(Number(text))
  const parts = text.split(':').map((part) => Number(part))
  if (parts.length === 2 && parts.every((part) => Number.isFinite(part))) {
    return Math.max(0, parts[0] * 60 + parts[1])
  }
  return 0
}

function normalizeStatus(value: any, hasVideoUrl: boolean): ProjectVideoStatus {
  const text = String(value || '')
    .trim()
    .toLowerCase()
  if (text.includes('publish')) return 'published'
  if (text.includes('processing') || text.includes('pending') || text.includes('running') || text.includes('queue')) {
    return 'processing'
  }
  return hasVideoUrl ? 'published' : 'draft'
}

function resolveProjectSourceType(draft: any): ProjectVideoSourceType {
  const flow = pickString(draft?.flow, draft?.smart?.flow).toLowerCase()
  return flow && flow !== 'smart' ? 'creative' : 'smart'
}

// 真实流程标识(原样返回,小写):smart / hot-copy / creative …,缺省按 smart
function resolveProjectFlow(draft: any): string {
  return pickString(draft?.flow, draft?.smart?.flow).toLowerCase() || 'smart'
}

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
  const found = members.find((m: any) => Number(m?.user_id ?? m?.userId ?? m?.id ?? 0) === userId)
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
  const draft = normalizeCreativeProjectDraft(project) || {}
  const smart = toPlainObject(draft?.smart) || draft
  const sourceType = resolveProjectSourceType(draft)
  const flow = resolveProjectFlow(draft)
  const projectTitle = pickString(project?.title, project?.name, '未命名项目')
  const projectCoverUrl = resolveProjectCoverUrl(project, draft)
  const createdAt = pickDateString(project?.created_at, project?.createdAt)
  const updatedAt = pickDateString(project?.updated_at, project?.updatedAt, project?.last_saved_at, createdAt)
  // 创建者用户 ID:来自 project.user_id,用于前端权限判断(比 createdByName 可靠,不受昵称影响)
  const createdByUserId =
    Number(project?.user_id ?? project?.userId ?? project?.owner_user_id ?? project?.ownerUserId ?? 0) || 0
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
    id: `derived-gen-${pickString(g?.id, String(i))}`,
    projectId: Number(project?.id || 0),
    workspaceId,
    title: `${projectTitle} · 草稿`,
    coverUrl: projectCoverUrl,
    videoUrl: '',
    durationSeconds: parseDurationSeconds(draft?.selectedDuration || smart?.duration),
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
  const contentDirty = !!lastVideoSig && !!currentVideoSig && currentVideoSig !== lastVideoSig
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
      const rawId = pickString(item?.id, item?.assetId, item?.asset_id, item?.videoId, index + 1)
      const label = pickString(item?.label, item?.title, item?.name, `视频 ${index + 1}`)
      const itemCreatedByUserId =
        Number(item?.creator_user_id ?? item?.creatorUserId ?? item?.user_id ?? item?.userId ?? 0) || createdByUserId
      return {
        id: `derived-${rawId}-${index + 1}`,
        projectId: Number(project?.id || 0),
        workspaceId,
        title: label === projectTitle ? label : `${projectTitle} · ${label}`,
        coverUrl,
        videoUrl,
        durationSeconds,
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
    })
    .filter((item) => item.videoUrl || item.coverUrl)

  // 有已出版本:正在重新生成时,置顶一个「生成中」项(旧版本仍为已发布)
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
        durationSeconds: parseDurationSeconds(draft?.selectedDuration || smart?.duration),
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
    durationSeconds: parseDurationSeconds(draft?.selectedDuration || smart?.duration),
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

function sortByUpdatedAt(list: ProjectVideo[]): ProjectVideo[] {
  return [...list].sort((a, b) => {
    const at = toTimestamp(a.updatedAt) || toTimestamp(a.createdAt)
    const bt = toTimestamp(b.updatedAt) || toTimestamp(b.createdAt)
    return bt - at
  })
}

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
  const store = readProjectVideoStore(project)
  const merged = [
    ...derived
      .map((item) => applyOverrides(item, store.overrides[item.id]))
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
  const derived = buildDerivedVideos({ project, workspaceId })
  const store = readProjectVideoStore(project)
  const merged = [
    ...derived.filter((item) => !store.overrides[item.id]?.hidden),
    ...store.records.filter((item) => !store.overrides[item.id]?.hidden),
  ]
  return merged.length
}

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
  return {
    project: payload.project,
    // 精确匹配 videoId;匹配不到时回退到该项目第一条视频(供「待归类」用哨兵 id 直接打开主视频)
    video: payload.videos.find((item) => item.id === String(videoId)) || payload.videos[0] || null,
  }
}

export async function createProjectVideo({
  projectId,
  workspaceId,
  title,
  currentUserName,
  currentUserId,
}: {
  projectId: number
  workspaceId: number
  title?: string
  currentUserName?: string
  currentUserId?: number
}): Promise<ProjectVideo> {
  const now = new Date().toISOString()
  const record: LocalProjectVideoRecord = {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    projectId,
    workspaceId,
    title: pickString(title, '新建视频'),
    coverUrl: '',
    videoUrl: '',
    durationSeconds: 0,
    status: 'draft',
    createdByName: pickString(currentUserName, '当前用户'),
    createdByUserId: Number(currentUserId ?? 0) || 0,
    createdAt: now,
    updatedAt: now,
    sourceType: 'smart',
    flow: 'smart',
    manual: true,
  }
  await mutateProjectVideoStore(projectId, workspaceId, (store) => {
    store.records.unshift(record)
  })
  return record
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
  coverUrl,
  createdByName,
  sourceKey,
}: {
  projectId: number
  workspaceId: number
  title?: string
  videoUrl?: string
  coverUrl?: string
  createdByName?: string
  sourceKey?: string
}): Promise<void> {
  const now = new Date().toISOString()
  const url = pickString(videoUrl)
  const record: LocalProjectVideoRecord = {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    projectId,
    workspaceId,
    title: pickString(title, '归类视频'),
    coverUrl: pickString(coverUrl),
    videoUrl: url,
    durationSeconds: 0,
    status: 'draft',
    createdByName: pickString(createdByName, '当前用户'),
    createdByUserId: 0,
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
  await mutateProjectVideoStore(projectId, workspaceId, (store) => {
    const index = store.records.findIndex((item) => item.id === videoId)
    if (index >= 0) {
      store.records[index] = {
        ...store.records[index],
        status: 'published',
        updatedAt: now,
      }
    } else {
      store.overrides[videoId] = {
        ...(store.overrides[videoId] || {}),
        status: 'published',
        updatedAt: now,
      }
    }
  })
}

export async function deleteProjectVideo({
  projectId,
  workspaceId,
  videoId,
}: {
  projectId: number
  workspaceId: number
  videoId: string
}): Promise<void> {
  await mutateProjectVideoStore(projectId, workspaceId, (store) => {
    const index = store.records.findIndex((item) => item.id === videoId)
    if (index >= 0) {
      store.records.splice(index, 1)
    } else {
      store.overrides[videoId] = {
        ...(store.overrides[videoId] || {}),
        hidden: true,
        updatedAt: new Date().toISOString(),
      }
    }
  })
}

export function getVideoStatusText(status: ProjectVideoStatus): string {
  if (status === 'published') return '已发布'
  if (status === 'processing') return '生成中'
  if (status === 'failed') return '生成失败'
  return '草稿'
}

export function formatVideoDate(value: string): string {
  return formatDateTime(value)
}
