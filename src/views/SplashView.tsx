/**
 * 页面职责：作为游客进入产品的品牌开屏页，并把用户引导到首页或登录页。
 * 页面效果：优先展示后台配置的 welcome 图片/视频，加载失败时回退本地静态底图；“开始创作”进入 /home，右上角进入 /login。
 * 性能策略：空闲时预热首页 banner，用户表达登录意图后再预热登录页；省流量或慢网环境不主动下载重媒体。
 * 权限边界：首页和浏览型创作页可免登录访问，项目、素材及真正的生成动作仍由后续页面执行鉴权。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './SplashView.css'
import loginHero from '@/assets/login-hero.webp'
import loginHeroFallback from '@/assets/login-hero-fallback.jpg'
import wordmark from '@/assets/logo/splash-wordmark.png' // 中央彩色「帧智汇」字标(从 Figma 导出)
import markLogo from '@/assets/logo/splash-mark.png' // 左上品牌图标(从 Figma 导出)
import { listBanners } from '@/api/banners'
import { useSwr } from '@/composables/useSwr' // 复用首页同一套 SWR 缓存(先返缓存秒出、后台刷新)
import { swrFetch } from '@/utils/swrCache'
import { preloadMedia } from '@/utils/mediaPreload'

/** 开屏页可提前预热媒体的下一跳页面。 */
type NextRouteBannerTarget = 'home' | 'login'

/** 下一跳页面对应的 Banner 缓存键和后端 slug。 */
const NEXT_ROUTE_BANNERS: Record<NextRouteBannerTarget, { cacheKey: string; slug: string }> = {
  home: { cacheKey: 'home-banners', slug: 'home' },
  login: { cacheKey: 'login-banners', slug: 'login' },
}

/** 浏览器网络信息 API 的最小兼容字段。 */
type NetworkInformationLike = {
  effectiveType?: string
  saveData?: boolean
}

/** 兼容不同浏览器前缀的网络信息接口。 */
type NavigatorWithConnection = Navigator & {
  connection?: NetworkInformationLike
  mozConnection?: NetworkInformationLike
  webkitConnection?: NetworkInformationLike
}

/** 兼容可选 requestIdleCallback 的 Window 类型。 */
type WindowWithIdleCallback = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
  cancelIdleCallback?: (handle: number) => void
}

/** 根据省流量设置和网络等级决定是否预加载下一页媒体。 */
function shouldPreloadNextMedia(type: 'image' | 'video'): boolean {
  // 尊重浏览器省流量设置，并在低速网络下跳过会明显争抢首屏带宽的媒体预加载。
  const nav = navigator as NavigatorWithConnection
  const connection = nav.connection || nav.mozConnection || nav.webkitConnection
  if (!connection) return true
  if (connection.saveData) return false

  const effectiveType = String(connection.effectiveType || '').toLowerCase()
  if (effectiveType === 'slow-2g' || effectiveType === '2g') return false
  if (effectiveType === '3g' && type === 'video') return false
  return true
}

/** 在浏览器空闲阶段执行预热，并返回统一取消函数。 */
function scheduleIdle(callback: () => void): () => void {
  // 优先使用空闲调度；不支持 requestIdleCallback 的浏览器使用短延时兜底，并统一返回取消函数。
  const idleWindow = window as WindowWithIdleCallback
  if (typeof idleWindow.requestIdleCallback === 'function') {
    const handle = idleWindow.requestIdleCallback(callback, { timeout: 2000 })
    return () => idleWindow.cancelIdleCallback?.(handle)
  }

  const handle = window.setTimeout(callback, 1200)
  return () => window.clearTimeout(handle)
}

/** 渲染游客开屏媒体，并按用户意图预热首页或登录页。 */
export default function SplashView() {
  const navigate = useNavigate()
  const warmedTargetsRef = useRef(new Set<NextRouteBannerTarget>())
  const scheduledWarmupsRef = useRef(new Map<NextRouteBannerTarget, () => void>())

  // 开屏背景:slug=welcome 的 banner(只取第一条,不轮播)。useSwr 负责缓存秒出 + 后台刷新。
  const { data: welcomeBanners } = useSwr('welcome-banner', () => listBanners('welcome'), { fallback: [] })
  // 视频/图片加载失败时置 true,回退静态底图。
  const [mediaFailed, setMediaFailed] = useState(false)
  const welcomeBanner = welcomeBanners && welcomeBanners.length ? welcomeBanners[0] : null

  // 媒体失败前:视频→<video>,图片→高优先 <img>;失败/无数据→透出静态底图(CSS 背景)。
  const isVideo = welcomeBanner?.mediaType === 'video' && !mediaFailed
  const isImage = welcomeBanner?.mediaType === 'image' && !mediaFailed

  // 只预热用户下一步真正会进入的页面,并且只取该页面第一条 banner:
  // - 主 CTA(/home)在浏览器空闲后预热,不与 welcome 首屏媒体争抢带宽;
  // - 登录入口仅在 hover/focus/click 表达意图后预热;
  // - 省流量/慢网仅缓存轻量 banner 数据,不主动下载媒体。
  const warmNextRoute = useCallback((target: NextRouteBannerTarget) => {
    if (warmedTargetsRef.current.has(target)) return
    warmedTargetsRef.current.add(target)
    const config = NEXT_ROUTE_BANNERS[target]

    void swrFetch(config.cacheKey, () => listBanners(config.slug))
      .then(({ data: list }) => {
        const first = list[0]
        if (!first || !shouldPreloadNextMedia(first.mediaType)) return
        void preloadMedia([{ url: first.mediaUrl, type: first.mediaType }], { concurrency: 1 })
      })
      .catch(() => {
        /* 预热失败不影响目标页自行加载 */
      })
  }, [])

  const cancelScheduledWarmup = useCallback((target: NextRouteBannerTarget) => {
    scheduledWarmupsRef.current.get(target)?.()
    scheduledWarmupsRef.current.delete(target)
  }, [])

  const scheduleNextRouteWarmup = useCallback(
    (target: NextRouteBannerTarget) => {
      if (warmedTargetsRef.current.has(target) || scheduledWarmupsRef.current.has(target)) return
      const cancel = scheduleIdle(() => {
        scheduledWarmupsRef.current.delete(target)
        warmNextRoute(target)
      })
      scheduledWarmupsRef.current.set(target, cancel)
    },
    [warmNextRoute],
  )

  const signalNextRouteIntent = useCallback(
    (target: NextRouteBannerTarget) => {
      // 用户已表达明确意图时，取消另一目标的排队任务，优先把带宽留给即将打开的页面。
      const otherTarget: NextRouteBannerTarget = target === 'home' ? 'login' : 'home'
      cancelScheduledWarmup(otherTarget)
      scheduleNextRouteWarmup(target)
    },
    [cancelScheduledWarmup, scheduleNextRouteWarmup],
  )

  const openNextRoute = useCallback(
    (target: NextRouteBannerTarget, path: string) => {
      // 跳转前取消全部空闲任务并立即触发目标预热，缓存结果可供下一页直接复用。
      cancelScheduledWarmup('home')
      cancelScheduledWarmup('login')
      warmNextRoute(target)
      navigate(path)
    },
    [cancelScheduledWarmup, navigate, warmNextRoute],
  )

  useEffect(() => {
    // 开屏稳定后默认预热最常用的首页路径；卸载时清理尚未执行的空闲任务。
    const scheduledWarmups = scheduledWarmupsRef.current
    scheduleNextRouteWarmup('home')
    return () => {
      scheduledWarmups.forEach((cancel) => cancel())
      scheduledWarmups.clear()
    }
  }, [scheduleNextRouteWarmup])

  return (
    <main className="splash">
      <picture className="splash-static-background" aria-hidden="true">
        <source srcSet={loginHero} type="image/webp" />
        <img src={loginHeroFallback} alt="" fetchPriority="high" decoding="async" />
      </picture>
      {/* 图片背景:高优先加载 + 异步解码,首屏尽快出图;失败透出静态底图 */}
      {isImage && (
        <img
          className="splash-media"
          src={welcomeBanner!.mediaUrl}
          alt=""
          aria-hidden="true"
          fetchPriority="high"
          decoding="async"
          onError={() => setMediaFailed(true)}
        />
      )}
      {/* 视频背景:铺满 + 自动播放(静音,循环),不轮播;加载失败回退静态底图 */}
      {isVideo && (
        <video
          className="splash-media"
          src={welcomeBanner!.mediaUrl}
          autoPlay
          muted
          loop
          playsInline
          aria-hidden="true"
          onError={() => setMediaFailed(true)}
        />
      )}

      {/* 全屏深色蒙版(Figma #333 @40%) */}
      <div className="splash-mask" aria-hidden="true" />

      {/* 顶部磨砂条(Figma #333 @60% + 模糊):左 logo+帧智汇,右 登录 */}
      <div className="splash-overlay">
        <div className="splash-overlay-brand">
          <img className="splash-overlay-mark" src={markLogo} alt="" />
          <span className="splash-overlay-name">帧智汇</span>
        </div>
        <button
          type="button"
          className="splash-login"
          onPointerEnter={() => signalNextRouteIntent('login')}
          onFocus={() => signalNextRouteIntent('login')}
          onClick={() => openNextRoute('login', '/login')}
        >
          登录
        </button>
      </div>

      {/* 中央品牌字标 */}
      <header className="splash-brand">
        <img className="splash-brand-logo" src={wordmark} alt="帧智汇" />
      </header>

      {/* 操作按钮(玻璃拟态) */}
      <div className="splash-actions">
        <button
          type="button"
          className="splash-btn-register"
          onPointerEnter={() => signalNextRouteIntent('home')}
          onFocus={() => signalNextRouteIntent('home')}
          onClick={() => openNextRoute('home', '/home')}
        >
          开始创作
        </button>
      </div>
    </main>
  )
}
