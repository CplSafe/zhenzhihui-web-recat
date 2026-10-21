import { useMentionNavigation } from '@/composables/useMentionNavigation'
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ClipboardEvent } from 'react'
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
  getAudioGenerationMode,
  getModelAudioGenerationLabel,
  type AudioGenerationMode,
} from '@/utils/canvasAudioGeneration'
import styles from './CanvasAudioGenerator.module.css'
import CanvasAudioSettings from './CanvasAudioSettings'
import { useWorkspaceSessionStore } from '@/stores/workspaceSession'
import { saveVoiceSample } from '@/utils/voiceLibrary'
import { getModelVoiceOptions, isModelVoiceField } from '@/utils/modelVoices'
import { getVoice, isVoiceReady } from '@/api/voices'
import { resolveWorkspaceRole } from '@/utils/creativeDraftMetadata'

const CanvasVoiceLibrary = lazy(() => import('./CanvasVoiceLibrary'))

const AUDIO_PARAM_LABELS: Record<string, string> = {
  speaker: '配音音色',
  context_text: '上下文文本',
  output_format: '输出格式',
  sample_rate: '采样率',
  speech_rate: '语速',
  loudness_rate: '音量',
  pitch_rate: '音调',
  aigc_watermark: 'AIGC 标识',
}

// 音频节点尚未接入字幕产物，旧草稿中的开关也不再提交。
function withoutSubtitleParam(values: Record<string, unknown>): Record<string, unknown> {
  const next = { ...values }
  delete next.enable_subtitle
  return next
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
  const userId = useWorkspaceSessionStore((state) => {
    const user = state.authSession?.user
    return String(user?.id ?? user?.user_id ?? user?.userId ?? user?.account_id ?? user?.uid ?? '')
  })
  const [sampleLibraryOpen, setSampleLibraryOpen] = useState(false)
  const [voiceLibraryTab, setVoiceLibraryTab] = useState<'model' | 'samples' | 'custom'>('custom')
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
  const [mode, setMode] = useState<AudioGenerationMode | ''>(
    data.operationCode ? getAudioGenerationMode(String(data.operationCode)) : '',
  )
  const [prompt, setPrompt] = useState(String(data.prompt || ''))
  const [referenceSearch, setReferenceSearch] = useState<string | null>(null)
  const [referenceRange, setReferenceRange] = useState<{ start: number; end: number } | null>(null)
  const [params, setParams] = useState<Record<string, unknown>>(() => withoutSubtitleParam(data.params || {}))
  useEffect(() => {
    if (data.params && Object.prototype.hasOwnProperty.call(data.params, 'enable_subtitle')) {
      updateNodeData(nodeId, { params: withoutSubtitleParam(data.params) })
    }
  }, [data.params, nodeId, updateNodeData])
  const serverVoiceId =
    typeof params.voice_id === 'number' && Number.isSafeInteger(params.voice_id) && params.voice_id > 0
      ? params.voice_id
      : 0
  const canManageVoices = useWorkspaceSessionStore((state) => {
    const member = Number(state.currentWorkspaceMemberWorkspaceId) === workspaceId ? state.currentWorkspaceMember : null
    const workspace = (state.userWorkspaces || state.authSession?.workspaces || []).find(
      (item: any) => Number(item.id) === workspaceId,
    )
    return ['owner', 'admin'].includes(resolveWorkspaceRole(member) || resolveWorkspaceRole(workspace))
  })
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
  }, [workspaceId, catalogRetry, userId])
  const selected = models.find((m) => m.key === modelKey)
  useEffect(() => {
    if (!modelMenuOpen) return
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!modelMenuRef.current?.contains(event.target as Node)) setModelMenuOpen(false)
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    return () => document.removeEventListener('mousedown', closeOnOutsideClick)
  }, [modelMenuOpen])
  const selectedAudioConstraint = selected
    ? getModelInputConstraints(selected.model, selected.operationCode).roles.find(
        (role) => /audio/i.test(role.role) && role.maxCount > 0,
      )
    : undefined
  const availableModes = [...new Set(models.map((entry) => getAudioGenerationMode(entry.operationCode)))]
  const activeMode = mode && availableModes.includes(mode) ? mode : availableModes[0]
  const supportsVoiceLibrary = Boolean(
    selected && ['voice', 'clone'].includes(getAudioGenerationMode(selected.operationCode)),
  )
  useEffect(() => {
    if (!selected || supportsVoiceLibrary) return
    const cleaned = { ...params }
    for (const name of Object.keys(cleaned)) {
      if (isModelVoiceField({ name })) delete cleaned[name]
    }
    if (Object.keys(cleaned).length !== Object.keys(params).length) {
      setParams(cleaned)
      updateNodeData(nodeId, { params: cleaned })
    }
  }, [selected, supportsVoiceLibrary, params, nodeId, updateNodeData])
  const changeParams = (next: Record<string, unknown>) => {
    const cleaned = withoutSubtitleParam(next)
    setParams(cleaned)
    updateNodeData(nodeId, { params: cleaned })
  }
  const selectModel = (key: string) => {
    if (uploadingReference) return
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
      (field) =>
        !['prompt', 'input_assets', 'enable_subtitle'].includes(field.name) &&
        (['voice', 'clone'].includes(getAudioGenerationMode(next?.operationCode || '')) || !isModelVoiceField(field)),
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
    if (serverVoiceId) {
      delete nextParams.voice_id
      if (next && ['voice', 'clone'].includes(getAudioGenerationMode(next.operationCode)))
        showToast('已切换模型，请重新选择兼容的公共音色', 'info')
    }
    changeParams(nextParams)
    if (resetCount) showToast('部分参数不适用于当前模型，已恢复模型默认设置', 'info')
    updateNodeData(nodeId, {
      modelVersionId: next ? getBackendGenerationModelVersionId(next.model) : null,
      operationCode: next?.operationCode || '',
    })
  }
  const fields = useMemo(
    () =>
      getModelParamFields(selected?.model).filter(
        (f) =>
          !['prompt', 'input_assets', 'enable_subtitle'].includes(f.name) &&
          (supportsVoiceLibrary || !isModelVoiceField(f)),
      ),
    [selected, supportsVoiceLibrary],
  )
  const voiceFields = fields.filter(isModelVoiceField)
  const settingsFields = fields.filter(
    (field) => !isModelVoiceField(field) || (!serverVoiceId && !getModelVoiceOptions(field).length),
  )
  useEffect(() => {
    if (!selected) return
    const identity = `${workspaceId}:${nodeId}:${modelKey}`
    if (hydratedModel.current === identity) return
    hydratedModel.current = identity
    const missing = fields.filter(
      (field) =>
        !(serverVoiceId && isModelVoiceField(field)) && params[field.name] === undefined && field.default !== undefined,
    )
    if (!missing.length) return
    const next = { ...params, ...Object.fromEntries(missing.map((field) => [field.name, field.default])) }
    setParams(next)
    updateNodeData(nodeId, { params: next })
  }, [selected, fields, params, nodeId, workspaceId, modelKey, updateNodeData, serverVoiceId])
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
  const uploadReference = async (file?: File, saveSample = false): Promise<boolean> => {
    if (!file || uploadingReference || running) return false
    if (saveSample && !selectedAudioConstraint && !clone) {
      showToast('请先选择支持参考音频的克隆模型', 'error')
      return false
    }
    if (!isAudioFile(file) || file.size > 100 * 1024 * 1024) {
      showToast('请选择 100MB 以内的 MP3、WAV、M4A 或 AAC 音频', 'error')
      return false
    }
    if (selectedAudioConstraint?.maxSizeBytes && file.size > selectedAudioConstraint.maxSizeBytes) {
      showToast('参考音频超过当前模型允许的文件大小', 'error')
      return false
    }
    if (
      selectedAudioConstraint?.mimeTypes.length &&
      file.type &&
      !selectedAudioConstraint.mimeTypes.some(
        (mimeType) => mimeType.toLowerCase() === file.type.toLowerCase() || mimeType.toLowerCase() === 'audio/*',
      )
    ) {
      showToast('当前模型不支持这种参考音频格式', 'error')
      return false
    }
    const storedBeforeUpload = getNode(nodeId)?.data?.audioReferences
    const beforeUpload = Array.isArray(storedBeforeUpload) ? storedBeforeUpload : references
    if (selectedAudioConstraint && beforeUpload.length >= selectedAudioConstraint.maxCount) {
      showToast(`当前模型最多支持 ${selectedAudioConstraint.maxCount} 段参考音频`, 'error')
      return false
    }
    setUploadingReference(true)
    const version = uploadVersion.current
    try {
      const result: any = await uploadAssetFile({ workspaceId, file })
      if (!alive.current || version !== uploadVersion.current) return false
      const assetId = Number(result?.asset?.id)
      if (!(assetId > 0)) throw new Error('上传未返回素材 ID')
      const stored = getNode(nodeId)?.data?.audioReferences
      const current = Array.isArray(stored) ? stored : references
      updateNodeData(nodeId, { audioReferences: [...current, { assetId, workspaceId, title: file.name }] })
      if (saveSample && userId) {
        try {
          saveVoiceSample(userId, workspaceId, assetId, file.name.replace(/\.[^.]+$/, ''))
        } catch {
          showToast('样本已上传，但本机收藏失败，请检查存储权限', 'info')
        }
      }
      return true
    } catch (e: any) {
      if (alive.current && version === uploadVersion.current) showToast(e?.message || '参考音频上传失败', 'error')
      return false
    } finally {
      if (alive.current && version === uploadVersion.current) setUploadingReference(false)
    }
  }
  const referenceLibrarySample = async (assetId: number, title: string): Promise<boolean> => {
    if (running || uploadingReference) return false
    const version = uploadVersion.current
    setUploadingReference(true)
    try {
      const active = await findActiveWorkspaceAssetIds(workspaceId, [assetId], 'audio')
      if (!alive.current || version !== uploadVersion.current) return false
      if (!active.has(assetId)) throw new Error('样本素材已失效，请移除收藏并重新上传')
      if (!selectedAudioConstraint && !clone) throw new Error('请先选择支持参考音频的模型')
      const stored = getNode(nodeId)?.data?.audioReferences
      const current = Array.isArray(stored) ? stored : references
      if (current.some((item: any) => Number(item.assetId) === assetId)) return true
      if (selectedAudioConstraint && current.length >= selectedAudioConstraint.maxCount)
        throw new Error(`当前模型最多支持 ${selectedAudioConstraint.maxCount} 段参考音频`)
      updateNodeData(nodeId, { audioReferences: [...current, { assetId, workspaceId, title }] })
      return true
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
  const mentionInputRef = useRef<HTMLTextAreaElement>(null)
  const { activeIndex: referenceActive, setActiveIndex: setReferenceActive } = useMentionNavigation(
    referenceSearch !== null,
    canvasAudioReferences.map((node) => node.id),
    mentionInputRef,
    (index) => mentionReference(canvasAudioReferences[index]),
    () => {
      setReferenceSearch(null)
      setReferenceRange(null)
    },
  )
  useEffect(() => {
    if (referenceSearch !== null)
      mentionInputRef.current?.parentElement
        ?.querySelector('[aria-selected="true"]')
        ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [referenceSearch, referenceActive])
  const prepare = async (signal?: AbortSignal) => {
    if (!selected) throw new Error('请选择音频生成模型')
    if (serverVoiceId) {
      const voice = await getVoice({ workspaceId, signal }, serverVoiceId)
      if (!isVoiceReady(voice)) throw new Error('所选音色已不可用或尚未训练完成，请在音色库中重新选择')
      if (voice.source === 'cloned' && Number(voice.workspace_id) !== workspaceId)
        throw new Error('音色不属于当前工作空间，请重新选择')
    }
    const text = [linkedText, prompt.trim()].filter(Boolean).join('\n')
    if (Array.from(text).length > 2000) throw new Error('配音文案最多 2000 字，请缩短文案后重试')
    for (const field of fields) {
      if (serverVoiceId && isModelVoiceField(field)) continue
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
    if (clone && !serverVoiceId && !referenceIds.length && Number(data.assetId) > 0) {
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
    if (clone && !serverVoiceId && !inputAssets.length) throw new Error('音色克隆需要先上传本人或已获授权的声音样本')
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
    if (
      !selected ||
      running ||
      uploadingReference ||
      (!prompt.trim() && !linkedText) ||
      (clone && !serverVoiceId && !authorized)
    )
      return
    setBusy(true)
    setError('')
    const abort = new AbortController()
    controller.current = abort
    let submitted = false
    let submissionId = ''
    let finalStatus = String(data.taskStatus || '')
    updateNodeData(nodeId, { taskStatus: 'preparing' })
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
      finalStatus = 'processing'
      // taskId 写回后由恢复 effect 接管轮询，提交链路不再启动第二个等待。
    } catch (e: any) {
      if (!abort.signal.aborted) {
        finalStatus = 'submit_failed'
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
      updateNodeData(nodeId, { taskStatus: finalStatus })
      if (alive.current && !abort.signal.aborted) setBusy(false)
    }
  }
  return (
    <div className={`${styles.generator} canvas-audio-generator`}>
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
        <button
          type="button"
          disabled={running || uploadingReference || !userId}
          onClick={() => {
            setVoiceLibraryTab('samples')
            setSampleLibraryOpen(true)
            setSettingsOpen(false)
          }}
        >
          音色库
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
            <button
              type="button"
              disabled={running || !userId}
              onClick={() => {
                try {
                  if (Number(reference.workspaceId) !== workspaceId) throw new Error('不能收藏其他工作空间的样本')
                  saveVoiceSample(userId, workspaceId, Number(reference.assetId), String(reference.title || '声音样本'))
                  showToast('已收藏到本机声音样本库', 'success')
                } catch (e: any) {
                  showToast(e?.message || '收藏失败', 'error')
                }
              }}
            >
              收藏样本
            </button>
            <audio
              controls
              preload="none"
              src={assetStreamUrl(Number(reference.assetId), Number(reference.workspaceId))}
              aria-label={`试听参考音频 ${index + 1}`}
            />
            <button
              type="button"
              disabled={running || uploadingReference}
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
      {supportsVoiceLibrary && (
        <>
          <button
            type="button"
            className={styles.settingsTrigger}
            disabled={running || uploadingReference || !userId}
            aria-haspopup="dialog"
            onClick={() => {
              setVoiceLibraryTab('custom')
              setSampleLibraryOpen(true)
              setSettingsOpen(false)
              setModelMenuOpen(false)
            }}
          >
            音色库
          </button>
          {serverVoiceId > 0 && <span className={styles.referenceHint}>已选公共音色 #{serverVoiceId}</span>}
        </>
      )}
      {sampleLibraryOpen && userId && (
        <Suspense fallback={<p role="status">正在加载音色库…</p>}>
          <CanvasVoiceLibrary
            key={`${userId}:${workspaceId}:${modelKey}`}
            userId={userId}
            workspaceId={workspaceId}
            modelName={selected ? getBackendGenerationModelName(selected.model) : ''}
            modelVersionId={selected ? getBackendGenerationModelVersionId(selected.model) : undefined}
            canManage={canManageVoices}
            onSelectVoice={
              supportsVoiceLibrary
                ? (voice) => {
                    const next = { ...params }
                    for (const field of voiceFields) delete next[field.name]
                    changeParams({ ...next, voice_id: voice.id })
                    showToast(`已选用音色：${voice.name}`, 'success')
                  }
                : undefined
            }
            fields={voiceFields}
            values={params}
            initialTab={voiceLibraryTab}
            disabled={running || uploadingReference}
            onApply={(values) => {
              const next = { ...params }
              delete next.voice_id
              changeParams({ ...next, ...values })
            }}
            onUpload={(file) => uploadReference(file, true)}
            onReference={referenceLibrarySample}
            onClose={() => setSampleLibraryOpen(false)}
          />
        </Suspense>
      )}
      <div className={styles.promptContainer} data-audio-section="prompt-container">
        <textarea
          className={`${styles.prompt} ${expanded ? styles.expanded : ''}`}
          ref={mentionInputRef}
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
              canvasAudioReferences.map((node, index) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={index === referenceActive}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setReferenceActive(index)}
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
          <svg className={styles.modelChevron} viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="m4 6 4 4 4-4"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
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
            ? '当前目录未提供可生成音频的模型。语音识别输出文字，不能用于配音；请切换到已开放音频模型的工作空间，或联系管理员为当前空间启用文字转语音或音乐生成模型。'
            : '当前工作空间未提供音频模型，请切换到已开放音频模型的工作空间，或联系管理员开放音频生成能力。'}
        </p>
      )}
      {!loadingModels && modelKey && !selected && (
        <p role="status">原选模型不可用于音频生成，请重新选择配音或音乐生成模型。</p>
      )}
      {selected && (
        <>
          {settingsFields.length > 0 && (
            <div className={styles.parameters} data-audio-section="parameters">
              <button
                ref={settingsTrigger}
                className={styles.settingsTrigger}
                type="button"
                aria-haspopup="dialog"
                aria-expanded={settingsOpen}
                onClick={() => {
                  setModelMenuOpen(false)
                  setSettingsOpen((value) => !value)
                }}
              >
                生成参数
              </button>
              {settingsOpen && settingsTrigger.current && (
                <CanvasAudioSettings
                  anchor={settingsTrigger.current}
                  fields={settingsFields}
                  values={params}
                  disabled={running}
                  label={audioParamLabel}
                  onChange={(values) =>
                    changeParams({
                      ...Object.fromEntries(
                        voiceFields
                          .filter((field) => getModelVoiceOptions(field).length > 0 && params[field.name] !== undefined)
                          .map((field) => [field.name, params[field.name]]),
                      ),
                      ...values,
                      ...(serverVoiceId ? { voice_id: serverVoiceId } : {}),
                    })
                  }
                  onClose={() => setSettingsOpen(false)}
                />
              )}
            </div>
          )}
          {clone && !serverVoiceId && (
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
            {quoteError && quoteError !== '请填写voice_id' && <span role="alert">{quoteError}</span>}
          </div>
        </>
      )}
      <button
        className={styles.generate}
        data-audio-action="generate"
        type="button"
        disabled={
          loadingModels ||
          !selected ||
          running ||
          uploadingReference ||
          (!prompt.trim() && !linkedText) ||
          (clone && !serverVoiceId && !authorized)
        }
        title={loadingModels ? '正在加载音频模型' : !selected ? '请先选择配音 / 音乐模型' : undefined}
        onClick={() => void generate()}
      >
        {running ? '生成中…' : Number(data.assetId) > 0 ? '重新生成' : '生成音频'}
      </button>
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
