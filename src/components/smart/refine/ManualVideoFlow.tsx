import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from 'antd'
import { DeliveryCountdown } from '@/components/common/DeliveryCountdown'
import StepProgress from '@/components/smart/StepProgress'
import ManualVideoHistory from './ManualVideoHistory'
import { ensureAssetId } from '@/api/smartShotImage'
import {
  createManualVideoTask,
  estimateManualVideoTask,
  getManualVideoDownloadUrl,
  getManualVideoTask,
  getManualVideoOperation,
  listVideoModels,
  manualVideoPollDelay,
  reviseManualVideoTask,
  type ManualVideoEstimate,
  type ManualVideoInput,
  type ManualVideoModel,
  type ManualVideoTask,
} from '@/api/manualVideo'
import { useWorkspaceSessionStore } from '@/stores/workspaceSession'
import { unwrapGenerationModelCatalogResponse } from '@/utils/generationModelCatalog'
import { getModelParamFields, getModelParamOptionValues } from '@/utils/modelSchema'
import { sanitizeMediaUrl } from '@/utils/urlSafety'
import { getManualDurationSpec } from '@/utils/manualVideoParams'
import { isDefiniteSubmissionRejection } from '@/utils/submissionRecovery'
import styles from './RefineDemo.module.less'
import manualStyles from './ManualVideoFlow.module.css'

const fieldLabels: Record<string, string> = {
  duration: '时长（秒）',
  ratio: '画面比例',
  resolution: '分辨率',
  generate_audio: '生成音频',
}

interface Props {
  ownerId: number
  workspaceId: number
  taskId: number
  modelId?: number
  description: string
  script: string
  duration: number
  ratio: string
  resolution: string
  images: string[]
  imageAssetIds: number[]
  onTask: (id: number, created: boolean) => void
  onEdit: () => void
}
type Model = ManualVideoModel
type Pending =
  | { kind: 'create'; body: ManualVideoInput & { idempotency_key: string } }
  | { kind: 'revision'; taskId: number; body: { workspace_id: number; idempotency_key: string; instruction: string } }
const keys = (owner: number, workspace: number) => ({
  pending: `zzh.manual.pending.${owner}.${workspace}`,
  tasks: `zzh.manual.tasks.${owner}.${workspace}`,
})
export function knownManualTask(owner: number, workspace: number, id: number): boolean {
  try {
    const ids = JSON.parse(localStorage.getItem(keys(owner, workspace).tasks) || '[]')
    return Array.isArray(ids) && ids.includes(id)
  } catch {
    return false
  }
}
export function rememberTask(owner: number, workspace: number, id: number) {
  const key = keys(owner, workspace).tasks
  let ids: number[] = []
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]')
    if (Array.isArray(value)) ids = value.filter(Number.isSafeInteger)
  } catch {
    /* ignore invalid cache */
  }
  localStorage.setItem(key, JSON.stringify([id, ...ids.filter((item) => item !== id)].slice(0, 100)))
}
function readPending(key: string): Pending | null {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null') as Pending | null
  } catch {
    return null
  }
}

export default function ManualVideoFlow(props: Props) {
  const { ownerId, workspaceId, taskId, description, script, images, imageAssetIds, onTask, onEdit } = props
  const storage = keys(ownerId, workspaceId)
  const [pending, setPending] = useState<Pending | null>(() => readPending(storage.pending))
  const [model, setModel] = useState<Model | null>(null)
  const [modelLoading, setModelLoading] = useState(true)
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [estimate, setEstimate] = useState<ManualVideoEstimate | null>(null)
  const [snapshot, setSnapshot] = useState<ManualVideoInput | null>(null)
  const [task, setTask] = useState<ManualVideoTask | null>(null)
  const [video, setVideo] = useState('')
  const [instruction, setInstruction] = useState('')
  const [reviewRevision, setReviewRevision] = useState(false)
  const [showSupport, setShowSupport] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [confirm, setConfirm] = useState<'create' | 'revision' | null>(null)
  const [reload, setReload] = useState(0)
  const [autoQuote, setAutoQuote] = useState(false)
  const quoteRef = useRef<() => Promise<void>>(async () => {})
  const initialQuoteRequested = useRef(false)
  const busy = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const refreshWallet = useWorkspaceSessionStore((state) => state.loadSubscriptionLabel)
  const fields = useMemo(() => getModelParamFields(model), [model])

  useEffect(() => {
    if (taskId || !ownerId || !workspaceId) return
    const controller = new AbortController()
    initialQuoteRequested.current = false
    setConfirm(null)
    setError('')
    setModelLoading(true)
    setEstimate(null)
    setSnapshot(null)
    void listVideoModels(workspaceId, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return
        const item = unwrapGenerationModelCatalogResponse(response).find((value): value is Model => {
          const entry = value as Model
          return !!entry && getManualVideoOperation(entry) !== null && (!props.modelId || entry.id === props.modelId)
        })
        if (!item) throw new Error('当前空间暂无可用精制模型')
        const schemaFields = getModelParamFields(item)
        if (!schemaFields.some((field) => field.name === 'duration')) throw new Error('精制模型参数配置不完整')
        const durationSpec = getManualDurationSpec(item)
        if (!durationSpec.valid(durationSpec.fallback)) throw new Error('精制模型时长配置不完整')
        const initial: Record<string, unknown> = {}
        for (const field of schemaFields) {
          const options = getModelParamOptionValues(field)
          const preferred =
            field.name === 'duration'
              ? props.duration
              : field.name === 'ratio'
                ? props.ratio
                : field.name === 'resolution'
                  ? props.resolution
                  : undefined
          const next =
            field.name === 'duration'
              ? durationSpec.valid(Number(preferred))
                ? Number(preferred)
                : durationSpec.fallback
              : preferred !== undefined && (!options.length || options.includes(preferred))
                ? preferred
                : (field.default ?? options[0])
          if (next !== undefined) initial[field.name] = next
        }
        setModel(item)
        setValues(initial)
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '模型加载失败')
      })
      .finally(() => {
        if (!controller.signal.aborted) setModelLoading(false)
      })
    return () => controller.abort()
  }, [workspaceId, ownerId, taskId, props.modelId, props.duration, props.ratio, props.resolution, reload])

  useEffect(() => {
    if (!taskId || !knownManualTask(ownerId, workspaceId, taskId)) return
    const controller = new AbortController()
    let timer = 0
    const poll = async () => {
      try {
        const next = await getManualVideoTask(workspaceId, taskId, controller.signal)
        if (controller.signal.aborted) return
        setTask(next)
        setError('')
        const delay = manualVideoPollDelay(next)
        if (delay !== null) timer = window.setTimeout(() => void poll(), delay)
        else void refreshWallet({ force: true })
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '任务查询失败')
      }
    }
    void poll()
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [ownerId, workspaceId, taskId, reload, refreshWallet])

  useEffect(() => {
    setVideo('')
    const output = task?.outputs?.find((item) => item.type === 'video')
    if (!output) return
    if (!output.asset_id) {
      setVideo(sanitizeMediaUrl(output.url))
      return
    }
    const controller = new AbortController()
    void getManualVideoDownloadUrl(workspaceId, output.asset_id, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setVideo(sanitizeMediaUrl(result.download_url))
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '获取视频失败')
      })
    return () => controller.abort()
  }, [task, workspaceId])

  const quote = async () => {
    if (!model || busy.current || pending) return
    const operationCode = getManualVideoOperation(model)
    if (!operationCode) {
      setError('精制模型操作不可用，请刷新模型')
      return
    }
    const duration = Number(values.duration)
    const durationSpec = getManualDurationSpec(model)
    if (!durationSpec.valid(duration)) {
      setError(
        durationSpec.hasOptions
          ? `请选择模型支持的时长：${durationSpec.options.join('、')} 秒`
          : `时长须为 ${durationSpec.min} 至 ${durationSpec.max} 秒的整数`,
      )
      return
    }
    busy.current = true
    setConfirm(null)
    setLoading(true)
    setError('')
    setEstimate(null)
    try {
      const ids = await Promise.all(images.map((url, index) => imageAssetIds[index] || ensureAssetId(workspaceId, url)))
      if (ids.some((id) => !id)) throw new Error('参考素材上传未完成，请重试')
      const input: ManualVideoInput = {
        workspace_id: workspaceId,
        model_version_id: model.id,
        operation_code: operationCode,
        prompt: description,
        params: { ...values, duration },
        input_assets: ids.map((id) => ({ asset_id: id, role: 'image' })),
      }
      const result = await estimateManualVideoTask(input)
      setSnapshot(input)
      setEstimate(result)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '估价失败')
    } finally {
      busy.current = false
      setLoading(false)
    }
  }
  quoteRef.current = quote
  useEffect(() => {
    if (taskId || pending || modelLoading || !model || initialQuoteRequested.current || !Object.keys(values).length)
      return
    if (fields.some((field) => field.required && values[field.name] === undefined)) return
    initialQuoteRequested.current = true
    void quoteRef.current()
  }, [taskId, pending, modelLoading, model, values, fields])
  useEffect(() => {
    if (!autoQuote) return
    const timer = window.setTimeout(() => {
      setAutoQuote(false)
      void quoteRef.current()
    }, 400)
    return () => window.clearTimeout(timer)
  }, [autoQuote, values])
  const send = async (request: Pending) => {
    if (busy.current) return
    const previouslyUncertain = pending !== null
    busy.current = true
    setLoading(true)
    setError('')
    try {
      localStorage.setItem(storage.pending, JSON.stringify(request))
      setPending(request)
      const result =
        request.kind === 'create'
          ? await createManualVideoTask(request.body)
          : await reviseManualVideoTask(request.taskId, request.body)
      if (!Number.isSafeInteger(result.id) || result.id <= 0)
        throw new Error('任务已提交但未返回有效任务编号，请重试同一请求')
      rememberTask(ownerId, workspaceId, result.id)
      localStorage.removeItem(storage.pending)
      setPending(null)
      setConfirm(null)
      if (mounted.current) {
        void refreshWallet({ force: true })
        onTask(result.id, true)
      }
    } catch (reason) {
      setConfirm(null)
      if (!previouslyUncertain && isDefiniteSubmissionRejection(reason)) {
        localStorage.removeItem(storage.pending)
        setPending(null)
        setError(`${reason instanceof Error ? reason.message : '提交被拒绝'}，请检查信息后重新提交。`)
      } else {
        setError(reason instanceof Error ? reason.message : '提交结果未确认，请重试原请求')
      }
    } finally {
      busy.current = false
      setLoading(false)
    }
  }
  const labels: Record<string, string> = {
    awaiting_manual: '待制作',
    manual_processing: '精制中',
    succeeded: '已交付',
    failed: '制作失败',
    cancelled: '已取消',
  }
  const steps = [
    { key: 'script', label: '核对需求' },
    { key: 'submit', label: '提交精制任务' },
    { key: 'refine', label: '成片精修' },
    { key: 'accept', label: '你验收成片' },
  ]
  const delivered = task?.status === 'succeeded'
  const revisionUnavailable = task?.can_rework === false || (task?.rework_count != null && task.rework_count >= 1)
  const step = taskId ? (delivered ? 3 : 2) : 1
  const invalidFields = fields.some((field) => field.required && values[field.name] === undefined)
  return (
    <main className={`${styles.page} ${manualStyles.page}`} data-refine-demo data-manual-refine>
      <div className={`smart__progress ${styles.stepFrame}`}>
        <StepProgress steps={steps} current={step} theme="delivery" />
      </div>
      <div className={`${styles.content} ${manualStyles.content}`}>
        <div className={manualStyles.projectTitle}>精制成片</div>
        {error && (
          <div className={styles.notice} role="alert">
            {error}{' '}
            <button type="button" onClick={() => setReload((v) => v + 1)}>
              {taskId ? '刷新任务' : '重试加载模型'}
            </button>
          </div>
        )}
        {pending && (
          <section className={`${styles.panel} ${manualStyles.pending}`} role="status">
            <p>上次提交结果尚未确认，请重试原请求，避免重复下单。</p>
            <button type="button" disabled={loading} onClick={() => void send(pending)}>
              重试原请求
            </button>
          </section>
        )}
        {!taskId && !pending && (
          <>
            <section className={manualStyles.brief}>
              <div className={manualStyles.block}>
                <h2>我的描述：</h2>
                <p>{description}</p>
              </div>
              <div className={manualStyles.block}>
                <h2>我上传的素材：</h2>
                <div className={manualStyles.thumbs}>
                  {images.length ? (
                    images.map((url, index) => <img key={`${url}-${index}`} src={url} alt={`参考素材 ${index + 1}`} />)
                  ) : (
                    <span>未添加参考素材</span>
                  )}
                </div>
              </div>
            </section>
            <>
              <section className={manualStyles.parameterCard} aria-labelledby="manual-parameters-title">
                <div className={manualStyles.parameterHeading}>
                  <h2 id="manual-parameters-title">本次生成参数</h2>
                  <button className={manualStyles.secondary} type="button" disabled={loading} onClick={onEdit}>
                    修改
                  </button>
                </div>
                <dl className={manualStyles.grid}>
                  <div>
                    <dt>制作方式</dt>
                    <dd>精制交付</dd>
                  </div>
                  <div>
                    <dt>爆款脚本</dt>
                    <dd>{script || '不使用脚本'}</dd>
                  </div>
                  <div>
                    <dt>画面比例 / 分辨率</dt>
                    <dd>
                      {String(values.ratio ?? '—')} · {String(values.resolution ?? '—')}
                    </dd>
                  </div>
                  <div>
                    <dt>成片时长</dt>
                    <dd>{String(values.duration ?? '—')} 秒</dd>
                  </div>
                  <div>
                    <dt>制作模型</dt>
                    <dd>{model?.display_name || model?.model || '精制交付'}</dd>
                  </div>
                  <div>
                    <dt>生成条数</dt>
                    <dd>1 条</dd>
                  </div>
                </dl>
                <details>
                  <summary>调整生成参数</summary>
                  <div className={manualStyles.modelFields}>
                    {fields.map((field) => {
                      const options = getModelParamOptionValues(field)
                      const label = fieldLabels[field.name] || String(field.label || field.title || field.name)
                      const update = (value: unknown) => {
                        setValues((old) => ({ ...old, [field.name]: value }))
                        setEstimate(null)
                        setSnapshot(null)
                        setAutoQuote(true)
                      }
                      if (field.name === 'duration')
                        if (getManualDurationSpec(model).hasOptions)
                          return (
                            <label key={field.name}>
                              时长（秒）
                              <select
                                disabled={loading}
                                value={String(values.duration ?? '')}
                                onChange={(event) => update(Number(event.target.value))}
                              >
                                {getManualDurationSpec(model).options.map((option) => (
                                  <option key={option} value={option}>
                                    {option} 秒
                                  </option>
                                ))}
                              </select>
                            </label>
                          )
                      if (field.name === 'duration')
                        return (
                          <label key={field.name}>
                            时长（秒）
                            <input
                              type="number"
                              disabled={loading}
                              min={getManualDurationSpec(model).min}
                              max={getManualDurationSpec(model).max}
                              step="1"
                              value={String(values.duration ?? '')}
                              onChange={(event) => update(Number(event.target.value))}
                            />
                          </label>
                        )
                      if (options.length)
                        return (
                          <label key={field.name}>
                            {label}
                            <select
                              disabled={loading}
                              value={String(values[field.name] ?? '')}
                              onChange={(event) =>
                                update(options.find((option) => String(option) === event.target.value))
                              }
                            >
                              {options.map((option) => (
                                <option key={String(option)} value={String(option)}>
                                  {option === true ? '是' : option === false ? '否' : String(option)}
                                </option>
                              ))}
                            </select>
                          </label>
                        )
                      if (field.type === 'boolean')
                        return (
                          <label key={field.name}>
                            <input
                              type="checkbox"
                              disabled={loading}
                              checked={values[field.name] === true}
                              onChange={(event) => update(event.target.checked)}
                            />
                            {label}
                          </label>
                        )
                      return field.required && values[field.name] === undefined ? (
                        <p role="alert" key={field.name}>
                          模型必填参数 {label} 未提供可用默认值
                        </p>
                      ) : null
                    })}
                  </div>
                </details>
              </section>
              <section className={manualStyles.order} aria-labelledby="manual-order-title">
                <div className={manualStyles.orderHeading}>
                  <span className={manualStyles.pill}>T+1 交付</span>
                  <h2 id="manual-order-title">精制成片 · 提交后 24 小时内交</h2>
                  <span>提交后进入精制排期</span>
                </div>
                <dl className={manualStyles.grid}>
                  <div>
                    <dt>成片时长</dt>
                    <dd className={manualStyles.accent}>{String(values.duration ?? '—')} 秒</dd>
                  </div>
                  <div>
                    <dt>交付时间</dt>
                    <dd className={manualStyles.accent}>提交后 24 小时内</dd>
                  </div>
                  <div>
                    <dt>制作方式</dt>
                    <dd>系统精制</dd>
                  </div>
                  <div>
                    <dt>本次消耗</dt>
                    <dd>
                      {estimate
                        ? `${estimate.estimated_cost.toLocaleString('zh-CN')} 积分（交付时结算）`
                        : modelLoading || loading
                          ? '正在获取报价…'
                          : '请重新获取报价'}
                    </dd>
                  </div>
                </dl>
                {estimate && (
                  <p className={manualStyles.balance}>
                    可用余额：{estimate.balance} 积分 · 已冻结：{estimate.frozen} 积分
                  </p>
                )}
                {estimate && !estimate.can_afford && <p role="alert">余额不足</p>}
                <div className={manualStyles.plain}>
                  <b>提交后会发生什么</b>
                  <ul>
                    <li>成片交付后出现在任务里，可播放和下载。</li>
                    <li>如需修改，可按原任务报价申请修改。</li>
                    <li>任务失败或取消时退回本次积分。</li>
                  </ul>
                </div>
                <div className={manualStyles.submit}>
                  {estimate ? (
                    <button
                      className={manualStyles.primary}
                      type="button"
                      disabled={!estimate.can_afford || !snapshot || loading}
                      onClick={() => setConfirm('create')}
                    >
                      提交精制任务（T+1）
                    </button>
                  ) : (
                    <button
                      className={manualStyles.primary}
                      type="button"
                      disabled={!model || loading || invalidFields}
                      onClick={() => void quote()}
                    >
                      {modelLoading || loading ? '正在获取报价…' : '重新获取报价'}
                    </button>
                  )}
                </div>
              </section>
              <details>
                <summary>查看历史精制任务</summary>
                <ManualVideoHistory
                  key={`${ownerId}.${workspaceId}`}
                  ownerId={ownerId}
                  workspaceId={workspaceId}
                  onOpen={(id) => {
                    rememberTask(ownerId, workspaceId, id)
                    onTask(id, false)
                  }}
                />
              </details>
            </>
          </>
        )}
        {taskId > 0 && !knownManualTask(ownerId, workspaceId, taskId) && (
          <div className={styles.notice} role="alert">
            无法确认此任务属于精制视频，请从已知任务入口打开。
          </div>
        )}
        {task && !delivered && (
          <section className={manualStyles.wait}>
            <div className={manualStyles.waitVisual}>
              {['awaiting_manual', 'manual_processing'].includes(task.status) && (
                <span className={manualStyles.spinner} aria-hidden="true" />
              )}
              <span>{labels[task.status] || task.status}</span>
            </div>
            <h1>
              {task.status === 'awaiting_manual' || task.status === 'manual_processing'
                ? task.parent_task_id
                  ? '第 1 次修改已提交，等待精制成片'
                  : '任务已提交，等待精制成片'
                : labels[task.status] || task.status}
            </h1>
            {(task.prompt || task.params || task.estimated_cost != null) && (
              <div className={`${manualStyles.plain} ${manualStyles.waitDetails}`}>
                <b>任务详情</b>
                <ul>
                  {task.prompt && <li>制作需求：{task.prompt}</li>}
                  {task.params?.duration != null && <li>成片时长：{task.params.duration} 秒</li>}
                  {task.params?.ratio && <li>画面比例：{task.params.ratio}</li>}
                  {task.params?.resolution && <li>分辨率：{task.params.resolution}</li>}
                  {task.estimated_cost != null && <li>预计冻结：{task.estimated_cost} 积分</li>}
                </ul>
              </div>
            )}
            {task.error_message && <p role="alert">{task.error_message}</p>}
            {['awaiting_manual', 'manual_processing'].includes(task.status) && (
              <section className={manualStyles.waitSection}>
                <h2>交付时间</h2>
                <DeliveryCountdown kind="t1" createdAt={task.created_at} deadlineAt={task.deadline_at} />
              </section>
            )}
            <section className={manualStyles.waitSection}>
              <h2>制作进度</h2>
              <ol className={manualStyles.phase}>
                <li>制作画面</li>
                <li>成片精修</li>
                <li>等待你验收</li>
              </ol>
            </section>
            <section className={manualStyles.waitSection}>
              <h2>需要帮忙？</h2>
              <div className={manualStyles.waitActions}>
                <button className={manualStyles.primary} type="button" onClick={() => setReload((v) => v + 1)}>
                  刷新状态
                </button>
              </div>
              <div className={manualStyles.support}>
                <p>临时要改需求、不想做了、或者内容很急，可以联系客服。</p>
                <a href="tel:13681065734">136 8106 5734</a>
                <p>工作日 9:00-18:00 · 电话/微信同码</p>
              </div>
            </section>
          </section>
        )}
        {task && delivered && reviewRevision && (
          <section className={manualStyles.order} aria-label="第 1 次修改确认">
            <div className={manualStyles.orderHeading}>
              <span className={manualStyles.pill}>第 1 次修改</span>
              <h2>核对修改需求</h2>
              <span>确认需求和参数后提交，将重新排期。</span>
            </div>
            <div className={manualStyles.plain}>
              <b>修改意见</b>
              <p>{instruction}</p>
              {task.prompt && <p>原制作需求：{task.prompt}</p>}
              {task.params?.duration != null && <p>原成片时长：{task.params.duration} 秒</p>}
              {task.params?.ratio && <p>画面比例：{task.params.ratio}</p>}
              {task.params?.resolution && <p>分辨率：{task.params.resolution}</p>}
              <p>预计冻结：{task.estimated_cost ?? '待确认'} 积分，交付时结算。</p>
            </div>
            <div className={manualStyles.actions}>
              <button className={manualStyles.secondary} type="button" onClick={() => setReviewRevision(false)}>
                返回修改意见
              </button>
              <button
                className={manualStyles.primary}
                type="button"
                disabled={loading || !!pending}
                onClick={() => setConfirm('revision')}
              >
                提交第 1 次修改
              </button>
            </div>
          </section>
        )}
        {task && delivered && !reviewRevision && (
          <div className={manualStyles.delivery}>
            <section>
              <h1 className={manualStyles.deliveryTitle}>精修成片</h1>
              {video ? (
                <video
                  className={styles.video}
                  src={video}
                  controls
                  aria-label="精制视频成片"
                  onError={() => setVideo('')}
                />
              ) : (
                <div className={manualStyles.videoEmpty}>暂无可播放的视频，请刷新状态重试。</div>
              )}
              <div className={manualStyles.deliveryInfo}>
                <div>
                  <span>提交时间</span>
                  <b>
                    {task.created_at
                      ? new Date(task.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
                      : '—'}
                  </b>
                </div>
                <div>
                  <span>交付时间</span>
                  <b>
                    {task.delivered_at && !Number.isNaN(Date.parse(task.delivered_at))
                      ? new Date(task.delivered_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
                      : '—'}
                  </b>
                </div>
                <div>
                  <span>消耗积分</span>
                  <b>{task.actual_cost ?? '—'}</b>
                </div>
              </div>
              <div className={manualStyles.actions}>
                {video && (
                  <a className={manualStyles.download} href={video} download>
                    ⬇ 下载视频
                  </a>
                )}
                <button className={manualStyles.secondary} type="button" onClick={() => setReload((v) => v + 1)}>
                  刷新视频地址
                </button>
              </div>
            </section>
            <aside>
              <section className={manualStyles.history}>
                <h2>历史生成</h2>
                <p>精修成片 · 任务 #{task.id}</p>
                <p>视频生成后，可在此对整段视频提出修改意见。</p>
              </section>
              <section className={manualStyles.rework}>
                <h2>
                  这条片子想改？ <span className={manualStyles.pill}>T+1</span>
                </h2>
                <p>写下要改的地方，重新提交精制。</p>
                {revisionUnavailable && <p role="status">本订单当前无法申请修改，请联系客服。</p>}
                <label htmlFor="manual-instruction">修改意见</label>
                <textarea
                  id="manual-instruction"
                  value={instruction}
                  onChange={(event) => setInstruction(event.target.value)}
                  placeholder="请说明希望调整的内容"
                />
                <div className={manualStyles.reworkActions}>
                  <span>再冻结 {task.estimated_cost ?? '待确认'} 积分 · 交付时结算</span>
                  <button className={manualStyles.secondary} type="button" onClick={() => setShowSupport((v) => !v)}>
                    联系客服
                  </button>
                  <button
                    className={manualStyles.primary}
                    type="button"
                    disabled={
                      revisionUnavailable || !instruction.trim() || task.estimated_cost == null || loading || !!pending
                    }
                    onClick={() => setReviewRevision(true)}
                  >
                    申请付费修改
                  </button>
                </div>
                {showSupport && (
                  <p>
                    客服电话：<a href="tel:13681065734">136 8106 5734</a>（工作日 9:00-18:00）
                  </p>
                )}
              </section>
            </aside>
          </div>
        )}
      </div>
      <Modal
        className={manualStyles.confirmModal}
        open={confirm !== null}
        centered
        width={520}
        title={
          <span className={manualStyles.confirmTitle}>
            <span aria-hidden="true" className={manualStyles.confirmIcon}>
              ?
            </span>
            {confirm === 'revision' ? '确认提交第 1 次修改？' : '确认提交精制任务？'}
          </span>
        }
        okText={confirm === 'revision' ? '确认修改' : '确认提交'}
        cancelText="再想想"
        confirmLoading={loading}
        okButtonProps={{
          disabled: confirm === 'create' && (!estimate || !snapshot || loading || !estimate.can_afford),
        }}
        closable={false}
        maskClosable={!loading}
        onCancel={() => !loading && setConfirm(null)}
        onOk={() => {
          if (confirm === 'create' && snapshot && estimate && estimate.can_afford && !loading)
            void send({ kind: 'create', body: { ...snapshot, idempotency_key: crypto.randomUUID() } })
          else if (confirm === 'revision' && task)
            void send({
              kind: 'revision',
              taskId: task.id,
              body: {
                workspace_id: workspaceId,
                idempotency_key: crypto.randomUUID(),
                instruction: instruction.trim(),
              },
            })
        }}
      >
        {confirm === 'revision' ? (
          <p>本次按原报价冻结 {task?.estimated_cost} 积分。</p>
        ) : (
          <>
            <p className={manualStyles.confirmDescription}>
              预计 <strong>提交后 24 小时内</strong> 交付成片，到时在任务里点开就能看。
            </p>
            <dl className={manualStyles.confirmDetails}>
              <div>
                <dt>本次冻结</dt>
                <dd>
                  {estimate ? `${estimate.estimated_cost.toLocaleString('zh-CN')} 积分` : '报价已失效，请重新获取'}
                </dd>
              </div>
              <div>
                <dt>什么时候扣</dt>
                <dd>交付成片时</dd>
              </div>
              <div>
                <dt>未交付</dt>
                <dd>积分处理以订单状态为准</dd>
              </div>
            </dl>
          </>
        )}
        {error && <p role="alert">{error}</p>}
      </Modal>
    </main>
  )
}
