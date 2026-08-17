/**
 * SeekableVideo —— 可任意跳转的 <video>，用法与原生一致。
 *
 * 素材的 /download 地址不支持 Range 分段请求：拖动进度条时 currentTime 被抹回 0（「拖到 15 秒仍从头播」），
 * 有些素材连 duration 都读不出来，进度条上根本没有总时长可看。
 * 本组件在**确认跳转失败之后**才把整片抓到本地，换成 blob 继续播，并把播放位置与播放状态还原。
 *
 * 「确认失败之后才抓」而不是「一上来就抓」，是为了不白花带宽：
 * 服务端哪天支持了 Range，这里一次也不会触发下载，代码不用改；
 * 而对已经能跳的源（本地 blob、支持分段的 OSS 直链）本来就不该多下一遍。
 *
 * 抓取走全站共用的 seekableMediaSource：同一条素材在多个播放器里只下载一次。
 */
import { forwardRef, useCallback, useEffect, useRef, useState, type VideoHTMLAttributes } from 'react'
import { acquireSeekableSource, type SeekableSourceHandle } from '@/utils/seekableMediaSource'

interface SeekableVideoProps extends VideoHTMLAttributes<HTMLVideoElement> {
  src: string
  /** 不显示「正在准备」浮层。给缩略预览这类不需要交代进度的场景。 */
  quiet?: boolean
}

/** 跳转落点与目标差这么多秒以内算落住了。 */
const SEEK_TOLERANCE_SEC = 0.5
/**
 * 目标小于这个秒数时不做判定。
 * 跳到接近开头的位置本来就不需要分段请求，用它判断跳转能力会得出假阴性。
 */
const SEEK_VERIFY_MIN_TARGET_SEC = 0.6
/** seeked 迟迟不来时的兜底判定延时。 */
const SEEK_VERIFY_DELAY_MS = 700
/**
 * 元数据就绪后隔这么久再判定源能不能跳转。
 * seekable 有时比 duration 晚一点才填上，立刻判会把支持 Range 的源也误判成要下载。
 */
const SEEKABILITY_CHECK_DELAY_MS = 400
/**
 * MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED。
 * 写字面量而不是引用那个全局常量：jsdom 没有 MediaError 这个全局，
 * 引用它会让所有渲染视频的用例在触发 error 事件时直接抛 ReferenceError。
 */
const MEDIA_ERR_SRC_NOT_SUPPORTED = 4

const overlayStyle: React.CSSProperties = {
  position: 'absolute',
  left: '50%',
  bottom: '14%',
  zIndex: 5,
  transform: 'translateX(-50%)',
  padding: '6px 12px',
  borderRadius: '999px',
  background: 'rgba(8, 10, 16, 0.78)',
  color: '#e6e8ee',
  fontSize: '12px',
  lineHeight: 1,
  whiteSpace: 'nowrap',
  pointerEvents: 'none',
}

/**
 * 用 display:contents 包一层。
 *
 * 这个组件要塞进十几处早就写好的布局里，多一个真实盒子就会破坏外面的 flex/grid 排版；
 * display:contents 不生成盒子，父级看到的仍然是 <video> 本身。
 */
const wrapperStyle: React.CSSProperties = { display: 'contents' }

/**
 * 这个源能不能任意跳转——判据是 seekable 是否一直覆盖到片尾。
 *
 * 支持 Range 的源在元数据就绪后就会报 seekable = [0, duration]；
 * 不支持的源只会报出已缓冲的那一小段，甚至一段都没有。
 * 时长读不出来（Infinity / NaN）同样意味着跳不了，一并算作不可跳转。
 */
function isFullySeekable(video: HTMLVideoElement): boolean {
  const duration = Number(video.duration)
  if (!Number.isFinite(duration) || duration <= 0) return false
  const ranges = video.seekable
  if (!ranges || ranges.length === 0) return false
  return ranges.end(ranges.length - 1) >= duration - SEEK_TOLERANCE_SEC
}

function SeekableVideoImpl(
  { src, quiet = false, onSeeking, onSeeked, onLoadedMetadata, onError, ...rest }: SeekableVideoProps,
  forwardedRef: React.ForwardedRef<HTMLVideoElement>,
) {
  const [localSrc, setLocalSrc] = useState('')
  const [preparing, setPreparing] = useState(false)
  const [percent, setPercent] = useState(0)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const srcRef = useRef(src)
  const localSrcRef = useRef('')
  const preparingRef = useRef(false)
  const handleRef = useRef<SeekableSourceHandle | null>(null)
  const aliveRef = useRef(true)
  /** 用户想去的位置。换源之后要回到这里，而不是失败后被抹回的那个值。 */
  const pendingSeekRef = useRef(0)
  const resumeRef = useRef(false)
  const verifyTimerRef = useRef(0)
  const seekabilityTimerRef = useRef(0)

  const bindRef = useCallback(
    (element: HTMLVideoElement | null) => {
      videoRef.current = element
      if (typeof forwardedRef === 'function') forwardedRef(element)
      else if (forwardedRef) forwardedRef.current = element
    },
    [forwardedRef],
  )

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  // 换源/卸载：撤掉上一份本地副本，并把状态清干净
  useEffect(() => {
    srcRef.current = src
    localSrcRef.current = ''
    preparingRef.current = false
    pendingSeekRef.current = 0
    resumeRef.current = false
    setLocalSrc('')
    setPreparing(false)
    setPercent(0)
    return () => {
      window.clearTimeout(verifyTimerRef.current)
      window.clearTimeout(seekabilityTimerRef.current)
      handleRef.current?.release()
      handleRef.current = null
    }
  }, [src])

  /** 抓整片换本地源。已在抓或已经有本地副本时直接返回，不会重复下载。 */
  const repair = useCallback(() => {
    const source = srcRef.current
    if (!source || preparingRef.current || localSrcRef.current) return
    if (source.startsWith('blob:') || source.startsWith('data:')) return

    const video = videoRef.current
    // 下载期间先暂停：这时播放位置本来就是错的，让它继续跑只会在换源时又跳一下
    resumeRef.current = Boolean(video && !video.paused)
    video?.pause()

    preparingRef.current = true
    setPreparing(true)
    setPercent(0)

    const handle = acquireSeekableSource(source, {
      onProgress: ({ loadedBytes, totalBytes }) => {
        if (!aliveRef.current || srcRef.current !== source) return
        setPercent(totalBytes > 0 ? Math.min(100, Math.round((loadedBytes / totalBytes) * 100)) : 0)
      },
    })
    handleRef.current?.release()
    handleRef.current = handle

    void handle.ready
      .then(({ url, local }) => {
        if (!aliveRef.current || srcRef.current !== source) return
        // local 为 false 表示没抓下来（鉴权/网络/跨域）：保持原地址，别把 src 换成同一个值触发重载
        if (local && url) {
          localSrcRef.current = url
          setLocalSrc(url)
        }
      })
      .finally(() => {
        preparingRef.current = false
        if (aliveRef.current) setPreparing(false)
      })
  }, [])

  /** 跳转是否落住。只有「被拉回目标之前」才算失败——正常播放会往后走，不能算。 */
  const verifySeek = useCallback(() => {
    const video = videoRef.current
    const target = pendingSeekRef.current
    if (!video || localSrcRef.current || !(target >= SEEK_VERIFY_MIN_TARGET_SEC)) return
    if (video.currentTime >= target - SEEK_TOLERANCE_SEC) return
    repair()
  }, [repair])

  const handleSeeking = useCallback(
    (event: React.SyntheticEvent<HTMLVideoElement>) => {
      const video = event.currentTarget
      if (!localSrcRef.current) {
        pendingSeekRef.current = video.currentTime
        window.clearTimeout(verifyTimerRef.current)
        /*
         * 源本身就跳不了的话，这里立刻动手，不等「跳转失败」被观察到。
         *
         * 只靠事后比对是不够的：规范要求浏览器先把目标钳进 seekable 范围再报 seeking，
         * 所以拖到 14 秒、而可跳转范围只有 0~1 秒时，seeking 里读到的 currentTime
         * 已经是被钳过的 1 秒——前后一比「落住了」，判定永远不会触发，
         * 用户看到的就是进度条拖到 14 秒而画面和读数停在 1 秒。
         */
        if (!isFullySeekable(video)) repair()
        // seekable 看着正常但跳转仍然失败时的兜底：seeked 不一定会来，留一个定时判定
        else verifyTimerRef.current = window.setTimeout(verifySeek, SEEK_VERIFY_DELAY_MS)
      }
      onSeeking?.(event)
    },
    [onSeeking, repair, verifySeek],
  )

  const handleSeeked = useCallback(
    (event: React.SyntheticEvent<HTMLVideoElement>) => {
      window.clearTimeout(verifyTimerRef.current)
      verifySeek()
      onSeeked?.(event)
    },
    [onSeeked, verifySeek],
  )

  const handleLoadedMetadata = useCallback(
    (event: React.SyntheticEvent<HTMLVideoElement>) => {
      const video = event.currentTarget
      if (localSrcRef.current) {
        // 换源后回到用户原本要去的位置，并接着播
        if (pendingSeekRef.current > 0) {
          try {
            video.currentTime = pendingSeekRef.current
          } catch {
            /* 元素还没准备好接受定位，用户可以自己再拖一次 */
          }
        }
        if (resumeRef.current) {
          resumeRef.current = false
          const played = video.play()
          if (played && typeof played.catch === 'function') played.catch(() => undefined)
        }
      } else if (!Number.isFinite(video.duration) || video.duration <= 0) {
        // 元数据到手却读不出时长：进度条上没有总时长，也没法跳。这种源只能整片抓下来
        repair()
      } else {
        /*
         * 元数据一到就先探一次能不能跳，不等用户拖了才修。
         *
         * 等拖动再修的话第一次拖动必然是废的：浏览器已经把目标钳成了别的值，
         * 我们连用户想去哪都不知道，换完源只能停在被钳后的位置，用户得再拖一次。
         * 这一下载对支持 Range 的源不会发生（seekable 覆盖全片，直接跳过）。
         */
        window.clearTimeout(seekabilityTimerRef.current)
        seekabilityTimerRef.current = window.setTimeout(() => {
          const current = videoRef.current
          if (current && !localSrcRef.current && !isFullySeekable(current)) repair()
        }, SEEKABILITY_CHECK_DELAY_MS)
      }
      onLoadedMetadata?.(event)
    },
    [onLoadedMetadata, repair],
  )

  const handleError = useCallback(
    (event: React.SyntheticEvent<HTMLVideoElement>) => {
      // 源不被支持时先试一次本地副本：有些服务端的响应头会让浏览器直接判死，字节本身没问题
      if (event.currentTarget.error?.code === MEDIA_ERR_SRC_NOT_SUPPORTED) repair()
      onError?.(event)
    },
    [onError, repair],
  )

  return (
    <span style={wrapperStyle}>
      <video
        {...rest}
        ref={bindRef}
        src={localSrc || src}
        onSeeking={handleSeeking}
        onSeeked={handleSeeked}
        onLoadedMetadata={handleLoadedMetadata}
        onError={handleError}
      />
      {preparing && !quiet && (
        <span style={overlayStyle} role="status">
          正在准备可跳转的视频{percent > 0 ? ` ${percent}%` : '…'}
        </span>
      )}
    </span>
  )
}

const SeekableVideo = forwardRef<HTMLVideoElement, SeekableVideoProps>(SeekableVideoImpl)
SeekableVideo.displayName = 'SeekableVideo'
export default SeekableVideo
