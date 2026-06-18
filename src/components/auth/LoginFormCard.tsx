/**
 * LoginFormCard — 登录表单卡片
 * 支持密码登录、短信验证码登录、扫码登录三种模式切换，含手机号/密码/验证码输入和登录按钮。
 */
import './LoginFormCard.css'

export interface LoginErrors {
  phone: string
  password: string
  code: string
  captcha: string
}

export interface LoginFormCardProps {
  // v-model 受控字段
  phone: string
  onPhoneChange?: (value: string) => void
  password: string
  onPasswordChange?: (value: string) => void
  smsCode: string
  onSmsCodeChange?: (value: string) => void
  captchaAnswer: string
  onCaptchaAnswerChange?: (value: string) => void
  remember: boolean
  onRememberChange?: (value: boolean) => void
  agreed: boolean
  onAgreedChange?: (value: boolean) => void
  showPassword: boolean
  onShowPasswordChange?: (value: boolean) => void
  // 普通 props
  loginMode: string
  loginErrors: LoginErrors
  codeCountdown: number
  codeButtonText: string
  isSubmitting?: boolean
  isSendingCode?: boolean
  captchaImage?: string
  notice?: string
  noticeType?: string
  // emits
  onSwitchMode?: (mode: string) => void
  onSubmit?: () => void
  onClearError?: (field: string) => void
  onRequestCode?: () => void
  onRefreshCaptcha?: () => void
  onLink?: (label: string) => void
  onUnifiedLogin?: () => void
}

export default function LoginFormCard(props: LoginFormCardProps) {
  const {
    phone,
    password,
    smsCode,
    captchaAnswer,
    remember,
    agreed,
    showPassword,
    loginMode,
    loginErrors,
    codeCountdown,
    codeButtonText,
    isSubmitting = false,
    isSendingCode = false,
    captchaImage = '',
    notice = '',
    noticeType = 'info',
  } = props

  function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault()
    props.onSubmit?.()
  }

  return (
    <section
      className={`login-card${captchaImage ? ' has-captcha' : ''}`}
      aria-label="登录"
    >
      <h2>欢迎登录帧智汇</h2>
      <p className="login-subtitle">登录后可体验AI生成广告视频等更多功能</p>

      <div
        className={`login-tabs${loginMode === 'code' ? ' is-code-mode' : ''}`}
        role="tablist"
      >
        <button
          data-testid="password-login-tab"
          type="button"
          className={loginMode === 'password' ? 'active' : ''}
          role="tab"
          aria-selected={loginMode === 'password'}
          onClick={() => props.onSwitchMode?.('password')}
        >
          账号密码登录
        </button>
        <button
          data-testid="code-login-tab"
          type="button"
          className={loginMode === 'code' ? 'active' : ''}
          role="tab"
          aria-selected={loginMode === 'code'}
          onClick={() => props.onSwitchMode?.('code')}
        >
          验证码登录
        </button>
      </div>

      <form
        className={`login-form${captchaImage ? ' has-captcha' : ''}`}
        onSubmit={handleFormSubmit}
      >
        <label
          className={`field phone-field${loginMode === 'code' ? ' phone-with-prefix' : ''}${
            loginErrors.phone ? ' has-error' : ''
          }`}
          aria-label="手机号"
        >
          {loginMode === 'code' ? (
            <span className="country-prefix">
              <svg className="country-plus" viewBox="0 0 8 8" aria-hidden="true">
                <path d="M3.33333 3.33333H0.668333C0.58067 3.3332 0.493839 3.35034 0.412803 3.38378C0.331766 3.41722 0.258111 3.46629 0.196047 3.5282C0.133982 3.59011 0.084723 3.66364 0.0510846 3.7446C0.0174463 3.82555 8.74782e-05 3.91234 0 4C0 4.37067 0.299333 4.66667 0.668333 4.66667H3.33333V7.33167C3.33333 7.701 3.63167 8 4 8C4.37067 8 4.66667 7.70067 4.66667 7.33167V4.66667H7.33167C7.41933 4.6668 7.50616 4.64966 7.5872 4.61622C7.66823 4.58278 7.74189 4.53371 7.80395 4.4718C7.86602 4.40989 7.91528 4.33636 7.94892 4.2554C7.98255 4.17445 7.99991 4.08766 8 4C8 3.62933 7.70067 3.33333 7.33167 3.33333H4.66667V0.668333C4.6668 0.58067 4.64966 0.493839 4.61622 0.412803C4.58278 0.331766 4.53371 0.258111 4.4718 0.196047C4.40989 0.133982 4.33636 0.084723 4.2554 0.0510846C4.17445 0.0174463 4.08766 8.74782e-05 4 0C3.62933 0 3.33333 0.299333 3.33333 0.668333V3.33333Z" />
              </svg>
              <b>86</b>
              <svg viewBox="0 0 12 12" aria-hidden="true">
                <path d="M3 4.5 6 7.5 9 4.5" />
              </svg>
            </span>
          ) : (
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M10 1.7a3.7 3.7 0 1 1 0 7.4 3.7 3.7 0 0 1 0-7.4Zm0 1.5a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4Zm-3.2 7.7h6.4c3.4 0 5.1 1.6 5.1 4.9v1.8c0 .4-.3.7-.8.7h-15c-.4 0-.8-.3-.8-.8v-1.7c0-3.3 1.7-4.9 5.1-4.9Zm0 1.5c-2.5 0-3.6 1-3.6 3.4v1h13.6v-1c0-2.4-1.1-3.4-3.6-3.4H6.8Z" />
            </svg>
          )}
          <input
            data-testid="phone-input"
            value={phone}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="请输入手机号"
            onChange={(e) => {
              props.onPhoneChange?.(e.target.value)
              props.onClearError?.('phone')
            }}
          />
        </label>
        {loginErrors.phone && (
          <p className="field-error login-phone-error">{loginErrors.phone}</p>
        )}

        {loginMode === 'password' && (
          <label
            key="password-field"
            className={`field password-field${loginErrors.password ? ' has-error' : ''}`}
            aria-label="密码"
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M15.9 7.2h-1.5V5.7a4.4 4.4 0 0 0-8.8 0v1.5H4.1a2 2 0 0 0-2 2v7.6a2 2 0 0 0 2 2h11.8a2 2 0 0 0 2-2V9.2a2 2 0 0 0-2-2ZM7 5.7a3 3 0 0 1 6 0v1.5H7V5.7Zm9.5 11.1a.6.6 0 0 1-.6.6H4.1a.6.6 0 0 1-.6-.6V9.2c0-.3.3-.6.6-.6h11.8c.3 0 .6.3.6.6v7.6Z" />
              <path d="M10 10.8c-.4 0-.7.3-.7.7v3.4a.7.7 0 0 0 1.4 0v-3.4c0-.4-.3-.7-.7-.7Z" />
            </svg>
            <input
              value={password}
              data-testid="password-input"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="请输入密码"
              onChange={(e) => {
                props.onPasswordChange?.(e.target.value)
                props.onClearError?.('password')
              }}
            />
            <button
              data-testid="password-toggle"
              className="icon-action"
              type="button"
              aria-label="显示或隐藏密码"
              onClick={() => props.onShowPasswordChange?.(!showPassword)}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                {showPassword ? (
                  <path d="M10 4.1c4 0 7.2 2.2 9.1 6.2-1.9 4-5.1 6.1-9.1 6.1S2.8 14.3.9 10.3C2.8 6.3 6 4.1 10 4.1Zm0 2C7 6.1 4.7 7.5 3.2 10.3 4.7 13 7 14.4 10 14.4s5.3-1.4 6.8-4.1C15.3 7.5 13 6.1 10 6.1Zm0 1.3a2.9 2.9 0 1 1 0 5.8 2.9 2.9 0 0 1 0-5.8Z" />
                ) : (
                  <path d="M17.2 1.8 18.2 2.8 2.8 18.2l-1-1 2.4-2.4A13 13 0 0 1 .9 10.3C2.8 6.3 6 4.1 10 4.1c1.5 0 2.8.3 4 .8l3.2-3.1ZM10 6.1c-3 0-5.3 1.4-6.8 4.2.6 1.3 1.4 2.3 2.3 3.1l1.8-1.8a2.9 2.9 0 0 1 3.8-3.8l1.4-1.4c-.8-.2-1.6-.3-2.5-.3Zm9.1 4.2c-1.9 4-5.1 6.1-9.1 6.1-1.2 0-2.3-.2-3.3-.5l1.6-1.6c.5.1 1.1.1 1.7.1 3 0 5.3-1.4 6.8-4.1-.6-1.2-1.3-2.3-2.2-3.1l1.4-1.4c1.2 1.1 2.2 2.6 3.1 4.5Z" />
                )}
              </svg>
            </button>
          </label>
        )}
        {loginMode === 'password' && loginErrors.password && (
          <p className="field-error login-credential-error">{loginErrors.password}</p>
        )}

        {loginMode === 'code' && (
          <label
            key="code-field"
            className={`field password-field code-field${loginErrors.code ? ' has-error' : ''}`}
            aria-label="验证码"
          >
            <input
              data-testid="code-input"
              value={smsCode}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="请输入验证码"
              onChange={(e) => {
                props.onSmsCodeChange?.(e.target.value)
                props.onClearError?.('code')
              }}
            />
            <button
              data-testid="send-code-button"
              className="code-action"
              type="button"
              aria-label="获取验证码"
              disabled={codeCountdown > 0 || isSendingCode}
              onClick={() => props.onRequestCode?.()}
            >
              {isSendingCode ? '发送中...' : codeButtonText}
            </button>
          </label>
        )}
        {loginMode === 'code' && loginErrors.code && (
          <p className="field-error login-credential-error">{loginErrors.code}</p>
        )}

        {captchaImage && (
          <label
            className={`field captcha-field${loginErrors.captcha ? ' has-error' : ''}`}
            aria-label="图形验证码"
          >
            <input
              data-testid="captcha-input"
              value={captchaAnswer}
              type="text"
              autoComplete="off"
              maxLength={8}
              placeholder="请输入图形验证码"
              onChange={(e) => {
                props.onCaptchaAnswerChange?.(e.target.value)
                props.onClearError?.('captcha')
              }}
            />
            <button
              className="captcha-image-button"
              type="button"
              aria-label="刷新图形验证码"
              onClick={() => props.onRefreshCaptcha?.()}
            >
              <img src={captchaImage} alt="图形验证码" />
            </button>
          </label>
        )}
        {captchaImage && loginErrors.captcha && (
          <p className="field-error login-captcha-error">{loginErrors.captcha}</p>
        )}

        <button
          data-testid="submit-login"
          className="submit-button"
          type="submit"
          disabled={isSubmitting}
        >
          {isSubmitting ? '登录中...' : '登录'}
        </button>

        <div className="utility-row">
          <label className="check-line">
            <input
              data-testid="remember-checkbox"
              checked={remember}
              type="checkbox"
              onChange={(e) => props.onRememberChange?.(e.target.checked)}
            />
            <span aria-hidden="true"></span>
            记住我的登录信息
          </label>
          <button type="button" onClick={() => props.onLink?.('忘记密码')}>
            忘记密码?
          </button>
        </div>

        <label className="check-line agreement">
          <input
            data-testid="agreement-checkbox"
            checked={agreed}
            type="checkbox"
            onChange={(e) => props.onAgreedChange?.(e.target.checked)}
          />
          <span aria-hidden="true"></span>
          已经阅读并同意
          <button type="button" onClick={() => props.onLink?.('用户协议')}>
            《用户协议》
          </button>
          及
          <button type="button" onClick={() => props.onLink?.('隐私政策')}>
            《隐私政策》
          </button>
        </label>

        <p className={`form-notice ${noticeType}`} aria-live="polite">
          {notice}
        </p>
      </form>

      <div className="sso-section">
        <div className="sso-divider">
          <span>或</span>
        </div>
        <button
          type="button"
          className="sso-button"
          onClick={() => props.onUnifiedLogin?.()}
        >
          统一认证登录
        </button>
        <p className="sso-hint">使用统一账号登录，一次登录访问所有服务</p>
      </div>
    </section>
  )
}
