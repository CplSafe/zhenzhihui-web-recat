/**
 * ResourceManagementView — 素材市场(2.1)
 * 三 Tab:我上传的 / 我生成的 / 我收藏的;各 Tab 有子分类。默认「我上传的-全部」,按操作时间倒序。
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
import ResourceAddMaterialModal from '@/components/resource/ResourceAddMaterialModal'
import AssetPreviewModal from '@/components/resource/AssetPreviewModal'
import AiBadge from '@/components/common/AiBadge'
import { useAssetPreview } from '@/composables/useAssetPreview'
import { extractAssetPage, getAssetDownloadUrl, getBusinessErrorMessage, listAssets } from '@/api/business'

const ROUTE_MAP: Record<string, string> = {
  home: '/home',
  creative: '/smart',
  'hot-copy': '/hot-copy',
  projects: '/projects',
  resources: '/resources',
  templates: '/templates',
}

// 三个主 Tab + 各自子分类
const MAIN_TABS = [
  { key: 'upload', label: '我上传的', subs: [{ k: 'all', l: '全部' }, { k: 'image', l: '图片' }, { k: 'video', l: '视频' }] },
  { key: 'generated', label: '我生成的', subs: [{ k: 'all', l: '全部' }, { k: 'role', l: '角色' }, { k: 'scene', l: '场景' }, { k: 'video', l: '视频' }] },
  { key: 'collected', label: '我收藏的', subs: [{ k: 'all', l: '全部' }, { k: 'template', l: '模板' }, { k: 'ip', l: 'IP' }] },
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
    asset?.thumbnail_url ||
    asset?.preview_url ||
    asset?.cover_url ||
    asset?.meta_json?.source_url ||
    asset?.url ||
    ''
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

// 缩略图:签名地址过期/未签名导致 403 → 按 assetId 取新签名重试,仍失败显示占位
function AssetThumb({ card, workspaceId }: { card: any; workspaceId: any }) {
  const [src, setSrc] = useState<string>(card.mediaUrl || '')
  const triedRef = useRef(false)
  useEffect(() => {
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
  }, [card.mediaUrl, card?.id, workspaceId])
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
    return <video src={src} poster={card.posterUrl || undefined} aria-label={card.title} autoPlay muted loop playsInline preload="metadata" onError={handleError} />
  }
  return <img src={src} alt={card.title} loading="lazy" onError={handleError} />
}

export default function ResourceManagementView() {
  const navigate = useNavigate()
  const workspaceId = useWorkspaceId()
  const { showToast } = useToast()
  const { previewState, openPreview, closePreview, goPrev, goNext } = useAssetPreview()

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [mainTab, setMainTab] = useState<(typeof MAIN_TABS)[number]['key']>('upload')
  const [subTab, setSubTab] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [rawAssets, setRawAssets] = useState<any[]>([])

  const [isAddMaterialModalVisible, setIsAddMaterialModalVisible] = useState(false)
  const [selectedAssetForAdd, setSelectedAssetForAdd] = useState<any>(null)

  const handleNavigate = (key: string) => {
    const path = ROUTE_MAP[key]
    if (path) navigate(path)
    else showToast('功能待开放', 'info')
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
    if (mainTab === 'upload') {
      base = cards.filter((c) => c.source === 'upload')
      if (subTab === 'image') base = base.filter((c) => c.kind === 'image')
      else if (subTab === 'video') base = base.filter((c) => c.kind === 'video')
    } else if (mainTab === 'generated') {
      base = cards.filter((c) => c.source && c.source !== 'upload')
      if (subTab === 'video') base = base.filter((c) => c.kind === 'video')
      else if (subTab === 'role') base = base.filter((c) => c.roleScene === 'role')
      else if (subTab === 'scene') base = base.filter((c) => c.roleScene === 'scene')
    } else {
      base = [] // 收藏:后端暂无,占位
    }
    if (keyword) base = base.filter((c) => [c.title, ...(c.tags || [])].join(' ').toLowerCase().includes(keyword))
    return base.slice().sort((a, b) => b.ts - a.ts)
  }, [cards, mainTab, subTab, searchQuery])

  const subs = MAIN_TABS.find((t) => t.key === mainTab)?.subs || []

  const onSelectMain = (key: (typeof MAIN_TABS)[number]['key']) => {
    setMainTab(key)
    setSubTab('all')
  }
  const onSelectSub = (k: string) => {
    if (mainTab === 'collected' && k === 'ip') {
      showToast('IP 功能待开放', 'info')
      return
    }
    setSubTab(k)
  }

  function previewCard(card: any) {
    const index = visibleCards.findIndex((c) => c.id === card.id)
    openPreview(visibleCards, index >= 0 ? index : 0)
  }

  return (
    <div className="rm2-page">
      <AppSidebar activeKey="resources" onNavigate={handleNavigate} open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="rm2-shell">
        <AppTopbar onMenu={() => setSidebarOpen(true)} onMember={() => showToast('会员中心待开放', 'info')} />
        <AppToast />

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
                <path d="M13.9 13.1 17 16.2M15.4 8.7a6.7 6.7 0 1 1-13.4 0 6.7 6.7 0 0 1 13.4 0Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              <input
                value={searchQuery}
                type="text"
                placeholder="搜索素材名称、关键词"
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </label>
          </div>

          {/* 子分类 */}
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

          {/* 内容 */}
          {mainTab === 'collected' ? (
            <div className="rm2-empty">收藏功能待开放</div>
          ) : loading && !visibleCards.length ? (
            <div className="rm2-empty">加载中…</div>
          ) : !visibleCards.length ? (
            <div className="rm2-empty">暂无符合条件的素材</div>
          ) : (
            <div className="resource-grid">
              {visibleCards.map((card) => (
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
                        setSelectedAssetForAdd(card)
                        setIsAddMaterialModalVisible(true)
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
                        <span>{card.duration}</span>
                        <span>{card.size}</span>
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
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
