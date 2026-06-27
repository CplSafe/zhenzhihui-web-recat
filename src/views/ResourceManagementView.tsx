/**
 * ResourceManagementView — 素材市场(2.1)
 * 四 Tab:全部 / 我上传的 / 我生成的 / 我收藏的;各 Tab 有子分类。默认「全部」,按操作时间倒序。
 * 全部 = 我上传的 + 我生成的 的所有素材。
 * 收藏(模板/IP)后端暂无对应概念,先占位;IP 子分类点击提示「功能待开放」。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import '../styles/creative.css'
import './ResourceManagementView.css'
import AppSidebar from '@/components/home/AppSidebar'
import AppTopbar from '@/components/layout/AppTopbar'
import AppToast from '@/components/AppToast'
import { useWorkspaceId } from '@/stores/workspaceSession'
import { useToast } from '@/composables/useToast'
import { openComingSoon } from '@/stores/ui'
import { loadFavorites } from '@/utils/favoriteVideos'
import ResourceAddMaterialModal from '@/components/resource/ResourceAddMaterialModal'
import AssetPreviewModal from '@/components/resource/AssetPreviewModal'
import AiBadge from '@/components/common/AiBadge'
import { useAssetPreview } from '@/composables/useAssetPreview'
import {
  extractAssetPage,
  getAssetDownloadUrl,
  getBusinessErrorMessage,
  listAssets,
  listCreativeProjects,
} from '@/api/business'

const ROUTE_MAP: Record<string, string> = {
  home: '/home',
  creative: '/smart',
  'hot-copy': '/hot-copy',
  projects: '/projects',
  resources: '/resources',
  templates: '/templates',
}

// 主 Tab + 各自子分类(全部 = 我上传的 + 我生成的 的所有素材)
const MAIN_TABS = [
  {
    key: 'all',
    label: '全部',
    subs: [
      { k: 'all', l: '全部' },
      { k: 'image', l: '图片' },
      { k: 'video', l: '视频' },
    ],
  },
  {
    key: 'upload',
    label: '我上传的',
    subs: [
      { k: 'all', l: '全部' },
      { k: 'image', l: '图片' },
      { k: 'video', l: '视频' },
    ],
  },
  {
    key: 'generated',
    label: '我生成的',
    subs: [
      { k: 'all', l: '全部' },
      { k: 'image', l: '图片' },
      { k: 'video', l: '视频' },
    ],
  },
  {
    key: 'collected',
    label: '我收藏的',
    subs: [] as { k: string; l: string }[],
  },
] as const

// ---- 纯函数工具 ----
function inferAssetCategory(asset: any, downloadUrl = '') {
  const type = String(asset?.type || '').toLowerCase()
  const mimeType = String(asset?.mime_type || '').toLowerCase()
  if (type === 'image' || mimeType.startsWith('image/')) return '图片'
  if (type === 'video' || mimeType.startsWith('video/')) return '视频'
  if (type === 'audio' || mimeType.startsWith('audio/')) return '音频'
  const fileHints = [asset?.name, asset?.file_name, asset?.url, asset?.preview_url, asset?.thumbnail_url, downloadUrl]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  if (/\.(png|jpe?g|gif|webp|bmp|svg|avif)(\?|$)/.test(fileHints)) return '图片'
  if (/\.(mp4|mov|avi|mkv|webm|m4v)(\?|$)/.test(fileHints)) return '视频'
  if (/\.(mp3|wav|aac|m4a|ogg|flac)(\?|$)/.test(fileHints)) return '音频'
  return '素材'
}

function mapAssetTypeLabel(asset: any, downloadUrl = '') {
  return inferAssetCategory(asset, downloadUrl)
}

function assetKindOf(asset: any): 'image' | 'video' | 'audio' | 'other' {
  const c = inferAssetCategory(asset)
  return c === '图片' ? 'image' : c === '视频' ? 'video' : c === '音频' ? 'audio' : 'other'
}

// 生成类素材的 角色/场景 分类(后端无明确字段时,从 meta/标签/名称做尽力判断)
function assetSceneRole(asset: any): 'role' | 'scene' | '' {
  const hints = [
    asset?.meta_json?.category,
    asset?.meta_json?.subject_kind,
    asset?.meta_json?.kind,
    asset?.category,
    asset?.name,
    ...(Array.isArray(asset?.tags) ? asset.tags : []),
  ]
    .filter(Boolean)
    .join(' ')
  if (/角色|人物|character|person|portrait/i.test(hints)) return 'role'
  if (/场景|背景|scene|background|environment/i.test(hints)) return 'scene'
  return ''
}

function assetTimestamp(asset: any): number {
  const raw = asset?.created_at || asset?.createdAt || asset?.updated_at || asset?.updatedAt || ''
  const t = Date.parse(raw || '')
  return Number.isFinite(t) ? t : 0
}

function formatBytes(sizeBytes: any) {
  const value = Number(sizeBytes || 0)
  if (!Number.isFinite(value) || value <= 0) return '0 MB'
  if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`
  if (value >= 1024) return `${Math.round(value / 1024)} KB`
  return `${value} B`
}

function buildAssetTags(asset: any) {
  const tags: string[] = []
  const source = asset?.source === 'upload' ? '上传' : asset?.source || ''
  if (source) tags.push(source)
  const typeLabel = mapAssetTypeLabel(asset)
  if (typeLabel && !tags.includes(typeLabel)) tags.push(typeLabel)
  return tags.slice(0, 3)
}

function assetInlineUrl(asset: any) {
  return (
    asset?.thumbnail_url || asset?.preview_url || asset?.cover_url || asset?.meta_json?.source_url || asset?.url || ''
  )
}

function resolveAssetPreview(asset: any) {
  const assetCategory = inferAssetCategory(asset)
  const mimeType = asset?.mime_type || ''
  const type = (asset?.type || '').toLowerCase()
  const imageUrl = assetInlineUrl(asset) || ''
  if (imageUrl && (assetCategory === '图片' || type === 'image' || mimeType.startsWith('image/'))) {
    return { mediaKind: 'image', mediaUrl: imageUrl, posterUrl: '' }
  }
  if (assetCategory === '视频' || type === 'video' || mimeType.startsWith('video/')) {
    const posterUrl = asset?.thumbnail_url || asset?.cover_url || ''
    const videoUrl = asset?.preview_url || asset?.meta_json?.source_url || asset?.url || ''
    if (videoUrl) return { mediaKind: 'video', mediaUrl: videoUrl, posterUrl }
    if (posterUrl) return { mediaKind: 'image', mediaUrl: posterUrl, posterUrl: '' }
  }
  return { mediaKind: '', mediaUrl: '', posterUrl: '' }
}

// ── 按创意项目组织:从项目草稿提取「上传/生成」的图片/视频,套素材卡片 ──
function toPlainObj(value: any): any {
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
function projectDraftOf(project: any): any {
  for (const v of [project?.draft_json, project?.draftJson, project?.draft, project?.data?.draft_json]) {
    const d = toPlainObj(v)
    if (d) return d
  }
  return null
}
function projectTsOf(project: any): number {
  const raw = project?.updated_at || project?.updatedAt || project?.created_at || project?.createdAt || ''
  const t = Date.parse(raw || '')
  return Number.isFinite(t) ? t : 0
}
// 资产直传地址:cookie 鉴权流式返回,非预签名 → 不会过期
function assetStreamUrl(assetId: number, workspaceId: number): string {
  return `/api/v1/assets/${Math.floor(assetId)}/download?workspace_id=${Math.floor(workspaceId)}`
}
/** 从一个项目草稿提取该项目的「上传」或「生成」媒体,转成素材卡片 */
function projectMediaCards(project: any, mode: 'upload' | 'generated', wsId: number): any[] {
  const draft = projectDraftOf(project)
  if (!draft) return []
  const smart = toPlainObj(draft.smart) || draft
  const ts = projectTsOf(project)
  const title = String(project?.title || project?.name || '').trim() || '未命名项目'
  const out: any[] = []
  const seen = new Set<string>()
  const add = (assetId: number, rawUrl: string, kind: 'image' | 'video') => {
    const url = assetId ? assetStreamUrl(assetId, wsId) : String(rawUrl || '').trim()
    if (!url) return
    const key = assetId ? `a${assetId}` : `u${url}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({
      id: assetId || key,
      title,
      type: kind === 'video' ? '视频' : '图片',
      tags: [],
      duration: '',
      size: '',
      source: mode,
      kind,
      roleScene: '',
      isAi: mode === 'generated',
      ts,
      mediaKind: kind,
      mediaUrl: url,
      posterUrl: kind === 'image' ? url : '',
    })
  }
  const arr = (v: any) => (Array.isArray(v) ? v : [])
  if (mode === 'upload') {
    // 入口上传的图片素材
    const em = smart?.entryMeta || smart?.entry_meta || {}
    const imgs = arr(em.images)
    const aids = arr(em.imageAssetIds || em.imageAssetIDs)
    imgs.forEach((u: any, i: number) => add(Number(aids[i] || 0) || 0, u, 'image'))
    // 上传的源视频(爆款复制)
    const sv = String(em.sourceVideo || em.source_video || em.video || '').trim()
    const svAid = Number(em.sourceVideoAssetId || em.videoAssetId || 0) || 0
    if (sv || svAid) add(svAid, sv, 'video')
  } else {
    // 生成的分镜图
    for (const s of arr(smart?.shots)) {
      add(
        Number(s?.imageAssetId || s?.image_asset_id || 0) || 0,
        s?.image || s?.imageUrl || s?.image_url || '',
        'image',
      )
    }
    // 生成的视频
    for (const v of arr(smart?.videoVersions)) {
      add(Number(v?.assetId || v?.asset_id || 0) || 0, v?.url || v?.src || '', 'video')
    }
    const gvAid = Number(draft?.generatedVideoAssetId || smart?.fullVideoAssetId || 0) || 0
    const gv = String(draft?.generatedVideoUrl || smart?.fullVideoUrl || '').trim()
    if (gv || gvAid) add(gvAid, gv, 'video')
  }
  return out
}

// 由真实宽高算比例标签(吸附常见比例,否则 gcd 约分)
function gcd(a: number, b: number): number {
  a = Math.abs(Math.round(a))
  b = Math.abs(Math.round(b))
  while (b) {
    ;[a, b] = [b, a % b]
  }
  return a || 1
}
function ratioLabel(w: number, h: number): string {
  w = Math.round(w)
  h = Math.round(h)
  if (!w || !h) return ''
  const r = w / h
  const common: [number, number][] = [
    [9, 16],
    [16, 9],
    [3, 4],
    [4, 3],
    [4, 5],
    [5, 4],
    [1, 1],
    [2, 3],
    [3, 2],
    [21, 9],
  ]
  for (const [a, b] of common) {
    if (Math.abs(r - a / b) < 0.03) return `${a}:${b}`
  }
  const g = gcd(w, h)
  return `${Math.round(w / g)}:${Math.round(h / g)}`
}

// 懒加载:元素滑入视口(含 300px 预加载)才渲染 children,避免一次性全量加载/播放导致卡顿
function LazyVisible({ children, className }: { children: any; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (shown) return
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setShown(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setShown(true)
      },
      { rootMargin: '300px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [shown])
  return (
    <div ref={ref} className={className}>
      {shown ? children : null}
    </div>
  )
}

// 缩略图:滑入视口才加载(签名请求 / 视频播放都延后);签名过期/未签名 403 → 按 assetId 取新签名重试,仍失败显示占位
function AssetThumb({
  card,
  workspaceId,
  onRatio,
}: {
  card: any
  workspaceId: any
  onRatio?: (ratio: string) => void
}) {
  const rootRef = useRef<any>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    if (inView) return
    const el = rootRef.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setInView(true)
      },
      { rootMargin: '300px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [inView])

  const [src, setSrc] = useState<string>('')
  const triedRef = useRef(false)
  useEffect(() => {
    if (!inView) return
    setSrc(card.mediaUrl || '')
    triedRef.current = false
    // 无内联地址:直接按 assetId 取签名地址(否则 img 不渲染、永远占位)
    if (!card.mediaUrl) {
      const id = card?.id
      if (id && !String(id).startsWith('asset-')) {
        triedRef.current = true
        getAssetDownloadUrl({ workspaceId, assetId: id })
          .then((u) => setSrc(u || ''))
          .catch(() => {})
      }
    }
  }, [inView, card.mediaUrl, card?.id, workspaceId])
  const handleError = useCallback(async () => {
    if (triedRef.current) {
      setSrc('')
      return
    }
    triedRef.current = true
    const id = card?.id
    if (!id || String(id).startsWith('asset-')) {
      setSrc('')
      return
    }
    try {
      const fresh = await getAssetDownloadUrl({ workspaceId, assetId: id })
      setSrc(fresh || '')
    } catch {
      setSrc('')
    }
  }, [card?.id, workspaceId])
  // 未进视口:轻量占位(只占尺寸,不请求签名、不播放视频)
  if (!inView) {
    return <div ref={rootRef} className="resource-asset-cover-placeholder resource-asset-cover-lazy" />
  }
  if (!src || !card.mediaKind) {
    return (
      <div ref={rootRef} className="resource-asset-cover-placeholder">
        <span>{card.type}</span>
        <b>暂无预览</b>
      </div>
    )
  }
  if (card.mediaKind === 'video') {
    return (
      <video
        ref={rootRef}
        src={src}
        poster={card.posterUrl || undefined}
        aria-label={card.title}
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        onLoadedMetadata={(e) => {
          const v = e.currentTarget
          if (v.videoWidth && v.videoHeight) onRatio?.(ratioLabel(v.videoWidth, v.videoHeight))
        }}
        onError={handleError}
      />
    )
  }
  return (
    <img
      ref={rootRef}
      src={src}
      alt={card.title}
      loading="lazy"
      onLoad={(e) => {
        const im = e.currentTarget
        if (im.naturalWidth && im.naturalHeight) onRatio?.(ratioLabel(im.naturalWidth, im.naturalHeight))
      }}
      onError={handleError}
    />
  )
}

// 素材卡片:比例随媒体真实宽高同步(AssetThumb 加载后回传)
function ResourceCard({
  card,
  workspaceId,
  onPreview,
  onAdd,
}: {
  card: any
  workspaceId: any
  onPreview: () => void
  onAdd: () => void
}) {
  const [ratio, setRatio] = useState<string>(card.duration || '')
  return (
    <article className="resource-asset-card">
      <div className="resource-asset-cover" onClick={onPreview}>
        <AssetThumb card={card} workspaceId={workspaceId} onRatio={setRatio} />
        {card.isAi && card.mediaKind === 'image' && <AiBadge />}
        <span className="resource-asset-type">{card.type}</span>
        <button
          type="button"
          className="resource-asset-action"
          onClick={(e) => {
            e.stopPropagation()
            onAdd()
          }}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 3v10M3 8h10" />
          </svg>
          添加素材
        </button>
      </div>
      <div className="resource-asset-info">
        <div className="resource-asset-meta">
          {ratio ? <span className="resource-asset-ratio">比例 {ratio}</span> : <span />}
          {card.size ? <span className="resource-asset-size">{card.size}</span> : null}
        </div>
      </div>
    </article>
  )
}

export default function ResourceManagementView() {
  const navigate = useNavigate()
  const workspaceId = useWorkspaceId()
  const { showToast } = useToast()
  const { previewState, openPreview, closePreview, goPrev, goNext } = useAssetPreview()

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [mainTab, setMainTab] = useState<(typeof MAIN_TABS)[number]['key']>('all')
  const [subTab, setSubTab] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [rawAssets, setRawAssets] = useState<any[]>([])

  // 我上传的/我生成的:先按创意项目分组,进项目后再按图片/视频分
  const [projectList, setProjectList] = useState<any[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState(0)

  const [isAddMaterialModalVisible, setIsAddMaterialModalVisible] = useState(false)
  const [selectedAssetForAdd, setSelectedAssetForAdd] = useState<any>(null)

  const handleNavigate = (key: string) => {
    const path = ROUTE_MAP[key]
    if (path) navigate(path)
    else openComingSoon() // 未上线项:弹全局「功能待开放」弹窗
  }

  // 一次拉取当前工作空间素材(核心数据单次请求),客户端按 Tab/子分类分流
  useEffect(() => {
    let cancelled = false
    const wsId = Number(workspaceId || 0)
    if (!wsId) {
      setRawAssets([])
      return
    }
    setLoading(true)
    listAssets({ workspaceId: wsId, status: 'active', limit: 300 })
      .then((payload) => {
        if (cancelled) return
        setRawAssets(extractAssetPage(payload).items || [])
      })
      .catch((error) => {
        if (cancelled) return
        setRawAssets([])
        showToast(getBusinessErrorMessage(error, '素材加载失败'), 'error')
      })
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  // 加载创意项目(含草稿)→ 我上传的/我生成的 按项目分组的数据源
  useEffect(() => {
    let cancelled = false
    const wsId = Number(workspaceId || 0)
    if (!wsId) {
      setProjectList([])
      return
    }
    listCreativeProjects({ workspaceId: wsId, limit: 100 })
      .then((items: any) => {
        if (!cancelled) setProjectList(Array.isArray(items) ? items : [])
      })
      .catch(() => {
        if (!cancelled) setProjectList([])
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  const cards = useMemo(
    () =>
      rawAssets.map((asset, i) => {
        const prev = resolveAssetPreview(asset)
        const kind = assetKindOf(asset)
        // mediaKind 始终按资产类型给出(即使暂无内联地址),保证 img/video 元素渲染 → 失败时按 assetId 重取
        const mediaKind = kind === 'image' ? 'image' : kind === 'video' ? 'video' : prev.mediaKind
        return {
          id: asset?.id ?? `asset-${i}`,
          title: asset?.name || `素材 ${i + 1}`,
          type: mapAssetTypeLabel(asset),
          tags: buildAssetTags(asset),
          duration: asset?.duration || asset?.ratio || '3:4',
          size: formatBytes(asset?.size_bytes),
          source: String(asset?.source || ''),
          kind,
          roleScene: assetSceneRole(asset),
          isAi: !!asset?.source && asset.source !== 'upload',
          ts: assetTimestamp(asset),
          mediaKind,
          mediaUrl: prev.mediaUrl,
          posterUrl: prev.posterUrl,
        }
      }),
    [rawAssets],
  )

  const visibleCards = useMemo(() => {
    const keyword = searchQuery.trim().toLowerCase()
    let base: any[] = []
    if (mainTab === 'all') {
      // 全部:我上传的 + 我生成的 所有素材
      base = cards.slice()
      if (subTab === 'image') base = base.filter((c) => c.kind === 'image')
      else if (subTab === 'video') base = base.filter((c) => c.kind === 'video')
    } else if (mainTab === 'upload') {
      base = cards.filter((c) => c.source === 'upload')
      if (subTab === 'image') base = base.filter((c) => c.kind === 'image')
      else if (subTab === 'video') base = base.filter((c) => c.kind === 'video')
    } else if (mainTab === 'generated') {
      // AI 生成素材 source 可能是 'generated'/'ai'/空，排除明确标记 'upload' 的即可
      base = cards.filter((c) => c.source !== 'upload')
      if (subTab === 'image') base = base.filter((c) => c.kind === 'image')
      else if (subTab === 'video') base = base.filter((c) => c.kind === 'video')
    } else if (mainTab === 'collected') {
      // 我收藏的:模板库里收藏的视频(localStorage 占位),套素材卡片渲染
      base = loadFavorites(Number(workspaceId || 0)).map((f) => ({
        id: f.key,
        title: f.title,
        type: '视频',
        tags: [],
        duration: f.ratio || '',
        size: '',
        source: 'collected',
        kind: 'video',
        roleScene: '',
        isAi: true,
        ts: f.ts || 0,
        mediaKind: 'video',
        mediaUrl: f.videoUrl,
        posterUrl: f.thumbnailUrl,
      }))
    }
    if (keyword) base = base.filter((c) => [c.title, ...(c.tags || [])].join(' ').toLowerCase().includes(keyword))
    return base.slice().sort((a, b) => b.ts - a.ts)
  }, [cards, mainTab, subTab, searchQuery, workspaceId])

  // 我上传的/我生成的:按项目分组(只列出有对应媒体的项目)
  const projectsForMode = useMemo(() => {
    if (mainTab !== 'upload' && mainTab !== 'generated') return []
    const wsId = Number(workspaceId || 0)
    const kw = searchQuery.trim().toLowerCase()
    return projectList
      .map((p) => {
        const media = projectMediaCards(p, mainTab as 'upload' | 'generated', wsId)
        // 封面优先用视频(自动播放),其次图片 → 让视频也显示出来
        const coverItem = media.find((m) => m.kind === 'video') || media.find((m) => m.kind === 'image') || media[0]
        const imgCount = media.filter((m) => m.kind === 'image').length
        const vidCount = media.filter((m) => m.kind === 'video').length
        return {
          id: Number(p?.id || 0),
          title: String(p?.title || p?.name || '').trim() || '未命名项目',
          ts: projectTsOf(p),
          count: media.length,
          imgCount,
          vidCount,
          cover: coverItem?.mediaUrl || '',
          coverKind: coverItem?.kind || '',
          media,
        }
      })
      .filter((p) => p.id > 0 && p.count > 0)
      .filter((p) => !kw || p.title.toLowerCase().includes(kw))
      .sort((a, b) => b.ts - a.ts)
  }, [projectList, mainTab, workspaceId, searchQuery])

  const selectedProject = useMemo(
    () => projectsForMode.find((p) => p.id === selectedProjectId) || null,
    [projectsForMode, selectedProjectId],
  )
  const projectMedia = useMemo(() => {
    if (!selectedProject) return []
    let m = selectedProject.media as any[]
    if (subTab === 'image') m = m.filter((c) => c.kind === 'image')
    else if (subTab === 'video') m = m.filter((c) => c.kind === 'video')
    return m
  }, [selectedProject, subTab])

  // 项目列表态:upload/生成 且未选中项目;此时不显示图片/视频子tab
  const showProjectList = (mainTab === 'upload' || mainTab === 'generated') && !selectedProjectId
  const gridCards = selectedProjectId ? projectMedia : visibleCards
  const showSubs = mainTab === 'all' || (!!selectedProjectId && (mainTab === 'upload' || mainTab === 'generated'))
  const subs = MAIN_TABS.find((t) => t.key === mainTab)?.subs || []

  const onSelectMain = (key: (typeof MAIN_TABS)[number]['key']) => {
    setMainTab(key)
    setSubTab('all')
    setSelectedProjectId(0)
  }
  const onSelectSub = (k: string) => {
    setSubTab(k)
  }

  function previewCard(card: any) {
    const index = gridCards.findIndex((c: any) => c.id === card.id)
    openPreview(gridCards, index >= 0 ? index : 0)
  }

  return (
    <div className="rm2-page">
      <AppSidebar
        activeKey="resources"
        onNavigate={handleNavigate}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="rm2-shell">
        <AppTopbar onMenu={() => setSidebarOpen(true)} />

        <section className="rm2-main" aria-label="素材市场">
          {/* 三个主 Tab */}
          <div className="rm2-tabs">
            {MAIN_TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`rm2-tab${mainTab === t.key ? ' is-active' : ''}`}
                onClick={() => onSelectMain(t.key)}
              >
                {t.label}
              </button>
            ))}
            <label className="rm2-search">
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path
                  d="M13.9 13.1 17 16.2M15.4 8.7a6.7 6.7 0 1 1-13.4 0 6.7 6.7 0 0 1 13.4 0Z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
              <input
                value={searchQuery}
                type="text"
                placeholder="搜索素材名称、关键词"
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </label>
          </div>

          {/* 子分类(全部 tab,或进入项目后的图片/视频)*/}
          {showSubs && (
            <div className="rm2-subs">
              {subs.map((s) => (
                <button
                  key={s.k}
                  type="button"
                  className={`rm2-sub${subTab === s.k ? ' is-active' : ''}`}
                  onClick={() => onSelectSub(s.k)}
                >
                  {s.l}
                </button>
              ))}
            </div>
          )}

          {/* 内容 */}
          {showProjectList ? (
            // 我上传的/我生成的:按项目分组的项目列表
            projectsForMode.length ? (
              <div className="rm2-proj-grid">
                {projectsForMode.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="rm2-proj-card"
                    onClick={() => {
                      setSelectedProjectId(p.id)
                      setSubTab('all')
                    }}
                  >
                    <span className="rm2-proj-cover">
                      <LazyVisible className="rm2-proj-cover-inner">
                        {p.cover && p.coverKind === 'video' ? (
                          <video
                            src={p.cover}
                            autoPlay
                            muted
                            loop
                            playsInline
                            preload="metadata"
                            onError={(e) => {
                              ;(e.currentTarget as HTMLVideoElement).style.display = 'none'
                            }}
                          />
                        ) : p.cover ? (
                          <img src={p.cover} alt="" loading="lazy" />
                        ) : (
                          <span className="rm2-proj-cover-ph">📁</span>
                        )}
                      </LazyVisible>
                    </span>
                    <span className="rm2-proj-name" title={p.title}>
                      {p.title}
                    </span>
                    <span className="rm2-proj-count">
                      {[p.imgCount > 0 ? `${p.imgCount} 张图片` : '', p.vidCount > 0 ? `${p.vidCount} 个视频` : '']
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="rm2-empty">暂无项目素材</div>
            )
          ) : (
            <>
              {selectedProjectId ? (
                <div className="rm2-detail-head">
                  <button type="button" className="rm2-back" onClick={() => setSelectedProjectId(0)}>
                    ← 返回项目
                  </button>
                  <span className="rm2-detail-title">{selectedProject?.title}</span>
                </div>
              ) : null}
              {loading && !selectedProjectId && !gridCards.length ? (
                <div className="rm2-empty">加载中…</div>
              ) : !gridCards.length ? (
                <div className="rm2-empty">
                  {mainTab === 'collected'
                    ? '暂无收藏'
                    : selectedProjectId
                      ? '该项目暂无此类素材'
                      : '暂无符合条件的素材'}
                </div>
              ) : (
                <div className="resource-grid">
                  {gridCards.map((card: any) => (
                    <ResourceCard
                      key={card.id}
                      card={card}
                      workspaceId={workspaceId}
                      onPreview={() => previewCard(card)}
                      onAdd={() => {
                        setSelectedAssetForAdd(card)
                        setIsAddMaterialModalVisible(true)
                      }}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      </div>

      <ResourceAddMaterialModal
        visible={isAddMaterialModalVisible}
        assets={visibleCards}
        assetToAdd={selectedAssetForAdd}
        onClose={() => {
          setIsAddMaterialModalVisible(false)
          setSelectedAssetForAdd(null)
        }}
        onAssetAdded={() => showToast('已添加到项目', 'success')}
      />
      <AssetPreviewModal state={previewState} onClose={closePreview} onPrev={goPrev} onNext={goNext} />
    </div>
  )
}
