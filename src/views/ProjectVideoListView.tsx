/**
 * 项目视频列表页
 *
 * 页面效果：按项目展示智能成片、爆款复制及归类视频，提供关键词、流程、状态、时长筛选，
 * 支持分页、真实时长回填、查看详情、下载，以及从项目素材继续创建新视频。
 *
 * 权限边界：项目成员均可进入详情和下载；仅视频创建者可编辑/发布；仅项目创建者或空间
 * owner/admin 可删除。界面隐藏无权限按钮，执行函数仍会再次校验，避免绕过界面直接触发操作。
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import AppSidebar from '@/components/home/AppSidebar'
import AppTopbar from '@/components/layout/AppTopbar'
import { useCurrentUser, useCurrentWorkspace, useWorkspaceId } from '@/stores/workspaceSession'
import { useConfirmDialog, useToast } from '@/composables/useToast'
import { useSidebarNavigate } from '@/composables/useSidebarNavigate'
import { useWorkspaceMemberAccess } from '@/composables/useWorkspaceMemberAccess'
import {
  deleteProjectVideo,
  formatVideoDate,
  formatVideoDuration,
  getVideoStatusText,
  listProjectVideos,
  publishProjectVideo,
  type ProjectVideo,
} from '@/api/projectVideos'
import { getCreativeProject } from '@/api/business'
import { downloadToDisk, buildDownloadName, isWeChatBrowser } from '@/utils/downloadToDisk'
import {
  isCreativeProjectRestrictedForUser,
  resolveCreativeProjectOwnerId,
  resolveUserId,
  toPlainObject as toPlainObj,
} from '@/utils/creativeDraftMetadata'
import { LazyMediaVideo, useMediaCardActivation } from '@/components/common/LazyMediaVideo'
import './ProjectVideoListView.css'

/** 从项目草稿带入新创作流程的素材引用。 */
type CarryMat = { url: string; assetId: number }
// 从项目草稿里抽取「用户上传的素材」(图片资产 id + 源视频),兼容 智能成片 / 爆款复制 两种草稿结构
function extractUploadedMaterials(draftJson: any, wsId: number): { images: CarryMat[]; video: CarryMat | null } {
  let d = draftJson
  if (typeof d === 'string') {
    try {
      d = JSON.parse(d)
    } catch {
      d = null
    }
  }
  if (!d || typeof d !== 'object') return { images: [], video: null }
  const smart = d.smart && typeof d.smart === 'object' ? d.smart : d
  const url = (id: number) => `/api/v1/assets/${Math.floor(id)}/download?workspace_id=${Math.floor(wsId)}`
  const imgIds = new Set<number>()
  // 智能成片:入口上传图(entryMeta.imageAssetIds)
  const em = d.entryMeta || smart.entryMeta
  ;(em?.imageAssetIds || []).forEach((id: any) => Number(id) && imgIds.add(Number(id)))
  // 爆款复制:替换素材(productAssetIds)
  ;(smart.productAssetIds || d.productAssetIds || []).forEach((id: any) => Number(id) && imgIds.add(Number(id)))
  const images: CarryMat[] = [...imgIds].map((id) => ({ url: url(id), assetId: id }))
  // 兜底:无 assetId 时用 entryMeta.images 里的 http/api 地址
  if (!images.length && Array.isArray(em?.images)) {
    em.images.forEach((u: any) => {
      const s = typeof u === 'string' ? u : u?.url
      if (s && /^(https?:|\/api)/.test(s)) images.push({ url: s, assetId: 0 })
    })
  }
  // 爆款复制源视频
  const sv = smart.sourceVideo || d.sourceVideo
  const svId = Number(sv?.assetId || 0)
  const video: CarryMat | null = svId ? { url: url(svId), assetId: svId } : null
  return { images, video }
}

/** 视频列表支持的时间排序字段。 */
type SortKey = 'updatedAt' | 'createdAt'
/** 视频生成/发布状态筛选项。 */
type StatusFilter = 'all' | 'draft' | 'processing' | 'published' | 'failed'
/** 视频时长区间筛选项。 */
type DurationFilter = 'all' | 'short' | 'mid' | 'long'
/** 智能成片与爆款复制流程筛选项。 */
type FlowFilter = 'all' | 'smart' | 'hot-copy'
// 从后端项目草稿解析流程标识(与 projectVideos.ts resolveProjectFlow 口径一致)
function resolveProjectFlowFromDraft(draft: any): string {
  if (!draft || typeof draft !== 'object') return ''
  const smart = draft.smart && typeof draft.smart === 'object' ? draft.smart : null
  return String(smart?.flow || draft.flow || '').toLowerCase()
}

/** 判断一条视频是否命中当前时长筛选区间。 */
function matchesDuration(item: ProjectVideo, duration: DurationFilter): boolean {
  if (duration === 'all') return true
  const seconds = Number(item.durationSeconds || 0)
  if (duration === 'short') return seconds > 0 && seconds <= 15
  if (duration === 'mid') return seconds > 15 && seconds <= 60
  return seconds > 60
}

/** 按创建时间或最近更新时间倒序排列视频。 */
function sortVideos(list: ProjectVideo[], sortBy: SortKey): ProjectVideo[] {
  return [...list].sort((a, b) => {
    const av = Date.parse(sortBy === 'createdAt' ? a.createdAt : a.updatedAt || a.createdAt || '')
    const bv = Date.parse(sortBy === 'createdAt' ? b.createdAt : b.updatedAt || b.createdAt || '')
    return (Number.isFinite(bv) ? bv : 0) - (Number.isFinite(av) ? av : 0)
  })
}

/** 判断封面地址本身是否指向视频文件。 */
function isVideoCover(url: string): boolean {
  return /\.(mp4|mov|webm|m4v)(\?|$)/i.test(String(url || ''))
}

// ── 卡片小图标(描边 currentColor)──
const IcoClock = () => (
  <svg
    viewBox="0 0 24 24"
    width="13"
    height="13"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5V12l3 1.8" />
  </svg>
)
/** 创建人信息图标。 */
const IcoUser = () => (
  <svg
    viewBox="0 0 24 24"
    width="13"
    height="13"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="8" r="3.4" />
    <path d="M5.5 19a6.5 6.5 0 0 1 13 0" />
  </svg>
)
/** 创建日期信息图标。 */
const IcoCalendar = () => (
  <svg
    viewBox="0 0 24 24"
    width="13"
    height="13"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="4" y="5.5" width="16" height="15" rx="2.5" />
    <path d="M4 9.5h16M8 3.5v4M16 3.5v4" />
  </svg>
)
/** 视频下载操作图标。 */
const IcoDownload = () => (
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14" />
  </svg>
)

/** 单个视频卡片的权限结果、展示数据和操作回调。 */
interface ProjectVideoCardProps {
  item: ProjectVideo
  canModify: boolean
  canDelete: boolean
  durationSeconds: number
  menuOpen: boolean
  onOpen: (item: ProjectVideo) => void
  onEdit: (item: ProjectVideo) => void
  onDownload: (item: ProjectVideo) => void
  onPublish: (item: ProjectVideo) => void
  onDelete: (item: ProjectVideo) => void
  onToggleMenu: (videoId: string) => void
  onDuration: (videoId: string, durationSeconds: number) => void
}

// 卡片只负责按父组件计算好的权限渲染操作入口；查看与下载始终对可访问项目的成员开放。
const ProjectVideoCard = memo(function ProjectVideoCard({
  item,
  canModify,
  canDelete,
  durationSeconds,
  menuOpen,
  onOpen,
  onEdit,
  onDownload,
  onPublish,
  onDelete,
  onToggleMenu,
  onDuration,
}: ProjectVideoCardProps) {
  const { active, activationProps } = useMediaCardActivation()
  const coverImage = item.coverUrl && !isVideoCover(item.coverUrl) ? item.coverUrl : ''
  const openPrimary = () => (item.videoUrl ? onOpen(item) : canModify ? onEdit(item) : onOpen(item))

  return (
    <article className="pvlist-card" {...activationProps}>
      <div className="pvlist-card__media">
        <button
          type="button"
          className="pvlist-card__cover"
          aria-label={`查看视频：${item.title}`}
          onClick={openPrimary}
        >
          {item.videoUrl ? (
            <>
              <span className="pvlist-card__placeholder">视频</span>
              <LazyMediaVideo
                src={item.videoUrl}
                poster={coverImage || undefined}
                active={active || menuOpen}
                onLoadedMetadata={(event) => {
                  const measured = Math.round(event.currentTarget.duration)
                  if (Number.isFinite(measured) && measured > 0) onDuration(item.id, measured)
                }}
                onError={(event) => {
                  event.currentTarget.style.display = 'none'
                }}
              />
            </>
          ) : coverImage ? (
            <img
              src={coverImage}
              alt={item.title}
              loading="lazy"
              onError={(event) => {
                event.currentTarget.style.display = 'none'
              }}
            />
          ) : (
            <span className="pvlist-card__placeholder">视频</span>
          )}
          <span className="pvlist-card__play" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path d="M9 7.2 17 12l-8 4.8z" fill="#fff" />
            </svg>
          </span>
          <span className="pvlist-card__duration">{formatVideoDuration(durationSeconds)}</span>
        </button>
        <div className="pvlist-card__menu-wrap">
          <button
            type="button"
            className="pvlist-card__more"
            aria-label="更多操作"
            aria-expanded={menuOpen}
            onClick={() => onToggleMenu(item.id)}
          >
            <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
              <circle cx="4" cy="10" r="1.5" fill="currentColor" />
              <circle cx="10" cy="10" r="1.5" fill="currentColor" />
              <circle cx="16" cy="10" r="1.5" fill="currentColor" />
            </svg>
          </button>
          {menuOpen ? (
            <div className="pvlist-card__menu">
              <button type="button" onClick={() => onOpen(item)}>
                查看详情
              </button>
              {canModify ? (
                <button type="button" onClick={() => onEdit(item)}>
                  进入编辑
                </button>
              ) : null}
              <button type="button" onClick={() => onDownload(item)}>
                下载视频
              </button>
              {canModify ? (
                <button type="button" onClick={() => onPublish(item)}>
                  标记发布
                </button>
              ) : null}
              {canDelete ? (
                <button type="button" className="is-danger" onClick={() => onDelete(item)}>
                  删除视频
                </button>
              ) : null}
              {!canModify && !canDelete ? <div className="pvlist-card__menu-hint">当前仅可查看和下载</div> : null}
            </div>
          ) : null}
        </div>
      </div>
      <div className="pvlist-card__body">
        <div className="pvlist-card__head">
          <button type="button" className="pvlist-card__title" onClick={openPrimary}>
            {item.title}
          </button>
          <span className={`pvlist-card__status is-${item.status}`}>{getVideoStatusText(item.status)}</span>
        </div>
        <div className="pvlist-card__info">
          <span className="pvlist-card__info-item">
            <IcoClock />
            {formatVideoDuration(durationSeconds)}
          </span>
          <span className="pvlist-card__info-item pvlist-card__info-item--author">
            <IcoUser />
            {item.createdByName}
          </span>
        </div>
        <div className="pvlist-card__info pvlist-card__info--row2">
          <span className="pvlist-card__info-item">
            <IcoCalendar />
            {formatVideoDate(item.createdAt)}
          </span>
          <button
            type="button"
            className={`pvlist-card__download${item.videoUrl ? '' : ' is-disabled'}`}
            aria-label="下载视频"
            title="下载视频"
            onClick={() => onDownload(item)}
          >
            <IcoDownload />
          </button>
        </div>
      </div>
    </article>
  )
})

/** 加载并渲染项目下的视频列表，统一处理筛选、权限和媒体操作。 */
export default function ProjectVideoListView() {
  const navigate = useNavigate()
  const params = useParams()
  const { showToast } = useToast()
  const { requestConfirm } = useConfirmDialog()
  const currentUser = useCurrentUser() as any
  const currentWorkspace = useCurrentWorkspace() as any
  const workspaceId = useWorkspaceId()
  const projectId = Number(params.projectId || 0)
  // 当前用户显示名(多字段兜底),用于与视频 createdByName 比对判断是否有修改权限
  const userName =
    currentUser?.nickname || currentUser?.name || currentUser?.username || currentUser?.email || '当前用户'
  // 权限判断:用 user_id 而非 createdByName,因为后端项目列表不返回创建者昵称字段,
  // createdByName 一律回退成当前用户名导致谁都能操作。
  // createdByUserId=0 表示无法判定归属(如手动归类的视频),保守处理:不允许操作。
  const currentUserId = resolveUserId(currentUser)
  // 编辑/发布按视频创建者判定，不能用显示名比较，避免同名或后端昵称回退造成越权。
  const canModify = useCallback(
    (item: ProjectVideo) => {
      const ownerId = Number(item.createdByUserId ?? 0) || 0
      return ownerId > 0 && ownerId === currentUserId
    },
    [currentUserId],
  )

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [projectTitle, setProjectTitle] = useState('')
  const [projectOwnerId, setProjectOwnerId] = useState(0)
  const [editorCount, setEditorCount] = useState(0)
  const [newVideoOpen, setNewVideoOpen] = useState(false)
  const [videos, setVideos] = useState<ProjectVideo[]>([])
  const { workspaceMembers: effectiveWorkspaceMembers, currentWorkspaceRole } = useWorkspaceMemberAccess({
    workspaceId,
    currentUserId,
    currentWorkspace,
  })
  // 删除按项目所有权判定：普通成员即使能查看、下载，也不能删除项目中的任何视频。
  const canDeleteVideo = useCallback(
    (_item: ProjectVideo) =>
      currentUserId > 0 &&
      (currentUserId === projectOwnerId || currentWorkspaceRole === 'owner' || currentWorkspaceRole === 'admin'),
    [currentUserId, currentWorkspaceRole, projectOwnerId],
  )
  const canDeleteVideoRef = useRef(canDeleteVideo)
  canDeleteVideoRef.current = canDeleteVideo

  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState<SortKey>('updatedAt')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [duration, setDuration] = useState<DurationFilter>('all')
  const [flowFilter, setFlowFilter] = useState<FlowFilter>('all')
  const [projectFlow, setProjectFlow] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [openMenuId, setOpenMenuId] = useState('')
  // 后端视频版本常不带时长 → 从 <video> 元数据里读真实时长(键为卡片 id),展示时优先用它
  const [durations, setDurations] = useState<Record<string, number>>({})
  const durationOf = (item: ProjectVideo) => durations[item.id] || Number(item.durationSeconds || 0)
  const updateDuration = useCallback((videoId: string, measuredDuration: number) => {
    setDurations((prev) => (prev[videoId] === measuredDuration ? prev : { ...prev, [videoId]: measuredDuration }))
  }, [])
  const toggleVideoMenu = useCallback((videoId: string) => {
    setOpenMenuId((prev) => (prev === videoId ? '' : videoId))
  }, [])

  const handleNavigate = useSidebarNavigate()

  const workspaceIdRef = useRef(0)
  const projectIdRef = useRef(0)
  const loadRequestSeqRef = useRef(0)
  useEffect(() => {
    workspaceIdRef.current = Number(workspaceId || 0)
    projectIdRef.current = projectId
  }, [projectId, workspaceId])
  // 同时加载项目元信息和视频清单；请求快照确保快速切换项目/空间时只接收最后一次响应。
  const loadData = useCallback(async () => {
    const wsId = Number(workspaceId || 0)
    const requestSeq = ++loadRequestSeqRef.current
    const isCurrentRequest = () =>
      loadRequestSeqRef.current === requestSeq && workspaceIdRef.current === wsId && projectIdRef.current === projectId

    if (!projectId || !wsId) {
      setProjectTitle('')
      setProjectOwnerId(0)
      setVideos([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const payload = await listProjectVideos({
        projectId,
        workspaceId: wsId,
        currentUserName: userName,
        currentUserId,
        workspaceMembers: effectiveWorkspaceMembers,
      })
      if (!isCurrentRequest()) return
      if (isCreativeProjectRestrictedForUser(payload.project, currentUserId)) {
        showToast('您没有权限访问该项目', 'error')
        navigate('/projects', { replace: true })
        return
      }
      setProjectTitle(String(payload.project?.title || payload.project?.name || '未命名项目'))
      setProjectOwnerId(resolveCreativeProjectOwnerId(payload.project))
      const count =
        Number(
          payload.project?.editor_count ?? payload.project?.editorCount ?? payload.project?.data?.editor_count ?? 0,
        ) || 0
      setEditorCount(Number.isFinite(count) && count > 0 ? Math.floor(count) : 0)
      setVideos(payload.videos)
      // 项目当前草稿的流程标识:用于后续新建视频/进入编辑默认走正确的编辑器
      const draft = toPlainObj(
        payload.project?.draft_json ?? payload.project?.data?.draft_json ?? payload.project?.draft,
      )
      setProjectFlow(resolveProjectFlowFromDraft(draft) || '')
    } catch (error: any) {
      if (!isCurrentRequest()) return
      setVideos([])
      setProjectTitle('')
      setProjectOwnerId(0)
      showToast(error?.message || '项目视频加载失败，请稍后重试', 'error')
    } finally {
      if (isCurrentRequest()) setLoading(false)
    }
  }, [projectId, workspaceId, showToast, userName, currentUserId, effectiveWorkspaceMembers, navigate])

  useEffect(() => {
    loadData()
    return () => {
      loadRequestSeqRef.current += 1
    }
  }, [loadData])

  useEffect(() => {
    setPage(1)
  }, [query, sortBy, status, duration, flowFilter, pageSize])

  useEffect(() => {
    if (!openMenuId) return
    function onPointerDown(event: PointerEvent) {
      const target = event.target as HTMLElement
      if (target?.closest?.('.pvlist-card__menu-wrap')) return
      setOpenMenuId('')
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => window.removeEventListener('pointerdown', onPointerDown, true)
  }, [openMenuId])

  // 所有筛选先在完整列表上组合执行，再统一排序和分页，保证页码与筛选结果数量一致。
  const filteredVideos = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const filtered = videos.filter((item) => {
      if (
        normalizedQuery &&
        !String(item.title || '')
          .toLowerCase()
          .includes(normalizedQuery)
      )
        return false
      if (status !== 'all' && item.status !== status) return false
      if (!matchesDuration(item, duration)) return false
      if (flowFilter !== 'all' && item.flow !== flowFilter) return false
      return true
    })
    return sortVideos(filtered, sortBy)
  }, [videos, query, status, duration, flowFilter, sortBy])

  const videoCount = videos.length
  const total = filteredVideos.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(page, totalPages)
  const pagedVideos = filteredVideos.slice((safePage - 1) * pageSize, safePage * pageSize)

  const openDetail = useCallback(
    (video: ProjectVideo) => {
      navigate(`/projects/${projectId}/videos/${video.id}`)
    },
    [navigate, projectId],
  )

  const openEditor = useCallback(
    (video: ProjectVideo) => {
      const query = new URLSearchParams()
      const targetWorkspaceId = Number(workspaceId || video.workspaceId || 0)
      if (targetWorkspaceId > 0) query.set('workspace_id', String(targetWorkspaceId))
      query.set('video_id', String(video.id))
      const videoAssetId = Number(video.videoAssetId || 0)
      const selectedVideoAssetId = Number.isFinite(videoAssetId) && videoAssetId > 0 ? Math.floor(videoAssetId) : 0
      if (selectedVideoAssetId > 0) query.set('video_asset_id', String(selectedVideoAssetId))
      // 按真实流程分流编辑器:爆款复制 → /hot-copy/:id;其余(智能成片/旧创作)→ /smart/:id
      const base = video.flow === 'hot-copy' ? '/hot-copy' : '/smart'
      navigate(`${base}/${projectId}?${query.toString()}`, {
        state: {
          projectVideoSelection: {
            projectId,
            workspaceId: targetWorkspaceId,
            videoId: String(video.id),
            ...(selectedVideoAssetId > 0 ? { videoAssetId: selectedVideoAssetId } : {}),
          },
        },
      })
    },
    [navigate, projectId, workspaceId],
  )

  // 下载不要求修改权限：只要成员能访问项目并且视频有地址，就可以保存到本地。
  const downloadVideo = useCallback(
    async (video: ProjectVideo) => {
      if (!video.videoUrl) {
        showToast('当前视频暂无可下载地址', 'info')
        return
      }
      const fileName = buildDownloadName(video.title || '视频', new Date())
      try {
        showToast('视频下载中…', 'success')
        const r = await downloadToDisk({ fileName, resolveUrl: () => video.videoUrl })
        if (r === 'done') showToast('视频已保存', 'success')
        else if (r === 'started') {
          showToast(isWeChatBrowser() ? '已打开视频，请使用播放器菜单保存' : '已开始下载，请查看浏览器下载列表', 'info')
        }
      } catch (err: any) {
        showToast(err?.message || '下载失败,请稍后重试', 'error')
      }
    },
    [showToast],
  )

  // 新建视频:弹窗选「智能成片 / 爆款复制」→ 进入全新创作流程,携带该项目【上传的素材】,
  // 并绑定到【同一项目】(归同一项目、不新建重复项目;重新生成会覆盖该项目当前草稿)。
  const goCreateVia = useCallback(
    async (kind: 'smart' | 'hot') => {
      setNewVideoOpen(false)
      const wsId = Number(workspaceId || 0)
      let carryImages: CarryMat[] = []
      let carryVideo: CarryMat | null = null
      try {
        const proj: any = await getCreativeProject({ projectId, workspaceId: wsId })
        const draft = proj?.draft_json ?? proj?.data?.draft_json ?? proj?.draft
        const mats = extractUploadedMaterials(draft, wsId)
        carryImages = mats.images
        carryVideo = mats.video
      } catch {
        /* 取草稿失败:仍进入流程(不带素材),不阻断 */
      }
      navigate(kind === 'smart' ? '/smart' : '/hot-copy', {
        state: {
          newProjectName: projectTitle || '',
          restartProjectId: projectId,
          carryImages,
          carryVideo,
        },
      })
    },
    [navigate, projectTitle, projectId, workspaceId],
  )

  const handlePublish = useCallback(
    async (video: ProjectVideo) => {
      if (!canModify(video)) {
        showToast('仅视频创建者可以发布视频', 'error')
        return
      }
      const wsId = Number(workspaceId || 0)
      if (!projectId || !wsId) return
      try {
        await publishProjectVideo({ projectId, workspaceId: wsId, videoId: video.id })
        if (workspaceIdRef.current !== wsId || projectIdRef.current !== projectId) return
        showToast('视频已标记为已发布', 'success')
        setOpenMenuId('')
        await loadData()
      } catch (error: any) {
        if (workspaceIdRef.current !== wsId || projectIdRef.current !== projectId) return
        showToast(error?.message || '视频发布失败，请稍后重试', 'error')
      }
    },
    [canModify, workspaceId, projectId, loadData, showToast],
  )

  // 删除在确认前后各校验一次，并核对当前 workspace/project，防止弹窗期间切页后误删旧目标。
  const handleDelete = useCallback(
    async (video: ProjectVideo) => {
      if (!canDeleteVideo(video)) {
        showToast('仅项目创建者或空间管理员可以删除视频', 'error')
        return
      }
      const confirmed = await requestConfirm(`确定删除视频「${video.title}」吗？该操作不可恢复。`)
      if (!confirmed) return
      if (!canDeleteVideoRef.current(video)) {
        showToast('仅项目创建者或空间管理员可以删除视频', 'error')
        return
      }
      const wsId = Number(workspaceId || 0)
      if (!projectId || !wsId) return
      if (workspaceIdRef.current !== wsId || projectIdRef.current !== projectId) return
      try {
        await deleteProjectVideo({ projectId, workspaceId: wsId, videoId: video.id })
        if (workspaceIdRef.current !== wsId || projectIdRef.current !== projectId) return
        showToast('视频已删除', 'success')
        setOpenMenuId('')
        await loadData()
      } catch (error: any) {
        if (workspaceIdRef.current !== wsId || projectIdRef.current !== projectId) return
        showToast(error?.message || '视频删除失败，请稍后重试', 'error')
      }
    },
    [canDeleteVideo, requestConfirm, workspaceId, projectId, loadData, showToast],
  )

  const pageNumbers = useMemo(() => {
    const start = Math.max(1, safePage - 2)
    const end = Math.min(totalPages, start + 4)
    const pages: number[] = []
    for (let current = start; current <= end; current += 1) pages.push(current)
    return pages
  }, [safePage, totalPages])

  return (
    <div className="pvlist-page">
      <AppSidebar
        activeKey="projects"
        onNavigate={handleNavigate}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <div className="pvlist-shell">
        <AppTopbar onMenu={() => setSidebarOpen(true)} />
        <main className="pvlist-main">
          <div className="pvlist-container">
            <div className="pvlist-breadcrumb">
              <button type="button" className="pvlist-breadcrumb__link" onClick={() => navigate('/home')}>
                首页
              </button>
              <span className="pvlist-breadcrumb__sep">›</span>
              <button type="button" className="pvlist-breadcrumb__link" onClick={() => navigate('/projects')}>
                项目管理
              </button>
              <span className="pvlist-breadcrumb__sep">›</span>
              <span className="pvlist-breadcrumb__current">
                {projectTitle || '项目视频'}
                {videoCount ? `（${videoCount}个视频）` : ''}
                {editorCount ? <span className="pvlist-breadcrumb__meta">· {editorCount} 编辑者</span> : null}
              </span>
            </div>

            <section className="pvlist-toolbar" aria-label="项目视频工具栏">
              <div className="pvlist-toolbar__left">
                <div className="pvlist-flow-tabs">
                  <button
                    type="button"
                    className={`pvlist-flow-tab${flowFilter === 'all' ? ' is-active' : ''}`}
                    onClick={() => setFlowFilter('all')}
                  >
                    全部
                  </button>
                  <button
                    type="button"
                    className={`pvlist-flow-tab${flowFilter === 'smart' ? ' is-active' : ''}`}
                    onClick={() => setFlowFilter('smart')}
                  >
                    智能成片
                  </button>
                  <button
                    type="button"
                    className={`pvlist-flow-tab${flowFilter === 'hot-copy' ? ' is-active' : ''}`}
                    onClick={() => setFlowFilter('hot-copy')}
                  >
                    爆款复制
                  </button>
                </div>
                <label className="pvlist-search">
                  <span className="pvlist-search__icon" aria-hidden="true">
                    ⌕
                  </span>
                  <input
                    type="search"
                    value={query}
                    placeholder="搜索视频..."
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
              </div>
              <div className="pvlist-toolbar__right">
                <div className="pvlist-filters">
                  <label className="pvlist-select">
                    <span>排序:</span>
                    <select value={sortBy} onChange={(event) => setSortBy(event.target.value as SortKey)}>
                      <option value="updatedAt">修改时间</option>
                      <option value="createdAt">创建时间</option>
                    </select>
                  </label>
                  <label className="pvlist-select">
                    <span>状态:</span>
                    <select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}>
                      <option value="all">全部</option>
                      <option value="draft">草稿</option>
                      <option value="processing">制作中</option>
                      <option value="published">已发布</option>
                      <option value="failed">失败</option>
                    </select>
                  </label>
                  <label className="pvlist-select">
                    <span>时长:</span>
                    <select value={duration} onChange={(event) => setDuration(event.target.value as DurationFilter)}>
                      <option value="all">全部</option>
                      <option value="short">短视频</option>
                      <option value="mid">中视频</option>
                      <option value="long">长视频</option>
                    </select>
                  </label>
                </div>
                <button
                  type="button"
                  className="pvlist-create-btn"
                  onClick={() => {
                    // 项目已有明确流程:直接进入对应编辑器,不弹选择框
                    if (projectFlow === 'hot-copy') {
                      goCreateVia('hot')
                      return
                    }
                    if (projectFlow === 'smart') {
                      goCreateVia('smart')
                      return
                    }
                    setNewVideoOpen(true)
                  }}
                >
                  + 新建视频
                </button>
              </div>
            </section>

            {loading ? (
              <div className="pvlist-empty">视频加载中...</div>
            ) : !pagedVideos.length ? (
              <div className="pvlist-empty">当前项目下还没有符合条件的视频</div>
            ) : (
              <section className="pvlist-grid" aria-label="项目视频列表">
                {pagedVideos.map((item) => (
                  <ProjectVideoCard
                    key={item.id}
                    item={item}
                    canModify={canModify(item)}
                    canDelete={canDeleteVideo(item)}
                    durationSeconds={durationOf(item)}
                    menuOpen={openMenuId === item.id}
                    onOpen={openDetail}
                    onEdit={openEditor}
                    onDownload={downloadVideo}
                    onPublish={handlePublish}
                    onDelete={handleDelete}
                    onToggleMenu={toggleVideoMenu}
                    onDuration={updateDuration}
                  />
                ))}
              </section>
            )}

            <footer className="pvlist-pagination">
              <div className="pvlist-pagination__pages">
                <button type="button" disabled={safePage <= 1} onClick={() => setPage((prev) => Math.max(1, prev - 1))}>
                  ‹
                </button>
                {pageNumbers.map((item) => (
                  <button
                    type="button"
                    key={item}
                    className={item === safePage ? 'is-active' : ''}
                    onClick={() => setPage(item)}
                  >
                    {item}
                  </button>
                ))}
                {totalPages > pageNumbers[pageNumbers.length - 1] ? (
                  <span className="pvlist-pagination__ellipsis">...</span>
                ) : null}
                <button
                  type="button"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                >
                  ›
                </button>
              </div>
              <div className="pvlist-pagination__size">
                <span>{total} 条</span>
                <button type="button" className={pageSize === 20 ? 'is-active' : ''} onClick={() => setPageSize(20)}>
                  20
                </button>
                <span>/</span>
                <button type="button" className={pageSize === 50 ? 'is-active' : ''} onClick={() => setPageSize(50)}>
                  50
                </button>
                <span>/</span>
                <button type="button" className={pageSize === 100 ? 'is-active' : ''} onClick={() => setPageSize(100)}>
                  100
                </button>
                <span>条/页</span>
              </div>
            </footer>
          </div>
        </main>
      </div>

      {/* 新建视频:选择进入「智能成片」或「爆款复制」,项目名沿用当前项目名 */}
      {newVideoOpen && (
        <div className="pvlist-nvmask" role="dialog" aria-label="新建视频" onClick={() => setNewVideoOpen(false)}>
          <div className="pvlist-nvcard" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="pvlist-nvx" aria-label="关闭" onClick={() => setNewVideoOpen(false)}>
              ×
            </button>
            <div className="pvlist-nvtitle">新建视频</div>
            <div className="pvlist-nvsub">将在项目「{projectTitle || '当前项目'}」下创建,选择创作方式:</div>
            <div className="pvlist-nvopts">
              <button type="button" className="pvlist-nvopt" onClick={() => goCreateVia('smart')}>
                <span className="pvlist-nvopt__ic pvlist-nvopt__ic--smart" aria-hidden="true">
                  <svg
                    viewBox="0 0 24 24"
                    width="26"
                    height="26"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 3v4M12 17v4M5 12H3M21 12h-2M6.3 6.3 4.9 4.9M19.1 19.1l-1.4-1.4M17.7 6.3l1.4-1.4M4.9 19.1l1.4-1.4" />
                    <circle cx="12" cy="12" r="3.2" />
                  </svg>
                </span>
                <span className="pvlist-nvopt__name">智能成片</span>
                <span className="pvlist-nvopt__desc">输入需求/素材,AI 分镜成片</span>
              </button>
              <button type="button" className="pvlist-nvopt" onClick={() => goCreateVia('hot')}>
                <span className="pvlist-nvopt__ic pvlist-nvopt__ic--hot" aria-hidden="true">
                  <svg
                    viewBox="0 0 24 24"
                    width="26"
                    height="26"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="3" y="4" width="13" height="16" rx="2" />
                    <path d="M8 4v16M20 8l-4 2v4l4 2z" />
                  </svg>
                </span>
                <span className="pvlist-nvopt__name">爆款复制</span>
                <span className="pvlist-nvopt__desc">上传爆款视频,一键做同款</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
