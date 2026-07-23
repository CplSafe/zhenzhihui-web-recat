/**
 * 项目管理页
 *
 * 页面效果：展示当前工作空间中用户有权访问的项目，支持搜索、类型筛选、时间排序、分页、新建项目，
 * 并把旧版生成但尚未归档的视频放入「待归类」区域，用户可将其拖入目标项目。点击项目卡片进入视频列表。
 *
 * 权限边界：未被限制的空间成员可以进入项目并查看、下载视频；只有项目创建者或空间 owner/admin
 * 可以管理成员权限和删除项目。所有异步结果都与 workspaceId/用户/请求序号绑定，避免切换空间后串数据。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Pagination } from 'antd'
import '@/styles/creative.css'
import '@/styles/project-management.css'
import AppSidebar from '@/components/home/AppSidebar'
import AppTopbar from '@/components/layout/AppTopbar'
import {
  deleteCreativeProject,
  getAssetDownloadUrl,
  getBusinessErrorMessage,
  getCreativeProject,
  updateCreativeProjectDraft,
} from '@/api/business'
import { createInitializedProjectFolder } from '@/utils/creativeProjectInitialization'
import { addClassifiedVideo, countProjectVideos } from '@/api/projectVideos'
import { listAllAssets, listAllCreativeProjects } from '@/utils/businessPagination'
import { collectClassifiedKeys, videoKeyOf } from '@/utils/unclassifiedVideos'
import { assetStreamUrl } from '@/utils/assetUrl'
import { enqueueCreativeProjectDraftSave } from '@/utils/creativeDraftSaveQueue'
import {
  canRestrictWorkspaceMember,
  getCreativeProjectDraft,
  getRestrictedMemberIds,
  normalizeArray,
  resolveCreativeProjectOwnerId,
  resolveUserId,
  resolveWorkspaceRole,
  toPlainObject,
} from '@/utils/creativeDraftMetadata'
import {
  filterProjectsByAccess,
  getAccessibleProjectIds,
  isAssetAccessibleByProject,
  resolveCreativeProjectId,
} from '@/utils/projectAssetAccess'
import {
  isDraftConflictError,
  isRetryableDraftSaveError,
  waitForDraftSaveRetry,
} from '@/utils/creativeDraftPersistence'
import { useConfirmDialog, useToast } from '@/composables/useToast'
import { openComingSoon } from '@/stores/ui'
import { useWorkspaceId, useCurrentUser, useCurrentWorkspace } from '@/stores/workspaceSession'
import { listWorkspaceMembers } from '@/api/auth'
import UserAvatar from '@/components/common/UserAvatar'
import { bindAssetUrlToWorkspace } from '@/utils/workspaceScopedUrl'
import { observeElementResize } from '@/utils/observeElementResize'

/** 侧边栏导航键与页面路径映射。 */
const ROUTE_MAP: Record<string, string> = {
  home: '/home',
  creative: '/smart',
  'hot-copy': '/hot-copy',
  projects: '/projects',
  resources: '/resources',
  templates: '/templates',
}
/** 成员权限尚未加载时复用的稳定空数组。 */
const EMPTY_WORKSPACE_MEMBERS: any[] = []
/** 项目请求尚未完成时复用的稳定空数组。 */
const EMPTY_PROJECT_ITEMS: any[] = []
/** 无待归类视频时复用的稳定空数组。 */
const EMPTY_LOOSE_VIDEOS: { assetId: number; title: string }[] = []

// ---- 纯函数工具 ----
function imgOf(value: any): { url: string; assetId: number } {
  if (typeof value === 'string') return { url: value.trim(), assetId: 0 }
  if (!value || typeof value !== 'object') return { url: '', assetId: 0 }
  const url = String(
    value.src ||
      value.url ||
      value.image ||
      value.imageUrl ||
      value.image_url ||
      value.thumbnailUrl ||
      value.thumbnail_url ||
      '',
  ).trim()
  return { url, assetId: Number(value.assetId || value.asset_id || 0) || 0 }
}

/** 从多个兼容时间字段中读取可排序的项目时间戳。 */
function getProjectTimestamp(project: any, keys: string[]): number {
  const raw = keys.map((key) => project?.[key]).find((value) => typeof value === 'string' && value.trim())
  const timestamp = Date.parse(raw || '')
  return Number.isFinite(timestamp) ? timestamp : 0
}

/** 返回项目卡片当前统一使用的视觉色调键。 */
const toneOf = (_i: number) => 'a' as const

/** 爆款复制项目优先使用用户原始商品图作为项目封面。 */
function extractHotCopyOriginalCoverAssetId(draft: any): number {
  if (!draft) return 0
  const smart = toPlainObject(draft.smart) || draft
  const flow = String(draft?.flow || smart?.flow || '')
    .trim()
    .toLowerCase()
  if (flow !== 'hot-copy' && flow !== 'hotcopy') return 0

  const entry = toPlainObject(smart?.entryInitial)
  const fromEntry = normalizeArray(entry?.products)
    .filter((product) => !product?.isVideo)
    .map((product) => Number(product?.assetId || 0) || 0)
    .find((assetId) => assetId > 0)
  if (fromEntry) return fromEntry

  return (
    normalizeArray(smart?.originalProductAssetIds)
      .map((assetId) => Number(assetId) || 0)
      .find((assetId) => assetId > 0) || 0
  )
}

/** 读取图片项目的入口模式与对话消息，兼容顶层和 smart 嵌套草稿。 */
function getImageProjectState(project: any): { imageProject: boolean; messages: any[] } {
  const draft = getCreativeProjectDraft(project)
  const smart = toPlainObject(draft?.smart) || draft || {}
  const messages = normalizeArray(smart?.imageMessages ?? draft?.imageMessages)
  const mode = String(smart?.entryMeta?.mode || draft?.entryMeta?.mode || smart?.mode || draft?.mode || '')
    .trim()
    .toLowerCase()
  return { imageProject: mode === 'image' || messages.length > 0, messages }
}

/** 收集图片对话中已成功生成并可恢复的图片，排除处理中和失败消息。 */
function collectGeneratedProjectImages(project: any): Array<{ url: string; assetId: number }> {
  const { messages } = getImageProjectState(project)
  const seen = new Set<string>()
  const images: Array<{ url: string; assetId: number }> = []
  messages.forEach((message) => {
    if (String(message?.role || '').toLowerCase() !== 'assistant') return
    const status = String(message?.status || '').toLowerCase()
    if (status === 'pending' || status === 'error' || status === 'failed' || status === 'cancelled') return
    normalizeArray(message?.images).forEach((value) => {
      const image = imgOf(value)
      if (!image.url && !image.assetId) return
      const key = image.assetId ? `asset:${image.assetId}` : `url:${image.url.split('?')[0]}`
      if (seen.has(key)) return
      seen.add(key)
      images.push(image)
    })
  })
  return images
}

// 项目封面:图片项目最新成功出图 → 爆款复制原始素材 → 封面字段 → 入口素材 → 分镜图。
// 生成用的人脸脱敏图只存在 submitAssetId/productAssetIds，不能作为项目展示封面。
function extractCover(project: any, wsId: number): string {
  const draft = getCreativeProjectDraft(project)
  const generatedImages = collectGeneratedProjectImages(project)
  const latestGeneratedImage = generatedImages[generatedImages.length - 1]
  if (latestGeneratedImage?.assetId && wsId) return assetStreamUrl(latestGeneratedImage.assetId, wsId)
  if (latestGeneratedImage?.url) return latestGeneratedImage.url
  const hotCopyOriginalAid = extractHotCopyOriginalCoverAssetId(draft)
  if (hotCopyOriginalAid && wsId) return assetStreamUrl(hotCopyOriginalAid, wsId)

  const coverAid = Number(project?.cover_asset_id || project?.coverAssetId || 0) || 0
  if (coverAid && wsId) return assetStreamUrl(coverAid, wsId)
  if (draft) {
    const smart = toPlainObject(draft.smart) || draft
    // 入口素材:优先用平行的 imageAssetIds → 直传地址(草稿里的 images 可能是已过期 S3 预签名或 blob:,会破图)
    const entryImgs = normalizeArray(smart?.entryMeta?.images)
    const entryIds = normalizeArray(smart?.entryMeta?.imageAssetIds)
    for (let i = 0; i < entryImgs.length; i++) {
      const aid = Number(entryIds[i] || 0) || 0
      if (aid && wsId) return assetStreamUrl(aid, wsId)
      const s = String(entryImgs[i] || '').trim()
      if (s) return s
    }
    for (const sh of normalizeArray(smart?.shots)) {
      const im = imgOf(sh.image ? { url: sh.image, assetId: sh.imageAssetId } : sh)
      if (im.assetId && wsId) return assetStreamUrl(im.assetId, wsId)
      if (im.url) return im.url
    }
  }
  for (const v of [project?.cover_url, project?.coverUrl, project?.thumbnail_url, project?.thumbnailUrl]) {
    const u = String(v || '').trim()
    if (u) return u
  }
  return ''
}

// 没图时的视频封面:取项目已生成的整片视频(版本/历史/最终任一),用 <video> 首帧当封面。
// 优先 assetId → 直传地址(永不过期);否则用原始 url。
function extractCoverVideo(project: any, wsId: number): string {
  const draft = getCreativeProjectDraft(project)
  if (!draft) return ''
  const smart = toPlainObject(draft.smart) || draft
  for (const list of [smart?.videoVersions, draft?.videoHistoryList, draft?.video_history_list]) {
    for (const v of normalizeArray(list)) {
      const im = imgOf(v)
      if (im.assetId && wsId) return assetStreamUrl(im.assetId, wsId)
      if (im.url) return im.url
    }
  }
  const aid = Number(draft?.generatedVideoAssetId || smart?.fullVideoAssetId || 0) || 0
  if (aid && wsId) return assetStreamUrl(aid, wsId)
  return String(draft?.generatedVideoUrl || draft?.generated_video_url || smart?.fullVideoUrl || '').trim()
}

// 相对更新时间:「X分钟前更新」
function relativeUpdated(ts: number): string {
  if (!ts) return ''
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return '刚刚更新'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}分钟前更新`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}小时前更新`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}天前更新`
  const mo = Math.floor(d / 30)
  return mo < 12 ? `${mo}个月前更新` : `${Math.floor(mo / 12)}年前更新`
}

// 取首个非空字符串(多字段容错)
function pickFirstText(...candidates: any[]): string {
  for (const candidate of candidates) {
    const value = String(candidate ?? '').trim()
    if (value) return value
  }
  return ''
}

// 项目卡片的参与人头像列表:团队空间展示所有非受限成员,个人空间展示创建者
function resolveProjectAvatars(
  project: any,
  currentUser: any,
  workspaceMembers: any[],
  restrictedIds: number[],
  workspaceId: number,
): { url: string; name: string }[] {
  const restrictedSet = new Set(restrictedIds.filter((id) => Number.isFinite(id) && id > 0))

  // 团队/多人空间：展示所有非受限成员的头像（不再仅限 editors）
  if (workspaceMembers.length > 1) {
    return workspaceMembers
      .filter((m: any) => {
        const uid = resolveUserId(m)
        return uid > 0 && !restrictedSet.has(uid)
      })
      .slice(0, 5)
      .map((m: any) => {
        const uid = resolveUserId(m)
        const name =
          pickFirstText(m?.nickname, m?.name, m?.user?.nickname, m?.user?.name, m?.user?.mobile, m?.mobile) ||
          `成员${uid}`
        const url = pickFirstText(
          m?.avatar,
          m?.avatar_url,
          m?.avatarUrl,
          m?.user?.avatar,
          m?.user?.avatar_url,
          m?.user?.avatarUrl,
        )
        return { url: bindAssetUrlToWorkspace(url, workspaceId), name }
      })
  }

  // 个人空间：后端返回 creator_nickname / creator_avatar_url 时用后端，否则回退当前用户
  const avatarUrl = String(project?.creator_avatar_url || '').trim()
  const name = String(project?.creator_nickname || '').trim()
  if (avatarUrl || name) return [{ url: bindAssetUrlToWorkspace(avatarUrl, workspaceId), name }]
  if (currentUser) {
    const fallbackUrl = pickFirstText(currentUser?.avatar, currentUser?.avatar_url, currentUser?.avatarUrl)
    const fallbackName = pickFirstText(currentUser?.nickname, currentUser?.name, currentUser?.username) || '我'
    return [{ url: bindAssetUrlToWorkspace(fallbackUrl, workspaceId), name: fallbackName }]
  }
  return []
}

// 收集所有 2.1 项目已用到的视频 asset_id —— 用于把「待分类」里的散视频(/assets?type=video)去重,
// 避免和已挂在项目里的成片重复显示。
function collectProjectVideoAssetIds(projectItems: any[]): Set<number> {
  const ids = new Set<number>()
  for (const project of projectItems) {
    const draft = getCreativeProjectDraft(project)
    if (!draft) continue
    const smart = toPlainObject(draft.smart) || draft
    for (const list of [smart?.videoVersions, draft?.videoHistoryList, draft?.video_history_list]) {
      for (const v of normalizeArray(list)) {
        const aid = Number(v?.assetId ?? v?.asset_id ?? 0) || 0
        if (aid) ids.add(aid)
      }
    }
    const main = Number(draft?.generatedVideoAssetId || smart?.fullVideoAssetId || 0) || 0
    if (main) ids.add(main)
  }
  return ids
}

// 提取「2.0 旧版」项目的成片视频:flow 不是 smart/hot-copy(那是 2.1 智能成片/爆款复制),
// 且草稿里有视频(generatedVideoUrl/Asset 或 videoHistoryList 任一,url 或 assetId 都算)。
// 这些就是 2.0 视频,进「待分类」;2.1 的不进(它们在上方项目文件夹 / 项目详情里)。
function extract20Videos(
  projectItems: any[],
  workspaceId: number,
): { id: number; title: string; cover: string; videoUrl: string }[] {
  const out: { id: number; title: string; cover: string; videoUrl: string }[] = []
  for (const project of projectItems) {
    const draft = getCreativeProjectDraft(project)
    if (!draft) continue
    const smart = toPlainObject(draft.smart) || draft
    const flow = String(draft?.flow || smart?.flow || '').toLowerCase()
    if (flow === 'smart' || flow === 'hot-copy') continue // 2.1 → 跳过
    const hasVid =
      !!String(draft?.generatedVideoUrl || draft?.generated_video_url || '').trim() ||
      Number(draft?.generatedVideoAssetId || draft?.generated_video_asset_id || 0) > 0 ||
      normalizeArray(draft?.videoHistoryList || draft?.video_history_list).some(
        (v: any) => String(v?.url || v?.src || '').trim() || Number(v?.assetId || v?.asset_id || 0) > 0,
      )
    if (!hasVid) continue
    out.push({
      id: Number(project?.id || 0),
      title: String(project?.title || project?.name || '').trim() || '未命名项目',
      cover: extractCover(project, workspaceId),
      videoUrl: extractCoverVideo(project, workspaceId),
    })
  }
  return out
}

/** “待归类”区域统一使用的项目视频/素材视频卡片结构。 */
interface UnclassifiedVideoItem {
  kind: 'project' | 'asset'
  id: number
  assetId: number
  title: string
  cover: string
  coverVideo: string
  videoUrl: string
  sourceKey: string
}

/** 项目卡片视频封面上的播放图标。 */
function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
    </svg>
  )
}
/** 渲染当前空间项目、待归类视频及项目级管理操作。 */
export default function ProjectManagementView() {
  const navigate = useNavigate()
  const { showToast } = useToast()
  const { requestConfirm } = useConfirmDialog()
  const workspaceId = useWorkspaceId()
  const currentUser = useCurrentUser()
  const currentWorkspace = useCurrentWorkspace()
  const currentUserId = resolveUserId(currentUser)

  // 工作空间成员,供成员权限弹窗及归属人名字查找
  const [workspaceMembers, setWorkspaceMembers] = useState<any[]>([])
  const [workspaceMembersWorkspaceId, setWorkspaceMembersWorkspaceId] = useState(0)
  const activeWorkspaceId = Number(workspaceId || 0)
  const effectiveWorkspaceMembers =
    workspaceMembersWorkspaceId === activeWorkspaceId ? workspaceMembers : EMPTY_WORKSPACE_MEMBERS
  // 当前用户在工作空间中的角色（owner/admin/member）
  const currentWsRole = useMemo(() => {
    const me = effectiveWorkspaceMembers.find((member: any) => resolveUserId(member) === currentUserId)
    const currentWorkspaceId = Number(currentWorkspace?.id ?? currentWorkspace?.workspace_id ?? 0)
    const workspaceRole =
      currentWorkspaceId > 0 && currentWorkspaceId === activeWorkspaceId ? resolveWorkspaceRole(currentWorkspace) : ''
    return resolveWorkspaceRole(me) || workspaceRole
  }, [effectiveWorkspaceMembers, currentUserId, currentWorkspace, activeWorkspaceId])
  const isWsAdminOrOwner = currentWsRole === 'admin' || currentWsRole === 'owner'
  const permissionContextRef = useRef({ currentUserId: 0, isWsAdminOrOwner: false })
  permissionContextRef.current = { currentUserId, isWsAdminOrOwner }

  // 成员权限弹窗
  const [memberPermProject, setMemberPermProject] = useState<{
    id: number
    title: string
    userId: number
    workspaceId: number
  } | null>(null)
  const [permRestrictedIds, setPermRestrictedIds] = useState<Set<number>>(new Set())
  const [permSaving, setPermSaving] = useState(false)
  const [permInitializing, setPermInitializing] = useState(false)
  const [permLoadError, setPermLoadError] = useState('')
  const permLoadSequenceRef = useRef(0)

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [projectItems, setProjectItems] = useState<any[]>([])
  const [projectItemsWorkspaceId, setProjectItemsWorkspaceId] = useState(0)
  const [projectPermissionsLoadedWorkspaceId, setProjectPermissionsLoadedWorkspaceId] = useState(0)
  const projectItemsWorkspaceIdRef = useRef(0)
  // 只消费明确属于当前工作空间的数据；切换空间期间不短暂显示上一个空间的项目。
  const effectiveProjectItems = projectItemsWorkspaceId === activeWorkspaceId ? projectItems : EMPTY_PROJECT_ITEMS
  const projectPermissionsLoaded = projectPermissionsLoadedWorkspaceId === activeWorkspaceId
  // 项目草稿中的 restrictedMemberIds 是项目级可见性边界，普通成员只会看到自己有权访问的项目。
  const accessibleProjectItems = useMemo(
    () => filterProjectsByAccess(effectiveProjectItems, currentUserId),
    [effectiveProjectItems, currentUserId],
  )
  const accessibleProjectIds = useMemo(
    () => getAccessibleProjectIds(effectiveProjectItems, currentUserId),
    [effectiveProjectItems, currentUserId],
  )
  const projectLoadSequenceRef = useRef(0)
  const [openMenuId, setOpenMenuId] = useState(0)
  const [deletingProjectId, setDeletingProjectId] = useState(0)
  const [dragOverFolderId, setDragOverFolderId] = useState(0)
  // 封面图加载失败的项目 id(过期/坏图)→ 回退占位封面,保证卡片始终有图
  const [coverError, setCoverError] = useState<Set<number>>(new Set())

  // 我的项目分页:固定每行 3 个、每页 3 行(共 9 个),不随屏幕改变列数。
  const gridRef = useRef<HTMLDivElement>(null)
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('') // 搜索项目名称/团队
  const [typeFilter, setTypeFilter] = useState<'all' | '个人项目' | '协作项目'>('all')
  const [sortDesc, setSortDesc] = useState(true) // 时间降序/升序
  // 待归类分页(两行一页,列数随宽度实测)
  const vidGridRef = useRef<HTMLDivElement>(null)
  const [vidCols, setVidCols] = useState(5)
  const [vidPage, setVidPage] = useState(1)

  // 创建项目弹窗
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  const workspaceIdRef = useRef(0)
  const currentUserIdRef = useRef(0)
  useEffect(() => {
    workspaceIdRef.current = Number(workspaceId || 0)
    currentUserIdRef.current = Number(currentUserId || 0)
  }, [currentUserId, workspaceId])

  // 拉取工作空间成员,供成员权限弹窗及归属人名字查找
  useEffect(() => {
    const wsId = Number(workspaceId || 0)
    setWorkspaceMembers([])
    setWorkspaceMembersWorkspaceId(0)
    if (!wsId) {
      return
    }
    let cancelled = false
    listWorkspaceMembers(wsId)
      .then((result: any) => {
        if (!cancelled && Number(workspaceIdRef.current || 0) === wsId) {
          setWorkspaceMembers(Array.isArray(result) ? result : [])
          setWorkspaceMembersWorkspaceId(wsId)
        }
      })
      .catch(() => {
        if (!cancelled && Number(workspaceIdRef.current || 0) === wsId) {
          setWorkspaceMembers([])
          setWorkspaceMembersWorkspaceId(wsId)
        }
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  const folders = useMemo(() => {
    const wsId = Number(workspaceId || 0)
    return accessibleProjectItems
      .map((project) => {
        const isTeamSpace = String(currentWorkspace?.type || '').toLowerCase() !== 'personal'
        const restrictedIds = getRestrictedMemberIds(project)
        // 成员数 = 非受限成员数（决定项目类型是个人还是协作）
        const actualMemberCount = isTeamSpace ? Math.max(1, effectiveWorkspaceMembers.length - restrictedIds.length) : 1
        const imageState = getImageProjectState(project)
        // 视频项目与 listProjectVideos 同口径；图片项目只统计已成功生成且可恢复的图片。
        const worksCount = imageState.imageProject
          ? collectGeneratedProjectImages(project).length
          : countProjectVideos({ project, workspaceId: wsId })
        const cover = extractCover(project, wsId)
        const userId = resolveCreativeProjectOwnerId(project)
        const participantAvatars = resolveProjectAvatars(
          project,
          currentUser,
          effectiveWorkspaceMembers,
          restrictedIds,
          wsId,
        )
        return {
          id: resolveCreativeProjectId(project),
          title: String(project?.title || project?.name || '').trim() || '未命名项目',
          updatedAt: getProjectTimestamp(project, [
            'updated_at',
            'updatedAt',
            'last_saved_at',
            'created_at',
            'createdAt',
          ]),
          cover,
          // 没有图片封面时,退而用已出片视频的首帧当封面
          coverVideo: cover ? '' : extractCoverVideo(project, wsId),
          members: actualMemberCount,
          membersLabel: isTeamSpace ? '成员' : '',
          type: actualMemberCount > 1 ? '协作项目' : '个人项目',
          works: worksCount,
          worksLabel: imageState.imageProject ? '张图片' : '作品',
          imageProject: imageState.imageProject,
          participantAvatars,
          userId,
          workspaceId: wsId,
        }
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }, [accessibleProjectItems, workspaceId, currentWorkspace, currentUser, effectiveWorkspaceMembers])

  // 搜索 + 类型过滤 + 时间排序
  const shownFolders = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = folders.filter(
      (f) => (typeFilter === 'all' || f.type === typeFilter) && (!q || f.title.toLowerCase().includes(q)),
    )
    return sortDesc ? list : [...list].reverse()
  }, [folders, query, typeFilter, sortDesc])

  // 每页 = 3 行 × 3 列 = 9 个(固定,不随屏幕变)
  const pageSize = 9
  const totalPages = Math.max(1, Math.ceil(shownFolders.length / pageSize))
  const pagedFolders = useMemo(
    () => shownFolders.slice((page - 1) * pageSize, page * pageSize),
    [shownFolders, page, pageSize],
  )

  // 列数变化 / 项目减少导致当前页越界时,夹回最后一页
  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])
  // 搜索 / 过滤 / 排序变化时回到第一页
  useEffect(() => {
    setPage(1)
  }, [query, typeFilter, sortDesc])

  // 已归类(拖入项目)的视频 → 从待归类隐藏。来源:各项目云端草稿(collectClassifiedKeys),
  // 不再用 localStorage。pendingClassified 仅为拖入后、列表刷新前的乐观隐藏(纯内存)。
  const [pendingClassified, setPendingClassified] = useState<Set<string>>(new Set())
  useEffect(() => {
    setPendingClassified(new Set())
  }, [workspaceId])
  const classifiedKeys = useMemo(() => {
    const set = collectClassifiedKeys(effectiveProjectItems)
    pendingClassified.forEach((key) => set.add(key))
    return set
  }, [effectiveProjectItems, pendingClassified])

  // 散视频资产:/assets?type=video 里「不属于任何 2.1 项目」的视频(2.0 旧视频通常就在这里)。
  // 排除上传的源视频(source=upload,如爆款源视频),只留生成产物。
  const [looseVideos, setLooseVideos] = useState<{ assetId: number; title: string }[]>([])
  const [looseVideosWorkspaceId, setLooseVideosWorkspaceId] = useState(0)
  const effectiveLooseVideos = looseVideosWorkspaceId === activeWorkspaceId ? looseVideos : EMPTY_LOOSE_VIDEOS
  // 散视频播放:点击 → 取直传地址 → 弹窗 <video> 播放
  const [playUrl, setPlayUrl] = useState('')
  const [playUrlWorkspaceId, setPlayUrlWorkspaceId] = useState(0)
  const playRequestSequenceRef = useRef(0)
  const effectivePlayUrl = playUrlWorkspaceId === activeWorkspaceId ? playUrl : ''
  const closeLooseVideo = useCallback(() => {
    playRequestSequenceRef.current += 1
    setPlayUrl('')
    setPlayUrlWorkspaceId(0)
  }, [])
  useEffect(() => {
    const ws = Number(workspaceId || 0)
    if (!ws || projectItemsWorkspaceId !== ws) {
      setLooseVideos([])
      setLooseVideosWorkspaceId(0)
      return
    }
    let alive = true
    const used = collectProjectVideoAssetIds(effectiveProjectItems)
    listAllAssets({
      workspaceId: ws,
      type: 'video',
      isCurrent: () => alive && Number(workspaceIdRef.current || 0) === ws && projectItemsWorkspaceIdRef.current === ws,
    })
      .then((items: any[]) => {
        if (!alive || Number(workspaceIdRef.current || 0) !== ws || projectItemsWorkspaceIdRef.current !== ws) {
          return
        }
        const loose = items
          .filter((a: any) => {
            if (!isAssetAccessibleByProject(a, accessibleProjectIds, projectPermissionsLoaded)) return false
            const id = Number(a?.id || 0)
            if (!id || used.has(id)) return false // 被某 2.1 项目引用 → 是 2.1 视频,不进待分类
            if (String(a?.source || '').toLowerCase() === 'upload') return false // 上传的源视频不算成片
            return true
          })
          .map((a: any, i: number) => ({
            assetId: Number(a?.id),
            title: String(a?.name || '').trim() || `视频 ${i + 1}`,
          }))
        setLooseVideos(loose)
        setLooseVideosWorkspaceId(ws)
      })
      .catch(() => {
        if (alive && Number(workspaceIdRef.current || 0) === ws && projectItemsWorkspaceIdRef.current === ws) {
          setLooseVideos([])
          setLooseVideosWorkspaceId(ws)
        }
      })
    return () => {
      alive = false
    }
  }, [accessibleProjectIds, effectiveProjectItems, projectItemsWorkspaceId, projectPermissionsLoaded, workspaceId])

  // 待分类 = 只放「2.0 旧视频」:① 2.0 项目成片(flow 非 smart/hot-copy);② 不属于任何项目的游离视频资产。
  // 2.1(智能成片/爆款复制)的成片不进这里。已手动归类的隐藏。
  const unclassified = useMemo(() => {
    const ws = Number(workspaceId || 0)
    const projectVids = extract20Videos(accessibleProjectItems, ws)
      .map((v) => ({
        kind: 'project' as const,
        id: v.id,
        assetId: 0,
        title: v.title,
        cover: v.cover,
        coverVideo: v.videoUrl,
        videoUrl: v.videoUrl,
        sourceKey: videoKeyOf(v.id, v.videoUrl),
      }))
      .filter((v) => !classifiedKeys.has(v.sourceKey))
    const looseVids = effectiveLooseVideos
      .map((a) => {
        const streamUrl = ws ? assetStreamUrl(a.assetId, ws) : ''
        return {
          kind: 'asset' as const,
          id: 0,
          assetId: a.assetId,
          title: a.title,
          cover: '',
          coverVideo: streamUrl,
          videoUrl: streamUrl,
          sourceKey: videoKeyOf(a.assetId, ''),
        } satisfies UnclassifiedVideoItem
      })
      .filter((a) => !classifiedKeys.has(a.sourceKey))
      // 封面用视频首帧:coverVideo 取该资产的直传地址,卡片里用 <video preload=metadata> 显示第一帧
      .map((a) => ({
        ...a,
      }))
    return [...projectVids, ...looseVids]
  }, [accessibleProjectItems, effectiveLooseVideos, classifiedKeys, workspaceId])

  // 播放散视频资产:取直传地址后弹窗播放
  const playLooseVideo = async (assetId: number) => {
    const ws = Number(workspaceId || 0)
    if (!ws || !assetId) return
    const playSequence = ++playRequestSequenceRef.current
    try {
      const url = await getAssetDownloadUrl({ workspaceId: ws, assetId })
      if (
        playSequence !== playRequestSequenceRef.current ||
        Number(workspaceIdRef.current || 0) !== ws ||
        looseVideosWorkspaceId !== ws
      ) {
        return
      }
      if (url) {
        setPlayUrl(url)
        setPlayUrlWorkspaceId(ws)
      } else showToast('无法打开视频', 'info')
    } catch {
      if (playSequence === playRequestSequenceRef.current && Number(workspaceIdRef.current || 0) === ws) {
        showToast('无法打开视频', 'info')
      }
    }
  }

  // 待归类:实测视频网格列数(grid 仅在有数据时渲染,故依赖 unclassified.length 重新挂载观察)
  useEffect(() => {
    if (!unclassified.length) return
    const el = vidGridRef.current
    if (!el) return
    const measure = () => {
      const tracks = getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length
      setVidCols(Math.max(1, tracks))
    }
    return observeElementResize(el, measure)
  }, [unclassified.length])

  // 待归类每页 = 两行
  const vidPageSize = Math.max(1, vidCols * 2)
  const vidTotalPages = Math.max(1, Math.ceil(unclassified.length / vidPageSize))
  const pagedUnclassified = useMemo(
    () => unclassified.slice((vidPage - 1) * vidPageSize, vidPage * vidPageSize),
    [unclassified, vidPage, vidPageSize],
  )
  useEffect(() => {
    if (vidPage > vidTotalPages) setVidPage(vidTotalPages)
  }, [vidPage, vidTotalPages])

  const handleNavigate = useCallback(
    (key: string) => {
      const path = ROUTE_MAP[key]
      if (path) navigate(path)
      else openComingSoon() // 未上线项:弹全局「功能待开放」弹窗
    },
    [navigate],
  )

  // 以云端项目列表为唯一数据源；请求序号 + workspace/user 快照共同阻止过期响应覆盖当前页面。
  const loadProjects = useCallback(async () => {
    const wsId = Number(workspaceIdRef.current || 0)
    const userId = Number(currentUserIdRef.current || 0)
    const loadSequence = ++projectLoadSequenceRef.current
    const isCurrentLoad = () =>
      loadSequence === projectLoadSequenceRef.current &&
      Number(workspaceIdRef.current || 0) === wsId &&
      Number(currentUserIdRef.current || 0) === userId
    if (!wsId || !userId) {
      projectItemsWorkspaceIdRef.current = 0
      setProjectItems([])
      setProjectItemsWorkspaceId(0)
      setProjectPermissionsLoadedWorkspaceId(0)
      setLoading(false)
      return
    }
    setProjectPermissionsLoadedWorkspaceId(0)
    setLoading(true)
    try {
      const items = await listAllCreativeProjects({ workspaceId: wsId, isCurrent: isCurrentLoad })
      if (!isCurrentLoad()) return
      // 项目全部以云端列表为准(不再用 localStorage 缓存新建项目)
      projectItemsWorkspaceIdRef.current = wsId
      setProjectItems(Array.isArray(items) ? items : [])
      setProjectItemsWorkspaceId(wsId)
      setProjectPermissionsLoadedWorkspaceId(wsId)
    } catch {
      if (isCurrentLoad()) {
        projectItemsWorkspaceIdRef.current = wsId
        setProjectItems([])
        setProjectItemsWorkspaceId(wsId)
        setProjectPermissionsLoadedWorkspaceId(0)
        showToast('项目列表加载失败,请稍后重试', 'error')
      }
    } finally {
      if (isCurrentLoad()) setLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    projectLoadSequenceRef.current += 1
    projectItemsWorkspaceIdRef.current = 0
    playRequestSequenceRef.current += 1
    permLoadSequenceRef.current += 1
    setPage(1)
    setVidPage(1)
    setProjectItems([])
    setProjectItemsWorkspaceId(0)
    setProjectPermissionsLoadedWorkspaceId(0)
    setLooseVideos([])
    setLooseVideosWorkspaceId(0)
    setPlayUrl('')
    setPlayUrlWorkspaceId(0)
    setOpenMenuId(0)
    setDeletingProjectId(0)
    setDragOverFolderId(0)
    setCoverError(new Set())
    setPendingClassified(new Set())
    setMemberPermProject(null)
    setPermRestrictedIds(new Set())
    setPermLoadError('')
    setPermInitializing(false)
    setCreateOpen(false)
    setNewName('')
    loadProjects()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId, workspaceId])

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const target = e.target as HTMLElement
      if (openMenuId && !target.closest('.pm2-folder-more')) setOpenMenuId(0)
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [openMenuId])

  const submitCreate = useCallback(async () => {
    const name = newName.trim()
    if (!name) {
      showToast('请输入项目名称', 'info')
      return
    }
    const wsId = Number(workspaceId || 0)
    if (!wsId) {
      showToast('workspace_id 缺失,无法创建', 'error')
      return
    }
    setCreating(true)
    try {
      // 后端项目列表隐藏 draft_revision=0 的空记录；创建后先写入一版中性空草稿，
      // 确保刷新/重新登录后仍能从列表接口看到项目，同时不预设创作流程。
      const created = await createInitializedProjectFolder({ workspaceId: wsId, title: name })
      // 后端不同接口返回的 id 字段名不统一(有的用 id,有的用 project_id/projectId),
      // 统一归一化为 id,确保乐观插入不会被 folders 的 .filter(p => p.id > 0) 过滤掉。
      const newId =
        Number(
          created?.id ??
            created?.project_id ??
            created?.projectId ??
            created?.data?.id ??
            created?.data?.project_id ??
            0,
        ) || 0
      const normalized = { ...created, id: newId || created.id || created.project_id }
      if (Number(workspaceIdRef.current || 0) !== wsId) return
      projectLoadSequenceRef.current += 1
      setLoading(false)
      showToast('项目已创建', 'success')
      setCreateOpen(false)
      setNewName('')
      // 先乐观插入:用户立刻看到新建的项目,不等后端列表刷新。
      const currentItemsBelongToWorkspace = projectItemsWorkspaceIdRef.current === wsId
      projectItemsWorkspaceIdRef.current = wsId
      setProjectItems((prev) => (currentItemsBelongToWorkspace ? [normalized, ...prev] : [normalized]))
      setProjectItemsWorkspaceId(wsId)
      // 拉取最新列表对齐云端,但用合并策略而非替换:
      // 后端列表若因写入延迟暂不包含新项目 → 补回列表头部,不丢失刚建的项目。
      try {
        const refreshSequence = ++projectLoadSequenceRef.current
        const items = await listAllCreativeProjects({
          workspaceId: wsId,
          isCurrent: () =>
            refreshSequence === projectLoadSequenceRef.current && Number(workspaceIdRef.current || 0) === wsId,
        })
        if (refreshSequence === projectLoadSequenceRef.current && Number(workspaceIdRef.current || 0) === wsId) {
          const list = Array.isArray(items) ? items : []
          const exists = list.some((p: any) => {
            const pid = Number(p?.id ?? p?.project_id ?? p?.projectId ?? p?.data?.id ?? 0) || 0
            return pid === newId
          })
          projectItemsWorkspaceIdRef.current = wsId
          setProjectItems(exists ? list : [normalized, ...list])
          setProjectItemsWorkspaceId(wsId)
        }
      } catch {
        // 列表刷新失败不影响已展示的新项目(乐观插入已就位)
      }
    } catch (error: any) {
      if (Number(workspaceIdRef.current || 0) === wsId) {
        showToast(getBusinessErrorMessage(error, '创建失败,请稍后重试'), 'error')
      }
    } finally {
      setCreating(false)
    }
  }, [newName, workspaceId, showToast])

  // 所有通过可见性过滤的成员都可进入项目；图片项目回到图片对话，视频项目进入成片列表。
  const openFolder = useCallback(
    async (folder: { id: number; title: string; workspaceId: number; imageProject?: boolean }) => {
      const wsId = Number(folder.workspaceId || 0)
      if (!folder.id || !wsId || Number(workspaceIdRef.current || 0) !== wsId) {
        showToast('workspace_id 缺失,无法打开项目', 'error')
        return
      }
      navigate(folder.imageProject ? `/smart/${folder.id}` : `/projects/${folder.id}/videos`)
    },
    [showToast, navigate],
  )

  // ---- 成员权限弹窗 ----
  const openMemberPermModal = useCallback(
    async (folder: { id: number; title: string; userId: number; workspaceId?: number }) => {
      const wsId = Number(folder.workspaceId || workspaceIdRef.current || 0)
      const loadSequence = ++permLoadSequenceRef.current
      setOpenMenuId(0)
      setMemberPermProject({ id: folder.id, title: folder.title, userId: folder.userId, workspaceId: wsId })
      setPermRestrictedIds(new Set())
      setPermLoadError('')
      setPermInitializing(true)
      if (!wsId) {
        setPermLoadError('workspace_id 缺失，无法加载成员权限')
        setPermInitializing(false)
        return
      }
      try {
        const project = await getCreativeProject({ projectId: folder.id, workspaceId: wsId })
        if (loadSequence !== permLoadSequenceRef.current || Number(workspaceIdRef.current || 0) !== wsId) return
        const ids = getRestrictedMemberIds(project)
        setPermRestrictedIds(new Set(ids))
      } catch (error) {
        if (loadSequence !== permLoadSequenceRef.current || Number(workspaceIdRef.current || 0) !== wsId) return
        setPermLoadError(getBusinessErrorMessage(error, '成员权限加载失败，请重试'))
      } finally {
        if (loadSequence === permLoadSequenceRef.current && Number(workspaceIdRef.current || 0) === wsId) {
          setPermInitializing(false)
        }
      }
    },
    [],
  )

  const closeMemberPermModal = useCallback(() => {
    permLoadSequenceRef.current += 1
    setMemberPermProject(null)
    setPermRestrictedIds(new Set())
    setPermLoadError('')
  }, [])

  useEffect(() => {
    if (memberPermProject && memberPermProject.workspaceId !== Number(workspaceId || 0)) {
      closeMemberPermModal()
    }
  }, [memberPermProject, workspaceId, closeMemberPermModal])

  // 权限写入复用草稿保存队列和 revision 乐观锁，避免与创作页同时保存草稿时相互覆盖。
  const saveMemberPerm = useCallback(async () => {
    if (!memberPermProject || permSaving) return
    if (permInitializing || permLoadError) {
      showToast('请先重新加载成员权限，再保存', 'error')
      return
    }
    if (!(isWsAdminOrOwner || (memberPermProject.userId > 0 && memberPermProject.userId === currentUserId))) {
      showToast('仅项目创建者或空间管理员可以修改成员权限', 'error')
      return
    }
    setPermSaving(true)
    try {
      const modalProject = memberPermProject
      const wsId = Number(modalProject.workspaceId || 0)
      if (!wsId) throw new Error('workspace_id 缺失')
      if (Number(workspaceIdRef.current || 0) !== wsId) throw new Error('工作空间已切换，请重新打开成员权限')
      const selectedRestrictedIds = [...permRestrictedIds].filter((id) => resolveUserId(id) > 0)
      await enqueueCreativeProjectDraftSave({
        projectId: modalProject.id,
        workspaceId: wsId,
        task: async () => {
          for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
              if (Number(workspaceIdRef.current || 0) !== wsId) {
                throw new Error('工作空间已切换，请重新打开成员权限')
              }
              const [project, latestMembersResult] = await Promise.all([
                getCreativeProject({ projectId: modalProject.id, workspaceId: wsId }),
                listWorkspaceMembers(wsId),
              ])
              const latestMembers = Array.isArray(latestMembersResult) ? latestMembersResult : []
              const latestProjectOwnerId = resolveCreativeProjectOwnerId(project) || modalProject.userId
              const actorMember = latestMembers.find((member: any) => resolveUserId(member) === currentUserId)
              const latestActorRole =
                resolveWorkspaceRole(actorMember) ||
                (Number(workspaceIdRef.current || 0) === wsId &&
                Number(currentWorkspace?.id ?? currentWorkspace?.workspace_id ?? 0) === wsId
                  ? resolveWorkspaceRole(currentWorkspace)
                  : '')
              const actorCanManage =
                latestActorRole === 'owner' ||
                latestActorRole === 'admin' ||
                (latestProjectOwnerId > 0 && latestProjectOwnerId === currentUserId)
              if (!actorCanManage) throw new Error('仅项目创建者或空间管理员可以修改成员权限')

              const restrictedMemberIds: number[] = []
              for (const targetId of selectedRestrictedIds) {
                const target = latestMembers.find((member: any) => resolveUserId(member) === targetId)
                if (!target) continue
                if (
                  !canRestrictWorkspaceMember({
                    actorRole: latestActorRole,
                    targetRole: resolveWorkspaceRole(target),
                    targetUserId: targetId,
                    projectOwnerId: latestProjectOwnerId,
                  })
                ) {
                  throw new Error('项目创建者、空间所有者或受保护的管理员不能被限制')
                }
                restrictedMemberIds.push(targetId)
              }
              const draft = getCreativeProjectDraft(project) || {}
              draft.restrictedMemberIds = restrictedMemberIds
              delete draft.restricted_member_ids
              const revision = Number(project?.draft_revision ?? project?.draftRevision ?? 0) || 0
              await updateCreativeProjectDraft({
                projectId: modalProject.id,
                workspaceId: wsId,
                draft,
                draftRevision: revision,
              })
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
      showToast('成员权限已更新', 'success')
      closeMemberPermModal()
      loadProjects()
    } catch (error: any) {
      showToast(getBusinessErrorMessage(error, '保存失败，请稍后重试'), 'error')
    } finally {
      setPermSaving(false)
    }
  }, [
    memberPermProject,
    permSaving,
    permInitializing,
    permLoadError,
    isWsAdminOrOwner,
    currentUserId,
    currentWorkspace,
    permRestrictedIds,
    showToast,
    closeMemberPermModal,
    loadProjects,
  ])

  // 成员信息提取(头像+名字,多字段兜底)
  function resolveMemberInfo(member: any, index: number): { id: number; name: string; avatarUrl: string } {
    const id = resolveUserId(member)
    const name =
      String(
        member?.nickname || member?.name || member?.user?.nickname || member?.user?.name || member?.mobile || '',
      ).trim() || `成员${index + 1}`
    const avatarUrl = bindAssetUrlToWorkspace(
      String(member?.avatar || member?.avatar_url || member?.avatarUrl || member?.user?.avatar || '').trim(),
      workspaceId,
    )
    return { id, name, avatarUrl }
  }

  // 删除属于破坏性操作：弹窗前检查权限，用户确认后再用最新权限快照复核一次。
  const deleteProject = useCallback(
    async (folder: { id: number; title: string; userId: number; workspaceId: number }) => {
      if (deletingProjectId) return
      setOpenMenuId(0)
      const canDelete = isWsAdminOrOwner || (folder.userId > 0 && folder.userId === currentUserId)
      if (!canDelete) {
        showToast('仅项目创建者或空间管理员可以删除项目', 'error')
        return
      }
      const wsId = Number(folder.workspaceId || 0)
      if (!wsId || Number(workspaceIdRef.current || 0) !== wsId) {
        showToast('workspace_id 缺失,无法删除', 'error')
        return
      }
      const confirmed = await requestConfirm(
        `确定删除项目「${folder.title}」吗?项目内所有版本和草稿将一并删除,不可恢复。`,
      )
      if (!confirmed) return
      if (Number(workspaceIdRef.current || 0) !== wsId) return
      const latestPermission = permissionContextRef.current
      const stillCanDelete =
        latestPermission.isWsAdminOrOwner || (folder.userId > 0 && folder.userId === latestPermission.currentUserId)
      if (!stillCanDelete) {
        showToast('仅项目创建者或空间管理员可以删除项目', 'error')
        return
      }
      setDeletingProjectId(folder.id)
      try {
        await deleteCreativeProject({ projectId: folder.id, workspaceId: wsId })
        if (Number(workspaceIdRef.current || 0) !== wsId) return
        projectLoadSequenceRef.current += 1
        setLoading(false)
        if (projectItemsWorkspaceIdRef.current === wsId) {
          setProjectItems((prev) => prev.filter((item) => Number(item?.id || 0) !== folder.id))
        }
        showToast('项目已删除', 'success')
      } catch (error) {
        if (Number(workspaceIdRef.current || 0) === wsId) {
          showToast(getBusinessErrorMessage(error, '删除失败,请稍后重试'), 'error')
        }
      } finally {
        setDeletingProjectId(0)
      }
    },
    [currentUserId, deletingProjectId, isWsAdminOrOwner, requestConfirm, showToast],
  )

  // 拖拽归类只增加目标项目的视频记录；归类操作者不会因此获得视频删除权限。
  const handleDropToFolder = useCallback(
    async (folder: { id: number; title: string; userId: number; workspaceId: number }, payload: string) => {
      setDragOverFolderId(0)
      let video: Partial<UnclassifiedVideoItem> | null = null
      try {
        video = JSON.parse(payload) as UnclassifiedVideoItem
      } catch {
        video = null
      }
      const sourceKey = String(video?.sourceKey || '').trim()
      const videoUrl = String(video?.videoUrl || video?.coverVideo || video?.cover || '').trim()
      if (!sourceKey || !videoUrl) return
      const wsId = Number(folder.workspaceId || 0)
      if (!wsId || !folder.id || Number(workspaceIdRef.current || 0) !== wsId) {
        showToast('workspace_id 缺失,无法归类', 'error')
        return
      }
      try {
        const projectOwner = effectiveWorkspaceMembers.find(
          (member: any) => resolveUserId(member) === Number(folder.userId || 0),
        )
        // 写入目标项目的视频清单(随项目草稿存云端),并带上来源 key 供「待分类」隐藏
        await addClassifiedVideo({
          projectId: folder.id,
          workspaceId: wsId,
          title: String(video.title || '').trim() || '归类视频',
          videoUrl,
          videoAssetId: Number(video.assetId || 0) || 0,
          coverUrl: String(video.cover || '').trim(),
          createdByName:
            String(
              projectOwner?.nickname ||
                projectOwner?.name ||
                projectOwner?.user?.nickname ||
                projectOwner?.user?.name ||
                '',
            ).trim() || '项目创建者',
          // 操作权限归目标项目创建者；执行归类的普通成员仍可查看/下载，但不会因此获得删除权限。
          createdByUserId: Number(folder.userId || 0) || 0,
          sourceKey,
        })
        if (Number(workspaceIdRef.current || 0) !== wsId) return
        // 乐观隐藏(刷新前),随后拉最新项目列表使云端口径生效
        setPendingClassified((prev) => new Set(prev).add(sourceKey))
        showToast(`已归类到「${folder.title}」`, 'success')
        loadProjects()
      } catch (error) {
        if (Number(workspaceIdRef.current || 0) === wsId) {
          showToast(getBusinessErrorMessage(error, '归类失败,请稍后重试'), 'error')
        }
      }
    },
    [effectiveWorkspaceMembers, showToast, loadProjects],
  )

  return (
    <div
      className="pm2-page"
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', overflow: 'hidden' }}
    >
      <AppSidebar
        activeKey="projects"
        onNavigate={handleNavigate}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div
        className="pm2-shell"
        style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}
      >
        <AppTopbar onMenu={() => setSidebarOpen(true)} />

        <section
          className="pm2-main"
          aria-label="项目管理"
          style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '28px 36px 56px' }}
        >
          <>
            {/* 项目管理:头部(标题/副标题 + 搜索 + 新建)*/}
            <div className="pm2-head">
              <div className="pm2-head-titles">
                <h1 className="pm2-head-title">项目管理</h1>
                <p className="pm2-head-sub">管理个人项目与团队协作项目</p>
              </div>
              <div className="pm2-head-actions">
                <div className="pm2-search">
                  <input
                    className="pm2-search-input"
                    value={query}
                    placeholder="搜索项目名称、团队"
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                    <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="1.8" />
                    <path
                      d="m20 20-3.5-3.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                  </svg>
                </div>
                <button type="button" className="pm2-new-btn" onClick={() => setCreateOpen(true)}>
                  ＋ 新建项目
                </button>
              </div>
            </div>

            {/* 筛选条:类型 / 状态(占位) / 排序 */}
            <div className="pm2-filters">
              <span className="pm2-filter">
                项目类型:
                <select
                  className="pm2-filter-select"
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}
                >
                  <option value="all">全部类型</option>
                  <option value="个人项目">个人项目</option>
                  <option value="协作项目">协作项目</option>
                </select>
              </span>
              <span className="pm2-filter">
                项目状态:
                <select className="pm2-filter-select" disabled>
                  <option>全部状态</option>
                </select>
              </span>
              <button type="button" className="pm2-sort" onClick={() => setSortDesc((v) => !v)} title="按更新时间排序">
                <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                  <path
                    d="M4 3v10M4 13l-2-2M4 13l2-2M9 4h5M9 8h4M9 12h3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                时间{sortDesc ? '降序' : '升序'}
              </button>
            </div>

            {/* 项目卡片网格 */}
            <section className="pm2-section">
              {loading && !folders.length ? (
                <div className="pm2-hint">正在加载项目…</div>
              ) : !shownFolders.length ? (
                <div className="pm2-hint">
                  {query || typeFilter !== 'all' ? '没有匹配的项目' : '还没有项目,点右上角「新建项目」开始'}
                </div>
              ) : (
                <div className="pm2-card-grid" ref={gridRef}>
                  {pagedFolders.map((folder) => (
                    <div
                      key={folder.id}
                      className={`pm2-pcard${dragOverFolderId === folder.id ? ' is-dropover' : ''}`}
                      role="button"
                      tabIndex={0}
                      aria-label={`打开项目 ${folder.title}`}
                      onClick={() => openFolder(folder)}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter' && e.key !== ' ') return
                        e.preventDefault()
                        void openFolder(folder)
                      }}
                      onDragOver={(e) => {
                        e.preventDefault()
                        if (dragOverFolderId !== folder.id) setDragOverFolderId(folder.id)
                      }}
                      onDragLeave={() => dragOverFolderId === folder.id && setDragOverFolderId(0)}
                      onDrop={(e) => {
                        e.preventDefault()
                        handleDropToFolder(folder, e.dataTransfer.getData('text/plain'))
                      }}
                    >
                      <div className="pm2-pcard-cover">
                        {folder.cover && !coverError.has(folder.id) ? (
                          // ① 真实图片封面(入口素材 / 分镜图 / 封面字段)
                          <img
                            className="pm2-pcard-cover-media"
                            src={folder.cover}
                            alt=""
                            loading="lazy"
                            onError={() => setCoverError((prev) => new Set(prev).add(folder.id))}
                          />
                        ) : folder.coverVideo ? (
                          // ② 没图但已出片:用整片视频首帧当封面
                          <video
                            className="pm2-pcard-cover-media"
                            src={folder.coverVideo}
                            muted
                            playsInline
                            preload="metadata"
                          />
                        ) : (
                          // ③ 空项目兜底:渐变 + 完整项目标题占位封面
                          <span className="pm2-pcard-cover-ph">{folder.title}</span>
                        )}
                      </div>
                      <div className="pm2-pcard-body">
                        <div className="pm2-pcard-head">
                          <span className="pm2-pcard-title" title={folder.title}>
                            {folder.title}
                          </span>
                          <button
                            type="button"
                            className="pm2-pcard-more"
                            aria-label="更多操作"
                            onClick={(e) => {
                              e.stopPropagation()
                              setOpenMenuId((prev) => (prev === folder.id ? 0 : folder.id))
                            }}
                          >
                            <svg viewBox="0 0 20 20" aria-hidden="true" width="18" height="18">
                              <circle cx="4" cy="10" r="1.4" fill="currentColor" />
                              <circle cx="10" cy="10" r="1.4" fill="currentColor" />
                              <circle cx="16" cy="10" r="1.4" fill="currentColor" />
                            </svg>
                            {openMenuId === folder.id && (
                              <div className="pm2-folder-menu" onClick={(e) => e.stopPropagation()}>
                                {folder.userId > 0 && (folder.userId === currentUserId || isWsAdminOrOwner) && (
                                  <button
                                    type="button"
                                    className="pm2-folder-menu-item"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      openMemberPermModal({
                                        id: folder.id,
                                        title: folder.title,
                                        userId: folder.userId,
                                        workspaceId: folder.workspaceId,
                                      })
                                    }}
                                  >
                                    成员权限
                                  </button>
                                )}
                                {(isWsAdminOrOwner || (folder.userId > 0 && folder.userId === currentUserId)) && (
                                  <button
                                    type="button"
                                    className="pm2-folder-menu-item is-danger"
                                    disabled={deletingProjectId === folder.id}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      deleteProject(folder)
                                    }}
                                  >
                                    {deletingProjectId === folder.id ? '删除中…' : '删除项目'}
                                  </button>
                                )}
                              </div>
                            )}
                          </button>
                        </div>
                        <div className="pm2-pcard-meta">
                          <span className="pm2-pcard-type">
                            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                              <circle cx="12" cy="8" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
                              <path
                                d="M5 19c0-3.3 3.1-5 7-5s7 1.7 7 5"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.6"
                                strokeLinecap="round"
                              />
                            </svg>
                            {folder.type}
                          </span>
                          <span className="pm2-pcard-counts">
                            {folder.members} {folder.membersLabel} · {folder.works} {folder.worksLabel}
                          </span>
                        </div>
                        <div className="pm2-pcard-foot">
                          {folder.participantAvatars && folder.participantAvatars.length > 0 ? (
                            <span className="pm2-pcard-avatars">
                              {folder.participantAvatars.map((av: any, idx: number) => (
                                <span
                                  key={idx}
                                  className={`pm2-pcard-avatar${idx > 0 ? ' is-stacked' : ''}`}
                                  title={av.name || ''}
                                >
                                  {av.url ? (
                                    <img
                                      src={av.url}
                                      alt={av.name || ''}
                                      onError={(e) => {
                                        const el = e.currentTarget as HTMLImageElement
                                        el.style.display = 'none'
                                        const fallback = el.nextElementSibling as HTMLElement | null
                                        if (fallback) fallback.style.display = 'inline-flex'
                                      }}
                                    />
                                  ) : null}
                                  <span
                                    className="pm2-pcard-avatar-txt"
                                    style={av.url ? { display: 'none' } : undefined}
                                  >
                                    {(av.name || '?').slice(0, 1)}
                                  </span>
                                </span>
                              ))}
                            </span>
                          ) : (
                            <span className="pm2-pcard-avatar">{folder.title.slice(0, 1)}</span>
                          )}
                          <span className="pm2-pcard-time">{relativeUpdated(folder.updatedAt)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {totalPages > 1 && (
                <div className="pm2-pager">
                  <Pagination
                    current={page}
                    pageSize={pageSize}
                    total={shownFolders.length}
                    showSizeChanger={false}
                    onChange={setPage}
                  />
                </div>
              )}
            </section>

            {/* 待分类:已出成片但还没归类到项目文件夹的视频;点击进入该视频页查看/播放,可拖入上方项目归类 */}
            {unclassified.length > 0 && (
              <section className="pm2-section">
                <h2 className="pm2-section-title">待分类</h2>
                <div className="pm2-video-grid" ref={vidGridRef}>
                  {pagedUnclassified.map((video, i) => (
                    <div key={`${video.kind}-${video.id || video.assetId}-${i}`} className="pm2-vid-wrap">
                      <div
                        className="pm2-vid"
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = 'move'
                          e.dataTransfer.setData(
                            'text/plain',
                            JSON.stringify({
                              kind: video.kind,
                              id: video.id,
                              assetId: video.assetId,
                              title: video.title,
                              cover: video.cover,
                              coverVideo: video.coverVideo,
                              videoUrl: video.videoUrl,
                              sourceKey: video.sourceKey,
                            }),
                          )
                        }}
                      >
                        <span
                          className={`pm2-vid-thumb pm2-tone-${toneOf(i)}`}
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            if (video.kind === 'asset') {
                              playLooseVideo(video.assetId) // 散视频资产 → 弹窗播放
                            } else if (video.id) {
                              navigate(`/projects/${video.id}/videos`) // 项目成片 → 进项目视频页
                            } else {
                              showToast('无法打开视频', 'info')
                            }
                          }}
                        >
                          {video.cover ? (
                            <img
                              className="pm2-vid-media"
                              src={video.cover}
                              alt={video.title}
                              onError={(e) => {
                                ;(e.currentTarget as HTMLImageElement).style.display = 'none'
                              }}
                            />
                          ) : video.coverVideo ? (
                            // 散视频:用视频首帧当封面
                            <video
                              className="pm2-vid-media"
                              src={video.coverVideo}
                              muted
                              playsInline
                              preload="metadata"
                            />
                          ) : (
                            <span className="pm2-vid-play">
                              <PlayIcon />
                            </span>
                          )}
                        </span>
                        <span className="pm2-vid-title" title={video.title}>
                          {video.title}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                {vidTotalPages > 1 && (
                  <div className="pm2-pager">
                    <Pagination
                      current={vidPage}
                      pageSize={vidPageSize}
                      total={unclassified.length}
                      showSizeChanger={false}
                      onChange={setVidPage}
                    />
                  </div>
                )}
              </section>
            )}
          </>
        </section>
      </div>

      {/* 创建项目弹窗(基础版,后续由设计稿细化) */}
      {createOpen &&
        createPortal(
          <div
            className="pm2-modal-mask"
            onClick={(e) => {
              if (e.target === e.currentTarget && !creating) setCreateOpen(false)
            }}
          >
            <div className="pm2-modal" role="dialog" aria-label="创建项目">
              <div className="pm2-modal-head">
                <span>创建项目</span>
                <button
                  type="button"
                  className="pm2-modal-close"
                  aria-label="关闭"
                  disabled={creating}
                  onClick={() => setCreateOpen(false)}
                >
                  ×
                </button>
              </div>
              <div className="pm2-modal-body">
                <label className="pm2-modal-label">项目名称</label>
                <input
                  className="pm2-modal-input"
                  value={newName}
                  autoFocus
                  maxLength={40}
                  placeholder="给项目起个名字…"
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submitCreate()}
                />
              </div>
              <div className="pm2-modal-foot">
                <button
                  type="button"
                  className="pm2-modal-btn"
                  disabled={creating}
                  onClick={() => setCreateOpen(false)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="pm2-modal-btn pm2-modal-btn--primary"
                  disabled={creating}
                  onClick={submitCreate}
                >
                  {creating ? '创建中…' : '创建'}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* 成员权限弹窗 */}
      {memberPermProject &&
        createPortal(
          <div
            className="pm2-modal-mask"
            onClick={(e) => {
              if (e.target === e.currentTarget && !permSaving) closeMemberPermModal()
            }}
          >
            <div
              className="pm2-modal"
              style={{
                width: 'min(480px, 96vw)',
                maxHeight: 'min(560px, 80vh)',
                display: 'flex',
                flexDirection: 'column',
              }}
              role="dialog"
              aria-label="成员权限"
            >
              <div className="pm2-modal-head">
                <span>成员权限 - {memberPermProject.title}</span>
                <button
                  type="button"
                  className="pm2-modal-close"
                  aria-label="关闭"
                  disabled={permSaving}
                  onClick={closeMemberPermModal}
                >
                  ×
                </button>
              </div>
              <div className="pm2-modal-body" style={{ flex: 1, overflowY: 'auto', padding: '0 20px' }}>
                {permInitializing ? (
                  <div style={{ padding: '32px 0', textAlign: 'center', color: '#9aa3af', fontSize: 14 }}>
                    正在加载成员列表…
                  </div>
                ) : permLoadError ? (
                  <div role="alert" style={{ padding: '32px 0', textAlign: 'center', color: '#d94c4c', fontSize: 14 }}>
                    <div>{permLoadError}</div>
                    <button
                      type="button"
                      className="pm2-modal-btn"
                      style={{ marginTop: 14 }}
                      onClick={() => openMemberPermModal(memberPermProject)}
                    >
                      重新加载
                    </button>
                  </div>
                ) : !effectiveWorkspaceMembers.length ? (
                  <div style={{ padding: '32px 0', textAlign: 'center', color: '#9aa3af', fontSize: 14 }}>暂无成员</div>
                ) : (
                  effectiveWorkspaceMembers.map((member: any, idx: number) => {
                    const info = resolveMemberInfo(member, idx)
                    const isRestricted = permRestrictedIds.has(info.id)
                    const isProjectOwner = memberPermProject.userId > 0 && info.id === memberPermProject.userId
                    // 该成员的工作空间角色
                    const memberRole = resolveWorkspaceRole(member)
                    const isWsOwner = memberRole === 'owner'
                    const isWsAdmin = memberRole === 'admin'
                    const cannotRestrict = !canRestrictWorkspaceMember({
                      actorRole: currentWsRole,
                      targetRole: memberRole,
                      targetUserId: info.id,
                      projectOwnerId: memberPermProject.userId,
                    })
                    return (
                      <div className="pm2-perm-member-row" key={info.id || `missing-${idx}`}>
                        <div className="pm2-perm-avatar pm2-perm-avatar-placeholder">
                          <UserAvatar src={info.avatarUrl} name={info.name} />
                        </div>
                        <div className="pm2-perm-name">
                          {info.name}
                          {isProjectOwner && <span className="pm2-perm-owner-tag">创建者</span>}
                          {isWsOwner && !isProjectOwner && <span className="pm2-perm-owner-tag">超级管理员</span>}
                          {isWsAdmin && <span className="pm2-perm-owner-tag">管理员</span>}
                          {!info.id && <span className="pm2-perm-owner-tag">身份信息缺失</span>}
                        </div>
                        {cannotRestrict ? (
                          <span className="pm2-perm-cannot-hint">无法限制</span>
                        ) : (
                          <button
                            type="button"
                            className={`pm2-perm-toggle${isRestricted ? ' pm2-perm-toggle--on' : ' pm2-perm-toggle--off'}`}
                            disabled={permSaving}
                            onClick={() => {
                              if (permSaving) return
                              setPermRestrictedIds((prev) => {
                                const next = new Set(prev)
                                if (next.has(info.id)) next.delete(info.id)
                                else next.add(info.id)
                                return next
                              })
                            }}
                            aria-label={isRestricted ? '取消限制' : '限制访问'}
                          >
                            <span className="pm2-perm-toggle-knob" style={{ left: isRestricted ? 22 : 2 }} />
                          </button>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
              <div className="pm2-modal-foot">
                <button type="button" className="pm2-modal-btn" disabled={permSaving} onClick={closeMemberPermModal}>
                  取消
                </button>
                <button
                  type="button"
                  className="pm2-modal-btn pm2-modal-btn--primary"
                  disabled={permSaving || permInitializing || Boolean(permLoadError)}
                  onClick={saveMemberPerm}
                >
                  {permSaving ? '保存中…' : '保存'}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* 散视频(待分类)播放弹窗 */}
      {effectivePlayUrl &&
        createPortal(
          <div className="pm2-lightbox" onClick={closeLooseVideo} role="dialog" aria-label="视频播放">
            <video
              src={effectivePlayUrl}
              controls
              autoPlay
              playsInline
              onClick={(e) => e.stopPropagation()}
              style={{ maxWidth: '90vw', maxHeight: '85vh', borderRadius: 12, background: '#000' }}
            />
            <button type="button" className="pm2-lightbox-close" aria-label="关闭" onClick={closeLooseVideo}>
              ×
            </button>
          </div>,
          document.body,
        )}
    </div>
  )
}
