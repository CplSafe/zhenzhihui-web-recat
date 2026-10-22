import { useEffect, useId, useState, type ReactElement } from 'react'
import { useVoiceRecording } from '@/composables/useVoiceRecording'
import { voiceDurationError } from '@/utils/voiceRecording'
import styles from './CanvasVoiceLibrary.module.css'

const referenceScripts = {
  zh: '今天天气真好，我带着家人去公园散步。孩子们在草地上奔跑，小鸟在树上唱歌，花儿飘着清香，小狗摇着尾巴跑来跑去。我们说说笑笑，吃着点心和水果，享受着这美好的一天。',
  en: 'The sun is shining, the birds are singing, and now everything feels fresh and new. I walk through the park with my family, watching the children play and the dogs run happily on the green grass. We share a picnic, laugh together, and enjoy this beautiful day.',
}

interface Props {
  disabled: boolean
  onRecorded: (file: File, duration: number) => void
  onActiveChange: (active: boolean) => void
  onDraftChange: (draft: boolean) => void
}

export default function VoiceRecorder({ disabled, onRecorded, onActiveChange, onDraftChange }: Props): ReactElement {
  const [draft, setDraft] = useState<{ file: File; duration: number } | null>(null)
  const [url, setUrl] = useState('')
  const [referenceLanguage, setReferenceLanguage] = useState<'zh' | 'en'>('zh')
  const hintId = useId()
  const recording = useVoiceRecording((file, duration) => setDraft({ file, duration }))
  const active = recording.phase !== 'idle'
  useEffect(() => {
    onActiveChange(active)
    return () => onActiveChange(false)
  }, [active, onActiveChange])
  useEffect(() => {
    onDraftChange(Boolean(draft))
    return () => onDraftChange(false)
  }, [draft, onDraftChange])
  useEffect(() => {
    if (!draft) {
      setUrl('')
      return
    }
    const next = URL.createObjectURL(draft.file)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [draft])
  const tooShort = draft ? voiceDurationError(draft.duration, false) : ''
  return (
    <section className={styles.recorder} aria-label="现场录音" aria-describedby={hintId}>
      <h3>现场录音</h3>
      <p id={hintId}>建议 20～30 秒 · 至少 10 秒 · 最长 60 秒</p>
      <div className={styles.recordingReference}>
        <label>
          参考文案语言
          <select
            value={referenceLanguage}
            onChange={(event) => setReferenceLanguage(event.target.value as 'zh' | 'en')}
          >
            <option value="zh">中文</option>
            <option value="en">English</option>
          </select>
        </label>
        <strong className={styles.referenceTitle}>朗读参考文案</strong>
        <p
          className={styles.referenceText}
          lang={referenceLanguage === 'zh' ? 'zh-CN' : 'en'}
          aria-label="录音参考文案"
        >
          {referenceScripts[referenceLanguage]}
        </p>
      </div>
      <p>安静环境、单人自然朗读；开始录音会暂停其他音视频。</p>
      {recording.devices.length > 1 && (
        <label>
          麦克风
          <select
            value={recording.deviceId}
            disabled={disabled || active}
            onChange={(event) => recording.setDeviceId(event.target.value)}
          >
            <option value="">系统默认麦克风</option>
            {recording.devices
              .filter((device) => device.deviceId && device.deviceId !== 'default')
              .map((device, index) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `麦克风 ${index + 1}`}
                </option>
              ))}
          </select>
        </label>
      )}
      {recording.phase === 'requesting' && <p role="status">等待麦克风授权，请在浏览器提示中允许使用麦克风。</p>}
      {recording.phase === 'countdown' && <p role="status">准备录音，{recording.countdown} 秒后开始…</p>}
      {recording.phase === 'recording' && (
        <>
          <div className={styles.recordingMeter} aria-hidden="true">
            {Array.from({ length: 28 }, (_, index) => (
              <span key={index} style={{ height: `${Math.max(2, (recording.levels[index] || 0) * 36)}px` }} />
            ))}
          </div>
          <progress className={styles.recordingProgress} value={recording.elapsed} max={60} aria-label="录音时长进度" />
          <p role="status" className={styles.recordingStatus}>
            正在录音 {Math.floor(recording.elapsed)} 秒 / 60 秒
            {recording.elapsed < 10 ? '，至少录制 10 秒' : '，已达到最低时长'}
          </p>
        </>
      )}
      {recording.phase === 'processing' && <p role="status">正在处理录音，请稍候…</p>}
      <div className={styles.actions}>
        {!active && (
          <button
            type="button"
            disabled={disabled || !recording.supported}
            onClick={() => {
              setDraft(null)
              void recording.start()
            }}
          >
            {draft ? '重新录音' : '开始录音'}
          </button>
        )}
        {recording.phase === 'recording' && (
          <button type="button" onClick={recording.stop}>
            结束录音
          </button>
        )}
        {active && (
          <button type="button" onClick={recording.cancel}>
            取消录音
          </button>
        )}
        {draft && !active && (
          <button type="button" disabled={disabled} onClick={() => setDraft(null)}>
            丢弃录音
          </button>
        )}
      </div>
      {!recording.supported && <p role="status">当前浏览器不支持现场录音，请使用下方的上传音频功能。</p>}
      {recording.error && (
        <p role="alert" className={styles.error}>
          {recording.error}
        </p>
      )}
      {recording.notice && <p role="status">{recording.notice}</p>}
      {draft && url && !active && (
        <>
          <audio controls src={url} aria-label="试听现场录音" />
          <p>录音时长：{draft.duration.toFixed(1)} 秒</p>
          {tooShort && (
            <p role="alert" className={styles.error}>
              {tooShort}
            </p>
          )}
          <div className={styles.actions}>
            <button
              type="button"
              disabled={disabled || Boolean(tooShort)}
              onClick={() => {
                onRecorded(draft.file, draft.duration)
                setDraft(null)
              }}
            >
              使用这段录音
            </button>
          </div>
        </>
      )}
    </section>
  )
}
