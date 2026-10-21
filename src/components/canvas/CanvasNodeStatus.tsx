import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import styles from './CanvasNodeStatus.module.css'

/** 状态内容随画布同比缩放，按可用空间隐藏次要信息。 */
export default function CanvasNodeStatus({
  zoom = 1,
  failure = false,
  label,
  children,
}: {
  zoom?: number
  failure?: boolean
  label: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => {
      const width = element.clientWidth
      const height = element.clientHeight
      setSize((previous) => (previous.width === width && previous.height === height ? previous : { width, height }))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const safeZoom = Math.max(0.02, zoom || 1)
  const width = size.width * safeZoom
  const height = size.height * safeZoom
  const layout = width >= 200 && height >= 240 ? 'full' : width >= 120 && height >= 36 ? 'compact' : 'overview'
  const scale = Math.min(1, size.width / 24 || 1, size.height / 24 || 1)
  return (
    <div
      ref={ref}
      className={`${styles.status} ${failure ? styles.failure : styles.running}`}
      data-layout={layout}
      data-size={size.width < 240 || size.height < 120 ? 'small' : 'normal'}
      role={failure ? 'alert' : 'status'}
      aria-label={label}
      title={failure && layout !== 'overview' ? undefined : label}
      style={{ '--status-scale': scale, '--status-width': `${Math.max(0, size.width - 24)}px` } as CSSProperties}
    >
      <div className={styles.content}>{children}</div>
    </div>
  )
}
