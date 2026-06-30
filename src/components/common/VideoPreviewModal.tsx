/**
 * VideoPreviewModal — 全屏视频预览弹窗(点遮罩关闭)。
 * 复用 home__video-modal* 样式(由 HomeView.css 提供,首页/模板库均已载入)。
 * 取代此前在 HomeView(历史项目播放 + 模板预览)与 TemplatesView 里三份重复的同款弹窗。
 */
interface VideoPreviewModalProps {
  /** 视频地址;为空则不渲染 */
  src: string
  poster?: string
  /** 仅同源资产(/download)需要;外链 OSS 无 CORS 头,传它会卡在 0:00,故默认不带 */
  crossOrigin?: 'anonymous' | 'use-credentials'
  onClose: () => void
}

export default function VideoPreviewModal({ src, poster, crossOrigin, onClose }: VideoPreviewModalProps) {
  if (!src) return null
  return (
    <div className="home__video-modal-mask" onClick={onClose}>
      <div className="home__video-modal" onClick={(e) => e.stopPropagation()}>
        <button className="home__video-modal-close" onClick={onClose} aria-label="关闭">
          ✕
        </button>
        <video
          className="home__video-modal-player"
          src={src}
          poster={poster || undefined}
          controls
          autoPlay
          playsInline
          {...(crossOrigin ? { crossOrigin } : {})}
        />
      </div>
    </div>
  )
}
