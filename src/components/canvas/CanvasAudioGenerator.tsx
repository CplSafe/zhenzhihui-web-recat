import { useEffect, useMemo, useRef, useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import { createAiTask, estimateAiTaskCost, getAiTaskId, listAiModels, waitForAiTask } from '@/api/business'
import { getBackendGenerationModelName, getBackendGenerationModelVersionId } from '@/utils/generationModelCatalog'
import { getModelParamFields, getModelParamOptionValues } from '@/utils/modelSchema'
import { findAssetIdByTaskId } from '@/utils/taskMedia'
import { normalizeAudioSettings, readAudioDuration } from '@/utils/canvasAudio'
import { assetStreamUrl } from '@/utils/assetUrl'
import { getModelInputConstraints } from '@/utils/modelInputConstraints'
import { creditsYuanLabel } from '@/utils/creditsYuan'
import { useConfirmDialog, useToast } from '@/composables/useToast'
import {
  archiveGenerationFailure,
  buildGenerationFailure,
  generationSubmissionFingerprint,
  unknownSubmissionKey,
} from '@/utils/generationFailure'
import CanvasFailureDetails from './CanvasFailureDetails'

/** 只展示目录实际声明的音频操作，不猜模型名或杜撰独立生成接口。 */
export default function CanvasAudioGenerator({
  nodeId,
  data,
  workspaceId,
}: {
  nodeId: string
  data: Record<string, any>
  workspaceId: number
}) {
  const { updateNodeData, getEdges, getNode } = useReactFlow()
  const { showToast } = useToast()
  const { requestConfirm } = useConfirmDialog()
  const [models, setModels] = useState<any[]>([])
  const [error, setError] = useState('')
  const [modelKey, setModelKey] = useState(
    data.modelVersionId && data.operationCode ? `${data.modelVersionId}:${data.operationCode}` : '',
  )
  const [prompt, setPrompt] = useState(String(data.prompt || ''))
  const [params, setParams] = useState<Record<string, unknown>>(data.params || {})
  const [authorized, setAuthorized] = useState(false)
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState(0)
  const alive = useRef(true)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => {
    alive.current = true
    const abort = new AbortController()
    listAiModels({ workspaceId, plan: '', signal: abort.signal })
      .then((payload: any) => {
        const raw = Array.isArray(payload) ? payload : payload?.items || payload?.models || payload?.data?.items || []
        const entries = (Array.isArray(raw) ? raw : []).flatMap((model: any) => {
          const declared =
            model.operation_codes ??
            model.operationCodes ??
            model.operations ??
            model.operation_code ??
            model.operationCode ??
            []
          const codes = Array.isArray(declared) ? declared : String(declared).split(/[\s,|]+/)
          return codes
            .filter((code: unknown) => typeof code === 'string' && /^audio\./.test(code))
            .map((operationCode: string) => ({
              model,
              operationCode,
              key: `${getBackendGenerationModelVersionId(model)}:${operationCode}`,
            }))
        })
        if (!abort.signal.aborted) setModels(entries)
      })
      .catch((e: any) => {
        if (!abort.signal.aborted) setError(e?.message || '音频模型加载失败')
      })
    return () => {
      alive.current = false
      abort.abort()
      controller.current?.abort()
    }
  }, [workspaceId])
  const selected = models.find((m) => m.key === modelKey)
  const changeParams = (next: Record<string, unknown>) => {
    setParams(next)
    updateNodeData(nodeId, { params: next })
  }
  const fields = useMemo(
    () => getModelParamFields(selected?.model).filter((f) => !['prompt', 'input_assets'].includes(f.name)),
    [selected],
  )
  const clone = /clone/i.test(selected?.operationCode || '')
  const linkedText = getEdges()
    .filter((edge) => edge.target === nodeId)
    .map((edge) => getNode(edge.source))
    .filter((node) => node?.data?.kind === 'text')
    .map((node) => String(node?.data?.text || ''))
    .filter(Boolean)
    .join('\n')
  const running = busy || ['processing', 'pending', 'queued', 'running', 'result_pending'].includes(data.taskStatus)
  const receive = async (task: any, signal: AbortSignal) => {
    const result = await waitForAiTask({ workspaceId, task, signal, timeoutMs: 30 * 60_000 })
    const assetId = await findAssetIdByTaskId(workspaceId, getAiTaskId(result), 'audio')
    if (!assetId) throw new Error('任务已完成，但音频素材尚未入库，请稍后再查看')
    const durationSec = await readAudioDuration(assetStreamUrl(assetId, workspaceId))
    if (signal.aborted || !alive.current) return
    updateNodeData(nodeId, {
      assetId,
      assetWorkspaceId: workspaceId,
      assetSource: 'generated',
      taskStatus: 'succeeded',
      taskError: '',
      resultUrl: assetStreamUrl(assetId, workspaceId),
      audio: normalizeAudioSettings({ ...data.audio, durationSec, inSec: 0, outSec: durationSec, origin: 'generated' }),
    })
  }
  // 在途任务刷新后继续等同一个任务，不重新提交或重复扣费。
  useEffect(() => {
    if (
      !(Number(data.taskId) > 0) ||
      !['processing', 'pending', 'queued', 'running', 'result_pending'].includes(data.taskStatus)
    )
      return
    const abort = new AbortController()
    setBusy(true)
    void receive({ id: data.taskId, status: data.taskStatus }, abort.signal)
      .catch((e) => {
        if (!abort.signal.aborted) {
          setError(e?.message || '读取音频任务失败')
          updateNodeData(nodeId, {
            taskStatus: ['failed', 'error', 'payment_failed', 'cancelled', 'expired'].includes(e?.response?.status)
              ? 'failed'
              : 'result_pending',
            taskError: e?.message || '读取音频任务失败',
            taskFailure: buildGenerationFailure(e, { taskId: data.taskId, submitted: true }),
          })
        }
      })
      .finally(() => {
        if (!abort.signal.aborted) setBusy(false)
      })
    return () => abort.abort()
    // 仅任务身份改变时恢复，进度回写不重复启动轮询。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.taskId, workspaceId, nodeId, retry])
  const generate = async () => {
    if (!selected || running || (!prompt.trim() && !linkedText) || (clone && !authorized)) return
    setBusy(true)
    setError('')
    const abort = new AbortController()
    controller.current = abort
    let submitted = false
    let submissionId = ''
    try {
      const text = [linkedText, prompt.trim()].filter(Boolean).join('\n')
      for (const field of fields) {
        if (field.required && (params[field.name] === undefined || params[field.name] === ''))
          throw new Error(`请填写${String(field.displayName || field.name)}`)
      }
      const audioRole =
        getModelInputConstraints(selected.model, selected.operationCode).roles.find((role) => /audio/i.test(role.role))
          ?.role || 'audio'
      const inputAssets = clone && Number(data.assetId) > 0 ? [{ asset_id: Number(data.assetId), role: audioRole }] : []
      if (clone && !inputAssets.length) throw new Error('音色克隆需要先上传本人或已获授权的声音样本')
      const modelVersionId = getBackendGenerationModelVersionId(selected.model)
      const quote: any = await estimateAiTaskCost({
        workspaceId,
        modelVersionId,
        operationCode: selected.operationCode,
        prompt: text,
        params,
        inputAssets,
      })
      if (abort.signal.aborted) return
      const cost = Number(quote?.estimated_cost)
      if (!Number.isFinite(cost) || cost < 0) throw new Error('无法确认生成费用，请稍后重试')
      if (quote?.can_afford === false) throw new Error('积分不足')
      const confirm = await requestConfirm(`预计费用 ${cost === 0 ? '0 元' : creditsYuanLabel(cost)}，是否生成音频？`, {
        title: '生成音频',
      })
      if (!confirm || abort.signal.aborted) return
      const fingerprint = await generationSubmissionFingerprint({
        workspaceId,
        modelVersionId,
        operationCode: selected.operationCode,
        prompt: text,
        params,
        inputAssets,
      })
      if (abort.signal.aborted || !alive.current) return
      submissionId = unknownSubmissionKey(data, fingerprint) || crypto.randomUUID()
      updateNodeData(nodeId, {
        taskFailure: undefined,
        taskFailureHistory: archiveGenerationFailure(data),
        taskSubmissionFingerprint: fingerprint,
        taskIdempotencyKey: submissionId,
      })
      submitted = true
      const task = await createAiTask({
        workspaceId,
        modelVersionId,
        modelVersion: selected.model,
        operationCode: selected.operationCode,
        prompt: text,
        params,
        inputAssets,
        signal: abort.signal,
        idempotencyKey: submissionId,
        modelPlanCandidates: [],
      })
      if (abort.signal.aborted || !alive.current) return
      if (!(getAiTaskId(task) > 0)) throw new Error('生成接口未返回有效任务 ID')
      updateNodeData(nodeId, {
        prompt,
        params,
        modelVersionId,
        operationCode: selected.operationCode,
        taskId: getAiTaskId(task),
        taskStatus: 'processing',
      })
      // taskId 写回后由恢复 effect 接管轮询，提交链路不再启动第二个等待。
    } catch (e: any) {
      if (!abort.signal.aborted) {
        updateNodeData(nodeId, {
          taskStatus: 'submit_failed',
          taskId: 0,
          taskError: e?.message || '音频生成失败',
          taskFailureHistory: archiveGenerationFailure(data),
          taskFailure: buildGenerationFailure(e, { submitted, submissionId: submitted ? submissionId : undefined }),
        })
        setError(e?.message || '音频生成失败')
        showToast(e?.message || '音频生成失败', 'error')
      }
    } finally {
      if (alive.current && !abort.signal.aborted) setBusy(false)
    }
  }
  return (
    <div>
      <label>
        AI 音频生成
        <select
          aria-label="音频生成模型"
          disabled={running}
          value={modelKey}
          onChange={(e) => {
            setModelKey(e.target.value)
            setAuthorized(false)
            const next = models.find((m) => m.key === e.target.value)
            changeParams(
              Object.fromEntries(
                getModelParamFields(next?.model)
                  .filter((f) => f.default !== undefined && !['prompt', 'input_assets'].includes(f.name))
                  .map((f) => [f.name, f.default]),
              ),
            )
            updateNodeData(nodeId, {
              modelVersionId: next ? getBackendGenerationModelVersionId(next.model) : null,
              operationCode: next?.operationCode || '',
            })
          }}
        >
          <option value="">{models.length ? '选择配音 / 音乐模型' : '暂无可用音频生成模型'}</option>
          {models.map((m) => (
            <option key={m.key} value={m.key}>
              {getBackendGenerationModelName(m.model)} ·{' '}
              {/clone/i.test(m.operationCode)
                ? '音色克隆'
                : /music|bgm/i.test(m.operationCode)
                  ? '背景音乐'
                  : '配音 / 音频'}
            </option>
          ))}
        </select>
      </label>
      {selected && (
        <>
          <textarea
            aria-label="配音文案或音乐描述"
            value={prompt}
            placeholder="输入配音文案或音乐描述"
            onChange={(e) => {
              setPrompt(e.target.value)
              updateNodeData(nodeId, { prompt: e.target.value })
            }}
          />
          {fields.map((f) => {
            const options = getModelParamOptionValues(f)
            return (
              <label key={f.name}>
                {String(f.displayName || f.name)}
                {f.type === 'boolean' ? (
                  <input
                    type="checkbox"
                    checked={params[f.name] === true}
                    onChange={(e) => changeParams({ ...params, [f.name]: e.target.checked })}
                  />
                ) : options.length ? (
                  <select
                    value={String(params[f.name] ?? '')}
                    onChange={(e) =>
                      changeParams({ ...params, [f.name]: options.find((o) => String(o) === e.target.value) })
                    }
                  >
                    <option value="">请选择</option>
                    {options.map((o) => (
                      <option key={String(o)} value={String(o)}>
                        {String(o)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={f.type === 'number' || f.type === 'integer' ? 'number' : 'text'}
                    min={typeof f.minimum === 'number' ? f.minimum : undefined}
                    max={typeof f.maximum === 'number' ? f.maximum : undefined}
                    step={f.type === 'integer' ? 1 : 'any'}
                    value={String(params[f.name] ?? '')}
                    onChange={(e) =>
                      changeParams({
                        ...params,
                        [f.name]:
                          e.target.value === ''
                            ? undefined
                            : f.type === 'number' || f.type === 'integer'
                              ? Number(e.target.value)
                              : e.target.value,
                      })
                    }
                  />
                )}
              </label>
            )
          })}
          {clone && (
            <label>
              <input type="checkbox" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} />
              我确认该声音属于本人或已取得音色克隆授权
            </label>
          )}
          {linkedText && <small>已接入脚本文案</small>}
          <button
            type="button"
            disabled={running || (!prompt.trim() && !linkedText) || (clone && !authorized)}
            onClick={() => void generate()}
          >
            {running ? '生成中…' : '生成音频'}
          </button>
        </>
      )}
      {error && (
        <p role="alert">
          {error} <CanvasFailureDetails data={data.taskFailure ? data : { ...data, taskId: 0, taskError: error }} />
        </p>
      )}
      {data.taskStatus === 'result_pending' && !busy && (
        <button type="button" onClick={() => setRetry((value) => value + 1)}>
          重新获取已有任务结果
        </button>
      )}
    </div>
  )
}
