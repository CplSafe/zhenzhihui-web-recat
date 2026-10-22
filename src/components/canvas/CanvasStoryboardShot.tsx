import { useLayoutEffect, useRef } from 'react'
import type { CanvasStoryboardItem } from '@/utils/canvasStructuredText'
import styles from './CanvasStoryboard.module.css'

export default function CanvasStoryboardShot({
  item,
  index,
  disabled,
  onChange,
}: {
  item: CanvasStoryboardItem
  index: number
  disabled?: boolean
  onChange: (prompt: string) => void
}) {
  const input = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const element = input.current
    if (!element) return
    const resize = () => {
      element.style.height = '0px'
      const style = getComputedStyle(element)
      const line = parseFloat(style.lineHeight) || 24
      const padding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0)
      const border = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0)
      const height = element.scrollHeight + 2
      element.style.height = `${Math.ceil(Math.max(line * 3 + padding + border, height))}px`
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
  }, [item.prompt])
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
      </div>
    </article>
  )
}
