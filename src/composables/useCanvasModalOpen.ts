import { useEffect, useState } from 'react'
import { hasOpenCanvasModal } from '@/utils/canvasModal'

/** Portal 弹窗也参与画布阻断；保留选中态，关闭后恢复原操作栏。 */
export function useCanvasModalOpen(): boolean {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const update = () => setOpen(hasOpenCanvasModal())
    update()
    const observer = new MutationObserver(update)
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-modal', 'aria-hidden', 'hidden', 'style', 'class'],
    })
    return () => observer.disconnect()
  }, [])
  return open
}
