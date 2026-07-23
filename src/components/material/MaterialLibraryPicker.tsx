/**
 * MaterialLibraryPicker — 素材库文件夹选择器
 * 浏览素材项目的文件夹结构，选择素材添加到创意工作流，支持分页和搜索。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from 'antd'
import { getBusinessErrorMessage } from '@/api/business'
import { createInitializedProjectFolder } from '@/utils/creativeProjectInitialization'
import { useCurrentUser } from '@/stores/workspaceSession'
import { listAllCreativeProjects } from '@/utils/businessPagination'
import { isCreativeProjectRestrictedForUser, resolveUserId } from '@/utils/creativeDraftMetadata'
import { getMaterialPoster, isVideoMaterial } from '@/utils/materials'
import {
  collectCreativeProjectAssetIds,
  groupMaterialsByProject,
  resolveMaterialAssetId,
  resolveMaterialProjectId,
} from '@/utils/materialProjectFolders'
import { resolveCreativeProjectId } from '@/utils/projectAssetAccess'
import folderPurpleIcon from '@/img/595d866d18aa16996c24488624357662.png'
import folderGrayIcon from '@/img/a8f65f05b65174e6022127353290899a.png'
import actionCardVisual from '@/img/d35650818c74e6f9dd90befc870a0ec8.png'
import './MaterialLibraryPicker.css'

/** 素材选择器的受控筛选状态、候选素材与批量操作回调。 */
interface MaterialLibraryPickerProps {
  modelValue?: boolean
  workspaceId?: number
  projectName?: string
  materials: any[]
  selectedMaterialIds?: any[]
  tab?: string
  query?: string
  isLoading?: boolean
  isUploading?: boolean
  // 受控：弹窗开关
  onModelValueChange?: (visible: boolean) => void
  // 受控：tab / 搜索关键字
  onTabChange?: (tab: string) => void
  onQueryChange?: (query: string) => void
  // 事件回调
  onFilesUpload?: (files: FileList | File[]) => void
  onConfirm?: (picked: any[]) => void
  onBatchFavorite?: (payload: { ids: any[]; favorite: boolean }) => void
  onBatchDelete?: (ids: any[]) => void
}

/** 内部页签值到中文标题的映射。 */
const TAB_LABELS: Record<string, string> = {
  mine: '个人素材',
  team: '团队素材',
  favorite: '我的收藏',
}

/** 未提供收藏覆盖时复用的稳定空映射，避免每次渲染创建新引用。 */
const EMPTY_FAVORITE_OVERRIDES = new Map<string, boolean>()

/** 远端项目尚未加载时复用的稳定空数组。 */
const EMPTY_REMOTE_PROJECTS: any[] = []

// ===== 纯工具函数：不依赖组件状态，保证文件夹归类和排序可稳定复用。 =====
/** 解析素材创建时间，用于同一文件夹内的新旧排序。 */
function resolveTimestamp(material: any): number {
  const raw = material?.serverAsset?.created_at ?? material?.serverAsset?.createdAt ?? 0
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0
  if (typeof raw === 'string') {
    const ms = Date.parse(raw)
    return Number.isFinite(ms) ? ms : 0
  }
  return 0
}

/** 兼容本地视图模型与后端资产对象，读取稳定资产 ID。 */
function resolveMaterialId(material: any): number {
  return Number(material?.serverAsset?.id || material?.assetId || 0) || 0
}

/** 根据项目空间类型将文件夹归入个人或团队页签。 */
function resolveProjectFolderTab(project: any): string {
  const raw = String(project?.workspace_type || project?.type || '')
    .trim()
    .toLowerCase()
  if (raw.includes('team') || raw.includes('collab') || raw.includes('shared')) {
    return 'team'
  }
  return 'mine'
}

/** 读取项目文件夹标题，并为空标题提供可理解的回退文案。 */
function getProjectTitle(project: any, fallback = '未命名文件夹'): string {
  const title = String(project?.title || project?.name || '').trim()
  return title || fallback
}

/** 从多个后端时间字段中解析项目最近更新时间。 */
function getProjectUpdatedAt(project: any): number {
  const raw = [
    project?.updated_at,
    project?.updatedAt,
    project?.last_saved_at,
    project?.created_at,
    project?.createdAt,
  ].find((value) => typeof value === 'string' && value.trim())
  const timestamp = Date.parse(raw || '')
  return Number.isFinite(timestamp) ? timestamp : Date.now()
}

/** 将后端数量字段安全转换为非负整数。 */
function toCount(value: any): number {
  const num = Number(value || 0)
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : 0
}

/** 优先使用项目聚合字段，缺失时按已加载素材统计图片数量。 */
function resolveProjectImageCount(project: any, materials: any[]): number {
  const backendCount = [
    project?.image_count,
    project?.imageCount,
    project?.storyboard_count,
    project?.storyboardCount,
    project?.asset_image_count,
    project?.assetImageCount,
  ]
    .map((value) => toCount(value))
    .find((value) => value > 0)
  if (backendCount) return backendCount
  return materials.filter((item) => item?.type === 'image' || !isVideoMaterial(item)).length
}

/** 优先使用项目聚合字段，缺失时按已加载素材统计视频数量。 */
function resolveProjectVideoCount(project: any, materials: any[]): number {
  const backendCount = [
    project?.video_count,
    project?.videoCount,
    project?.asset_video_count,
    project?.assetVideoCount,
    project?.version_count,
    project?.versionCount,
  ]
    .map((value) => toCount(value))
    .find((value) => value > 0)
  if (backendCount) return backendCount
  return materials.filter((item) => isVideoMaterial(item)).length
}

/** 读取项目音频数量；当前素材视图未携带音频明细，因此不做本地反推。 */
function resolveProjectAudioCount(project: any): number {
  const backendCount = [project?.audio_count, project?.audioCount, project?.asset_audio_count, project?.assetAudioCount]
    .map((value) => toCount(value))
    .find((value) => value > 0)
  return backendCount || 0
}

/** 按时间、资产 ID、名称依次降序/稳定排序素材，保证刷新后顺序不跳动。 */
function sortMaterialList(list: any[]): any[] {
  return [...list].sort((a, b) => {
    const at = resolveTimestamp(a)
    const bt = resolveTimestamp(b)
    if (at !== bt) return bt - at
    const aid = resolveMaterialId(a)
    const bid = resolveMaterialId(b)
    if (aid !== bid) return bid - aid
    return String(a?.name || '').localeCompare(String(b?.name || ''))
  })
}

/** 取文件夹首个素材作为封面，视频优先使用海报帧。 */
function getFolderCover(materials: any[]): string {
  const first = materials[0]
  if (!first) return ''
  return isVideoMaterial(first)
    ? getMaterialPoster(first) || first?.src || ''
    : first?.src || getMaterialPoster(first) || ''
}

/** 将文件夹更新时间格式化为年月日，无有效时间时显示即时更新。 */
function formatFolderDate(ts: number): string {
  const ms = Number(ts || 0)
  if (!ms) return '刚刚更新'
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return '刚刚更新'
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** 加载可访问项目并按文件夹展示素材，维护临时勾选状态后一次性确认给父流程。 */
export default function MaterialLibraryPicker({
  modelValue = false,
  workspaceId = 0,
  projectName = '',
  materials,
  selectedMaterialIds = [],
  tab = 'mine',
  query = '',
  isLoading = false,
  isUploading: _isUploading = false,
  onModelValueChange,
  onTabChange,
  onQueryChange,
  onFilesUpload,
  onConfirm,
  onBatchFavorite,
  onBatchDelete,
}: MaterialLibraryPickerProps) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [draftSelectedIds, setDraftSelectedIds] = useState<any[]>([])
  const [assetTypeFilter, setAssetTypeFilter] = useState('all')
  const [timeSort, setTimeSort] = useState('desc')
  const [onlyFavorite, setOnlyFavorite] = useState(false)
  const [batchMode, setBatchMode] = useState(false)
  const [favoriteOverrideState, setFavoriteOverrideState] = useState<{
    storageKey: string
    values: Map<string, boolean>
  }>({ storageKey: '', values: new Map() })
  const [starPulseIds, setStarPulseIds] = useState<Set<any>>(new Set())
  const [viewMode, setViewMode] = useState<'folder' | 'material'>('folder')
  const [selectedFolderId, setSelectedFolderId] = useState('')
  const [activeFolderId, setActiveFolderId] = useState('')
  const [remoteProjectState, setRemoteProjectState] = useState<{
    workspaceId: number
    userId: number
    tab: string
    items: any[]
    restrictedProjectIds: number[]
    restrictedAssetIds: number[]
    accessLoaded: boolean
  }>({
    workspaceId: 0,
    userId: 0,
    tab: '',
    items: [],
    restrictedProjectIds: [],
    restrictedAssetIds: [],
    accessLoaded: false,
  })
  const [folderLoading, setFolderLoading] = useState(false)
  const [actionPulse, setActionPulse] = useState(false)

  const currentUser = useCurrentUser()
  const currentUserId = resolveUserId(currentUser)
  const currentUserStorageScope = String(
    currentUser?.id ??
      currentUser?.user_id ??
      currentUser?.userId ??
      currentUser?.account_id ??
      currentUser?.accountId ??
      currentUser?.uid ??
      '',
  ).trim()
  const favoriteStorageKey = useMemo(
    () =>
      `mlp-favorites-user-${encodeURIComponent(currentUserStorageScope || 'anon')}-workspace-${String(workspaceId || 0)}`,
    [currentUserStorageScope, workspaceId],
  )
  const currentScopeRef = useRef({
    modelValue,
    tab,
    workspaceId: Number(workspaceId || 0),
    userId: currentUserId,
  })
  currentScopeRef.current = {
    modelValue,
    tab,
    workspaceId: Number(workspaceId || 0),
    userId: currentUserId,
  }
  const projectRequestIdRef = useRef(0)
  const remoteProjects =
    remoteProjectState.workspaceId === Number(workspaceId || 0) &&
    remoteProjectState.tab === tab &&
    remoteProjectState.userId === currentUserId
      ? remoteProjectState.items
      : EMPTY_REMOTE_PROJECTS
  const projectAccessStateMatches =
    remoteProjectState.workspaceId === Number(workspaceId || 0) &&
    remoteProjectState.tab === tab &&
    remoteProjectState.userId === currentUserId
  const favoriteOverrides = useMemo(
    () =>
      favoriteOverrideState.storageKey === favoriteStorageKey ? favoriteOverrideState.values : EMPTY_FAVORITE_OVERRIDES,
    [favoriteOverrideState, favoriteStorageKey],
  )

  function loadFavoriteOverridesFromStorage(storageKey: string): Map<string, boolean> {
    if (typeof window === 'undefined') return new Map()
    try {
      const raw = window.localStorage.getItem(storageKey)
      if (!raw) return new Map()
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object') return new Map()
      return new Map(Object.entries(parsed).map(([id, value]) => [id, Boolean(value)]))
    } catch {
      return new Map()
    }
  }

  function persistFavoriteOverridesToStorage(storageKey: string, map: Map<string, boolean>) {
    if (typeof window === 'undefined') return
    try {
      const obj = Object.fromEntries(map.entries())
      window.localStorage.setItem(storageKey, JSON.stringify(obj))
    } catch {
      // localStorage 不可用（隐私模式/配额）时静默跳过，收藏覆盖不落盘即可。
    }
  }

  function setScopedFavoriteOverrides(map: Map<string, boolean>) {
    setFavoriteOverrideState({ storageKey: favoriteStorageKey, values: map })
    persistFavoriteOverridesToStorage(favoriteStorageKey, map)
  }

  function isCurrentProjectRequest(requestId: number, wsId: number, targetTab: string, userId: number): boolean {
    const current = currentScopeRef.current
    return (
      projectRequestIdRef.current === requestId &&
      current.modelValue &&
      current.workspaceId === wsId &&
      current.tab === targetTab &&
      current.userId === userId
    )
  }

  async function loadRemoteProjects(wsId: number, targetTab: string) {
    const current = currentScopeRef.current
    if (!current.modelValue || current.workspaceId !== wsId || current.tab !== targetTab) return
    const targetUserId = current.userId

    const requestId = ++projectRequestIdRef.current
    setRemoteProjectState({
      workspaceId: wsId,
      userId: targetUserId,
      tab: targetTab,
      items: [],
      restrictedProjectIds: [],
      restrictedAssetIds: [],
      accessLoaded: false,
    })
    if (!Number.isFinite(wsId) || wsId <= 0) {
      setFolderLoading(false)
      return
    }
    setFolderLoading(true)
    try {
      const items = await listAllCreativeProjects({
        workspaceId: wsId,
        isCurrent: () => isCurrentProjectRequest(requestId, wsId, targetTab, targetUserId),
      })
      if (!isCurrentProjectRequest(requestId, wsId, targetTab, targetUserId)) return
      const allProjects = Array.isArray(items) ? items : []
      const restrictedProjects = allProjects.filter((project) =>
        isCreativeProjectRestrictedForUser(project, targetUserId),
      )
      setRemoteProjectState({
        workspaceId: wsId,
        userId: targetUserId,
        tab: targetTab,
        items: allProjects.filter((project) => !isCreativeProjectRestrictedForUser(project, targetUserId)),
        restrictedProjectIds: restrictedProjects.map(resolveCreativeProjectId).filter((projectId) => projectId > 0),
        restrictedAssetIds: Array.from(
          new Set(restrictedProjects.flatMap((project) => Array.from(collectCreativeProjectAssetIds(project)))),
        ),
        accessLoaded: true,
      })
    } catch (error) {
      if (isCurrentProjectRequest(requestId, wsId, targetTab, targetUserId)) {
        // 项目权限是素材可见性的权威来源；权限加载失败时从严隐藏，而不是回退全部素材导致越权泄露。
        setRemoteProjectState({
          workspaceId: wsId,
          userId: targetUserId,
          tab: targetTab,
          items: [],
          restrictedProjectIds: [],
          restrictedAssetIds: [],
          accessLoaded: false,
        })
        window.alert(getBusinessErrorMessage(error, '文件夹列表加载失败，请稍后重试'))
      }
    } finally {
      if (isCurrentProjectRequest(requestId, wsId, targetTab, targetUserId)) {
        setFolderLoading(false)
      }
    }
  }

  // 弹窗打开时重置内部状态并加载文件夹列表。
  useEffect(() => {
    if (!modelValue) return
    setDraftSelectedIds([])
    setAssetTypeFilter('all')
    setTimeSort('desc')
    setOnlyFavorite(false)
    setBatchMode(false)
    setViewMode('folder')
    setSelectedFolderId('')
    setActiveFolderId('')
  }, [modelValue])

  // tab / workspaceId 变化时立即隔离旧状态，并只接收当前作用域的异步结果。
  useEffect(() => {
    const wsId = Number(workspaceId || 0)
    projectRequestIdRef.current += 1
    setRemoteProjectState({
      workspaceId: wsId,
      userId: currentUserId,
      tab,
      items: [],
      restrictedProjectIds: [],
      restrictedAssetIds: [],
      accessLoaded: false,
    })
    setFavoriteOverrideState({
      storageKey: favoriteStorageKey,
      values: loadFavoriteOverridesFromStorage(favoriteStorageKey),
    })
    setViewMode('folder')
    setSelectedFolderId('')
    setActiveFolderId('')
    setDraftSelectedIds([])
    setStarPulseIds(new Set())
    if (!modelValue) {
      setFolderLoading(false)
      return
    }
    void loadRemoteProjects(wsId, tab)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId, favoriteStorageKey, modelValue, tab, workspaceId])

  const selectedIdSet = useMemo(() => new Set(draftSelectedIds), [draftSelectedIds])
  const alreadySelectedSet = useMemo(() => new Set(selectedMaterialIds || []), [selectedMaterialIds])
  const materialIndex = useMemo(() => new Map((materials || []).map((item) => [item?.id, item])), [materials])

  const normalizedQuery = useMemo(() => (query || '').trim().toLowerCase(), [query])

  function isFavorited(material: any): boolean {
    if (!material?.id) return false
    if (favoriteOverrides.has(String(material.id))) {
      return Boolean(favoriteOverrides.get(String(material.id)))
    }
    return Boolean(material?.favorite || material?.serverAsset?.is_favorite)
  }

  const currentTabLabel = TAB_LABELS[tab] || '个人素材'

  const scopedMaterials = useMemo(() => {
    if (!projectAccessStateMatches || !remoteProjectState.accessLoaded) return []
    const restrictedProjectIds = new Set(remoteProjectState.restrictedProjectIds)
    const restrictedAssetIds = new Set(remoteProjectState.restrictedAssetIds)
    const list = (materials || []).filter((material) => {
      const projectId = resolveMaterialProjectId(material)
      if (projectId && restrictedProjectIds.has(projectId)) return false
      const assetId = resolveMaterialAssetId(material)
      return !assetId || !restrictedAssetIds.has(assetId)
    })
    if (tab === 'favorite') {
      return list.filter((material) => isFavorited(material))
    }
    if (tab === 'team') {
      const teamMaterials = list.filter((material) => {
        const scope = String(
          material?.scope || material?.serverAsset?.scope || material?.serverAsset?.source || '',
        ).toLowerCase()
        return scope.includes('team') || scope.includes('workspace') || scope.includes('shared')
      })
      return teamMaterials
    }
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [favoriteOverrides, materials, projectAccessStateMatches, remoteProjectState, tab])

  const folderSeeds = useMemo(() => {
    return (remoteProjects || [])
      .filter((item) => resolveProjectFolderTab(item) === tab)
      .map((item) => ({
        id: item?.id,
        projectId: Number(item?.id || 0),
        tab: resolveProjectFolderTab(item),
        title: getProjectTitle(item),
        updatedAt: getProjectUpdatedAt(item),
        raw: item,
      }))
  }, [remoteProjects, tab])

  const folderCards = useMemo(() => {
    const source = sortMaterialList(scopedMaterials)
    const activeSeeds = folderSeeds
    if (!activeSeeds.length) {
      if (!source.length) return []
      return [
        {
          id: `${tab}-all-materials`,
          projectId: 0,
          title: '全部素材',
          updatedAt: Date.now(),
          updatedText: '当前空间',
          materials: source,
          imageCount: resolveProjectImageCount(null, source),
          videoCount: resolveProjectVideoCount(null, source),
          audioCount: 0,
          totalCount: source.length,
          cover: getFolderCover(source),
        },
      ]
    }

    const grouped = groupMaterialsByProject(
      source,
      activeSeeds.map((seed) => seed.raw ?? seed),
    )
    const materialsByProjectId = new Map(grouped.groups.map((group) => [group.projectId, group.materials]))
    const cards = activeSeeds.map((seed, index) => {
      const folderMaterials = materialsByProjectId.get(Number(seed.projectId || 0)) || []
      const imageCount = resolveProjectImageCount(seed?.raw, folderMaterials)
      const videoCount = resolveProjectVideoCount(seed?.raw, folderMaterials)
      return {
        id: seed.id || `${tab}-folder-${index + 1}`,
        projectId: Number(seed?.projectId || 0),
        title: seed.title || `素材文件夹 ${index + 1}`,
        updatedAt: Number(seed.updatedAt || Date.now()),
        updatedText: formatFolderDate(seed.updatedAt),
        materials: folderMaterials,
        imageCount,
        videoCount,
        audioCount: resolveProjectAudioCount(seed?.raw ?? seed),
        totalCount: folderMaterials.length,
        cover: getFolderCover(folderMaterials),
      }
    })

    if (grouped.unclassified.length) {
      const unclassified = sortMaterialList(grouped.unclassified)
      cards.push({
        id: `${tab}-unclassified`,
        projectId: 0,
        title: '未归类素材',
        updatedAt: Date.now(),
        updatedText: '未关联项目',
        materials: unclassified,
        imageCount: resolveProjectImageCount(null, unclassified),
        videoCount: resolveProjectVideoCount(null, unclassified),
        audioCount: 0,
        totalCount: unclassified.length,
        cover: getFolderCover(unclassified),
      })
    }
    return cards
  }, [scopedMaterials, folderSeeds, tab])

  const visibleFolders = useMemo(() => {
    const q = normalizedQuery
    if (!q) return folderCards
    return folderCards.filter((folder) =>
      String(folder?.title || '')
        .toLowerCase()
        .includes(q),
    )
  }, [folderCards, normalizedQuery])

  const currentFolder = useMemo(
    () => folderCards.find((item) => item.id === selectedFolderId) || null,
    [folderCards, selectedFolderId],
  )

  const headerTitle = useMemo(() => {
    if (viewMode === 'material' && currentFolder) {
      return `${currentTabLabel} / ${currentFolder.title}`
    }
    const baseProjectName = String(projectName || '当前创意项目').trim() || '当前创意项目'
    return `全部项目 / ${baseProjectName}`
  }, [viewMode, currentFolder, currentTabLabel, projectName])
  // headerTitle 在原模板未直接展示，但保留派生逻辑以忠实迁移。
  void headerTitle

  const searchPlaceholder = viewMode === 'folder' ? '搜索项目名称' : '搜索素材名称'

  function pulseStar(materialId: any) {
    if (!materialId) return
    setStarPulseIds((prev) => {
      const next = new Set(prev)
      next.add(materialId)
      return next
    })
    window.setTimeout(() => {
      setStarPulseIds((prev) => {
        const after = new Set(prev)
        after.delete(materialId)
        return after
      })
    }, 320)
  }

  function toggleFavorite(material: any) {
    if (!material?.id || !onBatchFavorite) return
    const prev = isFavorited(material)
    const next = !prev
    const map = new Map(favoriteOverrides)
    // 键统一用 String:落盘经 JSON 后键必为字符串,读回(Object.entries)也是字符串;
    // set 若用数字键则重载后 has(数字) 命中不了字符串键 → 收藏每次重置。
    map.set(String(material.id), next)
    setScopedFavoriteOverrides(map)
    pulseStar(material.id)
    onBatchFavorite({ ids: [material.id], favorite: next })
  }

  const filteredMaterials = useMemo(() => {
    const q = normalizedQuery
    const list = currentFolder?.materials || []
    const typed = assetTypeFilter === 'all' ? list : list.filter((material) => material?.type === assetTypeFilter)
    const favorited = onlyFavorite ? typed.filter((material) => isFavorited(material)) : typed
    const searched = q ? favorited.filter((material) => (material?.name || '').toLowerCase().includes(q)) : favorited
    const sorted = [...searched].sort((a, b) => {
      const at = resolveTimestamp(a)
      const bt = resolveTimestamp(b)
      if (at !== bt) {
        return timeSort === 'asc' ? at - bt : bt - at
      }
      const aid = resolveMaterialId(a)
      const bid = resolveMaterialId(b)
      if (aid !== bid) {
        return timeSort === 'asc' ? aid - bid : bid - aid
      }
      const an = String(a?.name || '')
      const bn = String(b?.name || '')
      return timeSort === 'asc' ? an.localeCompare(bn) : bn.localeCompare(an)
    })
    return sorted
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFolder, assetTypeFilter, onlyFavorite, normalizedQuery, timeSort, favoriteOverrides])

  function toggleDraft(material: any) {
    if (!material?.id) return
    const id = material.id
    if (selectedIdSet.has(id)) {
      setDraftSelectedIds((prev) => prev.filter((item) => item !== id))
      return
    }
    setDraftSelectedIds((prev) => [...prev, id])
  }

  const canConfirm = draftSelectedIds.length > 0
  const selectedCount = draftSelectedIds.length
  const allSelectableIds = useMemo(
    () => (filteredMaterials || []).map((item) => item.id).filter(Boolean),
    [filteredMaterials],
  )
  const allSelected = useMemo(() => {
    const ids = allSelectableIds
    if (!ids.length) return false
    return ids.every((id) => selectedIdSet.has(id))
  }, [allSelectableIds, selectedIdSet])
  const selectedMaterialsList = useMemo(
    () => filteredMaterials.filter((material) => selectedIdSet.has(material.id)),
    [filteredMaterials, selectedIdSet],
  )
  const selectedAllFavorited = useMemo(() => {
    if (!selectedMaterialsList.length) return false
    return selectedMaterialsList.every((material) => isFavorited(material))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMaterialsList, favoriteOverrides])

  function addDraftMaterials() {
    if (!canConfirm) return
    const picked = draftSelectedIds.map((id) => materialIndex.get(id)).filter(Boolean)
    if (!picked.length) return
    onConfirm?.(picked)
    onModelValueChange?.(false)
  }

  function clearSelection() {
    setDraftSelectedIds([])
  }

  function toggleSelectAll() {
    if (!allSelectableIds.length) return
    if (allSelected) {
      clearSelection()
      return
    }
    setDraftSelectedIds([...allSelectableIds])
  }

  function pulseAction() {
    setActionPulse(true)
    window.setTimeout(() => {
      setActionPulse(false)
    }, 260)
  }

  function toggleSelectedFavorites() {
    if (!selectedCount || !onBatchFavorite) return

    const prev = selectedAllFavorited
    const next = !prev
    const map = new Map(favoriteOverrides)
    const mats = selectedMaterialsList

    for (const material of mats) {
      if (material?.id) {
        map.set(String(material.id), next)
      }
    }

    setScopedFavoriteOverrides(map)
    pulseAction()

    onBatchFavorite({ ids: [...draftSelectedIds], favorite: next })
  }

  function deleteSelected() {
    if (!selectedCount || !onBatchDelete) return
    const ids = [...draftSelectedIds]
    if (!ids.length) return
    onBatchDelete(ids)
    clearSelection()
  }

  function triggerUpload() {
    if (!onFilesUpload) return
    fileInput.current?.click()
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    if (onFilesUpload) onFilesUpload(event.target.files || [])
    event.target.value = ''
  }

  function switchTab(t: string) {
    if (t === tab) return
    onTabChange?.(t)
    onQueryChange?.('')
  }

  function openFolder(folder: any) {
    if (!folder?.id) return
    setActiveFolderId(folder.id)
    setSelectedFolderId(folder.id)
    setViewMode('material')
    setDraftSelectedIds([])
    setBatchMode(false)
  }

  function selectFolder(folder: any) {
    if (!folder?.id) return
    setActiveFolderId(folder.id)
  }

  function goBackToFolders() {
    setViewMode('folder')
    setSelectedFolderId('')
    setActiveFolderId('')
    setDraftSelectedIds([])
    setBatchMode(false)
  }

  function createFolder() {
    const title = tab === 'favorite' ? '新建收藏文件夹' : tab === 'team' ? '新建团队文件夹' : '新建项目文件夹'
    const wsId = Number(workspaceId || 0)
    const targetTab = tab
    if (!Number.isFinite(wsId) || wsId <= 0) {
      window.alert('workspace_id 缺失，无法创建文件夹')
      return
    }
    createInitializedProjectFolder({ workspaceId: wsId, title })
      .then(() => {
        const current = currentScopeRef.current
        if (current.modelValue && current.workspaceId === wsId && current.tab === targetTab) {
          void loadRemoteProjects(wsId, targetTab)
        }
      })
      .catch((error: any) => {
        const current = currentScopeRef.current
        if (current.modelValue && current.workspaceId === wsId && current.tab === targetTab) {
          window.alert(getBusinessErrorMessage(error, '新建文件夹失败，请稍后重试'))
        }
      })
  }

  function close() {
    setActiveFolderId('')
    onModelValueChange?.(false)
  }

  return (
    <Modal
      open={modelValue}
      width="calc(100vw - 24px)"
      centered
      closable={false}
      maskClosable={true}
      footer={null}
      className="material-library-picker-dialog"
      onCancel={close}
      styles={{ body: { padding: 0 } }}
    >
      <div className="mlp-shell" aria-label="添加素材">
        <header className="mlp-header">
          {viewMode === 'folder' ? (
            <div className="mlp-tabs" role="tablist" aria-label="素材分组">
              {Object.entries(TAB_LABELS)
                .filter(([key]) => key !== 'favorite' || Boolean(onBatchFavorite))
                .map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={tab === key ? 'active' : ''}
                    onClick={() => switchTab(key)}
                  >
                    {label}
                  </button>
                ))}
            </div>
          ) : (
            <div className="mlp-breadcrumb-header">
              <button type="button" className="mlp-back-button" aria-label="返回上一页" onClick={goBackToFolders}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M8.75 3.5L5.25 7L8.75 10.5"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span>返回上一页</span>
              </button>
              <button type="button" className="mlp-breadcrumb-link" onClick={goBackToFolders}>
                {currentTabLabel}
              </button>
              <span className="mlp-breadcrumb-separator">/</span>
              <div className="mlp-breadcrumb-title">{currentFolder?.title || '未命名文件夹'}</div>
            </div>
          )}

          <div className="mlp-header-actions">
            <label className="mlp-search">
              <input
                value={query}
                type="search"
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                onChange={(e) => onQueryChange?.(e.target.value)}
              />
            </label>
            <button type="button" className="mlp-close-btn" aria-label="关闭" onClick={close}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M4 4L12 12M12 4L4 12"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </header>

        <section className={`mlp-hero${viewMode === 'material' ? ' is-material-view' : ''}`} aria-label="我的素材">
          <div className="mlp-hero-card">
            <div className="mlp-hero-title">我的素材</div>
            <div className="mlp-hero-subtitle">海量优质素材，激发创意灵感</div>
            <span className="mlp-hero-link">
              探索更多优质素材
              <span aria-hidden="true">→</span>
            </span>
          </div>
          {viewMode === 'folder' ? (
            <button type="button" className="mlp-create-folder" aria-label="新建项目文件夹" onClick={createFolder}>
              <span className="mlp-create-folder-copy">
                <span className="mlp-create-folder-icon" aria-hidden="true">
                  +
                </span>
                <span>新建项目文件夹</span>
              </span>
              <img className="mlp-create-folder-visual" src={actionCardVisual} alt="" aria-hidden="true" />
            </button>
          ) : onFilesUpload ? (
            <button
              type="button"
              className="mlp-create-folder mlp-upload-button"
              aria-label="上传本地素材"
              onClick={triggerUpload}
            >
              <span className="mlp-create-folder-copy">
                <span className="mlp-create-folder-icon" aria-hidden="true">
                  +
                </span>
                <span>上传本地素材</span>
              </span>
              <img className="mlp-create-folder-visual" src={actionCardVisual} alt="" aria-hidden="true" />
            </button>
          ) : null}
        </section>

        <section className="mlp-body" aria-label={viewMode === 'folder' ? '素材文件夹' : '素材内容'}>
          {(viewMode === 'folder' ? folderLoading : isLoading) ? (
            <div className="mlp-empty">素材加载中...</div>
          ) : viewMode === 'folder' ? (
            !visibleFolders.length ? (
              <div className="mlp-empty">暂无文件夹</div>
            ) : (
              <div className="mlp-folder-grid">
                {visibleFolders.map((folder) => (
                  <div
                    key={folder.id}
                    className={`mlp-folder-card${activeFolderId === folder.id ? ' active' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => selectFolder(folder)}
                    onDoubleClick={() => openFolder(folder)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        openFolder(folder)
                      } else if (e.key === ' ') {
                        e.preventDefault()
                        selectFolder(folder)
                      }
                    }}
                  >
                    <div className="mlp-folder-icon-wrap">
                      <img
                        className="mlp-folder-icon"
                        src={activeFolderId === folder.id ? folderPurpleIcon : folderGrayIcon}
                        alt={folder.title}
                      />
                    </div>
                    <div className="mlp-folder-meta">
                      <div className="mlp-folder-title-row">
                        <strong>{folder.title}</strong>
                      </div>
                      <div className="mlp-folder-stats">
                        <span>图片 {folder.imageCount}</span>
                        <span>视频 {folder.videoCount}</span>
                        <span>音频 {folder.audioCount}</span>
                      </div>
                    </div>
                    <div className="mlp-folder-side">
                      <span className="mlp-folder-date">{folder.updatedText}</span>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : (
            <>
              <div className="mlp-toolbar" aria-label="素材筛选栏">
                <div className="mlp-toolbar-controls">
                  <label className="mlp-toolbar-select">
                    <select
                      value={assetTypeFilter}
                      aria-label="全部类型"
                      onChange={(e) => setAssetTypeFilter(e.target.value)}
                    >
                      <option value="all">全部类型</option>
                      <option value="image">图片</option>
                      <option value="video">视频</option>
                    </select>
                  </label>

                  <label className="mlp-toolbar-select">
                    <select value={timeSort} aria-label="时间排序" onChange={(e) => setTimeSort(e.target.value)}>
                      <option value="desc">最新优先</option>
                      <option value="asc">最早优先</option>
                    </select>
                  </label>

                  {onBatchFavorite ? (
                    <label className="mlp-toolbar-checkbox">
                      <input
                        type="checkbox"
                        checked={onlyFavorite}
                        onChange={(e) => setOnlyFavorite(e.target.checked)}
                      />
                      我收藏的
                    </label>
                  ) : null}
                </div>

                <button type="button" className="mlp-batch" onClick={() => setBatchMode((v) => !v)}>
                  批量操作
                </button>
              </div>

              {!filteredMaterials.length ? (
                <div className="mlp-empty">暂无素材</div>
              ) : (
                <div className="mlp-grid">
                  {filteredMaterials.map((material) => (
                    <button
                      key={material.id}
                      type="button"
                      className={`mlp-item${selectedIdSet.has(material.id) ? ' selected' : ''}${
                        alreadySelectedSet.has(material.id) ? ' added' : ''
                      }`}
                      onClick={() => toggleDraft(material)}
                    >
                      {isVideoMaterial(material) && material?.src && String(material?.src).trim() ? (
                        <video
                          src={material.src}
                          poster={getMaterialPoster(material) || undefined}
                          muted
                          playsInline
                          preload="metadata"
                        ></video>
                      ) : isVideoMaterial(material) && getMaterialPoster(material) ? (
                        <img src={getMaterialPoster(material)} alt={material.name} />
                      ) : material?.src ? (
                        <img src={material.src} alt={material.name} />
                      ) : (
                        <div className="mlp-item-fallback">{isVideoMaterial(material) ? '视频素材' : '图片素材'}</div>
                      )}
                      <span className="mlp-media-badge">
                        <span className="mlp-media-type-tag">{material?.type === 'video' ? '视频' : '图片'}</span>
                        {onBatchFavorite ? (
                          <span
                            className={`mlp-media-star${isFavorited(material) ? ' active' : ''}`}
                            role="button"
                            tabIndex={0}
                            aria-label="收藏"
                            onClick={(e) => {
                              e.stopPropagation()
                              e.preventDefault()
                              toggleFavorite(material)
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.stopPropagation()
                                e.preventDefault()
                                toggleFavorite(material)
                              }
                            }}
                          >
                            <svg
                              className={`mlp-star-icon${isFavorited(material) ? ' active' : ''}${
                                starPulseIds.has(material.id) ? ' pulsing' : ''
                              }`}
                              width={22}
                              height={22}
                              viewBox="0 0 24 24"
                              fill="none"
                              xmlns="http://www.w3.org/2000/svg"
                              aria-hidden="true"
                              focusable="false"
                            >
                              <defs>
                                <linearGradient
                                  id={`mlp-star-gradient-${material.id}`}
                                  x1="12"
                                  y1="2"
                                  x2="12"
                                  y2="22"
                                  gradientUnits="userSpaceOnUse"
                                >
                                  <stop offset="0" stopColor="#c4b5fd" />
                                  <stop offset="1" stopColor="#7c3aed" />
                                </linearGradient>
                              </defs>
                              {isFavorited(material) ? (
                                <path
                                  d="M12 2.4L14.93 8.62L21.69 9.43C22.15 9.49 22.34 10.06 22 10.38L17.02 15.02L18.29 21.63C18.37 22.09 17.9 22.44 17.48 22.21L12 19.17L6.52 22.21C6.1 22.44 5.63 22.09 5.71 21.63L6.98 15.02L2 10.38C1.66 10.06 1.85 9.49 2.31 9.43L9.07 8.62L12 2.4Z"
                                  fill={`url(#mlp-star-gradient-${material.id})`}
                                />
                              ) : (
                                <path
                                  d="M12 2.4L14.93 8.62L21.69 9.43C22.15 9.49 22.34 10.06 22 10.38L17.02 15.02L18.29 21.63C18.37 22.09 17.9 22.44 17.48 22.21L12 19.17L6.52 22.21C6.1 22.44 5.63 22.09 5.71 21.63L6.98 15.02L2 10.38C1.66 10.06 1.85 9.49 2.31 9.43L9.07 8.62L12 2.4Z"
                                  fill="none"
                                  stroke="rgba(255, 255, 255, 0.92)"
                                  strokeWidth="1.6"
                                  strokeLinejoin="round"
                                />
                              )}
                            </svg>
                          </span>
                        ) : null}
                      </span>
                      {batchMode && selectedIdSet.has(material.id) ? (
                        <span className="mlp-check" aria-hidden="true">
                          ✓
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </section>

        {viewMode === 'material' ? (
          <footer className="mlp-footer">
            <div className="mlp-action-bar" role="toolbar" aria-label="批量操作栏">
              <button
                type="button"
                className="mlp-action-btn"
                disabled={!allSelectableIds.length}
                onClick={toggleSelectAll}
              >
                <span className="mlp-action-icon" aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="3" y="3" width="14" height="14" rx="3" stroke="currentColor" strokeWidth="1.6" />
                    {allSelected ? (
                      <path
                        d="M6 10.2L8.6 12.8L14 7.4"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    ) : null}
                  </svg>
                </span>
                全选（已选 {selectedCount} 个）
              </button>
              <button type="button" className="mlp-action-btn" disabled={!canConfirm} onClick={addDraftMaterials}>
                <span className="mlp-action-icon" aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M10 4V16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    <path d="M4 10H16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </span>
                添加
              </button>
              {onBatchFavorite ? (
                <button
                  type="button"
                  className={`mlp-action-btn${selectedAllFavorited ? ' active' : ''}${actionPulse ? ' pulsing' : ''}`}
                  disabled={!selectedCount}
                  onClick={toggleSelectedFavorites}
                >
                  <span className="mlp-action-icon" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M10 2.4L12.31 7.3L17.63 7.94C18 7.98 18.16 8.45 17.88 8.72L13.96 12.36L14.96 17.52C15.03 17.89 14.66 18.17 14.32 17.99L10 15.62L5.68 17.99C5.34 18.17 4.97 17.89 5.04 17.52L6.04 12.36L2.12 8.72C1.84 8.45 2 7.98 2.37 7.94L7.69 7.3L10 2.4Z"
                        fill={selectedAllFavorited ? 'currentColor' : 'none'}
                        stroke={selectedAllFavorited ? 'none' : 'currentColor'}
                        strokeWidth="1.6"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  收藏
                </button>
              ) : null}
              {onBatchDelete ? (
                <button
                  type="button"
                  className="mlp-action-btn danger"
                  disabled={!selectedCount}
                  onClick={deleteSelected}
                >
                  <span className="mlp-action-icon" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M4.5 6.2H15.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                      <path
                        d="M8 6.2V4.6C8 3.94 8.54 3.4 9.2 3.4H10.8C11.46 3.4 12 3.94 12 4.6V6.2"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M6.3 6.2L6.9 16.1C6.94 16.75 7.48 17.25 8.13 17.25H11.87C12.52 17.25 13.06 16.75 13.1 16.1L13.7 6.2"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinejoin="round"
                      />
                      <path d="M8.3 9.1V14.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                      <path d="M11.7 9.1V14.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    </svg>
                  </span>
                  删除
                </button>
              ) : null}
            </div>
          </footer>
        ) : null}

        {onFilesUpload ? (
          <input
            ref={fileInput}
            className="file-input"
            type="file"
            multiple
            accept="image/*,video/*"
            onChange={handleFileChange}
          />
        ) : null}
      </div>
    </Modal>
  )
}
