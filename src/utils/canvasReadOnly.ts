import type { SyntheticEvent } from 'react'

/** Only viewport gestures and explicitly marked viewing controls remain interactive. */
export function guardCanvasReadOnlyInteraction(event: SyntheticEvent): void {
  if ('key' in event && (event.key === 'Escape' || event.key === 'Tab')) return
  const target = event.target
  if (
    target instanceof Element &&
    (target.closest('[data-canvas-readonly-control], video, audio') ||
      target.matches('.react-flow__pane, .react-flow__renderer, .react-flow__selectionpane'))
  )
    return
  event.preventDefault()
  event.stopPropagation()
}
