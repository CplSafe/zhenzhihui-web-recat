/**
 * 浏览器原生语音输入（Web Speech API）。
 *
 * 选原生而非「录音上传 + 后端 ASR」：零后端、零额外计费、实时出字。
 * 代价是浏览器支持不均——Chrome/Edge 完整支持，Safari 部分支持，
 * Firefox 默认关闭。因此 `supported` 必须暴露给调用方，
 * 不支持时应当隐藏入口而不是给一个点了没反应的按钮。
 *
 * 说明：Chrome 的实现会把音频发到 Google 的服务端做识别，
 * 这是浏览器行为、不经过我们的服务器。对隐私敏感的部署需要改用自建 ASR。
 */
import { useCallback, useEffect, useRef, useState } from 'react'

/** Web Speech API 尚未进 TS 标准库，按用到的部分声明。 */
interface SpeechRecognitionAlternativeLike {
  transcript: string
}
interface SpeechRecognitionResultLike {
  readonly length: number
  isFinal: boolean
  [index: number]: SpeechRecognitionAlternativeLike
}
interface SpeechRecognitionEventLike {
  resultIndex: number
  results: {
    readonly length: number
    [index: number]: SpeechRecognitionResultLike
  }
}
interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  stop(): void
  abort(): void
  onresult: ((e: SpeechRecognitionEventLike) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike

function getCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

/** 把识别错误转成用户看得懂的一句话。 */
function messageFor(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return '麦克风权限被拒绝，请在浏览器地址栏右侧允许后重试'
    case 'no-speech':
      return '没听到声音，请再说一次'
    case 'audio-capture':
      return '找不到麦克风，请检查设备'
    case 'network':
      return '语音识别服务连接失败，请检查网络'
    default:
      return '语音识别失败，请重试或改用键盘输入'
  }
}

/**
 * @param onText 识别出最终文本时回调（可能多次，每次是一段）。
 */
export function useSpeechInput(onText: (text: string) => void) {
  const [listening, setListening] = useState(false)
  const [error, setError] = useState('')
  // 未定型的中间结果，用于让用户看到"正在听什么"。
  const [interim, setInterim] = useState('')

  const recRef = useRef<SpeechRecognitionLike | null>(null)
  // onText 存 ref：识别回调注册一次即长期存活，直接闭包会捕获旧的 onText。
  const onTextRef = useRef(onText)
  onTextRef.current = onText

  const supported = getCtor() !== null

  const stop = useCallback(() => {
    recRef.current?.stop()
    setListening(false)
    setInterim('')
  }, [])

  const start = useCallback(() => {
    const Ctor = getCtor()
    if (!Ctor) {
      setError('当前浏览器不支持语音输入，建议使用 Chrome 或 Edge')
      return
    }
    setError('')
    const rec = new Ctor()
    rec.lang = 'zh-CN'
    // continuous：说完一句不自动停，适合口述较长的需求描述。
    rec.continuous = true
    // interimResults：边说边出字，否则要等整段说完才有反馈，像卡住。
    rec.interimResults = true

    rec.onresult = (e) => {
      let pending = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i]
        const text = result[0]?.transcript ?? ''
        if (result.isFinal) {
          // 定型的片段交给调用方追加进输入框。
          if (text.trim()) onTextRef.current(text)
        } else {
          pending += text
        }
      }
      setInterim(pending)
    }
    rec.onerror = (e) => {
      // no-speech 是常态（用户按了但没马上说），不该弹错误吓人。
      if (e.error !== 'no-speech') setError(messageFor(e.error))
      setListening(false)
      setInterim('')
    }
    rec.onend = () => {
      setListening(false)
      setInterim('')
    }

    recRef.current = rec
    try {
      rec.start()
      setListening(true)
    } catch {
      // 重复 start 会抛异常（上一次还没结束），忽略即可。
    }
  }, [])

  const toggle = useCallback(() => {
    if (listening) stop()
    else start()
  }, [listening, start, stop])

  // 组件卸载时中断识别，否则离开页面后麦克风还亮着。
  useEffect(() => () => recRef.current?.abort(), [])

  return { supported, listening, interim, error, toggle, stop, clearError: () => setError('') }
}
