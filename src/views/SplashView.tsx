/**
 * SplashView — 开屏页
 * 流程:开屏页 → 点击"开始创作"直接进 /home 首页(无需登录,首页/模板/智能成片/爆款复制均免登录);
 *       受保护页(项目管理/素材市场)与「生成/做同款」等动作再要求登录。右上角入口走 /login。
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './SplashView.css'
import loginHero from '@/assets/login-hero.jpg'
import wordmark from '@/assets/logo/splash-wordmark.png' // 中央彩色「帧智汇」字标(从 Figma 导出)
import markLogo from '@/assets/logo/splash-mark.png' // 左上品牌图标(从 Figma 导出)
import { listBanners } from '@/api/banners'
import { useSwr } from '@/composables/useSwr' // 复用首页同一套 SWR 缓存(先返缓存秒出、后台刷新)
import { swrFetch } from '@/utils/swrCache'
import { preloadMedia } from '@/utils/mediaPreload'

export default function SplashView() {
  const navigate = useNavigate()

  // 开屏背景:slug=welcome 的 banner(只取第一条,不轮播)。useSwr 负责缓存秒出 + 后台刷新。
  const { data: welcomeBanners } = useSwr('welcome-banner', () => listBanners('welcome'), { fallback: [] })
  // 视频/图片加载失败时置 true,回退静态底图。
  const [mediaFailed, setMediaFailed] = useState(false)
  const welcomeBanner = welcomeBanners && welcomeBanners.length ? welcomeBanners[0] : null

  // 媒体失败前:视频→<video>,图片→高优先 <img>;失败/无数据→透出静态底图(CSS 背景)。
  const isVideo = welcomeBanner?.mediaType === 'video' && !mediaFailed
  const isImage = welcomeBanner?.mediaType === 'image' && !mediaFailed

  // 用户第一次打开域名通常先到 welcome,之后多半去「登录」或「开始创作(首页)」。
  // 这里提前把登录页 / 首页的 banner 预取并预热媒体:
  //  - 用 swrFetch 写入对应缓存键(与各页 useSwr 同键)→ 到达页面直接命中、不再二次请求;
  //  - preloadMedia 把视频缓冲到可播、图片整张下载 → 到达页面秒出,免骨架/转圈。
  useEffect(() => {
    let cancelled = false
    const warm = (key: string, slug: string) =>
      swrFetch(key, () => listBanners(slug))
        .then(({ data: list }) => {
          if (cancelled || !list.length) return
          preloadMedia(list.map((b) => ({ url: b.mediaUrl, type: b.mediaType })))
        })
        .catch(() => {})
    warm('login-banners', 'login')
    warm('home-banners', 'home')
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main className="splash" style={{ backgroundImage: `url(${loginHero})` }}>
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
        <button type="button" className="splash-login" onClick={() => navigate('/login', { state: { from: '/home' } })}>
          登录
        </button>
      </div>

      {/* 中央品牌字标 */}
      <header className="splash-brand">
        <img className="splash-brand-logo" src={wordmark} alt="帧智汇" />
      </header>

      {/* 操作按钮(玻璃拟态) */}
      <div className="splash-actions">
        <button type="button" className="splash-btn-register" onClick={() => navigate('/home')}>
          开始创作
        </button>
      </div>
    </main>
  )
}
