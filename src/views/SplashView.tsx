/**
 * SplashView — 开屏页
 * 点击"开始创作"后进入 /login 登录页。
 */
import { useNavigate } from 'react-router-dom'
import './SplashView.css'
import loginHero from '@/assets/login-hero.png'
import brandLogo from '@/assets/logo/image.png'
import topLogo from '@/assets/logo/343bca61596faf452e963d62cd6fd37f.png'
import topLogo2 from '@/assets/logo/image copy.png'
import topLogoRight from '@/assets/logo/image copy 2.png'
import { setGuestMode } from '@/components/guest/GuestGuard'

export default function SplashView() {
  const navigate = useNavigate()

  return (
    <main className="splash" style={{ backgroundImage: `url(${loginHero})` }}>
      {/* 顶部半透明层 */}
      <div className="splash-overlay">
        <img className="splash-overlay-logo" src={topLogo} alt="" />
        <img className="splash-overlay-logo2" src={topLogo2} alt="" />
        <img className="splash-overlay-logo-right" src={topLogoRight} alt="" onClick={() => navigate('/login')} />
      </div>

      {/* 品牌 Logo */}
      <header className="splash-brand">
        <img className="splash-brand-logo" src={brandLogo} alt="帧智汇" />
      </header>

      {/* 操作按钮 */}
      <div className="splash-actions">
        <button
          type="button"
          className="splash-btn-register"
          onClick={() => {
            setGuestMode()
            navigate('/home')
          }}
        >
          开始创作
        </button>
      </div>
    </main>
  )
}
