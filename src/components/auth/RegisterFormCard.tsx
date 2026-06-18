/**
 * RegisterFormCard — 注册表单卡片
 * 手机号 + 短信验证码 + 密码注册流程，含协议勾选确认。
 */

export interface RegisterErrors {
  phone: string
  code: string
  password: string
  captcha: string
}

export interface RegisterFormCardProps {
  // v-model 受控字段
  registerPhone: string
  onRegisterPhoneChange?: (value: string) => void
  registerCode: string
  onRegisterCodeChange?: (value: string) => void
  registerPassword: string
  onRegisterPasswordChange?: (value: string) => void
  registerAgreed: boolean
  onRegisterAgreedChange?: (value: boolean) => void
  registerCaptchaAnswer: string
  onRegisterCaptchaAnswerChange?: (value: string) => void
  // 普通 props
  registerErrors: RegisterErrors
  registerCodeCountdown: number
  registerCodeButtonText: string
  isSubmitting?: boolean
  isSendingCode?: boolean
  captchaImage?: string
  notice?: string
  noticeType?: string
  // emits
  onSubmit?: () => void
  onClearError?: (field: string) => void
  onRequestCode?: () => void
  onRefreshCaptcha?: () => void
  onLink?: (label: string) => void
}

export default function RegisterFormCard(props: RegisterFormCardProps) {
  const {
    registerPhone,
    registerCode,
    registerPassword,
    registerAgreed,
    registerCaptchaAnswer,
    registerErrors,
    registerCodeCountdown,
    registerCodeButtonText,
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
      className={`login-card register-card${captchaImage ? ' has-captcha' : ''}`}
      aria-label="注册"
    >
      <h2>欢迎注册帧智汇</h2>
      <p className="login-subtitle">注册后即可体验AI生成广告视频等更多功能</p>

      <form
        className={`login-form register-form${captchaImage ? ' has-captcha' : ''}`}
        onSubmit={handleFormSubmit}
      >
        <label
          className={`field register-phone-field phone-with-prefix${
            registerErrors.phone ? ' has-error' : ''
          }`}
          aria-label="注册手机号"
        >
          <span className="country-prefix">
            <svg className="country-plus" viewBox="0 0 8 8" aria-hidden="true">
              <path d="M3.33333 3.33333H0.668333C0.58067 3.3332 0.493839 3.35034 0.412803 3.38378C0.331766 3.41722 0.258111 3.46629 0.196047 3.5282C0.133982 3.59011 0.084723 3.66364 0.0510846 3.7446C0.0174463 3.82555 8.74782e-05 3.91234 0 4C0 4.37067 0.299333 4.66667 0.668333 4.66667H3.33333V7.33167C3.33333 7.701 3.63167 8 4 8C4.37067 8 4.66667 7.70067 4.66667 7.33167V4.66667H7.33167C7.41933 4.6668 7.50616 4.64966 7.5872 4.61622C7.66823 4.58278 7.74189 4.53371 7.80395 4.4718C7.86602 4.40989 7.91528 4.33636 7.94892 4.2554C7.98255 4.17445 7.99991 4.08766 8 4C8 3.62933 7.70067 3.33333 7.33167 3.33333H4.66667V0.668333C4.6668 0.58067 4.64966 0.493839 4.61622 0.412803C4.58278 0.331766 4.53371 0.258111 4.4718 0.196047C4.40989 0.133982 4.33636 0.084723 4.2554 0.0510846C4.17445 0.0174463 4.08766 8.74782e-05 4 0C3.62933 0 3.33333 0.299333 3.33333 0.668333V3.33333Z" />
            </svg>
            <b>86</b>
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <path d="M3 4.5 6 7.5 9 4.5" />
            </svg>
          </span>
          <input
            data-testid="register-phone-input"
            value={registerPhone}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="请输入手机号"
            onChange={(e) => {
              props.onRegisterPhoneChange?.(e.target.value)
              props.onClearError?.('phone')
            }}
          />
        </label>
        {registerErrors.phone && (
          <p className="field-error register-phone-error">{registerErrors.phone}</p>
        )}

        <label
          className={`field register-code-field code-field${
            registerErrors.code ? ' has-error' : ''
          }`}
          aria-label="注册验证码"
        >
          <input
            data-testid="register-code-input"
            value={registerCode}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="请输入验证码"
            onChange={(e) => {
              props.onRegisterCodeChange?.(e.target.value)
              props.onClearError?.('code')
            }}
          />
          <button
            data-testid="register-send-code-button"
            className="code-action"
            type="button"
            aria-label="获取验证码"
            disabled={registerCodeCountdown > 0 || isSendingCode}
            onClick={() => props.onRequestCode?.()}
          >
            {isSendingCode ? '发送中...' : registerCodeButtonText}
          </button>
        </label>
        {registerErrors.code && (
          <p className="field-error register-code-error">{registerErrors.code}</p>
        )}

        <label
          className={`field register-password-field${
            registerErrors.password ? ' has-error' : ''
          }`}
          aria-label="注册密码"
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M15.9 7.2h-1.5V5.7a4.4 4.4 0 0 0-8.8 0v1.5H4.1a2 2 0 0 0-2 2v7.6a2 2 0 0 0 2 2h11.8a2 2 0 0 0 2-2V9.2a2 2 0 0 0-2-2ZM7 5.7a3 3 0 0 1 6 0v1.5H7V5.7Zm9.5 11.1a.6.6 0 0 1-.6.6H4.1a.6.6 0 0 1-.6-.6V9.2c0-.3.3-.6.6-.6h11.8c.3 0 .6.3.6.6v7.6Z" />
          </svg>
          <input
            data-testid="register-password-input"
            value={registerPassword}
            type="password"
            autoComplete="new-password"
            placeholder="请设置密码"
            onChange={(e) => {
              props.onRegisterPasswordChange?.(e.target.value)
              props.onClearError?.('password')
            }}
          />
        </label>
        {registerErrors.password && (
          <p className="field-error register-password-error">{registerErrors.password}</p>
        )}

        {captchaImage && (
          <label
            className={`field register-captcha-field captcha-field${
              registerErrors.captcha ? ' has-error' : ''
            }`}
            aria-label="图形验证码"
          >
            <input
              data-testid="register-captcha-input"
              value={registerCaptchaAnswer}
              type="text"
              autoComplete="off"
              maxLength={8}
              placeholder="请输入图形验证码"
              onChange={(e) => {
                props.onRegisterCaptchaAnswerChange?.(e.target.value)
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
        {captchaImage && registerErrors.captcha && (
          <p className="field-error register-captcha-error">{registerErrors.captcha}</p>
        )}

        <label className="check-line agreement register-agreement">
          <input
            data-testid="register-agreement-checkbox"
            checked={registerAgreed}
            type="checkbox"
            onChange={(e) => props.onRegisterAgreedChange?.(e.target.checked)}
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

        <button
          data-testid="submit-register"
          className="submit-button register-submit"
          type="submit"
          disabled={isSubmitting}
        >
          {isSubmitting ? '注册中...' : '注册'}
        </button>
        <p className={`form-notice register-notice ${noticeType}`} aria-live="polite">
          {notice}
        </p>
      </form>
    </section>
  )
}
