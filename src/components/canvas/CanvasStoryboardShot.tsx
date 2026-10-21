import { useLayoutEffect, useRef, useState } from 'react'
import type { CanvasStoryboardItem } from '@/utils/canvasStructuredText'
import styles from './CanvasStoryboard.module.css'

export default function CanvasStoryboardShot({
  item,
  index,
  disabled,
  full = false,
  onChange,
}: {
  item: CanvasStoryboardItem
  index: number
  disabled?: boolean
  full?: boolean
  onChange: (prompt: string) => void
}) {
  const input = useRef<HTMLTextAreaElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [long, setLong] = useState(false)
  useLayoutEffect(() => {
    const element = input.current
    if (!element) return
    const resize = () => {
      element.style.height = '0px'
      const line = parseFloat(getComputedStyle(element).lineHeight) || 24
      const max = line * 6 + 24
      const height = element.scrollHeight + 2
      setLong(height > max)
      element.style.height = `${Math.max(line * 3 + 24, full || expanded ? height : Math.min(height, max))}px`
    }
    resize()
    const observer = new ResizeObserver(() => {
      // 只在宽度变化时重算，避免高度更新形成 ResizeObserver 循环。
      if (element.clientWidth !== width) {
        width = element.clientWidth
        resize()
      }
    })
    let width = element.clientWidth
    observer.observe(element)
    return () => observer.disconnect()
  }, [item.prompt, full, expanded])
  return (
    <article className={styles.shot}>
      <span className={styles.index}>{String(index + 1).padStart(2, '0')}</span>
      <div className={styles.content}>
        <h3>{item.title}</h3>
        {(item.shot || item.duration) && (
          <p className={styles.meta}>
            {[item.shot, item.duration && `${item.duration}${/^\d+(\.\d+)?$/.test(item.duration) ? ' 秒' : ''}`]
              .filter(Boolean)
              .join(' · ')}
          </p>
        )}
        <textarea
          ref={input}
          className="nodrag nopan nowheel"
          aria-label={`镜头 ${index + 1} 提示词`}
          value={item.prompt}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
        {!full && long && (
          <button type="button" className={styles.link} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
            {expanded ? '收起本镜头' : '展开本镜头'}
          </button>
        )}
      </div>
    </article>
  )
}
