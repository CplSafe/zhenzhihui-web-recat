/**
 * 录音式语音输入:MediaRecorder 录一段 → 上传后端 → 阿里百炼识别 → 回调文本。
 *
 * 与 useSpeechInput(浏览器 Web Speech API)的区别:
 * 后者由 Chrome 把音频送到 Google 识别,国内网络基本不可用;
 * 这里走自家后端,凭证不下发到浏览器,Safari / Firefox 也都支持 MediaRecorder。
 * 代价是不能边说边出字,只能说完一段再出结果,所以 UI 要把「录音中 / 识别中」状态摆清楚,
 * 录音期间另外用 Web Audio 取实时音量喂给波形,让用户确认麦克风真的在收音。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { isAbortedTaskError } from '@/api/business'
import { transcribeAudio } from '@/api/speech'
import { useLatestCallback } from './useLatestCallback'

export type VoiceInputStatus = 'idle' | 'recording' | 'transcribing'

export interface UseVoiceInputOptions {
  /** 识别出文本时回调(空文本不回调,改为报"没听到声音")。 */
  onText: (text: string) => void
  /** 单段最长秒数,到点自动停止并识别;后端上限 5 分钟,口述需求两分钟足够。 */
  maxSeconds?: number
}

/** 波形条数;每 80ms 推入一个音量值,整条大约展示最近 2 秒。 */
export const VOICE_LEVEL_BARS = 28
const LEVEL_SAMPLE_MS = 80

/** 各浏览器 MediaRecorder 支持的音频容器不同,按优先级挑第一个能用的。 */
const PREFERRED_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg']

const UNSUPPORTED_MESSAGE = '当前浏览器不支持录音，建议使用 Chrome、Edge 或 Safari'
const NO_SPEECH_MESSAGE = '没听到声音，请靠近麦克风再说一次'

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return undefined
  return PREFERRED_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type))
}

/** 浏览器是否具备录音能力(getUserMedia + MediaRecorder)。 */
export function isVoiceInputSupported(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  return typeof navigator.mediaDevices?.getUserMedia === 'function' && typeof MediaRecorder !== 'undefined'
}

/** 把拿麦克风失败的异常转成用户看得懂的一句话。 */
function microphoneErrorMessage(error: any): string {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return '麦克风权限被拒绝，请在浏览器地址栏右侧允许后重试'
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return '找不到麦克风，请检查设备'
    case 'NotReadableError':
    case 'TrackStartError':
      return '麦克风被其他应用占用，请关闭后重试'
    default:
      return '无法开始录音，请重试或改用键盘输入'
  }
}

interface LevelMeter {
  ctx: AudioContext
  raf: number
}

export function useVoiceInput({ onText, maxSeconds = 120 }: UseVoiceInputOptions) {
  const [status, setStatus] = useState<VoiceInputStatus>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [levels, setLevels] = useState<number[]>(() => new Array<number>(VOICE_LEVEL_BARS).fill(0))
  const [error, setError] = useState('')

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const meterRef = useRef<LevelMeter | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // 当前这段录音是否作废(用户点了取消 / 录音出错):收尾时只清理,不上传。每次 start 复位。
  const discardRef = useRef(false)
  // start() 在等待麦克风授权期间 status 仍是 idle,靠这个同步标记挡住重复点击,
  // 否则双击会开出两路 MediaStream,第一路永远没人 stop,指示灯一直亮。
  const startingRef = useRef(false)
  // 组件已卸载:授权回来的 stream 直接放掉,正在录的这段停掉后不再上传。
  const unmountedRef = useRef(false)
  // 录音回调注册一次即长期存活,直接闭包会捕获旧的 onText,故取「始终最新」的稳定引用。
  const emitText = useLatestCallback(onText)

  const supported = isVoiceInputSupported()

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  /** 用 AnalyserNode 每 80ms 取一次 RMS 音量,滚动进 levels;拿不到 AudioContext 就让波形保持静态。 */
  const startMeter = (stream: MediaStream) => {
    const Ctx: typeof AudioContext | undefined = window.AudioContext || (window as any).webkitAudioContext
    if (!Ctx) return
    try {
      const ctx = new Ctx()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      ctx.createMediaStreamSource(stream).connect(analyser)
      const buffer = new Uint8Array(analyser.fftSize)
      let lastSample = 0
      const meter: LevelMeter = { ctx, raf: 0 }
      const tick = (now: number) => {
        if (now - lastSample >= LEVEL_SAMPLE_MS) {
          lastSample = now
          analyser.getByteTimeDomainData(buffer)
          let sum = 0
          for (let i = 0; i < buffer.length; i += 1) {
            const d = (buffer[i] - 128) / 128
            sum += d * d
          }
          // 正常说话 RMS 大约 0.05~0.25,放大 4 倍让波形有起伏。
          const level = Math.min(1, Math.sqrt(sum / buffer.length) * 4)
          setLevels((prev) => [...prev.slice(1), level])
        }
        meter.raf = window.requestAnimationFrame(tick)
      }
      meter.raf = window.requestAnimationFrame(tick)
      meterRef.current = meter
    } catch {
      // 没有电平只是波形不动,不影响录音本身。
    }
  }

  /** 放掉麦克风与电平分析器。 */
  const releaseStream = () => {
    const meter = meterRef.current
    if (meter) {
      window.cancelAnimationFrame(meter.raf)
      void meter.ctx.close().catch(() => undefined)
      meterRef.current = null
    }
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }

  const transcribe = useCallback(
    async (blob: Blob) => {
      setStatus('transcribing')
      const controller = new AbortController()
      abortRef.current = controller
      try {
        const result = await transcribeAudio(blob, { signal: controller.signal })
        if (controller.signal.aborted) return
        if (result.text) emitText(result.text)
        else setError(NO_SPEECH_MESSAGE)
      } catch (err: any) {
        if (isAbortedTaskError(err)) return
        setError(err?.message || '语音识别失败，请重试或改用键盘输入')
      } finally {
        if (abortRef.current === controller) abortRef.current = null
        // 取消路径已经由 cancel() 复位状态;这里只处理正常收尾。
        if (!controller.signal.aborted) setStatus('idle')
      }
    },
    [emitText],
  )

  /** 结束录音并识别;真正的收尾在 onstop 里,等最后一块数据到齐再拼 blob 上传。 */
  const stop = useCallback(() => {
    clearTimer()
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop()
    } else {
      releaseStream()
      setStatus((cur) => (cur === 'recording' ? 'idle' : cur))
    }
  }, [])

  /** 放弃:录音中丢掉这段不上传;识别中中断上传。都回到空闲。 */
  const cancel = useCallback(() => {
    clearTimer()
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      discardRef.current = true
      recorder.stop()
      return
    }
    abortRef.current?.abort()
    abortRef.current = null
    releaseStream()
    setStatus('idle')
  }, [])

  const start = useCallback(async () => {
    if (startingRef.current) return
    if (!isVoiceInputSupported()) {
      setError(UNSUPPORTED_MESSAGE)
      return
    }
    startingRef.current = true
    setError('')
    try {
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      } catch (err) {
        setError(microphoneErrorMessage(err))
        return
      }
      streamRef.current = stream
      // 等待授权期间用户可能已切走,别在没人看的页面上开麦克风。
      if (unmountedRef.current) {
        releaseStream()
        return
      }
      const mimeType = pickMimeType()
      let recorder: MediaRecorder
      try {
        recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 32000 })
      } catch {
        releaseStream()
        setError(UNSUPPORTED_MESSAGE)
        return
      }
      recorderRef.current = recorder
      chunksRef.current = []
      discardRef.current = false

      /** 放掉麦克风并拼出本段音频;作废或没录到东西就回到空闲,否则上传识别。 */
      const finish = () => {
        releaseStream()
        recorderRef.current = null
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || 'audio/webm' })
        chunksRef.current = []
        if (discardRef.current || unmountedRef.current) {
          setStatus('idle')
          return
        }
        if (blob.size === 0) {
          setError(NO_SPEECH_MESSAGE)
          setStatus('idle')
          return
        }
        void transcribe(blob)
      }

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = finish
      recorder.onerror = () => {
        setError('录音中断，请重试')
        discardRef.current = true
        clearTimer()
        // 浏览器可能先把 state 置成 inactive 再派发 error,此时不会再有 onstop,直接收尾。
        if (recorder.state !== 'inactive') recorder.stop()
        else finish()
      }

      recorder.start()
      startMeter(stream)
      const startedAt = Date.now()
      setElapsed(0)
      setLevels(new Array<number>(VOICE_LEVEL_BARS).fill(0))
      setStatus('recording')
      clearTimer()
      timerRef.current = window.setInterval(() => {
        const seconds = Math.floor((Date.now() - startedAt) / 1000)
        setElapsed(seconds)
        if (seconds >= maxSeconds) stop()
      }, 250)
    } finally {
      startingRef.current = false
    }
  }, [maxSeconds, stop, transcribe])

  // 卸载时丢弃当前录音并放掉麦克风,否则离开页面后指示灯还亮着。
  useEffect(
    () => () => {
      unmountedRef.current = true
      clearTimer()
      abortRef.current?.abort()
      const recorder = recorderRef.current
      if (recorder && recorder.state !== 'inactive') recorder.stop()
      else releaseStream()
    },
    [],
  )

  return { supported, status, elapsed, levels, error, start, stop, cancel, clearError: () => setError('') }
}
