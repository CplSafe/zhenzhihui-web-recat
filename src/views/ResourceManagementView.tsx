/**
 * 我的素材页面（/resources）
 *
 * 页面职责：统一浏览当前工作空间中的上传素材、AI 生成素材、收藏视频和真人素材。
 * 用户可见效果：
 * - “全部”以图片/视频卡片展示素材；“我上传的/我生成的”先按项目分组，进入项目后再查看具体媒体。
 * - “我收藏的”展示本地收藏并刷新可能过期的签名地址；“真人素材库”读取独立的真人资产数据。
 * - 支持名称/标签搜索、图片/视频筛选、分页、懒加载缩略图，以及在预览弹窗中前后切换。
 * 权限与数据安全：页面按用户和工作空间隔离状态，隐藏无权访问项目的关联素材，并排除人脸脱敏等流程中间产物。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SearchOutlined } from '@ant-design/icons'
import { Pagination } from 'antd'
import '../styles/creative.css'
import './ResourceManagementView.css'
import AppSidebar from '@/components/home/AppSidebar'
import AppTopbar from '@/components/layout/AppTopbar'
import { useCurrentUser, useWorkspaceId } from '@/stores/workspaceSession'
import { useToast } from '@/composables/useToast'
import { useSidebarNavigate } from '@/composables/useSidebarNavigate'
import { favoriteVideoAssetIdOf, loadFavorites } from '@/utils/favoriteVideos'
import { assetStreamUrl } from '@/utils/assetUrl'
import AssetPreviewModal from '@/components/resource/AssetPreviewModal'
import RealPersonLibrary, { REAL_PERSON_ASSET_SOURCE } from '@/components/resource/RealPersonLibrary'
import AiBadge from '@/components/common/AiBadge'
import { useAssetPreview } from '@/composables/useAssetPreview'
import { extractAssetPageItems, getAssetDownloadUrl, getBusinessErrorMessage, listAiTasks } from '@/api/business'
import { listAllCreativeProjects, listAssetPage } from '@/utils/businessPagination'
import {
  isCreativeProjectRestrictedForUser,
  resolveUserId,
  toPlainObject as toPlainObj,
} from '@/utils/creativeDraftMetadata'

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
  {
    key: 'people',
    label: '真人素材库',
    subs: [] as { k: string; l: string }[],
  },
] as const

/** 素材页主标签的受限键类型。 */
type MainTabKey = (typeof MAIN_TABS)[number]['key']
/** 请求未完成或作用域不匹配时复用的稳定空素材数组。 */
const EMPTY_RESOURCE_ITEMS: any[] = []
/** 权限项目 id 尚未加载时复用的稳定空集合。 */
const EMPTY_PROJECT_IDS: ReadonlySet<number> = new Set()
// 界面每页展示 20 项，后端每批预取 100 项，以减少翻页请求同时避免首屏拉取全库。
const RESOURCE_PAGE_SIZE = 20
/** 每次向后端预取的素材数量。 */
const RESOURCE_API_PAGE_SIZE = 100

/** 当前账号/空间下素材分页缓存的完整状态。 */
interface ResourceAssetState {
  workspaceId: number
  userId: number
  items: any[]
  total: number
  totalKnown: boolean
  nextOffset: number
  hasMore: boolean
}

/** 从 URL 查询参数恢复可分享的初始素材标签。 */
function initialMainTab(): MainTabKey {
  // 支持 /resources?tab=people 等可分享入口；未知值统一回退到“全部”。
  const value = new URLSearchParams(window.location.search).get('tab')
  return MAIN_TABS.some((tab) => tab.key === value) ? (value as MainTabKey) : 'all'
}

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

/** 把素材类型映射为界面使用的中文标签。 */
function mapAssetTypeLabel(asset: any, downloadUrl = '') {
  return inferAssetCategory(asset, downloadUrl)
}

/** 把素材类别规范化为筛选和渲染使用的媒体类型。 */
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

// 人脸脱敏/抠脸产物(image.face_detect 输出):正式出片前对分镜图扣掉人脸生成的中间资产,
// 不是用户素材,素材市场不应展示。后端字段不固定,因此把常见字段 + meta_json 整体一起做关键词判定。
function isFaceBlurAsset(asset: any): boolean {
  let metaHints = ''
  try {
    metaHints = JSON.stringify(asset?.meta_json || {})
  } catch {
    metaHints = ''
  }
  const hints = [
    asset?.operation_code,
    asset?.operationCode,
    asset?.prompt,
    asset?.name,
    asset?.file_name,
    asset?.description,
    asset?.category,
    asset?.scene,
    asset?.subject_kind,
    asset?.kind,
    ...(Array.isArray(asset?.tags) ? asset.tags : []),
    asset?.meta_json?.operation_code,
    asset?.meta_json?.operationCode,
    asset?.meta_json?.prompt,
    asset?.meta_json?.name,
    asset?.meta_json?.file_name,
    asset?.meta_json?.description,
    asset?.meta_json?.category,
    asset?.meta_json?.scene,
    asset?.meta_json?.subject_kind,
    asset?.meta_json?.kind,
    metaHints,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  const hasFaceBlurCue = /face[_\s-]?detect|人脸检测|人脸检测抠图|人脸脱敏|脱敏/.test(hints)
  const hasCutoutCue = /抠图|抠脸|背抠图|cutout|matting|segment(?:ation)?|mask|alpha[_\s-]?matte/.test(hints)
  const hasPortraitCue = /人脸|脸部|头像|人像|人物|portrait|person|face|head/.test(hints)

  // 爆款复制(video.replicate)抠图/遮罩中间产物:后端产出固定命名如 replicate-subject-178-masked.png。
  // 这类图既不是用户上传素材、也非最终成片,素材市场不展示。命名固定(mask(ed) + replicate/subject),
  // 不会误伤用户素材(用户很难恰好上传这种命名的图)。
  const hasReplicateMaskCue = /(replicate|subject)[\w\s-]*mask(?:ed)?|mask(?:ed)?[\w\s-]*(replicate|subject)/.test(
    hints,
  )

  return hasFaceBlurCue || hasReplicateMaskCue || (hasCutoutCue && hasPortraitCue)
}

/** 从创建/更新时间字段中取得素材排序时间戳。 */
function assetTimestamp(asset: any): number {
  const raw = asset?.created_at || asset?.createdAt || asset?.updated_at || asset?.updatedAt || ''
  const t = Date.parse(raw || '')
  return Number.isFinite(t) ? t : 0
}

/** 把字节数格式化为易读的 B/KB/MB/GB 文本。 */
function formatBytes(sizeBytes: any) {
  const value = Number(sizeBytes || 0)
  if (!Number.isFinite(value) || value <= 0) return '0 MB'
  if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`
  if (value >= 1024) return `${Math.round(value / 1024)} KB`
  return `${value} B`
}

/** 组合素材来源和媒体类型，生成卡片上的精简标签。 */
function buildAssetTags(asset: any) {
  const tags: string[] = []
  const source = asset?.source === 'upload' ? '上传' : asset?.source || ''
  if (source) tags.push(source)
  const typeLabel = mapAssetTypeLabel(asset)
  if (typeLabel && !tags.includes(typeLabel)) tags.push(typeLabel)
  return tags.slice(0, 3)
}

/** 优先选择可直接内联展示的缩略图或预览地址。 */
function assetInlineUrl(asset: any) {
  return (
    asset?.thumbnail_url || asset?.preview_url || asset?.cover_url || asset?.meta_json?.source_url || asset?.url || ''
  )
}

/** 根据素材类型选择预览媒体、地址和视频封面。 */
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
function projectDraftOf(project: any): any {
  for (const v of [project?.draft_json, project?.draftJson, project?.draft, project?.data?.draft_json]) {
    const d = toPlainObj(v)
    if (d) return d
  }
  return null
}
/** 提取项目更新时间，供素材项目分组排序。 */
function projectTsOf(project: any): number {
  const raw = project?.updated_at || project?.updatedAt || project?.created_at || project?.createdAt || ''
  const t = Date.parse(raw || '')
  return Number.isFinite(t) ? t : 0
}

/** 从不同接口和历史元数据字段中解析素材关联的项目 id。 */
export function resourceAssetProjectId(asset: unknown): number {
  // 兼容不同接口和历史草稿的字段命名，用于后续按项目权限过滤关联素材。
  const record = asset as any
  const id = Number(
    record?.project_id ??
      record?.projectId ??
      record?.creative_project_id ??
      record?.creativeProjectId ??
      record?.meta_json?.project_id ??
      record?.meta_json?.projectId ??
      record?.data?.project_id ??
      record?.data?.projectId ??
      0,
  )
  return Number.isFinite(id) && id > 0 ? Math.floor(id) : 0
}
/** 把未知媒体值安全收敛为普通对象。 */
function mediaRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {}
}

/** 从字符串或不同媒体对象字段中提取展示 URL。 */
function mediaUrlOf(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  const record = mediaRecord(value)
  return String(
    record.url ||
      record.src ||
      record.image ||
      record.imageUrl ||
      record.image_url ||
      record.videoUrl ||
      record.video_url ||
      '',
  ).trim()
}

/** 从一个项目草稿提取该项目的「上传」或「生成」媒体,转成素材卡片 */
function projectMediaCards(
  project: any,
  mode: 'upload' | 'generated',
  wsId: number,
  assetsById: ReadonlyMap<number, any>,
): any[] {
  const draft = projectDraftOf(project)
  if (!draft) return []
  const smart = toPlainObj(draft.smart) || draft
  const ts = projectTsOf(project)
  const title = String(project?.title || project?.name || '').trim() || '未命名项目'
  const out: any[] = []
  const seen = new Set<string>()
  const add = (assetId: number, rawUrl: unknown, kind: 'image' | 'video', metadata: unknown = null) => {
    const url = assetId ? assetStreamUrl(assetId, wsId) : mediaUrlOf(rawUrl)
    if (!url) return
    const key = assetId ? `a${assetId}` : `u${url}`
    if (seen.has(key)) return
    seen.add(key)
    const serverAsset = assetId ? assetsById.get(assetId) : null
    const rawRecord = mediaRecord(rawUrl)
    const metadataRecord = mediaRecord(metadata)
    const itemTitle = String(
      serverAsset?.name ||
        serverAsset?.title ||
        rawRecord.name ||
        rawRecord.title ||
        metadataRecord.name ||
        metadataRecord.title ||
        title,
    ).trim()
    const itemTags = [
      ...(Array.isArray(serverAsset?.tags) ? serverAsset.tags : []),
      ...(Array.isArray(rawRecord.tags) ? rawRecord.tags : []),
      ...(Array.isArray(metadataRecord.tags) ? metadataRecord.tags : []),
      ...buildAssetTags(serverAsset),
    ]
      .map((tag) => String(tag || '').trim())
      .filter(Boolean)
    out.push({
      id: assetId || key,
      assetId,
      workspaceId: wsId,
      title: itemTitle || title,
      type: kind === 'video' ? '视频' : '图片',
      tags: [...new Set(itemTags)].slice(0, 6),
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
    imgs.forEach((u: any, i: number) => add(Number(aids[i] || 0) || 0, u, 'image', u))
    // 上传的源视频(爆款复制旧字段:entryMeta)
    const sv = String(em.sourceVideo || em.source_video || em.video || '').trim()
    const svAid = Number(em.sourceVideoAssetId || em.videoAssetId || 0) || 0
    if (sv || svAid) add(svAid, sv, 'video', em)
    // 爆款复制:替换素材图 + 源视频实际存在 smart 块(productAssetIds / sourceVideo),entryMeta 里没有 → 这里补上
    arr(smart?.productAssetIds || smart?.product_asset_ids).forEach((id: any) => add(Number(id || 0) || 0, '', 'image'))
    const hcv = smart?.sourceVideo || smart?.source_video
    if (hcv && typeof hcv === 'object') {
      add(Number(hcv.assetId || hcv.asset_id || 0) || 0, hcv, 'video', hcv)
    }
  } else {
    // 生成的分镜图
    for (const s of arr(smart?.shots)) {
      add(
        Number(s?.imageAssetId || s?.image_asset_id || 0) || 0,
        s?.image || s?.imageUrl || s?.image_url || '',
        'image',
        s,
      )
    }
    // 生成的视频
    for (const v of arr(smart?.videoVersions)) {
      add(Number(v?.assetId || v?.asset_id || 0) || 0, v, 'video', v)
    }
    const gvAid = Number(draft?.generatedVideoAssetId || smart?.fullVideoAssetId || 0) || 0
    const gv = String(draft?.generatedVideoUrl || smart?.fullVideoUrl || '').trim()
    if (gv || gvAid) add(gvAid, gv, 'video', smart)
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
/** 将真实宽高吸附到常见比例，其他尺寸使用最大公约数约分。 */
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
  const assetId = Number(card?.assetId ?? card?.id ?? 0) || 0
  const requestScope = `${Number(workspaceId || 0)}:${assetId}:${String(card?.mediaUrl || '')}`
  const requestScopeRef = useRef(requestScope)
  requestScopeRef.current = requestScope
  useEffect(() => {
    if (!inView) return
    let cancelled = false
    const scope = requestScope
    setSrc(card.mediaUrl || '')
    triedRef.current = false
    // 无内联地址:直接按 assetId 取签名地址(否则 img 不渲染、永远占位)
    if (!card.mediaUrl) {
      if (assetId > 0) {
        triedRef.current = true
        getAssetDownloadUrl({ workspaceId, assetId })
          .then((u) => {
            if (!cancelled && requestScopeRef.current === scope) setSrc(u || '')
          })
          .catch(() => {})
      }
    }
    return () => {
      cancelled = true
    }
  }, [assetId, card.mediaUrl, inView, requestScope, workspaceId])
  const handleError = useCallback(async () => {
    if (triedRef.current) {
      setSrc('')
      return
    }
    triedRef.current = true
    if (assetId <= 0) {
      setSrc('')
      return
    }
    const scope = requestScopeRef.current
    try {
      const fresh = await getAssetDownloadUrl({ workspaceId, assetId })
      if (requestScopeRef.current === scope) setSrc(fresh || '')
    } catch {
      if (requestScopeRef.current === scope) setSrc('')
    }
  }, [assetId, workspaceId])
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
function ResourceCard({ card, workspaceId, onPreview }: { card: any; workspaceId: any; onPreview: () => void }) {
  const [ratio, setRatio] = useState<string>(card.duration || '')
  return (
    <article className="resource-asset-card">
      <button type="button" className="resource-asset-cover" aria-label={`预览${card.title}`} onClick={onPreview}>
        <AssetThumb card={card} workspaceId={workspaceId} onRatio={setRatio} />
        {card.isAi && card.mediaKind === 'image' && <AiBadge />}
        <span className="resource-asset-type">{card.type}</span>
      </button>
      <div className="resource-asset-info">
        <div className="resource-asset-meta">
          {ratio ? <span className="resource-asset-ratio">比例 {ratio}</span> : <span />}
          {card.size ? <span className="resource-asset-size">{card.size}</span> : null}
        </div>
      </div>
    </article>
  )
}

/** 加载并渲染当前账号/空间下的素材分类、项目分组和真人素材库。 */
export default function ResourceManagementView() {
  const workspaceId = useWorkspaceId()
  const currentUser = useCurrentUser()
  const currentUserId = resolveUserId(currentUser)
  const currentWorkspaceId = Number(workspaceId || 0)
  // 所有异步结果都绑定“工作空间 + 用户”作用域，切换任一身份后旧结果不得继续渲染。
  const accessScope = `${currentWorkspaceId}:${currentUserId}`
  const { showToast } = useToast()
  const { previewState, openPreview, closePreview, goPrev, goNext } = useAssetPreview()

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [mainTab, setMainTab] = useState<MainTabKey>(initialMainTab)
  const [subTab, setSubTab] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [loadingMoreAssets, setLoadingMoreAssets] = useState(false)
  const [assetState, setAssetState] = useState<ResourceAssetState>({
    workspaceId: 0,
    userId: 0,
    items: [],
    total: 0,
    totalKnown: true,
    nextOffset: 0,
    hasMore: false,
  })
  const rawAssets =
    assetState.workspaceId === currentWorkspaceId && assetState.userId === currentUserId
      ? assetState.items
      : EMPTY_RESOURCE_ITEMS
  const assetStateRef = useRef(assetState)
  assetStateRef.current = assetState
  const assetScopeSequenceRef = useRef(0)
  const assetLoadPromiseRef = useRef<Promise<void> | null>(null)
  const currentAssetScopeRef = useRef(accessScope)
  currentAssetScopeRef.current = accessScope
  const faceTaskIdsRef = useRef<Set<number>>(new Set())

  // 我上传的/我生成的:先按创意项目分组,进项目后再按图片/视频分
  const [projectState, setProjectState] = useState<{
    workspaceId: number
    userId: number
    items: any[]
    accessibleProjectIds: Set<number>
    loaded: boolean
  }>({
    workspaceId: 0,
    userId: 0,
    items: [],
    accessibleProjectIds: new Set(),
    loaded: false,
  })
  const projectStateIsCurrent = projectState.workspaceId === currentWorkspaceId && projectState.userId === currentUserId
  const projectList = projectStateIsCurrent ? projectState.items : EMPTY_RESOURCE_ITEMS
  const accessibleProjectIds = projectStateIsCurrent ? projectState.accessibleProjectIds : EMPTY_PROJECT_IDS
  const projectPermissionsLoaded = projectStateIsCurrent && projectState.loaded
  const [selectedProjectId, setSelectedProjectId] = useState(0)
  const [favoriteCardState, setFavoriteCardState] = useState<{ workspaceId: number; userId: number; items: any[] }>({
    workspaceId: 0,
    userId: 0,
    items: [],
  })
  const favoriteCards =
    favoriteCardState.workspaceId === currentWorkspaceId && favoriteCardState.userId === currentUserId
      ? favoriteCardState.items
      : EMPTY_RESOURCE_ITEMS
  const previousAccessScopeRef = useRef(accessScope)

  const handleNavigate = useSidebarNavigate()

  // 工作空间变更时使旧详情和共享预览失效；渲染阶段还有 workspace 标签校验，避免 effect 前的一帧串数据。
  useEffect(() => {
    if (previousAccessScopeRef.current !== accessScope) {
      closePreview()
      setSelectedProjectId(0)
      setSubTab('all')
    }
    previousAccessScopeRef.current = accessScope
    // closePreview 是 useAssetPreview 返回的命令函数，不作为响应式依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessScope])

  // 首屏只取一个服务端分页。后续页由分页交互按需加载，不再等待全量串行请求。
  useEffect(() => {
    let cancelled = false
    const wsId = currentWorkspaceId
    const userId = currentUserId
    const scope = accessScope
    const scopeSequence = ++assetScopeSequenceRef.current
    const emptyState: ResourceAssetState = {
      workspaceId: wsId,
      userId,
      items: [],
      total: 0,
      totalKnown: true,
      nextOffset: 0,
      hasMore: false,
    }
    assetStateRef.current = emptyState
    setAssetState(emptyState)
    faceTaskIdsRef.current = new Set()
    assetLoadPromiseRef.current = null
    setLoadingMoreAssets(false)
    if (!wsId) {
      setLoading(false)
      return
    }
    setLoading(true)
    // 并行:① 素材列表;② image.face_detect(人脸脱敏/抠脸)任务列表 —— 用其 task_id 集合精确剔除
    // 脱敏中间产物。asset 对象带 task_id,凡命中脱敏任务的一律不展示(比关键词判定可靠,漏不掉)。
    // 任务列表拉取失败不阻塞素材展示,退回仅用 isFaceBlurAsset() 关键词兜底。
    Promise.all([
      listAssetPage({
        workspaceId: wsId,
        status: 'active',
        pageSize: RESOURCE_API_PAGE_SIZE,
        isCurrent: () =>
          !cancelled && assetScopeSequenceRef.current === scopeSequence && currentAssetScopeRef.current === scope,
      }),
      listAiTasks({ workspaceId: wsId, operationCode: 'image.face_detect', limit: 100 }).catch(() => null),
    ])
      .then(([assetPage, taskPayload]) => {
        if (cancelled) return
        const faceTaskIds = new Set<number>()
        for (const t of extractAssetPageItems(taskPayload)) {
          const id = Number(t?.id || 0) || 0
          if (id) faceTaskIds.add(id)
        }
        faceTaskIdsRef.current = faceTaskIds
        const items = Array.isArray(assetPage.items) ? assetPage.items : []
        // 双保险:① task_id 命中脱敏任务;② 关键词兜底(任务列表拉取失败时仍生效)
        const nextState: ResourceAssetState = {
          workspaceId: wsId,
          userId,
          items: items.filter((a: any) => {
            const taskId = Number(a?.task_id ?? a?.taskId ?? 0) || 0
            if (taskId && faceTaskIds.has(taskId)) return false
            return !isFaceBlurAsset(a)
          }),
          total: assetPage.total,
          totalKnown: assetPage.totalKnown,
          nextOffset: assetPage.nextOffset,
          hasMore: assetPage.hasMore,
        }
        assetStateRef.current = nextState
        setAssetState(nextState)
      })
      .catch((error) => {
        if (cancelled) return
        assetStateRef.current = emptyState
        setAssetState(emptyState)
        showToast(getBusinessErrorMessage(error, '素材加载失败'), 'error')
      })
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
      assetScopeSequenceRef.current += 1
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessScope])

  // 按服务端 offset 增量加载：复用进行中的 Promise、去重资产，并丢弃身份切换后的迟到响应。
  const loadNextAssetPage = useCallback(() => {
    const wsId = currentWorkspaceId
    const userId = currentUserId
    const scope = accessScope
    if (!wsId) return Promise.resolve()
    if (assetLoadPromiseRef.current) return assetLoadPromiseRef.current

    const scopeSequence = assetScopeSequenceRef.current
    const promise = (async () => {
      setLoadingMoreAssets(true)
      try {
        const current = assetStateRef.current
        if (
          current.workspaceId !== wsId ||
          current.userId !== userId ||
          !current.hasMore ||
          assetScopeSequenceRef.current !== scopeSequence ||
          currentAssetScopeRef.current !== scope
        ) {
          return
        }

        const nextPage = await listAssetPage({
          workspaceId: wsId,
          status: 'active',
          pageSize: RESOURCE_API_PAGE_SIZE,
          offset: current.nextOffset,
          isCurrent: () => assetScopeSequenceRef.current === scopeSequence && currentAssetScopeRef.current === scope,
        })
        if (assetScopeSequenceRef.current !== scopeSequence || currentAssetScopeRef.current !== scope) return

        const latest = assetStateRef.current
        if (latest.workspaceId !== wsId || latest.userId !== userId) return
        const seen = new Set(latest.items.map((item) => String(item?.id ?? item?.asset_id ?? '')))
        const incoming = nextPage.items.filter((item: any) => {
          const taskId = Number(item?.task_id ?? item?.taskId ?? 0) || 0
          if (taskId && faceTaskIdsRef.current.has(taskId)) return false
          if (isFaceBlurAsset(item)) return false
          const key = String(item?.id ?? item?.asset_id ?? '')
          return !key || !seen.has(key)
        })
        const madeProgress = nextPage.nextOffset > latest.nextOffset
        const nextState: ResourceAssetState = {
          workspaceId: wsId,
          userId,
          items: [...latest.items, ...incoming],
          total: nextPage.totalKnown ? nextPage.total : Math.max(latest.total, nextPage.total),
          totalKnown: nextPage.totalKnown || latest.totalKnown,
          nextOffset: nextPage.nextOffset,
          hasMore: nextPage.hasMore && madeProgress,
        }
        assetStateRef.current = nextState
        setAssetState(nextState)
      } catch (error) {
        if (assetScopeSequenceRef.current === scopeSequence && currentAssetScopeRef.current === scope) {
          // 加载后续页失败时保留已经成功展示的页；用户重试仍从相同服务端 offset 继续。
          showToast(getBusinessErrorMessage(error, '更多素材加载失败，请稍后重试'), 'error')
        }
      } finally {
        if (assetScopeSequenceRef.current === scopeSequence && currentAssetScopeRef.current === scope) {
          setLoadingMoreAssets(false)
        }
      }
    })()
    assetLoadPromiseRef.current = promise
    promise.finally(() => {
      if (assetLoadPromiseRef.current === promise) assetLoadPromiseRef.current = null
    })
    return promise
  }, [accessScope, currentUserId, currentWorkspaceId, showToast])

  // 加载创意项目(含草稿)→ 我上传的/我生成的 按项目分组的数据源
  useEffect(() => {
    let cancelled = false
    const wsId = currentWorkspaceId
    setProjectState({
      workspaceId: wsId,
      userId: currentUserId,
      items: [],
      accessibleProjectIds: new Set(),
      loaded: false,
    })
    if (!wsId) {
      return
    }
    listAllCreativeProjects({
      workspaceId: wsId,
      isCurrent: () => !cancelled && currentWorkspaceId === wsId,
    })
      .then((items: any) => {
        if (!cancelled) {
          const allItems = Array.isArray(items) ? items : []
          const accessibleItems = allItems.filter(
            (project) => !isCreativeProjectRestrictedForUser(project, currentUserId),
          )
          const nextAccessibleProjectIds = new Set<number>()
          accessibleItems.forEach((project) => {
            const id = Number(project?.id ?? project?.project_id ?? project?.projectId ?? project?.data?.id ?? 0) || 0
            if (id > 0) nextAccessibleProjectIds.add(id)
          })
          setProjectState({
            workspaceId: wsId,
            userId: currentUserId,
            items: accessibleItems,
            accessibleProjectIds: nextAccessibleProjectIds,
            loaded: true,
          })
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProjectState({
            workspaceId: wsId,
            userId: currentUserId,
            items: [],
            accessibleProjectIds: new Set(),
            loaded: false,
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [currentUserId, currentWorkspaceId])

  // 收藏中的签名地址可能已过期；优先用稳定 assetId 为当前工作空间换取新地址，失败才回退旧地址。
  useEffect(() => {
    let cancelled = false
    const wsId = currentWorkspaceId
    if (!wsId || mainTab !== 'collected') {
      setFavoriteCardState({ workspaceId: wsId, userId: currentUserId, items: [] })
      return
    }

    const favorites = loadFavorites(wsId)
    const toCard = (favorite: (typeof favorites)[number], mediaUrl: string) => {
      const assetId = favoriteVideoAssetIdOf(favorite)
      return {
        id: favorite.key,
        assetId,
        workspaceId: wsId,
        title: favorite.title,
        type: '视频',
        tags: [],
        duration: favorite.ratio || '',
        size: '',
        source: 'collected',
        kind: 'video',
        roleScene: '',
        isAi: true,
        ts: favorite.ts || 0,
        mediaKind: 'video',
        mediaUrl,
        posterUrl: favorite.thumbnailUrl,
      }
    }
    setFavoriteCardState({
      workspaceId: wsId,
      userId: currentUserId,
      items: favorites.map((favorite) => toCard(favorite, favorite.videoUrl || '')),
    })

    Promise.all(
      favorites.map(async (favorite) => {
        const assetId = favoriteVideoAssetIdOf(favorite)
        if (!assetId) return toCard(favorite, favorite.videoUrl || '')
        const freshUrl = await getAssetDownloadUrl({ workspaceId: wsId, assetId }).catch(() => '')
        return toCard(favorite, String(freshUrl || favorite.videoUrl || '').trim())
      }),
    ).then((items) => {
      if (!cancelled) setFavoriteCardState({ workspaceId: wsId, userId: currentUserId, items })
    })

    return () => {
      cancelled = true
    }
  }, [currentUserId, currentWorkspaceId, mainTab])

  // 关联了项目的素材必须等权限列表加载完成后再展示；无项目归属的独立素材不受此筛选影响。
  const visibleRawAssets = useMemo(
    () =>
      rawAssets.filter((asset) => {
        const projectId = resourceAssetProjectId(asset)
        if (!projectId) return true
        if (!projectPermissionsLoaded) return false
        return accessibleProjectIds.has(projectId)
      }),
    [accessibleProjectIds, projectPermissionsLoaded, rawAssets],
  )
  const rawAssetById = useMemo(() => {
    const index = new Map<number, any>()
    for (const asset of rawAssets) {
      const id = Number(asset?.id ?? asset?.asset_id ?? asset?.assetId ?? 0) || 0
      if (id > 0) index.set(id, asset)
    }
    return index
  }, [rawAssets])

  const cards = useMemo(
    () =>
      visibleRawAssets
        .filter((asset) => String(asset?.source || '') !== REAL_PERSON_ASSET_SOURCE)
        .map((asset, i) => {
          const prev = resolveAssetPreview(asset)
          const kind = assetKindOf(asset)
          // mediaKind 始终按资产类型给出(即使暂无内联地址),保证 img/video 元素渲染 → 失败时按 assetId 重取
          const mediaKind = kind === 'image' ? 'image' : kind === 'video' ? 'video' : prev.mediaKind
          return {
            id: asset?.id ?? `asset-${i}`,
            assetId: Number(asset?.id || 0) || 0,
            workspaceId: currentWorkspaceId,
            title: asset?.name || `素材 ${i + 1}`,
            type: mapAssetTypeLabel(asset),
            tags: buildAssetTags(asset),
            duration: asset?.duration || asset?.ratio || '3:4',
            size: formatBytes(asset?.size_bytes),
            source: String(asset?.source || ''),
            kind,
            roleScene: assetSceneRole(asset),
            // 非「上传」即视为 AI 生成(source 可能是 'ai'/'generated'/空,与「我生成的」tab 的过滤口径一致),
            // 修复:空 source 的 AI 素材之前漏了徽章。
            isAi: asset?.source !== 'upload',
            ts: assetTimestamp(asset),
            mediaKind,
            mediaUrl: prev.mediaUrl,
            posterUrl: prev.posterUrl,
          }
        }),
    [currentWorkspaceId, visibleRawAssets],
  )

  // 主标签决定数据来源，子标签和关键词继续做客户端筛选，最终统一按操作时间倒序。
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
      base = favoriteCards
    }
    if (keyword) base = base.filter((c) => [c.title, ...(c.tags || [])].join(' ').toLowerCase().includes(keyword))
    return base.slice().sort((a, b) => b.ts - a.ts)
  }, [cards, favoriteCards, mainTab, subTab, searchQuery])

  // 我上传的/我生成的:按项目分组(只列出有对应媒体的项目)
  const allProjectsForMode = useMemo(() => {
    if (mainTab !== 'upload' && mainTab !== 'generated') return []
    const wsId = currentWorkspaceId
    return projectList
      .map((p) => {
        const media = projectMediaCards(p, mainTab as 'upload' | 'generated', wsId, rawAssetById)
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
      .sort((a, b) => b.ts - a.ts)
  }, [currentWorkspaceId, mainTab, projectList, rawAssetById])

  const projectsForMode = useMemo(() => {
    const keyword = searchQuery.trim().toLowerCase()
    if (!keyword) return allProjectsForMode
    return allProjectsForMode.filter(
      (project) =>
        project.title.toLowerCase().includes(keyword) ||
        project.media.some((card: any) => [card.title, ...(card.tags || [])].join(' ').toLowerCase().includes(keyword)),
    )
  }, [allProjectsForMode, searchQuery])

  const selectedProject = useMemo(
    () => allProjectsForMode.find((p) => p.id === selectedProjectId) || null,
    [allProjectsForMode, selectedProjectId],
  )
  const projectMedia = useMemo(() => {
    if (!selectedProject) return []
    let m = selectedProject.media as any[]
    if (subTab === 'image') m = m.filter((c) => c.kind === 'image')
    else if (subTab === 'video') m = m.filter((c) => c.kind === 'video')
    const keyword = searchQuery.trim().toLowerCase()
    if (keyword) {
      m = m.filter((card) => [card.title, ...(card.tags || [])].join(' ').toLowerCase().includes(keyword))
    }
    return m
  }, [searchQuery, selectedProject, subTab])

  // 项目列表态:upload/生成 且未选中项目;此时不显示图片/视频子tab
  const showProjectList = (mainTab === 'upload' || mainTab === 'generated') && !selectedProjectId
  const gridCards = selectedProjectId ? projectMedia : visibleCards
  const showSubs = mainTab === 'all' || (!!selectedProjectId && (mainTab === 'upload' || mainTab === 'generated'))
  const subs = MAIN_TABS.find((t) => t.key === mainTab)?.subs || []
  // 项目列表和素材网格共用分页状态；“全部”标签可在进入后续页时继续向服务端增量取数。
  const paginatedItems = showProjectList ? projectsForMode : gridCards
  const usesIncrementalAssetPages = mainTab === 'all' && !selectedProjectId
  const hasActiveClientAssetFilter = usesIncrementalAssetPages && (Boolean(searchQuery.trim()) || subTab !== 'all')
  const paginationTotal = showProjectList
    ? projectsForMode.length
    : usesIncrementalAssetPages &&
        !hasActiveClientAssetFilter &&
        assetState.workspaceId === currentWorkspaceId &&
        assetState.userId === currentUserId &&
        assetState.hasMore
      ? Math.max(gridCards.length, assetState.total)
      : gridCards.length
  const totalPages = Math.max(1, Math.ceil(paginationTotal / RESOURCE_PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const paginatedProjects = useMemo(
    () => projectsForMode.slice((safePage - 1) * RESOURCE_PAGE_SIZE, safePage * RESOURCE_PAGE_SIZE),
    [projectsForMode, safePage],
  )
  const paginatedCards = useMemo(
    () => gridCards.slice((safePage - 1) * RESOURCE_PAGE_SIZE, safePage * RESOURCE_PAGE_SIZE),
    [gridCards, safePage],
  )

  useEffect(() => {
    setPage(1)
  }, [accessScope, mainTab, searchQuery, selectedProjectId, subTab])

  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  useEffect(() => {
    if (!usesIncrementalAssetPages || !assetState.hasMore) return
    // 搜索和子类型筛选只针对已加载页立即返回结果。后续页由明确的
    // “继续搜索/加载更多”交互触发，避免一次输入串行拉完整个素材库。
    if (hasActiveClientAssetFilter) return
    // 服务端 offset 统计原始资产，而页面会过滤真人、脱敏和无权限素材。
    // 用户明确进入后续页时，以可见卡片数量判断是否还要取下一批，避免原始
    // offset 已越过目标但当前页仍为空。
    if (safePage > 1 && gridCards.length < safePage * RESOURCE_PAGE_SIZE && !loadingMoreAssets) {
      void loadNextAssetPage()
    }
  }, [
    assetState.hasMore,
    gridCards.length,
    hasActiveClientAssetFilter,
    loadNextAssetPage,
    loadingMoreAssets,
    safePage,
    usesIncrementalAssetPages,
  ])

  // 切换主标签时清空子筛选与项目详情，并同步 URL，刷新或分享链接后仍能恢复当前素材分类。
  const onSelectMain = (key: MainTabKey) => {
    setMainTab(key)
    setSubTab('all')
    setSelectedProjectId(0)
    const params = new URLSearchParams(window.location.search)
    if (key === 'all') params.delete('tab')
    else params.set('tab', key)
    const query = params.toString()
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${query ? `?${query}` : ''}`)
  }
  const onSelectSub = (k: string) => {
    setSubTab(k)
  }

  // 预览器接收当前筛选结果与点击索引，因此左右切换不会跳到筛选范围之外。
  function previewCard(card: any) {
    const index = gridCards.findIndex((c: any) => c.id === card.id)
    const previewItems = gridCards.map((item: any) => ({ ...item, workspaceId: currentWorkspaceId }))
    openPreview(previewItems, index >= 0 ? index : 0)
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

        <section className="rm2-main" aria-label="我的素材">
          {/* 主 Tab */}
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
              <SearchOutlined aria-hidden="true" />
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
          {mainTab === 'people' ? (
            <RealPersonLibrary key={currentWorkspaceId} workspaceId={currentWorkspaceId} query={searchQuery} />
          ) : showProjectList ? (
            // 我上传的/我生成的:按项目分组的项目列表
            projectsForMode.length ? (
              <>
                <div className="rm2-proj-grid">
                  {paginatedProjects.map((p) => (
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
                {paginatedItems.length > RESOURCE_PAGE_SIZE ? (
                  <div className="rm2-pagination" aria-label="项目分页">
                    <Pagination
                      current={safePage}
                      pageSize={RESOURCE_PAGE_SIZE}
                      total={paginatedItems.length}
                      showSizeChanger={false}
                      showLessItems
                      onChange={setPage}
                    />
                  </div>
                ) : null}
              </>
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
              {(loading || loadingMoreAssets) && !selectedProjectId && !gridCards.length ? (
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
                  {paginatedCards.map((card: any) => (
                    <ResourceCard
                      key={card.id}
                      card={card}
                      workspaceId={workspaceId}
                      onPreview={() => previewCard(card)}
                    />
                  ))}
                </div>
              )}
              {paginationTotal > RESOURCE_PAGE_SIZE ? (
                <div className="rm2-pagination" aria-label="素材分页">
                  <Pagination
                    current={safePage}
                    pageSize={RESOURCE_PAGE_SIZE}
                    total={paginationTotal}
                    showSizeChanger={false}
                    showLessItems
                    onChange={setPage}
                  />
                </div>
              ) : null}
              {hasActiveClientAssetFilter && assetState.hasMore ? (
                <div className="rm2-pagination" aria-label="继续搜索素材">
                  <button
                    type="button"
                    className="rm2-back"
                    disabled={loadingMoreAssets}
                    onClick={() => void loadNextAssetPage()}
                  >
                    {loadingMoreAssets
                      ? '正在加载更多素材…'
                      : searchQuery.trim()
                        ? '继续搜索更多素材'
                        : '加载更多此类素材'}
                  </button>
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>

      <AssetPreviewModal state={previewState} onClose={closePreview} onPrev={goPrev} onNext={goNext} />
    </div>
  )
}
