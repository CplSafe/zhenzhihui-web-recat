import { useEffect, useRef, useState } from 'react'
import { Alert, Button, ConfigProvider, Modal, theme } from 'antd'
import { estimateAiTaskCost, extractPageItems, listAiModels, uploadAssetFile } from '@/api/business'
import { assetStreamUrl } from '@/utils/assetUrl'
import { creditsLabel } from '@/utils/creditsFormat'
import { getBackendGenerationModelVersionId } from '@/utils/generationModelCatalog'
import { closestRatioOption } from '@/utils/hotCopySourceMatch'
import { SEEDANCE_RATIO_OPTIONS } from '@/utils/videoOptions'
import {
  buildCanvasSubjectEditRequest,
  CANVAS_SUBJECT_EDIT_MODE_LABELS,
  getCanvasSubjectEditModels,
  getCanvasSubjectEditOperation,
  type CanvasSubjectEditKind,
  type CanvasSubjectEditMode,
} from '@/utils/canvasSubjectEdit'
import CanvasPortalBoundary from './CanvasPortalBoundary'
import CanvasSubjectMaskEditor, { type CanvasSubjectMaskEditorHandle } from './CanvasSubjectMaskEditor'
import CanvasToolSelect from './CanvasToolSelect'
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
  onClose: () => void
  onSubmit: (request: CanvasSubjectEditRequest, title: string) => Promise<void>
}

export default function CanvasSubjectEdit({ source, workspaceId, onClose, onSubmit }: Props) {
  const [mode, setMode] = useState<CanvasSubjectEditMode>('remove')
  const [target, setTarget] = useState('')
  const [description, setDescription] = useState('')
  const [duration, setDuration] = useState(0)
  const [videoRatio, setVideoRatio] = useState('')
  const [mediaError, setMediaError] = useState('')
  const [hasMask, setHasMask] = useState(false)
  const [models, setModels] = useState<ReturnType<typeof getCanvasSubjectEditModels>>([])
  const [modelId, setModelId] = useState(0)
  const [loading, setLoading] = useState(true)
  const [modelError, setModelError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState('')
  const [quote, setQuote] = useState<Quote | null>(null)
  const [phase, setPhase] = useState<'estimate' | 'submit' | null>(null)
  const maskEditor = useRef<CanvasSubjectMaskEditorHandle>(null)
  const uploadedMask = useRef(0)
  const working = useRef<AbortController | null>(null)
  const isVideo = source.kind === 'video'
  const sourceUrl = assetStreamUrl(source.assetId, workspaceId)
  const model = models.find((item) => getBackendGenerationModelVersionId(item) === modelId) || models[0]
  const busy = phase !== null
  const ready = Boolean(model && !loading && !mediaError && (isVideo ? duration > 0 && target.trim() : hasMask))
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

  useEffect(() => () => working.current?.abort(), [])

  function invalidateQuote() {
    setQuote(null)
    setError('')
  }

  async function estimate() {
    if (!ready || !model || working.current || (mode !== 'remove' && !description.trim())) return
    const controller = new AbortController()
    working.current = controller
    setPhase('estimate')
    invalidateQuote()
    try {
      if (!isVideo && !uploadedMask.current) {
        const file = await maskEditor.current?.exportMask()
        if (!file || controller.signal.aborted) return
        const uploaded = await uploadAssetFile({
          workspaceId,
          file,
          source: 'upload',
          signal: controller.signal,
        })
        const assetId = Number(uploaded?.asset?.id)
        if (!Number.isSafeInteger(assetId) || assetId <= 0) throw new Error('蒙版上传未返回素材，请重新估价')
        uploadedMask.current = assetId
      }
      if (controller.signal.aborted) return
      const request = buildCanvasSubjectEditRequest({
        kind: source.kind,
        mode,
        model,
        sourceAssetId: source.assetId,
        maskAssetId: uploadedMask.current,
        target,
        description,
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
    if (!quote?.canAfford || working.current) return
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
        width={720}
        zIndex={2200}
        onCancel={onClose}
        closable={!busy}
        keyboard={!busy}
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
            <Button disabled={!ready || busy || (mode !== 'remove' && !description.trim())} onClick={estimate}>
              {quote ? '重新估价' : '估价'}
            </Button>
            <Button type="primary" loading={phase === 'submit'} disabled={!quote?.canAfford || busy} onClick={submit}>
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
          {isVideo ? (
            <div className={styles.preview}>
              <video
                controls
                preload="metadata"
                playsInline
                src={sourceUrl}
                aria-label="原视频"
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
                }}
                onError={() => {
                  setDuration(0)
                  setMediaError('原视频无法读取，请重新选择素材')
                  invalidateQuote()
                }}
              />
              <span>{duration > 0 ? `整段处理 · ${Number(duration.toFixed(2))} 秒` : '正在读取原视频时长…'}</span>
            </div>
          ) : (
            <CanvasSubjectMaskEditor
              ref={maskEditor}
              src={sourceUrl}
              disabled={busy}
              onSelectionChange={(selected) => {
                setHasMask(selected)
                uploadedMask.current = 0
                invalidateQuote()
              }}
            />
          )}
          {isVideo && (
            <label className={styles.field}>
              要处理的主体
              <input
                value={target}
                disabled={busy}
                maxLength={150}
                placeholder="例如：道路中央正在行驶的黑色越野车"
                onChange={(event) => {
                  setTarget(event.target.value)
                  invalidateQuote()
                }}
              />
            </label>
          )}
          {mode !== 'remove' && (
            <label className={styles.field}>
              {mode === 'modify' ? '修改说明' : '替换说明'}
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
        </div>
      </Modal>
    </ConfigProvider>
  )
}
