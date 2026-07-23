/**
 * LazyMediaVideo — 素材卡片使用的延迟加载视频与激活状态 Hook。
 * 视频进入视口或被悬浮、聚焦、选中后才加载，避免素材密集列表同时下载和解码大量媒体。
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEventHandler,
  type HTMLAttributes,
  type MouseEventHandler,
  type VideoHTMLAttributes,
} from 'react'

/** 保留原生 video 属性，但由组件统一接管资源地址、预加载和自动播放策略。 */
type NativeVideoProps = Omit<VideoHTMLAttributes<HTMLVideoElement>, 'autoPlay' | 'preload' | 'src'>

/** 延迟加载视频的受控属性。 */
export interface LazyMediaVideoProps extends NativeVideoProps {
  src?: string
  /** Hover, keyboard focus, or an explicit selected state may activate the preview. */
  active?: boolean
  /** Called once when the media enters the viewport or is activated before observation fires. */
  onVisible?: () => void
}

/**
 * 面向媒体密集网格的卡片视频。
 * 资源进入视口前不会挂载 URL；可见但未激活时只取元数据，交互激活后才请求播放数据。
 */
export function LazyMediaVideo({
  src = '',
  active = false,
  onVisible,
  muted = true,
  loop = true,
  playsInline = true,
  onLoadedData,
  ...videoProps
}: LazyMediaVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const onVisibleRef = useRef(onVisible)
  const visibleNotifiedRef = useRef(false)
  const [hasEnteredViewport, setHasEnteredViewport] = useState(false)
  const [pageLoaded, setPageLoaded] = useState(
    () => typeof document === 'undefined' || document.readyState === 'complete',
  )

  useEffect(() => {
    if (pageLoaded || typeof window === 'undefined') return
    if (document.readyState === 'complete') {
      setPageLoaded(true)
      return
    }
    const markPageLoaded = () => setPageLoaded(true)
    window.addEventListener('load', markPageLoaded, { once: true })
    return () => window.removeEventListener('load', markPageLoaded)
  }, [pageLoaded])

  useEffect(() => {
    onVisibleRef.current = onVisible
  }, [onVisible])

  const markVisible = useCallback(() => {
    setHasEnteredViewport(true)
    if (visibleNotifiedRef.current) return
    visibleNotifiedRef.current = true
    onVisibleRef.current?.()
  }, [])

  useEffect(() => {
    const node = videoRef.current
    if (!node || hasEnteredViewport) return
    if (typeof IntersectionObserver === 'undefined') {
      markVisible()
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        markVisible()
        observer.disconnect()
      },
      { threshold: 0.01 },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasEnteredViewport, markVisible])

  useEffect(() => {
    if (active) markVisible()
  }, [active, markVisible])

  // 首屏素材网格不能在慢浏览器/网络下阻塞文档 load；首次启动等待应用壳完成，客户端跳转则立即挂载资源。
  const shouldAttachSource = Boolean(src) && pageLoaded && (hasEnteredViewport || active)
  const prefersReducedMotion =
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const shouldPlay = active && shouldAttachSource && !prefersReducedMotion

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (!shouldPlay) {
      video.pause()
      return
    }
    video.play().catch(() => {
      // 浏览器通常允许静音预览；若仍被自动播放策略拦截，则保留封面/首帧而不把它当成卡片错误。
    })
  }, [shouldPlay, src])

  return (
    <video
      {...videoProps}
      ref={videoRef}
      src={shouldAttachSource ? src : undefined}
      muted={muted}
      loop={loop}
      playsInline={playsInline}
      preload={shouldPlay ? 'auto' : 'metadata'}
      autoPlay={false}
      tabIndex={-1}
      aria-hidden="true"
      onLoadedData={(event) => {
        onLoadedData?.(event)
        if (shouldPlay) event.currentTarget.play().catch(() => {})
      }}
    />
  )
}

/** 多媒体卡片共享的悬浮、键盘聚焦与选中激活状态。 */
export interface MediaCardActivation {
  active: boolean
  activationProps: Pick<
    HTMLAttributes<HTMLElement>,
    'onMouseEnter' | 'onMouseLeave' | 'onFocusCapture' | 'onBlurCapture'
  >
}

/**
 * 合并鼠标与键盘聚焦两种激活来源，并把状态限制在单个卡片实例内。
 * blur 时检查下一个焦点是否仍在卡片中，避免内部控件切换焦点导致预览闪停。
 */
export function useMediaCardActivation(): MediaCardActivation {
  const [active, setActive] = useState(false)

  const onMouseEnter = useCallback<MouseEventHandler<HTMLElement>>(() => setActive(true), [])
  const onMouseLeave = useCallback<MouseEventHandler<HTMLElement>>(() => setActive(false), [])
  const onFocusCapture = useCallback<FocusEventHandler<HTMLElement>>(() => setActive(true), [])
  const onBlurCapture = useCallback<FocusEventHandler<HTMLElement>>((event) => {
    const nextTarget = event.relatedTarget
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return
    setActive(false)
  }, [])

  const activationProps = useMemo(
    () => ({ onMouseEnter, onMouseLeave, onFocusCapture, onBlurCapture }),
    [onBlurCapture, onFocusCapture, onMouseEnter, onMouseLeave],
  )

  return { active, activationProps }
}
