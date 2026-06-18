/**
 * AuthHeroPanel — 登录页品牌展示面板
 * 展示产品名称、slogan、Hero 图片，纯展示组件。
 */

export interface AuthHeroFeature {
  title: string
  lines: string[]
  icon: string
}

export interface AuthHeroPanelProps {
  loginHero: string
  mode: string
  features: AuthHeroFeature[]
  onShowRegister?: () => void
  onShowLogin?: () => void
}

export default function AuthHeroPanel(props: AuthHeroPanelProps) {
  const { loginHero, mode, features } = props

  return (
    <>
      <img className="hero-image" src={loginHero} alt="" />

      <header className="brand">
        <h1>帧智汇</h1>
        <p>AI驱动的广告视频生成平台</p>
      </header>

      <div className="register-entry">
        <span>{mode === 'login' ? '还没有账号？' : '已有账号？'}</span>
        {mode === 'login' ? (
          <button type="button" onClick={() => props.onShowRegister?.()}>
            立即注册
          </button>
        ) : (
          <button type="button" onClick={() => props.onShowLogin?.()}>
            立即登录
          </button>
        )}
      </div>

      <section className="intro" aria-label="产品介绍">
        <p className="intro-kicker">AI赋能创意</p>
        <p className="intro-title">
          一键生成<span>高转化广告视频</span>
        </p>
        <p className="intro-copy">
          让广告视频制作更简单、更高效、更智能，
          <br />
          助力企业快速触达目标用户，提升营销转化效果
        </p>

        <ul className="feature-list">
          {features.map((feature) => (
            <li key={feature.title} className="feature-item">
              <span className="feature-icon" aria-hidden="true">
                {feature.icon === 'video' ? (
                  <svg viewBox="0 0 30 30">
                    <path d="M3 8.5C3 6.6 4.6 5 6.5 5h10C18.4 5 20 6.6 20 8.5v13c0 1.9-1.6 3.5-3.5 3.5h-10C4.6 25 3 23.4 3 21.5v-13Zm5 2.5v8l7-4-7-4Zm14 1.5 5-3v11l-5-3v-5Z" />
                  </svg>
                ) : feature.icon === 'template' ? (
                  <svg viewBox="0 0 30 30">
                    <path d="M5 4h16a3 3 0 0 1 3 3v2h-3V7H7v16h16v-7h3v7a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Zm5 7h17v3H10v-3Zm0 5h9v3h-9v-3Zm0 5h6v3h-6v-3Z" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 30 30">
                    <path d="M4 23h22v3H4v-3Zm2-4 5-5 4 3.5L23 8l2.5 2.1-10 12-4.2-3.7-3.1 3.1L6 19Z" />
                  </svg>
                )}
              </span>
              <span className="feature-text">
                <strong>{feature.title}</strong>
                {feature.lines.map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}
