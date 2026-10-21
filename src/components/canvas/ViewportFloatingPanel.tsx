import { useLayoutEffect, useRef, type HTMLAttributes } from 'react'

/** 保留浮层与触发器的 DOM 关系，同时让菜单在视口边缘可见。 */
export default function ViewportFloatingPanel(props: HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    let frame = 0
    let x = 0
    let y = 0
    const update = () => {
      const rect = element.getBoundingClientRect()
      const scaleX = element.offsetWidth > 0 ? rect.width / element.offsetWidth || 1 : 1
      const scaleY = element.offsetHeight > 0 ? rect.height / element.offsetHeight || 1 : 1
      const left = rect.left - x * scaleX
      const top = rect.top - y * scaleY
      const nextX = (Math.max(12, Math.min(left, window.innerWidth - rect.width - 12)) - left) / scaleX
      const nextY = (Math.max(12, Math.min(top, window.innerHeight - rect.height - 12)) - top) / scaleY
      element.style.maxWidth = `${(window.innerWidth - 24) / scaleX}px`
      element.style.maxHeight = `min(var(--floating-max-height, 320px), ${(window.innerHeight - 24) / scaleY}px)`
      if (nextX !== x || nextY !== y) {
        x = nextX
        y = nextY
        element.style.translate = `${x}px ${y}px`
      }
      frame = requestAnimationFrame(update)
    }
    update()
    return () => cancelAnimationFrame(frame)
  }, [])
  return (
    <div
      {...props}
      ref={ref}
      style={{
        ...props.style,
        boxSizing: 'border-box',
        maxWidth: 'calc(100vw - 24px)',
        maxHeight: 'min(var(--floating-max-height, 320px), calc(100dvh - 24px))',
      }}
    />
  )
}
