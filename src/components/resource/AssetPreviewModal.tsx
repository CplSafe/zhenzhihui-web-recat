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

/** 预览队列状态及关闭、前后切换回调。 */
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
  const assetId = Number(item?.assetId ?? item?.id ?? 0) || 0
  const requestScope = `${Number(workspaceId || 0)}:${assetId}:${String(item?.mediaUrl || '')}`
  const requestScopeRef = useRef(requestScope)
  requestScopeRef.current = requestScope

  useEffect(() => {
    let cancelled = false
    const scope = requestScope
    setSrc(item?.mediaUrl || '')
    triedRef.current = false
    // 无内联地址:按 assetId 取签名地址(否则永远显示「暂无预览」)
    if (!item?.mediaUrl && assetId > 0) {
      triedRef.current = true
      getAssetDownloadUrl({ workspaceId, assetId })
        .then((u) => {
          if (!cancelled && requestScopeRef.current === scope) setSrc(u || '')
        })
        .catch(() => {})
    }
    return () => {
      cancelled = true
    }
  }, [assetId, item?.mediaUrl, requestScope, workspaceId])

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

/** 渲染跨图片/视频的全屏预览，并在工作空间切换时阻止旧资产串入新空间。 */
export default function AssetPreviewModal({ state, onClose, onPrev, onNext }: AssetPreviewModalProps) {
  const workspaceId = useWorkspaceId()
  const overlayRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  // ---- 派生值 ----
  const activeIndex = Number(state?.activeIndex) || 0
  const items = useMemo(() => (Array.isArray(state?.items) ? state.items : []), [state?.items])
  const activeItem = items[activeIndex] || null
  const activeWorkspaceId = Number(activeItem?.workspaceId || 0)
  const workspaceMatches = activeWorkspaceId <= 0 || activeWorkspaceId === Number(workspaceId || 0)
  // 工作空间切换后的首帧先隐藏旧预览，避免旧 assetId 搭配新 workspaceId 请求。
  const visible = Boolean(state?.visible) && items.length > 0 && workspaceMatches
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

  useEffect(() => {
    if (!visible) return
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current?.()
        return
      }
      if (event.key !== 'Tab' || !overlayRef.current) return
      const focusable = Array.from(
        overlayRef.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), video[controls], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.getAttribute('aria-hidden') !== 'true')
      if (!focusable.length) {
        event.preventDefault()
        overlayRef.current.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      window.requestAnimationFrame(() => {
        if (previouslyFocused?.isConnected) previouslyFocused.focus()
      })
    }
  }, [visible])

  // 关闭时直接移除 DOM，无闪烁
  if (!visible) return null

  return (
    <div
      ref={overlayRef}
      className="asset-preview-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="素材预览"
      tabIndex={-1}
      onClick={onMaskClick}
    >
      {/* 顶部工具栏 */}
      <div className="asset-preview-toolbar">
        <span className="asset-preview-counter">
          {displayIndex} / {totalCount}
        </span>
        <button
          ref={closeButtonRef}
          type="button"
          className="asset-preview-close-btn"
          aria-label="关闭预览"
          onClick={handleClose}
        >
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
          {activeItem.tags?.length ? <p className="asset-preview-tags">{activeItem.tags.join(' ／ ')}</p> : null}
        </div>
      )}
    </div>
  )
}
