import { imageGenerationInfo } from '@/utils/canvasImageInfo'
import { useEffect, useRef, useState } from 'react'
import type { Node } from '@xyflow/react'
import CanvasPortalBoundary from './CanvasPortalBoundary'
import { EmptyModelNotice } from '@/components/common/ModelAvailabilityNotice'
import { Alert, Button, Modal, Radio, Select, Spin } from 'antd'
import { createAiTask, estimateAiTaskCost, getAiTaskId, getAiTask, listAiModels, waitForAiTask } from '@/api/business'
import type { ToolField } from '@/api/canvasTools'
import type { HdTask, HdSource } from '@/api/canvasHd'
import type { HdRequest } from './CanvasHdWorkspace'
import { hdSources } from '@/utils/canvasHd'
import { creditsYuanLabel } from '@/utils/creditsYuan'
import { activeToolParams, fieldOptions, fieldVisible, schemaDefaults, validateToolFields } from '@/utils/canvasTools'
import CanvasToolFields from './CanvasToolFields'
import { showToast } from '@/stores/ui'
import { extractOutputAssetId, findAssetIdByTaskId } from '@/utils/taskMedia'
import { assetStreamUrl } from '@/utils/assetUrl'
import { upscaleDisplayFields, upscaleImageSize } from '@/utils/canvasUpscale'
import { uploadAssetFile } from '@/api/business'
import { fitUpscaleInput, createUpscaleInputFile } from '@/utils/upscaleInput'
import styles from './CanvasUpscale.module.css'

interface Model {
  id: number
  display_name?: string
  name?: string
  operation_codes?: string[]
  params_schema?: { fields?: ToolField[] } | string
}
export interface VideoUpscaleSubmission {
  source: HdSource
  modelName?: string
  paramLabels?: Record<string, string>
  request: {
    kind: 'video'
    prompt: string
    modelVersionId: number
    operationCode: string
    params: Record<string, unknown>
    inputAssets: Array<{ asset_id: number; role: string }>
  }
}
export function upscaleFields(model?: Model, operation = ''): ToolField[] {
  let schema = model?.params_schema
  if (typeof schema === 'string') {
    try {
      schema = JSON.parse(schema)
    } catch {
      return []
    }
  }
  return typeof schema === 'object' && Array.isArray(schema?.fields)
    ? schema.fields.filter(
        (field) =>
          !['input_assets', 'image_urls', 'video_url', 'prompt', 'stream'].includes(field.name) &&
          (!field.operation_codes?.length || field.operation_codes.includes(operation)),
      )
    : []
}

export default function CanvasUpscale(props: {
  anchor?: { centerX: number; bottom: number } | null
  workspaceId: number
  canvasId: number
  nodes: Node[]
  request: HdRequest | null
  onCloseRequest: () => void
  onSubmitted: () => void
  onTasks: (tasks: HdTask[]) => void
  onModalChange: (open: boolean) => void
  onVideoGenerate?: (submission: VideoUpscaleSubmission) => Promise<void>
}) {
  const source = hdSources(props.nodes.filter((node) => props.request?.ids.includes(node.id)))[0]
  const operation = source ? `${source.kind}.upscale` : ''
  const [catalogRetry, setCatalogRetry] = useState(0)
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight })
  const [panelHeight, setPanelHeight] = useState(350)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [models, setModels] = useState<Model[]>([])
  const [modelId, setModelId] = useState(0)
  const [editableValues, setValues] = useState<Record<string, unknown>>({})
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [quote, setQuote] = useState<any>(null)
  const [quoting, setQuoting] = useState(false)
  const [quoteError, setQuoteError] = useState('')
  const [sourceSize, setSourceSize] = useState<{ key: string; width: number; height: number } | null>(null)
  const [prepared, setPrepared] = useState<{ key: string; assetId: number } | null>(null)
  const [sizeError, setSizeError] = useState('')
  const prepareController = useRef<AbortController | null>(null)
  const lock = useRef(false)
  const submittingKeys = useRef(new Set<string>())
  const tasks = useRef<HdTask[]>([])
  const key = useRef('')
  const controller = useRef(new AbortController())
  useEffect(() => {
    const active = new AbortController()
    controller.current = active
    return () => active.abort()
  }, [])
  const open = Boolean(props.request)
  const mediaUrl = open && source ? assetStreamUrl(source.asset_id, props.workspaceId) : ''
  const mediaKind = source?.kind
  useEffect(() => {
    setSourceSize(null)
    setSizeError('')
    setPrepared(null)
    if (!mediaUrl || !mediaKind) return
    let active = true
    const media = mediaKind === 'image' ? new Image() : document.createElement('video')
    const loaded = () => {
      const width = media instanceof HTMLVideoElement ? media.videoWidth : (media as HTMLImageElement).naturalWidth
      const height = media instanceof HTMLVideoElement ? media.videoHeight : (media as HTMLImageElement).naturalHeight
      if (active && width > 0 && height > 0) setSourceSize({ key: mediaUrl, width, height })
    }
    if (media instanceof HTMLVideoElement) {
      media.preload = 'metadata'
      media.onloadedmetadata = loaded
    } else media.onload = loaded
    media.onerror = () => {
      if (active) setSizeError('无法读取原图尺寸，请关闭面板后重试')
    }
    media.src = mediaUrl
    return () => {
      active = false
      prepareController.current?.abort()
      media.onerror = null
      media.onload = null
      if (media instanceof HTMLVideoElement) {
        media.onloadedmetadata = null
        media.removeAttribute('src')
        media.load()
      } else media.src = ''
    }
  }, [mediaUrl, mediaKind])
  useEffect(() => {
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  useEffect(() => {
    if (!open || !bodyRef.current) return
    let frame = 0
    const observer = new ResizeObserver(([entry]) => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setPanelHeight(Math.ceil(entry.contentRect.height) + 78))
    })
    observer.observe(bodyRef.current)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [open, loading, modelId])
  const { onModalChange } = props
  useEffect(() => {
    onModalChange(open)
  }, [open, onModalChange])
  useEffect(() => {
    setQuote(null)
    setError('')
    setModels([])
    setModelId(0)
    setValues({})
    setBusy(false)
    key.current = crypto.randomUUID()
    if (!open || !operation) return
    const abort = new AbortController()
    setLoading(true)
    listAiModels({ workspaceId: props.workspaceId, operationCode: operation, plan: '', signal: abort.signal })
      .then((list) => {
        if (abort.signal.aborted) return
        const available = (Array.isArray(list) ? list : []).filter((m: Model) => m.operation_codes?.includes(operation))
        setModels(available)
        setModelId(Number(available[0]?.id || 0))
        setValues(schemaDefaults(upscaleFields(available[0], operation)))
      })
      .catch((err) => {
        if (!abort.signal.aborted) setError(err.message)
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false)
      })
    return () => abort.abort()
  }, [open, operation, props.workspaceId, props.request?.key, catalogRetry])
  const model = models.find((m) => Number(m.id) === modelId)
  const fields = upscaleFields(model, operation)
  // 图片超分的分辨率和细节程度固定，估价、校验与提交共用同一组值。
  const fixedValues: Record<string, unknown> = {}
  if (source?.kind === 'image') {
    for (const field of fields) {
      const eightK = fieldOptions(field).find(
        (option) => /^8k$/i.test(String(option.value)) || /^8k$/i.test(option.label),
      )
      if (/resolution/.test(field.name) && eightK) fixedValues[field.name] = eightK.value
      if (field.display_name === '细节生成程度') fixedValues[field.name] = 100
    }
  }
  const values = { ...editableValues, ...fixedValues }
  const editableFields = fields.filter((field) => !Object.prototype.hasOwnProperty.call(fixedValues, field.name))
  const choiceFields = editableFields.filter(
    (field) =>
      field.name !== 'multiple' &&
      fieldOptions(field).length > 0 &&
      (source?.kind === 'video' || /resolution|enhance|style/.test(field.name)),
  )
  const multipleField = fields.find((field) => field.name === 'multiple' && fieldVisible(field, values))
  const multipleOptions = multipleField ? fieldOptions(multipleField) : []
  const multiples = multipleField
    ? (multipleOptions.length
        ? multipleOptions.map((option) => Number(option.value))
        : multipleField.min !== undefined && multipleField.max !== undefined
          ? [2, 4, 6]
          : []
      ).filter(
        (value) =>
          Number.isFinite(value) &&
          value > 0 &&
          (multipleField.min === undefined || value >= multipleField.min) &&
          (multipleField.max === undefined || value <= multipleField.max) &&
          (!multipleField.step ||
            Math.abs(
              (value - (multipleField.min ?? 0)) / multipleField.step -
                Math.round((value - (multipleField.min ?? 0)) / multipleField.step),
            ) < 1e-8),
      )
    : []
  const changeValues = (next: Record<string, unknown>) => {
    setValues(next)
    key.current = crypto.randomUUID()
  }
  const activeParams = activeToolParams(fields, values)
  const knownSize = sourceSize?.key === mediaUrl ? sourceSize : null
  const inputSize = knownSize ? fitUpscaleInput(knownSize.width, knownSize.height) : null
  const needsResize = source?.kind === 'image' && knownSize && (knownSize.width > 4096 || knownSize.height > 4096)
  const preparedId = prepared?.key === mediaUrl ? prepared.assetId : 0
  const inputReady = source?.kind !== 'image' || (knownSize && (!needsResize || preparedId > 0))
  async function prepareInput() {
    if (lock.current || !source || !needsResize) return
    lock.current = true
    setBusy(true)
    setError('')
    const abort = new AbortController()
    prepareController.current = abort
    try {
      const file = await createUpscaleInputFile(mediaUrl, source.name, abort.signal)
      const result = await uploadAssetFile({ workspaceId: props.workspaceId, file, signal: abort.signal })
      const assetId = Number(result.asset?.id)
      if (!(assetId > 0)) throw new Error('缩小副本上传失败，请重试')
      if (!abort.signal.aborted) setPrepared({ key: mediaUrl, assetId })
    } catch (err) {
      if (!abort.signal.aborted) setError(err instanceof Error ? err.message : '缩小副本失败，请重试')
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  const targetSize =
    source?.kind === 'image' && inputSize ? upscaleImageSize(inputSize.width, inputSize.height, activeParams) : null
  const body =
    source && model && inputReady
      ? {
          workspaceId: props.workspaceId,
          modelVersionId: modelId,
          operationCode: model.operation_codes!.find((op) => op === operation),
          // 图片超分仅使用素材和模型参数；视频超分保留现有描述契约。
          ...(source.kind === 'video'
            ? { prompt: '请按超分参数提升参考视频的清晰度，保持原视频内容、时长和主体不变。' }
            : {}),
          params: activeParams,
          inputAssets: [{ asset_id: needsResize ? preparedId : source.asset_id, role: source.kind }],
        }
      : null
  const fingerprint = JSON.stringify(body)
  const validationError = validateToolFields(fields, values)
  useEffect(() => {
    setQuote(null)
    setQuoteError('')
    setQuoting(false)
    if (!open || fingerprint === 'null' || validationError) return
    let active = true
    setQuoting(true)
    const timer = window.setTimeout(() => {
      void estimateAiTaskCost(JSON.parse(fingerprint))
        .then((result) => {
          if (!active) return
          if (
            !Number.isFinite(result?.estimated_cost) ||
            result.estimated_cost < 0 ||
            !Number.isFinite(result?.balance) ||
            result.balance < 0 ||
            typeof result?.can_afford !== 'boolean'
          )
            throw new Error('估价信息不完整，请重试')
          setQuote({ ...result, key: fingerprint })
        })
        .catch((err) => {
          if (active) setQuoteError(err instanceof Error ? err.message : '费用计算失败，请调整参数后重试')
        })
        .finally(() => {
          if (active) setQuoting(false)
        })
    }, 300)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [fingerprint, open, validationError])
  const currentQuote = quote?.key === fingerprint ? quote : null
  async function run() {
    const submissionKey = key.current
    if (lock.current || submittingKeys.current.has(submissionKey) || !source || !body) return
    if (!currentQuote || !currentQuote.can_afford || currentQuote.balance < currentQuote.estimated_cost) return
    const validation = validateToolFields(fields, values)
    if (validation) {
      setError(validation)
      return
    }
    submittingKeys.current.add(submissionKey)
    setBusy(true)
    setError('')
    try {
      if (source.kind === 'video' && props.onVideoGenerate) {
        await props.onVideoGenerate({
          source,
          modelName: model.display_name || model.name || `超分模型 #${modelId}`,
          paramLabels: Object.fromEntries(fields.map((field) => [field.name, field.display_name || field.name])),
          request: {
            kind: 'video',
            prompt: body.prompt,
            modelVersionId: body.modelVersionId,
            operationCode: body.operationCode,
            params: body.params,
            inputAssets: body.inputAssets,
          },
        })
        return
      }
      const base: HdTask = {
        id: `submission-${submissionKey}`,
        ...(source.kind === 'image'
          ? { image_info: imageGenerationInfo(body, model.display_name || model.name || '', new Date().toISOString()) }
          : {}),
        workspace_id: props.workspaceId,
        canvas_id: props.canvasId,
        canvas_name: '',
        source,
        source_spec: '',
        target: { resolution: '', fps: 0 },
        status: 'queued',
        submitted_at: new Date().toISOString(),
        credits: quote.estimated_cost,
        refund_status: 'none',
        refunded_credits: 0,
      }
      const publish = (current: any) => {
        if (controller.current.signal.aborted) return
        const output = current.outputs?.find((item: any) => Number(item.asset_id || item.asset?.id) > 0)
        const status = ['succeeded', 'completed', 'success'].includes(current.status)
          ? 'completed'
          : ['failed', 'error', 'payment_failed', 'cancelled', 'expired'].includes(current.status)
            ? 'failed'
            : 'processing'
        const row: HdTask = {
          ...base,
          status,
          task_id: getAiTaskId(current) || undefined,
          error: current.error_message || current.error?.message || '',
          result: output
            ? {
                asset_id: Number(output.asset_id || output.asset?.id),
                name: `${source.name}超分`,
                spec: '',
                width: Number(output.width || 0),
                height: Number(output.height || 0),
                review_policy: '',
              }
            : undefined,
        }
        tasks.current = [...tasks.current.filter((item) => item.id !== row.id), row]
        props.onTasks(tasks.current)
      }
      publish({ status: 'queued' })
      props.onCloseRequest()
      props.onSubmitted()
      let task: any
      try {
        task = await createAiTask({
          ...body,
          modelVersion: model,
          capability: source.kind,
          idempotencyKey: submissionKey,
        })
      } catch (err) {
        publish({ status: 'failed', error_message: err instanceof Error ? err.message : '超分请求失败' })
        showToast(err instanceof Error ? err.message : '超分请求失败', 'error')
        return
      }
      publish(task)
      void getAiTask({ workspaceId: props.workspaceId, taskId: getAiTaskId(task) })
        .then((detail) =>
          waitForAiTask({
            workspaceId: props.workspaceId,
            task: detail,
            intervalMs: 3000,
            timeoutMs: 3600000,
            signal: controller.current.signal,
            onPoll: publish,
          }),
        )
        .then(async (completed) => {
          const assetId =
            extractOutputAssetId(completed) ||
            (await findAssetIdByTaskId(props.workspaceId, getAiTaskId(task), source.kind))
          if (controller.current.signal.aborted) return
          if (!assetId) throw new Error('超分已完成，但结果素材尚未入库，请在素材库中查看')
          publish({ ...completed, outputs: [{ asset_id: assetId }], status: 'completed' })
          showToast('超分完成，已添加到画布', 'success')
        })
        .catch((err) => {
          if (!controller.current.signal.aborted) {
            publish({ status: 'failed', id: getAiTaskId(task), error_message: err.message || '超分任务查询失败' })
            showToast(err.message || '超分任务查询失败', 'error')
          }
        })
    } catch (err) {
      if (key.current === submissionKey) setError(err instanceof Error ? err.message : '超分请求失败')
    } finally {
      submittingKeys.current.delete(submissionKey)
      if (key.current === submissionKey) setBusy(false)
    }
  }
  return (
    <Modal
      zIndex={1800}
      open={open}
      title="超分"
      footer={null}
      mask
      focusTriggerAfterClose={false}
      modalRender={(modal) => <CanvasPortalBoundary>{modal}</CanvasPortalBoundary>}
      width={420}
      className={styles.panel}
      wrapClassName={styles.window}
      style={{
        left: Math.max(
          12,
          Math.min(
            viewport.width - Math.min(420, viewport.width - 24) - 12,
            (props.anchor?.centerX ?? viewport.width / 2) - 210,
          ),
        ),
        top: Math.max(12, Math.min(viewport.height - panelHeight - 24, (props.anchor?.bottom ?? 100) + 12)),
      }}
      onCancel={() => {
        if (!busy) props.onCloseRequest()
      }}
      maskClosable={false}
    >
      {loading ? (
        <Spin />
      ) : !source || source.asset_id <= 0 ? (
        <Alert type="warning" message="请选择已上传或生成的图片、视频" />
      ) : !models.length ? (
        error ? (
          <Alert
            type="error"
            message={error}
            action={<Button onClick={() => setCatalogRetry((value) => value + 1)}>重新加载</Button>}
          />
        ) : (
          <EmptyModelNotice
            workspaceId={props.workspaceId}
            label="超分模型"
            onReload={() => setCatalogRetry((value) => value + 1)}
          />
        )
      ) : (
        <div ref={bodyRef} className={styles.body}>
          <div className={styles.row}>
            <span>模型选择</span>
            <Select
              aria-label="超分模型"
              value={modelId}
              disabled={busy}
              style={{ width: '100%' }}
              options={models.map((m) => ({ value: Number(m.id), label: m.display_name || m.name }))}
              onChange={(id) => {
                setModelId(id)
                setValues(
                  schemaDefaults(
                    upscaleFields(
                      models.find((m) => Number(m.id) === id),
                      operation,
                    ),
                  ),
                )
                key.current = crypto.randomUUID()
              }}
            />
          </div>
          <div className={styles.fields}>
            {fields
              .filter(
                (field) => Object.prototype.hasOwnProperty.call(fixedValues, field.name) && fieldVisible(field, values),
              )
              .map((field) => (
                <div className={styles.row} key={field.name}>
                  <span>{field.display_name || field.name}</span>
                  <span>{fixedValues[field.name] === 100 ? '100' : '8K'}</span>
                </div>
              ))}
            {upscaleDisplayFields(choiceFields)
              .filter((field) => fieldVisible(field, values))
              .map((field) => (
                <div className={styles.row} key={field.name}>
                  <span>{field.display_name || field.name}</span>
                  <Radio.Group
                    aria-label={field.display_name || field.name}
                    optionType="button"
                    buttonStyle="solid"
                    disabled={busy}
                    value={values[field.name]}
                    options={fieldOptions(field) as Array<{ value: string | number; label: string }>}
                    onChange={(event) => changeValues({ ...values, [field.name]: event.target.value })}
                  />
                </div>
              ))}
            <CanvasToolFields
              fields={upscaleDisplayFields(
                editableFields.filter((field) => field.name !== 'multiple' && !choiceFields.includes(field)),
              )}
              values={values}
              disabled={busy}
              onChange={changeValues}
            />
          </div>
          {multipleField && (
            <div className={styles.row}>
              <span>放大倍数</span>
              <div className={styles.choices} role="group" aria-label="放大倍数">
                {multiples.map((value) => (
                  <button
                    type="button"
                    key={value}
                    disabled={busy}
                    aria-pressed={values.multiple === value}
                    onClick={() => changeValues({ ...values, multiple: value })}
                  >
                    {value} 倍
                  </button>
                ))}
                {!multipleOptions.length && (
                  <input
                    type="number"
                    aria-label="放大倍率（倍）"
                    title="自定义放大倍率"
                    disabled={busy}
                    min={multipleField.min}
                    max={multipleField.max}
                    step={multipleField.step ?? (multipleField.type === 'integer' ? 1 : 'any')}
                    value={values.multiple === undefined ? '' : Number(values.multiple)}
                    onChange={(event) =>
                      changeValues({
                        ...values,
                        multiple: event.target.value === '' ? undefined : Number(event.target.value),
                      })
                    }
                  />
                )}
              </div>
            </div>
          )}
          <div aria-live="polite" className={styles.sizes}>
            <div>原始尺寸：{knownSize ? `${knownSize.width} × ${knownSize.height} 像素` : '暂未获取到素材尺寸'}</div>
            {source.kind === 'image' ? (
              <div>预计输出：{targetSize ? `${targetSize.width} × ${targetSize.height} 像素` : '由模型参数决定'}</div>
            ) : (
              <div>
                目标分辨率：
                {String(
                  activeParams.resolution ||
                    (activeParams.resolution_limit ? `短边 ${activeParams.resolution_limit} 像素` : '由模型参数决定'),
                )}
              </div>
            )}
            <small>最终输出尺寸以处理结果为准。</small>
          </div>
          {source.kind === 'image' && sizeError && <Alert type="error" message={sizeError} />}
          {needsResize && inputSize && (
            <Alert
              type="warning"
              message="原图宽或高超过 4096 像素"
              description={
                <>
                  <div>
                    将等比缩小为 {inputSize.width} × {inputSize.height}{' '}
                    像素的副本后提交，原图保留。预计输出按副本尺寸计算。
                  </div>
                  {preparedId ? (
                    <div role="status">缩小副本已准备好</div>
                  ) : (
                    <Button loading={busy} onClick={() => void prepareInput()}>
                      等比缩小并准备超分
                    </Button>
                  )}
                </>
              }
            />
          )}
          <details className={styles.details}>
            <summary>参数说明</summary>
            {upscaleDisplayFields(fields)
              .filter((field) => field.help)
              .map((field) => (
                <p key={field.name}>{field.help}</p>
              ))}
          </details>
          {currentQuote && (!currentQuote.can_afford || currentQuote.estimate_note) && (
            <Alert
              type={quote.can_afford ? 'info' : 'warning'}
              message={`${quote.estimate_kind === 'reservation' ? '预冻结金额' : '预估费用'}：${creditsYuanLabel(quote.estimated_cost)} · 余额 ${quote.balance} 积分`}
              description={quote.estimate_note}
            />
          )}
          <div className={styles.footer}>
            <span className={styles.cost} aria-live="polite">
              {currentQuote
                ? `${currentQuote.estimate_kind === 'reservation' ? '预冻结' : '预计'} ${creditsYuanLabel(currentQuote.estimated_cost)}`
                : quoting
                  ? '正在计算费用…'
                  : quoteError || '等待有效参数以计算费用'}
            </span>
            <Button
              type="primary"
              loading={busy}
              disabled={!currentQuote || !currentQuote.can_afford || currentQuote.balance < currentQuote.estimated_cost}
              onClick={() => void run()}
            >
              确认超分
            </Button>
          </div>
        </div>
      )}
      {error && <Alert type="error" message={error} style={{ marginTop: 12 }} />}
    </Modal>
  )
}
