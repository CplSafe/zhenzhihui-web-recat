import { getCreativeProject } from '@/api/business'

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
  createdAt: string
  updatedAt: string
  sourceType: ProjectVideoSourceType
  /** 真实创作流程标识(draft.flow):'smart' | 'hot-copy' | 'creative' …,用于「进入编辑」路由分流 */
  flow: string
  publishUrl?: string
  localOnly?: boolean
}

const LOCAL_KEY_PREFIX = 'zzh_project_video_module'

interface LocalProjectVideoRecord extends ProjectVideo {
  localOnly: true
}

interface ProjectVideoOverride {
  hidden?: boolean
  status?: ProjectVideoStatus
  title?: string
  updatedAt?: string
}

interface ProjectVideoStore {
  records: LocalProjectVideoRecord[]
  overrides: Record<string, ProjectVideoOverride>
}

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

function resolveStorageKey(workspaceId: number, projectId: number): string {
  return `${LOCAL_KEY_PREFIX}:${workspaceId}:${projectId}`
}

function loadStore(workspaceId: number, projectId: number): ProjectVideoStore {
  if (typeof window === 'undefined') return { records: [], overrides: {} }
  try {
    const raw = window.localStorage.getItem(resolveStorageKey(workspaceId, projectId))
    if (!raw) return { records: [], overrides: {} }
    const parsed = JSON.parse(raw)
    return {
      records: normalizeArray(parsed?.records),
      overrides:
        parsed?.overrides && typeof parsed.overrides === 'object' && !Array.isArray(parsed.overrides)
          ? parsed.overrides
          : {},
    }
  } catch {
    return { records: [], overrides: {} }
  }
}

function saveStore(workspaceId: number, projectId: number, store: ProjectVideoStore) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(resolveStorageKey(workspaceId, projectId), JSON.stringify(store))
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

function buildDerivedVideos({
  project,
  workspaceId,
  currentUserName,
}: {
  project: any
  workspaceId: number
  currentUserName?: string
}): ProjectVideo[] {
  const draft = normalizeCreativeProjectDraft(project) || {}
  const smart = toPlainObject(draft?.smart) || draft
  const sourceType = resolveProjectSourceType(draft)
  const flow = resolveProjectFlow(draft)
  const projectTitle = pickString(project?.title, project?.name, '未命名项目')
  const projectCoverUrl = resolveProjectCoverUrl(project, draft)
  const createdAt = pickDateString(project?.created_at, project?.createdAt)
  const updatedAt = pickDateString(project?.updated_at, project?.updatedAt, project?.last_saved_at, createdAt)
  const createdByName = pickString(
    project?.owner_name,
    project?.ownerName,
    project?.created_by_name,
    currentUserName,
    '当前用户',
  )

  // 每次「重新生成」的独立记录(生成中/失败)→ 项目下置顶展示成草稿条目(成功的成片仍走 videoVersions)。
  // 兼容旧数据:没有 generations 但残留 vidGenTaskId>0 → 也兜底显示一条「生成中」。
  const generationsRaw = normalizeArray(smart?.generations).filter(
    (g: any) => g?.status === 'processing' || g?.status === 'failed',
  )
  const makeGenItem = (g: any, i: number): ProjectVideo => ({
    id: `derived-gen-${pickString(g?.id, String(i))}`,
    projectId: Number(project?.id || 0),
    workspaceId,
    title: `${projectTitle} · ${g?.status === 'failed' ? '生成失败' : '生成中'}`,
    coverUrl: projectCoverUrl,
    videoUrl: '',
    durationSeconds: parseDurationSeconds(draft?.selectedDuration || smart?.duration),
    status: g?.status === 'failed' ? 'failed' : 'processing',
    createdByName,
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
      return {
        id: `derived-${rawId}-${index + 1}`,
        projectId: Number(project?.id || 0),
        workspaceId,
        title: label === projectTitle ? label : `${projectTitle} · ${label}`,
        coverUrl,
        videoUrl,
        durationSeconds,
        status,
        createdByName,
        createdAt: itemCreatedAt || createdAt,
        updatedAt: itemUpdatedAt || updatedAt || itemCreatedAt,
        sourceType,
        flow,
        publishUrl: pickString(item?.publish_url, item?.publishUrl),
      }
    })
    .filter((item) => item.videoUrl || item.coverUrl)

  // 有已出版本:正在重新生成时,置顶一个「生成中」项(旧版本仍为已发布)
  if (records.length) return generating ? [...genItems, ...records] : records

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
    const hasWork =
      normalizeArray(smart?.shots).length > 0 || normalizeArray(draft?.storyboardItems).length > 0
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
    createdAt,
    updatedAt,
    sourceType,
    flow,
    publishUrl: pickString(draft?.publishUrl, smart?.publishUrl),
  }
  // 有旧成片但正在重新生成 → 置顶「生成中」项,旧片仍为已发布
  return generating ? [...genItems, finalItem] : [finalItem]
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
}: {
  projectId: number
  workspaceId: number
  currentUserName?: string
}): Promise<{ project: any; videos: ProjectVideo[] }> {
  const project = await getCreativeProject({ projectId, workspaceId })
  const derived = buildDerivedVideos({ project, workspaceId, currentUserName })
  const store = loadStore(workspaceId, projectId)
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
  const projectId = Number(project?.id || 0)
  const derived = buildDerivedVideos({ project, workspaceId })
  const store = loadStore(workspaceId, projectId)
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
}: {
  projectId: number
  workspaceId: number
  videoId: string
  currentUserName?: string
}): Promise<{ project: any; video: ProjectVideo | null }> {
  const payload = await listProjectVideos({ projectId, workspaceId, currentUserName })
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
}: {
  projectId: number
  workspaceId: number
  title?: string
  currentUserName?: string
}): Promise<ProjectVideo> {
  const now = new Date().toISOString()
  const store = loadStore(workspaceId, projectId)
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
    createdAt: now,
    updatedAt: now,
    sourceType: 'smart',
    flow: 'smart',
    localOnly: true,
  }
  store.records.unshift(record)
  saveStore(workspaceId, projectId, store)
  return record
}

/**
 * 把「待归类」里的一条视频归类(写入)到目标项目的本地视频清单(localStorage 占位)。
 * 后端暂无「归类」接口,先本地落库,使该视频出现在目标项目的视频列表里。
 */
export function addClassifiedVideo({
  projectId,
  workspaceId,
  title,
  videoUrl,
  coverUrl,
  createdByName,
}: {
  projectId: number
  workspaceId: number
  title?: string
  videoUrl?: string
  coverUrl?: string
  createdByName?: string
}): void {
  const now = new Date().toISOString()
  const store = loadStore(workspaceId, projectId)
  const url = pickString(videoUrl)
  // 同一视频已在该项目本地清单里则不重复添加
  if (url && store.records.some((item) => item.videoUrl === url)) return
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
    createdAt: now,
    updatedAt: now,
    sourceType: 'smart',
    flow: 'smart',
    localOnly: true,
  }
  store.records.unshift(record)
  saveStore(workspaceId, projectId, store)
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
  const store = loadStore(workspaceId, projectId)
  const index = store.records.findIndex((item) => item.id === videoId)
  const now = new Date().toISOString()
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
  saveStore(workspaceId, projectId, store)
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
  const store = loadStore(workspaceId, projectId)
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
  saveStore(workspaceId, projectId, store)
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
