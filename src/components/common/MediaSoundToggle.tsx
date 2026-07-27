import './MediaSoundToggle.css'

type MediaSoundToggleProps = {
  muted: boolean
  needsInteraction?: boolean
  className?: string
  onToggle: () => void
}

export default function MediaSoundToggle({
  muted,
  needsInteraction = false,
  className = '',
  onToggle,
}: MediaSoundToggleProps) {
  const label = muted ? (needsInteraction ? '点击开启声音' : '开启背景声音') : '关闭背景声音'

  return (
    <button
      type="button"
      className={`media-sound-toggle${needsInteraction ? ' needs-interaction' : ''}${className ? ` ${className}` : ''}`}
      aria-label={label}
      aria-pressed={!muted}
      title={label}
      onClick={onToggle}
    >
      {muted ? (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 9.5v5h4l5 4v-13l-5 4H4Z" />
          <path d="m17 9 4 4m0-4-4 4" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 9.5v5h4l5 4v-13l-5 4H4Z" />
          <path d="M16 8.2a5 5 0 0 1 0 7.6M18.7 5.5a9 9 0 0 1 0 13" />
        </svg>
      )}
      <span>{needsInteraction ? '点击开启声音' : muted ? '已静音' : '声音已开'}</span>
    </button>
  )
}
