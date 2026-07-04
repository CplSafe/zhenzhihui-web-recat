/*
  StoryboardEditDialog — 单张分镜图编辑弹窗
  支持修改画面描述 prompt、上传参考素材、选择编辑模型，确认后重新生成分镜图并触发分镜词更新。
*/
import { useEffect, useMemo, useRef, useState } from 'react'

export interface StoryboardEditMaterial {
  id: string | number
  src: string
  name?: string
  [key: string]: any
}

export interface StoryboardEditHistoryItem {
  id: string | number
  src: string
  title?: string
  [key: string]: any
}

export interface StoryboardEditDialogProps {
  // 外部传入的单张分镜编辑数据。
  // 这里只处理当前被编辑的那一张分镜，以及与它相关的参考素材和历史版本。
  item?: any
  itemIndex?: number
  materials?: StoryboardEditMaterial[]
  historyItems?: StoryboardEditHistoryItem[]
  isSubmitting?: boolean
  // 对父级暴露的弹窗事件。
  // 当前组件只负责采集编辑输入，真正的重新生成和素材库操作由父级接管。
  onClose?: () => void
  onConfirm?: (payload: { itemId: string | number; prompt: string }) => void
  onOpenLibrary?: () => void
  onRemoveMaterial?: (materialId: string | number) => void
}

export default function StoryboardEditDialog(props: StoryboardEditDialogProps) {
  const {
    item = null,
    itemIndex = 0,
    materials = [],
    historyItems = [],
    isSubmitting = false,
    onClose,
    onConfirm,
    onOpenLibrary,
    onRemoveMaterial,
  } = props

  // 本地编辑状态。
  // prompt 是用户输入的修改描述，activeHistoryId 用来切换查看历史生成图。
  const [prompt, setPrompt] = useState('')
  const [activeHistoryId, setActiveHistoryId] = useState<string | number>('')
  const activeHistoryIdRef = useRef<string | number>('')
  activeHistoryIdRef.current = activeHistoryId

  // 弹窗内的展示派生数据。
  // 这里对素材数量和历史数量做了收敛，避免弹窗区域被过多内容撑爆。
  const visibleMaterials = useMemo(() => materials.slice(0, 2), [materials])
  const visibleHistory = useMemo(() => historyItems.slice(0, 3), [historyItems])
  const activeHistory = useMemo(
    () => visibleHistory.find((history) => history.id === activeHistoryId),
    [visibleHistory, activeHistoryId],
  )
  const activeImage = activeHistory?.src || item?.src || ''
  const storyboardNumber = Math.max(itemIndex + 1, 1)

  // 当切换到新的分镜时，重置当前输入框内容。
  function resetModifyState() {
    setPrompt('')
  }

  // 确认修改时，把当前分镜 id 与用户输入的描述统一交给父级处理。
  // 如果用户没输入内容，则回退到一条默认修改描述。
  function confirmModify() {
    if (!item || isSubmitting) {
      return
    }

    onConfirm?.({
      itemId: item.id,
      prompt: prompt.trim() || '已按当前描述修改分镜图片',
    })
  }

  // 当前编辑分镜变化后，重置历史选中与输入框。
  useEffect(() => {
    setActiveHistoryId('')
    resetModifyState()
  }, [item?.id])

  // 当历史记录变化且尚未主动选择历史版本时，默认定位到第一张历史图。
  const historyKey = historyItems.map((history) => history.id).join('|')
  useEffect(() => {
    if (activeHistoryIdRef.current) {
      return
    }
    setActiveHistoryId(historyItems[0]?.id || '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyKey])

  if (!item) return null

  return (
    <div
      className="storyboard-edit-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="图片修改"
      onClick={() => onClose?.()}
    >
      <section className="storyboard-edit-dialog" onClick={(e) => e.stopPropagation()}>
        {/* 左侧主预览区：展示当前分镜或当前选中的历史版本。 */}
        <div className="storyboard-edit-left">
          <img src={activeImage} alt={item.title} draggable={false} />
          {isSubmitting && (
            <div className="storyboard-edit-generating">
              <span>正在生成中...</span>
              <i>
                <b></b>
              </i>
            </div>
          )}
        </div>

        <button
          type="button"
          className="storyboard-edit-close"
          aria-label="关闭图片修改"
          onClick={() => onClose?.()}
        >
          <svg viewBox="0 0 14 14" aria-hidden="true">
            <path d="M6.99978 0.620361C3.47639 0.620361 0.620117 3.47664 0.620117 7.00002C0.620117 10.5234 3.47638 13.3797 6.99978 13.3797C10.5232 13.3797 13.3794 10.5234 13.3794 7.00002C13.3794 3.47662 10.5232 0.620361 6.99978 0.620361ZM10.3213 9.08265C10.6298 9.39111 10.6298 9.89589 10.3213 10.2044L10.0409 10.4848C9.73241 10.7932 9.22763 10.7932 8.91916 10.4848L6.91816 8.48376L4.91715 10.4848C4.60869 10.7932 4.10391 10.7932 3.79545 10.4848L3.51502 10.2043C3.20656 9.89588 3.20656 9.3911 3.51502 9.08264L5.51603 7.08163L3.35179 4.91739C3.04333 4.60893 3.04333 4.10415 3.35179 3.79569L3.63222 3.51526C3.94068 3.2068 4.44546 3.2068 4.75392 3.51526L6.91816 5.67951L9.08239 3.51528C9.39085 3.20682 9.89563 3.20682 10.2041 3.51528L10.4845 3.7957C10.793 4.10417 10.793 4.60895 10.4845 4.91741L8.32029 7.08163L10.3213 9.08265Z" />
          </svg>
        </button>

        {/* 基础信息区：分镜编号、时长、比例。 */}
        <div className="storyboard-edit-meta">
          <span>分镜{storyboardNumber}</span>
          <span>
            <b>时长</b>10s
          </span>
          <span>
            <b>比例</b>9:16
          </span>
        </div>

        {/* 文本修改区：输入对当前分镜的画面调整要求。 */}
        <label className="storyboard-edit-prompt">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            aria-label="图片修改描述"
            placeholder="输入图片修改描述，例如:将送菜的人换为外卖员..."
          ></textarea>
          <button type="button" aria-label="提交图片修改" disabled={isSubmitting} onClick={confirmModify}>
            <svg viewBox="0 0 32 32" aria-hidden="true">
              <path d="M27.3125 4.68741C21.0642 -1.56247 10.934 -1.56247 4.68721 4.68741C-1.55954 10.9373 -1.56266 21.0656 4.68721 27.3139C10.9371 33.5622 21.0654 33.5618 27.3137 27.3139C33.562 21.066 33.5605 10.9342 27.3125 4.68741ZM24.5345 14.8333L18.2959 19.5738C18.2467 19.6115 18.188 19.6348 18.1263 19.641C18.0647 19.6471 18.0025 19.636 17.9468 19.6087C17.8911 19.5815 17.8441 19.5393 17.8111 19.4868C17.7781 19.4343 17.7604 19.3737 17.76 19.3117V17.1985C17.7596 17.114 17.7271 17.0329 17.6691 16.9716C17.611 16.9103 17.5318 16.8734 17.4475 16.8684C14.6179 16.6903 12.1378 16.9879 10.4586 18.7528C9.59922 19.6562 8.56291 21.448 8.31487 21.9738C8.27972 22.048 8.21488 22.1855 8.05863 22.2374L8.04496 22.2417C7.9913 22.2586 7.93426 22.2617 7.87909 22.2507C7.82393 22.2397 7.77243 22.215 7.72934 22.1789C7.58169 22.055 7.49223 21.98 8.08558 19.5574C9.09142 15.4559 13.0171 12.7751 17.4635 12.2822C17.5448 12.2737 17.62 12.2355 17.6748 12.175C17.7296 12.1144 17.7601 12.0357 17.7604 11.9541V9.83066C17.7612 9.76888 17.7791 9.70853 17.8122 9.65636C17.8453 9.60418 17.8922 9.56224 17.9478 9.53521C18.0034 9.50818 18.0653 9.49713 18.1268 9.50329C18.1883 9.50946 18.2468 9.5326 18.2959 9.57012L24.5345 14.3091C24.5751 14.3397 24.608 14.3793 24.6307 14.4247C24.6534 14.4702 24.6652 14.5204 24.6652 14.5712C24.6652 14.622 24.6534 14.6722 24.6307 14.7176C24.608 14.7631 24.5751 14.8027 24.5345 14.8333Z" />
            </svg>
          </button>
        </label>

        {/* 已添加的参考素材。 */}
        <h3 className="storyboard-edit-added-title">已新添素材</h3>
        <div className="storyboard-edit-added-list">
          {visibleMaterials.map((material) => (
            <figure key={material.id} className="storyboard-edit-material">
              <img src={material.src} alt={material.name} draggable={false} />
              <button
                type="button"
                aria-label={`移除${material.name}`}
                onClick={() => onRemoveMaterial?.(material.id)}
              >
                <svg viewBox="0 0 14 14" aria-hidden="true">
                  <path d="M11.5259 3.27051H2.44058C2.14618 3.27051 1.90527 3.5101 1.90527 3.80555V12.0914C1.90527 12.6823 2.38316 13.1592 2.97302 13.1592H10.9935C11.5849 13.1592 12.0612 12.6813 12.0612 12.0914V3.80555C12.0612 3.5101 11.8216 3.27051 11.5259 3.27051ZM4.57788 9.01533C4.57788 9.23743 4.39988 9.41753 4.177 9.41753C3.9554 9.41753 3.77611 9.23927 3.77611 9.01533V5.54353C3.77611 5.32143 3.95411 5.14135 4.177 5.14135C4.39858 5.14135 4.57788 5.3196 4.57788 5.54353V9.01533ZM7.51776 10.6199C7.51776 10.8415 7.33976 11.0211 7.11688 11.0211C6.89528 11.0211 6.71598 10.8428 6.71598 10.6199V5.00798C6.71598 4.78638 6.894 4.60681 7.11688 4.60681C7.33846 4.60681 7.51776 4.78508 7.51776 5.00798V10.6199ZM10.4576 9.01533C10.4576 9.23743 10.2796 9.41753 10.0567 9.41753C9.83517 9.41753 9.65586 9.23927 9.65586 9.01533V5.54353C9.65586 5.32143 9.83387 5.14135 10.0567 5.14135C10.2783 5.14135 10.4576 5.3196 10.4576 5.54353V9.01533Z" />
                  <path d="M1.90527 2.3351C1.90527 2.11377 2.08588 1.9342 2.30642 1.9342H11.66C11.8814 1.9342 12.0612 2.11222 12.0612 2.3351C12.0612 2.55642 11.8806 2.73599 11.66 2.73599H2.30642C2.08509 2.73599 1.90527 2.558 1.90527 2.3351Z" />
                  <path d="M5.64746 1.39963C5.64746 1.10445 5.88471 0.865112 6.18173 0.865112H7.78583C8.08075 0.865112 8.32008 1.10236 8.32008 1.39963V1.93416H5.64747V1.39963H5.64746Z" />
                </svg>
              </button>
            </figure>
          ))}
          <button
            type="button"
            className="storyboard-edit-add-material"
            aria-label="打开素材库"
            onClick={() => onOpenLibrary?.()}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M10 2.5C10.221 2.5 10.433 2.5878 10.5893 2.74408C10.7455 2.90036 10.8333 3.11232 10.8333 3.33333V9.16667H16.6667C16.8877 9.16667 17.0996 9.25446 17.2559 9.41074C17.4122 9.56702 17.5 9.77899 17.5 10C17.5 10.221 17.4122 10.433 17.2559 10.5893C17.0996 10.7455 16.8877 10.8333 16.6667 10.8333H10.8333V16.6667C10.8333 16.8877 10.7455 17.0996 10.5893 17.2559C10.433 17.4122 10.221 17.5 10 17.5C9.77899 17.5 9.56702 17.4122 9.41074 17.2559C9.25446 17.0996 9.16667 16.8877 9.16667 16.6667V10.8333H3.33333C3.11232 10.8333 2.90036 10.7455 2.74408 10.5893C2.5878 10.433 2.5 10.221 2.5 10C2.5 9.77899 2.5878 9.56702 2.74408 9.41074C2.90036 9.25446 3.11232 9.16667 3.33333 9.16667H9.16667V3.33333C9.16667 3.11232 9.25446 2.90036 9.41074 2.74408C9.56702 2.5878 9.77899 2.5 10 2.5Z" />
            </svg>
          </button>
        </div>

        {/* 历史生成图列表：用于快速回看不同版本效果。 */}
        <h3 className="storyboard-edit-history-title">历史生成</h3>
        <div className="storyboard-edit-history-list" aria-label="历史生成图片">
          {visibleHistory.map((history) => (
            <button
              key={history.id}
              type="button"
              className={activeHistoryId === history.id ? 'active' : ''}
              aria-label={`查看${history.title}`}
              onClick={() => setActiveHistoryId(history.id)}
            >
              <img src={history.src} alt={history.title} draggable={false} />
            </button>
          ))}
        </div>

        {/* 底部确认按钮：真正触发修改生成。 */}
        <button type="button" className="storyboard-edit-confirm" disabled={isSubmitting} onClick={confirmModify}>
          {isSubmitting ? '生成中...' : '确定修改'}
        </button>
      </section>
    </div>
  )
}
