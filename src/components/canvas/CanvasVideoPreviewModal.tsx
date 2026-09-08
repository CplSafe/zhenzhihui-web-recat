/**
 * CanvasVideoPreviewModal — 画布视频节点的「放大查看」全屏预览。
 *
 * 必须 portal 到 body：节点渲染在 React Flow 已 transform 的视口里，
 * 若就地渲染，position: fixed 会相对被 transform 的祖先定位，弹窗会跟着画布缩放/平移跑偏；
 * 同时脱离 React Flow 容器后，滚轮/按键也不会再被画布的缩放与删除快捷键接管。
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import SeekableVideo from '@/components/common/SeekableVideo'
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
  /** 画布内播放器已经读取到的视频真实像素尺寸。 */
  mediaWidth?: number
  mediaHeight?: number
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

/** 将节点保存的 `16:9` / `9/16` 比例转换成可用于布局的安全数字。 */
function parsePreviewAspectRatio(value: unknown): number {
  const match = String(value || '')
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/)
  if (!match) return 16 / 9
  const width = Number(match[1])
  const height = Number(match[2])
  if (!(width > 0) || !(height > 0)) return 16 / 9
  return Math.min(4, Math.max(0.25, width / height))
}

/** 将视频文件的真实像素尺寸转换成用户熟悉的宽高比文本。 */
function formatVideoAspectRatio(width: number, height: number): string {
  if (!(width > 0) || !(height > 0)) return ''
  const ratio = width / height
  const commonRatios = [
    { value: 16 / 9, label: '16:9' },
    { value: 9 / 16, label: '9:16' },
    { value: 4 / 3, label: '4:3' },
    { value: 3 / 4, label: '3:4' },
    { value: 1, label: '1:1' },
    { value: 21 / 9, label: '21:9' },
  ]
  // 编码器经常因宏块对齐产出 1248×720、1088×1920 等近似尺寸；
  // 展示给用户时归一到标准比例，实际播放器布局仍使用真实像素比，不裁剪画面。
  const common = commonRatios.find((item) => Math.abs(item.value - ratio) < 0.06)
  if (common) return common.label

  const roundedWidth = Math.round(width)
  const roundedHeight = Math.round(height)
  const greatestCommonDivisor = (left: number, right: number): number =>
    right === 0 ? left : greatestCommonDivisor(right, left % right)
  const divisor = greatestCommonDivisor(roundedWidth, roundedHeight)
  return `${roundedWidth / divisor}:${roundedHeight / divisor}`
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
  const videoRef = useRef<HTMLVideoElement>(null)
  const onCloseRef = useRef(onClose)
  const requestedRatioLabel = String(info?.ratio || '').trim()
  const initialMediaWidth = Number(info?.mediaWidth || 0)
  const initialMediaHeight = Number(info?.mediaHeight || 0)
  const hasInitialMediaSize = initialMediaWidth > 0 && initialMediaHeight > 0
  const [resolvedRatio, setResolvedRatio] = useState(() => ({
    value: hasInitialMediaSize ? initialMediaWidth / initialMediaHeight : parsePreviewAspectRatio(requestedRatioLabel),
    label: hasInitialMediaSize ? formatVideoAspectRatio(initialMediaWidth, initialMediaHeight) : requestedRatioLabel,
  }))
  onCloseRef.current = onClose

  // 切换预览源时先按节点参数占位；文件元数据返回后再以真实像素比例覆盖。
  useEffect(() => {
    setResolvedRatio({
      value: hasInitialMediaSize
        ? initialMediaWidth / initialMediaHeight
        : parsePreviewAspectRatio(requestedRatioLabel),
      label: hasInitialMediaSize ? formatVideoAspectRatio(initialMediaWidth, initialMediaHeight) : requestedRatioLabel,
    })
  }, [src, requestedRatioLabel, hasInitialMediaSize, initialMediaWidth, initialMediaHeight])

  /**
   * 关闭前主动切断媒体播放。
   * 单靠父组件卸载 DOM 在部分浏览器里不够：播放器可能正处于异步换 blob 源阶段，音轨会短暂续播。
   */
  const stopPlayback = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    video.pause()
    video.muted = true
    video.removeAttribute('autoplay')
    video.removeAttribute('src')
    video.load()
  }, [])

  const closePreview = useCallback(() => {
    stopPlayback()
    onCloseRef.current()
  }, [stopPlayback])

  useEffect(() => {
    if (!src) return
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closePreview()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      stopPlayback()
      window.cancelAnimationFrame(focusFrame)
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      window.requestAnimationFrame(() => {
        if (previouslyFocused?.isConnected) previouslyFocused.focus()
      })
    }
  }, [src, closePreview, stopPlayback])

  if (!src) return null

  // 只展示节点上确实有的字段：缺失项直接不出现，不用「未知」占位撑满信息栏。
  const infoRows: Array<{ label: string; value: string }> = [
    { label: '模型', value: String(info?.modelName || '').trim() },
    { label: '宽高比', value: resolvedRatio.label },
    { label: '时长', value: String(info?.durationLabel || durationLabel || '').trim() },
    {
      label: '生成音频',
      value: typeof info?.generateAudio === 'boolean' ? (info.generateAudio ? '开启' : '关闭') : '',
    },
    { label: '生成时间', value: String(info?.createdAt || '').trim() },
  ].filter((row) => row.value)
  const mediaStyle = { '--preview-aspect-ratio': resolvedRatio.value } as CSSProperties

  return createPortal(
    <div className={styles.mask} onClick={closePreview} role="presentation">
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label="视频预览"
        data-has-info={infoRows.length > 0}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          ref={closeButtonRef}
          type="button"
          className={styles.close}
          onClick={closePreview}
          aria-label="关闭视频预览"
        >
          ✕
        </button>
        {/* 先按节点比例占位：即使 /download 仍在整片加载，也不会退回浏览器默认的 300×150。 */}
        <div
          className={styles.media}
          style={mediaStyle}
          data-testid="video-preview-media"
          data-aspect-ratio={resolvedRatio.label || undefined}
        >
          <SeekableVideo
            ref={videoRef}
            className={styles.player}
            src={src}
            poster={poster || undefined}
            controls
            autoPlay
            repairOnLoad={false}
            prepareImmediately
            playsInline
            preload="auto"
            onLoadedMetadata={(event) => {
              const video = event.currentTarget
              if (video.videoWidth > 0 && video.videoHeight > 0) {
                const value = video.videoWidth / video.videoHeight
                const label = formatVideoAspectRatio(video.videoWidth, video.videoHeight)
                setResolvedRatio((current) =>
                  Math.abs(current.value - value) < 0.001 && current.label === label ? current : { value, label },
                )
              }
              // 接着节点里的进度播；仅首帧元数据就绪时对齐一次，之后交给用户控制
              const start = startTimeRef.current
              if (start > 0 && start < video.duration) video.currentTime = start
            }}
          />
        </div>
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
