/**
 * SplashView — 开屏页
 * 流程:开屏页 → 点击"开始创作"直接进 /home 首页(无需登录,首页/模板/智能成片/爆款复制均免登录);
 *       受保护页(项目管理/素材市场)与「生成/做同款」等动作再要求登录。右上角入口走 /login。
 */
import { useNavigate } from 'react-router-dom'
import './SplashView.css'
import loginHero from '@/assets/login-hero.jpg'
import wordmark from '@/assets/logo/splash-wordmark.png' // 中央彩色「帧智汇」字标(从 Figma 导出)
import markLogo from '@/assets/logo/splash-mark.png' // 左上品牌图标(从 Figma 导出)

export default function SplashView() {
  const navigate = useNavigate()

  return (
    <main className="splash" style={{ backgroundImage: `url(${loginHero})` }}>
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
