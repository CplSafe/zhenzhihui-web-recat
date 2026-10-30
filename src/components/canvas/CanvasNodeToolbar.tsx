/**
 * 单选节点时浮在节点上方的操作条。
 *
 * 这些动作原先散在三个地方：节点上方的标题（改名）、节点顶部的胶囊（上传/下载/删除）、
 * 视频区右下角的截帧按钮。同一个节点的操作分三处、样式还各不相同，
 * 既难找也挡画面。这里统一收进一条工具栏，节点本身回归纯画面。
 *
 * 位置由调用方按节点包围盒算好后传入（视口坐标），组件本身不关心画布变换。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import styles from './CanvasNodeToolbar.module.css'

/**
 * 截帧位置。current/first/last 与 utils/videoFrameCapture 的 VideoFramePosition 对应；
 * custom = 任意帧：打开放大预览，拖进度条到想要的位置再点「截取此帧」（反馈 #7）。
 */
export type CanvasCapturePosition = 'current' | 'first' | 'last' | 'custom'

export interface CanvasNodeToolbarProps {
  /** 视口坐标：工具条的水平中心与底边位置 */
  anchor: { centerX: number; bottom: number }
  /** 节点类型，决定显示哪些动作 */
  kind: string
  /** 是否已有素材（决定「上传」还是「替换」、能否下载） */
  hasContent: boolean
  /** 素材仍在上传中：替换/下载此刻都拿不到 assetId */
  uploading: boolean
  /** 截帧进行中，禁用该入口避免重复触发 */
  capturing: boolean
  onRename: () => void
  onUpload?: () => void
  onDownload?: () => void
  /** 图片/视频放大预览；放在屏幕固定工具栏中，不随画布缩放。 */
  onPreview?: () => void
  onCapture?: (position: CanvasCapturePosition) => void
  onDelete: () => void
  onHd?: () => void
  onCompareHd?: () => void
  hdDisabledReason?: string
  imageToolCodes?: string[]
  onImageTool?: (code: string) => void
  onReversePrompt?: () => void
}

const CAPTURE_ITEMS: Array<{ position: CanvasCapturePosition; label: string; hint?: string }> = [
  { position: 'current', label: '截取当前帧' },
  { position: 'first', label: '截取首帧' },
  { position: 'last', label: '截取尾帧' },
  // 任意帧藏在放大预览里没人找得到：这里给一个显式入口，点了直接打开预览去拖进度条
  { position: 'custom', label: '自定义截帧…', hint: '拖动进度条选取任意一帧' },
]

export default function CanvasNodeToolbar({
  anchor,
  kind,
  hasContent,
  uploading,
  capturing,
  onRename,
  onUpload,
  onDownload,
  onPreview,
  onCapture,
  onDelete,
  onHd,
  onCompareHd,
  hdDisabledReason,
  onImageTool,
  onReversePrompt,
  imageToolCodes = [],
}: CanvasNodeToolbarProps) {
  const [captureMenuOpen, setCaptureMenuOpen] = useState(false)
  const captureWrapRef = useRef<HTMLSpanElement | null>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const [barWidth, setBarWidth] = useState(0)
  useLayoutEffect(() => {
    const bar = barRef.current
    if (!bar) return
    const update = () => setBarWidth(bar.getBoundingClientRect().width)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(bar)
    return () => observer.disconnect()
  }, [])
  const centerX = Math.max(12 + barWidth / 2, Math.min(anchor.centerX, window.innerWidth - 12 - barWidth / 2))

  // 点到别处收起菜单，避免它一直盖在画面上
  useEffect(() => {
    if (!captureMenuOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (captureWrapRef.current?.contains(event.target as Node)) return
      setCaptureMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCaptureMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [captureMenuOpen])

  // 节点换了或素材没了就收起菜单，否则菜单会挂在一个不再适用的节点上
  useEffect(() => {
    if (!hasContent) setCaptureMenuOpen(false)
  }, [hasContent])

  const isMedia = kind === 'image' || kind === 'video'
  // 视频有素材后不再提供「替换」：换视频等于换一个节点，走新建更清楚
  const showUpload = Boolean(onUpload) && isMedia && !(kind === 'video' && hasContent) && !uploading
  const showDownload = Boolean(onDownload) && (isMedia || kind === 'audio') && hasContent && !uploading
  // 图片与视频都支持放大预览；图片预览还带全部图片的画廊导航
  const showPreview = Boolean(onPreview) && isMedia && hasContent && !uploading
  const showCapture = Boolean(onCapture) && kind === 'video' && hasContent
  // 空图片/视频节点还没有可处理的素材；时间线继续保留现有超分入口。
  const showHd = Boolean(onHd) && (kind === 'timeline' || (isMedia && hasContent && !uploading))

  return (
    <div
      ref={barRef}
      className={`${styles.bar} ${kind === 'image' ? styles.imageBar : ''} nodrag nopan`}
      style={{ left: centerX, bottom: anchor.bottom }}
      role="toolbar"
      aria-label="节点操作"
      // 画布在捕获阶段处理指针事件，不拦住会连带触发框选与取消选中
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <button type="button" className={styles.action} data-tip="重命名" aria-label="重命名节点" onClick={onRename}>
        <RenameIcon />
      </button>

      {showUpload && (
        <button
          type="button"
          className={styles.action}
          data-tip={hasContent ? '替换' : '上传'}
          aria-label={hasContent ? '替换素材' : '上传素材'}
          onClick={onUpload}
        >
          <UploadIcon />
        </button>
      )}

      {showCapture && (
        <span className={styles.menuAnchor} ref={captureWrapRef}>
          <button
            type="button"
            className={styles.action}
            data-tip="截帧"
            aria-label="截取画面为图片"
            aria-haspopup="menu"
            aria-expanded={captureMenuOpen}
            disabled={capturing}
            onClick={() => setCaptureMenuOpen((open) => !open)}
          >
            <CaptureIcon />
          </button>
          {captureMenuOpen && (
            <div className={styles.menu} role="menu" aria-label="截帧位置">
              {CAPTURE_ITEMS.map((item) => (
                <button
                  key={item.position}
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  title={item.hint}
                  onClick={() => {
                    setCaptureMenuOpen(false)
                    onCapture?.(item.position)
                  }}
                >
                  {item.label}
                  {item.hint && <small className={styles.menuItemHint}>{item.hint}</small>}
                </button>
              ))}
            </div>
          )}
        </span>
      )}

      {showDownload && (
        <button type="button" className={styles.action} data-tip="下载" aria-label="下载素材" onClick={onDownload}>
          <DownloadIcon />
        </button>
      )}

      {kind === 'image' && hasContent && !uploading && onImageTool && (
        <>
          {imageToolCodes.includes('image.multi_angle') && (
            <button
              type="button"
              className={`${styles.action} ${styles.textAction}`}
              onClick={() => onImageTool('image.multi_angle')}
            >
              多角度
            </button>
          )}
          {imageToolCodes.includes('image.relight') && (
            <button
              type="button"
              className={`${styles.action} ${styles.textAction}`}
              onClick={() => onImageTool('image.relight')}
            >
              打光
            </button>
          )}
          {(imageToolCodes.includes('image.panorama') || imageToolCodes.includes('panorama.view')) && (
            <button
              type="button"
              className={`${styles.action} ${styles.textAction}`}
              onClick={() =>
                onImageTool(imageToolCodes.includes('image.panorama') ? 'image.panorama' : 'panorama.view')
              }
            >
              全景
            </button>
          )}
        </>
      )}

      {isMedia && hasContent && !uploading && onReversePrompt && (
        <button
          type="button"
          className={`${styles.action} ${styles.textAction} ${styles.reversePromptHidden}`}
          onClick={onReversePrompt}
          aria-label="反推提示词"
          data-tip="点击后立即分析当前素材，无需输入提示词"
        >
          反推提示词
        </button>
      )}

      {showHd && onHd && (
        <span title={hdDisabledReason || '提升画质，保留原文件'}>
          <button
            type="button"
            className={styles.action}
            onClick={onHd}
            disabled={Boolean(hdDisabledReason)}
            aria-label="超分"
          >
            超分
          </button>
        </span>
      )}
      {onCompareHd && (
        <button type="button" className={styles.action} onClick={onCompareHd} aria-label="对比高清版">
          对比
        </button>
      )}
      <span className={styles.divider} aria-hidden="true" />

      <button
        type="button"
        className={`${styles.action} ${styles.danger}`}
        data-tip="删除"
        aria-label="删除节点"
        onClick={onDelete}
      >
        <DeleteIcon />
      </button>

      {showPreview && (
        <button
          type="button"
          className={`${styles.action} ${styles.preview}`}
          data-tip="放大"
          aria-label={kind === 'video' ? '放大预览视频' : '放大预览图片'}
          onClick={onPreview}
        >
          <PreviewIcon />
        </button>
      )}
    </div>
  )
}

function PreviewIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7" />
    </svg>
  )
}

function RenameIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 20h16" />
      <path d="m14.5 4.5 5 5L9 20H4v-5z" strokeLinejoin="round" />
    </svg>
  )
}

function UploadIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 16V4" />
      <path d="m6 10 6-6 6 6" />
      <path d="M4 20h16" />
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 4v12" />
      <path d="m6 10 6 6 6-6" />
      <path d="M4 20h16" />
    </svg>
  )
}

function CaptureIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 7h3l1.5-2h7L17 7h3v12H4z" />
      <circle cx="12" cy="13" r="3.4" />
    </svg>
  )
}

function DeleteIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 7h16" />
      <path d="M10 4h4M9 7v11M15 7v11" />
      <path d="M6 7h12l-1 13H7z" />
    </svg>
  )
}
