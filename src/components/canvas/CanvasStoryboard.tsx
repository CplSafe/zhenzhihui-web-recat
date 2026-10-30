import { lazy, Suspense, useState } from 'react'
import type { CanvasStoryboardItem } from '@/utils/canvasStructuredText'
import CanvasStoryboardShot from './CanvasStoryboardShot'
import styles from './CanvasStoryboard.module.css'

const CanvasStoryboardModal = lazy(() => import('./CanvasStoryboardModal'))

export default function CanvasStoryboard({
  items,
  disabled,
  onChange,
}: {
  items: CanvasStoryboardItem[]
  disabled?: boolean
  onChange: (items: CanvasStoryboardItem[]) => void
}) {
  const [open, setOpen] = useState(false)
  const update = (index: number, prompt: string) =>
    onChange(items.map((item, i) => (i === index ? { ...item, prompt } : item)))
  return (
    <div
      className={`${styles.card} nopan`}
      aria-label={`分镜脚本，共 ${items.length} 个镜头`}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <header className={styles.header}>
        <div>
          <span>分镜脚本</span>
          <strong>{items.length} 个镜头</strong>
        </div>
        <button type="button" className={`${styles.expand} nodrag nopan`} onClick={() => setOpen(true)}>
          展开查看
        </button>
      </header>
      <div className={`${styles.list} nowheel`} aria-label="分镜列表" tabIndex={0}>
        {items.map((item, index) => (
          <CanvasStoryboardShot
            key={index}
            item={item}
            index={index}
            disabled={disabled}
            onChange={(prompt) => update(index, prompt)}
          />
        ))}
      </div>
      {open && (
        <Suspense fallback={null}>
          <CanvasStoryboardModal items={items} disabled={disabled} onChange={onChange} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </div>
  )
}
