import type { ComponentPropsWithoutRef, CSSProperties, ReactNode } from 'react'
import { EighthNotes, Scissors } from 'lucide-react'

type DivProps = ComponentPropsWithoutRef<'div'>

export function CanvasNodeFrame({
  kind,
  headerScale,
  emptyMedia,
  highDefinition,
  imageGroup,
  ...props
}: Omit<DivProps, 'className' | 'style'> & {
  kind: string
  headerScale: number
  emptyMedia?: boolean
  highDefinition?: boolean
  imageGroup?: boolean
}) {
  const kindClass = ['text', 'image', 'video', 'timeline', 'audio'].includes(kind) ? ' is-' + kind : ''
  return (
    <div
      className={`canvas-default-node${kindClass}${emptyMedia ? ' is-empty-media' : ''}${highDefinition ? ' is-hd-result' : ''}${imageGroup ? ' is-image-results' : ''}`}
      style={{ '--canvas-readable-text-scale': 1, '--canvas-header-text-scale': headerScale } as CSSProperties}
      {...props}
    />
  )
}

export function CanvasNodeHeader({
  kind,
  title,
  collaborationLabel,
  children,
  ...props
}: Omit<DivProps, 'className' | 'title'> & { kind: string; title: string; collaborationLabel?: string }) {
  return (
    <div className={`canvas-node-header nopan${kind === 'audio' ? '' : ' nodrag'}`} title={title} {...props}>
      <span className="canvas-node-header__icon" aria-hidden="true">
        {getTypeIcon(kind)}
      </span>
      <span className="canvas-node-header__label-wrap" onDoubleClick={(event) => event.stopPropagation()}>
        {children || <span className="canvas-node-header__label">{title}</span>}
      </span>
      {collaborationLabel && (
        <span className="canvas-node-header__collaboration" title={collaborationLabel}>
          {collaborationLabel === '你正在编辑'
            ? '编辑中'
            : collaborationLabel === '你正在引用'
              ? '引用中'
              : collaborationLabel}
        </span>
      )}
    </div>
  )
}

export function CanvasNodeBody(props: Omit<DivProps, 'className'>) {
  return <div className="canvas-node-body" {...props} />
}

export function CanvasNodePrompt({ children, placeholder }: { children: ReactNode; placeholder?: boolean }) {
  return <div className={`canvas-node-prompt${placeholder ? ' is-placeholder' : ''}`}>{children}</div>
}

export function CanvasNodeImage(props: ComponentPropsWithoutRef<'img'>) {
  return <img className="canvas-node-media nopan" loading="lazy" {...props} />
}

export function getTypeIcon(kind: string, size = 12) {
  if (kind === 'audio') return <EighthNotes size={size} aria-hidden="true" />
  if (kind === 'audio-editor') return <Scissors size={size} aria-hidden="true" />
  if (kind === 'image') {
    return (
      <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
        <rect x="1" y="1" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.2" />
        <circle cx="5" cy="5" r="1.2" fill="currentColor" />
        <path
          d="M1 10l3.5-3.5 2.5 2.5 2-2L13 10"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  if (kind === 'video') {
    return (
      <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M31.8 3C33.7 3 35.3 3 36.6 3.1c1.3.1 2.4.3 3.5.9 1.7.8 3 2.2 3.9 3.9.6 1 .8 2.2.9 3.5.1 1.3.1 2.9.1 4.8v15.6c0 2-.1 3.5-.1 4.8-.1 1.3-.3 2.4-.9 3.5a8 8 0 01-3.9 3.9c-1 .6-2.2.8-3.5.9-1.3.1-2.8.1-4.8.1H16.2c-2 0-3.5 0-4.8-.1-1.3-.1-2.4-.3-3.5-.9a8 8 0 01-3.9-3.9c-.6-1-.8-2.2-.9-3.5C3 33.5 3 32 3 30V16.2c0-2 0-3.5.1-4.8.1-1.3.3-2.4.9-3.5a8 8 0 013.9-3.9c1-.6 2.2-.8 3.5-.9C12.7 3 14.3 3 16.2 3h15.6zM16.2 7c-2 0-3.3 0-4.4.1-1 .1-1.6.3-2 .5a4 4 0 00-2.2 2.2c-.2.4-.3 1-.4 2-.1 1.1-.1 2.5-.1 4.4v15.6c0 2 0 3.3.1 4.4.1 1 .3 1.6.5 2a4 4 0 002.2 2.2c.4.2 1 .3 2 .4 1.1.1 2.5.1 4.4.1h15.6c2 0 3.3 0 4.4-.1 1-.1 1.6-.3 2-.5a4 4 0 002.2-2.2c.2-.4.3-1 .4-2 .1-1.1.1-2.5.1-4.4V16.2c0-2 0-3.3-.1-4.4-.1-1-.3-1.6-.5-2a4 4 0 00-2.2-2.2c-.4-.2-1-.3-2-.4-1.1-.1-2.5-.1-4.4-.1H16.2zm2.4 12.6c0-1.7 1.9-2.7 3.4-1.8l7.8 4.4c1.4.8 1.4 2.8 0 3.6l-7.8 4.4c-1.5.8-3.4-.2-3.4-1.8v-8.8z"
          fill="currentColor"
        />
      </svg>
    )
  }
  if (kind === 'timeline') {
    // 胶片格：时间线节点此前没有自己的图标，会掉进下面的 text 分支显示成一支笔，
    // 和「文本」节点撞脸。
    return (
      <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
        <rect x="1" y="2.5" width="12" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
        <path d="M4.2 2.5v9M9.8 2.5v9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    )
  }
  // text
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <path
        d="M9.7 10.3c.3 0 .6.2.6.6 0 .3-.2.6-.6.6H2c-.3 0-.6-.3-.6-.6 0-.3.3-.6.6-.6h7.7zM7.8 6.4c.3 0 .6.3.6.6 0 .3-.3.6-.6.6H2c-.3 0-.6-.3-.6-.6 0-.3.3-.6.6-.6h5.8zm4.2-3.8c.3 0 .5.3.5.6s-.2.6-.5.6H2c-.3 0-.6-.3-.6-.6s.3-.6.6-.6h9.9z"
        fill="currentColor"
      />
    </svg>
  )
}
