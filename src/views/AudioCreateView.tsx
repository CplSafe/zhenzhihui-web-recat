/** Standalone audio generation, using the real catalog, billing and task APIs. */
import { useEffect, useRef, useState } from 'react'
import AppSidebar from '@/components/home/AppSidebar'
import AppTopbar from '@/components/layout/AppTopbar'
import { useSidebarNavigate } from '@/composables/useSidebarNavigate'
import { useWorkspaceId } from '@/stores/workspaceSession'
import {
  createAiTask,
  estimateAiTaskCost,
  getBusinessErrorMessage,
  listAiModels,
  listAiTasks,
  waitForAiTask,
} from '@/api/business'
import { isFinalTaskStatus, type StudioHistoryTask } from '@/utils/studioHistory'
import { creditsYuanSuffix } from '@/utils/creditsYuan'
import './AudioCreateView.css'

type Operation = 'audio.generate' | 'audio.text_to_speech'
type Param = string | number | boolean
interface Field {
  name: string
  type: string
  display_name?: string
  help?: string
  default?: Param
  options?: Param[]
  min?: number
  max?: number
  required?: boolean
}
interface AudioModel {
  id: number
  display_name: string
  version: string
  operation_codes: string[]
  params_schema?: { fields: Field[] }
}
interface AudioTask extends StudioHistoryTask {
  actual_cost?: number
}
interface Estimate {
  estimated_cost: number
  balance: number
  frozen: number
  can_afford: boolean
}
function rows<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object' && 'items' in value && Array.isArray(value.items)) return value.items
  return []
}
function defaults(model?: AudioModel): Record<string, Param> {
  return Object.fromEntries(
    (model?.params_schema?.fields || []).filter((f) => f.default !== undefined).map((f) => [f.name, f.default!]),
  )
}

export default function AudioCreateView() {
  const workspaceId = Number(useWorkspaceId() || 0)
  // Remount on scope changes: no old workspace draft/result can leak into a new one.
  return <AudioWorkspace key={workspaceId} workspaceId={workspaceId} />
}

function AudioWorkspace({ workspaceId }: { workspaceId: number }) {
  const navigate = useSidebarNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [operation, setOperation] = useState<Operation>('audio.generate')
  const [models, setModels] = useState<AudioModel[]>([])
  const [modelId, setModelId] = useState(0)
  const [params, setParams] = useState<Record<string, Param>>({})
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(true)
  const [catalogError, setCatalogError] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [estimate, setEstimate] = useState<Estimate | null>(null)
  const [estimateError, setEstimateError] = useState('')
  const [tasks, setTasks] = useState<AudioTask[]>([])
  const [historyError, setHistoryError] = useState('')
  const [reload, setReload] = useState(0)
  const [catalogReload, setCatalogReload] = useState(0)
  const alive = useRef(true)
  const submitting = useRef(false)
  const pendingKey = useRef<{ fingerprint: string; key: string } | null>(null)
  const model = models.find((m) => m.id === modelId)
  const isTTS = operation === 'audio.text_to_speech'
  const validText = prompt.trim().length > 0 && Array.from(prompt).length <= 3000

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setCatalogError('')
    setModels([])
    setModelId(0)
    setEstimate(null)
    if (!workspaceId) {
      setLoading(false)
      return
    }
    listAiModels({ workspaceId, capability: 'audio', operationCode: operation, signal: controller.signal })
      .then((response: unknown) => {
        if (controller.signal.aborted) return
        const choices = rows<AudioModel>(response).filter((m) => m.operation_codes?.includes(operation))
        setModels(choices)
        setModelId(choices[0]?.id || 0)
        setParams(defaults(choices[0]))
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setCatalogError(getBusinessErrorMessage(e) || '模型加载失败')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [workspaceId, operation, catalogReload])

  useEffect(() => {
    let current = true
    setEstimate(null)
    setEstimateError('')
    if (!workspaceId || !modelId || !validText) return
    const timer = window.setTimeout(() => {
      estimateAiTaskCost({ workspaceId, modelVersionId: modelId, operationCode: operation, prompt, params })
        .then((value: Estimate) => {
          if (current) setEstimate(value)
        })
        .catch((e: unknown) => {
          if (current) setEstimateError(getBusinessErrorMessage(e) || '费用预估失败')
        })
    }, 400)
    return () => {
      current = false
      window.clearTimeout(timer)
    }
  }, [workspaceId, modelId, operation, prompt, params, validText])

  useEffect(() => {
    const controller = new AbortController()
    if (!workspaceId) return
    let timer: ReturnType<typeof setTimeout>
    const refresh = async () => {
      try {
        const response = await listAiTasks({
          workspaceId,
          operationCode: operation,
          mine: true,
          limit: 20,
          signal: controller.signal,
        })
        if (controller.signal.aborted) return
        const next = rows<AudioTask>(response)
        setTasks(next)
        setHistoryError('')
        if (busy || next.some((t) => !isFinalTaskStatus(t.status))) timer = setTimeout(() => void refresh(), 4000)
      } catch (e) {
        if (!controller.signal.aborted) setHistoryError(getBusinessErrorMessage(e) || '历史记录加载失败')
      }
    }
    setTasks([])
    void refresh()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [workspaceId, operation, reload, busy])

  async function generate() {
    if (submitting.current || !model || !validText || !estimate) return
    const fingerprint = JSON.stringify({ workspaceId, operation, modelId, prompt, params })
    if (pendingKey.current?.fingerprint !== fingerprint)
      pendingKey.current = { fingerprint, key: `audio-${crypto.randomUUID()}` }
    submitting.current = true
    setBusy(true)
    setError('')
    try {
      const task = await createAiTask({
        workspaceId,
        capability: 'audio',
        operationCode: operation,
        modelVersionId: modelId,
        modelVersion: model,
        prompt,
        params,
        idempotencyKey: pendingKey.current.key,
      })
      const result = await waitForAiTask({ workspaceId, task, timeoutMs: 360000, onPoll: undefined, signal: undefined })
      if (!alive.current) return
      setTasks((existing) => [result, ...existing.filter((t) => t.id !== result.id)])
      pendingKey.current = null
      setReload((n) => n + 1)
    } catch (e) {
      // A known terminal failure may be retried as a new task; uncertain network
      // failures keep their key to avoid duplicate charges.
      if (e && typeof e === 'object' && 'response' in e) {
        const response = e.response as { status?: string } | undefined
        if (response?.status && isFinalTaskStatus(response.status)) pendingKey.current = null
      }
      if (alive.current) setError(getBusinessErrorMessage(e) || '生成未完成，请查看任务记录；重试会复用同一次提交。')
    } finally {
      submitting.current = false
      if (alive.current) {
        setBusy(false)
        setReload((n) => n + 1)
      }
    }
  }
  const fields = model?.params_schema?.fields || []
  const basicFields = ['speaker', 'context_text']
  const renderField = (field: Field) => (
    <label key={field.name} title={field.help}>
      {field.display_name || field.name}
      {field.type === 'bool' ? (
        <input
          type="checkbox"
          disabled={busy}
          checked={Boolean(params[field.name])}
          onChange={(e) => setParams({ ...params, [field.name]: e.target.checked })}
        />
      ) : field.type === 'select' ? (
        <select
          disabled={busy}
          value={String(params[field.name] ?? '')}
          onChange={(e) => {
            const value = field.options?.find((v) => String(v) === e.target.value) ?? e.target.value
            setParams({ ...params, [field.name]: value })
          }}
        >
          {field.options?.map((v) => (
            <option key={String(v)} value={String(v)}>
              {String(v)}
            </option>
          ))}
        </select>
      ) : (
        <input
          disabled={busy}
          type={field.type === 'number' ? 'number' : 'text'}
          min={field.min}
          max={field.max}
          step={1}
          required={field.required}
          value={String(params[field.name] ?? '')}
          onChange={(e) =>
            setParams({
              ...params,
              [field.name]: field.type === 'number' ? Number(e.target.value) : e.target.value,
            })
          }
        />
      )}
    </label>
  )
  const insufficient = estimate !== null && !estimate.can_afford
  return (
    <div className="audio-view">
      <AppSidebar activeKey="audio" onNavigate={navigate} open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="audio-view__main">
        <AppTopbar onMenu={() => setSidebarOpen(true)} />
        <main className="audio-view__body">
          <header className="audio-view__heading">
            <div>
              <h1>音频创作</h1>
              <p>创作对白、配乐与音效，或将文案转为自然语音。</p>
            </div>
            <button type="button" onClick={() => navigate('resources')}>
              我的素材
            </button>
          </header>
          <div className="audio-view__columns">
            <section className="audio-console" aria-label="音频生成表单">
              <div className="audio-tabs" role="tablist" aria-label="音频创作模式">
                <button
                  role="tab"
                  aria-selected={!isTTS}
                  disabled={busy}
                  onClick={() => {
                    setOperation('audio.generate')
                    setError('')
                  }}
                >
                  音频生成
                </button>
                <button
                  role="tab"
                  aria-selected={isTTS}
                  disabled={busy}
                  onClick={() => {
                    setOperation('audio.text_to_speech')
                    setError('')
                  }}
                >
                  语音合成
                </button>
              </div>
              {loading ? (
                <p role="status">正在加载可用模型…</p>
              ) : catalogError ? (
                <div role="alert">
                  {catalogError}
                  <button onClick={() => setCatalogReload((n) => n + 1)}>重新加载</button>
                </div>
              ) : !models.length ? (
                <p role="status">
                  当前工作空间暂无可用的{isTTS ? '语音合成' : '音频生成'}模型。请联系管理员配置豆包语音凭证并启用模型。
                </p>
              ) : (
                <>
                  <label>
                    模型
                    <select
                      disabled={busy}
                      value={modelId}
                      onChange={(e) => {
                        const id = Number(e.target.value)
                        setModelId(id)
                        setParams(defaults(models.find((m) => m.id === id)))
                      }}
                    >
                      {models.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.display_name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {isTTS ? '朗读文案' : '创作描述'}
                    <textarea
                      disabled={busy}
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      rows={7}
                      placeholder={
                        isTTS
                          ? '输入需要朗读的文字…'
                          : '描述对白、声音、配乐和时间安排，例如：生成 20 秒舒缓的钢琴配乐，伴随雨声，最后渐弱。'
                      }
                    />
                  </label>
                  <small className={Array.from(prompt).length > 3000 ? 'audio-error' : ''}>
                    {Array.from(prompt).length} / 3000 字符
                  </small>
                  <div className="audio-params">
                    {fields.filter((f) => basicFields.includes(f.name)).map(renderField)}
                  </div>
                  <details className="audio-advanced">
                    <summary>音频格式与声音调整</summary>
                    <div className="audio-params">
                      {fields.filter((f) => !basicFields.includes(f.name)).map(renderField)}
                    </div>
                  </details>
                  <p className="audio-hint">
                    {isTTS
                      ? '按朗读字符数计费，演绎要求不计费。'
                      : '单次最长 120 秒，时长通过描述控制。按 120 秒上限预留积分，完成后按原始生成时长结算并退回差额。'}
                  </p>
                  {estimateError && (
                    <p role="alert" className="audio-error">
                      {estimateError}
                    </p>
                  )}
                  {error && (
                    <p role="alert" className="audio-error">
                      {error}
                    </p>
                  )}
                  <div className="audio-submit">
                    <span aria-live="polite">
                      {estimate
                        ? `${isTTS ? '预计' : '最多预留'} ${Number(estimate.estimated_cost.toFixed(3))} 积分${creditsYuanSuffix(estimate.estimated_cost)}`
                        : validText
                          ? '正在预估费用…'
                          : '输入内容后预估费用'}
                    </span>
                    <button
                      className="audio-primary"
                      type="button"
                      disabled={busy || loading || !validText || !estimate || insufficient}
                      onClick={() => void generate()}
                    >
                      {busy ? '正在生成…' : insufficient ? '积分不足' : isTTS ? '合成语音' : '生成音频'}
                    </button>
                  </div>
                </>
              )}
            </section>
            <section className="audio-results" aria-label="音频任务记录">
              <header>
                <h2>最近生成</h2>
                <button onClick={() => setReload((n) => n + 1)}>刷新记录</button>
              </header>
              {historyError && (
                <p role="alert" className="audio-error">
                  {historyError}
                </p>
              )}
              {busy && <p role="status">正在生成音频，完成后自动保存到「我的素材」。</p>}
              {!tasks.length && !busy && (
                <div className="audio-empty">
                  <h3>从一段文字开始</h3>
                  <p>生成的声音将在这里呈现，可试听或下载后用于视频创作。</p>
                </div>
              )}
              {tasks.map((task) => (
                <article key={task.id} className="audio-result">
                  <div>
                    <strong>#{task.id}</strong>
                    <span>
                      {task.status === 'succeeded' ? '已完成' : isFinalTaskStatus(task.status) ? '未完成' : '生成中'}
                    </span>
                  </div>
                  <p>{task.prompt}</p>
                  {task.error_message && <p className="audio-error">{task.error_message}</p>}
                  {(task.outputs || [])
                    .filter((o) => o.type === 'audio')
                    .map((output, index) => {
                      const url = output.asset_id
                        ? `/api/v1/assets/${output.asset_id}/download?workspace_id=${workspaceId}`
                        : output.url
                      return url ? (
                        <div className="audio-output" key={output.asset_id || index}>
                          <audio controls preload="none" src={url} aria-label={`任务 ${task.id} 音频 ${index + 1}`} />
                          <a href={url} download>
                            下载音频
                          </a>
                        </div>
                      ) : null
                    })}
                  {task.status === 'succeeded' && !task.outputs?.some((o) => o.type === 'audio') && (
                    <p>音频正在保存，稍后刷新记录。</p>
                  )}
                  {task.actual_cost !== undefined && task.status === 'succeeded' && (
                    <small>实际消耗 {Number(task.actual_cost.toFixed(3))} 积分</small>
                  )}
                </article>
              ))}
            </section>
          </div>
        </main>
      </div>
    </div>
  )
}
