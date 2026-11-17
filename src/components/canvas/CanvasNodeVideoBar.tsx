import type { ReactNode } from 'react'

export default function CanvasNodeVideoBar({
  playing,
  time,
  onToggle,
  onExpand,
  children,
}: {
  playing: boolean
  time: string
  onToggle: () => void
  onExpand: () => void
  children: ReactNode
}) {
  return (
    <div
      className="canvas-node-video-bar nodrag nopan"
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className={`canvas-node-${playing ? 'pause' : 'play'}-btn nodrag nopan`}
        onClick={onToggle}
        aria-label={playing ? '暂停视频' : '播放视频'}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
          {playing ? (
            <>
              <rect x="6" y="5" width="4" height="14" rx="1.2" />
              <rect x="14" y="5" width="4" height="14" rx="1.2" />
            </>
          ) : (
            <path d="M8 5.14v13.72a1 1 0 0 0 1.52.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14z" />
          )}
        </svg>
      </button>
      <span className="canvas-node-video-time">{time}</span>
      {children}
      <button
        type="button"
        className="canvas-video-expand nodrag nopan"
        aria-label="放大视频"
        title="放大视频"
        onClick={(event) => {
          event.stopPropagation()
          onExpand()
        }}
      >
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />
        </svg>
      </button>
    </div>
  )
}
