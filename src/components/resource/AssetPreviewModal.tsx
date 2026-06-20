/**
 * AssetPreviewModal — 素材预览弹窗（图片 & 视频）
 *
 * 全屏沉浸式预览，仿 Element Plus ElImageViewer 风格：
 * · 半透明暗色全屏遮罩（无对话框边框）
 * · 打开/关闭无动画过渡（直接出现/消失），避免关闭闪烁
 * · 媒体区域固定最大尺寸，切换时不会撑起跳动
 * · 左右箭头 + 键盘导航 + Esc 关闭
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import type { AssetPreviewState } from '@/composables/useAssetPreview'
import { useWorkspaceId } from '@/stores/workspaceSession'
import { getAssetDownloadUrl } from '@/api/business'
import './AssetPreviewModal.css'

interface AssetPreviewModalProps {
  state: AssetPreviewState
  onClose?: () => void
  onPrev?: () => void
  onNext?: () => void
}

/**
 * 预览媒体:签名地址可能过期 → 加载失败时按 assetId 拉一次新签名地址重试(与列表缩略图一致)。
 */
function PreviewMedia({ item, workspaceId, videoKey }: { item: any; workspaceId: any; videoKey: number }) {
  const [src, setSrc] = useState<string>(item?.mediaUrl || '')
  const triedRef = useRef(false)

  useEffect(() => {
    setSrc(item?.mediaUrl || '')
    triedRef.current = false
  }, [item?.mediaUrl])

  const handleError = useCallback(async () => {
    if (triedRef.current) {
      setSrc('')
      return
    }
    triedRef.current = true
    const id = item?.id
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
  }, [item?.id, workspaceId])

  if (item?.mediaKind === 'image' && src) {
    return <img src={src} alt={item.title} className="asset-preview-image" onError={handleError} />
  }
  if (item?.mediaKind === 'video' && src) {
    return (
      <video
        key={'v' + videoKey}
        src={src}
        poster={item.posterUrl || undefined}
        controls
        playsInline
        preload="metadata"
        className="asset-preview-video"
        onError={handleError}
      />
    )
  }
  return (
    <div className="asset-preview-fallback">
      <span>{item?.type || '素材'}</span>
      <b>暂无预览</b>
    </div>
  )
}

export default function AssetPreviewModal({ state, onClose, onPrev, onNext }: AssetPreviewModalProps) {
  const workspaceId = useWorkspaceId()
  // ---- 派生值 ----
  const activeIndex = Number(state?.activeIndex) || 0
  const items = useMemo(() => (Array.isArray(state?.items) ? state.items : []), [state?.items])
  const visible = Boolean(state?.visible) && items.length > 0

  const activeItem = items[activeIndex] || null
  const hasPrev = activeIndex > 0
  const hasNext = activeIndex < items.length - 1
  const totalCount = items.length
  const displayIndex = totalCount > 0 ? activeIndex + 1 : 0

  // ---- 切换素材时，若为视频则从头播放（key 变化触发 video 重建） ----
  const [videoKey, setVideoKey] = useState(0)
  useEffect(() => {
    setVideoKey((k) => k + 1)
  }, [activeIndex])

  // ---- methods ----

  function handlePrev() {
    if (hasPrev) onPrev?.()
  }

  function handleNext() {
    if (hasNext) onNext?.()
  }

  function handleClose() {
    onClose?.()
  }

  /** 点击空白处关闭:除图片/视频本体、箭头、按钮外,点任意位置都关闭 */
  function onMaskClick(e: MouseEvent<HTMLDivElement>) {
    const t = e.target as HTMLElement
    if (t.closest('.asset-preview-image, .asset-preview-video, button')) return
    handleClose()
  }

  // 关闭时直接移除 DOM，无闪烁
  if (!visible) return null

  return (
    <div className="asset-preview-overlay" onClick={onMaskClick}>
      {/* 顶部工具栏 */}
      <div className="asset-preview-toolbar">
        <span className="asset-preview-counter">
          {displayIndex} / {totalCount}
        </span>
        <button type="button" className="asset-preview-close-btn" aria-label="关闭预览" onClick={handleClose}>
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M5 5 15 15M15 5 5 15" />
          </svg>
        </button>
      </div>

      {/* 主体预览区：固定宽高上限，防止切换图片时撑起跳动 */}
      <div className="asset-preview-body">
        {/* 左箭头 */}
        {hasPrev && (
          <button
            type="button"
            className="asset-preview-arrow asset-preview-arrow--left"
            aria-label="上一张"
            onClick={handlePrev}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 4 7 12 15 20" />
            </svg>
          </button>
        )}

        {/* 图片 / 视频 — 容器尺寸固定 */}
        <div className="asset-preview-media-wrap">
          <PreviewMedia item={activeItem} workspaceId={workspaceId} videoKey={videoKey} />
        </div>

        {/* 右箭头 */}
        {hasNext && (
          <button
            type="button"
            className="asset-preview-arrow asset-preview-arrow--right"
            aria-label="下一张"
            onClick={handleNext}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 4 17 12 9 20" />
            </svg>
          </button>
        )}
      </div>

      {/* 底部信息栏 */}
      {activeItem && (
        <div className="asset-preview-footer">
          <h3 className="asset-preview-title">{activeItem.title}</h3>
          {activeItem.tags?.length ? (
            <p className="asset-preview-tags">{activeItem.tags.join(' ／ ')}</p>
          ) : null}
        </div>
      )}
    </div>
  )
}
