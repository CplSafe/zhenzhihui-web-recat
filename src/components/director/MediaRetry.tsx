import { useState } from 'react'
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
      {error && <p role="alert">{error}</p>}
      {draft && <p>预计 {draft.estimated_credits} 积分，按实际用量结算；失败后停止，不自动重试。</p>}
      <button type="button" disabled={busy} onClick={() => void execute(!!draft)}>
        {busy ? '处理中…' : draft ? (approved ? '恢复已批准的重试' : '确认重试一次') : '查看预计积分'}
      </button>
    </section>
  )
}

export function MediaRetry({
  api,
  runId,
  models,
  reload,
}: {
  api: API
  runId: string
  models: StudioModel[]
  reload: () => Promise<void>
}) {
  const [result, setResult] = useState<Data>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function open() {
    setBusy(true)
    setError('')
    try {
      setResult(await api.request<Data>(`/api/runs/${runId}/media-retries`))
    } catch (e) {
      setError(e instanceof Error ? e.message : '读取失败素材失败')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={styles.recovery}>
      <button type="button" disabled={busy} onClick={() => void open()}>
        重试失败素材 / 更换模型
      </button>
      {error && <p role="alert">{error}</p>}
      {result && (
        <Dialog title="重试失败素材" onClose={() => setResult(undefined)}>
          {!result.candidates.length && <p>没有可重试的失败素材。结果未知的任务请先恢复查询。</p>}
          {result.candidates.map((candidate: Data) => (
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
                setResult(undefined)
                await reload()
              }}
            />
          ))}
        </Dialog>
      )}
    </div>
  )
}
