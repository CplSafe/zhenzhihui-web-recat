/**
 * MaterialPreviewModal — 素材快速预览弹窗
 * 点击素材缩略图时弹出，展示大图/视频预览和基本信息。
 */
import { getMaterialPoster, isVideoMaterial } from '@/utils/materials'

interface MaterialPreviewModalProps {
  // 外部传入的当前预览素材。
  material?: any | null
  // 弹窗只暴露关闭和移除两个动作。
  onClose?: () => void
  onRemove?: (id: any) => void
}

export default function MaterialPreviewModal({ material, onClose, onRemove }: MaterialPreviewModalProps) {
  if (!material) return null

  return (
    <div
      className="preview-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="素材预览"
      onClick={() => onClose?.()}
    >
      <div className="preview-dialog" onClick={(e) => e.stopPropagation()}>
        {/* 顶部关闭按钮。 */}
        <button type="button" className="preview-close" aria-label="关闭预览" onClick={() => onClose?.()}>
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M5 5 15 15M15 5 5 15" />
          </svg>
        </button>

        {/* 主预览区：优先显示视频，其次是封面图或图片本体。 */}
        {isVideoMaterial(material) && material?.src ? (
          <video src={material.src} poster={getMaterialPoster(material) || undefined} controls playsInline></video>
        ) : isVideoMaterial(material) && getMaterialPoster(material) ? (
          <img src={getMaterialPoster(material)} alt={material.name} />
        ) : material?.src ? (
          <img src={material.src} alt={material.name} />
        ) : (
          <div className="preview-fallback">{isVideoMaterial(material) ? '视频素材' : '图片素材'}</div>
        )}

        {/* 底部信息与操作区。 */}
        <div className="preview-footer">
          <span>{material.name}</span>
          <button type="button" onClick={() => onRemove?.(material.id)}>
            移除素材
          </button>
        </div>
      </div>
    </div>
  )
}
