import { useEffect, useState, type RefObject } from 'react'

export function useMentionNavigation(
  open: boolean,
  keys: string[],
  inputRef: RefObject<HTMLTextAreaElement>,
  onSelect: (index: number) => void,
  onClose: () => void,
  columns = 1,
) {
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const found = activeKey === null ? -1 : keys.indexOf(activeKey)
  const activeIndex = found < 0 ? 0 : found
  useEffect(() => {
    if (!open) setActiveKey(null)
  }, [open])
  useEffect(() => {
    if (!open) return
    const handle = (event: KeyboardEvent) => {
      if (
        event.target !== inputRef.current ||
        event.isComposing ||
        event.keyCode === 229 ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey
      )
        return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
        return
      }
      if (!keys.length) return
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter'].includes(event.key)) {
        event.preventDefault()
        event.stopPropagation()
        if (event.key === 'Enter') onSelect(activeIndex)
        else {
          const width = Math.max(1, Math.floor(columns))
          let next = activeIndex
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
            next = (activeIndex + (event.key === 'ArrowRight' ? 1 : -1) + keys.length) % keys.length
          else if (event.key === 'ArrowDown')
            next =
              activeIndex + width < keys.length
                ? activeIndex + width
                : Math.floor(activeIndex / width) === Math.floor((keys.length - 1) / width)
                  ? activeIndex % width
                  : keys.length - 1
          else
            next =
              activeIndex >= width
                ? activeIndex - width
                : Math.min(Math.floor((keys.length - 1) / width) * width + activeIndex, keys.length - 1)
          setActiveKey(keys[next])
        }
      }
    }
    document.addEventListener('keydown', handle, true)
    return () => document.removeEventListener('keydown', handle, true)
  }, [open, keys, activeIndex, inputRef, onSelect, onClose, columns])
  return { activeIndex, setActiveIndex: (index: number) => setActiveKey(keys[index] ?? null) }
}
