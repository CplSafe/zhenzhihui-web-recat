import { useRef } from 'react'
import { Modal } from 'antd'
import type { CanvasStoryboardItem } from '@/utils/canvasStructuredText'
import CanvasPortalBoundary from './CanvasPortalBoundary'
import CanvasStoryboardShot from './CanvasStoryboardShot'
import styles from './CanvasStoryboard.module.css'

export default function CanvasStoryboardModal({
  items,
  disabled,
  onChange,
  onClose,
}: {
  items: CanvasStoryboardItem[]
  disabled?: boolean
  onChange: (items: CanvasStoryboardItem[]) => void
  onClose: () => void
}) {
  const shots = useRef(new Map<number, HTMLDivElement>())
  const jump = (index: number) => {
    const shot = shots.current.get(index)
    shot?.scrollIntoView({ block: 'start', behavior: 'auto' })
    shot?.querySelector('textarea')?.focus({ preventScroll: true })
  }
  return (
    <Modal
      open
      centered
      title={`分镜脚本 · ${items.length} 个镜头`}
      width={1100}
      zIndex={2200}
      onCancel={onClose}
      footer={
        <div className={styles.footer}>
          <span>修改即时同步到画布</span>
          <button type="button" onClick={onClose}>
            完成
          </button>
        </div>
      }
      modalRender={(modal) => <CanvasPortalBoundary>{modal}</CanvasPortalBoundary>}
      styles={{ body: { overflow: 'hidden' } }}
    >
      <div className={`${styles.expanded} nodrag nopan nowheel`}>
        <nav className={styles.directory} aria-label="镜头目录">
          {items.map((item, index) => (
            <button type="button" key={index} onClick={() => jump(index)} title={item.title}>
              {String(index + 1).padStart(2, '0')} · {item.title}
            </button>
          ))}
        </nav>
        <label className={styles.mobileDirectory}>
          跳转镜头
          <select defaultValue="" onChange={(event) => jump(Number(event.target.value))}>
            <option value="" disabled>
              选择镜头
            </option>
            {items.map((item, index) => (
              <option value={index} key={index}>
                {index + 1} · {item.title}
              </option>
            ))}
          </select>
        </label>
        <div className={styles.fullList} aria-label="完整分镜列表" tabIndex={0}>
          {items.map((item, index) => (
            <div
              key={index}
              ref={(element) => {
                if (element) shots.current.set(index, element)
                else shots.current.delete(index)
              }}
            >
              <CanvasStoryboardShot
                item={item}
                index={index}
                full
                disabled={disabled}
                onChange={(prompt) => onChange(items.map((shot, i) => (i === index ? { ...shot, prompt } : shot)))}
              />
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}
