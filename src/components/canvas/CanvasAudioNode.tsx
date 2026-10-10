import { useEffect, useRef, useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import { uploadAssetFile } from '@/api/business'
import { assetStreamUrl } from '@/utils/assetUrl'
import { audioGainAt, isAudioFile, normalizeAudioSettings, readAudioDuration } from '@/utils/canvasAudio'
import { useToast } from '@/composables/useToast'
import styles from './CanvasAudioNode.module.css'
import CanvasAudioGenerator from './CanvasAudioGenerator'

export default function CanvasAudioNode({
  nodeId,
  data,
  workspaceId,
  src,
}: {
  nodeId: string
  data: Record<string, any>
  workspaceId: number
  src: string
}) {
  const { updateNodeData } = useReactFlow()
  const { showToast } = useToast()
  const settings = normalizeAudioSettings(data.audio)
  const [busy, setBusy] = useState(false)
  const player = useRef<HTMLAudioElement>(null)
  const active = useRef(0)
  useEffect(() => {
    active.current += 1
    setBusy(false)
    return () => {
      active.current += 1
    }
  }, [workspaceId, nodeId])
  const change = (patch: Record<string, unknown>) =>
    updateNodeData(nodeId, { audio: normalizeAudioSettings({ ...settings, ...patch }) })
  const upload = async (file?: File) => {
    if (!file || busy) return
    if (!isAudioFile(file) || file.size > 100 * 1024 * 1024) {
      showToast('请选择 100MB 以内的 MP3、WAV、M4A 或 AAC 音频', 'error')
      return
    }
    setBusy(true)
    const request = ++active.current
    const local = URL.createObjectURL(file)
    try {
      const durationSec = await readAudioDuration(local)
      if (request !== active.current) return
      const result: any = await uploadAssetFile({ workspaceId, file })
      if (request !== active.current) return
      const assetId = Number(result?.asset?.id || 0)
      if (!assetId) throw new Error('上传未返回素材 ID')
      updateNodeData(nodeId, {
        title: file.name,
        assetId,
        assetWorkspaceId: workspaceId,
        assetSource: 'upload',
        taskId: 0,
        taskStatus: '',
        resultUrl: assetStreamUrl(assetId, workspaceId),
        audio: normalizeAudioSettings({ ...settings, durationSec, inSec: 0, outSec: durationSec, origin: 'upload' }),
      })
    } catch (e: any) {
      if (request === active.current) showToast(e?.message || '音频上传失败', 'error')
    } finally {
      URL.revokeObjectURL(local)
      if (request === active.current) setBusy(false)
    }
  }
  return (
    <div className={`${styles.node} nodrag nopan nowheel`}>
      <div className={styles.header}>
        <span>♫ 音频</span>
        <span>{settings.durationSec > 0 ? `${settings.durationSec.toFixed(1)} 秒` : '上传音频开始创作'}</span>
      </div>
      {src && (
        <audio
          key={src}
          ref={player}
          src={src}
          controls
          preload="metadata"
          onLoadedMetadata={(e) => {
            if (!settings.durationSec)
              change({ durationSec: e.currentTarget.duration, outSec: e.currentTarget.duration })
          }}
          onPlay={(e) => {
            e.currentTarget.volume = settings.volume
            if (e.currentTarget.currentTime < settings.inSec || e.currentTarget.currentTime >= settings.outSec)
              e.currentTarget.currentTime = settings.inSec
          }}
          onTimeUpdate={(e) => {
            const elapsed = e.currentTarget.currentTime - settings.inSec
            e.currentTarget.volume = audioGainAt(
              { ...settings, loop: false },
              elapsed,
              settings.outSec - settings.inSec,
            )
            if (e.currentTarget.currentTime >= settings.outSec && settings.outSec > 0) e.currentTarget.pause()
          }}
        />
      )}
      <label className={styles.upload}>
        {busy ? '正在上传…' : src ? '替换音频' : '上传 MP3 / WAV / M4A / AAC'}
        <input
          type="file"
          accept="audio/*,.mp3,.wav,.m4a,.aac"
          disabled={busy}
          onChange={(e) => {
            void upload(e.target.files?.[0])
            e.target.value = ''
          }}
        />
      </label>
      <label>
        用途
        <select
          value={settings.lane}
          onChange={(e) => change({ lane: e.target.value, loop: e.target.value === 'bgm' })}
        >
          <option value="voice">人声 / 配音</option>
          <option value="bgm">背景音乐</option>
          <option value="sfx">音效</option>
        </select>
      </label>
      <CanvasAudioGenerator nodeId={nodeId} data={data} workspaceId={workspaceId} />
      {src && (
        <>
          <div className={styles.pair}>
            {(['inSec', 'outSec'] as const).map((key) => (
              <label key={key}>
                {key === 'inSec' ? '裁剪起点' : '裁剪终点'}
                <input
                  type="number"
                  min="0"
                  max={settings.durationSec}
                  step="0.1"
                  value={settings[key]}
                  onChange={(e) => change({ [key]: Number(e.target.value) })}
                />
              </label>
            ))}
          </div>
          <label>
            音量 {Math.round(settings.volume * 100)}%
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={settings.volume}
              onChange={(e) => {
                const volume = Number(e.target.value)
                change({ volume })
                if (player.current) player.current.volume = volume
              }}
            />
          </label>
          <div className={styles.pair}>
            {(['fadeInSec', 'fadeOutSec'] as const).map((key) => (
              <label key={key}>
                {key === 'fadeInSec' ? '淡入（秒）' : '淡出（秒）'}
                <input
                  type="number"
                  min="0"
                  max={settings.outSec - settings.inSec}
                  step="0.1"
                  value={settings[key]}
                  onChange={(e) => change({ [key]: Number(e.target.value) })}
                />
              </label>
            ))}
          </div>
          <small>
            {settings.origin === 'generated'
              ? 'AI 生成音频 · AIGC'
              : settings.origin === 'licensed'
                ? '已声明授权素材'
                : '上传音频 · 商用前请确认授权'}
          </small>
          <a href={assetStreamUrl(Number(data.assetId), workspaceId)} download>
            下载音频
          </a>
        </>
      )}
    </div>
  )
}
