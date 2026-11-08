import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from 'antd'
import StepProgress from '@/components/smart/StepProgress'
import { ensureAssetId } from '@/api/smartShotImage'
import {
  cancelManualVideoTask,
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
import ManualVideoHistory from './ManualVideoHistory'
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
  const [screen, setScreen] = useState<'preparing' | 'order'>('preparing')
  const [snapshot, setSnapshot] = useState<ManualVideoInput | null>(null)
  const [task, setTask] = useState<ManualVideoTask | null>(null)
  const [video, setVideo] = useState('')
  const [instruction, setInstruction] = useState('')
  const [showSupport, setShowSupport] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [confirm, setConfirm] = useState<'create' | 'revision' | 'cancel' | null>(null)
  const [reload, setReload] = useState(0)
  const previousTasks = useMemo(() => {
    try {
      const value = JSON.parse(localStorage.getItem(storage.tasks) || '[]')
      return Array.isArray(value) ? value.filter((id): id is number => Number.isSafeInteger(id) && id > 0) : []
    } catch {
      return []
    }
  }, [storage.tasks])
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
      setScreen('order')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '估价失败')
    } finally {
      busy.current = false
      setLoading(false)
    }
  }
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
  const doCancel = async () => {
    if (!task || busy.current) return
    busy.current = true
    setLoading(true)
    setError('')
    try {
      await cancelManualVideoTask(workspaceId, task.id)
      setConfirm(null)
      setReload((value) => value + 1)
      void refreshWallet({ force: true })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '取消失败')
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
  const step = taskId ? (delivered ? 3 : 2) : screen === 'order' ? 1 : 0
  const invalidFields = fields.some((field) => field.required && values[field.name] === undefined)
  return (
    <main className={`${styles.page} ${manualStyles.page}`} data-refine-demo data-manual-refine>
      <div className={`smart__progress ${styles.stepFrame}`}>
        <StepProgress steps={steps} current={step} />
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
            {screen === 'preparing' && (
              <>
                <section className={manualStyles.preparation} aria-labelledby="manual-preparation-title">
                  <div>
                    <h2 id="manual-preparation-title">核对制作需求</h2>
                    <p>确认上方描述和素材后，查看订单即可获取本次报价。</p>
                  </div>
                  <p className={manualStyles.preparationStatus} role="status">
                    {modelLoading
                      ? '正在加载模型…'
                      : loading
                        ? '正在获取报价…'
                        : model
                          ? '准备就绪，尚未提交任务'
                          : '模型尚未就绪，请查看上方提示'}
                  </p>
                </section>
                <div className={manualStyles.plain}>
                  <b>精制成片</b>
                  <ul>
                    <li>提交后按你的需求制作成片。</li>
                    <li>做好后可在任务中查看、播放和下载。</li>
                    <li>本次积分先冻结，交付时结算；失败或取消将退回本次费用。</li>
                  </ul>
                </div>
                <div className={manualStyles.actions}>
                  <button className={manualStyles.secondary} type="button" disabled={loading} onClick={onEdit}>
                    ← 返回修改需求
                  </button>
                  <button
                    className={manualStyles.primary}
                    type="button"
                    disabled={!model || loading || invalidFields}
                    onClick={() => void quote()}
                  >
                    {loading ? '正在获取报价…' : '查看订单 →'}
                  </button>
                </div>
                <ManualVideoHistory
                  key={`${ownerId}.${workspaceId}`}
                  ownerId={ownerId}
                  workspaceId={workspaceId}
                  onOpen={(id) => {
                    rememberTask(ownerId, workspaceId, id)
                    onTask(id, false)
                  }}
                />
                {previousTasks.length > 0 && (
                  <div className={manualStyles.knownTasks}>
                    <b>本设备的历史精制任务</b>
                    <span>点击任务编号可查看之前的任务，与你当前的需求分开。</span>
                    {previousTasks.map((id) => (
                      <button key={id} type="button" disabled={loading} onClick={() => onTask(id, false)}>
                        任务 #{id}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
            {screen === 'order' && (
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
                    <div>
                      <dt>交付时间</dt>
                      <dd>待确认</dd>
                    </div>
                    <div>
                      <dt>本次预计冻结</dt>
                      <dd>{estimate ? `${estimate.estimated_cost.toLocaleString('zh-CN')} 积分` : '请重新获取报价'}</dd>
                    </div>
                  </dl>
                  <div className={manualStyles.modelFields}>
                    {fields.map((field) => {
                      const options = getModelParamOptionValues(field)
                      const label = fieldLabels[field.name] || String(field.label || field.title || field.name)
                      const update = (value: unknown) => {
                        setValues((old) => ({ ...old, [field.name]: value }))
                        setEstimate(null)
                        setSnapshot(null)
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
                </section>
                <section className={manualStyles.order} aria-labelledby="manual-order-title">
                  <div className={manualStyles.orderHeading}>
                    <span className={manualStyles.pill}>T+1 交付</span>
                    <h2 id="manual-order-title">精制成片 · 交付时间待确认</h2>
                    <span>提交后进入精制排期</span>
                  </div>
                  <dl className={manualStyles.grid}>
                    <div>
                      <dt>成片时长</dt>
                      <dd className={manualStyles.accent}>{String(values.duration ?? '—')} 秒</dd>
                    </div>
                    <div>
                      <dt>交付时间</dt>
                      <dd className={manualStyles.accent}>待确认</dd>
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
                        disabled={!estimate.can_afford || loading}
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
                        重新获取报价
                      </button>
                    )}
                  </div>
                </section>
              </>
            )}
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
                ? '任务已提交，等待精制成片'
                : labels[task.status] || task.status}
            </h1>
            <p className={manualStyles.waitSummary}>
              任务编号：{task.id} · 交付日期待确认。
              <br />
              积分先冻结，成片交付时结算。
            </p>
            {task.error_message && <p role="alert">{task.error_message}</p>}
            <ol className={manualStyles.phase}>
              <li>已提交</li>
              <li>{labels[task.status] || task.status}</li>
              <li>等待交付</li>
            </ol>
            <div className={manualStyles.waitActions}>
              {['awaiting_manual', 'manual_processing'].includes(task.status) && (
                <button
                  className={manualStyles.secondary}
                  type="button"
                  disabled={loading || !!pending}
                  onClick={() => setConfirm('cancel')}
                >
                  取消任务
                </button>
              )}
              <button className={manualStyles.primary} type="button" onClick={() => setReload((v) => v + 1)}>
                刷新状态
              </button>
            </div>
            <div className={manualStyles.support}>
              <h2>有问题？</h2>
              <p>临时要改需求、不想做了、或者内容很急，可以联系客服。</p>
              <a href="tel:13681065734">136 8106 5734</a>
              <p>工作日 9:00-18:00 · 电话/微信同码</p>
            </div>
          </section>
        )}
        {task && delivered && (
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
                  <b>—</b>
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
                    disabled={!instruction.trim() || task.estimated_cost == null || loading || !!pending}
                    onClick={() => setConfirm('revision')}
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
        open={confirm !== null}
        title={
          confirm === 'cancel' ? '确认取消任务？' : confirm === 'revision' ? '确认付费修改？' : '确认提交精制任务？'
        }
        okText="确认"
        cancelText="取消"
        confirmLoading={loading}
        closable={!loading}
        maskClosable={!loading}
        onCancel={() => !loading && setConfirm(null)}
        onOk={() => {
          if (confirm === 'cancel') void doCancel()
          else if (confirm === 'create' && snapshot)
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
        <p>
          {confirm === 'cancel'
            ? '取消后退回本次任务积分。'
            : confirm === 'revision'
              ? `本次按原报价冻结 ${task?.estimated_cost} 积分。`
              : `本次预计冻结 ${estimate?.estimated_cost} 积分，交付时结算。`}
        </p>
        {error && <p role="alert">{error}</p>}
      </Modal>
    </main>
  )
}
