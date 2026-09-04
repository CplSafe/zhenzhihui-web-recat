/**
 * 语音输入:空闲时是一枚麦克风按钮(外观由调用方 className 决定,好和所在按钮组长得一样);
 * 点击后在原位浮出深色胶囊 —— 左边麦克风(再点结束并识别)、中间实时波形、右边 × 取消。
 * 胶囊绝对定位、右缘对齐原按钮,底下留一个同尺寸占位,所以展开时不会把旁边的按钮挤走。
 * 识别文本通过 onText 交给调用方回填。浏览器不支持录音时不渲染,避免给一个点了没反应的按钮。
 */
import { useEffect } from 'react'
import { useToast } from '@/composables/useToast'
import { useVoiceInput } from '@/composables/useVoiceInput'
import './VoiceInputButton.css'

export interface VoiceInputButtonProps {
  /** 识别出文本时回调(调用方决定是追加还是插到光标处)。 */
  onText: (text: string) => void
  /** 空闲态按钮的样式类,由调用方传入以匹配所在按钮组。 */
  className?: string
  /** 游客态:按钮照常展示,点击交由 onAuthRequired 引导登录(识别接口需要登录)。 */
  authRequired?: boolean
  onAuthRequired?: () => void
  /** 单段最长秒数,到点自动停止并识别。 */
  maxSeconds?: number
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s < 10 ? '0' : ''}${s}`
}

function MicIcon() {
  return (
    <svg
      className="voice-input__icon"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9 21h6" />
    </svg>
  )
}

export default function VoiceInputButton({
  onText,
  className = '',
  authRequired = false,
  onAuthRequired,
  maxSeconds,
}: VoiceInputButtonProps) {
  const { showToast } = useToast()
  const voice = useVoiceInput({ onText, maxSeconds })

  // 错误统一走全局 toast,不在工具条里挤一行红字。
  useEffect(() => {
    if (!voice.error) return
    showToast(voice.error, 'error')
    voice.clearError()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.error])

  if (!voice.supported) return null

  if (voice.status === 'idle') {
    return (
      <button
        type="button"
        className={`voice-input voice-input--trigger ${className}`.trim()}
        data-state="idle"
        onClick={() => (authRequired ? onAuthRequired?.() : void voice.start())}
        aria-label="语音输入"
        title="语音输入"
      >
        <MicIcon />
      </button>
    )
  }

  const recording = voice.status === 'recording'
  return (
    <span className="voice-input voice-input--anchor" data-state={voice.status}>
      {/* 占位:沿用空闲按钮的尺寸类,保住原来的版位 */}
      <span className={`voice-input__placeholder ${className}`.trim()} aria-hidden="true" />
      <div className="voice-input__panel" role="group" aria-label={recording ? '正在录音' : '正在识别语音'}>
        <button
          type="button"
          className="voice-input__mic"
          onClick={voice.stop}
          disabled={!recording}
          aria-label={recording ? '停止录音并识别' : '正在识别语音'}
          title={recording ? '停止录音并识别' : '正在识别语音'}
        >
          <MicIcon />
        </button>
        <div className="voice-input__wave" aria-hidden="true">
          {voice.levels.map((level, index) => (
            <span key={index} style={{ '--level': level } as React.CSSProperties} />
          ))}
        </div>
        <span className="voice-input__label" aria-live="polite">
          {recording ? formatElapsed(voice.elapsed) : '识别中'}
        </span>
        <button
          type="button"
          className="voice-input__close"
          onClick={voice.cancel}
          aria-label={recording ? '取消录音' : '取消识别'}
          title={recording ? '取消录音' : '取消识别'}
        >
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </span>
  )
}
