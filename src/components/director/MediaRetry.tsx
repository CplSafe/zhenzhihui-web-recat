import { useEffect, useState } from 'react'
import { Dialog } from './StudioCards'
import type { createStudioAPI, Data, StudioModel } from './studio'
import styles from './DeepAgentStudio.module.css'

type API = ReturnType<typeof createStudioAPI>
type Model = StudioModel & { params_schema?: { fields?: Data[] } }

function RetryForm({
  candidate,
  approved,
  models,
  api,
  runId,
  onDone,
}: {
  candidate: Data
  approved?: Data
  models: Model[]
  api: API
  runId: string
  onDone: () => Promise<void>
}) {
  const before = candidate.before
  const [modelId, setModelId] = useState<number>(approved?.after.model_version_id ?? before.model_version_id)
  const [prompt, setPrompt] = useState<string>(approved?.after.prompt ?? before.prompt)
  const [params, setParams] = useState<Data>(approved?.after.params ?? before.params ?? {})
  const [draft, setDraft] = useState<Data | undefined>(approved)
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [copied, setCopied] = useState(false)
  const failure = candidate.failure
  const reviewRejected = failure?.advice?.category === 'REVIEW_REJECTED'
  const model = models.find((m) => m.id === modelId)
  const fields = model?.params_schema?.fields ?? []
  const fixed = ['n', 'count', 'batch_count', 'num_images', 'num_outputs']
  function edited() {
    setDraft(undefined)
    setRequestKey(crypto.randomUUID())
  }
  async function execute(confirm: boolean) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      if (confirm && draft) {
        await api.request(`/api/runs/${runId}/media-retries/${draft.id}/decision`, {
          decision: 'approve',
          decision_id: draft.decision_id,
          start: true,
        })
        await onDone()
      } else {
        setDraft(
          await api.request<Data>(`/api/runs/${runId}/media-retries`, {
            task_id: candidate.task_id,
            model_version_id: modelId,
            prompt,
            params,
            idempotency_key: requestKey,
          }),
        )
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '无法提交重试方案')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section>
      <h3>{candidate.title}</h3>
      {failure && <>
        <p>{failure.advice?.error_message || candidate.error || '尚未取得具体错误信息。'}</p>
        <p>{failure.explanation}</p>
        <p>原任务 #{candidate.task_id} · 已结算 {failure.actual_credits ?? '待核实'} 积分</p>
        {failure.references?.map((ref: Data) => <p key={ref.asset_id}>
          参考素材 #{ref.asset_id}：{ref.origin === 'generated_in_session' ? `本会话生成 · ${ref.title}` : '来源尚未核实'}
        </p>)}
      </>}
      {reviewRejected && <>
        <p>你不需要自己修改提示词。不想调整内容时，可以保留原描述，复制核查信息交给服务支持查询具体原因；原样重试或只换模型不能保证解决审核拒绝。</p>
        {failure.assessment?.reason && <details>
          <summary>Agent 的初步判断（不是供应商结论）</summary>
          <p>{failure.assessment.reason}</p>
          {!failure.assessment.source_context_included && <p>这次判断未结合参考素材来源，不能据此认定授权或素材有问题。</p>}
        </details>}
        <p>查看原因和复制信息不扣积分；成功素材与原描述保留，没有提交新生成。</p>
        <button type="button" onClick={async () => {
          try {
            await navigator.clipboard.writeText(JSON.stringify({ task_id: candidate.task_id, title: candidate.title,
              error: failure.advice?.error_message, model_version_id: before.model_version_id,
              prompt: before.prompt, params: before.params, references: failure.references }, null, 2))
            setCopied(true)
          } catch { setError('复制失败，请从下方原描述和参数中复制核查信息。'); setEditing(true) }
        }}>{copied ? '已复制核查信息' : '复制核查信息'}</button>
        <button type="button" onClick={() => setEditing(!editing)}>{editing ? '收起原描述和参数' : '查看原描述和参数（可选调整）'}</button>
      </>}
      {failure?.retry_eligible === false && <p>{failure.task_status !== 'failed'
        ? '原任务状态已变化，请恢复查询进度；不会追加生成。'
        : '已达到当前素材的重试上限。可以核查原因，不能继续追加生成。'}</p>}
      {(!reviewRejected || editing || approved) && <>
      <p>只重试这份失败素材一次，成功素材保留。换模型不保证通过内容审核。</p>
      <fieldset disabled={busy || !!approved} style={{ border: 0, padding: 0 }}>
        <label>
          重试模型
          <select
            value={modelId}
            onChange={(e) => {
              const id = Number(e.target.value),
                next = models.find((m) => m.id === id)
              setModelId(id)
              setParams(
                id === before.model_version_id
                  ? { ...before.params }
                  : Object.fromEntries(
                      (next?.params_schema?.fields ?? [])
                        .filter((f) => f.default !== undefined)
                        .map((f) => [f.name, fixed.includes(f.name) ? 1 : f.default]),
                    ),
              )
              edited()
            }}
          >
            {models
              .filter((m) => m.operation_codes.includes(before.operation_code))
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.display_name || m.model}
                </option>
              ))}
          </select>
        </label>
        <label>
          提示词
          <textarea
            rows={5}
            value={prompt}
            readOnly={candidate.tool === 'model.generate_video'}
            onChange={(e) => {
              setPrompt(e.target.value)
              edited()
            }}
          />
        </label>
        {fields.map((f) => (
          <label key={f.name}>
            {f.display_name || f.label || f.name}
            {f.options?.length ? (
              <select
                value={params[f.name] === undefined ? '' : JSON.stringify(params[f.name])}
                disabled={fixed.includes(f.name)}
                onChange={(e) => {
                  const next = { ...params }
                  if (e.target.value === '') delete next[f.name]
                  else next[f.name] = JSON.parse(e.target.value)
                  setParams(next)
                  edited()
                }}
              >
                <option value="">使用模型默认值</option>
                {f.options.map((v: unknown) => (
                  <option key={JSON.stringify(v)} value={JSON.stringify(v)}>
                    {String(v)}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={
                  ['bool', 'boolean'].includes(f.type)
                    ? 'checkbox'
                    : ['integer', 'number'].includes(f.type)
                      ? 'number'
                      : 'text'
                }
                disabled={fixed.includes(f.name)}
                checked={['bool', 'boolean'].includes(f.type) ? !!params[f.name] : undefined}
                value={['bool', 'boolean'].includes(f.type) ? undefined : (params[f.name] ?? '')}
                onChange={(e) => {
                  const next = { ...params }
                  if (['bool', 'boolean'].includes(f.type)) next[f.name] = e.target.checked
                  else if (e.target.value === '') delete next[f.name]
                  else next[f.name] = ['integer', 'number'].includes(f.type) ? Number(e.target.value) : e.target.value
                  setParams(next)
                  edited()
                }}
              />
            )}
          </label>
        ))}
      </fieldset>
      {draft && <p>预计 {draft.estimated_credits} 积分，按实际用量结算；失败后停止，不自动重试。</p>}
      <button type="button" disabled={busy || failure?.retry_eligible === false} onClick={() => void execute(!!draft)}>
        {busy ? '处理中…' : draft ? (approved ? '恢复已批准的重试' : '确认重试一次') : '查看预计积分'}
      </button>
      </>}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}

export function MediaRetry({
  api,
  runId,
  models,
  reload,
  requestedTask,
}: {
  api: API
  runId: string
  models: StudioModel[]
  reload: () => Promise<void>
  requestedTask?: { id: number; version: number }
}) {
  const [result, setResult] = useState<Data>()
  const [visible, setVisible] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [selectedTask, setSelectedTask] = useState<number>()
  useEffect(() => {
    let active = true
    setResult(undefined)
    setVisible(false)
    setError('')
    void api.request<Data>(`/api/runs/${runId}/media-retries`).then(data => {
      if (active) {
        setResult(data)
        setSelectedTask(requestedTask?.id)
        if (requestedTask) setVisible(true)
      }
    }).catch(e => {
      if (active) setError(e instanceof Error ? e.message : '读取失败素材失败')
    })
    return () => { active = false }
  }, [api, runId, requestedTask])
  async function open() {
    setBusy(true)
    setError('')
    try {
      setResult(await api.request<Data>(`/api/runs/${runId}/media-retries`))
      setSelectedTask(undefined)
      setVisible(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : '读取失败素材失败')
    } finally {
      setBusy(false)
    }
  }
  if (!visible && !error && !result?.candidates.length) return null
  return (
    <div className={styles.recovery}>
      <button type="button" disabled={busy} onClick={() => void open()}>
        {error ? '重新查询失败素材' : '查看失败原因与处理方案'}
      </button>
      {error && <p role="alert">{error}</p>}
      {visible && result && (
        <Dialog title="失败原因与处理方案" onClose={() => setVisible(false)}>
          {!result.candidates.length && <p>没有可重试的失败素材。结果未知的任务请先恢复查询。</p>}
          {selectedTask && !result.candidates.some((c: Data) => c.task_id === selectedTask) && <p>该任务状态已变化，请刷新会话查询当前进度。</p>}
          {result.candidates.filter((c: Data) => !selectedTask || c.task_id === selectedTask).map((candidate: Data) => (
            <RetryForm
              key={candidate.task_id}
              candidate={candidate}
              models={models}
              api={api}
              runId={runId}
              approved={result.items.find(
                (p: Data) => p.status === 'approved' && p.source.task_id === candidate.task_id,
              )}
              onDone={async () => {
                setVisible(false)
                await reload()
              }}
            />
          ))}
        </Dialog>
      )}
    </div>
  )
}
