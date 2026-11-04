import { useEffect, useState } from 'react'
import { hasOpenCanvasModal } from '@/utils/canvasModal'

const MODAL_MARKERS = '[aria-modal="true"], [data-canvas-nonmodal="true"]'

function containsModalMarker(node: Node): boolean {
  return node instanceof Element && (node.matches(MODAL_MARKERS) || Boolean(node.querySelector(MODAL_MARKERS)))
}

/** 画布拖动会频繁改写节点样式；只在弹窗或其祖先、内容发生变化时重新检查。 */
function affectsModal(record: MutationRecord): boolean {
  const target = record.target instanceof Element ? record.target : record.target.parentElement
  if (record.type === 'attributes') {
    if (record.attributeName === 'aria-modal' || record.attributeName === 'data-canvas-nonmodal') return true
    return Boolean(target && (target.closest(MODAL_MARKERS) || target.querySelector(MODAL_MARKERS)))
  }
  return (
    Boolean(target?.closest(MODAL_MARKERS)) ||
    Array.from(record.addedNodes).some(containsModalMarker) ||
    Array.from(record.removedNodes).some(containsModalMarker)
  )
}

/** Portal 弹窗也参与画布阻断；保留选中态，关闭后恢复原操作栏。 */
export function useCanvasModalOpen(): boolean {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const update = () => setOpen(hasOpenCanvasModal())
    update()
    const observer = new MutationObserver((records) => {
      if (records.some(affectsModal)) update()
    })
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-modal', 'aria-hidden', 'hidden', 'style', 'class', 'data-canvas-nonmodal'],
    })
    return () => observer.disconnect()
  }, [])
  return open
}
