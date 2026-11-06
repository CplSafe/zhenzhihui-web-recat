import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from 'react'

/** Space above an anchor in local CSS pixels, including the user's UI zoom. */
export function useCanvasMenuHeight(anchor: RefObject<HTMLElement>, open: boolean) {
  const [height, setHeight] = useState<number>()
  const measure = useCallback(() => {
    const element = anchor.current
    if (!element || !element.offsetWidth) return
    const rect = element.getBoundingClientRect()
    const scale = rect.width / element.offsetWidth
    if (scale > 0) setHeight(Math.max(48, Math.floor((rect.top - 16) / scale - 12)))
  }, [anchor])
  // Preference changes can alter CSS zoom without resizing the viewport.
  useLayoutEffect(() => {
    if (open) measure()
  })
  useEffect(() => {
    if (!open) return
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [open, measure])
  return height
}
