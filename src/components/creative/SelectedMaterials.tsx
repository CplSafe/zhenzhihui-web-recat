/**
 * SelectedMaterials — 已选参考素材展示
 * 网格展示用户选择的参考图片/视频素材，支持移除操作。
 */
import type { CSSProperties } from 'react'

// 素材缩略图优先取服务端生成的缩略图或视频封面。
function getMaterialPoster(material: any): string {
  const asset = material?.serverAsset
  return asset?.thumbnail_url || asset?.cover_url || ''
}

// 判断素材是否为视频，用于切换 video / img 的渲染方式。
function isVideoMaterial(material: any): boolean {
  const mimeType = String(material?.mimeType || material?.serverAsset?.mime_type || '')
  return material?.type === 'video' || mimeType.startsWith('video/')
}

interface SelectedMaterialsProps {
  // 外部传入的已选素材列表与面板样式。
  panelStyle: CSSProperties
  materials: any[]
  // 对父级暴露的素材交互事件：预览、移除、打开素材库。
  onPreview?: (material: any) => void
  onRemove?: (id: any) => void
  onOpenLibrary?: () => void
}

export default function SelectedMaterials({
  panelStyle,
  materials,
  onPreview,
  onRemove,
  onOpenLibrary,
}: SelectedMaterialsProps) {
  return (
    <section className="selected-materials" style={panelStyle} aria-label="选中素材">
      <h2>已加入素材</h2>

      {/*
        已选素材网格：
        负责把当前脚本/分镜流程中正在使用的参考素材展示出来，并提供单个移除与预览入口。
      */}
      <div className="selected-grid">
        {materials.map((material) => (
          <figure key={material.id} className="selected-thumb">
            <button
              type="button"
              className="selected-preview"
              aria-label={`预览${material.name}`}
              onClick={() => onPreview?.(material)}
            >
              {isVideoMaterial(material) && material?.src ? (
                <video
                  src={material.src}
                  poster={getMaterialPoster(material) || undefined}
                  muted
                  playsInline
                  preload="metadata"
                ></video>
              ) : isVideoMaterial(material) && getMaterialPoster(material) ? (
                <img src={getMaterialPoster(material)} alt={material.name} />
              ) : material?.src ? (
                <img src={material.src} alt={material.name} />
              ) : (
                <span className="selected-fallback">{isVideoMaterial(material) ? '视频素材' : '图片素材'}</span>
              )}
            </button>
            <button
              type="button"
              className="remove-material"
              aria-label={`移除${material.name}`}
              onClick={(e) => {
                e.stopPropagation()
                onRemove?.(material.id)
              }}
            >
              <svg viewBox="0 0 12 12" aria-hidden="true">
                <path d="M3 3 9 9M9 3 3 9" />
              </svg>
            </button>
          </figure>
        ))}

        {/* 追加素材入口：跳转到素材库继续选择。 */}
        <button type="button" className="add-material" aria-label="打开素材库" onClick={() => onOpenLibrary?.()}>
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M10 4v12M4 10h12" />
          </svg>
        </button>
      </div>
    </section>
  )
}
