import { useEffect, useRef, useState } from 'react'
import { useLatestCallback } from './useLatestCallback'
import {
  encodeVoiceWav,
  hasAudibleVoice,
  MAX_RECORDING_SECONDS,
  recordingPermissionError,
} from '@/utils/voiceRecording'

type Phase = 'idle' | 'requesting' | 'countdown' | 'recording' | 'processing'
const MIME_TYPES = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus']

export function useVoiceRecording(onRecorded: (file: File, duration: number) => void) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [countdown, setCountdown] = useState(3)
  const [levels, setLevels] = useState<number[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState('')
  const session = useRef(0)
  const active = useRef(false)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const contextRef = useRef<AudioContext | null>(null)
  const timerRef = useRef<number | null>(null)
  const emit = useLatestCallback(onRecorded)
  const supported = typeof navigator.mediaDevices?.getUserMedia === 'function' && typeof MediaRecorder !== 'undefined'

  const release = () => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current)
    timerRef.current = null
    streamRef.current?.getTracks().forEach((track) => {
      track.onended = null
      track.stop()
    })
    streamRef.current = null
    if (contextRef.current) void contextRef.current.close().catch(() => undefined)
    contextRef.current = null
  }
  const dispose = () => {
    session.current++
    active.current = false
    const recorder = recorderRef.current
    recorderRef.current = null
    if (recorder) {
      recorder.onstop = null
      recorder.ondataavailable = null
      recorder.onerror = null
      if (recorder.state !== 'inactive') recorder.stop()
    }
    release()
  }
  const cancel = () => {
    dispose()
    setPhase('idle')
    setLevels([])
  }
  const stop = () => {
    const recorder = recorderRef.current
    if (recorder?.state === 'recording') {
      setPhase('processing')
      recorder.stop()
      release()
    }
  }
  const interrupt = useLatestCallback(() => {
    if (!active.current) return
    setNotice('录音已中断，请试听已有片段；不足 10 秒请重新录制。')
    if (recorderRef.current?.state === 'recording') stop()
    else if (!recorderRef.current || recorderRef.current.state === 'inactive') cancel()
  })
  useEffect(() => {
    const hidden = () => {
      if (document.hidden) interrupt()
    }
    document.addEventListener('visibilitychange', hidden)
    window.addEventListener('pagehide', interrupt)
    return () => {
      document.removeEventListener('visibilitychange', hidden)
      window.removeEventListener('pagehide', interrupt)
      dispose()
    }
    // 本 effect 只安装资源清理；可变回调通过 useLatestCallback 读取。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interrupt])

  const start = async () => {
    if (active.current) return
    if (!supported || !window.isSecureContext) {
      setError('当前环境不支持录音，请使用 HTTPS 页面及支持录音的浏览器，或上传音频。')
      return
    }
    dispose()
    const id = session.current
    active.current = true
    setPhase('requesting')
    setError('')
    setNotice('')
    setElapsed(0)
    setLevels([])
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          channelCount: { ideal: 1 },
          autoGainControl: false,
        },
        video: false,
      })
      if (session.current !== id) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      streamRef.current = stream
      void navigator.mediaDevices
        .enumerateDevices?.()
        .then((all) => {
          if (session.current === id) setDevices(all.filter((device) => device.kind === 'audioinput'))
        })
        .catch(() => undefined)
      document.querySelectorAll('audio, video').forEach((media) => (media as HTMLMediaElement).pause())
      stream.getTracks().forEach((track) => {
        track.onended = () => interrupt()
      })
      const mimeType = MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type))
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      recorderRef.current = recorder
      const chunks: Blob[] = []
      recorder.ondataavailable = (event) => {
        if (session.current === id && event.data.size) chunks.push(event.data)
      }
      recorder.onerror = () => {
        if (session.current === id) {
          cancel()
          setError('录音中断，请检查麦克风后重试。')
        }
      }
      recorder.onstop = async () => {
        if (session.current !== id) return
        release()
        setPhase('processing')
        try {
          const blob = new Blob(chunks, { type: recorder.mimeType })
          if (!blob.size) throw new Error('没有录到声音，请检查麦克风后重试。')
          const buffer = await new OfflineAudioContext(1, 1, 24000).decodeAudioData(await blob.arrayBuffer())
          if (session.current !== id) return
          if (!hasAudibleVoice(buffer)) throw new Error('录音基本无声或音量过低，请靠近麦克风后重录。')
          if (buffer.duration > MAX_RECORDING_SECONDS + 2) throw new Error('录音超出 60 秒，请重新录制。')
          emit(new File([encodeVoiceWav(buffer)], '现场录音.wav', { type: 'audio/wav' }), buffer.duration)
        } catch (failure) {
          if (session.current === id) setError(recordingPermissionError(failure))
        } finally {
          if (session.current === id) {
            active.current = false
            recorderRef.current = null
            setPhase('idle')
            setLevels([])
          }
        }
      }
      let analyser: AnalyserNode | undefined
      try {
        const context = new AudioContext()
        contextRef.current = context
        void context.resume().catch(() => undefined)
        if (session.current !== id) return
        analyser = context.createAnalyser()
        analyser.fftSize = 256
        context.createMediaStreamSource(stream).connect(analyser)
      } catch {
        /* 音量显示不可用时仍允许录制，最终以解码数据检查静音。 */
      }
      if (session.current !== id) return
      setCountdown(3)
      setPhase('countdown')
      const readyAt = performance.now() + 3000
      let startedAt = 0
      timerRef.current = window.setInterval(() => {
        if (session.current !== id) return
        const now = performance.now()
        if (!startedAt) {
          setCountdown(Math.max(1, Math.ceil((readyAt - now) / 1000)))
          if (now < readyAt) return
          try {
            recorder.start(250)
          } catch (failure) {
            cancel()
            setError(recordingPermissionError(failure))
            return
          }
          startedAt = now
          setPhase('recording')
        }
        const seconds = (now - startedAt) / 1000
        setElapsed(seconds)
        if (analyser) {
          const data = new Uint8Array(analyser.fftSize)
          analyser.getByteTimeDomainData(data)
          const level = Math.max(...data.map((value) => Math.abs(value - 128))) / 128
          setLevels((previous) => [...previous.slice(-27), level])
        }
        if (seconds >= MAX_RECORDING_SECONDS) {
          setNotice('已达到 60 秒上限，录音已结束，请试听。')
          stop()
        }
      }, 100)
    } catch (failure) {
      if (session.current === id) {
        cancel()
        setError(recordingPermissionError(failure))
      }
    }
  }
  return {
    phase,
    elapsed,
    countdown,
    levels,
    error,
    notice,
    devices,
    deviceId,
    setDeviceId,
    supported,
    start,
    stop,
    cancel,
  }
}
