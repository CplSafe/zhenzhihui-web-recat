/**
 * CanvasVideoPreviewModal — 画布视频节点的「放大查看」全屏预览。
 *
 * 必须 portal 到 body：节点渲染在 React Flow 已 transform 的视口里，
 * 若就地渲染，position: fixed 会相对被 transform 的祖先定位，弹窗会跟着画布缩放/平移跑偏；
 * 同时脱离 React Flow 容器后，滚轮/按键也不会再被画布的缩放与删除快捷键接管。
 */
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import styles from './CanvasVideoPreviewModal.module.css'

/** 放大预览右侧的视频信息；字段全部取自节点已有数据，缺失项不渲染。 */
export interface CanvasVideoPreviewInfo {
  /** 生成该视频所用的模型名 */
  modelName?: string
  /** 画面比例，如 16:9 */
  ratio?: string
  /** 时长文本（mm:ss） */
  durationLabel?: string
  /** 是否生成音频 */
  generateAudio?: boolean
  /** 生成时间（本地可读文本） */
  createdAt?: string
}

interface CanvasVideoPreviewModalProps {
  /** 视频地址；为空则不渲染 */
  src: string
  poster?: string
  /** 时长文本（mm:ss），为空时不展示 */
  durationLabel?: string
  /** 起播位置（秒）：从节点当前播放进度接着看 */
  startTime?: number
  /** 视频信息；有任一字段时在播放器右侧展示信息栏 */
  info?: CanvasVideoPreviewInfo
  onClose: () => void
}

export default function CanvasVideoPreviewModal({
  src,
  poster,
  durationLabel,
  startTime = 0,
  info,
  onClose,
}: CanvasVideoPreviewModalProps) {
  const startTimeRef = useRef(startTime)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!src) return
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onCloseRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      window.requestAnimationFrame(() => {
        if (previouslyFocused?.isConnected) previouslyFocused.focus()
      })
    }
  }, [src])

  if (!src) return null

  // 只展示节点上确实有的字段：缺失项直接不出现，不用「未知」占位撑满信息栏。
  const infoRows: Array<{ label: string; value: string }> = [
    { label: '模型', value: String(info?.modelName || '').trim() },
    { label: '宽高比', value: String(info?.ratio || '').trim() },
    { label: '时长', value: String(info?.durationLabel || durationLabel || '').trim() },
    {
      label: '生成音频',
      value: typeof info?.generateAudio === 'boolean' ? (info.generateAudio ? '开启' : '关闭') : '',
    },
    { label: '生成时间', value: String(info?.createdAt || '').trim() },
  ].filter((row) => row.value)

  return createPortal(
    <div className={styles.mask} onClick={onClose} role="presentation">
      <div
        className={`${styles.dialog}${infoRows.length ? ` ${styles.hasInfo}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="视频预览"
        onClick={(event) => event.stopPropagation()}
      >
        <button ref={closeButtonRef} type="button" className={styles.close} onClick={onClose} aria-label="关闭视频预览">
          ✕
        </button>
        <video
          className={styles.player}
          src={src}
          poster={poster || undefined}
          controls
          autoPlay
          playsInline
          onLoadedMetadata={(event) => {
            // 接着节点里的进度播；仅首帧元数据就绪时对齐一次，之后交给用户控制
            const start = startTimeRef.current
            if (start > 0 && start < event.currentTarget.duration) event.currentTarget.currentTime = start
          }}
        />
        {/* 信息栏放在播放器之外：有字段才出现，没有时弹窗保持原来的纯播放形态 */}
        {infoRows.length ? (
          <aside className={styles.info} aria-label="视频信息">
            <h3 className={styles.infoTitle}>信息</h3>
            <dl className={styles.infoList}>
              {infoRows.map((row) => (
                <div key={row.label} className={styles.infoRow}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          </aside>
        ) : durationLabel ? (
          <span className={styles.duration}>时长 {durationLabel}</span>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}
