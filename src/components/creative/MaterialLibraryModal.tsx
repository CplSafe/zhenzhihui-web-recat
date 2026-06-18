/**
 * MaterialLibraryModal — 素材库完整弹窗
 * 全屏弹窗展示素材库，支持搜索、筛选、分页浏览、文件夹管理、选择素材添加到创意项目。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from 'antd'
import './MaterialLibraryModal.css'

// 外部传入的完整素材库弹窗状态。
// 这个弹窗用于更完整的素材浏览和批量添加，交互会比侧边抽屉更重一些。
interface MaterialLibraryModalProps {
  visible?: boolean
  materials: any[]
  selectedMaterialIds: any[]
  tab: string
  query?: string
  isLoading?: boolean
  isUploading?: boolean
  // 对父级暴露的素材库弹窗事件：关闭、tab/搜索变更、本地上传和确认添加素材。
  onClose?: () => void
  onTabChange?: (tab: string) => void
  onQueryChange?: (query: string) => void
  onFilesUpload?: (files: FileList | File[]) => void
  onAddMaterials?: (materials: any[]) => void
}

export default function MaterialLibraryModal({
  visible = false,
  materials,
  selectedMaterialIds,
  tab,
  query = '',
  isLoading = false,
  isUploading = false,
  onClose,
  onTabChange: _onTabChange,
  onQueryChange,
  onFilesUpload,
  onAddMaterials,
}: MaterialLibraryModalProps) {
  // 本地弹窗状态。
  // draftSelectedIds 只用于本次弹窗内的暂存选择；favoriteIds 目前是前端本地演示态。
  const fileInput = useRef<HTMLInputElement>(null)
  const [draftSelectedIds, setDraftSelectedIds] = useState<any[]>([])
  const [favoriteIds, setFavoriteIds] = useState<Set<any>>(new Set())

  // 每次弹窗重新打开时，清空这一次的临时勾选结果。
  useEffect(() => {
    if (visible) {
      setDraftSelectedIds([])
    }
  }, [visible])

  // 选择状态的集合化派生，方便在模板中快速判断是否已选/是否已加入。
  const selectedIdSet = useMemo(() => new Set(draftSelectedIds), [draftSelectedIds])
  const alreadySelectedSet = useMemo(() => new Set(selectedMaterialIds), [selectedMaterialIds])

  // 在弹窗里切换某个素材的临时选中状态。
  function toggleDraft(material: any) {
    if (!material?.id) return
    const id = material.id
    if (selectedIdSet.has(id)) {
      setDraftSelectedIds((prev) => prev.filter((item) => item !== id))
      return
    }
    setDraftSelectedIds((prev) => [...prev, id])
  }

  // 收藏按钮目前仅维护前端本地状态，用于素材卡片的交互反馈。
  function toggleFavorite(material: any) {
    if (!material?.id) return
    const id = material.id
    setFavoriteIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  // 底部"添加"按钮是否可用。
  const canConfirm = draftSelectedIds.length > 0

  // 确认后，把当前弹窗里勾选的素材一次性回传给父级。
  function confirmSelection() {
    if (!canConfirm) return
    const idSet = selectedIdSet
    const picked = materials.filter((item) => idSet.has(item.id))
    onAddMaterials?.(picked)
    onClose?.()
  }

  // 通过按钮触发隐藏的文件选择框。
  function triggerUpload() {
    fileInput.current?.click()
  }

  // 把选中的本地文件交给父级上传，并清空 input 值。
  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    onFilesUpload?.(event.target.files || [])
    event.target.value = ''
  }

  return (
    <Modal
      open={visible}
      centered
      closable={false}
      maskClosable={false}
      footer={null}
      width="min(1100px, calc(100vw - 48px))"
      className="material-library-modal"
      onCancel={() => onClose?.()}
      styles={{ body: { padding: 0 } }}
    >
      <div className="mlm-shell" aria-label="添加素材">
        {/* 顶部面包屑 + 搜索 */}
        <header className="mlm-header">
          <div className="mlm-breadcrumb">
            <span>全部项目</span>
            <span className="mlm-sep">/</span>
            <span>菜菜APP五一推广</span>
          </div>
          <div className="mlm-search">
            <input
              value={query}
              type="search"
              placeholder="搜索素材名称"
              aria-label="搜索素材名称"
              onChange={(e) => onQueryChange?.(e.target.value)}
            />
          </div>
        </header>

        {/* Hero 区域：标题、说明和上传入口。 */}
        <section className="mlm-hero">
          <div className="mlm-hero-left">
            <h2 className="mlm-hero-title">素材市场</h2>
            <p className="mlm-hero-desc">海量优质素材，激发创意灵感</p>
            <button type="button" className="mlm-hero-more">
              探索更多优质素材
              <span aria-hidden="true">→</span>
            </button>
          </div>
          <div className="mlm-hero-right">
            <button type="button" className="mlm-upload-btn" disabled={isUploading} onClick={triggerUpload}>
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path
                  d="M8 1a.5.5 0 0 1 .5.5V7h5.5a.5.5 0 0 1 0 1H8.5v5.5a.5.5 0 0 1-1 0V8H2a.5.5 0 0 1 0-1h5.5V1.5A.5.5 0 0 1 8 1Z"
                  fill="currentColor"
                />
              </svg>
              {isUploading ? '上传中...' : '上传本地素材'}
            </button>
            <div className="mlm-hero-icons" aria-hidden="true">
              <span className="hero-icon hero-icon-1">🖼️</span>
              <span className="hero-icon hero-icon-2">🎬</span>
              <span className="hero-icon hero-icon-3">✨</span>
            </div>
          </div>
        </section>

        {/* 筛选栏：类型、排序、收藏与批量操作入口。 */}
        <div className="mlm-filter-bar">
          <div className="mlm-filters">
            <button type="button" className="mlm-filter-btn">
              全部类型
              <svg viewBox="0 0 12 12" aria-hidden="true">
                <path
                  d="M3 4.5l3 3 3-3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <button type="button" className="mlm-filter-btn">
              时间排序
              <svg viewBox="0 0 12 12" aria-hidden="true">
                <path
                  d="M3 4.5l3 3 3-3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <label className="mlm-filter-check">
              <input type="checkbox" />
              <span>我收藏的</span>
            </label>
          </div>
          <button type="button" className="mlm-batch-link">
            退出批量操作
            <svg viewBox="0 0 14 14" aria-hidden="true">
              <path d="M11 3L3 11M3 3l8 8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* 素材网格：浏览当前素材列表并进行本次弹窗内的临时勾选。 */}
        <section className="mlm-body" aria-label="素材列表">
          {isLoading ? (
            <div className="mlm-empty">素材加载中...</div>
          ) : tab !== 'mine' ? (
            <div className="mlm-empty">暂无内容</div>
          ) : !materials.length ? (
            <div className="mlm-empty">暂无素材</div>
          ) : (
            <div className="mlm-grid">
              {materials.map((material) => (
                <div
                  key={material.id}
                  className={`mlm-item${selectedIdSet.has(material.id) ? ' selected' : ''}${
                    alreadySelectedSet.has(material.id) ? ' added' : ''
                  }`}
                  onClick={() => toggleDraft(material)}
                >
                  <img src={material.src} alt={material.name} />
                  <div className="mlm-item-overlay">
                    <div className="mlm-item-left">
                      <span className="mlm-item-type">
                        图片
                        <svg viewBox="0 0 12 12" aria-hidden="true" className="mlm-type-icon">
                          <path d="M1 2.5a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5v-7ZM4 5l2 2.5L8.5 4.5 11 8H1l3-3Z" />
                        </svg>
                      </span>
                      <button
                        type="button"
                        className={`mlm-item-fav${favoriteIds.has(material.id) ? ' active' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleFavorite(material)
                        }}
                      >
                        <svg viewBox="0 0 16 16" aria-hidden="true">
                          <path d="M8 2.5l1.8 3.6 4 .6-2.9 2.8.7 4-3.6-1.9-3.6 1.9.7-4L2.2 6.7l4-.6L8 2.5z" />
                        </svg>
                      </button>
                    </div>
                    <label className="mlm-item-check" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedIdSet.has(material.id)}
                        onChange={() => toggleDraft(material)}
                      />
                      <span className="checkmark"></span>
                    </label>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 底部操作栏：全选、确认添加、关闭弹窗。 */}
        <footer className="mlm-footer">
          <label className="mlm-select-all" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={materials.length > 0 && draftSelectedIds.length === materials.length}
              readOnly
            />
            <span>全选</span>
            {draftSelectedIds.length ? <span className="mlm-count">(已选{draftSelectedIds.length}个)</span> : null}
          </label>
          <div className="mlm-actions">
            <button
              type="button"
              className="mlm-action-btn mlm-action-add"
              disabled={!canConfirm}
              onClick={confirmSelection}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path
                  d="M8 2a.75.75 0 0 1 .75.75V7.25H13.25a.75.75 0 0 1 0 1.5H8.75V13.25a.75.75 0 0 1-1.5 0V8.75H2.75a.75.75 0 0 1 0-1.5H7.25V2.75A.75.75 0 0 1 8 2Z"
                  fill="currentColor"
                />
              </svg>
              添加
            </button>
            <button type="button" className="mlm-action-btn mlm-action-collect">
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path
                  d="M8 2.5l1.8 3.6 4 .6-2.9 2.8.7 4-3.6-1.9-3.6 1.9.7-4L2.2 6.7l4-.6L8 2.5z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.3"
                />
              </svg>
              收藏
            </button>
            <button type="button" className="mlm-action-btn mlm-action-delete">
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path
                  d="M5.5 3.5V2.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1h3a.5.5 0 0 1 0 1h-1v8a1.5 1.5 0 0 1-1.5 1.5h-6A1.5 1.5 0 0 1 3.5 12.5v-8h-1a.5.5 0 0 1 0-1h3Zm1 0h3V2.5h-3v1ZM4.5 4.5v8a.5.5 0 0 0 .5.5h6a.5.5 0 0 0 .5-.5v-8h-7Z"
                  fill="currentColor"
                />
              </svg>
              删除
            </button>
          </div>
        </footer>

        <input
          ref={fileInput}
          className="file-input"
          type="file"
          multiple
          accept="image/*,video/*"
          onChange={handleFileChange}
        />
      </div>
    </Modal>
  )
}
