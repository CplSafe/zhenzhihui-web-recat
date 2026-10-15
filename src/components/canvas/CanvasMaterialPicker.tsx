/**
 * CanvasMaterialPicker — 画布素材库（"添加素材"弹窗）
 *
 * 支持三种形态：
 * - modal：居中模态弹窗（对齐 Figma "添加素材"设计：遮罩 rgba(51,51,51,0.6)、
 *   弹窗 1660×776 白底圆角 14px、22px 大 Tab、250×320 素材卡片带比例/大小信息）
 * - drawer：左侧抽屉（画布场景）
 * - popover：鼠标位置贴附小面板
 *
 * 数据来源：GET /api/v1/assets（按 workspace 分页，status=active）
 * 封面加载对齐「我的素材」页面（ResourceManagementView.AssetThumb）：
 * 后端 /api/v1/assets 列表不返回可展示 URL（无 thumbnail/cover/url 字段），
 * 因此进入视口后统一按 assetId 调用 getAssetDownloadUrl
 * （/api/v1/assets/{id}/download?workspace_id=X）获取同源流式地址加载。
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { listAssets, getAssetDownloadUrl } from '@/api/business'
import { listRealPeople } from '@/api/realPeople'
import { resolveCanvasAssetRealPerson } from '@/utils/canvasRealPerson'
import { useToast } from '@/composables/useToast'
import { createMaterialFromAsset, isVideoMaterial, isAudioMaterial } from '@/utils/materials'
import { isCanvasAudioEntryVisible } from '@/utils/canvasFeatureFlags'
import {
  createSmartRealPersonReference,
  isReadyRealPersonAsset,
  isVerifiedRealPerson,
  type SmartRealPersonReference,
} from '@/utils/smartRealPerson'
import {
  favoriteAssetIdOf,
  favoriteMediaKindOf,
  favoriteMediaUrlOf,
  loadFavorites,
  setFavoriteVideoUserScope,
  type FavoriteVideo,
} from '@/utils/favoriteVideos'
import styles from './CanvasMaterialPicker.module.css'

export interface MaterialItem {
  id: string
  assetId: number
  /** 选中后解析出的同源流式地址（生成任务用） */
  src: string
  name: string
  type: string
  /** 素材大小（字节），用于卡片信息展示 */
  sizeBytes?: number
  /** 预设比例（收藏素材无真实媒体时可先用收藏时记录的比例） */
  ratio?: string
  /** 素材来源：upload / generated / collected / real_person */
  source?: string
  /**
   * 真人素材库素材的身份引用（含认证与授权信息）。
   * 后端没有真人专用参数，身份保持完全靠前端携带这份引用去置顶参考图并注入约束，
   * 因此真人 tab 必须走 listRealPeople 拿到认证状态，而不是只拿一条裸 asset。
   */
  realPerson?: SmartRealPersonReference
}

interface CanvasMaterialPickerProps {
  /** 所属工作空间 ID，素材按 workspace 隔离 */
  workspaceId: number
  /** 当前用户 ID（收藏 tab 按用户隔离读取） */
  userId?: number
  visible: boolean
  position?: { x: number; y: number } | null
  variant?: 'popover' | 'drawer' | 'modal'
  /** 打开时默认展示的素材分类。 */
  initialTab?: TabKey
  onClose: () => void
  /** 点击「应用」时回调（解析好同源流式地址后传入） */
  onApply: (material: MaterialItem) => void
  /**
   * 多选上限：给了它（「选参考」模式）弹窗改为勾选模式，卡片点选切换、底部确认一次性添加。
   * 值是目标节点还能接的参考数量，超出的勾选会被拦下并提示。
   */
  selectionLimit?: number
  /** 多选确认时回调（每项都已解析好同源流式地址）。 */
  onApplyMany?: (materials: MaterialItem[]) => void
}

const PAGE_SIZE = 30

/** Tab 定义：参考「我的素材」页面（全部 / 我上传的 / 我生成的 / 我收藏的 / 真人素材库） */
const TABS = [
  { k: 'all', l: '全部' },
  { k: 'upload', l: '我上传的' },
  { k: 'generated', l: '我生成的' },
  { k: 'collected', l: '我收藏的' },
  { k: 'real_person', l: '真人素材库' },
] as const
type TabKey = (typeof TABS)[number]['k']

/** tab → listAssets source 参数（收藏 tab 走本地收藏，无服务端 source） */
function tabAssetSource(tab: TabKey): string {
  if (tab === 'upload') return 'upload'
  if (tab === 'generated') return 'generated'
  if (tab === 'real_person') return 'real_person'
  return ''
}

/** 收藏素材转素材卡片（对齐 ResourceManagementView 的 favoriteCards 转换） */
function favoriteToMaterial(favorite: FavoriteVideo, mediaUrl: string): MaterialItem {
  const assetId = favoriteAssetIdOf(favorite)
  const mediaKind = favoriteMediaKindOf(favorite)
  return {
    id: favorite.key,
    assetId,
    src: mediaUrl,
    name: String(favorite.title || (mediaKind === 'image' ? '收藏图片' : '收藏视频')),
    type: mediaKind === 'image' ? '图片' : '视频',
    ratio: favorite.ratio || '',
    source: 'collected',
  }
}

// ---- 纯函数工具（参考 ResourceManagementView）----
function gcd(a: number, b: number): number {
  a = Math.abs(Math.round(a))
  b = Math.abs(Math.round(b))
  while (b) {
    ;[a, b] = [b, a % b]
  }
  return a || 1
}

/** 由真实宽高计算比例标签（吸附常见比例，否则 gcd 约分） */
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

/** 字节数格式化为 B/KB/MB/GB */
function formatBytes(sizeBytes: any): string {
  const value = Number(sizeBytes || 0)
  if (!Number.isFinite(value) || value <= 0) return ''
  if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`
  if (value >= 1024) return `${Math.round(value / 1024)} KB`
  return `${value} B`
}

/**
 * 素材封面缩略图（对齐 ResourceManagementView.AssetThumb）：
 * - IntersectionObserver 懒加载，滑入视口才请求
 * - 进入视口后按 assetId 调 getAssetDownloadUrl 获取同源流式地址
 * - 图片用 img；视频用 video（preload="metadata" 显示首帧）
 * - 加载失败按 assetId 重取一次，仍失败显示占位
 * - 媒体加载完成后回调真实宽高比例（onRatio）
 */
function MaterialThumb({
  item,
  workspaceId,
  onRatio,
}: {
  item: MaterialItem
  workspaceId: number
  onRatio?: (ratio: string) => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [inView, setInView] = useState(false)
  const [src, setSrc] = useState('')
  const triedRef = useRef(false)
  const assetId = Number(item.assetId || 0) || 0
  const isVideo = isVideoMaterial(item)

  // 懒加载：元素滑入滚动容器可视区（含 300px 预加载）才请求下载地址
  useEffect(() => {
    if (inView) return
    const el = rootRef.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }
    // root 指向滚动容器：modal/drawer 为 fixed 容器，默认 viewport root 在容器内部
    // 滚动时元素相对 viewport 可能不变化，必须用滚动容器作 root 才能可靠触发
    const scrollRoot = el.closest('.canvas-material-picker-grid')
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setInView(true)
      },
      { root: scrollRoot, rootMargin: '300px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [inView])

  // 进入视口后按 assetId 获取同源流式下载地址
  useEffect(() => {
    if (!inView) return
    let cancelled = false
    setSrc('')
    triedRef.current = false
    if (assetId > 0) {
      triedRef.current = true
      getAssetDownloadUrl({ workspaceId, assetId })
        .then((url) => {
          if (!cancelled) setSrc(url || '')
        })
        .catch(() => {})
    }
    return () => {
      cancelled = true
    }
  }, [assetId, inView, workspaceId])

  // 加载失败：按 assetId 重取一次
  const handleError = useCallback(() => {
    if (triedRef.current) {
      setSrc('')
      return
    }
    triedRef.current = true
    if (assetId <= 0) {
      setSrc('')
      return
    }
    getAssetDownloadUrl({ workspaceId, assetId })
      .then((url) => setSrc(url || ''))
      .catch(() => setSrc(''))
  }, [assetId, workspaceId])

  // 未进视口：轻量占位（不渲染 img/video 标签）
  if (!inView) {
    return <div ref={rootRef} className={styles.itemPlaceholder} />
  }

  // 数据（下载地址）未返回：渲染非媒体占位，不创建空 img/video 标签
  if (!src) {
    return (
      <div ref={rootRef} className={styles.itemMediaPlaceholder}>
        <span>{isAudioMaterial(item) ? '音频' : isVideoMaterial(item) ? '视频' : '图片'}</span>
        <b>加载中</b>
      </div>
    )
  }

  // 数据返回后才渲染媒体节点，并回传真实宽高比例
  return (
    <div ref={rootRef} className={styles.itemMedia}>
      {isAudioMaterial(item) ? (
        <audio
          src={src}
          controls
          preload="metadata"
          onClick={(e) => e.stopPropagation()}
          onError={handleError}
          aria-label={`${item.name}试听`}
        />
      ) : isVideo ? (
        <video
          src={src}
          muted
          autoPlay
          loop
          playsInline
          preload="metadata"
          onError={handleError}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget
            if (v.videoWidth && v.videoHeight) onRatio?.(ratioLabel(v.videoWidth, v.videoHeight))
          }}
        />
      ) : (
        <img
          src={src}
          loading="lazy"
          onError={handleError}
          onLoad={(e) => {
            const im = e.currentTarget
            if (im.naturalWidth && im.naturalHeight) onRatio?.(ratioLabel(im.naturalWidth, im.naturalHeight))
          }}
        />
      )}
    </div>
  )
}

/**
 * Modal 形态的素材卡片（对齐 Figma）：
 * 250×320 竖版，封面 250×250（上圆角），类型标签左上角，
 * 底部信息区（比例 + 大小），hover 浮现「应用」按钮。
 */
function ModalCard({
  item,
  workspaceId,
  onApply,
  selectable = false,
  selected = false,
  selectionIndex = 0,
  onToggle,
}: {
  item: MaterialItem
  workspaceId: number
  onApply: (item: MaterialItem) => void
  /** 多选模式：整张卡片点击切换勾选，不再浮出「应用」。 */
  selectable?: boolean
  selected?: boolean
  /** 勾选顺序（从 1 起），即落到目标节点上的参考顺序。 */
  selectionIndex?: number
  onToggle?: (item: MaterialItem) => void
}) {
  const [ratio, setRatio] = useState(item.ratio || '')
  const sizeText = formatBytes(item.sizeBytes)
  return (
    <div
      className={`${styles.modalCard}${selected ? ` ${styles.modalCardSelected}` : ''}`}
      onClick={selectable ? () => onToggle?.(item) : undefined}
      role={selectable ? 'checkbox' : undefined}
      aria-checked={selectable ? selected : undefined}
      aria-label={selectable ? item.name || '素材' : undefined}
      tabIndex={selectable ? 0 : undefined}
      onKeyDown={
        selectable
          ? (event) => {
              if (event.key === ' ' || event.key === 'Enter') {
                event.preventDefault()
                onToggle?.(item)
              }
            }
          : undefined
      }
    >
      {/* 类型标签（左上角） */}
      <span className={styles.modalType}>
        {isAudioMaterial(item) ? '音频' : isVideoMaterial(item) ? '视频' : '图片'}
      </span>
      {/* 多选勾选标记（右上角）：选中时显示序号，即连到节点上的参考顺序 */}
      {selectable && (
        <span className={`${styles.modalCheck}${selected ? ` ${styles.modalCheckOn}` : ''}`} aria-hidden="true">
          {selected ? selectionIndex : ''}
        </span>
      )}
      {/* 封面区域：hover 时「应用」按钮浮现在图片上 */}
      <div className={styles.modalCover}>
        <MaterialThumb item={item} workspaceId={workspaceId} onRatio={setRatio} />
        {/* 悬浮操作栏：图片上垂直居中浮现「应用」；多选模式下点整张卡片即可，不再需要 */}
        {!selectable && (
          <div className={styles.materialActions}>
            <button className={styles.materialActionBtn} onClick={() => onApply(item)}>
              应用
            </button>
          </div>
        )}
      </div>
      {/* 底部信息区：比例 + 大小（不被应用按钮遮挡） */}
      <div className={styles.modalInfo}>
        <span className={styles.modalRatio}>
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden="true"
          >
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="M3 15h18" />
          </svg>
          {ratio || '—'}
        </span>
        {sizeText && <span className={styles.modalSize}>{sizeText}</span>}
      </div>
    </div>
  )
}

export default function CanvasMaterialPicker({
  workspaceId,
  userId,
  visible,
  position,
  variant = 'popover',
  initialTab = 'all',
  onClose,
  onApply,
  selectionLimit,
  onApplyMany,
}: CanvasMaterialPickerProps) {
  const [tab, setTab] = useState<TabKey>('all')
  const multiSelect = typeof selectionLimit === 'number' && Boolean(onApplyMany)
  // 勾选顺序即参考顺序；跨 tab 保留，切 tab 继续挑
  const [picked, setPicked] = useState<MaterialItem[]>([])
  const [pickHint, setPickHint] = useState('')
  const [applying, setApplying] = useState(false)
  useEffect(() => {
    if (!visible) {
      setPicked([])
      setPickHint('')
    }
  }, [visible])
  const togglePicked = useCallback(
    (item: MaterialItem) => {
      setPickHint('')
      setPicked((current) => {
        if (current.some((entry) => entry.id === item.id)) return current.filter((entry) => entry.id !== item.id)
        if (current.length >= (selectionLimit ?? 0)) {
          setPickHint(`当前最多还能添加 ${selectionLimit} 个参考`)
          return current
        }
        return [...current, item]
      })
    },
    [selectionLimit],
  )
  const [items, setItems] = useState<MaterialItem[]>([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  // 模糊匹配搜索：按素材名称过滤（客户端，参考 ResourceManagementView 搜索）
  const [searchQuery, setSearchQuery] = useState('')
  const loadingRef = useRef(false)
  // 追踪当前展示的 tab：请求完成后仅当 tab 未切换才更新界面，避免旧请求覆盖新 tab
  const tabRef = useRef<string>(tab)
  tabRef.current = tab

  useEffect(() => {
    if (visible) setTab(initialTab)
  }, [visible, initialTab])
  // 请求序号：切换 tab 后旧请求结果直接丢弃
  const requestSeqRef = useRef(0)

  /**
   * 真人素材库单独走 /api/v1/real-people：只有这个接口能带回「属于谁、是否仍在授权」。
   * listAssets(source=real_person) 只有裸 asset，拿不到认证状态，生成前无从回查授权，
   * 素材也就退化成一张普通参考图。这里只收录已认证的人 + 已就绪的素材。
   */
  const fetchRealPeopleAssets = useCallback(
    async (seq: number) => {
      const people = await listRealPeople({ workspaceId })
      const mapped: MaterialItem[] = []
      for (const person of people) {
        if (!isVerifiedRealPerson(person)) continue
        for (const asset of person.assets || []) {
          // 真人档案里除人脸照外还有 KYC 活体视频；把它当参考图送去生成会被上游按
          // invalid_image_file 拒绝，因此和智能成片入口用同一条过滤规则排除视频型素材。
          if (!isReadyRealPersonAsset(asset) || /video/i.test(asset.asset_type || '')) continue
          const reference = createSmartRealPersonReference(person, asset)
          mapped.push({
            id: `real-person-${reference.realPersonId}-${reference.mappingId}`,
            assetId: reference.localAssetId,
            src: '',
            name: reference.personName,
            type: 'image',
            source: 'real_person',
            realPerson: reference,
          })
        }
      }
      if (tabRef.current !== 'real_person' || requestSeqRef.current !== seq) return
      setItems(mapped)
      setPage(0)
      // 真人素材按人聚合返回，接口不分页，一次取完。
      setHasMore(false)
    },
    [workspaceId],
  )

  /** 拉取一页素材并映射为展示结构（按 tab 过滤来源；全部 tab 排除真人素材） */
  const fetchAssets = useCallback(
    async (type: string, pg: number, reset: boolean) => {
      if (loadingRef.current) return
      loadingRef.current = true
      const seq = ++requestSeqRef.current
      setLoading(true)
      try {
        if (type === 'real_person') {
          await fetchRealPeopleAssets(seq)
          return
        }
        const data = await listAssets({
          workspaceId,
          type: '',
          source: tabAssetSource(type as TabKey),
          status: 'active',
          limit: PAGE_SIZE,
          offset: pg * PAGE_SIZE,
        })
        const rawItems = data?.items || []
        const mapped: MaterialItem[] = rawItems
          .map((asset: any) => {
            const m = createMaterialFromAsset(asset, '')
            return {
              ...m,
              type: m.type || '',
              sizeBytes: Number(asset?.size_bytes || 0) || undefined,
              source: String(asset?.source || ''),
            }
          })
          // 真人素材与普通素材隔离：「全部」不混入真人素材（参考 ResourceManagementView）
          .filter((item) => (type !== 'all' || item.source !== 'real_person') && isCanvasAudioEntryVisible(item.type))
        // 请求期间 tab 已切换：丢弃结果，不更新界面
        if (tabRef.current !== type || requestSeqRef.current !== seq) return
        setItems((prev) => (reset ? mapped : [...prev, ...mapped]))
        setPage(pg)
        setHasMore(rawItems.length >= PAGE_SIZE)
      } catch {
        // 静默：保留当前列表，接口异常不打断画布操作
      } finally {
        if (requestSeqRef.current === seq) setLoading(false)
        loadingRef.current = false
      }
    },
    [workspaceId, fetchRealPeopleAssets],
  )

  // 打开面板或切换 tab：服务端 tab 重新加载第一页；收藏 tab 由下方 effect 加载
  useEffect(() => {
    if (!visible) return
    if (tab === 'collected') return
    setItems([])
    setPage(0)
    setHasMore(true)
    fetchAssets(tab, 0, true)
  }, [visible, tab, fetchAssets])

  // 收藏 tab：读取本地收藏（按用户隔离），并刷新可能过期的签名地址
  useEffect(() => {
    if (!visible || tab !== 'collected') return
    let cancelled = false
    if (userId) setFavoriteVideoUserScope(userId)
    const favorites = loadFavorites(workspaceId)
    setItems(
      favorites
        .map((f) => favoriteToMaterial(f, favoriteMediaUrlOf(f)))
        .filter((item) => isCanvasAudioEntryVisible(item.type)),
    )
    setPage(0)
    setHasMore(false)
    Promise.all(
      favorites.map(async (favorite) => {
        const assetId = favoriteAssetIdOf(favorite)
        const fallbackUrl = favoriteMediaUrlOf(favorite)
        if (!assetId) return favoriteToMaterial(favorite, fallbackUrl)
        try {
          const freshUrl = (await getAssetDownloadUrl({ workspaceId, assetId })) || ''
          return favoriteToMaterial(favorite, freshUrl || fallbackUrl)
        } catch {
          return favoriteToMaterial(favorite, fallbackUrl)
        }
      }),
    ).then((cards) => {
      if (!cancelled) setItems(cards.filter((item) => isCanvasAudioEntryVisible(item.type)))
    })
    return () => {
      cancelled = true
    }
  }, [visible, tab, workspaceId, userId])

  const loadMore = useCallback(() => {
    const nextPage = page + 1
    setPage(nextPage)
    fetchAssets(tab, nextPage, false)
  }, [page, tab, fetchAssets])

  const listRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

  // 底部哨兵：进入滚动容器可视区（含 80px 预加载）即自动加载下一页
  useEffect(() => {
    const el = sentinelRef.current
    const gridEl = listRef.current
    if (!el || !gridEl || loading || !hasMore) return
    if (typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          loadMore()
        }
      },
      { root: gridEl, rootMargin: '80px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [hasMore, loading, loadMore])

  const { showToast } = useToast()
  const resolveMaterialIdentities = useCallback(
    async (materials: MaterialItem[]): Promise<MaterialItem[]> => {
      if (!materials.some((item) => item.type === 'image')) return materials
      let people: Awaited<ReturnType<typeof listRealPeople>>
      try {
        people = await listRealPeople({ workspaceId })
      } catch {
        throw new Error('真人身份查询失败，请稍后重试添加素材')
      }
      return materials.map((item) => {
        if (item.type !== 'image') return item
        const realPerson = resolveCanvasAssetRealPerson(item.assetId, people, workspaceId)
        if (!realPerson && (item.realPerson || item.source === 'real_person')) {
          throw new Error('该真人素材已失效，请重新选择真人素材')
        }
        return { ...item, realPerson: realPerson ?? undefined, source: realPerson ? 'real_person' : item.source }
      })
    },
    [workspaceId],
  )

  /** 点击「应用」：先确认素材身份，再解析同源流式地址（面板保持打开）。 */
  const handleApply = useCallback(
    async (item: MaterialItem) => {
      try {
        const [resolved] = await resolveMaterialIdentities([item])
        let src = ''
        try {
          src = await getAssetDownloadUrl({ workspaceId, assetId: item.assetId })
        } catch {
          // 地址获取失败仍可由画布按 assetId 重建；身份查询失败不能降级为普通素材。
        }
        onApply({ ...resolved, src })
      } catch (error) {
        showToast(String((error as Error)?.message || '添加素材失败，请稍后重试'), 'error')
      }
    },
    [workspaceId, onApply, resolveMaterialIdentities, showToast],
  )

  /** 多选确认：逐个解析同源地址后一次性交回，由画布按顺序连成参考。 */
  const handleApplyPicked = useCallback(async () => {
    if (!picked.length || applying || !onApplyMany) return
    setApplying(true)
    try {
      const identified = await resolveMaterialIdentities(picked)
      const resolved = await Promise.all(
        identified.map(async (item) => {
          try {
            return { ...item, src: (await getAssetDownloadUrl({ workspaceId, assetId: item.assetId })) || '' }
          } catch {
            return { ...item, src: '' }
          }
        }),
      )
      onApplyMany(resolved)
    } catch (error) {
      setPickHint(String((error as Error)?.message || '添加素材失败，请稍后重试'))
    } finally {
      setApplying(false)
    }
  }, [picked, applying, onApplyMany, workspaceId, resolveMaterialIdentities])

  // 模糊匹配过滤：按素材名称（不区分大小写）
  const visibleItems = useMemo(() => {
    const keyword = searchQuery.trim().toLowerCase()
    if (!keyword) return items
    return items.filter((item) =>
      String(item.name || '')
        .toLowerCase()
        .includes(keyword),
    )
  }, [items, searchQuery])

  // popover：点击外部关闭
  useEffect(() => {
    if (!visible || variant !== 'popover') return
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (target.closest(`.${styles.panel}`)) return
      onClose()
    }
    setTimeout(() => document.addEventListener('mousedown', handler), 0)
    return () => document.removeEventListener('mousedown', handler)
  }, [visible, variant, onClose])

  if (!visible) return null
  if (variant === 'popover' && !position) return null

  // ---- Modal 形态：居中模态弹窗（对齐 Figma "添加素材"）----
  if (variant === 'modal') {
    return (
      <div className={styles.overlay} onMouseDown={onClose}>
        <div className={styles.modalPanel} onMouseDown={(e) => e.stopPropagation()}>
          {/* 工具栏：Tab（左）+ 模糊搜索框（最右），无标题无关闭按钮 */}
          <div className={styles.modalToolbar}>
            <div className={styles.modalTabs}>
              {TABS.map((t) => (
                <button
                  key={t.k}
                  className={`${styles.modalTab} ${tab === t.k ? styles.modalTabActive : ''}`}
                  onClick={() => setTab(t.k)}
                >
                  {t.l}
                </button>
              ))}
            </div>
            <label className={styles.modalSearch}>
              <svg
                className={styles.modalSearchIcon}
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="M16.5 16.5 21 21" />
              </svg>
              <input
                className={styles.modalSearchInput}
                type="text"
                value={searchQuery}
                placeholder="搜索素材名称..."
                aria-label="搜索素材名称"
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </label>
          </div>

          {/* 素材网格 */}
          <div className={`${styles.grid} ${styles.modalGrid} canvas-material-picker-grid`} ref={listRef}>
            {visibleItems.length === 0 && !loading && (
              <div className={styles.empty}>{searchQuery.trim() ? '未找到匹配素材' : '暂无素材'}</div>
            )}
            <div className={styles.modalGridInner}>
              {visibleItems.map((item) => {
                const pickedIndex = picked.findIndex((entry) => entry.id === item.id)
                return (
                  <ModalCard
                    key={item.id}
                    item={item}
                    workspaceId={workspaceId}
                    onApply={handleApply}
                    selectable={multiSelect}
                    selected={pickedIndex >= 0}
                    selectionIndex={pickedIndex + 1}
                    onToggle={togglePicked}
                  />
                )
              })}
            </div>
            {/* 底部状态：加载中 / 哨兵 / 已加载全部 */}
            {loading ? (
              <div className={styles.loading}>加载中...</div>
            ) : hasMore ? (
              <div ref={sentinelRef} className={styles.loadMoreSentinel} />
            ) : (
              visibleItems.length > 0 && <div className={styles.loading}>已加载全部</div>
            )}
          </div>
          {/* 多选确认栏：已选数量 / 还可选数量 + 一次性添加 */}
          {multiSelect && (
            <div className={styles.modalPickBar}>
              <span className={`${styles.modalPickText}${pickHint ? ` ${styles.modalPickHint}` : ''}`}>
                {pickHint ||
                  `已选 ${picked.length} 个，还可选 ${Math.max(0, (selectionLimit ?? 0) - picked.length)} 个`}
              </span>
              <button type="button" className={styles.modalPickCancel} onClick={onClose}>
                取消
              </button>
              <button
                type="button"
                className={styles.modalPickConfirm}
                disabled={!picked.length || applying}
                onClick={() => void handleApplyPicked()}
              >
                {applying ? '添加中…' : picked.length ? `添加 ${picked.length} 个参考` : '添加参考'}
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ---- popover / drawer：紧凑卡片形态 ----
  const panelStyle: React.CSSProperties | undefined =
    variant === 'popover' && position
      ? {
          left: position.x,
          top: position.y - 160,
        }
      : undefined

  return (
    <div
      className={[styles.panel, variant === 'drawer' ? styles.panelDrawer : ''].filter(Boolean).join(' ')}
      style={panelStyle}
    >
      {/* 头部 */}
      <div className={`${styles.header} ${variant === 'drawer' ? styles.headerDrawer : ''}`}>
        {variant === 'drawer' ? (
          <>
            <div className={styles.headerLeft}>
              <button className={styles.backBtn} onClick={onClose} aria-label="返回画布">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M10 3 5 8l5 5" />
                </svg>
              </button>
              <span className={styles.title}>素材库</span>
            </div>
          </>
        ) : (
          <span className={styles.title}>素材库</span>
        )}
        <button className={styles.closeBtn} onClick={onClose} aria-label="关闭素材库">
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>

      {/* Tab 切换 + 搜索框 */}
      <div className={styles.tabs}>
        {TABS.map((t) => (
          <button
            key={t.k}
            className={`${styles.tab} ${tab === t.k ? styles.tabActive : ''}`}
            onClick={() => setTab(t.k)}
          >
            {t.l}
          </button>
        ))}
        <label className={styles.search}>
          <svg
            viewBox="0 0 24 24"
            width="13"
            height="13"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M16.5 16.5 21 21" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            placeholder="搜索素材名称..."
            aria-label="搜索素材名称"
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </label>
      </div>

      {/* 缩略图网格 */}
      <div className={`${styles.grid} canvas-material-picker-grid`} ref={listRef}>
        {visibleItems.length === 0 && !loading && (
          <div className={styles.empty}>{searchQuery.trim() ? '未找到匹配素材' : '暂无素材'}</div>
        )}
        <div className={styles.gridInner}>
          {visibleItems.map((item) => (
            <div key={item.id} className={styles.materialCard}>
              <span className={styles.materialType}>
                {isAudioMaterial(item) ? '音频' : isVideoMaterial(item) ? '视频' : '图片'}
              </span>
              <div className={styles.materialCover}>
                <MaterialThumb item={item} workspaceId={workspaceId} />
              </div>
              <div className={styles.materialActions}>
                <button className={styles.materialActionBtn} onClick={() => handleApply(item)}>
                  应用
                </button>
              </div>
            </div>
          ))}
        </div>
        {loading ? (
          <div className={styles.loading}>加载中...</div>
        ) : hasMore ? (
          <div ref={sentinelRef} className={styles.loadMoreSentinel} />
        ) : (
          visibleItems.length > 0 && <div className={styles.loading}>已加载全部</div>
        )}
      </div>
    </div>
  )
}
