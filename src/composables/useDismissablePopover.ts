/**
 * 弹层的「点击外部 / 按 Esc 关闭」通用逻辑。
 *
 * 把容器 ref 挂到弹层最外层元素上即可；只有展开时才挂载全局监听，收起后自动移除。
 */
import { useEffect, useRef, useState } from 'react'

/** 弹层开关状态与需要绑定的容器 ref。 */
export interface DismissablePopover<T extends HTMLElement> {
  open: boolean
  setOpen: (open: boolean) => void
  /** 在触发器上调用以切换展开状态。 */
  toggle: () => void
  /** 绑定到弹层容器（需同时包含触发器与浮层），用于判定点击是否在外部。 */
  wrapRef: React.RefObject<T | null>
}

/** 返回一个「点外部或按 Esc 即关闭」的弹层开关。 */
export function useDismissablePopover<T extends HTMLElement = HTMLDivElement>(): DismissablePopover<T> {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<T>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return {
    open,
    setOpen,
    toggle: () => setOpen((current) => !current),
    wrapRef,
  }
}
