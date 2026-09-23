/**
 * 爆款复刻入口页下方的「模板库」（原首页模板库迁移至此）。
 * - 目录走共享的 loadTemplateCatalog：后端模板优先，端点未开放时回退内置演示模板。
 * - 一次展示全部模板，不再截断 / 跳转「查看更多」，也不提供搜索。
 * - 卡片进入视口后才激活视频；点击放大预览，星标收藏（按工作空间存本地），「做同款」交给父级回填源视频。
 */
import { memo, useCallback, useEffect, useState } from 'react'
import { type TemplateItem } from '@/api/templates'
import { DEMO_TEMPLATES } from '@/data/demoTemplates'
import { loadTemplateCatalog } from '@/utils/templateCatalog'
import { favoriteKeyOf, loadFavoriteKeys, toggleFavorite } from '@/utils/favoriteVideos'
import { useCurrentUser, useWorkspaceId } from '@/stores/workspaceSession'
import { resolveUserId } from '@/utils/creativeDraftMetadata'
import VideoPreviewModal from '@/components/common/VideoPreviewModal'
import { LazyMediaVideo, useMediaCardActivation } from '@/components/common/LazyMediaVideo'
import './HotCopyShowcase.css'

interface TemplateCardProps {
  tpl: TemplateItem
  favorite: boolean
  onPreview: (url: string, poster: string) => void
  onToggleFavorite: (tpl: TemplateItem) => void
  onUseTemplate: (tpl: TemplateItem) => void
}

const TemplateCard = memo(function TemplateCard({
  tpl,
  favorite,
  onPreview,
  onToggleFavorite,
  onUseTemplate,
}: TemplateCardProps) {
  const { active, activationProps } = useMediaCardActivation()
  const canPreview = Boolean(tpl.videoUrl)
  // 瀑布流（与原首页一致）：每张卡按视频自己的比例展示，不统一裁成同一形状。
  // 先用目录里的宽高比占位，视频元数据到了再校正成真实尺寸——目录比例可能缺失或是从草稿推断的。
  const [ratio, setRatio] = useState(tpl.ratio)
  useEffect(() => setRatio(tpl.ratio), [tpl.ratio])
  const preview = () => {
    if (tpl.videoUrl) onPreview(tpl.videoUrl, tpl.thumbnailUrl || '')
  }

  return (
    <div className="hotcopy-tpl__card" {...activationProps}>
      <div
        className="hotcopy-tpl__thumb"
        style={{
          ...(ratio ? { aspectRatio: ratio } : {}),
          background: tpl.grad,
          cursor: canPreview ? 'zoom-in' : undefined,
        }}
        role={canPreview ? 'button' : undefined}
        tabIndex={canPreview ? 0 : undefined}
        aria-label={canPreview ? `预览${tpl.title || '模板视频'}` : undefined}
        title={canPreview ? '点击放大预览' : undefined}
        onClick={preview}
        onKeyDown={(event) => {
          if (!canPreview || event.target !== event.currentTarget) return
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            preview()
          }
        }}
      >
        {tpl.videoUrl ? (
          <LazyMediaVideo
            className="hotcopy-tpl__media"
            src={tpl.videoUrl}
            poster={tpl.thumbnailUrl || undefined}
            active={active}
            onLoadedMetadata={(event) => {
              const { videoWidth, videoHeight } = event.currentTarget
              if (videoWidth && videoHeight) setRatio(`${videoWidth} / ${videoHeight}`)
            }}
            onError={(event) => {
              event.currentTarget.style.display = 'none'
            }}
          />
        ) : tpl.thumbnailUrl ? (
          <img className="hotcopy-tpl__media" src={tpl.thumbnailUrl} alt={tpl.title} loading="lazy" />
        ) : null}
        {tpl.videoUrl ? (
          <button
            type="button"
            className={`hotcopy-tpl__fav${favorite ? ' is-on' : ''}`}
            aria-label={favorite ? '取消收藏' : '收藏'}
            onClick={(event) => {
              event.stopPropagation()
              onToggleFavorite(tpl)
            }}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
            </svg>
          </button>
        ) : null}
        <div className="hotcopy-tpl__mask">
          <button
            type="button"
            className="hotcopy-tpl__action"
            onClick={(event) => {
              event.stopPropagation()
              onUseTemplate(tpl)
            }}
          >
            做同款
          </button>
        </div>
      </div>
    </div>
  )
})

interface HotCopyTemplateGalleryProps {
  /** 「做同款」：把模板视频作为源爆款视频回填到上方入口。 */
  onUseTemplate: (tpl: TemplateItem) => void
}

/** 爆款复刻入口页的模板库区块。 */
export default function HotCopyTemplateGallery({ onUseTemplate }: HotCopyTemplateGalleryProps) {
  const workspaceId = useWorkspaceId()
  const currentUserId = resolveUserId(useCurrentUser())
  // 先用内置目录保证首屏有内容，共享目录加载器回来后再替换（失败时它自己回退内置目录）。
  const [templates, setTemplates] = useState<TemplateItem[]>(DEMO_TEMPLATES)
  const [watching, setWatching] = useState<{ url: string; poster: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    void loadTemplateCatalog().then((catalog) => {
      if (!cancelled) setTemplates(catalog.items)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // 收藏按工作空间保存到 localStorage；切换用户或工作空间时重新读取，避免收藏状态串用。
  const [favKeys, setFavKeys] = useState<Set<string>>(new Set())
  useEffect(() => {
    setFavKeys(loadFavoriteKeys(Number(workspaceId || 0)))
  }, [currentUserId, workspaceId])

  const toggleFav = useCallback(
    (tpl: TemplateItem) => {
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
    },
    [workspaceId],
  )

  const preview = useCallback((url: string, poster: string) => setWatching({ url, poster }), [])

  return (
    <section className="hotcopy-tpl" aria-labelledby="hotcopy-tpl-title" data-guide="hotcopy-templates">
      <h2 className="hotcopy-tpl__title" id="hotcopy-tpl-title">
        模板库
      </h2>
      {templates.length ? (
        <div className="hotcopy-tpl__grid">
          {templates.map((tpl, index) => (
            <TemplateCard
              key={`${tpl.id}-${index}`}
              tpl={tpl}
              favorite={favKeys.has(favoriteKeyOf(tpl.videoAssetId || 0, tpl.videoUrl))}
              onPreview={preview}
              onToggleFavorite={toggleFav}
              onUseTemplate={onUseTemplate}
            />
          ))}
        </div>
      ) : (
        <div className="hotcopy-tpl__empty">暂无模板</div>
      )}

      {/* 外链 OSS 视频无 CORS 头 → 预览弹窗不带 crossOrigin，否则会卡在 0:00 */}
      <VideoPreviewModal src={watching?.url || ''} poster={watching?.poster} onClose={() => setWatching(null)} />
    </section>
  )
}
