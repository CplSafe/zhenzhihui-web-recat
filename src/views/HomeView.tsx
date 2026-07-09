/**
 * 2.1 首页（自包含静态实现，纯前端占位数据，不接后端）。
 * 组合 <AppSidebar/> + 内容区：简洁顶栏 / 轮播 Banner / 快捷入口 / 标签切换 + 搜索 / 模板网格。
 * 导航跳转用 react-router useNavigate；已存在路由直接跳转，未实现的项 console 占位。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AppSidebar from '@/components/home/AppSidebar'
import AppTopbar from '@/components/layout/AppTopbar'
import { useWorkspaceId, useCurrentUser } from '@/stores/workspaceSession'
import { openComingSoon } from '@/stores/ui'
import { openGuide, isGuideSeen } from '@/stores/guide'
import { useAuth } from '@/auth/AuthContext'
import { resolveProjectPath } from '@/utils/projectRoute'
import { listCreativeProjects, getAssetDownloadUrl } from '@/api/business'
import { listBanners, type Banner } from '@/api/banners'
import { isSafeMediaUrl } from '@/utils/urlSafety'
import { favoriteKeyOf, loadFavoriteKeys, toggleFavorite } from '@/utils/favoriteVideos'
import { useRequireAuth } from '@/composables/useRequireAuth'
import { useSidebarNavigate } from '@/composables/useSidebarNavigate'
// banner 数据走 SWR 缓存(先返缓存秒出、后台刷新);切换前预取相邻媒体,见下方接入处。
import { swrFetch, peekCache } from '@/utils/swrCache'
import { preloadMedia, type MediaItem } from '@/utils/mediaPreload'

/** 首页轮播数据的 SWR 缓存键 */
const BANNERS_CACHE_KEY = 'home-banners'
import quick1 from '@/assets/home/quick-1.png'
import quick2 from '@/assets/home/quick-2.png'
import quick3 from '@/assets/home/quick-3.png'
import quick4 from '@/assets/home/quick-4.png'
import VideoPreviewModal from '@/components/common/VideoPreviewModal'
import { downloadToDisk, buildDownloadName } from '@/utils/downloadToDisk'
import './HomeView.css'

/* 从项目记录里取标题 / 封面 / id（字段名后端不统一，做兜底） */
function projectTitle(p: any): string {
  return String(p?.title || p?.name || p?.project_name || '').trim() || '未命名项目'
}
function projectId(p: any): number {
  return Number(p?.id || p?.project_id || p?.projectId || 0)
}

/* 工具：JSON 解析 / 数组标准化 / 图片 URL 提取 */
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
function imgOf(value: any): string {
  if (typeof value === 'string') return value.trim()
  if (!value || typeof value !== 'object') return ''
  return String(
    value.src ||
      value.url ||
      value.image ||
      value.imageUrl ||
      value.image_url ||
      value.thumbnailUrl ||
      value.thumbnail_url ||
      '',
  ).trim()
}

/* 从草稿里提取视频 URL 和 assetId */
function extractVideoInfo(p: any): { url: string; assetId: number } {
  const draft = toPlainObject(p?.draft_json) || toPlainObject(p?.draftJson) || toPlainObject(p?.draft)
  if (!draft) return { url: '', assetId: 0 }
  const smart = draft?.smart && typeof draft.smart === 'object' ? draft.smart : draft

  // videoVersions（含 url + assetId）
  const vv = normalizeArray(smart?.videoVersions || draft?.videoVersions)
  for (const v of vv) {
    const url = imgOf(v)
    const aid = Number(v?.assetId || v?.asset_id || 0) || 0
    if ((url && isSafeMediaUrl(url)) || aid) return { url: isSafeMediaUrl(url) ? url : '', assetId: aid }
  }

  // generatedVideo / fullVideoUrl（可能只有 url）
  const gv =
    draft?.generatedVideoUrl ||
    draft?.generated_video_url ||
    smart?.fullVideoUrl ||
    smart?.full_video_url ||
    smart?.generatedVideoUrl ||
    smart?.generated_video_url ||
    ''
  const gvAid =
    Number(draft?.generatedVideoAssetId || smart?.fullVideoAssetId || smart?.generatedVideoAssetId || 0) || 0
  if ((gv && isSafeMediaUrl(gv)) || gvAid) return { url: isSafeMediaUrl(gv) ? gv : '', assetId: gvAid }

  // videoHistoryList
  const vh = normalizeArray(draft?.videoHistoryList || draft?.video_history_list)
  for (const v of vh) {
    const url = imgOf(v)
    const aid = Number(v?.assetId || v?.asset_id || 0) || 0
    if ((url && isSafeMediaUrl(url)) || aid) return { url: isSafeMediaUrl(url) ? url : '', assetId: aid }
  }

  return { url: '', assetId: 0 }
}

/* 从草稿里提取视频比例 */
function projectRatio(p: any): string {
  const draft = toPlainObject(p?.draft_json) || toPlainObject(p?.draftJson) || toPlainObject(p?.draft)
  if (!draft) return ''
  const smart = draft?.smart && typeof draft.smart === 'object' ? draft.smart : draft
  return String(smart?.entryMeta?.ratio || smart?.entry_meta?.ratio || draft?.selectedRatio || '').trim()
}

/* 轮播统一渲染结构:兼容后端 /api/v1/banners(视频/图 + 外链)与本地占位兜底 */
interface Slide {
  id: number | string
  mediaUrl: string
  mediaType: 'image' | 'video'
  /** 占位用:带强调色的三段式标题 */
  pre?: string
  em?: string
  post?: string
  /** 后端用:整段标题 */
  title?: string
  sub: string
  /** 后端外链 */
  linkUrl?: string
  /** 占位站内跳转 */
  action?: string
  /** 占位 CTA 文案 */
  btn?: string
}

// 轮播只用横屏视频(w>h),适配宽幅 banner;按真实比例显示
const DEMO_SLIDES: Slide[] = DEMO_LANDSCAPE_URLS.map((url, i) => ({
  id: `demo-${i}`,
  mediaUrl: url,
  mediaType: 'video',
  sub: '',
}))

// 后端 Banner → Slide
function bannerToSlide(b: Banner): Slide {
  return {
    id: b.id,
    mediaUrl: b.mediaUrl,
    mediaType: b.mediaType,
    title: b.title,
    sub: b.description,
    linkUrl: b.linkUrl,
  }
}

/* 轮播视频:成为焦点(active)时从头静音播放;播放结束 / 出错回调 onDone 切下一张,非焦点暂停 */
function BannerVideo({ src, active, onDone }: { src: string; active: boolean; onDone: () => void }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const v = ref.current
    if (!v) return
    if (active) {
      try {
        v.currentTime = 0
      } catch {
        /* 某些浏览器元数据未就绪时设置会抛错,忽略 */
      }
      v.play().catch(() => {})
    } else {
      v.pause()
    }
  }, [active])
  return (
    <video
      ref={ref}
      className="home__bcard-video"
      src={src}
      muted
      playsInline
      /* 只让焦点视频整段缓冲,其余只取首帧,避免多路视频同时下载导致卡顿 */
      preload={active ? 'auto' : 'metadata'}
      autoPlay={active}
      controls={false}
      disablePictureInPicture
      controlsList="nodownload nofullscreen noremoteplayback noplaybackrate"
      onContextMenu={(e) => e.preventDefault()}
      onLoadedData={(e) => {
        if (active) (e.currentTarget as HTMLVideoElement).play().catch(() => {})
      }}
      onEnded={() => {
        if (active) onDone()
      }}
      onError={() => {
        console.warn('[banner] 视频加载失败:', src)
        if (active) onDone()
      }}
    />
  )
}

/* 快捷入口 4 卡（图标为 Figma 导出）*/
const QUICK_ENTRIES = [
  {
    key: 'creative',
    title: '智能成片',
    desc: '输入灵感，秒出大片',
    icon: quick1,
    grad: 'linear-gradient(135deg, #e6fbf4, #f4fffc)',
  },
  {
    key: 'hot-copy',
    title: '爆款复制',
    desc: '海量爆款，生成同款',
    icon: quick2,
    grad: 'linear-gradient(135deg, #e3f9f1, #f2fffb)',
  },
  {
    key: 'hot-split',
    title: '爆款裂变',
    desc: '一个爆款，裂变出N个',
    icon: quick3,
    grad: 'linear-gradient(135deg, #e6fbf4, #f4fffc)',
  },
  {
    key: 'ip-video',
    title: 'IP视频',
    desc: '打造出属于你的个人IP',
    icon: quick4,
    grad: 'linear-gradient(135deg, #e3f9f1, #f2fffb)',
  },
]

import { type TemplateItem, listBackendTemplates } from '@/api/templates'
import { DEMO_TEMPLATES, DEMO_LANDSCAPE_URLS } from '@/data/demoTemplates'

const TABS = [
  { key: 'template', label: '模板库' },
  { key: 'history', label: '历史项目' },
  { key: 'ip', label: 'IP' },
] as const

/* ratio 字符串 → grid 列跨度（12 列桌面 / 6 列移动端） */
// 12 列瀑布流里每张卡占的列数(越小=卡越小、每行越多)。宽屏下原值偏大(每行只有 2~3 张、预览过大),
// 整体下调一档:竖屏 2 列(每行 6 张)、方形 3 列、横屏 4 列。
function ratioToSpan(r: string): number {
  if (!r) return 3
  const s = r.replace(/\s+/g, '')
  switch (s) {
    case '9/16':
      return 2 // 竖屏窄卡
    case '3/4':
      return 2
    case '4/5':
      return 2
    case '1/1':
      return 3 // 方形中卡
    case '16/9':
      return 4 // 横屏宽卡
    default:
      return 3
  }
}

/* 历史视频卡片：素材市场风格（autoPlay 静音循环缩略图）+ URL 过期自动刷新 */
function HistoryVideoCard({
  title,
  videoUrl,
  videoAssetId,
  ratio,
  workspaceId,
  onOpen,
}: {
  title: string
  videoUrl: string
  videoAssetId: number
  ratio: string
  workspaceId: number
  onOpen: () => void
}) {
  const nav = useNavigate()
  const requireAuth = useRequireAuth()
  const [freshUrl, setFreshUrl] = useState('')
  const [playingUrl, setPlayingUrl] = useState('')
  const [loadingUrl, setLoadingUrl] = useState(false)
  const triedRef = useRef(false)
  const refreshingRef = useRef(false)

  // 卡片挂载时通过 assetId 获取实时签名 URL（静默，失败不报错）
  useEffect(() => {
    if (triedRef.current) return
    if (!videoAssetId || !workspaceId) {
      if (videoUrl) setFreshUrl(videoUrl)
      return
    }
    triedRef.current = true
    getAssetDownloadUrl({ workspaceId, assetId: videoAssetId })
      .then((url) => {
        if (url) setFreshUrl(url)
      })
      .catch(() => {
        if (videoUrl) setFreshUrl(videoUrl)
      })
  }, [videoAssetId, workspaceId, videoUrl])

  const displayUrl = freshUrl || videoUrl

  // 点击播放：通过 assetId 获取实时签名 URL，避免过期 403
  const handlePlay = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (loadingUrl) return
    // 如果 draft 里有 URL 且没过期，直接用
    if (videoUrl && !refreshingRef.current) {
      try {
        const test = await fetch(videoUrl, { method: 'HEAD' })
        if (test.ok) {
          setPlayingUrl(videoUrl)
          return
        }
      } catch {
        /* HEAD 失败，走刷新 */
      }
    }
    if (!videoAssetId || !workspaceId) {
      // 无 assetId → 直接尝试打开草稿 URL
      if (videoUrl) setPlayingUrl(videoUrl)
      return
    }
    setLoadingUrl(true)
    try {
      const fresh = await getAssetDownloadUrl({ workspaceId, assetId: videoAssetId })
      if (fresh) setPlayingUrl(fresh)
      else if (videoUrl) setPlayingUrl(videoUrl)
    } catch {
      if (videoUrl) setPlayingUrl(videoUrl)
    } finally {
      setLoadingUrl(false)
    }
  }

  const handleHotCopy = (e: React.MouseEvent) => {
    e.stopPropagation()
    // 做同款:把该视频作为「源爆款视频」带入爆款复制页(url 用于预览,assetId 用于 replicate)
    requireAuth(() => nav('/hot-copy', { state: { carryVideo: { url: displayUrl, assetId: videoAssetId || 0 } } }))
  }

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!videoAssetId && !displayUrl && !videoUrl) return
    await downloadToDisk({
      fileName: buildDownloadName(title || '视频', new Date()),
      // 先按 assetId 取同源 /download(不过期);否则退回已就绪的 displayUrl。
      // 不再用 `playingUrl || videoUrl`——没先点播放时 playingUrl 为空,videoUrl 可能是会过期的外链 OSS → 下载 403。
      resolveUrl: async () => {
        if (videoAssetId && workspaceId) {
          const fresh = await getAssetDownloadUrl({ workspaceId, assetId: videoAssetId }).catch(() => '')
          if (fresh) return fresh
        }
        return displayUrl || videoUrl
      },
    }).catch(() => {})
  }

  return (
    <>
      <div
        className="home__proj"
        style={{ gridColumn: `span ${ratioToSpan(ratio)}` }}
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onOpen()
        }}
      >
        <div className="home__proj-thumb" style={{ aspectRatio: ratio || '9 / 16' }}>
          <span className="home__proj-thumb-ph">🎬</span>
          {/* 视频（assetId 刷新后的有效 URL 或草稿原始 URL） */}
          {displayUrl && (
            <video
              className="home__proj-video"
              src={displayUrl}
              autoPlay
              muted
              loop
              playsInline
              preload="auto"
              style={{ position: 'absolute', inset: 0, zIndex: 0 }}
              onError={(e) => {
                ;(e.currentTarget as HTMLVideoElement).style.display = 'none'
              }}
            />
          )}
          <div className="home__proj-overlay">
            <span className="home__proj-overlay-text">{title}</span>
            <div className="home__proj-actions">
              <button type="button" className="home__proj-action-btn" onClick={handlePlay} disabled={loadingUrl}>
                {loadingUrl ? (
                  '加载中…'
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                      <path d="M8 5v14l11-7z" />
                    </svg>{' '}
                    播放
                  </>
                )}
              </button>
              <button type="button" className="home__proj-action-btn" onClick={handleDownload}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
                </svg>
                下载
              </button>
              <button type="button" className="home__proj-action-btn" onClick={handleHotCopy}>
                做同款
              </button>
            </div>
          </div>
        </div>
        <div className="home__proj-title">
          <span className="home__proj-title-text" title={title}>
            {title}
          </span>
        </div>
      </div>

      {/* 全屏视频播放弹窗。不带 crossOrigin:playingUrl 在 HEAD 探测成功时可能是外链 OSS(无 CORS 头),
          带 crossOrigin 会被浏览器拒载卡在 0:00;此处仅播放、不读像素,无需 crossOrigin。 */}
      <VideoPreviewModal src={playingUrl} onClose={() => setPlayingUrl('')} />
    </>
  )
}

export default function HomeView() {
  const navigate = useNavigate()
  const workspaceId = useWorkspaceId()
  const requireAuth = useRequireAuth()
  const { isAuthenticated } = useAuth()
  const currentUser = useCurrentUser()
  const [bannerIndex, setBannerIndex] = useState(0)
  // 初始值从缓存秒出(有上次数据就不闪空),无缓存为 null 走占位兜底。
  const [apiBanners, setApiBanners] = useState<Banner[] | null>(() => peekCache<Banner[]>(BANNERS_CACHE_KEY) ?? null)
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]['key']>('template')
  const [keyword, setKeyword] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  // 案例库点击放大预览(与 /templates 页一致;外链 OSS 视频,弹窗不带 crossOrigin)
  const [watching, setWatching] = useState<{ url: string; poster: string } | null>(null)

  // 新用户首次进首页自动弹新手引导:按用户隔离的「已看」标记,只在第一次出现;看过(完成/跳过)后不再弹。
  // (延时等快捷入口锚点渲染出来;markGuideSeen 在 GuideOverlay 的 finish() 里写入。)
  useEffect(() => {
    if (!isAuthenticated) return
    if (isGuideSeen('home', currentUser?.id)) return
    const t = window.setTimeout(() => openGuide('home'), 600)
    return () => window.clearTimeout(t)
  }, [isAuthenticated, currentUser?.id])

  // 历史项目（接后端 listCreativeProjects）
  const [historyItems, setHistoryItems] = useState<any[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')

  // 案例库（接后端 listTemplates → /api/v1/creative/projects，仅展示有视频的项目）
  const [templateItems, setTemplateItems] = useState<TemplateItem[]>(DEMO_TEMPLATES)
  const [templateLoading, setTemplateLoading] = useState(false)
  const [templateError, setTemplateError] = useState('')
  const [templateRetry, setTemplateRetry] = useState(0)

  // 模板收藏(localStorage 占位):收藏的视频进素材市场「我收藏的」
  const [favKeys, setFavKeys] = useState<Set<string>>(new Set())
  useEffect(() => {
    setFavKeys(loadFavoriteKeys(Number(workspaceId || 0)))
  }, [workspaceId])
  const toggleFav = (tpl: TemplateItem) => {
    const wsId = Number(workspaceId || 0)
    if (!wsId) return
    const key = favoriteKeyOf(tpl.videoAssetId || 0, tpl.videoUrl)
    const on = toggleFavorite(wsId, {
      key,
      title: tpl.title || '未命名视频',
      videoUrl: tpl.videoUrl || '',
      thumbnailUrl: tpl.thumbnailUrl || '',
      ratio: tpl.ratio || '',
      ts: Date.now(),
    })
    setFavKeys((prev) => {
      const next = new Set(prev)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })
  }

  // 案例库拉后台配置的模板库(GET /api/v1/templates);为空/失败时用 demo 兜底。
  // 免登录、不依赖工作空间(后端公开接口)。
  useEffect(() => {
    if (activeTab !== 'template') return
    let cancelled = false
    setTemplateLoading(true)
    listBackendTemplates()
      .then((items) => {
        if (cancelled) return
        const list = items.length ? items : DEMO_TEMPLATES
        setTemplateItems(list)
        setTemplateError(list.length ? '' : 'empty')
      })
      .catch(() => {
        if (cancelled) return
        setTemplateItems(DEMO_TEMPLATES)
        setTemplateError(DEMO_TEMPLATES.length ? '' : 'empty')
      })
      .finally(() => {
        if (!cancelled) setTemplateLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeTab, templateRetry])

  const keywordTrim = keyword.trim()

  // 按关键词过滤模板(比例筛选 chips 已按设计稿移除)
  const filteredTemplates = useMemo(() => {
    let list = templateItems
    if (keywordTrim) list = list.filter((t) => t.title.includes(keywordTrim))
    return list
  }, [templateItems, keywordTrim])

  // 切到「历史项目」标签且有工作空间时拉取真实项目（首次/切空间时）。
  // 游客模式不请求数据（API 会 401）
  useEffect(() => {
    if (activeTab !== 'history') return
    const wsId = Number(workspaceId || 0)
    if (!wsId) return
    if (!isAuthenticated) {
      setHistoryItems([])
      setHistoryLoading(false)
      setHistoryError('unauth')
      return
    }
    let cancelled = false
    setHistoryLoading(true)
    setHistoryError('')
    listCreativeProjects({ workspaceId: wsId, limit: 50 })
      .then((items: any) => {
        if (!cancelled) {
          const list = Array.isArray(items) ? items : []
          // 仅保留有生成视频的项目（有 url 或 assetId 即为有效）
          setHistoryItems(
            list.filter((p: any) => {
              const info = extractVideoInfo(p)
              return Boolean(info.url || info.assetId)
            }),
          )
        }
      })
      .catch((err: any) => {
        if (!cancelled) {
          if (err?.status === 401 || String(err?.message || '').includes('401')) {
            setHistoryError('unauth')
          } else {
            setHistoryError('历史项目加载失败')
          }
        }
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeTab, workspaceId, isAuthenticated])

  const filteredHistory = useMemo(() => {
    if (!keywordTrim) return historyItems
    return historyItems.filter((p) => projectTitle(p).includes(keywordTrim))
  }, [historyItems, keywordTrim])

  const handleNavigate = useSidebarNavigate()

  // 拉取后端轮播图(/api/v1/banners),走 SWR 缓存:
  //   - 有缓存 → 立即用缓存渲染(上面 useState 已秒出),同时后台刷新,新数据回来再更新;
  //   - 无缓存 → 等首个请求结果。
  //   失败 / 为空时由下方 slides 计算回退到本地占位。
  useEffect(() => {
    let cancelled = false
    swrFetch(BANNERS_CACHE_KEY, () => listBanners('home'), {
      ttl: 5 * 60_000, // 5 分钟内视为新鲜,不重复后台刷新
      onRevalidate: (fresh) => {
        if (!cancelled) setApiBanners(fresh) // 后台刷新到的最新数据
      },
    })
      .then(({ data }) => {
        if (!cancelled) setApiBanners(data)
      })
      .catch(() => {
        if (!cancelled) setApiBanners([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 轮播优先用后端轮播图接口(/api/v1/banners);接口为空(或加载中)时回退本地演示视频兜底
  const slides = useMemo<Slide[]>(
    () => (apiBanners && apiBanners.length ? apiBanners.map(bannerToSlide) : DEMO_SLIDES),
    [apiBanners],
  )

  // slides 数量变化时把焦点夹回有效范围
  useEffect(() => {
    setBannerIndex((i) => (i < slides.length ? i : 0))
  }, [slides.length])

  // 预取「相邻」幻灯片的媒体(下一张 + 上一张),让左右切换/自动播放时直接命中缓存、不再现加载。
  // preloadMedia 幂等且带并发上限,重复调用安全;图片整张预取、视频只预热首帧。
  useEffect(() => {
    if (slides.length < 2) return
    const nextIdx = (bannerIndex + 1) % slides.length
    const prevIdx = (bannerIndex - 1 + slides.length) % slides.length
    const targets: MediaItem[] = [slides[nextIdx], slides[prevIdx]]
      .filter((s) => s && s.mediaUrl)
      .map((s) => ({ url: s.mediaUrl, type: s.mediaType }))
    preloadMedia(targets)
  }, [slides, bannerIndex])

  // 居中卡片式焦点轮播(自定义 coverflow,对 3 张最稳):左右箭头切换 + 自动播放,取模实现无缝循环
  const bannerPrev = () => setBannerIndex((i) => (i - 1 + slides.length) % slides.length)
  const bannerNext = () => setBannerIndex((i) => (i + 1) % slides.length)
  // 自动切换:视频幻灯片由其播放结束(BannerVideo 的 onEnded)驱动,播完才切;图片幻灯片用 5 秒定时兜底。
  useEffect(() => {
    if (slides.length < 2) return
    if (slides[bannerIndex]?.mediaType === 'video') return
    const t = window.setTimeout(() => setBannerIndex((i) => (i + 1) % slides.length), 5000)
    return () => window.clearTimeout(t)
  }, [slides, bannerIndex])

  return (
    <div className="home">
      <AppSidebar
        activeKey="home"
        onNavigate={handleNavigate}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="home__main">
        <AppTopbar onMenu={() => setSidebarOpen(true)} />

        <div className="home__content">
          {/* 居中卡片式焦点轮播(自定义 coverflow):中间卡片最大为焦点,左右缩小遮挡,箭头切换 + 自动播放 */}
          <section className="home__banner">
            <div className="home__cf-stage">
              {slides.map((b, i) => {
                const n = slides.length
                let rel = i - bannerIndex
                if (rel > n / 2) rel -= n
                if (rel < -n / 2) rel += n
                const pos = rel === 0 ? 'center' : rel === -1 ? 'left' : rel === 1 ? 'right' : 'hidden'
                const cta = b.btn || (b.linkUrl ? '查看详情' : '')
                const onCta = () => {
                  if (b.linkUrl) window.open(b.linkUrl, '_blank', 'noopener')
                  else if (b.action) handleNavigate(b.action)
                }
                return (
                  <div className={`home__cf-card is-${pos}`} key={b.id} aria-hidden={pos !== 'center'}>
                    <div
                      className="home__bcard"
                      style={b.mediaType === 'image' ? { backgroundImage: `url(${b.mediaUrl})` } : undefined}
                    >
                      {b.mediaType === 'video' && (
                        <BannerVideo src={b.mediaUrl} active={pos === 'center'} onDone={bannerNext} />
                      )}
                      {/* 视频幻灯片只展示视频,不叠加文字层;图片占位仍带文案 */}
                      {b.mediaType !== 'video' && (
                        <div className="home__bcard-panel">
                          <h2 className="home__bcard-title">
                            {b.title ? (
                              b.title
                            ) : (
                              <>
                                {b.pre}
                                <span className="home__bcard-em">{b.em}</span>
                                {b.post}
                              </>
                            )}
                          </h2>
                          {b.sub && <p className="home__bcard-sub">{b.sub}</p>}
                          {cta && (
                            <button type="button" className="home__bcard-btn" onClick={onCta}>
                              {cta}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
            <button
              type="button"
              className="home__cf-arrow home__cf-arrow--left"
              onClick={bannerPrev}
              aria-label="上一张"
            >
              ‹
            </button>
            <button
              type="button"
              className="home__cf-arrow home__cf-arrow--right"
              onClick={bannerNext}
              aria-label="下一张"
            >
              ›
            </button>
          </section>
          <div className="home__banner-bars">
            {slides.map((b, i) => (
              <button
                key={b.id}
                type="button"
                className={`home__bar${i === bannerIndex ? ' is-active' : ''}`}
                onClick={() => setBannerIndex(i)}
                aria-label={`第 ${i + 1} 张`}
              />
            ))}
          </div>

          {/* 快捷入口 */}
          <section className="home__section">
            <div className="home__section-head">
              <h3 className="home__section-title">快捷入口</h3>
            </div>
            <div className="home__quick-grid">
              {QUICK_ENTRIES.map((q) => (
                <button
                  key={q.key}
                  type="button"
                  className="home__quick-card"
                  style={{ background: q.grad }}
                  onClick={() => handleNavigate(q.key)}
                >
                  <div className="home__quick-text">
                    <div className="home__quick-title">{q.title}</div>
                    <div className="home__quick-desc">{q.desc}</div>
                  </div>
                  <div className="home__quick-icon">
                    <img src={q.icon} alt="" />
                  </div>
                </button>
              ))}
            </div>
          </section>

          {/* 标签 + 比例筛选 + 搜索 */}
          <section className="home__section home__section--grow">
            <div className="home__tabs-bar" data-guide="home-cases">
              <div className="home__tabs">
                {TABS.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    className={`home__tab${activeTab === t.key ? ' is-active' : ''}`}
                    onClick={() => setActiveTab(t.key)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <div className="home__search">
                <svg
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  fill="none"
                  stroke="#909090"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.2-3.2" />
                </svg>
                <input
                  type="text"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="搜索案例、项目、IP..."
                />
              </div>
              {/* 模板/历史 tab 均可查看更多 → 案例库 */}
              {(activeTab === 'template' || activeTab === 'history') && (
                <div className="home__more">
                  <button type="button" className="home__more-btn" onClick={() => navigate('/templates')}>
                    查看更多 →
                  </button>
                </div>
              )}
            </div>

            {/* 内容框:案例库/历史项目/IP */}
            <div className="home__tab-box">
              {activeTab === 'history' ? (
                historyLoading ? (
                  <div className="home__placeholder">加载中…</div>
                ) : historyError === 'unauth' ? (
                  <div className="home__placeholder">
                    请先登录后查看历史项目
                    <button type="button" className="home__retry-btn" onClick={() => navigate('/login')}>
                      去登录
                    </button>
                  </div>
                ) : historyError ? (
                  <div className="home__placeholder">{historyError}</div>
                ) : filteredHistory.length ? (
                  <div className="home__proj-waterfall">
                    {filteredHistory.map((p) => {
                      const id = projectId(p)
                      const { url: videoUrl, assetId: videoAssetId } = extractVideoInfo(p)
                      const ratio = projectRatio(p)
                      const wsId = Number(workspaceId || 0)
                      return (
                        <HistoryVideoCard
                          key={id || projectTitle(p)}
                          title={projectTitle(p)}
                          videoUrl={videoUrl}
                          videoAssetId={videoAssetId}
                          ratio={ratio}
                          workspaceId={wsId}
                          onOpen={() => id && resolveProjectPath(id, wsId).then((path) => navigate(path))}
                        />
                      )
                    })}
                  </div>
                ) : (
                  <div className="home__placeholder">暂无生成视频</div>
                )
              ) : activeTab === 'ip' ? (
                <div className="home__placeholder">IP 功能敬请期待</div>
              ) : templateLoading ? (
                <div className="home__tpl-skeleton">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div
                      key={i}
                      className="home__tpl-skel"
                      style={{ aspectRatio: i % 3 === 0 ? '9 / 16' : i % 3 === 1 ? '16 / 9' : '4 / 5' }}
                    />
                  ))}
                </div>
              ) : templateError === 'unauth' ? (
                <div className="home__placeholder">
                  请先登录后查看模板库
                  <button type="button" className="home__retry-btn" onClick={() => navigate('/login')}>
                    去登录
                  </button>
                </div>
              ) : templateError === 'api' ? (
                <div className="home__placeholder">
                  案例加载失败
                  <button type="button" className="home__retry-btn" onClick={() => setTemplateRetry((n) => n + 1)}>
                    重试
                  </button>
                </div>
              ) : templateError === 'empty' || !filteredTemplates.length ? (
                <div className="home__placeholder">暂无案例数据</div>
              ) : (
                <>
                  <div className="home__masonry">
                    {filteredTemplates.map((tpl, tplIdx) => (
                      <div key={`${tpl.id}-${tplIdx}`} className="home__tpl">
                        <div
                          className={`home__tpl-thumb${tpl.videoUrl || tpl.thumbnailUrl ? ' has-image' : ''}`}
                          style={{
                            aspectRatio: tpl.ratio,
                            background: tpl.grad,
                            cursor: tpl.videoUrl ? 'zoom-in' : '',
                          }}
                          role={tpl.videoUrl ? 'button' : undefined}
                          title={tpl.videoUrl ? '点击放大预览' : undefined}
                          onClick={() => {
                            if (tpl.videoUrl) setWatching({ url: tpl.videoUrl, poster: tpl.thumbnailUrl || '' })
                          }}
                        >
                          {tpl.videoUrl ? (
                            // 封面=视频本身(首帧/循环),与「历史项目」一致,不依赖会过期的封面图
                            <video
                              className="home__tpl-video"
                              src={tpl.videoUrl}
                              autoPlay
                              muted
                              loop
                              playsInline
                              preload="metadata"
                              onLoadedMetadata={(e) => {
                                // 卡片比例跟随视频真实宽高
                                const v = e.currentTarget
                                if (v.videoWidth && v.videoHeight) {
                                  const thumb = v.closest('.home__tpl-thumb') as HTMLElement | null
                                  if (thumb) thumb.style.aspectRatio = `${v.videoWidth} / ${v.videoHeight}`
                                }
                              }}
                              onError={(e) => {
                                ;(e.currentTarget as HTMLVideoElement).style.display = 'none'
                              }}
                            />
                          ) : tpl.thumbnailUrl ? (
                            <img src={tpl.thumbnailUrl} alt={tpl.title} loading="lazy" className="home__tpl-img" />
                          ) : (
                            <span className="home__tpl-media" aria-hidden="true">
                              <svg viewBox="0 0 24 24" width="34" height="34" fill="none">
                                <circle cx="12" cy="12" r="11" fill="rgba(255,255,255,0.55)" />
                                <path d="M10 8.5l6 3.5-6 3.5z" fill="#fff" />
                              </svg>
                            </span>
                          )}
                          {tpl.videoUrl && (
                            <button
                              type="button"
                              className={`home__tpl-fav${favKeys.has(favoriteKeyOf(tpl.videoAssetId || 0, tpl.videoUrl)) ? ' is-on' : ''}`}
                              aria-label="收藏"
                              onClick={(e) => {
                                e.stopPropagation()
                                toggleFav(tpl)
                              }}
                            >
                              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                                <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
                              </svg>
                            </button>
                          )}
                          <div className="home__tpl-mask">
                            <button
                              type="button"
                              className="home__tpl-action"
                              onClick={(e) => {
                                e.stopPropagation() // 不触发缩略图的放大预览
                                requireAuth(() =>
                                  navigate('/hot-copy', {
                                    state: { carryVideo: { url: tpl.videoUrl || '', assetId: tpl.videoAssetId || 0 } },
                                  }),
                                )
                              }}
                            >
                              做同款
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </section>
        </div>
      </div>

      {/* 案例库点击放大预览(外链 OSS、无 CORS 头 → 不带 crossOrigin,否则卡 0:00) */}
      <VideoPreviewModal src={watching?.url || ''} poster={watching?.poster} onClose={() => setWatching(null)} />
    </div>
  )
}
