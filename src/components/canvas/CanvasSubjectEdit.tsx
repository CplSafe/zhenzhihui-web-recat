import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, ConfigProvider, Modal, theme } from 'antd'
import { estimateAiTaskCost, extractPageItems, listAiModels, uploadAssetFile } from '@/api/business'
import { useCurrentUser } from '@/stores/workspaceSession'
import { assetStreamUrl } from '@/utils/assetUrl'
import { creditsLabel } from '@/utils/creditsFormat'
import { getBackendGenerationModelVersionId, type BackendGenerationModel } from '@/utils/generationModelCatalog'
import { closestRatioOption } from '@/utils/hotCopySourceMatch'
import { acquireSeekableSource, type SeekableSourceHandle } from '@/utils/seekableMediaSource'
import { SEEDANCE_RATIO_OPTIONS } from '@/utils/videoOptions'
import { captureVideoFrameDataUrl } from '@/utils/videoFrameCapture'
import {
  buildCanvasSubjectEditRequest,
  buildCanvasSubjectVideoEstimateRequest,
  CANVAS_SUBJECT_EDIT_MODE_LABELS,
  getCanvasSubjectEditModels,
  getCanvasSubjectVideoReferenceLimit,
  getCanvasSubjectVideoSourceReferenceMode,
  needsCanvasSubjectImageMask,
  supportsCanvasSubjectTargetReference,
  supportsCanvasSubjectVideoReference,
  type CanvasSubjectEditKind,
  type CanvasSubjectEditMode,
  type CanvasSubjectVideoSelection,
} from '@/utils/canvasSubjectEdit'
import CanvasMaterialPicker, { type MaterialItem } from './CanvasMaterialPicker'
import CanvasPortalBoundary from './CanvasPortalBoundary'
import CanvasSubjectMaskEditor, { type CanvasSubjectMaskEditorHandle } from './CanvasSubjectMaskEditor'
import CanvasToolSelect from './CanvasToolSelect'
import CanvasSubjectVideoTimeline from './CanvasSubjectVideoTimeline'
import styles from './CanvasSubjectEdit.module.css'

export type CanvasSubjectEditRequest = ReturnType<typeof buildCanvasSubjectEditRequest>
export type CanvasSubjectEditSource = {
  nodeId: string
  assetId: number
  title: string
  kind: CanvasSubjectEditKind
  ratio?: string
  initialVideo?: { time: number; duration: number; width: number; height: number; frameUrl: string }
}

type QuotePrice = { cost: number; canAfford: boolean; note: string; kind: string }
type Quote = QuotePrice & { request: CanvasSubjectEditRequest }
type QuoteInput = ReturnType<typeof buildCanvasSubjectVideoEstimateRequest>

async function requestQuote(
  request: QuoteInput,
  workspaceId: number,
  canvasId: number | undefined,
  signal: AbortSignal,
): Promise<QuotePrice> {
  const result = await estimateAiTaskCost({ ...request, workspaceId, canvasId, signal })
  if (!Number.isFinite(result?.estimated_cost) || result.estimated_cost < 0 || typeof result.can_afford !== 'boolean')
    throw new Error('估价返回不完整，请重试')
  return {
    cost: result.estimated_cost,
    canAfford: result.can_afford,
    kind: result.estimate_kind || '',
    note: result.estimate_note || '',
  }
}

type Props = {
  source: CanvasSubjectEditSource
  workspaceId: number
  canvasId?: number
  referenceAssetOverrides?: Readonly<Record<number, number>>
  onClose: () => void
  onSubmit: (request: CanvasSubjectEditRequest, title: string) => Promise<void>
}

export default function CanvasSubjectEdit({
  source,
  workspaceId,
  canvasId,
  referenceAssetOverrides,
  onClose,
  onSubmit,
}: Props) {
  const isVideo = source.kind === 'video'
  const initialVideo = isVideo ? source.initialVideo : undefined
  const initialFrameUrl = initialVideo?.frameUrl
  const [mode, setMode] = useState<CanvasSubjectEditMode>('remove')
  const [target, setTarget] = useState('')
  const [recognizedTarget, setRecognizedTarget] = useState('')
  const [analyzingSelection, setAnalyzingSelection] = useState(false)
  const [description, setDescription] = useState('')
  const [duration, setDuration] = useState(
    Number.isFinite(initialVideo?.duration) && initialVideo.duration > 0 ? initialVideo.duration : 0,
  )
  const [videoSize, setVideoSize] = useState(() =>
    initialVideo?.width > 0 && initialVideo?.height > 0
      ? { width: initialVideo.width, height: initialVideo.height }
      : undefined,
  )
  const [mediaError, setMediaError] = useState('')
  const [frame, setFrame] = useState<{ src: string; time: number } | null>(
    initialFrameUrl ? { src: initialFrameUrl, time: initialVideo.time } : null,
  )
  const [editingFrame, setEditingFrame] = useState(Boolean(initialFrameUrl))
  const [readingFrame, setReadingFrame] = useState(isVideo && !initialFrameUrl)
  const [videoTime, setVideoTime] = useState(initialVideo?.time ?? 0)
  const [videoPlaying, setVideoPlaying] = useState(false)
  const [videoSound, setVideoSound] = useState({ muted: false, volume: 1 })
  const [playbackUrl, setPlaybackUrl] = useState('')
  const [selectionBounds, setSelectionBounds] = useState<CanvasSubjectVideoSelection['bounds']>()
  const [targetImage, setTargetImage] = useState<MaterialItem | null>(null)
  const [targetPickerOpen, setTargetPickerOpen] = useState(false)
  const [modelCatalog, setModelCatalog] = useState<BackendGenerationModel[]>([])
  const [modelId, setModelId] = useState(0)
  const [loading, setLoading] = useState(true)
  const [modelError, setModelError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState('')
  const [savedQuote, setQuote] = useState<Quote | null>(null)
  const [videoPrice, setVideoPrice] = useState<{ key: string; price?: QuotePrice; error?: string }>()
  const [videoPriceRetry, setVideoPriceRetry] = useState(0)
  const [phase, setPhase] = useState<'estimate' | 'submit' | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const videoPreviewRef = useRef<HTMLDivElement>(null)
  const seekableSource = useRef<SeekableSourceHandle | null>(null)
  const pendingSeek = useRef<number | null>(null)
  const initialTime = useRef<number | null>(initialVideo?.time ?? 0)
  const captureRequested = useRef(isVideo && !initialFrameUrl)
  const captureAnimation = useRef(0)
  const waitingForFrameSeek = useRef(false)
  const maskEditor = useRef<CanvasSubjectMaskEditorHandle>(null)
  const uploadedSelection = useRef(0)
  const quoteRevision = useRef(0)
  const working = useRef<AbortController | null>(null)
  const sourceUrl = assetStreamUrl(source.assetId, workspaceId)
  const currentUser = useCurrentUser()
  const models = useMemo(
    () => getCanvasSubjectEditModels(source.kind, modelCatalog, mode),
    [source.kind, modelCatalog, mode],
  )
  const model = models.find((item) => getBackendGenerationModelVersionId(item) === modelId) ?? models[0]
  const busy = phase !== null
  const needsMask = !isVideo && Boolean(model && needsCanvasSubjectImageMask(model))
  const canSendVideoCutout = isVideo && model && getCanvasSubjectVideoSourceReferenceMode(model) === 'cutout'
  const showTargetPicker =
    mode !== 'remove' && Boolean(model && supportsCanvasSubjectTargetReference(source.kind, model))
  const adjustedTargetId = targetImage && referenceAssetOverrides?.[targetImage.assetId]
  const targetReference = !showTargetPicker
    ? null
    : adjustedTargetId
      ? {
          ...targetImage,
          assetId: adjustedTargetId,
          src: assetStreamUrl(adjustedTargetId, workspaceId),
          name: `${targetImage.name} · 已调整`,
        }
      : targetImage
  const supportsSingleReference = isVideo && Boolean(model && supportsCanvasSubjectVideoReference(model))
  const sendsVideoReference =
    canSendVideoCutout && (targetReference ? getCanvasSubjectVideoReferenceLimit(model) > 1 : supportsSingleReference)
  const needsVideoSelection = Boolean(targetReference && canSendVideoCutout && !supportsSingleReference)
  const isReplacing = mode === 'replace'
  const targetReferenceLabel = isReplacing ? '替换参考图' : '目标参考图'
  const chooseTargetLabel = isReplacing ? '选择替换图片' : '添加目标参考图'
  const changeTargetLabel = isReplacing ? '更换替换图片' : '更换目标参考图'
  const needsDescription = mode === 'modify' || (isReplacing && !targetReference)
  const targetDescription = target.trim() || recognizedTarget
  const ready = Boolean(
    model &&
    !loading &&
    !mediaError &&
    !analyzingSelection &&
    (!needsDescription || description.trim()) &&
    (isVideo
      ? duration > 0 && (needsVideoSelection ? selectionBounds : selectionBounds || targetDescription)
      : selectionBounds),
  )
  const modeLabel = CANVAS_SUBJECT_EDIT_MODE_LABELS[mode]
  const targetReferenceId = targetReference?.assetId
  const quote = savedQuote?.request.inputAssets.some(
    (asset) => ['image', 'reference_image'].includes(asset.role) && referenceAssetOverrides?.[Number(asset.asset_id)],
  )
    ? null
    : savedQuote
  const quoteRatio = videoSize
    ? closestRatioOption(videoSize.width, videoSize.height, SEEDANCE_RATIO_OPTIONS)
    : source.ratio
  const videoPriceInput = useMemo(() => {
    if (!isVideo || !model || loading || mediaError || duration <= 0) return null
    try {
      return {
        request: buildCanvasSubjectVideoEstimateRequest({
          mode,
          model,
          sourceAssetId: source.assetId,
          targetReferenceAssetId: targetReferenceId,
          duration,
          ratio: quoteRatio,
          sourceVideoSize: videoSize,
        }),
      }
    } catch (reason) {
      return { error: reason instanceof Error ? reason.message : '当前模型无法估价' }
    }
  }, [isVideo, model, loading, mediaError, duration, mode, source.assetId, targetReferenceId, quoteRatio, videoSize])
  const videoQuoteRequest = videoPriceInput?.request
  const requestedOutputDurationSec = videoQuoteRequest?.outputDurationSec
  const changesOutputDuration =
    requestedOutputDurationSec !== undefined && duration.toFixed(2) !== requestedOutputDurationSec.toFixed(2)
  const videoPriceKey = videoQuoteRequest ? JSON.stringify({ workspaceId, canvasId, videoQuoteRequest }) : ''
  const currentVideoPrice = videoPrice?.key === videoPriceKey ? videoPrice : undefined
  const activePrice = quote ?? currentVideoPrice?.price
  const preparingPrice =
    phase === 'estimate' || Boolean(videoPriceKey && !currentVideoPrice?.price && !currentVideoPrice?.error)
  const priceError = videoPriceInput?.error || (quote ? '' : currentVideoPrice?.error)
  const priceChanged =
    isVideo &&
    quote &&
    currentVideoPrice?.price &&
    (quote.cost !== currentVideoPrice.price.cost || quote.kind !== currentVideoPrice.price.kind)

  useEffect(() => {
    if (!videoQuoteRequest) return
    const controller = new AbortController()
    setVideoPrice({ key: videoPriceKey })
    void requestQuote(videoQuoteRequest, workspaceId, canvasId, controller.signal)
      .then((price) => {
        if (!controller.signal.aborted) setVideoPrice({ key: videoPriceKey, price })
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return
        setVideoPrice({ key: videoPriceKey, error: reason instanceof Error ? reason.message : '估价失败，请重试' })
      })
    return () => controller.abort()
  }, [videoQuoteRequest, videoPriceKey, videoPriceRetry, workspaceId, canvasId])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setModelError('')
    setModelCatalog([])
    listAiModels({
      workspaceId,
      plan: '',
      signal: controller.signal,
    })
      .then((list) => {
        if (!controller.signal.aborted) setModelCatalog(extractPageItems(list))
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setModelError(reason instanceof Error ? reason.message : '模型列表加载失败')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [attempt, workspaceId])

  useEffect(() => {
    const video = videoRef.current
    return () => {
      video?.pause()
      window.cancelAnimationFrame(captureAnimation.current)
      captureAnimation.current = 0
      working.current?.abort()
      seekableSource.current?.release()
      seekableSource.current = null
    }
  }, [])

  function invalidateQuote() {
    quoteRevision.current += 1
    setQuote(null)
    setError('')
  }

  function changeMode(nextMode: CanvasSubjectEditMode) {
    if (nextMode === mode) return
    const nextModels = getCanvasSubjectEditModels(source.kind, modelCatalog, nextMode)
    const nextModel = model && nextModels.includes(model) ? model : nextModels[0]
    setModelId(nextModel ? getBackendGenerationModelVersionId(nextModel) : 0)
    setMode(nextMode)
    setDescription('')
    setTargetImage(null)
    setTargetPickerOpen(false)
    invalidateQuote()
  }

  function changeSelection(_hasSelection: boolean, bounds?: CanvasSubjectVideoSelection['bounds']) {
    setSelectionBounds(bounds)
    setRecognizedTarget('')
    uploadedSelection.current = 0
    invalidateQuote()
  }

  async function recognizeCandidates(point: { x: number; y: number }, signal: AbortSignal) {
    const { recognizeCanvasSubjectCandidates } = await import('@/api/canvasSubjectRecognition')
    return recognizeCanvasSubjectCandidates({
      workspaceId,
      canvasId,
      point,
      signal,
      ...(frame ? { frameDataUrl: frame.src } : { imageAssetId: source.assetId }),
    })
  }

  async function toggleVideoPlayback() {
    const video = videoRef.current
    if (!video) return
    if (!video.paused) {
      video.pause()
      return
    }
    try {
      await video.play()
    } catch (reason) {
      if (video.isConnected && !(reason instanceof DOMException && reason.name === 'AbortError')) {
        setError('暂时无法播放原视频，请重试')
      }
    }
  }

  function toggleVideoSound() {
    const video = videoRef.current
    if (!video) return
    const muted = !(video.muted || video.volume === 0)
    if (!muted && video.volume === 0) video.volume = 1
    video.muted = muted
  }

  async function toggleVideoFullscreen() {
    const preview = videoPreviewRef.current
    if (!preview) return
    try {
      if (document.fullscreenElement === preview) await document.exitFullscreen()
      else await preview.requestFullscreen()
    } catch {
      setError('无法切换视频全屏，请重试')
    }
  }

  function canReadFrame(video: HTMLVideoElement) {
    return (
      pendingSeek.current === null &&
      !waitingForFrameSeek.current &&
      !video.seeking &&
      Number.isFinite(video.currentTime) &&
      video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
    )
  }

  function captureCurrentFrame(video: HTMLVideoElement) {
    video.pause()
    if (frame?.time === video.currentTime) {
      setEditingFrame(true)
      return
    }
    const src = captureVideoFrameDataUrl(video)
    if (!src) {
      setError('无法读取当前帧，请播放或切换到另一帧后重试')
      return
    }
    if (frame) changeSelection(false)
    setFrame({ src, time: video.currentTime })
    setVideoTime(video.currentTime)
    setEditingFrame(true)
  }

  function markCurrentFrame() {
    const video = videoRef.current
    if (!video || !canReadFrame(video)) {
      setError('当前帧还在加载，请稍后重试')
      return
    }
    captureCurrentFrame(video)
  }

  function captureFrameWhenReady(video: HTMLVideoElement) {
    if (!captureRequested.current || captureAnimation.current || !canReadFrame(video)) return
    if (initialTime.current !== null && Number.isFinite(video.duration) && video.duration > 0) {
      // 首次有可用画面后再定位。WebKit 在仅有元数据时可能把跳转限制在片头。
      const firstFrame = Math.min(0.01, video.duration / 2)
      const startTime = Math.min(Math.max(firstFrame, initialTime.current), Math.max(firstFrame, video.duration - 0.04))
      initialTime.current = null
      if (Math.abs(video.currentTime - startTime) > 0.001) {
        pendingSeek.current = startTime
        applyPendingSeek(video)
        return
      }
    }
    // 等待浏览器呈现已解码的画面，避免把定位前一帧送入标记工具。
    captureAnimation.current = window.requestAnimationFrame(() => {
      captureAnimation.current = window.requestAnimationFrame(() => {
        captureAnimation.current = 0
        if (!captureRequested.current || videoRef.current !== video || !canReadFrame(video)) return
        captureRequested.current = false
        setReadingFrame(false)
        captureCurrentFrame(video)
      })
    })
  }

  function handleTimelineSeek(time: number) {
    const video = videoRef.current
    if (!video || busy) return
    initialTime.current = null
    if (readingFrame || (editingFrame && !selectionBounds && !analyzingSelection)) {
      captureRequested.current = true
      setReadingFrame(true)
    }
    seekVideo(time)
    captureFrameWhenReady(video)
  }

  function seekVideo(time: number) {
    const video = videoRef.current
    if (!video || busy) return
    video.pause()
    setEditingFrame(false)
    setVideoTime(time)
    if (Math.abs(video.currentTime - time) < 0.001 && pendingSeek.current === null) return

    pendingSeek.current = time
    if (video.readyState < HTMLMediaElement.HAVE_METADATA) return
    const seekable = Array.from({ length: video.seekable.length }, (_, index) => index).some(
      (index) => video.seekable.start(index) <= time && time <= video.seekable.end(index),
    )
    if (seekable || (playbackUrl && video.src === video.currentSrc)) {
      // 选区视图隐藏了播放器，等它重新可见再请求下一帧。
      window.requestAnimationFrame(() => {
        if (videoRef.current === video) applyPendingSeek(video)
      })
      return
    }
    if (seekableSource.current) return
    // /download 可能不支持 Range。无法直接跳转时复用胶片条的可定位素材副本。
    const handle = acquireSeekableSource(sourceUrl)
    seekableSource.current = handle
    void handle.ready.then(({ url, local }) => {
      if (seekableSource.current !== handle) return
      if (local) setPlaybackUrl(url)
      else {
        seekableSource.current = null
        handle.release()
        if (videoRef.current) applyPendingSeek(videoRef.current)
      }
    })
  }

  function applyPendingSeek(video: HTMLVideoElement) {
    const time = pendingSeek.current
    if (time === null || video.readyState < HTMLMediaElement.HAVE_METADATA) return
    pendingSeek.current = null
    // 原生播放头可能先更新时刻，再提交可绘制的画面。等 seeked 后再截帧。
    if (captureRequested.current && Math.abs(video.currentTime - time) > 0.001) waitingForFrameSeek.current = true
    video.currentTime = time
  }

  function jumpToMarkedFrame() {
    if (!frame) return
    initialTime.current = null
    seekVideo(frame.time)
    setEditingFrame(true)
  }

  function returnToVideo() {
    setEditingFrame(false)
    if (initialTime.current === null) return
    const time = initialTime.current
    initialTime.current = null
    seekVideo(time)
  }

  async function prepareRequest(signal: AbortSignal, isCurrent: () => boolean) {
    if (!model) return
    const videoSelection = frame && selectionBounds ? { time: frame.time, bounds: selectionBounds } : undefined
    const uploadSelection = needsMask || (sendsVideoReference && Boolean(videoSelection))
    if (uploadSelection && !uploadedSelection.current) {
      const editor = maskEditor.current
      if (!editor) throw new Error('选区尚未就绪，请重新选择')
      const file = await (isVideo ? editor.exportCutout(1024) : editor.exportMask())
      if (!isCurrent()) return
      const uploaded = await uploadAssetFile({
        workspaceId,
        file,
        source: 'upload',
        signal,
      })
      const assetId = Number(uploaded?.asset?.id)
      if (!Number.isSafeInteger(assetId) || assetId <= 0) throw new Error('选区上传未返回素材，请重试')
      if (!isCurrent()) return
      uploadedSelection.current = assetId
    }
    if (!isCurrent()) return
    return buildCanvasSubjectEditRequest({
      kind: source.kind,
      mode,
      model,
      sourceAssetId: source.assetId,
      maskAssetId: needsMask ? uploadedSelection.current : undefined,
      imageSelection: isVideo ? undefined : selectionBounds,
      videoSelection: videoSelection && {
        ...videoSelection,
        referenceAssetId: sendsVideoReference
          ? (referenceAssetOverrides?.[uploadedSelection.current] ?? uploadedSelection.current)
          : undefined,
      },
      target: targetDescription,
      description,
      targetReferenceAssetId: targetReferenceId,
      sourceVideoDurationSec: duration,
      ratio: quoteRatio,
      sourceVideoSize: videoSize,
    })
  }

  async function estimate() {
    if (!ready || working.current) return
    const controller = new AbortController()
    working.current = controller
    setPhase('estimate')
    invalidateQuote()
    const revision = quoteRevision.current
    const isCurrent = () => !controller.signal.aborted && quoteRevision.current === revision
    try {
      const request = await prepareRequest(controller.signal, isCurrent)
      if (!request) return
      const price = await requestQuote(request, workspaceId, canvasId, controller.signal)
      if (isCurrent()) setQuote({ request, ...price })
    } catch (reason) {
      if (isCurrent()) setError(reason instanceof Error ? reason.message : '估价失败，请重试')
    } finally {
      working.current = null
      if (!controller.signal.aborted) setPhase(null)
    }
  }

  async function submit() {
    if (!activePrice?.canAfford || !ready || working.current) return
    const controller = new AbortController()
    working.current = controller
    const revision = quoteRevision.current
    const isCurrent = () => !controller.signal.aborted && quoteRevision.current === revision
    setError('')
    try {
      let submission = quote
      if (!submission) {
        setPhase('estimate')
        const request = await prepareRequest(controller.signal, isCurrent)
        if (!request) return
        const price = await requestQuote(request, workspaceId, canvasId, controller.signal)
        if (!isCurrent()) return
        submission = { request, ...price }
        setQuote(submission)
        // 初始价格不含尚未生成的选区参考。实际请求价格变化时，等用户确认新报价。
        if (!price.canAfford || price.cost !== activePrice.cost || price.kind !== activePrice.kind) return
      }
      setPhase('submit')
      await onSubmit(submission.request, modeLabel)
      if (!controller.signal.aborted) onClose()
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '提交失败，请重试')
    } finally {
      working.current = null
      if (!controller.signal.aborted) setPhase(null)
    }
  }

  return (
    <ConfigProvider theme={{ algorithm: theme.darkAlgorithm, token: { colorPrimary: '#119c80' } }}>
      <Modal
        open
        title="主体编辑"
        className={styles.modal}
        width={1040}
        zIndex={2200}
        onCancel={onClose}
        closable={!busy}
        keyboard={!busy && !targetPickerOpen}
        maskClosable={false}
        modalRender={(modal) => <CanvasPortalBoundary>{modal}</CanvasPortalBoundary>}
        footer={
          <div className={styles.footer}>
            <span role="status">
              {preparingPrice
                ? '正在估价…'
                : activePrice
                  ? `${activePrice.kind === 'reservation' ? '预冻结' : '预计消耗'} ${creditsLabel(activePrice.cost)}`
                  : ''}
            </span>
            {isVideo ? (
              !quote &&
              currentVideoPrice?.error && (
                <Button
                  disabled={busy}
                  onClick={() => {
                    if (ready) void estimate()
                    else setVideoPriceRetry((value) => value + 1)
                  }}
                >
                  重试估价
                </Button>
              )
            ) : (
              <Button disabled={!ready || busy} onClick={estimate}>
                {quote ? '重新估价' : '估价'}
              </Button>
            )}
            <Button
              type="primary"
              aria-label="开始处理"
              aria-busy={phase === 'submit'}
              loading={phase === 'submit'}
              disabled={!activePrice?.canAfford || busy || !ready}
              onClick={submit}
            >
              开始处理
            </Button>
          </div>
        }
      >
        <div className={styles.body}>
          <div className={styles.modes} role="group" aria-label="编辑方式">
            {(Object.entries(CANVAS_SUBJECT_EDIT_MODE_LABELS) as [CanvasSubjectEditMode, string][]).map(
              ([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={mode === value}
                  disabled={busy}
                  onClick={() => changeMode(value)}
                >
                  {label}
                </button>
              ),
            )}
          </div>
          <div className={styles.workspace}>
            <section className={styles.stage} aria-label="素材与选区">
              {isVideo && (
                <div className={styles.preview}>
                  <div className={styles.frameControls}>
                    <div className={styles.frameActions}>
                      {editingFrame ? (
                        <Button size="small" disabled={busy} onClick={returnToVideo}>
                          返回视频
                        </Button>
                      ) : !readingFrame ? (
                        <Button size="small" disabled={busy || !duration || !!mediaError} onClick={markCurrentFrame}>
                          {selectionBounds ? '改标当前帧' : '标记当前帧'}
                        </Button>
                      ) : null}
                      {frame && selectionBounds && (
                        <Button
                          size="small"
                          disabled={busy || analyzingSelection}
                          onClick={() => maskEditor.current?.clearSelection()}
                        >
                          清除标记
                        </Button>
                      )}
                    </div>
                    <span>
                      {editingFrame && frame
                        ? `已定位到 ${Number(frame.time.toFixed(2))} 秒`
                        : duration > 0
                          ? `整段处理 · ${Number(duration.toFixed(2))} 秒`
                          : '等待读取视频时长'}
                    </span>
                    {readingFrame && <span role="status">正在读取当前帧…</span>}
                  </div>
                  <div
                    ref={videoPreviewRef}
                    className={styles.videoPlayer}
                    hidden={editingFrame}
                    aria-hidden={editingFrame}
                  >
                    {/* 复用下方胶片条作为进度条，避免 WebKit 原生控件的时长格式化异常。 */}
                    <video
                      ref={videoRef}
                      preload="auto"
                      playsInline
                      src={playbackUrl || sourceUrl}
                      aria-label="原视频"
                      onPlay={() => setVideoPlaying(true)}
                      onPause={() => setVideoPlaying(false)}
                      onEnded={() => setVideoPlaying(false)}
                      onVolumeChange={({ currentTarget }) =>
                        setVideoSound({ muted: currentTarget.muted, volume: currentTarget.volume })
                      }
                      onTimeUpdate={({ currentTarget }) => {
                        if (initialTime.current === null && pendingSeek.current === null && !currentTarget.seeking)
                          setVideoTime(currentTarget.currentTime)
                      }}
                      onLoadedMetadata={({ currentTarget }) => {
                        const { duration: seconds, videoWidth: width, videoHeight: height } = currentTarget
                        const nextSize = width > 0 && height > 0 ? { width, height } : undefined
                        const sizeChanged =
                          nextSize?.width !== videoSize?.width || nextSize?.height !== videoSize?.height
                        if (sizeChanged) setVideoSize(nextSize)
                        setDuration(Number.isFinite(seconds) ? seconds : 0)
                        setMediaError(Number.isFinite(seconds) && seconds > 0 ? '' : '无法读取视频时长')
                        if (seconds !== duration || sizeChanged) invalidateQuote()
                        applyPendingSeek(currentTarget)
                      }}
                      onLoadedData={({ currentTarget }) => captureFrameWhenReady(currentTarget)}
                      onCanPlay={({ currentTarget }) => captureFrameWhenReady(currentTarget)}
                      onSeeked={({ currentTarget }) => {
                        waitingForFrameSeek.current = false
                        captureFrameWhenReady(currentTarget)
                      }}
                      onDurationChange={({ currentTarget }) => {
                        const seconds = currentTarget.duration
                        if (Number.isFinite(seconds) && seconds > 0 && seconds !== duration) {
                          setDuration(seconds)
                          invalidateQuote()
                        }
                      }}
                      onError={() => {
                        captureRequested.current = false
                        waitingForFrameSeek.current = false
                        setReadingFrame(false)
                        setDuration(0)
                        setVideoPlaying(false)
                        setMediaError('原视频无法读取，请重新选择素材')
                        invalidateQuote()
                      }}
                    />
                    <div className={styles.playbackControls} role="group" aria-label="原视频播放控制">
                      <Button size="small" disabled={busy || !duration || !!mediaError} onClick={toggleVideoPlayback}>
                        {videoPlaying ? '暂停视频' : '播放视频'}
                      </Button>
                      <Button size="small" onClick={toggleVideoSound}>
                        {videoSound.muted || videoSound.volume === 0 ? '开启声音' : '静音'}
                      </Button>
                      <input
                        type="range"
                        aria-label="原视频音量"
                        min={0}
                        max={1}
                        step={0.01}
                        value={videoSound.muted ? 0 : videoSound.volume}
                        onChange={(event) => {
                          const video = videoRef.current
                          if (!video) return
                          video.volume = event.currentTarget.valueAsNumber
                          video.muted = video.volume === 0
                        }}
                      />
                      {document.fullscreenEnabled && (
                        <Button size="small" aria-label="切换视频全屏" onClick={toggleVideoFullscreen}>
                          全屏
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}
              {(!isVideo || frame) && (
                <div hidden={isVideo && !editingFrame}>
                  <CanvasSubjectMaskEditor
                    key={frame?.time ?? source.assetId}
                    ref={maskEditor}
                    src={frame?.src ?? sourceUrl}
                    mediaLabel={frame ? '视频帧' : undefined}
                    disabled={busy}
                    onSelectionChange={changeSelection}
                    onAnalysisChange={setAnalyzingSelection}
                    onRecognizeCandidates={recognizeCandidates}
                    onSelectSubjectName={(name) => {
                      setRecognizedTarget(name)
                      invalidateQuote()
                    }}
                  />
                </div>
              )}
              {isVideo && duration > 0 && (
                <CanvasSubjectVideoTimeline
                  sourceUrl={sourceUrl}
                  duration={duration}
                  currentTime={videoTime}
                  anchorTime={selectionBounds ? frame?.time : undefined}
                  disabled={busy || !!mediaError}
                  onSeek={handleTimelineSeek}
                  onJumpToAnchor={jumpToMarkedFrame}
                />
              )}
              {frame && (
                <p className={styles.selectionNote}>
                  {!selectionBounds
                    ? '可在当前帧选中主体，也可填写主体描述。'
                    : sendsVideoReference
                      ? '单帧抠图用于定位主体，编辑模型会处理整段视频。'
                      : '当前模型使用文字定位，选区的位置和时间将写入描述。'}
                </p>
              )}
            </section>
            <section className={styles.settings} aria-label="处理设置">
              {isVideo && (
                <label className={styles.field}>
                  要处理的主体
                  <input
                    value={target}
                    disabled={busy}
                    maxLength={150}
                    placeholder={
                      recognizedTarget ||
                      (selectionBounds ? '已选中主体，可补充描述' : '可在画面中点选，或描述要编辑的主体')
                    }
                    onChange={(event) => {
                      setTarget(event.target.value)
                      invalidateQuote()
                    }}
                  />
                </label>
              )}
              {mode !== 'remove' && (
                <label className={styles.field}>
                  {mode === 'modify' ? '修改说明' : targetReference ? '替换说明（可选）' : '替换说明'}
                  <textarea
                    value={description}
                    disabled={busy}
                    maxLength={250}
                    rows={2}
                    placeholder={mode === 'modify' ? '例如：把车身改成白色' : '例如：替换成一辆深绿色皮卡'}
                    onChange={(event) => {
                      setDescription(event.target.value)
                      invalidateQuote()
                    }}
                  />
                </label>
              )}
              {models.length > 0 && model && (
                <label className={styles.field}>
                  编辑模型
                  <CanvasToolSelect
                    aria-label="编辑模型"
                    value={String(getBackendGenerationModelVersionId(model))}
                    disabled={busy}
                    onChange={(event) => {
                      const nextId = Number(event.target.value)
                      const nextModel = models.find((item) => getBackendGenerationModelVersionId(item) === nextId)
                      setModelId(nextId)
                      if (!nextModel || !supportsCanvasSubjectTargetReference(source.kind, nextModel)) {
                        setTargetImage(null)
                      }
                      invalidateQuote()
                    }}
                  >
                    {models.map((item) => {
                      const id = getBackendGenerationModelVersionId(item)
                      return (
                        <option key={id} value={String(id)}>
                          {String(item.display_name || item.name || id)}
                        </option>
                      )
                    })}
                  </CanvasToolSelect>
                </label>
              )}
              {changesOutputDuration && (
                <Alert
                  type="warning"
                  message={`原视频 ${Number(duration.toFixed(2))} 秒，当前模型请求 ${Number(requestedOutputDurationSec.toFixed(2))} 秒的输出。`}
                />
              )}
              {showTargetPicker && (
                <section className={styles.field} aria-label={targetReferenceLabel}>
                  <span>{targetReferenceLabel}（可选）</span>
                  {targetReference && (
                    <div className={styles.targetReference}>
                      <img alt={`${targetReferenceLabel}预览`} src={targetReference.src} />
                      <span>{targetReference.name}</span>
                    </div>
                  )}
                  <div className={styles.frameActions}>
                    <Button size="small" disabled={busy} onClick={() => setTargetPickerOpen(true)}>
                      {targetReference ? changeTargetLabel : chooseTargetLabel}
                    </Button>
                    {targetReference && (
                      <Button
                        size="small"
                        disabled={busy}
                        onClick={() => {
                          setTargetImage(null)
                          invalidateQuote()
                        }}
                      >
                        {isReplacing ? '清除替换图片' : '清除目标参考图'}
                      </Button>
                    )}
                  </div>
                  {targetReference && canSendVideoCutout && !supportsSingleReference && !selectionBounds && (
                    <p className={styles.selectionNote}>该模型还需要标记原视频里的旧主体。</p>
                  )}
                </section>
              )}
              {loading && <span role="status">正在读取编辑模型…</span>}
              {!loading && !model && (
                <Alert
                  type={modelError ? 'error' : 'warning'}
                  message={modelError || '当前空间暂无支持此类主体编辑的模型'}
                  action={<Button onClick={() => setAttempt((value) => value + 1)}>重试</Button>}
                />
              )}
              {(mediaError || error || priceError) && (
                <Alert type="error" message={mediaError || error || priceError} />
              )}
              {activePrice?.note && <Alert type="info" message={activePrice.note} />}
              {activePrice && !activePrice.canAfford && <Alert type="warning" message="积分不足，暂时无法开始处理" />}
              {priceChanged && quote.canAfford && <Alert type="info" message="积分预估已更新，请确认后开始处理" />}
            </section>
          </div>
        </div>
      </Modal>
      {targetPickerOpen && showTargetPicker && (
        <CanvasPortalBoundary>
          <CanvasMaterialPicker
            visible
            variant="modal"
            imageOnly
            overlayZIndex={2300}
            workspaceId={workspaceId}
            userId={Number(currentUser?.id ?? currentUser?.user_id) || undefined}
            onClose={() => setTargetPickerOpen(false)}
            onApply={(material) => {
              const assetId = Number(material.assetId)
              setTargetPickerOpen(false)
              if (!Number.isSafeInteger(assetId) || assetId <= 0 || assetId === source.assetId) {
                setError('请选择与原素材不同的有效参考图')
                return
              }
              setTargetImage({ ...material, assetId, src: material.src || assetStreamUrl(assetId, workspaceId) })
              invalidateQuote()
            }}
          />
        </CanvasPortalBoundary>
      )}
    </ConfigProvider>
  )
}
