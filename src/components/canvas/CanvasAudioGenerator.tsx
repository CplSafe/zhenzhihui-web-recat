import { useEffect, useMemo, useRef, useState, type ClipboardEvent } from 'react'
import { useReactFlow } from '@xyflow/react'
import {
  createAiTask,
  estimateAiTaskCost,
  getAiTaskId,
  listAiModels,
  waitForAiTask,
  uploadAssetFile,
} from '@/api/business'
import {
  getBackendGenerationModelName,
  getBackendGenerationModelVersionId,
  unwrapGenerationModelCatalogResponse,
} from '@/utils/generationModelCatalog'
import { getModelParamFields, getModelParamOptionValues } from '@/utils/modelSchema'
import { findActiveWorkspaceAssetIds, resolveVerifiedResultAssetId } from '@/utils/taskMedia'
import { isAudioFile, normalizeAudioSettings, readAudioDuration } from '@/utils/canvasAudio'
import { assetStreamUrl } from '@/utils/assetUrl'
import { getModelInputConstraints } from '@/utils/modelInputConstraints'
import { getCopiedCanvasAudioReference } from '@/utils/canvasClipboard'
import { creditsYuanLabel } from '@/utils/creditsYuan'
import { useConfirmDialog, useToast } from '@/composables/useToast'
import {
  archiveGenerationFailure,
  buildGenerationFailure,
  generationSubmissionFingerprint,
  unknownSubmissionKey,
} from '@/utils/generationFailure'
import CanvasFailureDetails from './CanvasFailureDetails'
import {
  AUDIO_GENERATION_MODE_LABELS,
  getAudioGenerationMode,
  getModelAudioGenerationLabel,
  type AudioGenerationMode,
} from '@/utils/canvasAudioGeneration'
import styles from './CanvasAudioGenerator.module.css'
import CanvasAudioSettings from './CanvasAudioSettings'

const AUDIO_PARAM_LABELS: Record<string, string> = {
  speaker: '配音音色',
  context_text: '上下文文本',
  output_format: '输出格式',
  sample_rate: '采样率',
  speech_rate: '语速',
  loudness_rate: '音量',
  pitch_rate: '音调',
  enable_subtitle: '启用字幕',
  aigc_watermark: 'AIGC 标识',
}

function audioParamLabel(field: { name: string; displayName?: unknown }): string {
  const displayName = String(field.displayName || '').trim()
  if (/[\u4e00-\u9fff]/.test(displayName)) return displayName
  return AUDIO_PARAM_LABELS[field.name] || displayName || field.name
}

/** 只展示目录实际声明的音频操作，不猜模型名或杜撰独立生成接口。 */
export default function CanvasAudioGenerator({
  nodeId,
  data,
  workspaceId,
  onGenerated,
}: {
  nodeId: string
  data: Record<string, any>
  workspaceId: number
  onGenerated?: (nodeId: string, assetId: number, durationSec: number) => void
}) {
  const { updateNodeData, getEdges, getNode, getNodes } = useReactFlow()
  const { showToast } = useToast()
  const { requestConfirm } = useConfirmDialog()
  const [models, setModels] = useState<any[]>([])
  const [loadingModels, setLoadingModels] = useState(true)
  const [catalogHasModels, setCatalogHasModels] = useState(false)
  const [error, setError] = useState('')
  const [modelKey, setModelKey] = useState(
    data.modelVersionId && data.operationCode ? `${data.modelVersionId}:${data.operationCode}` : '',
  )
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const modelMenuRef = useRef<HTMLDivElement>(null)
  const settingsTrigger = useRef<HTMLButtonElement>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const hydratedModel = useRef('')
  const [modeMenuOpen, setModeMenuOpen] = useState(false)
  const modeMenuRef = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<AudioGenerationMode | ''>(
    data.operationCode ? getAudioGenerationMode(String(data.operationCode)) : '',
  )
  const [prompt, setPrompt] = useState(String(data.prompt || ''))
  const [referenceSearch, setReferenceSearch] = useState<string | null>(null)
  const [referenceRange, setReferenceRange] = useState<{ start: number; end: number } | null>(null)
  const [params, setParams] = useState<Record<string, unknown>>(data.params || {})
  const [authorized, setAuthorized] = useState(false)
  const [busy, setBusy] = useState(false)
  const [quote, setQuote] = useState<number | null>(null)
  const [quoteError, setQuoteError] = useState('')
  const [quoting, setQuoting] = useState(false)
  const quoteController = useRef<AbortController | null>(null)
  const uploadVersion = useRef(0)
  const [retry, setRetry] = useState(0)
  const [catalogRetry, setCatalogRetry] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const [uploadingReference, setUploadingReference] = useState(false)
  const [draggingReference, setDraggingReference] = useState(false)
  const referenceInput = useRef<HTMLInputElement>(null)
  const references = Array.isArray(data.audioReferences) ? data.audioReferences : []
  const canvasAudioReferences =
    referenceSearch === null
      ? []
      : getNodes()
          .filter(
            (node) =>
              node.id !== nodeId && (node.data?.kind || node.type) === 'audio' && Number(node.data?.assetId) > 0,
          )
          .filter((node) => Number(node.data?.assetWorkspaceId || workspaceId) === workspaceId)
          .filter(
            (node) => !references.some((reference: any) => Number(reference.assetId) === Number(node.data?.assetId)),
          )
          .filter((node) =>
            String(node.data?.title || node.data?.name || node.data?.prompt || `音频 ${node.data?.assetId}`)
              .toLowerCase()
              .includes(referenceSearch.toLowerCase()),
          )
          .slice(0, 8)
  const alive = useRef(true)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => {
    alive.current = true
    const abort = new AbortController()
    setLoadingModels(true)
    setModels([])
    setCatalogHasModels(false)
    setUploadingReference(false)
    setError('')
    listAiModels({ workspaceId, capability: 'audio', plan: '', signal: abort.signal })
      .then((payload: any) => {
        const raw = unwrapGenerationModelCatalogResponse(payload)
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
            .filter((code: unknown) => Boolean(getModelAudioGenerationLabel(model, code)))
            .map((operationCode: string) => ({
              model,
              operationCode,
              key: `${getBackendGenerationModelVersionId(model)}:${operationCode}`,
            }))
        })
        if (!abort.signal.aborted) {
          setModels(entries)
          setCatalogHasModels(raw.length > 0)
        }
      })
      .catch((e: any) => {
        if (!abort.signal.aborted) setError(e?.message || '音频模型加载失败')
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoadingModels(false)
      })
    return () => {
      alive.current = false
      abort.abort()
      controller.current?.abort()
      quoteController.current?.abort()
      uploadVersion.current += 1
    }
  }, [workspaceId, catalogRetry])
  const selected = models.find((m) => m.key === modelKey)
  useEffect(() => {
    if (!modelMenuOpen && !modeMenuOpen) return
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!modelMenuRef.current?.contains(event.target as Node)) setModelMenuOpen(false)
      if (!modeMenuRef.current?.contains(event.target as Node)) setModeMenuOpen(false)
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    return () => document.removeEventListener('mousedown', closeOnOutsideClick)
  }, [modelMenuOpen, modeMenuOpen])
  const selectedAudioConstraint = selected
    ? getModelInputConstraints(selected.model, selected.operationCode).roles.find(
        (role) => /audio/i.test(role.role) && role.maxCount > 0,
      )
    : undefined
  const availableModes = [...new Set(models.map((entry) => getAudioGenerationMode(entry.operationCode)))]
  const activeMode = mode && availableModes.includes(mode) ? mode : availableModes[0]
  const changeParams = (next: Record<string, unknown>) => {
    setParams(next)
    updateNodeData(nodeId, { params: next })
  }
  const selectModel = (key: string) => {
    setSettingsOpen(false)
    if (key === modelKey) {
      setModelMenuOpen(false)
      return
    }
    setModelKey(key)
    setModelMenuOpen(false)
    setAuthorized(false)
    const next = models.find((entry) => entry.key === key)
    if (next) setMode(getAudioGenerationMode(next.operationCode))
    const nextParams: Record<string, unknown> = {}
    let resetCount = 0
    for (const field of getModelParamFields(next?.model).filter(
      (field) => !['prompt', 'input_assets'].includes(field.name),
    )) {
      const previous = params[field.name]
      const options = getModelParamOptionValues(field)
      const numeric = field.type === 'number' || field.type === 'integer'
      const compatible =
        previous !== undefined &&
        (!options.length || options.some((option) => Object.is(option, previous))) &&
        (!numeric ||
          (typeof previous === 'number' &&
            Number.isFinite(previous) &&
            (field.type !== 'integer' || Number.isInteger(previous)) &&
            (typeof field.minimum !== 'number' || previous >= field.minimum) &&
            (typeof field.maximum !== 'number' || previous <= field.maximum))) &&
        (field.type !== 'boolean' || typeof previous === 'boolean') &&
        (field.type !== 'string' || typeof previous === 'string')
      if (compatible) nextParams[field.name] = previous
      else {
        if (field.default !== undefined) nextParams[field.name] = field.default
        if (previous !== undefined) resetCount += 1
      }
    }
    changeParams(nextParams)
    if (resetCount) showToast('部分参数不适用于当前模型，已恢复模型默认设置', 'info')
    updateNodeData(nodeId, {
      modelVersionId: next ? getBackendGenerationModelVersionId(next.model) : null,
      operationCode: next?.operationCode || '',
    })
  }
  const selectMode = (nextMode: AudioGenerationMode) => {
    setSettingsOpen(false)
    setMode(nextMode)
    setModeMenuOpen(false)
    setModelKey('')
    setAuthorized(false)
    changeParams({})
    updateNodeData(nodeId, { modelVersionId: null, operationCode: '' })
  }
  const fields = useMemo(
    () => getModelParamFields(selected?.model).filter((f) => !['prompt', 'input_assets'].includes(f.name)),
    [selected],
  )
  useEffect(() => {
    if (!selected) return
    const identity = `${workspaceId}:${nodeId}:${modelKey}`
    if (hydratedModel.current === identity) return
    hydratedModel.current = identity
    const missing = fields.filter((field) => params[field.name] === undefined && field.default !== undefined)
    if (!missing.length) return
    const next = { ...params, ...Object.fromEntries(missing.map((field) => [field.name, field.default])) }
    setParams(next)
    updateNodeData(nodeId, { params: next })
  }, [selected, fields, params, nodeId, workspaceId, modelKey, updateNodeData])
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
    const result = await waitForAiTask({
      workspaceId,
      task,
      signal,
      timeoutMs: 30 * 60_000,
      onPoll: (current: any) => {
        if (signal.aborted || !alive.current) return
        const progress = Number(current.progress)
        if (Number.isFinite(progress)) updateNodeData(nodeId, { taskProgress: Math.max(0, Math.min(100, progress)) })
      },
    })
    if (signal.aborted || !alive.current) return
    const assetId = await resolveVerifiedResultAssetId({
      workspaceId,
      task: result,
      type: 'audio',
      fallbackTaskId: task.id,
    })
    if (!assetId) throw new Error('任务已完成，但音频素材尚未入库，请稍后再查看')
    if (signal.aborted || !alive.current) return
    // 元数据暂不可读不应把已经入库的成功结果变回“生成失败”。播放器加载后补全时长。
    const durationSec = await readAudioDuration(assetStreamUrl(assetId, workspaceId)).catch(() => 0)
    if (signal.aborted || !alive.current) return
    // The task may finish after the user has edited this node or another canvas update has landed.
    // Merge against the current node, not the props captured when polling started.
    const latestData = (getNode(nodeId)?.data as Record<string, any> | undefined) || data
    const history = Array.isArray(latestData.resultHistory) ? latestData.resultHistory : []
    updateNodeData(nodeId, {
      assetId,
      assetWorkspaceId: workspaceId,
      assetSource: 'generated',
      taskStatus: 'succeeded',
      taskProgress: 100,
      taskError: '',
      resultUrl: assetStreamUrl(assetId, workspaceId),
      audio: normalizeAudioSettings({
        ...latestData.audio,
        durationSec,
        inSec: 0,
        outSec: durationSec,
        origin: 'generated',
      }),
      resultHistory: [
        ...history.filter((entry: any) => Number(entry?.assetId) !== assetId),
        { assetId, kind: 'audio', createdAt: new Date().toISOString(), prompt: String(latestData.prompt || '') },
      ].slice(-20),
    })
    onGenerated?.(nodeId, assetId, durationSec)
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
  const uploadReference = async (file?: File) => {
    if (!file || uploadingReference || running) return
    if (!isAudioFile(file) || file.size > 100 * 1024 * 1024) {
      showToast('请选择 100MB 以内的 MP3、WAV、M4A 或 AAC 音频', 'error')
      return
    }
    if (selectedAudioConstraint?.maxSizeBytes && file.size > selectedAudioConstraint.maxSizeBytes) {
      showToast('参考音频超过当前模型允许的文件大小', 'error')
      return
    }
    if (
      selectedAudioConstraint?.mimeTypes.length &&
      file.type &&
      !selectedAudioConstraint.mimeTypes.some(
        (mimeType) => mimeType.toLowerCase() === file.type.toLowerCase() || mimeType.toLowerCase() === 'audio/*',
      )
    ) {
      showToast('当前模型不支持这种参考音频格式', 'error')
      return
    }
    if (selectedAudioConstraint && references.length >= selectedAudioConstraint.maxCount) {
      showToast(`当前模型最多支持 ${selectedAudioConstraint.maxCount} 段参考音频`, 'error')
      return
    }
    setUploadingReference(true)
    const version = uploadVersion.current
    try {
      const result: any = await uploadAssetFile({ workspaceId, file })
      if (!alive.current || version !== uploadVersion.current) return
      const assetId = Number(result?.asset?.id)
      if (!(assetId > 0)) throw new Error('上传未返回素材 ID')
      const stored = getNode(nodeId)?.data?.audioReferences
      const current = Array.isArray(stored) ? stored : references
      updateNodeData(nodeId, { audioReferences: [...current, { assetId, workspaceId, title: file.name }] })
    } catch (e: any) {
      if (alive.current && version === uploadVersion.current) showToast(e?.message || '参考音频上传失败', 'error')
    } finally {
      if (alive.current && version === uploadVersion.current) setUploadingReference(false)
    }
  }
  const pasteReference = (event: ClipboardEvent<HTMLDivElement>) => {
    if (running || uploadingReference) return
    const file = Array.from(event.clipboardData.files).find(isAudioFile)
    if (file) {
      event.preventDefault()
      event.stopPropagation()
      void uploadReference(file)
      return
    }
    if (event.clipboardData.files.length) return
    const copied = getCopiedCanvasAudioReference()
    if (!copied) return
    event.preventDefault()
    event.stopPropagation()
    if (copied.workspaceId !== workspaceId) {
      showToast('参考音频必须属于当前工作空间', 'error')
      return
    }
    const stored = getNode(nodeId)?.data?.audioReferences
    const current = Array.isArray(stored) ? stored : references
    if (current.some((reference: any) => Number(reference.assetId) === copied.assetId)) {
      showToast('这段音频已在参考列表中', 'info')
      return
    }
    if (selectedAudioConstraint && current.length >= selectedAudioConstraint.maxCount) {
      showToast(`当前模型最多支持 ${selectedAudioConstraint.maxCount} 段参考音频`, 'error')
      return
    }
    updateNodeData(nodeId, { audioReferences: [...current, copied] })
  }
  const mentionReference = (node: ReturnType<typeof getNodes>[number]) => {
    const assetId = Number(node.data?.assetId)
    const stored = getNode(nodeId)?.data?.audioReferences
    const current = Array.isArray(stored) ? stored : references
    if (selectedAudioConstraint && current.length >= selectedAudioConstraint.maxCount) {
      showToast(`当前模型最多支持 ${selectedAudioConstraint.maxCount} 段参考音频`, 'error')
      return
    }
    const title = String(node.data?.title || node.data?.name || node.data?.prompt || `音频 ${assetId}`)
    const nextPrompt = referenceRange
      ? prompt.slice(0, referenceRange.start) + prompt.slice(referenceRange.end)
      : prompt
    updateNodeData(nodeId, {
      audioReferences: [...current, { assetId, workspaceId, title }],
      prompt: nextPrompt,
    })
    setPrompt(nextPrompt)
    setReferenceSearch(null)
    setReferenceRange(null)
  }
  const prepare = async (signal?: AbortSignal) => {
    if (!selected) throw new Error('请选择音频生成模型')
    const text = [linkedText, prompt.trim()].filter(Boolean).join('\n')
    if (Array.from(text).length > 2000) throw new Error('配音文案最多 2000 字，请缩短文案后重试')
    for (const field of fields) {
      if (field.required && (params[field.name] === undefined || params[field.name] === ''))
        throw new Error(`请填写${audioParamLabel(field)}`)
      const value = params[field.name]
      if (value === undefined || value === '') continue
      const options = getModelParamOptionValues(field)
      if (options.length && !options.some((option) => Object.is(option, value)))
        throw new Error(`${audioParamLabel(field)}不在当前模型支持的选项中`)
      if (field.type === 'number' || field.type === 'integer') {
        const number = Number(value)
        if (
          !Number.isFinite(number) ||
          (field.type === 'integer' && !Number.isInteger(number)) ||
          (typeof field.minimum === 'number' && number < field.minimum) ||
          (typeof field.maximum === 'number' && number > field.maximum)
        )
          throw new Error(`${audioParamLabel(field)}超出当前模型允许范围`)
      }
    }
    const audioConstraint = selectedAudioConstraint
    const linkedAudio = getEdges()
      .filter((edge) => edge.target === nodeId)
      .map((edge) => getNode(edge.source))
      .filter((node) => (node?.data?.kind || node?.type) === 'audio')
    if (linkedAudio.some((node) => Number(node?.data?.assetWorkspaceId || workspaceId) !== workspaceId))
      throw new Error('参考音频必须属于当前工作空间')
    if (linkedAudio.some((node) => !(Number(node?.data?.assetId) > 0))) throw new Error('请等待参考音频上传或生成完成')
    const referenceIds = [...new Set(linkedAudio.map((node) => Number(node?.data?.assetId)).filter((id) => id > 0))]
    for (const reference of references) {
      if (Number(reference.workspaceId) !== workspaceId) throw new Error('参考音频必须属于当前工作空间')
      const id = Number(reference.assetId)
      if (!(id > 0)) throw new Error('参考音频尚未入库')
      if (!referenceIds.includes(id)) referenceIds.push(id)
    }
    if (clone && !referenceIds.length && Number(data.assetId) > 0) {
      if (Number(data.assetWorkspaceId || workspaceId) !== workspaceId) throw new Error('声音样本必须属于当前工作空间')
      referenceIds.push(Number(data.assetId))
    }
    if (referenceIds.length && !audioConstraint && !clone)
      throw new Error('当前模型不支持参考音频，请断开参考连线或更换模型')
    if (
      audioConstraint &&
      (referenceIds.length < audioConstraint.minCount || referenceIds.length > audioConstraint.maxCount)
    )
      throw new Error(`当前模型需要 ${audioConstraint.minCount}～${audioConstraint.maxCount} 段参考音频`)
    const inputAssets = referenceIds.map((assetId) => ({ asset_id: assetId, role: audioConstraint?.role || 'audio' }))
    if (clone && !inputAssets.length) throw new Error('音色克隆需要先上传本人或已获授权的声音样本')
    if (referenceIds.length) {
      const activeReferences = await findActiveWorkspaceAssetIds(workspaceId, referenceIds, 'audio').catch(() => {
        throw new Error('暂时无法核验参考音频，请稍后重试')
      })
      const missing = referenceIds.find((id) => !activeReferences.has(id))
      if (missing) throw new Error(`参考音频（素材 ID ${missing}）已不可用，请重新选择当前团队的音频素材`)
    }
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const modelVersionId = getBackendGenerationModelVersionId(selected.model)
    const quote: any = await estimateAiTaskCost({
      workspaceId,
      modelVersionId,
      operationCode: selected.operationCode,
      prompt: text,
      params,
      inputAssets,
    })
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const cost = Number(quote?.estimated_cost)
    if (!Number.isFinite(cost) || cost < 0) throw new Error('无法确认生成费用，请稍后重试')
    if (quote?.can_afford === false) throw new Error('积分不足')
    return { text, inputAssets, modelVersionId, cost }
  }
  useEffect(() => {
    quoteController.current?.abort()
    setQuote(null)
    setQuoteError('')
    setQuoting(false)
    if (!selected || running || uploadingReference || (!prompt.trim() && !linkedText)) return
    const controller = new AbortController()
    quoteController.current = controller
    const timer = window.setTimeout(() => {
      if (controller.signal.aborted) return
      setQuoting(true)
      void prepare(controller.signal)
        .then(({ cost }) => {
          if (!controller.signal.aborted && alive.current) setQuote(cost)
        })
        .catch((e: any) => {
          if (!controller.signal.aborted && alive.current) setQuoteError(e?.message || '费用预估失败')
        })
        .finally(() => {
          if (!controller.signal.aborted && alive.current) setQuoting(false)
        })
    }, 400)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
    // 报价只随输入与模型变化；prepare 读取同次渲染的数据，不应随报价状态重复执行。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt, params, modelKey, linkedText, data.audioReferences, workspaceId, models, running, uploadingReference])
  const generate = async () => {
    if (!selected || running || uploadingReference || (!prompt.trim() && !linkedText) || (clone && !authorized)) return
    setBusy(true)
    setError('')
    const abort = new AbortController()
    controller.current = abort
    let submitted = false
    let submissionId = ''
    try {
      const { text, inputAssets, modelVersionId, cost } = await prepare(abort.signal)
      if (cost >= 500) {
        const confirm = await requestConfirm(`预计消耗 ${creditsYuanLabel(cost)}，用于生成音频，是否继续？`, {
          title: '生成音频',
        })
        if (!confirm || abort.signal.aborted) return
      }
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
        taskProgress: 0,
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
    <div className={`${styles.generator} canvas-audio-generator`}>
      {availableModes.length > 1 && (
        <div className={`${styles.mode} nodrag nopan`} data-audio-section="mode" ref={modeMenuRef}>
          <button
            type="button"
            className={styles.modelTrigger}
            aria-label="音频生成方式"
            aria-haspopup="listbox"
            aria-expanded={modeMenuOpen}
            disabled={running || loadingModels}
            onClick={() => {
              setModelMenuOpen(false)
              setModeMenuOpen((open) => !open)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                setModeMenuOpen(true)
                requestAnimationFrame(() =>
                  modeMenuRef.current?.querySelector<HTMLButtonElement>('[role="option"]')?.focus(),
                )
              }
              if (event.key === 'Escape') setModeMenuOpen(false)
            }}
          >
            <span className={styles.modelTriggerText}>
              {mode ? AUDIO_GENERATION_MODE_LABELS[mode] : '请选择配音类型'}
            </span>
            <span className={styles.modelChevron} aria-hidden="true">
              ⌄
            </span>
          </button>
          {modeMenuOpen && (
            <div
              className={styles.modelMenu}
              role="listbox"
              aria-label="配音类型列表"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setModeMenuOpen(false)
                  modeMenuRef.current?.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')?.focus()
                }
                if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
                event.preventDefault()
                const options = Array.from(
                  modeMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') || [],
                )
                const index = options.indexOf(document.activeElement as HTMLButtonElement)
                options[(index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length]?.focus()
              }}
            >
              {availableModes.map((entry) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={entry === mode}
                  className={`${styles.modelOption} ${entry === mode ? styles.modelOptionSelected : ''}`}
                  key={entry}
                  onClick={() => selectMode(entry)}
                >
                  <span className={styles.modelOptionDetails}>
                    <strong>{AUDIO_GENERATION_MODE_LABELS[entry]}</strong>
                  </span>
                  {entry === mode && (
                    <span className={styles.modelCheck} aria-hidden="true">
                      ✓
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div
        className={`${styles.references} ${draggingReference ? styles.referencesDragging : ''} nodrag nopan`}
        data-audio-section="references"
        aria-label="参考音频，可粘贴音频文件或已复制的画布音频节点"
        tabIndex={0}
        onPaste={pasteReference}
        onDragOver={(event) => {
          if (!Array.from(event.dataTransfer.types).includes('Files')) return
          event.preventDefault()
          setDraggingReference(true)
        }}
        onDragLeave={() => setDraggingReference(false)}
        onDrop={(event) => {
          setDraggingReference(false)
          if (!event.dataTransfer.files.length) return
          event.preventDefault()
          event.stopPropagation()
          void uploadReference(event.dataTransfer.files[0])
        }}
      >
        <button
          type="button"
          disabled={
            running ||
            uploadingReference ||
            Boolean(selectedAudioConstraint && references.length >= selectedAudioConstraint.maxCount)
          }
          onClick={() => referenceInput.current?.click()}
        >
          {uploadingReference ? '上传中…' : '+ 参考音频'}
        </button>
        <input
          ref={referenceInput}
          type="file"
          accept="audio/*,.mp3,.wav,.m4a,.aac"
          aria-label="上传参考音频"
          hidden
          onChange={(event) => {
            void uploadReference(event.target.files?.[0])
            event.target.value = ''
          }}
        />
        {references.map((reference: any, index: number) => (
          <div className={styles.reference} key={`${reference.assetId}-${index}`}>
            <span title={reference.title}>{reference.title || `音频 ${index + 1}`}</span>
            <audio
              controls
              preload="none"
              src={assetStreamUrl(Number(reference.assetId), Number(reference.workspaceId))}
              aria-label={`试听参考音频 ${index + 1}`}
            />
            <button
              type="button"
              disabled={running}
              aria-label={`移除参考音频 ${index + 1}`}
              onClick={() =>
                updateNodeData(nodeId, { audioReferences: references.filter((_: any, i: number) => i !== index) })
              }
            >
              ×
            </button>
          </div>
        ))}
        {!references.length && <span className={styles.referenceHint}>上传、拖入或粘贴音频</span>}
      </div>
      <div className={styles.promptContainer} data-audio-section="prompt-container">
        <textarea
          className={`${styles.prompt} ${expanded ? styles.expanded : ''}`}
          data-audio-section="prompt"
          aria-label="配音文案或音乐描述"
          value={prompt}
          disabled={running}
          maxLength={2000}
          placeholder={
            activeMode === 'music'
              ? '描述音乐风格、节奏与氛围'
              : activeMode === 'effect'
                ? '描述需要的声音、场景与时长'
                : activeMode === 'clone'
                  ? '输入要用参考声音朗读的文字'
                  : '输入配音文案或音乐描述'
          }
          onChange={(e) => {
            setPrompt(e.target.value)
            updateNodeData(nodeId, { prompt: e.target.value })
            const match = e.target.value.slice(0, e.target.selectionStart).match(/@([^@\n]*)$/)
            setReferenceSearch(match ? match[1] : null)
            setReferenceRange(
              match ? { start: e.target.selectionStart - match[0].length, end: e.target.selectionStart } : null,
            )
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setReferenceSearch(null)
              setReferenceRange(null)
            }
          }}
        />
        {referenceSearch !== null && (
          <div className={styles.mentionMenu} role="listbox" aria-label="引用画布音频">
            {canvasAudioReferences.length ? (
              canvasAudioReferences.map((node) => (
                <button
                  type="button"
                  role="option"
                  aria-selected="false"
                  key={node.id}
                  onClick={() => mentionReference(node)}
                >
                  {String(
                    node.data?.title || node.data?.name || node.data?.prompt || `音频 ${node.data?.assetId}`,
                  ).slice(0, 60)}
                </button>
              ))
            ) : (
              <span>没有可引用的画布音频</span>
            )}
          </div>
        )}
        <span
          className={styles.characterCount}
          aria-label="文案字数"
          title={linkedText ? '包含已接入的上游脚本文案' : undefined}
        >
          {Array.from([linkedText, prompt.trim()].filter(Boolean).join('\n')).length} / 2000 字
        </span>
      </div>
      <div className={styles.promptActions} data-audio-section="prompt-actions">
        <button
          type="button"
          aria-expanded={expanded}
          title={expanded ? '收起文案' : '展开文案'}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? '收起文案' : '展开文案'}
        </button>
        <button
          type="button"
          title="刷新模型"
          disabled={running || loadingModels || uploadingReference}
          onClick={() => setCatalogRetry((value) => value + 1)}
        >
          刷新模型
        </button>
      </div>
      <div className={`${styles.model} nodrag nopan`} data-audio-section="model" ref={modelMenuRef}>
        <button
          type="button"
          className={styles.modelTrigger}
          aria-label="音频生成模型"
          aria-haspopup="listbox"
          aria-expanded={modelMenuOpen}
          disabled={running || loadingModels || models.length === 0}
          onClick={() => {
            setModeMenuOpen(false)
            setModelMenuOpen((open) => !open)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              setModelMenuOpen(true)
              requestAnimationFrame(() =>
                modelMenuRef.current?.querySelector<HTMLButtonElement>('[role="option"]')?.focus(),
              )
            }
            if (event.key === 'Escape') setModelMenuOpen(false)
          }}
        >
          <span className={styles.modelTriggerText}>
            {selected
              ? `${getBackendGenerationModelName(selected.model)} · ${getModelAudioGenerationLabel(selected.model, selected.operationCode)}`
              : loadingModels
                ? '正在加载音频模型…'
                : models.length
                  ? '选择配音 / 音乐模型'
                  : '暂无可用音频生成模型'}
          </span>
          <span className={styles.modelChevron} aria-hidden="true">
            ⌄
          </span>
        </button>
        {modelMenuOpen && models.length > 0 && (
          <div
            className={styles.modelMenu}
            role="listbox"
            aria-label="音频生成模型列表"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setModelMenuOpen(false)
                modelMenuRef.current?.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')?.focus()
              }
              if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
              event.preventDefault()
              const options = Array.from(
                modelMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') || [],
              )
              const index = options.indexOf(document.activeElement as HTMLButtonElement)
              options[(index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length]?.focus()
            }}
          >
            {models.map((entry) => {
              const name = getBackendGenerationModelName(entry.model)
              const label = getModelAudioGenerationLabel(entry.model, entry.operationCode)
              return (
                <button
                  type="button"
                  role="option"
                  aria-selected={entry.key === modelKey}
                  className={`${styles.modelOption} ${entry.key === modelKey ? styles.modelOptionSelected : ''}`}
                  key={entry.key}
                  onClick={() => selectModel(entry.key)}
                >
                  <span className={styles.modelAvatar} aria-hidden="true">
                    {name.slice(0, 1)}
                  </span>
                  <span className={styles.modelOptionDetails}>
                    <strong>{name}</strong>
                    <small>{label}</small>
                  </span>
                  {entry.key === modelKey && (
                    <span className={styles.modelCheck} aria-hidden="true">
                      ✓
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>
      {!loadingModels && !error && models.length === 0 && (
        <p role="status">
          {catalogHasModels
            ? '当前目录未提供可生成音频的模型。语音识别输出文字，不能用于配音；请在后端为当前工作空间启用文字转语音或音乐生成模型。'
            : '当前工作空间未提供音频模型，请在后端配置并开放音频生成能力。'}
        </p>
      )}
      {!loadingModels && modelKey && !selected && (
        <p role="status">原选模型不可用于音频生成，请重新选择配音或音乐生成模型。</p>
      )}
      {selected && (
        <>
          {fields.length > 0 && (
            <div className={styles.parameters} data-audio-section="parameters">
              <button
                ref={settingsTrigger}
                className={styles.settingsTrigger}
                type="button"
                aria-haspopup="dialog"
                aria-expanded={settingsOpen}
                onClick={() => {
                  setModelMenuOpen(false)
                  setModeMenuOpen(false)
                  setSettingsOpen((value) => !value)
                }}
              >
                生成参数
              </button>
              {settingsOpen && settingsTrigger.current && (
                <CanvasAudioSettings
                  anchor={settingsTrigger.current}
                  fields={fields}
                  values={params}
                  disabled={running}
                  label={audioParamLabel}
                  onChange={changeParams}
                  onClose={() => setSettingsOpen(false)}
                />
              )}
            </div>
          )}
          {clone && (
            <label className={styles.authorization}>
              <input type="checkbox" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} />
              我确认该声音属于本人或已取得音色克隆授权
            </label>
          )}
          <div
            className={styles.costActions}
            data-audio-section="cost-actions"
            hidden={!prompt.trim() && !linkedText.trim()}
          >
            {quote !== null && (
              <span className={styles.costValue} role="status">
                预计 {creditsYuanLabel(quote)}
              </span>
            )}
            {quoting && <span role="status">预估中…</span>}
            {quoteError && <span role="alert">{quoteError}</span>}
          </div>
          <button
            className={styles.generate}
            data-audio-action="generate"
            type="button"
            disabled={running || uploadingReference || (!prompt.trim() && !linkedText) || (clone && !authorized)}
            onClick={() => void generate()}
          >
            {running ? '生成中…' : Number(data.assetId) > 0 ? '重新生成' : '生成音频'}
          </button>
        </>
      )}
      {running && (
        <p role="status">
          {data.taskStatus === 'result_pending'
            ? '正在重新获取生成结果'
            : Number(data.taskId) > 0
              ? `音频生成中${Number.isFinite(Number(data.taskProgress)) ? ` · ${Math.round(Number(data.taskProgress))}%` : ''}`
              : '正在预估费用并提交任务'}
          ，可关闭面板，任务会继续处理。
        </p>
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
