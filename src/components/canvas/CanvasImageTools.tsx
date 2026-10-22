import CanvasToolSelect from './CanvasToolSelect'
import CanvasPortalBoundary from './CanvasPortalBoundary'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, ConfigProvider, Modal, Spin } from 'antd'
import { listCanvasTools, type CreativeTool, type ToolField } from '@/api/canvasTools'
import { estimateAiTaskCost, listAiModels } from '@/api/business'
import {
  availableCanvasImageTools,
  buildToolGeneration,
  normalizeMultiAngleValues,
  schemaDefaults,
  type ToolGeneration,
} from '@/utils/canvasTools'
import { assetStreamUrl } from '@/utils/assetUrl'
import { creditsYuanLabel } from '@/utils/creditsYuan'
import { panoramaModelDefaults, studioLightPosition, studioLightDirection } from '@/utils/canvasStudioControls'
import CanvasToolFields from './CanvasToolFields'
import CanvasToolScene from './CanvasToolScene'
import CanvasAngleEditor from './CanvasAngleEditor'
import styles from './CanvasImageTools.module.css'

export interface ToolImage {
  nodeId: string
  assetId: number
  title: string
}
export interface CanvasToolSubmission {
  request: ToolGeneration
  images: ToolImage[]
  title: string
}
interface Props {
  workspaceId: number
  source: ToolImage
  images: ToolImage[]
  initialTool: string
  anchor?: { centerX: number; bottom: number } | null
  onHeightChange?: (height: number) => void
  initialView?: Record<string, unknown>
  onClose: () => void
  onGenerate: (submission: CanvasToolSubmission) => Promise<void>
  onCapture: (blob: Blob, values: Record<string, unknown>) => Promise<void>
  onViewChange: (values: Record<string, unknown>) => void
}
interface Model {
  id: number
  display_name?: string
  name?: string
  params_schema?: { fields?: ToolField[] } | string
  operation_codes?: string[]
}

function modelFields(model: Model | undefined, operationCode?: string): ToolField[] {
  let schema = model?.params_schema
  if (typeof schema === 'string') {
    try {
      schema = JSON.parse(schema)
    } catch {
      return []
    }
  }
  if (!schema || typeof schema !== 'object') return []
  return (schema.fields || []).filter(
    (f) =>
      ![
        'tool',
        'tool_version',
        'tool_params',
        'image_urls',
        'mask',
        'previous_task_id',
        'input_assets',
        'stream',
      ].includes(f.name) &&
      (!f.operation_codes?.length || f.operation_codes.includes(operationCode || '')),
  )
}

export default function CanvasImageTools(props: Props) {
  const [tools, setTools] = useState<CreativeTool[]>([])
  const [models, setModels] = useState<Model[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [code, setCode] = useState(props.initialTool)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    listCanvasTools(props.workspaceId, controller.signal)
      .then(async (catalog) => {
        const availableTools = availableCanvasImageTools(catalog)
        const selected = availableTools.find((entry) => entry.code === code)
        const modelList =
          selected?.execution === 'prompt_workflow' && selected.operation_code && selected.model_version_ids?.length
            ? await listAiModels({
                workspaceId: props.workspaceId,
                operationCode: selected.operation_code,
                plan: '',
                signal: controller.signal,
              })
            : []
        if (controller.signal.aborted) return
        setTools(availableTools)
        setModels(Array.isArray(modelList) ? modelList : [])
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : '工具目录加载失败')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [props.workspaceId, attempt, code])
  const tool = tools.find((t) => t.code === code)
  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#11a98a',
          colorInfo: '#11a98a',
          borderRadius: 8,
          fontFamily: "'PingFang SC', sans-serif",
        },
      }}
      button={{ autoInsertSpace: false }}
    >
      <Modal
        className={styles.dialog}
        open
        title={
          <div className={styles.heading}>
            <span>{tool?.display_name || '图片工具'}</span>
          </div>
        }
        footer={null}
        width={code === 'panorama.view' ? 960 : 640}
        mask={false}
        modalRender={(modal) => <CanvasPortalBoundary floating>{modal}</CanvasPortalBoundary>}
        wrapClassName={styles.toolWindow}
        style={
          props.anchor
            ? {
                left: Math.max(
                  16,
                  Math.min(
                    window.innerWidth - (code === 'panorama.view' ? 960 : 640) - 16,
                    props.anchor.centerX - (code === 'panorama.view' ? 960 : 640) / 2,
                  ),
                ),
                top: props.anchor.bottom + 12,
                bottom: 'auto',
              }
            : undefined
        }
        zIndex={2200}
        onCancel={props.onClose}
        destroyOnClose
        maskClosable={false}
      >
        {loading ? (
          <Spin tip="正在读取工具与模型目录…">
            <div style={{ height: 240 }} />
          </Spin>
        ) : error ? (
          <Alert type="error" message={error} action={<Button onClick={() => setAttempt((n) => n + 1)}>重试</Button>} />
        ) : (
          <>
            {code === 'image.panorama' && tools.some((entry) => entry.code === 'panorama.view') && (
              <div className={styles.sceneToolbar}>
                <Button onClick={() => setCode('panorama.view')}>浏览已有全景图</Button>
              </div>
            )}
            {code === 'panorama.view' && tools.some((entry) => entry.code === 'image.panorama') && (
              <Button type="text" onClick={() => setCode('image.panorama')}>
                返回全景生成
              </Button>
            )}
            {tool ? (
              <ToolEditor key={code} {...props} tool={tool} models={models} />
            ) : (
              <Alert type="warning" message="当前空间未提供此工具，请选择其他工具或联系管理员。" />
            )}
          </>
        )}
      </Modal>
    </ConfigProvider>
  )
}

function ToolEditor({ tool, models, ...props }: Props & { tool: CreativeTool; models: Model[] }) {
  const browser = tool.execution === 'browser' && tool.code === 'panorama.view'
  const { onHeightChange } = props
  const compactRoot = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const content = compactRoot.current?.closest('.ant-modal-content')
    if (!content || !onHeightChange) return
    const observer = new ResizeObserver(() => onHeightChange?.(Math.ceil(content.getBoundingClientRect().height)))
    observer.observe(content)
    return () => observer.disconnect()
  }, [onHeightChange])

  const allowed = useMemo(
    () =>
      models.filter(
        (model) =>
          tool.model_version_ids?.includes(Number(model.id)) &&
          model.operation_codes?.includes(tool.operation_code || ''),
      ),
    [models, tool.model_version_ids, tool.operation_code],
  )
  const [modelId, setModelId] = useState(Number(allowed[0]?.id || 0))
  const fields = tool.params_schema?.fields || []
  const defaults = () => {
    const initial = schemaDefaults(fields)
    return tool.code === 'image.relight' ? { ...studioLightPosition(initial.key_light), ...initial } : initial
  }
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    browser ? { yaw: 0, pitch: 0, fov: 65, ...schemaDefaults(fields), ...props.initialView } : defaults(),
  )
  const [prompt, setPrompt] = useState('')
  const [referenceId, setReferenceId] = useState('')
  const selectedModel = allowed.find((m) => Number(m.id) === modelId)
  const nativeFields = useMemo(
    () =>
      modelFields(selectedModel, tool.operation_code).filter(
        (field) => tool.code !== 'image.relight' || field.name !== 'size',
      ),
    [selectedModel, tool.operation_code, tool.code],
  )
  const nativeDefaults = (list: ToolField[]) =>
    tool.code === 'image.panorama' ? panoramaModelDefaults(list, schemaDefaults(list)) : schemaDefaults(list)
  const [nativeValues, setNativeValues] = useState(() => nativeDefaults(nativeFields))
  useEffect(() => {
    if (allowed.some((model) => Number(model.id) === modelId)) return
    const next = allowed[0]
    setModelId(Number(next?.id || 0))
    const nextFields = modelFields(next, tool.operation_code)
    const nextValues = schemaDefaults(nextFields)
    setNativeValues(tool.code === 'image.panorama' ? panoramaModelDefaults(nextFields, nextValues) : nextValues)
  }, [allowed, modelId, tool.code, tool.operation_code])
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [submitError, setSubmitError] = useState('')
  const [retryQuote, setRetryQuote] = useState(0)
  const [quote, setQuote] = useState<{
    key: string
    cost: number
    balance: number
    canAfford: boolean
    kind: string
    note: string
  } | null>(null)
  const [quoteError, setQuoteError] = useState('')
  const [estimating, setEstimating] = useState(false)
  const reference = props.images.find((image) => image.nodeId === referenceId)
  const images =
    tool.code === 'image.relight' && values.mode === 'reference' && reference
      ? [props.source, reference]
      : [props.source]
  let request: ToolGeneration | null = null
  let validation = ''
  if (!browser) {
    try {
      if (!allowed.length) throw new Error('当前空间暂无可用模型')
      if (!selectedModel) throw new Error('正在更新可用模型，请稍候')
      request = buildToolGeneration({
        tool,
        modelId,
        values,
        prompt,
        modelFields: nativeFields,
        modelValues: nativeValues,
        assetIds: images.map((image) => image.assetId),
      })
    } catch (err) {
      validation = err instanceof Error ? err.message : '参数无效'
    }
  }
  const requestKey = request ? JSON.stringify(request) : ''
  useEffect(() => {
    setQuote(null)
    setQuoteError('')
    if (!requestKey || browser) {
      setEstimating(false)
      return
    }
    let cancelled = false
    setEstimating(true)
    const timer = window.setTimeout(async () => {
      try {
        const body = JSON.parse(requestKey) as ToolGeneration
        const result = await estimateAiTaskCost({
          workspaceId: props.workspaceId,
          modelVersionId: body.modelVersionId,
          operationCode: body.operationCode,
          params: body.params,
          prompt: body.prompt,
          inputAssets: body.inputAssets,
        })
        if (
          !Number.isFinite(result?.estimated_cost) ||
          result.estimated_cost < 0 ||
          !Number.isFinite(result.balance) ||
          typeof result.can_afford !== 'boolean'
        )
          throw new Error('估价返回不完整，请重试')
        if (!cancelled)
          setQuote({
            key: requestKey,
            cost: result.estimated_cost,
            balance: result.balance,
            canAfford: result.can_afford,
            kind: result.estimate_kind,
            note: result.estimate_note || '',
          })
      } catch (err) {
        if (!cancelled) setQuoteError(err instanceof Error ? err.message : '估价失败')
      } finally {
        if (!cancelled) setEstimating(false)
      }
    }, 450)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [requestKey, browser, props.workspaceId, retryQuote])
  const currentQuote = quote?.key === requestKey ? quote : null
  const viewFields: ToolField[] = [
    { name: 'yaw', display_name: '水平视角', type: 'number', min: 0, max: 360, step: 1 },
    { name: 'pitch', display_name: '俯仰视角', type: 'number', min: -85, max: 85, step: 1 },
    { name: 'fov', display_name: '视野', type: 'number', min: 30, max: 110, step: 1 },
  ]
  const updateValues = (next: Record<string, unknown>) => {
    if (tool.code === 'image.multi_angle') next = normalizeMultiAngleValues(next)
    if (tool.code === 'image.relight') {
      if (next.key_light !== values.key_light) next = { ...next, ...studioLightPosition(next.key_light) }
      else if (next.light_azimuth !== values.light_azimuth || next.light_elevation !== values.light_elevation) {
        next = {
          ...next,
          key_light: studioLightDirection(Number(next.light_azimuth || 0), Number(next.light_elevation || 0)),
        }
      }
    }
    // 拖动控件同样遵守目录返回的范围、整数类型及步长。
    for (const field of fields) {
      const value = next[field.name]
      if (typeof value !== 'number') continue
      let bounded = Math.max(field.min ?? -Infinity, Math.min(field.max ?? Infinity, value))
      if (field.step && field.step > 0)
        bounded = Math.round((bounded - (field.min || 0)) / field.step) * field.step + (field.min || 0)
      if (['integer', 'int'].includes(field.type)) bounded = Math.round(bounded)
      next = { ...next, [field.name]: bounded }
    }
    setValues(next)
    if (browser) props.onViewChange(next)
  }
  if (['image.multi_angle', 'image.relight', 'image.panorama'].includes(tool.code)) {
    const angle = tool.code === 'image.multi_angle'
    const panorama = tool.code === 'image.panorama'
    const reset = () => {
      updateValues(defaults())
      setNativeValues(nativeDefaults(nativeFields))
      setPrompt('')
      setReferenceId('')
    }
    return (
      <div ref={compactRoot} className={`${styles.compactStudio} ${panorama ? styles.panoramaStudio : ''}`}>
        {!angle && !panorama && (
          <div className={styles.studioPresets}>
            <CanvasToolFields
              fields={fields.filter((field) => field.name === 'mode' || field.name === 'preset')}
              values={values}
              onChange={updateValues}
              disabled={busy}
            />
          </div>
        )}
        <div className={styles.studioVisual}>
          {angle ? (
            <CanvasAngleEditor
              compact
              url={assetStreamUrl(props.source.assetId, props.workspaceId)}
              values={values}
              onChange={updateValues}
              disabled={busy}
            />
          ) : panorama ? (
            <img
              className={styles.studioSource}
              src={assetStreamUrl(props.source.assetId, props.workspaceId)}
              alt="全景生成参考图"
            />
          ) : (
            <CanvasToolScene
              compact
              mode="light"
              url={assetStreamUrl(props.source.assetId, props.workspaceId)}
              values={values}
              onChange={updateValues}
              disabled={busy}
            />
          )}
        </div>
        <div className={styles.studioParams}>
          {(allowed.length > 1 || (!angle && !panorama)) && (
            <label className={styles.modelLine}>
              <span>模型</span>
              <CanvasToolSelect
                aria-label="生成模型"
                value={modelId}
                disabled={busy}
                onChange={(event) => {
                  const id = Number(event.target.value)
                  setModelId(id)
                  setNativeValues(
                    nativeDefaults(
                      modelFields(
                        allowed.find((model) => Number(model.id) === id),
                        tool.operation_code,
                      ),
                    ),
                  )
                }}
              >
                {!allowed.length && <option value={0}>当前空间暂无可用模型</option>}
                {allowed.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.display_name || model.name || `模型 ${model.id}`}
                  </option>
                ))}
              </CanvasToolSelect>
            </label>
          )}
          <CanvasToolFields
            fields={fields.filter((field) => !['mode', 'preset'].includes(field.name))}
            values={values}
            onChange={updateValues}
            disabled={busy}
          />
          {!angle && !panorama && values.mode === 'reference' && (
            <label className={styles.field}>
              <span>打光参考图</span>
              <CanvasToolSelect
                aria-label="打光参考图"
                value={referenceId}
                disabled={busy}
                onChange={(event) => setReferenceId(event.target.value)}
              >
                <option value="">选择参考图</option>
                {props.images
                  .filter((image) => image.assetId !== props.source.assetId)
                  .map((image) => (
                    <option key={image.nodeId} value={image.nodeId}>
                      {image.title}
                    </option>
                  ))}
              </CanvasToolSelect>
            </label>
          )}
          {!angle && !panorama && values.mode === 'smart' && (
            <textarea
              className={styles.smartPrompt}
              aria-label="补充描述"
              placeholder="描述想要的光效"
              value={prompt}
              disabled={busy}
              rows={2}
              onChange={(event) => setPrompt(event.target.value)}
            />
          )}
          <CanvasToolFields
            fields={nativeFields.filter(
              (field) =>
                ['count', 'n', 'num_images', 'batch_size'].includes(field.name) ||
                (tool.code === 'image.relight' &&
                  ['resolution', 'quality', 'ratio', 'aspect_ratio', 'width', 'height'].includes(field.name)),
            )}
            values={nativeValues}
            onChange={setNativeValues}
            disabled={busy}
          />
        </div>
        {(validation || quoteError || submitError || (currentQuote && !currentQuote.canAfford)) && (
          <div className={styles.studioError} role="alert">
            {validation || quoteError || submitError || '积分不足，请充值后重新估价'}
            {(quoteError || (currentQuote && !currentQuote.canAfford)) && (
              <Button type="link" onClick={() => setRetryQuote((value) => value + 1)}>
                重新估价
              </Button>
            )}
          </div>
        )}
        <footer className={styles.studioFooter}>
          <Button type="text" disabled={busy} onClick={reset}>
            重置参数
          </Button>
          <span role="status">
            {estimating
              ? '估价中…'
              : currentQuote
                ? `${currentQuote.kind === 'reservation' ? '预冻结' : '预计'}${creditsYuanLabel(currentQuote.cost)}`
                : '待估价'}
          </span>
          <Button
            type="primary"
            loading={busy}
            disabled={!request || !currentQuote?.canAfford || estimating || busy}
            onClick={async () => {
              if (lock.current || !request || currentQuote?.key !== requestKey || !currentQuote.canAfford) return
              lock.current = true
              setBusy(true)
              setSubmitError('')
              try {
                await props.onGenerate({ request, images, title: tool.display_name })
                props.onClose()
              } catch (err) {
                setSubmitError(err instanceof Error ? err.message : '提交失败')
              } finally {
                lock.current = false
                setBusy(false)
              }
            }}
          >
            生成新图片
          </Button>
        </footer>
      </div>
    )
  }
  return (
    <div className={styles.body}>
      <div className={styles.preview}>
        {tool.code === 'image.multi_angle' && (
          <CanvasAngleEditor
            url={assetStreamUrl(props.source.assetId, props.workspaceId)}
            values={values}
            onChange={updateValues}
            disabled={busy}
          />
        )}
        {(tool.code === 'image.relight' || browser) && (
          <CanvasToolScene
            mode={browser ? 'panorama' : tool.code === 'image.relight' ? 'light' : 'angle'}
            url={assetStreamUrl(props.source.assetId, props.workspaceId)}
            values={values}
            disabled={busy}
            onChange={updateValues}
            onBusyChange={setBusy}
            onCapture={browser ? (blob, frame) => props.onCapture(blob, frame || values) : undefined}
          />
        )}
        {tool.code === 'image.panorama' && (
          <img
            className={styles.panoramaSource}
            src={assetStreamUrl(props.source.assetId, props.workspaceId)}
            alt="全景生成参考图"
          />
        )}
      </div>
      <div className={styles.controls}>
        <div className={styles.panelHeading}>
          <strong>{tool.display_name}</strong>
          <span>{browser ? '旋转视角，保存理想画面' : '调整参数，生成独立的新图片'}</span>
        </div>
        {tool.description && (
          <details className={styles.description}>
            <summary>使用说明</summary>
            <p>{tool.description}</p>
          </details>
        )}
        {!browser && allowed.length > 1 && (
          <label className={styles.field}>
            <span>生成模型</span>
            <CanvasToolSelect
              disabled={busy}
              value={modelId}
              onChange={(event) => {
                const id = Number(event.target.value)
                setModelId(id)
                setNativeValues(
                  nativeDefaults(
                    modelFields(
                      allowed.find((m) => Number(m.id) === id),
                      tool.operation_code,
                    ),
                  ),
                )
              }}
            >
              {!allowed.length && <option value={0}>当前空间暂无可用模型</option>}
              {allowed.map((model) => (
                <option value={model.id} key={model.id}>
                  {model.display_name || model.name || `模型 ${model.id}`}
                </option>
              ))}
            </CanvasToolSelect>
          </label>
        )}
        <CanvasToolFields
          fields={browser ? viewFields : fields}
          values={values}
          onChange={updateValues}
          disabled={busy}
        />
        {tool.code === 'image.relight' && values.mode === 'smart' && (
          <div className={styles.presets} role="group" aria-label="智能光效预设">
            {[
              ['柔和日光', '使用柔和自然的窗边日光，保留人物与场景，光影过渡自然。'],
              ['蓝色边光', '使用冷蓝色轮廓边光，保留人物身份和构图，营造电影氛围。'],
              ['伦勃朗光', '使用伦勃朗人像布光，面部形成自然三角光，保留人物身份。'],
              ['落日暖光', '使用低角度金色落日暖光，保留人物与背景，呈现温暖氛围。'],
              ['电影暗调', '使用低调电影布光，控制高光并保留暗部层次，保持人物身份。'],
              ['霓虹氛围', '使用青色与品红霓虹氛围光，保持主体、服装与场景构图。'],
            ].map(([label, text]) => (
              <button
                type="button"
                key={label}
                disabled={busy}
                aria-pressed={prompt === text}
                onClick={() => setPrompt(text)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {tool.code === 'image.relight' && values.mode === 'reference' && (
          <label className={styles.field}>
            <span>打光参考图</span>
            <CanvasToolSelect disabled={busy} value={referenceId} onChange={(e) => setReferenceId(e.target.value)}>
              <option value="">选择画布中的另一张图片</option>
              {props.images
                .filter((image) => image.assetId !== props.source.assetId)
                .map((image) => (
                  <option key={image.nodeId} value={image.nodeId}>
                    {image.title}
                  </option>
                ))}
            </CanvasToolSelect>
          </label>
        )}
        {!browser && (
          <>
            <CanvasToolFields
              fields={nativeFields.filter((field) => ['count', 'n', 'num_images', 'batch_size'].includes(field.name))}
              values={nativeValues}
              onChange={setNativeValues}
              disabled={busy}
            />
            <details
              className={styles.description}
              open={tool.code === 'image.relight' && values.mode === 'smart' ? true : undefined}
            >
              <summary>补充描述（可选）</summary>
              <label className={styles.field}>
                <textarea
                  aria-label="补充描述"
                  value={prompt}
                  disabled={busy}
                  rows={2}
                  onChange={(e) => setPrompt(e.target.value)}
                />
              </label>
            </details>
            {validation && (
              <p role="status" className={styles.hint}>
                {validation}
              </p>
            )}
            {estimating && <p role="status">正在预估费用…</p>}
            {quoteError && (
              <Alert
                type="error"
                message={quoteError}
                action={<Button onClick={() => setRetryQuote((n) => n + 1)}>重新估价</Button>}
              />
            )}
            {currentQuote && (
              <div className={styles.quote} role="status">
                {currentQuote.kind === 'reservation' ? '预冻结金额' : '预估费用'}：{creditsYuanLabel(currentQuote.cost)}{' '}
                <details className={styles.feeDetails}>
                  <summary>费用说明</summary>
                  <p>余额 {currentQuote.balance} 积分</p>
                  {currentQuote.note && <p>{currentQuote.note}</p>}
                </details>
                {!currentQuote.canAfford && <p className={styles.error}>积分不足，请充值后重新估价</p>}
                <Button size="small" disabled={busy} onClick={() => setRetryQuote((n) => n + 1)}>
                  刷新估价
                </Button>
              </div>
            )}
            {submitError && <Alert type="error" message={submitError} />}
            <Button
              type="primary"
              className={styles.generateButton}
              loading={busy}
              disabled={!request || !currentQuote?.canAfford || estimating || busy}
              onClick={async () => {
                if (lock.current || !request || currentQuote?.key !== requestKey || !currentQuote.canAfford) return
                lock.current = true
                setBusy(true)
                setSubmitError('')
                try {
                  await props.onGenerate({ request, images, title: tool.display_name })
                  props.onClose()
                } catch (err) {
                  setSubmitError(err instanceof Error ? err.message : '提交失败')
                } finally {
                  lock.current = false
                  setBusy(false)
                }
              }}
            >
              生成新图片
            </Button>
          </>
        )}
        <Button
          type="text"
          size="small"
          disabled={busy}
          onClick={() => {
            updateValues(browser ? { yaw: 0, pitch: 0, fov: 65 } : defaults())
            setNativeValues(nativeDefaults(nativeFields))
            setPrompt('')
            setReferenceId('')
          }}
        >
          重置参数
        </Button>
        {browser && (
          <p className={styles.hint}>浏览和截图不创建 AI 任务。截图先集中预览，确认后再将选中的截图加入画布。</p>
        )}
      </div>
    </div>
  )
}
