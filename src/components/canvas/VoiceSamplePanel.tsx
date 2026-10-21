import { useEffect, useRef, useState } from 'react'
import { assetStreamUrl } from '@/utils/assetUrl'
import { decodeVoiceVideo, validateVoiceSampleRange, voiceSampleWav } from '@/utils/voiceSample'
import { readVoiceLibrary, removeVoiceSample, renameVoiceSample, saveVoiceSample } from '@/utils/voiceLibrary'
import styles from './VoiceSamplePanel.module.css'

export default function VoiceSamplePanel({
  userId,
  workspaceId,
  disabled,
  onUpload,
  onReference,
  onClose,
}: {
  userId: string
  workspaceId: number
  disabled: boolean
  onUpload: (file: File) => Promise<boolean>
  onReference: (assetId: number, title: string) => Promise<boolean>
  onClose: () => void
}) {
  const [entries, setEntries] = useState(() => readVoiceLibrary(userId, workspaceId))
  const [search, setSearch] = useState('')
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null)
  const [title, setTitle] = useState('声音样本')
  const [start, setStart] = useState(0)
  const [end, setEnd] = useState(5)
  const [authorized, setAuthorized] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState('')
  const controller = useRef<AbortController | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      controller.current?.abort()
    }
  }, [])
  const rangeError = buffer ? validateVoiceSampleRange(buffer.duration, start, end) : ''
  useEffect(() => {
    setPreview('')
    if (!buffer || rangeError) return
    const url = URL.createObjectURL(voiceSampleWav(buffer, start, end))
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [buffer, start, end, rangeError])
  const load = async (file?: File) => {
    if (!file || busy || disabled) return
    controller.current?.abort()
    const abort = new AbortController()
    controller.current = abort
    setBusy(true)
    setBuffer(null)
    setError('')
    setAuthorized(false)
    try {
      const next = await decodeVoiceVideo(file, abort.signal)
      if (abort.signal.aborted) return
      setBuffer(next)
      setStart(0)
      setEnd(Math.min(30, next.duration))
      setTitle(file.name.replace(/\.[^.]+$/, '').slice(0, 60))
    } catch (e: any) {
      if (!abort.signal.aborted) setError(e?.message || '提取失败')
    } finally {
      if (!abort.signal.aborted) setBusy(false)
    }
  }
  const referenceEntry = async (assetId: number, name: string) => {
    setBusy(true)
    setError('')
    try {
      if ((await onReference(assetId, name)) && alive.current) {
        saveVoiceSample(userId, workspaceId, assetId, name)
        if (alive.current) setEntries(readVoiceLibrary(userId, workspaceId))
      }
    } catch (e: any) {
      if (alive.current) setError(e?.message || '引用失败')
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  return (
    <section className={`${styles.panel} nodrag nopan`} aria-label="本机声音样本库">
      <header>
        <strong>本机声音样本库</strong>
        <button type="button" onClick={onClose} disabled={busy}>
          收起
        </button>
      </header>
      <p>仅当前账号、当前空间在本浏览器可见。保存的是声音参考，不是训练后的音色；移除收藏不会删除源素材。</p>
      <label>
        从视频提取声音
        <input
          type="file"
          accept=".mp4,.mov,.m4v,video/mp4,video/quicktime"
          aria-label="上传视频提取声音"
          disabled={busy || disabled}
          onChange={(e) => {
            void load(e.target.files?.[0])
            e.target.value = ''
          }}
        />
      </label>
      <p>支持 100MB、5 分钟内普通 MP4/MOV，选择 5～30 秒清晰单人声；不支持的编码需转换或直接上传音频。</p>
      {busy && <p role="status">正在处理声音样本…</p>}
      {buffer && (
        <div className={styles.selection}>
          <label>
            样本名称
            <input
              aria-label="样本名称"
              maxLength={60}
              value={title}
              disabled={busy || disabled}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            起点（秒）
            <input
              aria-label="样本起点"
              type="number"
              min={0}
              max={buffer.duration}
              step="0.1"
              value={start}
              disabled={busy || disabled}
              onChange={(e) => setStart(Number(e.target.value))}
            />
          </label>
          <label>
            终点（秒）
            <input
              aria-label="样本终点"
              type="number"
              min={0}
              max={buffer.duration}
              step="0.1"
              value={end}
              disabled={busy || disabled}
              onChange={(e) => setEnd(Number(e.target.value))}
            />
          </label>
          <p>
            音轨共 {buffer.duration.toFixed(1)} 秒，选区 {(end - start).toFixed(1)} 秒
          </p>
          {preview && <audio controls src={preview} aria-label="试听截取声音" />}
          <label>
            <input
              type="checkbox"
              checked={authorized}
              disabled={busy || disabled}
              onChange={(e) => setAuthorized(e.target.checked)}
            />
            我确认声音属于本人或已取得使用及克隆授权
          </label>
          <button
            type="button"
            disabled={busy || disabled || !authorized || Boolean(rangeError)}
            onClick={async () => {
              setBusy(true)
              setError('')
              try {
                const file = new File([voiceSampleWav(buffer, start, end)], `${title.trim() || '声音样本'}.wav`, {
                  type: 'audio/wav',
                })
                if (await onUpload(file)) {
                  if (alive.current) {
                    setBuffer(null)
                    setEntries(readVoiceLibrary(userId, workspaceId))
                  }
                } else if (alive.current) {
                  setError('样本未上传成功，请检查模型格式限制或网络后重试；已保留当前选区')
                }
              } catch (e: any) {
                if (alive.current) setError(e?.message || '上传失败')
              } finally {
                if (alive.current) setBusy(false)
              }
            }}
          >
            提取并上传为参考音频
          </button>
        </div>
      )}
      {(error || rangeError) && <p role="alert">{error || rangeError}</p>}
      <input
        aria-label="搜索声音样本"
        placeholder="搜索声音样本"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {!entries.length && <p>暂无收藏。在参考音频旁点击“收藏样本”，或从视频提取。</p>}
      {entries
        .filter((entry) => entry.title.toLowerCase().includes(search.toLowerCase()))
        .map((entry) => (
          <div key={entry.assetId} className={styles.entry}>
            <input
              aria-label={`重命名样本 ${entry.assetId}`}
              defaultValue={entry.title}
              maxLength={60}
              disabled={busy || disabled}
              onBlur={(e) => {
                if (e.target.value.trim() === entry.title) return
                try {
                  renameVoiceSample(userId, workspaceId, entry.assetId, e.target.value)
                  setEntries(readVoiceLibrary(userId, workspaceId))
                } catch {
                  setError('本机存储失败，请检查浏览器存储权限')
                }
              }}
            />
            <audio
              controls
              preload="none"
              src={assetStreamUrl(entry.assetId, workspaceId)}
              aria-label={`试听样本 ${entry.title}`}
            />
            <button
              type="button"
              disabled={busy || disabled}
              onClick={() => void referenceEntry(entry.assetId, entry.title)}
            >
              引用
            </button>
            <button
              type="button"
              disabled={busy || disabled}
              onClick={() => {
                try {
                  removeVoiceSample(userId, workspaceId, entry.assetId)
                  setEntries(readVoiceLibrary(userId, workspaceId))
                } catch {
                  setError('本机存储失败，请检查浏览器存储权限')
                }
              }}
            >
              移除收藏
            </button>
          </div>
        ))}
    </section>
  )
}
