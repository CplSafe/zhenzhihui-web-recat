/**
 * ResourceManagementView — 资源素材项目管理页
 * 管理素材库中的资源项目，支持资产列表浏览、上传、删除，以及素材文件夹结构管理。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import '../styles/creative.css'
import './ResourceManagementView.css'
import AppLayout from '@/components/layout/AppLayout'
import AppToast from '@/components/AppToast'
import { useWorkspaceId } from '@/stores/workspaceSession'
import { useToast } from '@/composables/useToast'
import ResourceAddMaterialModal from '@/components/resource/ResourceAddMaterialModal'
import AssetPreviewModal from '@/components/resource/AssetPreviewModal'
import AiBadge from '@/components/common/AiBadge'
import { useAssetPreview } from '@/composables/useAssetPreview'
import { extractAssetPage, getAssetDownloadUrl, getBusinessErrorMessage, listAssets } from '@/api/business'

// 标签 → 接口 type 入参（'全部素材' 不传 type）。素材有 700+ 条，必须服务端按类型
// 过滤再翻页，不能只在已加载的局部里筛。
const TAB_TYPE: Record<string, string> = { 图片: 'image', 视频: 'video', 音频: 'audio' }
const PAGE_SIZE = 24

const resourceTabs = ['全部素材', '图片', '视频', '音频']
const filterGroups = ['全部行业', '全部风格', '全部比例']

// ---- 纯函数工具（与组件状态无关，提到模块层级） ----

function inferAssetCategory(asset: any, downloadUrl = '') {
  const type = String(asset?.type || '').toLowerCase()
  const mimeType = String(asset?.mime_type || '').toLowerCase()

  if (type === 'image' || mimeType.startsWith('image/')) {
    return '图片'
  }

  if (type === 'video' || mimeType.startsWith('video/')) {
    return '视频'
  }

  if (type === 'audio' || mimeType.startsWith('audio/')) {
    return '音频'
  }

  const fileHints = [asset?.name, asset?.file_name, asset?.url, asset?.preview_url, asset?.thumbnail_url, downloadUrl]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  if (/\.(png|jpe?g|gif|webp|bmp|svg|avif)(\?|$)/.test(fileHints)) {
    return '图片'
  }

  if (/\.(mp4|mov|avi|mkv|webm|m4v)(\?|$)/.test(fileHints)) {
    return '视频'
  }

  if (/\.(mp3|wav|aac|m4a|ogg|flac)(\?|$)/.test(fileHints)) {
    return '音频'
  }

  return '素材'
}

function mapAssetTypeLabel(asset: any, downloadUrl = '') {
  return inferAssetCategory(asset, downloadUrl)
}

function formatBytes(sizeBytes: any) {
  const value = Number(sizeBytes || 0)
  if (!Number.isFinite(value) || value <= 0) {
    return '0 MB'
  }

  if (value >= 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`
  }

  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`
  }

  if (value >= 1024) {
    return `${Math.round(value / 1024)} KB`
  }

  return `${value} B`
}

function buildAssetTags(asset: any, downloadUrl = '') {
  const tags: string[] = []
  const source = asset?.source === 'upload' ? '上传' : asset?.source || ''
  const status = asset?.status === 'active' ? '可用' : asset?.status || ''

  if (source) tags.push(source)
  if (status) tags.push(status)

  const typeLabel = mapAssetTypeLabel(asset, downloadUrl)
  if (typeLabel && !tags.includes(typeLabel)) {
    tags.push(typeLabel)
  }

  return tags.slice(0, 3)
}

// 生成类素材的可直接预览地址藏在 meta_json.source_url（已签名）。
// 优先用它，省掉每张卡片一次 download-url 往返。
function assetInlineUrl(asset: any) {
  return (
    asset?.thumbnail_url ||
    asset?.preview_url ||
    asset?.cover_url ||
    // 生成类素材的 source_url 是已签名可直接渲染地址，排在 asset.url 之前：
    // asset.url 可能是未签名的存储路径，渲染会 403。
    asset?.meta_json?.source_url ||
    asset?.url ||
    ''
  )
}

function resolveAssetPreview(asset: any, downloadUrl: string) {
  const assetCategory = inferAssetCategory(asset, downloadUrl)
  const mimeType = asset?.mime_type || ''
  const type = (asset?.type || '').toLowerCase()
  const imageUrl = assetInlineUrl(asset) || downloadUrl || ''

  if (imageUrl && (assetCategory === '图片' || type === 'image' || mimeType.startsWith('image/'))) {
    return {
      mediaKind: 'image',
      mediaUrl: imageUrl,
      posterUrl: '',
    }
  }

  if (assetCategory === '视频' || type === 'video' || mimeType.startsWith('video/')) {
    const posterUrl = asset?.thumbnail_url || asset?.cover_url || ''
    const videoUrl = asset?.preview_url || asset?.meta_json?.source_url || asset?.url || downloadUrl || ''

    if (videoUrl) {
      return {
        mediaKind: 'video',
        mediaUrl: videoUrl,
        posterUrl,
      }
    }

    if (posterUrl) {
      return {
        mediaKind: 'image',
        mediaUrl: posterUrl,
        posterUrl: '',
      }
    }
  }

  return {
    mediaKind: '',
    mediaUrl: '',
    posterUrl: '',
  }
}

/**
 * 素材缩略图:内联签名地址可能过期/未签名导致 403 → 加载失败时按 assetId 拉一次
 * 新的签名 download-url 重试,仍失败才显示占位。修复「部分素材图显示不出来」。
 */
function AssetThumb({ card, workspaceId }: { card: any; workspaceId: any }) {
  const [src, setSrc] = useState<string>(card.mediaUrl || '')
  const triedRef = useRef(false)

  useEffect(() => {
    setSrc(card.mediaUrl || '')
    triedRef.current = false
  }, [card.mediaUrl])

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

  if (!src || !card.mediaKind) {
    return (
      <div className="resource-asset-cover-placeholder">
        <span>{card.type}</span>
        <b>暂无预览</b>
      </div>
    )
  }
  if (card.mediaKind === 'video') {
    return (
      <video
        src={src}
        poster={card.posterUrl || undefined}
        aria-label={card.title}
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        onError={handleError}
      />
    )
  }
  return <img src={src} alt={card.title} loading="lazy" onError={handleError} />
}

export default function ResourceManagementView() {
  // 工作空间状态来自共享 store（与 AppLayout 同一份，不依赖组件层级）。
  const workspaceId = useWorkspaceId()

  // 页面级提示用自己的 toast（AppLayout 的 toast 在外壳里，页面消息自渲染一个）。
  const { showToast } = useToast()

  const [activeTab, setActiveTab] = useState('全部素材')
  const [searchQuery, setSearchQuery] = useState('')
  const [isLoadingAssets, setIsLoadingAssets] = useState(false)
  const [isAddMaterialModalVisible, setIsAddMaterialModalVisible] = useState(false)
  const [selectedAssetForAdd, setSelectedAssetForAdd] = useState<any>(null)

  // ---- 素材预览 ----
  const { previewState, openPreview, closePreview, goPrev, goNext } = useAssetPreview()

  const [resourceCards, setResourceCards] = useState<any[]>([])
  const [loadedCount, setLoadedCount] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const hasMore = loadedCount < totalCount

  // 类型筛选已在服务端按 tab 完成（见 loadPage 的 type 入参），这里只做已加载卡片
  // 内的关键字搜索。
  const displayedResourceCards = useMemo(() => {
    const keyword = searchQuery.trim().toLowerCase()
    if (!keyword) {
      return resourceCards
    }

    return resourceCards.filter((card) => {
      const haystack = [card.title, ...(card.tags || [])].join(' ').toLowerCase()
      return haystack.includes(keyword)
    })
  }, [searchQuery, resourceCards])

  const modalSeedAssets = displayedResourceCards.length ? displayedResourceCards : resourceCards

  function previewCard(card: any) {
    const currentCards = displayedResourceCards.length ? displayedResourceCards : resourceCards
    const index = currentCards.findIndex((c) => c.id === card.id)
    openPreview(currentCards, index >= 0 ? index : 0)
  }

  function openAddMaterialModal(card: any) {
    setSelectedAssetForAdd(card || null)
    setIsAddMaterialModalVisible(true)
  }

  function closeAddMaterialModal() {
    setIsAddMaterialModalVisible(false)
    setSelectedAssetForAdd(null)
  }

  const mapAssetToCard = useCallback(
    async (asset: any, index: number) => {
      // 优先用内联地址（含 meta_json.source_url）；仅当确实没有时才回退到 download-url 接口，
      // 避免每张卡片一次额外往返。
      let downloadUrl = ''
      if (!assetInlineUrl(asset) && asset?.id) {
        try {
          downloadUrl = await getAssetDownloadUrl({
            workspaceId,
            assetId: asset.id,
          })
        } catch {
          downloadUrl = ''
        }
      }

      return {
        id: asset?.id ?? `asset-${index}`,
        type: mapAssetTypeLabel(asset, downloadUrl),
        title: asset?.name || `素材 ${index + 1}`,
        tags: buildAssetTags(asset, downloadUrl),
        duration: asset?.duration || asset?.ratio || '3:4',
        size: formatBytes(asset?.size_bytes),
        // AI 生成判定:有 source 且非「上传」即视为生成类(用于右上角 AI 标识)
        isAi: !!asset?.source && asset.source !== 'upload',
        ...resolveAssetPreview(asset, downloadUrl),
      }
    },
    [workspaceId],
  )

  // 翻页核心：reset=true 时清空重头加载（切空间 / 切 tab），否则向后追加一页。
  // requestSeq 守卫：加载过程中若再次切空间/切 tab，旧请求的结果被丢弃，避免错位。
  const requestSeqRef = useRef(0)
  // 在闭包外读取最新的 loadedCount / isLoadingMore / hasMore。
  const loadedCountRef = useRef(0)
  const isLoadingMoreRef = useRef(false)
  const hasMoreRef = useRef(false)
  useEffect(() => {
    loadedCountRef.current = loadedCount
  }, [loadedCount])
  useEffect(() => {
    isLoadingMoreRef.current = isLoadingMore
  }, [isLoadingMore])
  useEffect(() => {
    hasMoreRef.current = hasMore
  }, [hasMore])

  const loadPage = useCallback(
    async (reset: boolean) => {
      const id = workspaceId
      if (!id) {
        setResourceCards([])
        setLoadedCount(0)
        setTotalCount(0)
        return
      }
      // 追加场景下若已有请求在飞 / 没有更多则跳过；reset 总是放行并取代在飞请求。
      if (!reset && (isLoadingMoreRef.current || !hasMoreRef.current)) return

      const seq = ++requestSeqRef.current
      const offset = reset ? 0 : loadedCountRef.current
      if (reset) {
        setIsLoadingAssets(true)
        setIsLoadingMore(false) // 取代可能在飞的 loadMore，清掉它的加载态
        isLoadingMoreRef.current = false
      } else {
        setIsLoadingMore(true)
        isLoadingMoreRef.current = true
      }

      try {
        const page = extractAssetPage(
          await listAssets({
            workspaceId: id,
            type: TAB_TYPE[activeTab] || '',
            status: 'active',
            limit: PAGE_SIZE,
            offset,
          }),
        )
        const cards = await Promise.all(page.items.map((asset: any, i: number) => mapAssetToCard(asset, offset + i)))

        if (seq !== requestSeqRef.current) return // 已被更新的请求取代，丢弃结果

        setResourceCards((prev) => {
          const next = reset ? cards : [...prev, ...cards]
          loadedCountRef.current = next.length
          setLoadedCount(next.length)
          return next
        })
        setTotalCount(page.total)
      } catch (error) {
        if (seq !== requestSeqRef.current) return
        if (reset) {
          setResourceCards([])
          setLoadedCount(0)
          loadedCountRef.current = 0
          setTotalCount(0)
        }
        showToast(getBusinessErrorMessage(error, '资源列表加载失败'), 'error')
      } finally {
        if (seq === requestSeqRef.current) {
          setIsLoadingAssets(false)
          setIsLoadingMore(false)
          isLoadingMoreRef.current = false
        }
      }
    },
    [workspaceId, activeTab, mapAssetToCard, showToast],
  )

  const loadMore = useCallback(() => {
    loadPage(false)
  }, [loadPage])

  // 切空间或切 tab 都从头加载。workspaceId 来自共享 store（不依赖组件层级），
  // 挂载时即触发覆盖冷导航。
  useEffect(() => {
    // 空间切换中途 id 可能短暂为空：立即清空，避免残留上一个空间的卡片闪现。
    if (!workspaceId) {
      requestSeqRef.current += 1 // 作废在飞请求
      setResourceCards([])
      setLoadedCount(0)
      loadedCountRef.current = 0
      setTotalCount(0)
      return
    }
    loadPage(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, activeTab])

  // 视区加载：网格底部哨兵进入视口即拉下一页（IntersectionObserver，不监听滚动事件）。
  const loadSentinelRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = loadSentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && hasMoreRef.current) {
          loadMore()
        }
      },
      { rootMargin: '400px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [loadMore])

  return (
    <AppLayout activeNav="素材市场">
      <AppToast />
      <section className="resource-page">
        <header className="resource-market-header">
          <div className="resource-market-copy">
            <h1>素材市场</h1>
            <p>海量优质素材，激发创意灵感</p>
          </div>

          <div className="resource-market-actions">
            <label className="resource-search">
              <input
                value={searchQuery}
                type="text"
                placeholder="搜索素材名称、关键词"
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M13.9 13.1 17 16.2M15.4 8.7a6.7 6.7 0 1 1-13.4 0 6.7 6.7 0 0 1 13.4 0Z" />
              </svg>
            </label>

            <button type="button" className="resource-mine-button">
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M3.6 6.4h4.1l1.1 1.3h7.6v6.7a1.3 1.3 0 0 1-1.3 1.3H4.9a1.3 1.3 0 0 1-1.3-1.3V7.7c0-.7.6-1.3 1.3-1.3Z" />
              </svg>
              我的素材
            </button>
          </div>
        </header>

        <section className="resource-market-body">
          <div className="resource-tabs">
            {resourceTabs.map((tab) => (
              <button
                key={tab}
                type="button"
                className={`resource-tab${tab === activeTab ? ' active' : ''}`}
                onClick={() => setActiveTab(tab)}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="resource-filters">
            <div className="resource-filter-group">
              {filterGroups.map((filter) => (
                <button key={filter} type="button" className="resource-filter">
                  <span>{filter}</span>
                  <svg viewBox="0 0 12 12" aria-hidden="true">
                    <path d="m3 4.5 3 3 3-3" />
                  </svg>
                </button>
              ))}
            </div>

            <button type="button" className="resource-sort">
              <span>按热度排序</span>
              <svg viewBox="0 0 12 12" aria-hidden="true">
                <path d="m3 4.5 3 3 3-3" />
              </svg>
            </button>
          </div>

          <div className="resource-grid">
            {displayedResourceCards.map((card) => (
              <article key={card.id} className="resource-asset-card">
                <div className="resource-asset-cover" onClick={() => previewCard(card)}>
                  <AssetThumb card={card} workspaceId={workspaceId} />
                  {card.isAi && card.mediaKind === 'image' && <AiBadge />}
                  <span className="resource-asset-type">{card.type}</span>

                  <button
                    type="button"
                    className="resource-asset-action"
                    onClick={(e) => {
                      e.stopPropagation()
                      openAddMaterialModal(card)
                    }}
                  >
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M8 3v10M3 8h10" />
                    </svg>
                    添加素材
                  </button>
                </div>

                <div className="resource-asset-info">
                  <h3>{card.title}</h3>
                  <div className="resource-asset-meta">
                    <span className="resource-asset-tags">{card.tags.join(' ')}</span>
                    <div className="resource-asset-extra">
                      <span>
                        <svg viewBox="0 0 12 12" aria-hidden="true">
                          <path d="M2.3 3.3h7.4M2.3 6h7.4M2.3 8.7h7.4" />
                        </svg>
                        {card.duration}
                      </span>
                      <span>
                        <svg viewBox="0 0 12 12" aria-hidden="true">
                          <path d="M2.7 2.3h6.6c.7 0 1.2.5 1.2 1.2v5c0 .7-.5 1.2-1.2 1.2H5.5L3 11V9.7H2.7c-.7 0-1.2-.5-1.2-1.2v-5c0-.7.5-1.2 1.2-1.2Z" />
                        </svg>
                        {card.size}
                      </span>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>

          {!displayedResourceCards.length && !isLoadingAssets && (
            <div className="resource-empty-placeholder">暂无符合条件的素材</div>
          )}

          {/* 视区加载哨兵：滚动到此处自动拉下一页 */}
          <div ref={loadSentinelRef} className="resource-load-sentinel" aria-hidden="true"></div>

          {isLoadingMore ? (
            <p className="resource-load-status">加载中…</p>
          ) : !hasMore && resourceCards.length ? (
            <p className="resource-load-status resource-load-status--end">已加载全部 {totalCount} 个素材</p>
          ) : null}
        </section>
      </section>

      <ResourceAddMaterialModal
        visible={isAddMaterialModalVisible}
        assets={modalSeedAssets}
        assetToAdd={selectedAssetForAdd}
        onClose={closeAddMaterialModal}
        onAssetAdded={() => showToast('已添加到项目', 'success')}
      />

      {/* 素材大图预览弹窗（支持图片/视频，左右切换，键盘导航） */}
      <AssetPreviewModal state={previewState} onClose={closePreview} onPrev={goPrev} onNext={goNext} />
    </AppLayout>
  )
}
