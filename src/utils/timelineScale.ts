export const TIMELINE_AUTO_FIT_MAX_SEC = 30

export const MIN_TIMELINE_PX_PER_SEC = 6
export const MAX_TIMELINE_PX_PER_SEC = 480

/** Fit up to 30 seconds into the viewport; longer timelines scroll in 30-second sections. */
export function getTimelinePixelsPerSecond(totalSec: number, viewportWidth: number, zoomPxPerSec = 0): number {
  const duration = Math.max(0, Number(totalSec) || 0)
  const width = Math.max(0, Number(viewportWidth) || 0)
  if (duration <= 0) return 60

  const fitSpanSec = Math.min(duration, TIMELINE_AUTO_FIT_MAX_SEC)
  const fitPxPerSec = width > 0 ? width / fitSpanSec : 60
  if (duration <= TIMELINE_AUTO_FIT_MAX_SEC || !(zoomPxPerSec > 0)) return fitPxPerSec

  return Math.min(MAX_TIMELINE_PX_PER_SEC, Math.max(MIN_TIMELINE_PX_PER_SEC, zoomPxPerSec))
}
