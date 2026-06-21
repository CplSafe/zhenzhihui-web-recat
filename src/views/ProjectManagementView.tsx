/*
  ProjectManagementView — 创意项目管理列表页
  展示当前工作空间下所有创意项目，支持搜索、筛选、删除、恢复项目，以及进入编辑或查看草稿。
*/
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import '@/styles/creative.css'
import '@/styles/project-management.css'
import { listWorkspaceMembers } from '@/api/auth'
import AppLayout from '@/components/layout/AppLayout'
import AppToast from '@/components/AppToast'
import {
  deleteCreativeProject,
  deleteCreativeProjectVersion,
  getAssetDownloadUrl,
  getBusinessErrorMessage,
  getCreativeProject,
  getCreativeProjectVersion,
  listCreativeProjects,
  listCreativeProjectVersions,
  restoreCreativeProjectVersion,
} from '@/api/business'
import { useConfirmDialog, useToast } from '@/composables/useToast'
import { useCurrentMember, useCurrentUser, useCurrentWorkspace, useWorkspaceId } from '@/stores/workspaceSession'

const categoryOptions = [
  { value: 'all', label: '全部类型' },
  { value: 'personal', label: '个人项目' },
  { value: 'collab', label: '协作项目' },
]

const statusOptions = [
  { value: 'all', label: '全部状态' },
  { value: 'processing', label: '进行中' },
  { value: 'done', label: '已完成' },
]

const sortOptions = [
  { value: 'updated', label: '时间降序' },
  { value: 'created', label: '创建时间' },
  { value: 'title', label: '名称排序' },
]

// ---- 纯函数工具（与组件状态无关，提取到模块级） ----

function normalizeProjectId(value: any): number {
  const id = Number(value || 0)
  return Number.isFinite(id) && id > 0 ? Math.floor(id) : 0
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

function pickFirstText(...candidates: any[]): string {
  for (const candidate of candidates) {
    const value = String(candidate ?? '').trim()
    if (value) return value
  }
  return ''
}

function pickFirstString(obj: any, keys: string[]): string {
  for (const key of keys) {
    const value = obj?.[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function resolveAssetId(value: any): number {
  const n = Number(value || 0)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

function resolveImageCandidate(value: any): { url: string; assetId: number } {
  if (typeof value === 'string') {
    const url = value.trim()
    return { url, assetId: 0 }
  }
  if (!value || typeof value !== 'object') {
    return { url: '', assetId: 0 }
  }
  return {
    url: pickFirstString(value, [
      'src',
      'url',
      'imageUrl',
      'image_url',
      'thumbnailUrl',
      'thumbnail_url',
      'previewUrl',
      'preview_url',
      'coverUrl',
      'cover_url',
    ]),
    assetId: resolveAssetId(value?.assetId || value?.asset_id),
  }
}

function hasImageCandidate(value: any): boolean {
  const candidate = resolveImageCandidate(value)
  return Boolean(candidate.url || candidate.assetId)
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

function resolveStoryboardVisualCandidate(storyboard: any): { url: string; assetId: number } {
  const currentImage = resolveImageCandidate(storyboard?.currentImage || storyboard?.current_image)
  if (currentImage.url || currentImage.assetId) return currentImage

  const versionHistory = normalizeArray(storyboard?.versionHistory || storyboard?.version_history)
  const currentIndex = Number(storyboard?.currentVersionIndex ?? storyboard?.current_version_index)
  if (versionHistory.length && Number.isFinite(currentIndex)) {
    const safeIndex = Math.max(0, Math.min(Math.floor(currentIndex), versionHistory.length - 1))
    const currentVersion = resolveImageCandidate(versionHistory[safeIndex])
    if (currentVersion.url || currentVersion.assetId) return currentVersion
  }

  for (const version of versionHistory) {
    const candidate = resolveImageCandidate(version)
    if (candidate.url || candidate.assetId) return candidate
  }

  const direct = resolveImageCandidate(storyboard)
  if (direct.url || direct.assetId) return direct

  const historyImages = normalizeArray(storyboard?.historyImages || storyboard?.history_images)
  for (const image of historyImages) {
    const candidate = resolveImageCandidate(image)
    if (candidate.url || candidate.assetId) return candidate
  }

  return { url: '', assetId: 0 }
}

function resolveCoverCandidateFromDraft(draft: any): { url: string; assetId: number } {
  const storyboardItems = normalizeArray(
    draft?.storyboardItems || draft?.storyboard_items || draft?.storyboards || draft?.data?.storyboardItems,
  )

  for (const storyboard of storyboardItems) {
    const candidate = resolveStoryboardVisualCandidate(storyboard)
    if (candidate.url || candidate.assetId) return candidate
  }

  // 降级到生成好的视频（视频首帧可作为封面）
  const videoUrl = draft?.generatedVideoUrl || draft?.generated_video_url || ''
  const videoAssetId =
    Number(draft?.generatedVideoAssetId || draft?.generated_video_asset_id || 0) || 0
  if (videoUrl || videoAssetId) {
    return { url: videoUrl, assetId: videoAssetId }
  }

  // 再降级到视频历史中的最近一条
  const videoHistory = normalizeArray(draft?.videoHistoryList || draft?.video_history_list)
  for (const entry of videoHistory) {
    const url = entry?.url || entry?.src || ''
    const assetId = Number(entry?.assetId || entry?.asset_id || 0) || 0
    if (url || assetId) return { url, assetId }
  }

  const materials = normalizeArray(draft?.materials || draft?.materialList || draft?.assets)
  for (const material of materials) {
    if (!hasImageCandidate(material)) continue
    const candidate = resolveImageCandidate(material)
    if (candidate.url || candidate.assetId) return candidate
  }

  return { url: '', assetId: 0 }
}

function countGeneratedStoryboardImages(draft: any): number {
  const storyboardItems = normalizeArray(draft?.storyboardItems || draft?.storyboard_items || draft?.storyboards)
  return storyboardItems.reduce((count: number, storyboard: any) => {
    const candidate = resolveStoryboardVisualCandidate(storyboard)
    return candidate.url || candidate.assetId ? count + 1 : count
  }, 0)
}

function getProjectTimestamp(project: any, keys: string[]): number {
  const raw = keys
    .map((key) => project?.[key])
    .find((value) => typeof value === 'string' && value.trim())
  const timestamp = Date.parse(raw || '')
  return Number.isFinite(timestamp) ? timestamp : 0
}

function formatRelativeTime(value: any): string {
  const timestamp = Date.parse(value || '')
  if (!Number.isFinite(timestamp)) return '刚刚更新'
  const diff = Date.now() - timestamp
  if (diff < 60 * 1000) return '刚刚更新'
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / (60 * 1000))} 分钟前更新`
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / (60 * 60 * 1000))} 小时前更新`
  if (diff < 7 * 24 * 60 * 60 * 1000) return `${Math.floor(diff / (24 * 60 * 60 * 1000))} 天前更新`
  const date = new Date(timestamp)
  const y = date.getFullYear()
  const m = `${date.getMonth() + 1}`.padStart(2, '0')
  const d = `${date.getDate()}`.padStart(2, '0')
  return `${y}.${m}.${d} 更新`
}

function resolveProjectStatusMeta(project: any): { key: string; label: string } {
  const raw = String(project?.status || '')
    .trim()
    .toLowerCase()
  if (['processing', 'submitting', 'queued', 'pending', 'running', 'draft'].includes(raw)) {
    return { key: 'processing', label: '进行中' }
  }
  if (['done', 'completed', 'success', 'finished'].includes(raw)) {
    return { key: 'done', label: '已完成' }
  }
  return { key: 'processing', label: '进行中' }
}

function getAvatarTone(index: number): string {
  const tones = ['blue', 'peach', 'lavender', 'mint', 'coral']
  return tones[index % tones.length]
}

function normalizeMemberDisplayName(member: any, fallback = ''): string {
  return (
    pickFirstText(
      member?.nickname,
      member?.name,
      member?.user?.nickname,
      member?.user?.name,
      member?.profile?.nickname,
      member?.account?.nickname,
      member?.user?.mobile,
      member?.mobile,
      member?.user?.email,
      fallback,
    ) || fallback
  )
}

function normalizeMemberAvatarUrl(member: any): string {
  return pickFirstText(
    member?.avatar,
    member?.avatar_url,
    member?.avatarUrl,
    member?.headimg,
    member?.headimgurl,
    member?.headimg_url,
    member?.portrait,
    member?.portrait_url,
    member?.portraitUrl,
    member?.profile_image,
    member?.profileImage,
    member?.profile?.avatar,
    member?.profile?.avatar_url,
    member?.profile?.avatarUrl,
    member?.profile?.headimg,
    member?.profile?.image,
    member?.account?.avatar,
    member?.account?.avatar_url,
    member?.account?.avatarUrl,
    member?.user?.avatar,
    member?.user?.avatar_url,
    member?.user?.avatarUrl,
    member?.user?.headimg,
    member?.user?.headimg_url,
    member?.user?.portrait,
    member?.user?.portrait_url,
    member?.user?.profile_image,
  )
}

function normalizeWorkspaceMemberId(member: any, index: number): number {
  const id = Number(member?.id || member?.user_id || member?.userId || member?.user?.id || 0)
  if (Number.isFinite(id) && id > 0) return Math.floor(id)
  return index + 1
}

function normalizeWorkspaceMembers(payload: any): any[] {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.items)
      ? payload.items
      : Array.isArray(payload?.list)
        ? payload.list
        : Array.isArray(payload?.members)
          ? payload.members
          : Array.isArray(payload?.records)
            ? payload.records
            : []

  return list
    .filter((item: any) => item && typeof item === 'object')
    .map((item: any, index: number) => {
      const name = normalizeMemberDisplayName(item, `成员${index + 1}`)
      return {
        id: normalizeWorkspaceMemberId(item, index),
        name,
        text: name.trim().charAt(0).toUpperCase() || '员',
        url: normalizeMemberAvatarUrl(item),
        tone: getAvatarTone(index),
      }
    })
}

function resolveProjectMemberCount(project: any, fallbackCount: number): number {
  const direct = [
    project?.member_count,
    project?.memberCount,
    project?.participant_count,
    project?.participantCount,
    project?.members_count,
    project?.membersCount,
  ]
    .map((value) => Number(value || 0))
    .find((value) => Number.isFinite(value) && value > 0)
  if (direct) return Math.floor(direct)
  return Math.max(Number(fallbackCount || 0), 1)
}

function normalizeCreativeProjectVersions(payload: any): any[] {
  const raw = toPlainObject(payload) ?? payload
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.items)
      ? raw.items
      : Array.isArray(raw?.list)
        ? raw.list
        : Array.isArray(raw?.versions)
          ? raw.versions
          : []
  return list.filter((item: any) => item && typeof item === 'object')
}

function resolveVersionId(item: any): number {
  return Number(item?.vid || item?.version_id || item?.versionId || item?.id || item?.version_no || 0)
}

function resolveVersionLabel(item: any, fallbackTitle = '未命名保存项目'): string {
  const explicit = pickFirstText(item?.label, item?.name, item?.title)
  if (explicit) return explicit
  const versionNo = Number(item?.version_no || item?.versionNo || 0)
  if (Number.isFinite(versionNo) && versionNo > 0) {
    return `保存项目 ${versionNo}`
  }
  const versionId = resolveVersionId(item)
  if (versionId > 0) {
    return `保存项目 ${versionId}`
  }
  return fallbackTitle
}

export default function ProjectManagementView() {
  const navigate = useNavigate()
  const { showToast } = useToast()
  const { requestConfirm } = useConfirmDialog()

  const workspaceId = useWorkspaceId()
  const currentWorkspace = useCurrentWorkspace()
  const currentMember = useCurrentMember()
  const currentUser = useCurrentUser()

  const [selectedCategory, setSelectedCategory] = useState('all')
  const [selectedStatus, setSelectedStatus] = useState('all')
  const [selectedSort, setSelectedSort] = useState('updated')
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false)
  const categoryMenuRef = useRef<HTMLDivElement>(null)
  const [viewMode, setViewMode] = useState<'root' | 'children'>('root')
  const [activeParentProjectId, setActiveParentProjectId] = useState(0)
  const [projectVersions, setProjectVersions] = useState<any[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [openingVersion, setOpeningVersion] = useState(false)
  const [deletingVersion, setDeletingVersion] = useState(false)
  const [deletingProjectId, setDeletingProjectId] = useState(0)
  const [openMenuId, setOpenMenuId] = useState(0)
  const [selectedSavedProjectId, setSelectedSavedProjectId] = useState(0)

  // 视频预览
  const [videoPreviewOpen, setVideoPreviewOpen] = useState(false)
  const [videoPreviewUrl, setVideoPreviewUrl] = useState('')
  const [videoPreviewLoading, setVideoPreviewLoading] = useState(false)
  const [videoPreviewTitle, setVideoPreviewTitle] = useState('')

  const [loading, setLoading] = useState(false)
  const [projectItems, setProjectItems] = useState<any[]>([])
  const [coverMetaById, setCoverMetaById] = useState<Record<number, any>>({})
  const [workspaceMembers, setWorkspaceMembers] = useState<any[]>([])

  // 用 ref 保留最新 workspaceId，供异步任务做"是否切换工作空间"的判断
  const workspaceIdRef = useRef(0)
  useEffect(() => {
    workspaceIdRef.current = Number(workspaceId || 0)
  }, [workspaceId])

  const currentCategoryLabel = useMemo(
    () => categoryOptions.find((item) => item.value === selectedCategory)?.label || '全部类型',
    [selectedCategory],
  )

  const makeFallbackCurrentAvatar = useCallback(() => {
    const name = pickFirstText(
      currentMember?.nickname,
      currentMember?.name,
      currentUser?.nickname,
      currentUser?.name,
      currentUser?.mobile,
      currentUser?.email,
      '我',
    )

    return {
      id: Number(currentUser?.id || currentMember?.user_id || 0) || 1,
      name,
      text: name.trim().charAt(0).toUpperCase() || '我',
      url: normalizeMemberAvatarUrl(currentMember || currentUser || {}),
      tone: getAvatarTone(0),
    }
  }, [currentMember, currentUser])

  const resolveProjectType = useCallback(
    (project: any): { key: string; label: string } => {
      const workspaceType = String(currentWorkspace?.type || '').toLowerCase()
      const projectType = String(project?.workspace_type || project?.type || '').toLowerCase()
      const raw = projectType || workspaceType
      return raw === 'team'
        ? { key: 'collab', label: '协作项目' }
        : { key: 'personal', label: '个人项目' }
    },
    [currentWorkspace],
  )

  const makeAvatarList = useCallback(
    (_project: any, typeMeta: { key: string }) => {
      const realMembers = workspaceMembers.length ? workspaceMembers : [makeFallbackCurrentAvatar()]
      if (typeMeta.key === 'personal') {
        return realMembers.slice(0, 1)
      }
      return realMembers.slice(0, 3)
    },
    [workspaceMembers, makeFallbackCurrentAvatar],
  )

  const allProjectCards = useMemo(() => {
    const keyword = searchQuery.trim().toLowerCase()
    const workspaceName = String(currentWorkspace?.name || '').trim()

    const cards = projectItems.map((project, index) => {
      const id = Number(project?.id || 0)
      const coverMeta = coverMetaById?.[id] || {}
      const typeMeta = resolveProjectType(project)
      const statusMeta = resolveProjectStatusMeta(project)
      const title = String(project?.title || project?.name || '').trim() || '未命名项目'
      const avatars = makeAvatarList(project, typeMeta)
      const memberCount = resolveProjectMemberCount(project, avatars.length)
      const storyboardCount = Number(coverMeta.storyboardCount || 0)
      return {
        id,
        title,
        workspaceName: workspaceName || '当前团队',
        typeKey: typeMeta.key,
        typeLabel: typeMeta.label,
        statusKey: statusMeta.key,
        statusLabel: statusMeta.label,
        coverUrl: coverMeta.url || '',
        flow: String(coverMeta.flow || ''),
        storyboardCount,
        memberCount,
        itemCount: Number(coverMeta.videoSaveCount || 0),
        updatedText: formatRelativeTime(
          project?.updated_at || project?.updatedAt || project?.last_saved_at || project?.created_at || project?.createdAt,
        ),
        createdAt: getProjectTimestamp(project, ['created_at', 'createdAt', 'updated_at', 'updatedAt']),
        updatedAt: getProjectTimestamp(project, ['updated_at', 'updatedAt', 'last_saved_at', 'created_at', 'createdAt']),
        avatars,
        highlighted: index === 3,
      }
    })

    return cards
      .filter((project) => {
        // 只显示已保存过视频的项目
        if (project.itemCount <= 0) return false
        if (selectedCategory !== 'all' && project.typeKey !== selectedCategory) return false
        if (selectedStatus !== 'all' && project.statusKey !== selectedStatus) return false
        if (!keyword) return true
        return [project.title, project.workspaceName, project.typeLabel].some((item) =>
          String(item || '')
            .toLowerCase()
            .includes(keyword),
        )
      })
      .sort((a, b) => {
        if (selectedSort === 'title') return a.title.localeCompare(b.title, 'zh-CN')
        if (selectedSort === 'created') return b.createdAt - a.createdAt
        return b.updatedAt - a.updatedAt
      })
  }, [
    searchQuery,
    currentWorkspace,
    projectItems,
    coverMetaById,
    selectedCategory,
    selectedStatus,
    selectedSort,
    resolveProjectType,
    makeAvatarList,
  ])

  const projectCards = allProjectCards

  const currentParentProject = useMemo(() => {
    const currentId = normalizeProjectId(activeParentProjectId)
    return allProjectCards.find((item) => item.id === currentId) || null
  }, [activeParentProjectId, allProjectCards])

  const savedProjectCards = useMemo(() => {
    const parent = currentParentProject
    if (!parent) return []
    return projectVersions
      .map((item, index) => {
        const id = resolveVersionId(item)
        const title = resolveVersionLabel(item, `${parent.title} 保存项目`)
        const createdText =
          item?.created_at || item?.createdAt || item?.updated_at || item?.updatedAt || item?.restored_at || ''
        const versionNo = Number(item?.version_no || item?.versionNo || 0)
        return {
          id,
          title,
          versionNo: Number.isFinite(versionNo) && versionNo > 0 ? versionNo : index + 1,
          updatedText: formatRelativeTime(createdText),
          createdAt: getProjectTimestamp(item, ['created_at', 'createdAt', 'updated_at', 'updatedAt']),
          coverUrl: parent.coverUrl,
          memberCount: parent.memberCount,
          itemCount: parent.itemCount,
          avatars: parent.avatars,
          workspaceName: parent.workspaceName,
          raw: item,
        }
      })
      // 只保留视频保存的版本
      .filter((item) => item.id > 0 && String(item.raw?.label || '').startsWith('视频保存'))
      .sort((a, b) => b.createdAt - a.createdAt || b.id - a.id)
  }, [currentParentProject, projectVersions])

  const currentSavedProject = useMemo(() => {
    const currentId = normalizeProjectId(selectedSavedProjectId)
    return savedProjectCards.find((item) => item.id === currentId) || savedProjectCards[0] || null
  }, [selectedSavedProjectId, savedProjectCards])

  const loadProjectCovers = useCallback(async (items: any[], targetWorkspaceId: number) => {
    const ids = items.map((item) => Number(item?.id || 0)).filter((id) => Number.isFinite(id) && id > 0)
    if (!ids.length) {
      setCoverMetaById({})
      return
    }

    const nextMap: Record<number, any> = {}
    // 并行加载：项目详情（封面） + 版本列表（视频保存计数）
    const detailTasks = ids.map((projectId) =>
      Promise.all([
        getCreativeProject({ projectId, workspaceId: targetWorkspaceId }).catch(() => null),
        listCreativeProjectVersions({ projectId, workspaceId: targetWorkspaceId }).catch(() => []),
      ]).then(([project, versions]) => ({
        projectId,
        project,
        versions: normalizeCreativeProjectVersions(versions),
      })),
    )

    const details = await Promise.all(detailTasks)
    if (Number(workspaceIdRef.current || 0) !== targetWorkspaceId) return

    for (const result of details) {
      if (!result?.projectId) continue
      const project = result.project
      const draft = normalizeCreativeProjectDraft(project || {})
      const candidate = resolveCoverCandidateFromDraft(draft || {})
      const storyboardCount = countGeneratedStoryboardImages(draft || {})
      // 优先用 assetId 获取新的签名 URL，避免使用草稿中已过期的预签名 URL
      let coverUrl = ''
      if (candidate.assetId) {
        coverUrl = await getAssetDownloadUrl({ workspaceId: targetWorkspaceId, assetId: candidate.assetId }).catch(
          () => '',
        )
        if (Number(workspaceIdRef.current || 0) !== targetWorkspaceId) return
      }
      // 降级1：用草稿中保存的原始 URL（可能已过期但聊胜于无）
      if (!coverUrl) {
        coverUrl = candidate.url
      }
      // 降级2：尝试直接用草稿中的视频 URL
      if (!coverUrl) {
        const videoUrl = draft?.generatedVideoUrl || draft?.generated_video_url || ''
        if (videoUrl) coverUrl = videoUrl
      }
      // 统计该项目的视频保存次数
      const videoSaveCount = result.versions.filter((v: any) => {
        const label = v?.label || ''
        return label.startsWith('视频保存')
      }).length
      nextMap[result.projectId] = {
        url: coverUrl,
        storyboardCount,
        videoSaveCount,
        flow: String(draft?.flow || ''), // 'smart' → 智能成片项目,打开走 /smart/:id
      }
    }

    setCoverMetaById(nextMap)
  }, [])

  const loadWorkspaceMemberAvatars = useCallback(async (targetWorkspaceId: number) => {
    if (!targetWorkspaceId) {
      setWorkspaceMembers([])
      return
    }

    try {
      const result = await listWorkspaceMembers(targetWorkspaceId)
      if (Number(workspaceIdRef.current || 0) !== targetWorkspaceId) return
      setWorkspaceMembers(normalizeWorkspaceMembers(result))
    } catch {
      if (Number(workspaceIdRef.current || 0) === targetWorkspaceId) {
        setWorkspaceMembers([])
      }
    }
  }, [])

  const loadProjects = useCallback(async () => {
    const currentWorkspaceId = Number(workspaceIdRef.current || 0)
    if (!currentWorkspaceId) {
      setProjectItems([])
      setCoverMetaById({})
      setWorkspaceMembers([])
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const items = await listCreativeProjects({ workspaceId: currentWorkspaceId, limit: 24 })
      if (Number(workspaceIdRef.current || 0) !== currentWorkspaceId) return
      const sorted = items.slice().sort((a: any, b: any) =>
        getProjectTimestamp(b, ['updated_at', 'updatedAt', 'created_at']) -
        getProjectTimestamp(a, ['updated_at', 'updatedAt', 'created_at']),
      )
      setProjectItems(sorted)
      await Promise.all([
        loadProjectCovers(sorted, currentWorkspaceId),
        loadWorkspaceMemberAvatars(currentWorkspaceId),
      ])
    } catch {
      if (Number(workspaceIdRef.current || 0) === currentWorkspaceId) {
        setProjectItems([])
        setCoverMetaById({})
        setWorkspaceMembers([])
        showToast('项目列表加载失败，请稍后重试', 'error')
      }
    } finally {
      if (Number(workspaceIdRef.current || 0) === currentWorkspaceId) {
        setLoading(false)
      }
    }
  }, [loadProjectCovers, loadWorkspaceMemberAvatars, showToast])

  const goBackToProjectList = useCallback(() => {
    setViewMode('root')
    setActiveParentProjectId(0)
    setSelectedSavedProjectId(0)
    setProjectVersions([])
    setVersionsLoading(false)
  }, [])

  // watch(workspaceId, { immediate: true }) → 工作空间变化时重新加载
  useEffect(() => {
    loadProjects()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  function toggleCategoryMenu() {
    setCategoryMenuOpen((v) => !v)
  }

  function selectCategory(value: string) {
    setSelectedCategory(value)
    setCategoryMenuOpen(false)
  }

  // onMounted/onBeforeUnmount：全局点击关闭菜单
  useEffect(() => {
    function handleDocumentClick(event: MouseEvent) {
      const target = event.target as HTMLElement
      if (categoryMenuOpen && !categoryMenuRef.current?.contains(target)) {
        setCategoryMenuOpen(false)
      }
      if (openMenuId && !target.closest('.pm-card-more')) {
        setOpenMenuId(0)
      }
    }
    document.addEventListener('click', handleDocumentClick)
    return () => document.removeEventListener('click', handleDocumentClick)
  }, [categoryMenuOpen, openMenuId])

  // watch(allProjectCards) → 卡片列表变化时维护子视图状态
  useEffect(() => {
    const cards = allProjectCards
    if (!cards.length && viewMode === 'children') {
      goBackToProjectList()
      return
    }
    const currentId = normalizeProjectId(activeParentProjectId)
    if (viewMode === 'children' && currentId && !cards.some((item) => item.id === currentId)) {
      goBackToProjectList()
    }
  }, [allProjectCards, viewMode, activeParentProjectId, goBackToProjectList])

  // watch(savedProjectCards) → 同步默认选中项
  useEffect(() => {
    const cards = savedProjectCards
    if (!cards.length) {
      setSelectedSavedProjectId(0)
      return
    }
    const currentId = normalizeProjectId(selectedSavedProjectId)
    if (!cards.some((item) => item.id === currentId)) {
      setSelectedSavedProjectId(cards[0].id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedProjectCards])

  async function openProjectVersions(project: any) {
    if (!project?.id) return
    const wsId = Number(workspaceId || 0)
    if (!wsId) {
      showToast('workspace_id 缺失，无法加载保存项目', 'error')
      return
    }
    setActiveParentProjectId(project.id)
    setSelectedSavedProjectId(0)
    setProjectVersions([])
    setViewMode('children')
    setVersionsLoading(true)
    try {
      const payload = await listCreativeProjectVersions({
        projectId: project.id,
        workspaceId: wsId,
        limit: 100,
      })
      // activeParentProjectId 可能已被切换，借助闭包内捕获的 project.id 判断
      setProjectVersions(normalizeCreativeProjectVersions(payload))
    } catch (error) {
      setProjectVersions([])
      showToast(getBusinessErrorMessage(error, '保存项目加载失败，请稍后重试'), 'error')
    } finally {
      setVersionsLoading(false)
    }
  }

  function selectSavedProject(versionId: number) {
    const nextId = resolveVersionId({ id: versionId })
    if (!nextId) return
    setSelectedSavedProjectId(nextId)
  }

  async function openSelectedSavedProject() {
    const parent = currentParentProject
    const selected = currentSavedProject
    const wsId = Number(workspaceId || 0)
    if (!parent?.id || !selected?.id || !wsId || openingVersion) return
    const confirmed = window.confirm(`打开「${selected.title}」会先恢复它到当前项目，是否继续？`)
    if (!confirmed) return
    setOpeningVersion(true)
    try {
      await restoreCreativeProjectVersion({
        projectId: parent.id,
        workspaceId: wsId,
        vid: selected.id,
      })
      navigate(parent.flow === 'smart' ? `/smart/${parent.id}` : `/creative/${parent.id}`)
    } catch (error) {
      showToast(getBusinessErrorMessage(error, '打开保存项目失败，请稍后重试'), 'error')
    } finally {
      setOpeningVersion(false)
    }
  }

  function openParentProjectDirectly() {
    const parent = currentParentProject
    if (!parent?.id) return
    navigate(parent.flow === 'smart' ? `/smart/${parent.id}` : `/creative/${parent.id}`)
  }

  async function resolveVideoUrlFromVersion(project: any): Promise<string | null> {
    const parent = currentParentProject
    if (!parent?.id) return null

    const wsId = Number(workspaceId || 0)
    if (!wsId) {
      showToast('workspace_id 缺失', 'error')
      return null
    }

    try {
      const detail = await getCreativeProjectVersion({
        projectId: parent.id,
        versionId: project.id,
        vid: project.id,
        workspaceId: wsId,
      })

      const raw = toPlainObject(detail) ?? detail
      const versionObj =
        (raw?.version && typeof raw.version === 'object'
          ? raw.version
          : raw?.data?.version && typeof raw.data.version === 'object'
            ? raw.data.version
            : raw?.data && typeof raw.data === 'object'
              ? raw.data
              : raw && typeof raw === 'object'
                ? raw
                : {}) || {}

      const draft =
        normalizeCreativeProjectDraft(versionObj) ||
        normalizeCreativeProjectDraft(raw) ||
        toPlainObject(versionObj?.snapshot_json) ||
        toPlainObject(versionObj?.snapshotJson) ||
        null

      if (!draft) return null

      let url = String(draft.generatedVideoUrl || '')
      const assetId = Number(draft.generatedVideoAssetId || 0)
      // 签名 URL 会过期，只要有 assetId 就优先获取新签名地址
      if (assetId > 0) {
        try {
          const freshUrl = await getAssetDownloadUrl({ workspaceId: wsId, assetId })
          if (freshUrl) url = freshUrl
        } catch { /* 降级使用原 URL */ }
      }

      return url || null
    } catch {
      return null
    }
  }

  async function previewSavedVideo(project: any) {
    if (videoPreviewLoading) return

    setVideoPreviewLoading(true)
    setVideoPreviewTitle(project.title || '视频预览')
    setVideoPreviewUrl('')

    const url = await resolveVideoUrlFromVersion(project)
    if (!url) {
      setVideoPreviewLoading(false)
      showToast('该版本中没有已保存的视频', 'info')
      return
    }

    setVideoPreviewUrl(url)
    setVideoPreviewOpen(true)
    setVideoPreviewLoading(false)
  }

  async function downloadSavedVideo(project: any) {
    const date = new Date()
    const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
    const safeName = String(project.title || '视频').replace(/[\\/:*?"<>|]/g, '').trim() || '视频'
    const fileName = `${safeName}_${dateStr}.mp4`

    // 先弹出另存为对话框（必须在用户手势内调用）
    let fileHandle: any = null
    if ((window as any).showSaveFilePicker) {
      try {
        fileHandle = await (window as any).showSaveFilePicker({
          suggestedName: fileName,
          types: [{ description: 'MP4 视频', accept: { 'video/mp4': ['.mp4'] } }],
        })
      } catch (err: any) {
        if (err?.name === 'AbortError') return // 用户取消
      }
    }

    // 再获取视频数据
    const url = await resolveVideoUrlFromVersion(project)
    if (!url) {
      showToast('没有可下载的视频', 'error')
      return
    }

    // 判断是否可 fetch（同源或支持 CORS 的 CDN）
    const isSameOrigin = (() => {
      try { return new URL(url, window.location.href).origin === window.location.origin } catch { return false }
    })()

    // 路径1：同源 + 用户已选文件夹 → fetch + 直接写入
    if (fileHandle && isSameOrigin) {
      try {
        showToast('视频下载中…', 'success')
        const response = await fetch(url)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const blob = new Blob([await response.blob()], { type: 'video/mp4' })
        const writable = await fileHandle.createWritable()
        await writable.write(blob)
        await writable.close()
        showToast('视频已保存', 'success')
        return
      } catch (err: any) {
        if (err?.name === 'AbortError') return
      }
    }

    // 路径2：隐藏 iframe 触发下载（跨域 CDN 走这条路，不跳转页面）
    const iframe = document.createElement('iframe')
    iframe.style.display = 'none'
    iframe.src = url
    document.body.appendChild(iframe)
    setTimeout(() => document.body.removeChild(iframe), 3000)
    showToast('视频已开始下载', 'success')
  }

  function closeVideoPreview() {
    setVideoPreviewOpen(false)
    setVideoPreviewUrl('')
  }

  async function deleteSavedVersion(project: any) {
    if (deletingVersion) return
    const parent = currentParentProject
    if (!parent?.id) return

    const confirmed = await requestConfirm(`确定删除「${project.title}」吗？删除后不可恢复。`)
    if (!confirmed) return

    setDeletingVersion(true)
    try {
      const wsId = Number(workspaceId || 0)
      if (!wsId) {
        showToast('workspace_id 缺失，无法删除', 'error')
        return
      }

      await deleteCreativeProjectVersion({
        projectId: parent.id,
        versionId: project.id,
        vid: project.id,
        workspaceId: wsId,
      })

      // 从列表中移除
      setProjectVersions((prev) =>
        prev.filter((item) => {
          const vid = resolveVersionId(item)
          return vid !== project.id
        }),
      )

      if (selectedSavedProjectId === project.id) {
        setSelectedSavedProjectId(0)
      }

      showToast('已删除', 'success')
    } catch (error) {
      showToast(getBusinessErrorMessage(error, '删除失败，请稍后重试'), 'error')
    } finally {
      setDeletingVersion(false)
    }
  }

  function toggleProjectMenu(projectId: number) {
    setOpenMenuId((prev) => (prev === projectId ? 0 : projectId))
  }

  async function deleteProject(project: any) {
    if (deletingProjectId) return

    const confirmed = await requestConfirm(`确定删除项目「${project.title}」吗？项目内的所有版本和草稿将被一并删除，不可恢复。`)
    if (!confirmed) return

    setDeletingProjectId(project.id)
    setOpenMenuId(0)
    try {
      const wsId = Number(workspaceId || 0)
      if (!wsId) {
        showToast('workspace_id 缺失，无法删除', 'error')
        return
      }
      await deleteCreativeProject({ projectId: project.id, workspaceId: wsId })
      setProjectItems((prev) => prev.filter((item) => Number(item?.id || 0) !== project.id))
      showToast('项目已删除', 'success')
    } catch (error) {
      showToast(getBusinessErrorMessage(error, '删除失败，请稍后重试'), 'error')
    } finally {
      setDeletingProjectId(0)
    }
  }

  function createProject() {
    navigate('/creative')
  }

  const cardsToRender = viewMode === 'root' ? projectCards : savedProjectCards

  return (
    <AppLayout activeNav="项目管理">
      <AppToast />

      <section className="pm-main" aria-label="项目管理">
        <header className="pm-header">
          <div className="pm-heading">
            <h1>项目管理</h1>
            <p>管理个人项目与团队协作项目</p>
          </div>

          <div className="pm-header-actions">
            <label className="pm-search" aria-label="搜索项目">
              <input
                value={searchQuery}
                type="text"
                placeholder="搜索项目名称、团队"
                onChange={(e) => setSearchQuery(e.target.value)}
                onBlur={(e) => setSearchQuery(e.target.value.trim())}
              />
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path
                  d="M13.9 13.9 18 18M8.75 15.5a6.75 6.75 0 1 1 0-13.5 6.75 6.75 0 0 1 0 13.5Z"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.8"
                />
              </svg>
            </label>
            <button type="button" className="pm-create-btn" onClick={createProject}>
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M4.5 5.5h3l1.2 1.5H15.5A1.5 1.5 0 0 1 17 8.5v6A1.5 1.5 0 0 1 15.5 16h-11A1.5 1.5 0 0 1 3 14.5v-7A1.5 1.5 0 0 1 4.5 6Z" />
              </svg>
              新建项目
            </button>
          </div>
        </header>

        <section className="pm-body">
          <div className="pm-filters">
            <div className="pm-filter-group">
              <div ref={categoryMenuRef} className="pm-filter-dropdown">
                <button
                  type="button"
                  className={`pm-filter-chip pm-inline-filter pm-filter-trigger${categoryMenuOpen ? ' active' : ''}`}
                  aria-label="项目类型"
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleCategoryMenu()
                  }}
                >
                  <span className="pm-filter-prefix">项目类型:</span>
                  <strong>{currentCategoryLabel}</strong>
                  <svg viewBox="0 0 12 12" aria-hidden="true">
                    <path d="m3 4.5 3 3 3-3" />
                  </svg>
                </button>

                {categoryMenuOpen && (
                  <div className="pm-filter-menu">
                    {categoryOptions.map((item) => (
                      <button
                        key={item.value}
                        type="button"
                        className={`pm-filter-menu-item${selectedCategory === item.value ? ' active' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          selectCategory(item.value)
                        }}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <label className="pm-filter-chip pm-inline-filter">
                <span className="pm-filter-prefix">项目状态:</span>
                <select
                  value={selectedStatus}
                  aria-label="项目状态"
                  onChange={(e) => setSelectedStatus(e.target.value)}
                >
                  {statusOptions.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
                <svg viewBox="0 0 12 12" aria-hidden="true">
                  <path d="m3 4.5 3 3 3-3" />
                </svg>
              </label>
            </div>

            <label className="pm-filter-chip pm-inline-filter pm-sort-chip">
              <span className="pm-filter-prefix">时间排序</span>
              <select value={selectedSort} aria-label="项目排序" onChange={(e) => setSelectedSort(e.target.value)}>
                {sortOptions.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
              <svg viewBox="0 0 12 12" aria-hidden="true">
                <path d="m3 4.5 3 3 3-3" />
              </svg>
            </label>
          </div>

          {viewMode === 'children' && (
            <div className="pm-subview-bar">
              <div className="pm-subview-copy">
                <button type="button" className="pm-subview-back" onClick={goBackToProjectList}>
                  <svg viewBox="0 0 12 12" aria-hidden="true">
                    <path d="M7.5 2.5 4 6l3.5 3.5" />
                  </svg>
                  返回全部项目
                </button>
                <div className="pm-subview-title-row">
                  <strong>{currentParentProject?.title || '未命名项目'}</strong>
                  <span>
                    {versionsLoading
                      ? '正在加载保存项目...'
                      : `这个项目里共有 ${savedProjectCards.length} 个保存项目`}
                  </span>
                </div>
              </div>

              <div className="pm-subview-actions">
                {savedProjectCards.length ? (
                  <button
                    type="button"
                    className="pm-open-btn"
                    disabled={openingVersion || !currentSavedProject}
                    onClick={openSelectedSavedProject}
                  >
                    {openingVersion ? '正在打开...' : '打开所选项目'}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="pm-open-btn ghost"
                    disabled={openingVersion}
                    onClick={openParentProjectDirectly}
                  >
                    直接打开当前项目
                  </button>
                )}
              </div>
            </div>
          )}

          <div className={`pm-grid${viewMode === 'children' ? ' is-children' : ''}`}>
            {viewMode === 'root' && loading ? (
              <div className="pm-empty">正在加载项目列表...</div>
            ) : viewMode === 'root' && !projectCards.length ? (
              <div className="pm-empty">暂无已保存视频的项目，生成视频后点击保存即可在此查看。</div>
            ) : viewMode === 'children' && versionsLoading ? (
              <div className="pm-empty">正在加载这个项目里的保存项目...</div>
            ) : viewMode === 'children' && !savedProjectCards.length ? (
              <div className="pm-empty">这个项目里还没有已保存的视频，生成视频后点击"保存视频"即可。</div>
            ) : (
              cardsToRender.map((project: any) => {
                const cardHighlighted =
                  viewMode === 'root' ? project.highlighted : currentSavedProject?.id === project.id
                return (
                  <article
                    key={project.id}
                    className={`pm-card${viewMode === 'children' ? ' pm-saved-card' : ''}${cardHighlighted ? ' highlighted' : ''}`}
                    onClick={() =>
                      viewMode === 'root' ? openProjectVersions(project) : selectSavedProject(project.id)
                    }
                    onDoubleClick={() => {
                      if (viewMode === 'children') previewSavedVideo(project)
                    }}
                  >
                    <div className={`pm-card-cover${project.coverUrl ? ' has-image' : ''}`}>
                      {project.coverUrl && <img src={project.coverUrl} alt="" loading="lazy" />}
                    </div>

                    <div className="pm-card-body">
                      <div className="pm-card-head">
                        <strong>{project.title}</strong>
                        {viewMode === 'children' ? (
                          <span className="pm-card-version-tag">保存 {project.versionNo}</span>
                        ) : (
                          <button
                            type="button"
                            className="pm-card-more"
                            aria-label="更多操作"
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleProjectMenu(project.id)
                            }}
                          >
                            <svg viewBox="0 0 20 20" aria-hidden="true">
                              <circle cx="4" cy="10" r="1.3" />
                              <circle cx="10" cy="10" r="1.3" />
                              <circle cx="16" cy="10" r="1.3" />
                            </svg>
                            {openMenuId === project.id && (
                              <div className="pm-card-menu" onClick={(e) => e.stopPropagation()}>
                                <button
                                  type="button"
                                  className="pm-card-menu-item is-danger"
                                  disabled={deletingProjectId === project.id}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    deleteProject(project)
                                  }}
                                >
                                  {deletingProjectId === project.id ? '删除中…' : '删除项目'}
                                </button>
                              </div>
                            )}
                          </button>
                        )}
                      </div>

                      {viewMode === 'root' && (
                        <div className="pm-card-meta">
                          <span className="pm-card-type">
                            <svg viewBox="0 0 16 16" aria-hidden="true">
                              <path
                                d="M8 8.25A2.75 2.75 0 1 0 8 2.75a2.75 2.75 0 0 0 0 5.5Zm0 1.5c-3.1 0-5.25 1.63-5.25 3.15 0 .39.31.7.7.7h9.1a.7.7 0 0 0 .7-.7c0-1.52-2.15-3.15-5.25-3.15Z"
                                fill="currentColor"
                              />
                            </svg>
                            {viewMode === 'root' ? project.typeLabel : '已保存项目'}
                          </span>
                          <span>{project.memberCount} 成员</span>
                          <span>{`${project.itemCount} 项目`}</span>
                        </div>
                      )}

                      {viewMode === 'children' ? (
                        <>
                          <div className="pm-saved-card-meta">
                            <span className="pm-saved-card-type">
                              <svg viewBox="0 0 16 16" aria-hidden="true">
                                <path
                                  d="M8 8.25A2.75 2.75 0 1 0 8 2.75a2.75 2.75 0 0 0 0 5.5Zm0 1.5c-3.1 0-5.25 1.63-5.25 3.15 0 .39.31.7.7.7h9.1a.7.7 0 0 0 .7-.7c0-1.52-2.15-3.15-5.25-3.15Z"
                                  fill="currentColor"
                                />
                              </svg>
                              已保存项目
                            </span>
                            <span>{project.updatedText}</span>
                          </div>
                          <p className="pm-saved-card-desc">
                            来自 {currentParentProject?.title || '当前项目'}，选择后即可打开这个保存项目继续编辑。
                          </p>
                          <div className="pm-saved-card-footer">
                            <div className="pm-card-avatars" aria-hidden="true">
                              {project.avatars.map((avatar: any, index: number) => (
                                <span key={`${project.id}-${index}`} className={`pm-avatar is-${avatar.tone}`}>
                                  {avatar.url ? (
                                    <img src={avatar.url} alt={avatar.name || '成员头像'} loading="lazy" />
                                  ) : (
                                    <span>{avatar.text}</span>
                                  )}
                                </span>
                              ))}
                            </div>
                            <button
                              type="button"
                              className="pm-video-preview-btn"
                              disabled={videoPreviewLoading}
                              onClick={(e) => {
                                e.stopPropagation()
                                previewSavedVideo(project)
                              }}
                            >
                              <svg viewBox="0 0 16 16" aria-hidden="true" width="14" height="14">
                                <path d="M4 3.5l9 4.5-9 4.5v-9z" fill="currentColor" />
                              </svg>
                              预览视频
                            </button>
                            <button
                              type="button"
                              className="pm-video-download-btn"
                              onClick={(e) => {
                                e.stopPropagation()
                                downloadSavedVideo(project)
                              }}
                            >
                              <svg viewBox="0 0 14 14" aria-hidden="true" width="12" height="12">
                                <path
                                  d="M2 10v1a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1M4 6l3 3 3-3M7 3v7"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.3"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                              下载
                            </button>
                            <button
                              type="button"
                              className="pm-video-delete-btn"
                              disabled={deletingVersion}
                              onClick={(e) => {
                                e.stopPropagation()
                                deleteSavedVersion(project)
                              }}
                            >
                              删除
                            </button>
                            <span className="pm-saved-card-choose">
                              {currentSavedProject?.id === project.id ? '已选中' : '点击选择'}
                            </span>
                          </div>
                        </>
                      ) : (
                        <div className="pm-card-footer">
                          <div className="pm-card-avatars" aria-hidden="true">
                            {project.avatars.map((avatar: any, index: number) => (
                              <span key={`${project.id}-${index}`} className={`pm-avatar is-${avatar.tone}`}>
                                {avatar.url ? (
                                  <img src={avatar.url} alt={avatar.name || '成员头像'} loading="lazy" />
                                ) : (
                                  <span>{avatar.text}</span>
                                )}
                              </span>
                            ))}
                          </div>
                          <span className="pm-card-updated">{project.updatedText}</span>
                        </div>
                      )}
                    </div>
                  </article>
                )
              })
            )}
          </div>
        </section>
      </section>

      {/* 视频预览弹窗（Teleport to body → React portal） */}
      {videoPreviewOpen &&
        createPortal(
          <div
            className="pm-video-overlay"
            onClick={(e) => {
              if (e.target === e.currentTarget) closeVideoPreview()
            }}
          >
            <div className="pm-video-modal">
              <div className="pm-video-modal-header">
                <span>{videoPreviewTitle}</span>
                <button type="button" className="pm-video-modal-close" aria-label="关闭" onClick={closeVideoPreview}>
                  <svg viewBox="0 0 14 14" aria-hidden="true" width="16" height="16">
                    <path d="M4 4l6 6M10 4l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              <div className="pm-video-modal-body">
                {videoPreviewUrl ? (
                  <video src={videoPreviewUrl} controls autoPlay playsInline />
                ) : (
                  <div className="pm-video-modal-loading">加载中...</div>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </AppLayout>
  )
}
