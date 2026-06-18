/**
 * MaterialLibraryDrawer — 素材库侧边抽屉
 * 从右侧滑入的素材库面板，支持浏览文件夹结构和选择素材添加到创意项目。
 */
import { useRef } from 'react'

interface MaterialLibraryDrawerProps {
  // 外部传入的素材库抽屉状态。
  // 这个抽屉是轻量版素材选择入口，主要用于右侧滑入快速挑选素材。
  materials: any[]
  selectedMaterialIds: any[]
  tab: string
  query?: string
  isLoading?: boolean
  isUploading?: boolean
  // 对父级暴露的抽屉交互事件：关闭、切换素材、上传文件、切换 tab 和搜索关键字。
  onClose?: () => void
  onToggleMaterial?: (material: any) => void
  onFilesUpload?: (files: FileList | File[]) => void
  onTabChange?: (tab: string) => void
  onQueryChange?: (query: string) => void
}

export default function MaterialLibraryDrawer({
  materials,
  selectedMaterialIds,
  tab,
  query = '',
  isLoading = false,
  isUploading = false,
  onClose,
  onToggleMaterial,
  onFilesUpload,
  onTabChange,
  onQueryChange,
}: MaterialLibraryDrawerProps) {
  // 隐藏文件输入框的 DOM 引用。
  const fileInput = useRef<HTMLInputElement>(null)

  // 通过自定义按钮触发原生文件选择框。
  function triggerUpload() {
    fileInput.current?.click()
  }

  // 把选中的文件列表交给父级，并清空 input 以支持重复选择同一文件。
  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    onFilesUpload?.(event.target.files || [])
    event.target.value = ''
  }

  return (
    <>
      <div className="library-mask" aria-hidden="true"></div>

      <aside className="material-library" aria-label="素材库">
        {/* 顶部标题、关闭按钮、我的/市场 tab。 */}
        <h2>素材库</h2>
        <button type="button" className="library-close" aria-label="收起素材库" onClick={() => onClose?.()}>
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M13 5 8 10l5 5" />
          </svg>
        </button>
        <div className="library-tabs">
          <button type="button" className={tab === 'mine' ? 'active' : ''} onClick={() => onTabChange?.('mine')}>
            我的
          </button>
          <button type="button" className={tab === 'market' ? 'active' : ''} onClick={() => onTabChange?.('market')}>
            市场
          </button>
        </div>

        {/* 搜索区：按关键字过滤当前素材列表。 */}
        <label className="library-search">
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path d="M5.2 9.4a4.2 4.2 0 1 1 0-8.4 4.2 4.2 0 0 1 0 8.4ZM8.2 8.2 11 11" />
          </svg>
          <input
            value={query}
            type="search"
            placeholder="搜索..."
            aria-label="搜索素材"
            onChange={(e) => onQueryChange?.(e.target.value)}
          />
        </label>

        {/* 素材网格区：展示当前 tab 下的素材列表并支持选中。 */}
        {isLoading ? (
          <div className="library-empty">素材加载中...</div>
        ) : !materials.length ? (
          <div className="library-empty">暂无素材</div>
        ) : (
          <div className="library-grid">
            {materials.map((material) => (
              <button
                key={material.id}
                type="button"
                className={`library-item${selectedMaterialIds.includes(material.id) ? ' selected' : ''}`}
                onClick={() => onToggleMaterial?.(material)}
              >
                <img src={material.src} alt={material.name} />
                {selectedMaterialIds.includes(material.id) ? <span>已添加</span> : null}
              </button>
            ))}
          </div>
        )}

        {/* 底部上传入口：支持本地图片/视频直接追加到素材库。 */}
        <button type="button" className="library-upload" disabled={isUploading} onClick={triggerUpload}>
          <svg viewBox="0 0 26 24" aria-hidden="true">
            <path
              d="M12.2304 2.04541V12.2156C12.2304 12.5565 12.4579 12.7838 12.7992 12.7838C13.1405 12.7838 13.3681 12.5565 13.3681 12.2156V1.93178L16.4399 4.94307C16.6674 5.17034 17.0088 5.17034 17.2363 4.94307C17.4638 4.71581 17.4638 4.3749 17.2363 4.14764L13.3681 0.397718C13.3681 0.340902 13.3112 0.227268 13.2543 0.170451C13.1405 0.0568168 12.9699 0 12.7992 0C12.6286 0 12.4579 0.0568168 12.3441 0.170451C12.2873 0.227268 12.2304 0.284085 12.2304 0.397718L8.36216 4.14764C8.13462 4.3749 8.13462 4.71581 8.36216 4.94307C8.58971 5.17034 8.93102 5.17034 9.15856 4.94307L12.2304 2.04541ZM6.14363 9.31798C6.48494 9.31798 6.71249 9.09071 6.71249 8.74981C6.71249 8.40891 6.48494 8.18164 6.14363 8.18164H3.29936V9.31798H3.41313V8.18164C1.53591 8.18164 0 9.7157 0 11.5907V20.1132C0 21.9882 1.53591 23.5222 3.41313 23.5222H22.1853C24.0626 23.5222 25.5985 21.9882 25.5985 20.1132V11.5907C25.5985 9.7157 24.0626 8.18164 22.1853 8.18164H19.5117C19.1704 8.18164 18.9429 8.40891 18.9429 8.74981C18.9429 9.09071 19.1704 9.31798 19.5117 9.31798H22.1853C23.4368 9.31798 24.4608 10.3407 24.4608 11.5907V20.1132C24.4608 21.3632 23.4368 22.3859 22.1853 22.3859H3.41313C2.16165 22.3859 1.13771 21.3632 1.13771 20.1132V11.5907C1.13771 10.3407 2.16165 9.31798 3.41313 9.31798V8.18164H3.29936V9.31798H6.14363ZM9.3861 17.0451C9.04479 17.0451 8.81725 17.2723 8.81725 17.6132C8.81725 17.9542 9.04479 18.1814 9.3861 18.1814H16.2124C16.5537 18.1814 16.7812 17.9542 16.7812 17.6132C16.7812 17.2723 16.5537 17.0451 16.2124 17.0451H9.3861Z"
              fill="#5767E5"
              fillOpacity="0.6"
            />
          </svg>
          {isUploading ? '上传中...' : '点击上传素材图片'}
        </button>
        <input
          ref={fileInput}
          className="file-input"
          type="file"
          multiple
          accept="image/*,video/*"
          onChange={handleFileChange}
        />
      </aside>
    </>
  )
}
