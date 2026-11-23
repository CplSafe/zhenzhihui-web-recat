import { useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { Alert, Button, ConfigProvider, Modal, theme } from 'antd'
import {
  exportCanvasVideoTrim,
  loadCanvasVideoTrim,
  planCanvasVideoTrim,
  type CanvasVideoTrimResult,
  type CanvasVideoTrimSource,
} from '@/utils/canvasVideoTrim'
import { buildFilmstrip } from '@/utils/videoFilmstrip'
import CanvasPortalBoundary from './CanvasPortalBoundary'
import styles from './CanvasVideoTrimModal.module.css'

export interface CanvasVideoTrimModalProps {
  source: { url: string; title: string }
  onClose: () => void
  onSave: (file: File, result: CanvasVideoTrimResult, signal: AbortSignal) => Promise<void>
}

const formatSeconds = (seconds: number) => String(Number(seconds.toFixed(3)))
const TRIM_THUMB_RADIUS = 10
const MIN_TRIM_DURATION = 0.1
const DECIMAL_SECONDS = '[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+'
const decimalSecondsPattern = new RegExp(`^(?:${DECIMAL_SECONDS})$`)
const parseSeconds = (value: string) => (decimalSecondsPattern.test(value) ? Number(value) : NaN)

export default function CanvasVideoTrimModal({ source, onClose, onSave }: CanvasVideoTrimModalProps) {
  const headId = useId()
  const tailId = useId()
  const videoRef = useRef<HTMLVideoElement>(null)
  const headSlider = useRef<HTMLInputElement>(null)
  const tailSlider = useRef<HTMLInputElement>(null)
  const timelineDrag = useRef<{ boundary: 'head' | 'tail'; pointerId: number } | null>(null)
  const saveController = useRef<AbortController | null>(null)
  const cachedExport = useRef<{ key: string; file: File; result: CanvasVideoTrimResult } | null>(null)
  const [videoSource, setVideoSource] = useState<CanvasVideoTrimSource | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [filmstrip, setFilmstrip] = useState<string[]>([])
  const [loadError, setLoadError] = useState('')
  const [previewError, setPreviewError] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [head, setHead] = useState('0')
  const [tail, setTail] = useState('0')
  const [saving, setSaving] = useState(false)
  const [preferLossless, setPreferLossless] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    let objectUrl = ''
    loadCanvasVideoTrim(source.url, controller.signal)
      .then((loaded) => {
        if (controller.signal.aborted) return
        objectUrl = URL.createObjectURL(loaded.media)
        setVideoSource(loaded)
        setPreviewUrl(objectUrl)
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) setLoadError(error.message || '读取原视频失败，请重新打开裁剪')
      })

    return () => {
      controller.abort()
      saveController.current?.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [source.url])

  useEffect(() => {
    if (!previewUrl) return
    let active = true
    void buildFilmstrip(previewUrl, 6, { cache: false }).then((frames) => {
      if (active) setFilmstrip(frames)
    })
    return () => {
      active = false
    }
  }, [previewUrl])

  const duration = videoSource?.durationSec ?? 0
  const headSeconds = parseSeconds(head)
  const tailSeconds = parseSeconds(tail)
  const valid =
    Number.isFinite(headSeconds) &&
    Number.isFinite(tailSeconds) &&
    headSeconds >= 0 &&
    tailSeconds >= 0 &&
    duration - headSeconds - tailSeconds >= MIN_TRIM_DURATION - 1e-6
  const hasSelection = valid && (headSeconds > 0 || tailSeconds > 0)
  const plan =
    videoSource && hasSelection
      ? planCanvasVideoTrim(videoSource.track, headSeconds, duration - tailSeconds, preferLossless)
      : null
  const selectedStart = valid ? headSeconds : 0
  const selectedEnd = valid ? duration - tailSeconds : duration
  const previewStart = plan?.inSec ?? selectedStart
  const previewEnd = plan?.outSec ?? selectedEnd

  const seekPreview = (seconds: number) => {
    const player = videoRef.current
    if (player && Number.isFinite(player.duration)) {
      player.pause()
      player.currentTime = Math.min(Math.max(0, seconds), Math.max(0, player.duration - 0.001))
    }
  }

  const updateBoundary = (which: 'head' | 'tail', value: string) => {
    const seconds = parseSeconds(value)
    if (which === 'head') setHead(value)
    else setTail(value)
    setSaveError('')
    if (Number.isFinite(seconds) && seconds >= 0 && seconds <= duration) {
      seekPreview(which === 'head' ? seconds : duration - seconds)
    }
  }

  const setClampedBoundary = (which: 'head' | 'tail', seconds: number) => {
    const other = which === 'head' ? tailSeconds : headSeconds
    const max = Math.max(0, duration - (Number.isFinite(other) ? other : 0) - MIN_TRIM_DURATION)
    // 保留 0.1 秒时，不能在显示到毫秒的过程中把允许的裁剪量四舍五入得更大。
    const limit = Math.floor(max * 1000 + 1e-8) / 1000
    updateBoundary(which, formatSeconds(Math.min(limit, Math.max(0, seconds))))
  }

  const stepBoundary = (which: 'head' | 'tail', step: number) => {
    const current = which === 'head' ? headSeconds : tailSeconds
    setClampedBoundary(which, (Number.isFinite(current) ? current : 0) + step)
  }

  const setTimelineBoundary = (boundary: 'head' | 'tail', time: number) =>
    setClampedBoundary(boundary, boundary === 'head' ? time : duration - time)

  const pointerTime = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const offset = event.clientX - bounds.left - TRIM_THUMB_RADIUS
    const width = Math.max(1, bounds.width - TRIM_THUMB_RADIUS * 2)
    return (Math.min(width, Math.max(0, offset)) * duration) / width
  }

  const handleSave = async () => {
    if (!videoSource || !plan || saveController.current) return
    const controller = new AbortController()
    saveController.current = controller
    setSaveError('')
    setSaving(true)
    try {
      const rangeKey = `${plan.inSec}:${plan.outSec}:${plan.precise}`
      const output =
        cachedExport.current?.key === rangeKey
          ? cachedExport.current
          : { key: rangeKey, ...(await exportCanvasVideoTrim(videoSource, plan, source.title, controller.signal)) }
      cachedExport.current = output
      controller.signal.throwIfAborted()
      await onSave(output.file, output.result, controller.signal)
    } catch (error) {
      if (!controller.signal.aborted) {
        setSaveError(error instanceof Error ? error.message : '裁剪失败，请重试')
      }
    } finally {
      if (saveController.current === controller) saveController.current = null
      if (!controller.signal.aborted) setSaving(false)
    }
  }

  const close = () => {
    saveController.current?.abort()
    onClose()
  }

  return (
    <ConfigProvider theme={{ algorithm: theme.darkAlgorithm }}>
      <Modal
        open
        centered
        title="裁剪时长"
        width={640}
        zIndex={1750}
        styles={{ body: { maxHeight: 'calc(100dvh - 142px)', overflowY: 'auto', padding: '4px' } }}
        maskClosable={false}
        modalRender={(modal) => <CanvasPortalBoundary>{modal}</CanvasPortalBoundary>}
        onCancel={close}
        footer={[
          <Button key="cancel" onClick={close}>
            取消
          </Button>,
          <Button
            key="save"
            type="primary"
            loading={saving}
            disabled={!plan || previewError}
            onClick={() => void handleSave()}
          >
            保存裁剪
          </Button>,
        ]}
      >
        <div className={styles.editor} aria-busy={saving || (!videoSource && !loadError)}>
          <div className={styles.preview}>
            {previewUrl ? (
              <video
                ref={videoRef}
                src={previewUrl}
                controls
                playsInline
                preload="metadata"
                aria-label={`${source.title || '原视频'}裁剪预览`}
                onError={() => setPreviewError(true)}
                onPlay={(event) => {
                  const player = event.currentTarget
                  if (player.currentTime < previewStart || player.currentTime >= previewEnd - 0.001) {
                    player.currentTime = previewStart
                  }
                }}
                onTimeUpdate={(event) => {
                  const player = event.currentTarget
                  if (!player.paused && player.currentTime >= previewEnd) player.pause()
                }}
              />
            ) : (
              <span role="status">{loadError ? '原视频不可预览' : '正在读取原视频…'}</span>
            )}
          </div>

          {loadError && <Alert type="error" showIcon message={loadError} />}
          {previewError && <Alert type="error" showIcon message="当前浏览器无法预览此视频编码，无法确认裁剪效果。" />}

          {videoSource && (
            <>
              <div className={styles.timeline}>
                <div
                  className={styles.track}
                  style={
                    {
                      '--start': `${(selectedStart / duration) * 100}%`,
                      '--end': `${(selectedEnd / duration) * 100}%`,
                    } as CSSProperties
                  }
                  onPointerDown={(event) => {
                    if (saving || event.button !== 0 || timelineDrag.current) return
                    event.preventDefault()
                    const time = pointerTime(event)
                    const boundary = Math.abs(time - selectedStart) <= Math.abs(time - selectedEnd) ? 'head' : 'tail'
                    timelineDrag.current = { boundary, pointerId: event.pointerId }
                    event.currentTarget.setPointerCapture(event.pointerId)
                    if (boundary === 'head') headSlider.current?.focus({ preventScroll: true })
                    else tailSlider.current?.focus({ preventScroll: true })
                    setTimelineBoundary(boundary, time)
                  }}
                  onPointerMove={(event) => {
                    const drag = timelineDrag.current
                    if (drag?.pointerId === event.pointerId) setTimelineBoundary(drag.boundary, pointerTime(event))
                  }}
                  onLostPointerCapture={() => {
                    timelineDrag.current = null
                  }}
                >
                  {filmstrip.length > 0 && (
                    <div className={styles.filmstrip} aria-hidden="true">
                      {filmstrip.map((src, index) => (
                        <img key={index} src={src} alt="" draggable={false} />
                      ))}
                    </div>
                  )}
                  <div className={styles.rangeOverlay} aria-hidden="true">
                    <span />
                  </div>
                  <input
                    ref={headSlider}
                    type="range"
                    min={0}
                    max={duration}
                    step="any"
                    value={selectedStart}
                    aria-label="裁剪起点"
                    aria-valuetext={`${formatSeconds(selectedStart)} 秒`}
                    disabled={saving}
                    onChange={(event) => setTimelineBoundary('head', Number(event.target.value))}
                  />
                  <input
                    ref={tailSlider}
                    type="range"
                    min={0}
                    max={duration}
                    step="any"
                    value={selectedEnd}
                    aria-label="裁剪终点"
                    aria-valuetext={`${formatSeconds(selectedEnd)} 秒`}
                    disabled={saving}
                    onChange={(event) => setTimelineBoundary('tail', Number(event.target.value))}
                  />
                </div>
                <div className={styles.timelineLabels} aria-hidden="true">
                  <span>0 秒</span>
                  <span>{formatSeconds(duration)} 秒</span>
                </div>
              </div>

              <div className={styles.fields}>
                {(
                  [
                    { boundary: 'head', id: headId, label: '从头部裁剪', value: head, seconds: headSeconds },
                    { boundary: 'tail', id: tailId, label: '从尾部裁剪', value: tail, seconds: tailSeconds },
                  ] as const
                ).map(({ boundary, id, label, value, seconds }) => (
                  <div key={boundary} className={styles.field}>
                    <label htmlFor={id}>{label}</label>
                    <div className={styles.numberField}>
                      <input
                        id={id}
                        type="text"
                        inputMode="decimal"
                        pattern={DECIMAL_SECONDS}
                        role="spinbutton"
                        aria-valuemin={0}
                        aria-valuemax={duration}
                        aria-valuenow={Number.isFinite(seconds) ? seconds : undefined}
                        aria-invalid={!Number.isFinite(seconds) || seconds > duration}
                        value={value}
                        disabled={saving}
                        onChange={(event) => updateBoundary(boundary, event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                          event.preventDefault()
                          stepBoundary(boundary, event.key === 'ArrowUp' ? 0.1 : -0.1)
                        }}
                      />
                      <span aria-hidden="true">秒</span>
                      <div className={styles.steppers}>
                        <button
                          type="button"
                          aria-label={`${label}增加 0.1 秒`}
                          disabled={saving}
                          onClick={() => stepBoundary(boundary, 0.1)}
                        >
                          <span aria-hidden="true">▴</span>
                        </button>
                        <button
                          type="button"
                          aria-label={`${label}减少 0.1 秒`}
                          disabled={saving}
                          onClick={() => stepBoundary(boundary, -0.1)}
                        >
                          <span aria-hidden="true">▾</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className={styles.summary}>
                {plan ? (
                  <strong>
                    保留 {formatSeconds(plan.inSec)}–{formatSeconds(plan.outSec)} 秒 · 结果{' '}
                    {formatSeconds(plan.durationSec)} 秒
                  </strong>
                ) : (
                  <strong>原视频 {formatSeconds(duration)} 秒</strong>
                )}
                <span>保存后更新原视频节点 · 免积分</span>
              </div>

              {!valid && <Alert type="warning" showIcon message="请输入有效秒数，裁剪后至少保留 0.1 秒。" />}
              {hasSelection && !plan && (
                <Alert type="warning" showIcon message="当前区间无法裁剪，请调整起点或终点。" />
              )}
              {(plan?.precise || plan?.snapped || preferLossless) && (
                <Alert
                  type="info"
                  showIcon
                  message={
                    plan?.precise
                      ? '精确裁剪需要重新编码视频画面。'
                      : '无损裁剪会对齐关键帧和画面帧，以显示的保留区间为准。'
                  }
                  action={
                    (plan?.precise || preferLossless) && (
                      <Button
                        size="small"
                        disabled={saving}
                        onClick={() => {
                          setPreferLossless((current) => !current)
                          setSaveError('')
                        }}
                      >
                        {preferLossless ? '使用精确裁剪' : '使用无损裁剪'}
                      </Button>
                    )
                  }
                />
              )}
            </>
          )}
          {saving && (
            <p className={styles.progress} role="status">
              正在裁剪并保存视频…
            </p>
          )}
          {saveError && <Alert type="error" showIcon message={saveError} />}
        </div>
      </Modal>
    </ConfigProvider>
  )
}
