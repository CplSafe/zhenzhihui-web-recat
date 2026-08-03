/**
 * CanvasMaterialPicker — 画布素材库浮动面板
 * 数据来源：GET /api/v1/assets（按 workspace 分页，status=active）
 * 图片/视频 Tab 切换，3 列网格缩略图，滚动加载更多。
 * 封面加载对齐「我的素材」页面（ResourceManagementView.AssetThumb）：
 * 后端 /api/v1/assets 列表不返回可展示 URL（无 thumbnail/cover/url 字段），
 * 因此进入视口后统一按 assetId 调用 getAssetDownloadUrl
 * （/api/v1/assets/{id}/download?workspace_id=X）获取同源流式地址加载。
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { listAssets, getAssetDownloadUrl } from '@/api/business'
import { createMaterialFromAsset, isVideoMaterial } from '@/utils/materials'
import styles from './CanvasMaterialPicker.module.less'

interface MaterialItem {
  id: string
  assetId: number
  /** 选中后解析出的同源流式地址（生成任务用） */
  src: string
  name: string
  type: string
}

interface CanvasMaterialPickerProps {
  /** 所属工作空间 ID，素材按 workspace 隔离 */
  workspaceId: number
  visible: boolean
  position: { x: number; y: number } | null
  onClose: () => void
  /** 点击「应用」时回调（解析好同源流式地址后传入） */
  onApply: (material: MaterialItem) => void
}

const PAGE_SIZE = 30

/**
 * 素材封面缩略图（对齐 ResourceManagementView.AssetThumb）：
 * - IntersectionObserver 懒加载，滑入视口才请求
 * - 进入视口后按 assetId 调 getAssetDownloadUrl 获取同源流式地址
 * - 图片用 img；视频用 video（preload="metadata" 显示首帧）
 * - 加载失败按 assetId 重取一次，仍失败显示占位
 */
function MaterialThumb({ item, workspaceId }: { item: MaterialItem; workspaceId: number }) {
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
    // root 指向滚动容器：panel 为 position:fixed，默认 viewport root 在滚动容器内部
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

  // 加载失败：按 assetId 重取一次（结果写入缓存）
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
  // （参考 ResourceManagementView.AssetThumb：!src 时渲染占位 div）
  if (!src) {
    return (
      <div ref={rootRef} className={styles.itemMediaPlaceholder}>
        <span>{isVideoMaterial(item) ? '视频' : '图片'}</span>
        <b>加载中</b>
      </div>
    )
  }

  // 数据返回后才渲染媒体节点
  return (
    <div ref={rootRef} className={styles.itemMedia}>
      {isVideo ? (
        <video src={src} muted autoPlay loop playsInline preload="metadata" onError={handleError} />
      ) : (
        <img src={src} loading="lazy" onError={handleError} />
      )}
    </div>
  )
}

export default function CanvasMaterialPicker({
  workspaceId,
  visible,
  position,
  onClose,
  onApply,
}: CanvasMaterialPickerProps) {
  const [tab, setTab] = useState<'image' | 'video'>('image')
  const [items, setItems] = useState<MaterialItem[]>([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const loadingRef = useRef(false)
  // 追踪当前展示的 tab：请求完成后仅当 tab 未切换才更新界面，避免旧请求覆盖新 tab
  const tabRef = useRef<'image' | 'video'>(tab)
  tabRef.current = tab
  // 请求序号：切换 tab 后旧请求结果直接丢弃
  const requestSeqRef = useRef(0)

  /** 拉取一页素材并映射为展示结构 */
  const fetchAssets = useCallback(
    async (type: 'image' | 'video', pg: number, reset: boolean) => {
      if (loadingRef.current) return
      loadingRef.current = true
      const seq = ++requestSeqRef.current
      setLoading(true)
      try {
        const data = await listAssets({
          workspaceId,
          type,
          status: 'active',
          limit: PAGE_SIZE,
          offset: pg * PAGE_SIZE,
        })
        const rawItems = data?.items || []
        const mapped: MaterialItem[] = rawItems.map((asset: any) => {
          const m = createMaterialFromAsset(asset, '')
          return {
            ...m,
            type: m.type || type,
          }
        })
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
    [workspaceId],
  )

  // 打开面板或切换 tab：总是重新加载第一页
  useEffect(() => {
    if (!visible) return
    setItems([])
    setPage(0)
    setHasMore(true)
    fetchAssets(tab, 0, true)
  }, [visible, tab, fetchAssets])

  const loadMore = useCallback(() => {
    const nextPage = page + 1
    setPage(nextPage)
    fetchAssets(tab, nextPage, false)
  }, [page, tab, fetchAssets])

  const listRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

  // 底部哨兵：进入滚动容器可视区（含 80px 预加载）即自动加载下一页，
  // 加载完成后若仍接近底部会再次触发，实现连续加载（参考 ResourceManagementView 的增量取数）
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

  /** 点击「应用」：解析同源流式地址后回调（面板保持打开，可连续应用） */
  const handleApply = useCallback(
    async (item: MaterialItem) => {
      try {
        const url = await getAssetDownloadUrl({ workspaceId, assetId: item.assetId })
        onApply({ ...item, src: url })
      } catch {
        onApply({ ...item, src: '' })
      }
    },
    [workspaceId, onApply],
  )

  // 点击外部关闭
  useEffect(() => {
    if (!visible) return
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (target.closest(`.${styles.panel}`)) return
      onClose()
    }
    setTimeout(() => document.addEventListener('mousedown', handler), 0)
    return () => document.removeEventListener('mousedown', handler)
  }, [visible, onClose])

  if (!visible || !position) return null

  const panelStyle: React.CSSProperties = {
    left: position.x,
    top: position.y - 160,
  }

  return (
    <div className={styles.panel} style={panelStyle}>
      {/* 头部 */}
      <div className={styles.header}>
        <span className={styles.title}>素材库</span>
        <button className={styles.closeBtn} onClick={onClose}>
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

      {/* Tab 切换 */}
      <div className={styles.tabs}>
        <button className={`${styles.tab} ${tab === 'image' ? styles.tabActive : ''}`} onClick={() => setTab('image')}>
          图片
        </button>
        <button className={`${styles.tab} ${tab === 'video' ? styles.tabActive : ''}`} onClick={() => setTab('video')}>
          视频
        </button>
      </div>

      {/* 缩略图网格 */}
      <div className={`${styles.grid} canvas-material-picker-grid`} ref={listRef}>
        {items.length === 0 && !loading && <div className={styles.empty}>暂无素材</div>}
        <div className={styles.gridInner}>
          {items.map((item) => (
            <div key={item.id} className={styles.materialCard}>
              {/* 类型标签（参考 resource-asset-type） */}
              <span className={styles.materialType}>{isVideoMaterial(item) ? '视频' : '图片'}</span>
              {/* 封面区域（参考 resource-asset-cover，不含底部信息区） */}
              <div className={styles.materialCover}>
                <MaterialThumb item={item} workspaceId={workspaceId} />
              </div>
              {/* 悬浮操作栏（参考 resource-favorite-actions）：hover 时浮现「应用」 */}
              <div className={styles.materialActions}>
                <button className={styles.materialActionBtn} onClick={() => handleApply(item)}>
                  <svg
                    viewBox="0 0 24 24"
                    width="12"
                    height="12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
                  </svg>
                  应用
                </button>
              </div>
            </div>
          ))}
        </div>
        {/* 底部状态：加载中 / 哨兵（进入视口自动加载下一页）/ 已加载全部 */}
        {loading ? (
          <div className={styles.loading}>加载中...</div>
        ) : hasMore ? (
          <div ref={sentinelRef} className={styles.loadMoreSentinel} />
        ) : (
          items.length > 0 && <div className={styles.loading}>已加载全部</div>
        )}
      </div>
    </div>
  )
}
