import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useReactFlow } from '@xyflow/react'
import { uploadAssetFile } from '@/api/business'
import { assetStreamUrl } from '@/utils/assetUrl'
import { audioGainAt, isAudioFile, normalizeAudioSettings, readAudioDuration } from '@/utils/canvasAudio'
import { useToast } from '@/composables/useToast'
import styles from './CanvasAudioNode.module.css'
import CanvasAudioGenerator from './CanvasAudioGenerator'
import { loadAudioWaveform } from '@/utils/audioWaveform'

function formatAudioTime(value: number): string {
  const seconds = Math.max(0, Number.isFinite(value) ? Math.floor(value) : 0)
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

export default function CanvasAudioNode({
  nodeId,
  data,
  workspaceId,
  src,
  selected,
  onGenerated,
}: {
  nodeId: string
  data: Record<string, any>
  workspaceId: number
  src: string
  selected: boolean
  onGenerated?: (nodeId: string, assetId: number, durationSec: number) => void
}) {
  const isEditor = data.audioRole === 'editor'
  const { updateNodeData } = useReactFlow()
  const { showToast } = useToast()
  const settings = normalizeAudioSettings(data.audio)
  const [busy, setBusy] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [mediaDuration, setMediaDuration] = useState(0)
  const [peaks, setPeaks] = useState<number[]>([])
  const [waveformStatus, setWaveformStatus] = useState('')
  const [waveformVisible, setWaveformVisible] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [savingEdited, setSavingEdited] = useState(false)
  const [volumeDraft, setVolumeDraft] = useState<number | null>(null)
  const [panelPlacement, setPanelPlacement] = useState<'below' | 'right' | 'left' | 'above'>('below')
  const volumeDraftRef = useRef<number | null>(null)
  const nodeElement = useRef<HTMLDivElement>(null)
  const panelElement = useRef<HTMLElement>(null)
  const player = useRef<HTMLAudioElement>(null)
  const active = useRef(0)
  useLayoutEffect(() => {
    if (!selected) return
    const node = nodeElement.current
    const panel = panelElement.current
    const flowNode = node?.closest('.react-flow__node')
    const flow = node?.closest('.react-flow')
    if (!node || !panel || !flowNode || !flow) return

    let frame = 0
    const placePanel = () => {
      frame = 0
      const anchor = node.getBoundingClientRect()
      const { width, height } = panel.getBoundingClientRect()
      if (!width || !height) return
      const zoom = anchor.width / (node.offsetWidth || anchor.width)
      const gap = 12 * zoom
      const siblings = Array.from(flow.querySelectorAll<HTMLElement>('.react-flow__node'))
        .filter((item) => item !== flowNode)
        .map((item) => item.getBoundingClientRect())
      const viewport = flow.getBoundingClientRect()
      const overlap = (a: DOMRect, b: DOMRect) =>
        Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
        Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
      const candidates = [
        { placement: 'below' as const, x: anchor.left + (anchor.width - width) / 2, y: anchor.bottom + gap },
        { placement: 'right' as const, x: anchor.right + gap, y: anchor.top },
        { placement: 'left' as const, x: anchor.left - width - gap, y: anchor.top },
        { placement: 'above' as const, x: anchor.left + (anchor.width - width) / 2, y: anchor.top - height - gap },
      ]
      const ranked = candidates.map((candidate, index) => {
        const rect = new DOMRect(candidate.x, candidate.y, width, height)
        const visible = overlap(rect, viewport)
        const clipped = width * height - visible
        const coveredNodes = siblings.reduce((sum, sibling) => sum + overlap(rect, sibling), 0)
        return { placement: candidate.placement, score: coveredNodes * 10 + clipped * 3 + index }
      })
      ranked.sort((a, b) => a.score - b.score)
      setPanelPlacement((current) => (current === ranked[0].placement ? current : ranked[0].placement))
    }
    const schedulePlacement = () => {
      if (frame) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(placePanel)
    }
    schedulePlacement()
    const observer = new ResizeObserver(schedulePlacement)
    observer.observe(node)
    observer.observe(panel)
    flow.addEventListener('pointerup', schedulePlacement)
    window.addEventListener('resize', schedulePlacement)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      observer.disconnect()
      flow.removeEventListener('pointerup', schedulePlacement)
      window.removeEventListener('resize', schedulePlacement)
    }
  }, [selected, isEditor])
  useEffect(() => {
    if (selected) setWaveformVisible(true)
  }, [selected])
  useEffect(() => {
    if (waveformVisible) return
    const element = nodeElement.current
    if (!element || typeof IntersectionObserver === 'undefined') {
      setWaveformVisible(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setWaveformVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '300px' },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [waveformVisible])
  useEffect(() => {
    const abort = new AbortController()
    setPeaks([])
    setPlaying(false)
    setCurrentTime(0)
    setMediaDuration(0)
    setWaveformStatus(src ? (waveformVisible ? '波形加载中' : '') : '上传音频或生成配音')
    if (src && waveformVisible)
      void loadAudioWaveform(src, abort.signal)
        .then((values) => {
          if (!abort.signal.aborted) {
            setPeaks(values)
            setWaveformStatus('')
          }
        })
        .catch(() => {
          if (!abort.signal.aborted) setWaveformStatus('波形暂不可用，可继续播放')
        })
    return () => abort.abort()
  }, [src, waveformVisible])
  useEffect(() => {
    active.current += 1
    setBusy(false)
    return () => {
      active.current += 1
    }
  }, [workspaceId, nodeId])
  const change = (patch: Record<string, unknown>) =>
    updateNodeData(nodeId, { audio: normalizeAudioSettings({ ...settings, ...patch }) })
  const commitVolume = () => {
    const volume = volumeDraftRef.current
    if (volume === null) return
    volumeDraftRef.current = null
    setVolumeDraft(null)
    if (volume !== settings.volume) change({ volume })
  }
  const displayedVolume = volumeDraft ?? settings.volume
  const playbackStart = Math.max(0, settings.inSec)
  const playbackEnd = Math.max(playbackStart, settings.outSec || mediaDuration || settings.durationSec)
  const fullDuration = Math.max(mediaDuration, settings.durationSec, playbackEnd)
  const visibleDuration = Math.max(0, playbackEnd - playbackStart)
  const elapsed = Math.min(visibleDuration, Math.max(0, currentTime - playbackStart))
  const progress = visibleDuration > 0 ? elapsed / visibleDuration : 0
  const activeBars = useMemo(() => Math.round(progress * peaks.length), [progress, peaks.length])
  const isGenerating = ['processing', 'pending', 'queued', 'running', 'result_pending'].includes(
    String(data.taskStatus || ''),
  )
  const exportEdited = async (saveToAssets = false) => {
    if (exporting || !(Number(data.assetId) > 0) || visibleDuration <= 0) return
    setExporting(true)
    if (saveToAssets) setSavingEdited(true)
    try {
      const { renderAudioMix, audioBufferToWav } = await import('@/utils/audioMix')
      const buffer = await renderAudioMix(
        [
          {
            ...settings,
            sourceNodeId: nodeId,
            assetId: Number(data.assetId),
            title: String(data.title || '音频'),
            startSec: 0,
            loop: false,
          },
        ],
        visibleDuration,
        Number(data.assetWorkspaceId || workspaceId),
      )
      const blob = audioBufferToWav(buffer)
      const name = `${String(data.title || '音频').replace(/\.[^.]+$/, '')}-裁剪.wav`
      if (saveToAssets) {
        const file = new File([blob], name, { type: 'audio/wav' })
        const result: any = await uploadAssetFile({ workspaceId, file, source: 'canvas-audio-edit' })
        const assetId = Number(result?.asset?.id || 0)
        if (!assetId) throw new Error('保存音频未返回素材 ID')
        updateNodeData(nodeId, {
          assetId,
          title: name,
          resultUrl: assetStreamUrl(assetId, workspaceId),
          assetWorkspaceId: workspaceId,
          audio: normalizeAudioSettings({
            ...settings,
            durationSec: visibleDuration,
            inSec: 0,
            outSec: visibleDuration,
            volume: 1,
            fadeInSec: 0,
            fadeOutSec: 0,
          }),
        })
        showToast('裁剪音频已保存为新素材，下游会使用这个版本', 'success')
        return
      }
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = name
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error: any) {
      showToast(error?.message || '音频导出失败', 'error')
    } finally {
      setExporting(false)
      setSavingEdited(false)
    }
  }
  const togglePlayback = async () => {
    const audio = player.current
    if (!audio || !src) return
    if (!audio.paused) {
      audio.pause()
      return
    }
    if (audio.currentTime < playbackStart || (playbackEnd > 0 && audio.currentTime >= playbackEnd)) {
      audio.currentTime = playbackStart
      setCurrentTime(playbackStart)
    }
    try {
      await audio.play()
    } catch {
      showToast('音频暂时无法播放，请重新上传或稍后重试', 'error')
    }
  }
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
    <div ref={nodeElement} className={`${styles.node} nopan nowheel`}>
      {!src ? (
        <div className={styles.emptyCard}>
          <span className={styles.emptyIcon} aria-hidden="true">
            ♫
          </span>
          <div className={styles.emptyCopy}>
            <strong>{isEditor ? '编辑音频' : isGenerating ? '音频生成中' : '创建音频'}</strong>
            <span>
              {isEditor ? '等待源音频' : isGenerating ? '生成完成后在这里试听' : '输入描述，选择模型生成声音'}
            </span>
          </div>
          <span className={styles.emptyArrow} aria-hidden="true">
            ↗
          </span>
        </div>
      ) : (
        <div className={styles.playerCard}>
          <button
            className={`${styles.playButton} nodrag`}
            type="button"
            onClick={() => void togglePlayback()}
            disabled={!src}
            aria-label={playing ? '暂停音频' : '播放音频'}
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <div className={styles.waveArea}>
            <div className={styles.waveform} aria-hidden="true">
              {peaks.map((height, index) => (
                <i
                  key={index}
                  className={index < activeBars ? styles.waveActive : ''}
                  style={{ height: `${Math.max(4, height * 100)}%` }}
                />
              ))}
              {waveformStatus && <span className={styles.waveHint}>{waveformStatus}</span>}
            </div>
            {src && selected && fullDuration > 0 && (
              <div className={styles.trimOverlay} aria-hidden="true">
                <span style={{ width: `${(playbackStart / fullDuration) * 100}%` }} />
                <span style={{ width: `${Math.max(0, (fullDuration - playbackEnd) / fullDuration) * 100}%` }} />
              </div>
            )}
            <input
              className={`${styles.progress} nodrag`}
              type="range"
              aria-label="音频播放进度"
              min={playbackStart}
              max={playbackEnd || 1}
              step="0.01"
              value={src ? Math.max(playbackStart, Math.min(playbackEnd, currentTime)) : 0}
              disabled={!src}
              onKeyDown={(event) => {
                if (!src) return
                const key = event.key.toLowerCase()
                if (key === 'i' || key === 'o') {
                  event.preventDefault()
                  event.stopPropagation()
                  change({ [key === 'i' ? 'inSec' : 'outSec']: currentTime })
                } else if (key === 'arrowup' || key === 'arrowdown') {
                  event.preventDefault()
                  event.stopPropagation()
                  const value = Math.max(
                    playbackStart,
                    Math.min(playbackEnd, currentTime + (key === 'arrowup' ? 1 : -1) * (event.shiftKey ? 0.01 : 0.1)),
                  )
                  setCurrentTime(value)
                  if (player.current) player.current.currentTime = value
                }
              }}
              onChange={(e) => {
                const value = Number(e.target.value)
                setCurrentTime(value)
                if (player.current) player.current.currentTime = value
              }}
            />
            <div className={styles.timeRow}>
              <span>{formatAudioTime(elapsed)}</span>
              <span>/ {formatAudioTime(visibleDuration)}</span>
              {src && selected && (
                <span className={styles.trimReadout}>
                  选区 {playbackStart.toFixed(1)}–{playbackEnd.toFixed(1)} 秒
                </span>
              )}
            </div>
          </div>
          {src && (
            <audio
              key={src}
              ref={player}
              src={src}
              preload="metadata"
              onLoadedMetadata={(e) => {
                const duration = Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0
                setMediaDuration(duration)
                setCurrentTime(settings.inSec)
                if (!settings.durationSec) change({ durationSec: duration, outSec: duration })
              }}
              onPlay={(e) => {
                setPlaying(true)
                e.currentTarget.volume = settings.volume
                if (e.currentTarget.currentTime < settings.inSec || e.currentTarget.currentTime >= playbackEnd)
                  e.currentTarget.currentTime = settings.inSec
              }}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
              onTimeUpdate={(e) => {
                setCurrentTime(e.currentTarget.currentTime)
                const played = e.currentTarget.currentTime - settings.inSec
                e.currentTarget.volume = audioGainAt({ ...settings, loop: false }, played, playbackEnd - settings.inSec)
                if (e.currentTarget.currentTime >= playbackEnd && playbackEnd > 0) e.currentTarget.pause()
              }}
            />
          )}
        </div>
      )}
      <section
        ref={panelElement}
        className={`${styles.settings} canvas-audio-panel nodrag nopan nowheel ${isEditor ? styles.editorPanel : ''}`}
        hidden={!selected}
        data-placement={panelPlacement}
        aria-label={isEditor ? '音频编辑' : '音频参数'}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <div className={styles.panelHeader}>
          <span className={styles.panelIcon} aria-hidden="true">
            ♫
          </span>
          <div>
            <strong>{isEditor ? '编辑音频' : src ? '调整音频' : '创建音频'}</strong>
            <p>
              {isEditor
                ? '裁剪、调节音量与淡入淡出，完成后可连接视频或导出'
                : '描述你想要的声音，生成后可直接在画布中试听和连接'}
            </p>
          </div>
        </div>
        {!isEditor &&
          Array.isArray(data.resultHistory) &&
          data.resultHistory.some((entry: any) => entry.kind === 'audio') && (
            <details className="canvas-audio-history">
              <summary>生成历史</summary>
              <select
                aria-label="音频生成历史"
                disabled={['processing', 'pending', 'queued', 'running', 'result_pending'].includes(data.taskStatus)}
                value={String(data.assetId || '')}
                onChange={(event) => {
                  const assetId = Number(event.target.value)
                  if (!(assetId > 0)) return
                  updateNodeData(nodeId, {
                    assetId,
                    resultUrl: assetStreamUrl(assetId, workspaceId),
                    assetWorkspaceId: workspaceId,
                    assetSource: 'generated',
                    audio: normalizeAudioSettings({
                      ...settings,
                      durationSec: 0,
                      inSec: 0,
                      outSec: 0,
                      origin: 'generated',
                    }),
                  })
                }}
              >
                <option value="">选择历史版本</option>
                {[...data.resultHistory]
                  .filter((entry: any) => entry.kind === 'audio')
                  .reverse()
                  .map((entry: any, index: number) => (
                    <option key={`${entry.assetId}-${entry.createdAt}-${index}`} value={String(entry.assetId)}>
                      {new Date(entry.createdAt).toLocaleString()} · {entry.prompt || '音频版本'}
                    </option>
                  ))}
              </select>
            </details>
          )}
        {!isEditor && (
          <CanvasAudioGenerator nodeId={nodeId} data={data} workspaceId={workspaceId} onGenerated={onGenerated} />
        )}
        {isEditor && src && (
          <p className={styles.routingHint}>
            下一步：连接到视频剪辑节点可将声音混入成片；连接到视频生成节点仅作为模型参考，需该模型支持音频输入。
          </p>
        )}
        {isEditor && (
          <div className={styles.editSettings}>
            <div className={styles.editorToolbar}>
              <div>
                <strong>剪辑设置</strong>
                <span>
                  当前片段 {visibleDuration.toFixed(1)} 秒 / 原音频 {fullDuration.toFixed(1)} 秒
                </span>
              </div>
              {src && (
                <button
                  type="button"
                  disabled={settings.inSec === 0 && settings.outSec === fullDuration}
                  onClick={() => change({ inSec: 0, outSec: fullDuration })}
                >
                  重置裁剪
                </button>
              )}
            </div>
            <div className={styles.settingsBody}>
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
              <label className={styles.editorField}>
                用途
                <select
                  aria-label="音频用途"
                  value={settings.lane}
                  onChange={(e) => change({ lane: e.target.value, loop: e.target.value === 'bgm' })}
                >
                  <option value="voice">人声 / 配音</option>
                  <option value="bgm">背景音乐</option>
                  <option value="sfx">音效</option>
                </select>
              </label>
              {src && (
                <>
                  <div className={styles.editorSectionTitle}>裁剪范围</div>
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
                  <div className={styles.editorSectionTitle}>声音效果</div>
                  <label className={styles.volumeControl}>
                    <span>
                      音量 <strong>{Math.round(displayedVolume * 100)}%</strong>
                    </span>
                    <input
                      aria-label="编辑音频音量"
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={displayedVolume}
                      className="nodrag nopan"
                      style={{ '--volume-fill': `${displayedVolume * 100}%` } as CSSProperties}
                      onChange={(e) => {
                        const volume = Number(e.target.value)
                        volumeDraftRef.current = volume
                        setVolumeDraft(volume)
                        if (player.current) player.current.volume = volume
                      }}
                      onPointerUp={commitVolume}
                      onPointerCancel={commitVolume}
                      onKeyUp={commitVolume}
                      onBlur={commitVolume}
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
                  <small className={styles.editorSource}>
                    {settings.origin === 'generated'
                      ? 'AI 生成音频 · AIGC'
                      : settings.origin === 'licensed'
                        ? '已声明授权素材'
                        : '上传音频 · 商用前请确认授权'}
                  </small>
                  <div className={`${styles.editorActions} canvas-audio-editor-actions`}>
                    <a href={assetStreamUrl(Number(data.assetId), workspaceId)} download>
                      下载源音频
                    </a>
                    <button
                      type="button"
                      disabled={exporting || visibleDuration <= 0}
                      onClick={() => void exportEdited(false)}
                    >
                      {exporting ? '正在导出…' : '导出裁剪与音量设置 WAV'}
                    </button>
                    <button
                      type="button"
                      disabled={exporting || visibleDuration <= 0}
                      onClick={() => void exportEdited(true)}
                    >
                      {savingEdited ? '正在保存…' : '保存为新素材并用于下游'}
                    </button>
                  </div>
                  <small className={styles.editorShortcut}>
                    聚焦波形后：I / O 设置入点、出点；↑ / ↓ 步进 0.1 秒，按住 Shift 步进 0.01 秒。
                  </small>
                </>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M7 5.6v8.8L14 10 7 5.6Z" fill="currentColor" />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M6.5 5.5h2.2v9H6.5v-9Zm4.8 0h2.2v9h-2.2v-9Z" fill="currentColor" />
    </svg>
  )
}
