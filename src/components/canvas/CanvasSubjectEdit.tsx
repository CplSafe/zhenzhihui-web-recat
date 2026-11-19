import { useEffect, useRef, useState } from 'react'
import { Alert, Button, ConfigProvider, Modal, theme } from 'antd'
import { estimateAiTaskCost, extractPageItems, listAiModels, uploadAssetFile } from '@/api/business'
import { useCurrentUser } from '@/stores/workspaceSession'
import { assetStreamUrl } from '@/utils/assetUrl'
import { creditsLabel } from '@/utils/creditsFormat'
import { getBackendGenerationModelVersionId } from '@/utils/generationModelCatalog'
import { closestRatioOption } from '@/utils/hotCopySourceMatch'
import { acquireSeekableSource, type SeekableSourceHandle } from '@/utils/seekableMediaSource'
import { SEEDANCE_RATIO_OPTIONS } from '@/utils/videoOptions'
import { captureVideoFrameDataUrl } from '@/utils/videoFrameCapture'
import {
  buildCanvasSubjectEditRequest,
  CANVAS_SUBJECT_EDIT_MODE_LABELS,
  getCanvasSubjectEditModels,
  getCanvasSubjectEditOperation,
  getCanvasSubjectVideoReferenceLimit,
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
}

type Quote = { request: CanvasSubjectEditRequest; cost: number; canAfford: boolean; note: string; kind: string }

type Props = {
  source: CanvasSubjectEditSource
  workspaceId: number
  canvasId?: number
  onClose: () => void
  onSubmit: (request: CanvasSubjectEditRequest, title: string) => Promise<void>
}

export default function CanvasSubjectEdit({ source, workspaceId, canvasId, onClose, onSubmit }: Props) {
  const [mode, setMode] = useState<CanvasSubjectEditMode>('remove')
  const [target, setTarget] = useState('')
  const [recognizedTarget, setRecognizedTarget] = useState('')
  const [analyzingSelection, setAnalyzingSelection] = useState(false)
  const [description, setDescription] = useState('')
  const [duration, setDuration] = useState(0)
  const [videoRatio, setVideoRatio] = useState('')
  const [mediaError, setMediaError] = useState('')
  const [frame, setFrame] = useState<{ src: string; time: number } | null>(null)
  const [editingFrame, setEditingFrame] = useState(false)
  const [videoTime, setVideoTime] = useState(0)
  const [playbackUrl, setPlaybackUrl] = useState('')
  const [selectionBounds, setSelectionBounds] = useState<CanvasSubjectVideoSelection['bounds']>()
  const [replacementImage, setReplacementImage] = useState<MaterialItem | null>(null)
  const [replacementPickerOpen, setReplacementPickerOpen] = useState(false)
  const [models, setModels] = useState<ReturnType<typeof getCanvasSubjectEditModels>>([])
  const [modelId, setModelId] = useState(0)
  const [loading, setLoading] = useState(true)
  const [modelError, setModelError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState('')
  const [quote, setQuote] = useState<Quote | null>(null)
  const [phase, setPhase] = useState<'estimate' | 'submit' | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const seekableSource = useRef<SeekableSourceHandle | null>(null)
  const pendingSeek = useRef<number | null>(null)
  const maskEditor = useRef<CanvasSubjectMaskEditorHandle>(null)
  const uploadedSelection = useRef(0)
  const working = useRef<AbortController | null>(null)
  const isVideo = source.kind === 'video'
  const sourceUrl = assetStreamUrl(source.assetId, workspaceId)
  const currentUser = useCurrentUser()
  const model = models.find((item) => getBackendGenerationModelVersionId(item) === modelId) || models[0]
  const busy = phase !== null
  const referenceLimit = isVideo && model ? getCanvasSubjectVideoReferenceLimit(model) : 0
  const supportsSingleReference = isVideo && Boolean(model && supportsCanvasSubjectVideoReference(model))
  const showReplacementPicker = isVideo && mode === 'replace' && referenceLimit > 0
  const replacement = showReplacementPicker ? replacementImage : null
  const sendsVideoReference = replacement ? referenceLimit > 1 : supportsSingleReference
  const needsDescription = mode === 'modify' || (mode === 'replace' && !replacement)
  const targetDescription = target.trim() || recognizedTarget
  const ready = Boolean(
    model &&
    !loading &&
    !mediaError &&
    !analyzingSelection &&
    (!needsDescription || description.trim()) &&
    (isVideo
      ? duration > 0 && (frame || (replacement && !supportsSingleReference) ? selectionBounds : targetDescription)
      : selectionBounds),
  )
  const modeLabel = CANVAS_SUBJECT_EDIT_MODE_LABELS[mode]

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setModelError('')
    setModels([])
    listAiModels({
      workspaceId,
      capability: source.kind,
      operationCode: getCanvasSubjectEditOperation(source.kind),
      plan: '',
      signal: controller.signal,
    })
      .then((list) => {
        if (!controller.signal.aborted) setModels(getCanvasSubjectEditModels(source.kind, extractPageItems(list)))
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setModelError(reason instanceof Error ? reason.message : '模型列表加载失败')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [attempt, workspaceId, source.kind])

  useEffect(
    () => () => {
      working.current?.abort()
      seekableSource.current?.release()
      seekableSource.current = null
    },
    [],
  )

  function invalidateQuote() {
    setQuote(null)
    setError('')
  }

  function changeSelection(_hasSelection: boolean, bounds?: CanvasSubjectVideoSelection['bounds']) {
    setSelectionBounds(bounds)
    if (!bounds) setRecognizedTarget('')
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

  function markCurrentFrame() {
    const video = videoRef.current
    if (
      !video ||
      pendingSeek.current !== null ||
      video.seeking ||
      video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
    ) {
      setError('当前帧还在加载，请稍后重试')
      return
    }
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
    changeSelection(false)
    setFrame({ src, time: video.currentTime })
    setVideoTime(video.currentTime)
    setEditingFrame(true)
  }

  function seekVideo(time: number) {
    const video = videoRef.current
    if (!video || busy) return
    video.pause()
    setEditingFrame(false)
    setVideoTime(time)
    if (Math.abs(video.currentTime - time) < 0.001 && pendingSeek.current === null) return

    const seekable = Array.from({ length: video.seekable.length }, (_, index) => index).some(
      (index) => video.seekable.start(index) <= time && time <= video.seekable.end(index),
    )
    pendingSeek.current = time
    if (
      seekable ||
      (playbackUrl && video.readyState >= HTMLMediaElement.HAVE_METADATA && video.src === video.currentSrc)
    ) {
      applyPendingSeek(video)
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
    video.currentTime = time
  }

  function jumpToMarkedFrame() {
    if (!frame) return
    seekVideo(frame.time)
    setEditingFrame(true)
  }

  async function estimate() {
    if (!ready || !model || working.current) return
    const controller = new AbortController()
    working.current = controller
    setPhase('estimate')
    invalidateQuote()
    try {
      const videoSelection = frame && selectionBounds ? { time: frame.time, bounds: selectionBounds } : undefined
      const uploadSelection = !isVideo || (sendsVideoReference && Boolean(videoSelection))
      if (uploadSelection && !uploadedSelection.current) {
        const editor = maskEditor.current
        if (!editor) throw new Error('选区尚未就绪，请重新选择')
        const file = await (isVideo ? editor.exportCutout(1024) : editor.exportMask())
        if (controller.signal.aborted) return
        const uploaded = await uploadAssetFile({
          workspaceId,
          file,
          source: 'upload',
          signal: controller.signal,
        })
        const assetId = Number(uploaded?.asset?.id)
        if (!Number.isSafeInteger(assetId) || assetId <= 0) throw new Error('选区上传未返回素材，请重新估价')
        uploadedSelection.current = assetId
      }
      if (controller.signal.aborted) return
      const request = buildCanvasSubjectEditRequest({
        kind: source.kind,
        mode,
        model,
        sourceAssetId: source.assetId,
        maskAssetId: isVideo ? undefined : uploadedSelection.current,
        videoSelection: videoSelection && {
          ...videoSelection,
          referenceAssetId: sendsVideoReference ? uploadedSelection.current : undefined,
        },
        target: targetDescription,
        description,
        replacementAssetId: replacement?.assetId,
        sourceVideoDurationSec: duration,
        ratio: videoRatio || source.ratio,
      })
      const result = await estimateAiTaskCost({ ...request, workspaceId })
      if (controller.signal.aborted) return
      if (
        !Number.isFinite(result?.estimated_cost) ||
        result.estimated_cost < 0 ||
        typeof result.can_afford !== 'boolean'
      )
        throw new Error('估价返回不完整，请重新估价')
      setQuote({
        request,
        cost: result.estimated_cost,
        canAfford: result.can_afford,
        kind: result.estimate_kind || '',
        note: result.estimate_note || '',
      })
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '估价失败，请重试')
    } finally {
      working.current = null
      if (!controller.signal.aborted) setPhase(null)
    }
  }

  async function submit() {
    if (!quote?.canAfford || working.current || analyzingSelection) return
    const controller = new AbortController()
    working.current = controller
    setPhase('submit')
    setError('')
    try {
      await onSubmit(quote.request, modeLabel)
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
        width={1040}
        zIndex={2200}
        onCancel={onClose}
        closable={!busy}
        keyboard={!busy && !replacementPickerOpen}
        maskClosable={false}
        modalRender={(modal) => <CanvasPortalBoundary>{modal}</CanvasPortalBoundary>}
        footer={
          <div className={styles.footer}>
            <span role="status">
              {phase === 'estimate'
                ? '正在估价…'
                : quote
                  ? `${quote.kind === 'reservation' ? '预冻结' : '预计消耗'} ${creditsLabel(quote.cost)}`
                  : ''}
            </span>
            <Button disabled={!ready || busy} onClick={estimate}>
              {quote ? '重新估价' : '估价'}
            </Button>
            <Button
              type="primary"
              loading={phase === 'submit'}
              disabled={!quote?.canAfford || busy || analyzingSelection}
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
                  onClick={() => {
                    if (value === mode) return
                    setMode(value)
                    setDescription('')
                    invalidateQuote()
                  }}
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
                        <Button size="small" disabled={busy} onClick={() => setEditingFrame(false)}>
                          返回视频
                        </Button>
                      ) : (
                        <Button size="small" disabled={busy || !duration || !!mediaError} onClick={markCurrentFrame}>
                          {frame ? '改标当前帧' : '标记当前帧'}
                        </Button>
                      )}
                      {frame && (
                        <Button
                          size="small"
                          disabled={busy}
                          onClick={() => {
                            changeSelection(false)
                            setFrame(null)
                            setEditingFrame(false)
                          }}
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
                  </div>
                  <video
                    ref={videoRef}
                    controls
                    preload="auto"
                    playsInline
                    hidden={editingFrame}
                    src={playbackUrl || sourceUrl}
                    aria-label="原视频"
                    onTimeUpdate={({ currentTarget }) => {
                      if (pendingSeek.current === null && !currentTarget.seeking)
                        setVideoTime(currentTarget.currentTime)
                    }}
                    onLoadedMetadata={({ currentTarget }) => {
                      const seconds = currentTarget.duration
                      const ratio = closestRatioOption(
                        currentTarget.videoWidth,
                        currentTarget.videoHeight,
                        SEEDANCE_RATIO_OPTIONS,
                      )
                      setVideoRatio(ratio)
                      setDuration(Number.isFinite(seconds) ? seconds : 0)
                      setMediaError(Number.isFinite(seconds) && seconds > 0 ? '' : '无法读取视频时长')
                      applyPendingSeek(currentTarget)
                    }}
                    onError={() => {
                      setDuration(0)
                      setMediaError('原视频无法读取，请重新选择素材')
                      invalidateQuote()
                    }}
                  />
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
                    onSelectSubjectName={setRecognizedTarget}
                  />
                </div>
              )}
              {isVideo && duration > 0 && (
                <CanvasSubjectVideoTimeline
                  sourceUrl={sourceUrl}
                  duration={duration}
                  currentTime={videoTime}
                  anchorTime={frame?.time}
                  disabled={busy || !!mediaError}
                  onSeek={seekVideo}
                  onJumpToAnchor={jumpToMarkedFrame}
                />
              )}
              {frame && (
                <p className={styles.selectionNote}>
                  {sendsVideoReference
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
                  {mode === 'modify' ? '修改说明' : replacement ? '替换说明（可选）' : '替换说明'}
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
              {showReplacementPicker && (
                <section className={styles.field} aria-label="替换参考图">
                  {replacement && (
                    <div className={styles.replacement}>
                      <img alt="替换参考图预览" src={replacement.src} />
                      <span>{replacement.name}</span>
                    </div>
                  )}
                  <div className={styles.frameActions}>
                    <Button size="small" disabled={busy} onClick={() => setReplacementPickerOpen(true)}>
                      {replacement ? '更换替换图片' : '选择替换图片'}
                    </Button>
                    {replacement && (
                      <Button
                        size="small"
                        disabled={busy}
                        onClick={() => {
                          setReplacementImage(null)
                          invalidateQuote()
                        }}
                      >
                        清除替换图片
                      </Button>
                    )}
                  </div>
                  {replacement && !supportsSingleReference && !selectionBounds && (
                    <p className={styles.selectionNote}>该模型还需要标记原视频里的旧主体。</p>
                  )}
                </section>
              )}
              {models.length > 0 && model && (
                <label className={styles.field}>
                  编辑模型
                  <CanvasToolSelect
                    aria-label="编辑模型"
                    value={String(getBackendGenerationModelVersionId(model))}
                    disabled={busy}
                    onChange={(event) => {
                      setModelId(Number(event.target.value))
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
              {loading && <span role="status">正在读取编辑模型…</span>}
              {!loading && !model && (
                <Alert
                  type={modelError ? 'error' : 'warning'}
                  message={modelError || '当前空间暂无支持此类主体编辑的模型'}
                  action={<Button onClick={() => setAttempt((value) => value + 1)}>重试</Button>}
                />
              )}
              {(mediaError || error) && <Alert type="error" message={mediaError || error} />}
              {quote?.note && <Alert type="info" message={quote.note} />}
              {quote && !quote.canAfford && <Alert type="warning" message="积分不足，暂时无法开始处理" />}
            </section>
          </div>
        </div>
      </Modal>
      {replacementPickerOpen && (
        <CanvasPortalBoundary>
          <CanvasMaterialPicker
            visible
            variant="modal"
            imageOnly
            overlayZIndex={2300}
            workspaceId={workspaceId}
            userId={Number(currentUser?.id ?? currentUser?.user_id) || undefined}
            onClose={() => setReplacementPickerOpen(false)}
            onApply={(material) => {
              setReplacementImage(material)
              setReplacementPickerOpen(false)
              invalidateQuote()
            }}
          />
        </CanvasPortalBoundary>
      )}
    </ConfigProvider>
  )
}
