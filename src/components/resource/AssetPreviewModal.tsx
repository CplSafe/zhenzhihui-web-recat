/**
 * AssetPreviewModal — 素材预览弹窗（图片 & 视频）
 *
 * 全屏沉浸式预览，仿 Element Plus ElImageViewer 风格：
 * · 半透明暗色全屏遮罩（无对话框边框）
 * · 打开/关闭无动画过渡（直接出现/消失），避免关闭闪烁
 * · 媒体区域固定最大尺寸，切换时不会撑起跳动
 * · 左右箭头 + 键盘导航 + Esc 关闭
 */
import { useEffect, useMemo, useState } from 'react'
import type { MouseEvent } from 'react'
import type { AssetPreviewState } from '@/composables/useAssetPreview'
import './AssetPreviewModal.css'

interface AssetPreviewModalProps {
  state: AssetPreviewState
  onClose?: () => void
  onPrev?: () => void
  onNext?: () => void
}

export default function AssetPreviewModal({ state, onClose, onPrev, onNext }: AssetPreviewModalProps) {
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

  /** 点击遮罩背景关闭 */
  function onMaskClick(e: MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) handleClose()
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
          {activeItem?.mediaKind === 'image' && activeItem?.mediaUrl ? (
            <img src={activeItem.mediaUrl} alt={activeItem.title} className="asset-preview-image" />
          ) : activeItem?.mediaKind === 'video' && activeItem?.mediaUrl ? (
            <video
              key={'v' + videoKey}
              src={activeItem.mediaUrl}
              poster={activeItem.posterUrl || undefined}
              controls
              playsInline
              preload="metadata"
              className="asset-preview-video"
            />
          ) : (
            <div className="asset-preview-fallback">
              <span>{activeItem?.type || '素材'}</span>
              <b>暂无预览</b>
            </div>
          )}
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
