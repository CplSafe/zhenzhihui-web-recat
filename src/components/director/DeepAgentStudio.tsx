import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, List, Square, X } from 'lucide-react'
import { canvasAllowsModel } from '@/utils/canvasModelBuckets'
import type { CanvasModelDefaults } from '@/api/canvasApi'
import { RequestAbortError } from '@/api/requestTimeout'
import { getAccountSwitchId } from '@/api/accountSwitch'
import { Approval, Dialog, Popover, DocumentEditor, Conversation, Results, TooltipLayer } from './StudioCards'
import { defaultModel, StudioHTTPError, contextInfo, conversationCredits, isInsufficientCreditsEvent } from './studio'
import type { Data, StudioAttachment, StudioDocument, StudioRun } from './studio'
import { useStudio } from './useStudio'
import { ScriptEpisodes } from './ScriptEpisodes'
import type { EpisodeDecision } from './ScriptEpisodes'
import { StudioMediaContext } from './StudioMedia'
import { StudioIcon } from './StudioIcons'
import { StudioAssetPicker } from './StudioAssetPicker'
import { DoudouMascot } from './DoudouMascot'
import { MediaRetry } from './MediaRetry'
import { doudouLabels, doudouState } from './doudouState'
import styles from './DeepAgentStudio.module.css'
import type { CanvasReference } from './canvasReference'
import { openMemberCenterTab } from '@/stores/ui'
import { useWorkspaceId, useWorkspaceSessionStore } from '@/stores/workspaceSession'

export interface DeepAgentStudioProps {
  apiBase?: string
  workspaceId?: number
  modelDefaults?: CanvasModelDefaults
  canvasId?: number
  chooseRunLock?: () => Promise<boolean>
  canvasLockControls?: ReactNode
  authMode?: 'business' | 'oauth'
  onCanvasChange?: (canvas: Data) => void
  onCollapse?: () => void
  className?: string
  canvasReference?: CanvasReference
}
/** Embeddable Studio: the host owns placement; the service owns auth, tools, billing and execution. */
export default function DeepAgentStudio(props: DeepAgentStudioProps) {
  if (!getAccountSwitchId()) return <ConnectedDeepAgentStudio {...props} />
  return (
    <section className={styles.studio} aria-label="DoDo Agent">
      <p className={styles.emptyHint} role="status">
        身份切换期间无法连接 DoDo Agent。
      </p>
      {props.onCollapse && (
        <button type="button" onClick={props.onCollapse}>
          收起 DoDo Agent
        </button>
      )}
    </section>
  )
}

function ConnectedDeepAgentStudio({
  apiBase = '/agent-studio',
  workspaceId,
  canvasId,
  modelDefaults,
  authMode,
  chooseRunLock,
  canvasLockControls,
  onCanvasChange,
  onCollapse,
  className = '',
  canvasReference,
}: DeepAgentStudioProps) {
  const activeWorkspaceId = Number(useWorkspaceId() || 0)
  const tooltipScope = useRef<HTMLElement>(null)
  const business =
    authMode === 'business' || (authMode === undefined && workspaceId !== undefined && canvasId !== undefined)
  const studio = useStudio(apiBase, workspaceId, canvasId, business, JSON.stringify(modelDefaults), chooseRunLock)
  const { api, state, catalog: workspaceCatalog, current, run: serverRun, loading, mismatch } = studio
  const catalog = useMemo(() => {
    if (!modelDefaults) return workspaceCatalog
    const models = workspaceCatalog.models.filter(
      (model) =>
        (!model.operation_codes.includes('image.text_to_image') ||
          canvasAllowsModel(modelDefaults, 'image', model.id)) &&
        (!model.operation_codes.includes('video.generate') || canvasAllowsModel(modelDefaults, 'video', model.id)),
    )
    return { ...workspaceCatalog, models }
  }, [workspaceCatalog, modelDefaults])
  const notifiedFailure = useRef<string | null>(null)
  const [retryTarget, setRetryTarget] = useState<{ runId: string; id: number; version: number }>()
  const [notificationMessage, setNotificationMessage] = useState('')
  useEffect(() => {
    if (serverRun?.status !== 'error') {
      notifiedFailure.current = null
      return
    }
    if (notifiedFailure.current === serverRun.id) return
    notifiedFailure.current = serverRun.id
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      try {
        const notice = new Notification('DoDo Agent 需要你处理', {
          body: '执行已暂停，进度已保留。请返回会话查看具体原因。',
          tag: 'dodo-' + serverRun.id,
        })
        notice.onclick = () => {
          window.focus()
          notice.close()
        }
      } catch {
        setNotificationMessage('浏览器通知暂不可用，失败信息已保留在页面中')
      }
    }
  }, [serverRun?.id, serverRun?.status])
  const [pendingSend, setPendingSend] = useState<{ run: StudioRun; target?: string; api: typeof api } | null>(null)
  const activeAPI = useRef(api)
  activeAPI.current = api
  const run =
    pendingSend?.api === api && (!pendingSend.target || serverRun?.id !== pendingSend.target)
      ? pendingSend.run
      : serverRun
  useEffect(() => {
    if (pendingSend?.target && serverRun?.id === pendingSend.target) setPendingSend(null)
  }, [pendingSend, serverRun?.id])
  const creditBlocked =
    run?.status === 'error' &&
    isInsufficientCreditsEvent([...run.events].reverse().find((event) => ['assistant', 'error'].includes(event.kind)))
  const canOpenRecharge =
    state.connected && !mismatch && activeWorkspaceId > 0 && state.workspace_id === activeWorkspaceId
  const settledReceipts = useMemo(() => conversationCredits(serverRun?.events || []), [serverRun?.events])
  const reportedSettledCredits = Number(serverRun?.billing?.settled_credits)
  const settledCredits = Math.max(settledReceipts, Number.isFinite(reportedSettledCredits) ? reportedSettledCredits : 0)
  const refreshedCredits = useRef(new Map<string, number>())
  const serverRunId = serverRun?.id
  useEffect(() => {
    if (!canvasId || !canOpenRecharge || !serverRunId || serverRunId !== current) return
    const key = `${activeWorkspaceId}:${serverRunId}`
    const previous = refreshedCredits.current.get(key)
    if (settledCredits === (previous ?? 0)) return
    // Costs may arrive as both a receipt and a snapshot; coalesce wallet reads around that update.
    const timer = window.setTimeout(() => {
      refreshedCredits.current.set(key, settledCredits)
      void useWorkspaceSessionStore.getState().refreshWallet(activeWorkspaceId)
    }, 250)
    return () => window.clearTimeout(timer)
  }, [activeWorkspaceId, canOpenRecharge, canvasId, current, serverRunId, settledCredits])
  const mediaService = useMemo(
    () => ({ refresh: (assetId: number) => api.request<Data>(`/api/runs/${current}/assets/${assetId}`) }),
    [api, current],
  )
  const [message, setMessage] = useState(''),
    [mode, setMode] = useState<'manual' | 'auto'>('manual')
  const [image, setImage] = useState<number>(),
    [video, setVideo] = useState<number>(),
    [skills, setSkills] = useState<string[]>([])
  const [dialog, setDialog] = useState<
    'models' | 'skills' | 'mode' | 'connection' | 'documents' | 'attachments' | 'assets' | null
  >(null)
  const [modelTab, setModelTab] = useState<'image' | 'video'>('image'),
    [query, setQuery] = useState('')
  const [history, setHistory] = useState(false),
    [results, setResults] = useState(false)
  const [attachments, setAttachments] = useState<StudioAttachment[]>([]),
    [uploading, setUploading] = useState(false)
  const [episodeDialog, setEpisodeDialog] = useState(false)
  const [canvasReferences, setCanvasReferences] = useState<CanvasReference[]>([])
  const consumedCanvasReference = useRef<CanvasReference>()
  const [stopping, setStopping] = useState(false)
  const stopLock = useRef(false)
  const steeringDraft = useRef<{ key: string; id: string } | null>(null)
  const [steeringDelivery, setSteeringDelivery] = useState<string | null>(null)
  const [actionBusy, setActionBusy] = useState(false),
    [uncertain, setUncertain] = useState(false)
  const [selectedDocument, setSelectedDocument] = useState<string>('')
  const [showBottom, setShowBottom] = useState(false)
  const composerAnchor = useRef<HTMLDivElement>(null)
  const historyAnchor = useRef<HTMLDivElement>(null)
  const uploadLock = useRef<AbortController | null>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const followUpdates = useRef(true)
  const actionLock = useRef<symbol | null>(null),
    files = useRef<HTMLInputElement>(null),
    prompt = useRef<HTMLTextAreaElement>(null)
  const threadRef = useRef(current),
    currentId = useRef(current),
    lastCanvas = useRef<Data | null>(null)
  const savedConfigurationDraft = useRef<{ id: string; text: string; skills: string[] } | null>(null)
  currentId.current = current
  const running = run?.status === 'running'
  const recovering = run?.status === 'paused' || run?.status === 'error'
  const canResumeWithGuidance = recovering && run?.can_resume_with_guidance === true
  const sendToNewConversation = recovering && !canResumeWithGuidance
  const unfinished = running || run?.status === 'waiting' || canResumeWithGuidance || (!!current && !run)
  const draftDisabled = loading || actionBusy || mismatch || uploading
  const canSendGuidance =
    state.connected &&
    !draftDisabled &&
    !uncertain &&
    !!current &&
    !!message.trim() &&
    !attachments.length &&
    !canvasReferences.length
  const disabled = draftDisabled || running
  const ready = state.connected && !mismatch && !!image && !!video && !!catalog.planning_model
  const canSteer =
    running &&
    state.connected &&
    !draftDisabled &&
    !uncertain &&
    current === run.id &&
    !run.stop &&
    !stopping &&
    !skills.length &&
    !!message.trim()
  const selectedDoc = run?.documents?.find((d) => d.id === selectedDocument) || run?.documents?.[0]

  const initialImage = defaultModel(catalog, 'image', modelDefaults?.imageModelVersionId)
  const initialVideo = defaultModel(catalog, 'video', modelDefaults?.videoModelVersionId)
  useEffect(() => {
    setImage((old) => (catalog.models.some((model) => model.id === old) ? old : initialImage))
    setVideo((old) => (catalog.models.some((model) => model.id === old) ? old : initialVideo))
  }, [initialImage, initialVideo, catalog.models])
  useEffect(() => {
    if (threadRef.current !== current) {
      threadRef.current = current
      setAttachments([])
      const savedDraft = savedConfigurationDraft.current?.id === current ? savedConfigurationDraft.current : null
      setSkills(savedDraft?.skills || [])
      setCanvasReferences([])
      setMessage(savedDraft?.text || '')
      savedConfigurationDraft.current = null
      setResults(false)
      setSelectedDocument('')
    }
    if (run?.selection) {
      setImage(catalog.models.some((m) => m.id === run.selection.image) ? run.selection.image : undefined)
      setVideo(catalog.models.some((m) => m.id === run.selection.video) ? run.selection.video : undefined)
      setMode(run.selection.mode)
    }
  }, [current, run?.selection, catalog.models])
  useEffect(() => {
    if (!canvasReference || !canvasId || actionBusy || consumedCanvasReference.current === canvasReference) return
    consumedCanvasReference.current = canvasReference
    if (canResumeWithGuidance) return
    setCanvasReferences((old) => {
      if (old.some((item) => item.id === canvasReference.id)) return old
      return old.length < 8 ? [...old, canvasReference] : old
    })
  }, [canvasReference, canvasId, actionBusy, canResumeWithGuidance])
  useEffect(() => {
    if (run?.canvas && run.canvas !== lastCanvas.current) {
      lastCanvas.current = run.canvas
      onCanvasChange?.(run.canvas)
    }
  }, [run?.canvas, onCanvasChange])

  useEffect(() => {
    if (!history) return
    const close = (event: PointerEvent) => {
      if (!historyAnchor.current?.contains(event.target as Node)) setHistory(false)
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setHistory(false)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', key)
    }
  }, [history])

  const runCursor = run?.cursor
  useEffect(() => {
    if (runCursor != null && !results && followUpdates.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight
  }, [runCursor, results, pendingSend])
  useEffect(() => {
    if (results && scroll.current) scroll.current.scrollTop = 0
  }, [results])

  useEffect(() => {
    setPendingSend(null)
    setMessage('')
    setUncertain(false)
    setCanvasReferences([])
    actionLock.current = null
    setActionBusy(false)
    setUploading(false)
    return () => {
      uploadLock.current?.abort()
      uploadLock.current = null
    }
  }, [api])

  async function action(fn: () => Promise<void>) {
    if (actionLock.current) return
    const operation = Symbol('action')
    actionLock.current = operation
    setActionBusy(true)
    studio.setError('')
    try {
      await fn()
      return true
    } catch (e) {
      if (activeAPI.current === api) studio.setError(e instanceof Error ? e.message : '操作未完成，请稍后重试。')
      return false
    } finally {
      if (actionLock.current === operation) {
        actionLock.current = null
        setActionBusy(false)
      }
    }
  }
  function newConversation() {
    if (actionLock.current || uploading) return
    followUpdates.current = true
    setShowBottom(false)
    setPendingSend(null)
    studio.setCurrent(null)
    if (modelDefaults?.imageModelVersionId) setImage(initialImage)
    if (modelDefaults?.videoModelVersionId) setVideo(initialVideo)
    setMessage('')
    setAttachments([])
    setCanvasReferences([])
    setSkills([])
    setHistory(false)
    setResults(false)
    setUncertain(false)
    studio.setError('')
    prompt.current?.focus()
  }
  async function sendSteering() {
    if (!canSteer || !current) return
    const id = current
    const text = message.trim()
    const references = canvasReferences.map((item) => item.id)
    const key = JSON.stringify([id, text, references])
    // An uncertain transport response must reuse the same durable message ID.
    if (steeringDraft.current?.key !== key) steeringDraft.current = { key, id: crypto.randomUUID() }
    const messageId = steeringDraft.current.id
    await action(async () => {
      await api.request(`/api/runs/${id}/steer`, {
        message_id: messageId,
        message: text,
        canvas_references: references,
      })
      if (activeAPI.current !== api || currentId.current !== id) return
      steeringDraft.current = null
      setMessage('')
      setCanvasReferences([])
      setSteeringDelivery(id)
      followUpdates.current = true
      try {
        await studio.reload()
      } catch {
        if (activeAPI.current === api && currentId.current === id) {
          studio.setError('补充要求已发送，会话更新暂不可用。可重新读取会话。')
        }
      }
    })
  }
  async function send(episodeDecision?: EpisodeDecision, startProduction = false) {
    if (running && !episodeDecision && !startProduction) return sendSteering()
    if (canResumeWithGuidance && !episodeDecision && !startProduction) {
      if (!canSendGuidance) return
      const id = current
      await action(async () => {
        try {
          await api.request(`/api/runs/${id}/resume`, { message: message.trim() })
        } catch (e) {
          if (activeAPI.current !== api || currentId.current !== id) return
          if (!(e instanceof StudioHTTPError) || e.status >= 500) {
            setUncertain(true)
            throw new Error('补充要求的发送结果待确认。请重新打开当前会话查看记录，再决定是否重发。')
          }
          throw e
        }
        if (activeAPI.current !== api || currentId.current !== id) return
        setMessage('')
        followUpdates.current = true
        await studio.reload()
      })
      return
    }
    const savingConfiguration = !!episodeDecision && 'episode_plan' in episodeDecision
    if (
      !ready ||
      disabled ||
      unfinished ||
      uncertain ||
      attachments.some((a) => !a.id) ||
      (!message.trim() && !attachments.length && !startProduction)
    )
      return
    if (!episodeDecision && attachments.some((a) => a.type === 'prompt')) {
      setEpisodeDialog(true)
      return
    }
    setEpisodeDialog(false)
    await action(async () => {
      const draft = message
      const selectedSkills = skills.map((name) => ({
        name,
        description: catalog.skills.find((s) => s.name === name)?.description,
      }))
      const optimistic: StudioRun = {
        ...(run || { id: 'pending', cursor: 0, title: '新对话', events: [] }),
        status: 'complete',
        events: [
          ...(run?.events || []),
          {
            id: 'pending-send',
            kind: 'user',
            text: draft.trim() || '已添加附件',
            data: {
              delivery: 'sending',
              canvas_references: canvasReferences,
              skills: selectedSkills,
            },
          },
        ],
      }
      setPendingSend({ api, run: optimistic })
      if (!savingConfiguration) setMessage('')
      setResults(false)
      followUpdates.current = true
      let response: { id: string }
      try {
        response = await api.request('/api/runs', {
          ...episodeDecision,
          ...(startProduction ? { start_production: true } : {}),
          message: message.trim(),
          selection: { image, video, mode },
          skills,
          attachments: attachments.map((a) => a.id),
          canvas_references: canvasReferences.map((item) => item.id),
          previous: run?.status === 'complete' ? current : null,
          ...(canvasId ? { canvas_id: canvasId } : {}),
        })
      } catch (e) {
        if (activeAPI.current !== api) return
        setPendingSend(null)
        setMessage(draft)
        if (!(e instanceof StudioHTTPError) || e.status >= 500) {
          setUncertain(true)
          throw new Error('发送结果尚未确认。请先刷新历史会话查找已开始的创作，避免重复生成。')
        }
        throw e
      }
      if (activeAPI.current !== api) return
      setPendingSend({
        api,
        target: response.id,
        run: {
          ...optimistic,
          id: response.id,
          status: savingConfiguration ? 'complete' : 'running',
          events: optimistic.events.map((event) =>
            event.id === 'pending-send'
              ? {
                  ...event,
                  data: {
                    canvas_references: canvasReferences,
                    skills: selectedSkills,
                  },
                }
              : event,
          ),
        },
      })
      if (savingConfiguration) savedConfigurationDraft.current = { id: response.id, text: draft, skills }
      studio.setCurrent(response.id)
      setMessage(savingConfiguration ? draft : '')
      if (!savingConfiguration) setSkills([])
      setAttachments([])
      setCanvasReferences([])
      setResults(false)
      await studio.refreshHistory()
    })
  }
  async function upload(list: File[]) {
    if (!state.connected || disabled || unfinished || uploadLock.current) return
    if (attachments.length + list.length > 8) {
      studio.setError('一次创作最多添加 8 个附件。')
      return
    }
    const operation = new AbortController()
    uploadLock.current = operation
    setUploading(true)
    studio.setError('')
    try {
      for (const file of list) {
        let entry: StudioAttachment = { name: file.name }
        try {
          if (!file.size || file.size > 50 * 1024 * 1024) throw new Error('单个文件须为 1 字节至 50 MB。')
          entry = await api.upload(file, operation.signal)
        } catch (e) {
          if (operation.signal.aborted || activeAPI.current !== api) return
          if (e instanceof RequestAbortError && e.abortCause === 'timeout') {
            studio.setError('附件上传超时，请检查网络后重新添加未上传的文件。')
            break
          }
          entry.error = e instanceof Error ? e.message : '上传失败'
        }
        if (operation.signal.aborted || activeAPI.current !== api) return
        setAttachments((old) => [...old, entry])
      }
    } finally {
      if (uploadLock.current === operation) {
        uploadLock.current = null
        setUploading(false)
        if (files.current) files.current.value = ''
      }
    }
  }
  async function decide(data: Data) {
    const id = current
    await action(async () => {
      await api.request(`/api/runs/${id}/resume`, data)
      if (currentId.current === id) await studio.reload()
    })
  }
  async function operation(name: 'resume' | 'stop') {
    const id = current
    if (name === 'stop') {
      if (stopLock.current) return
      stopLock.current = true
      setStopping(true)
      try {
        await api.request(`/api/runs/${id}/stop`, {})
        if (currentId.current === id) await studio.reload()
      } catch (e) {
        studio.setError(e instanceof Error ? e.message : '停止请求未确认，请查询当前状态。')
      } finally {
        stopLock.current = false
        setStopping(false)
      }
      return
    }
    await action(async () => {
      const result = await api.request<Data>(`/api/runs/${id}/${name}`, {})
      if (currentId.current === id && result.retry_confirmation_required) {
        setRetryTarget({ runId: id, id: result.task_ids[0], version: Date.now() })
      }
      if (currentId.current === id) await studio.reload()
    })
  }
  async function saveDocument(doc: StudioDocument, body: string, key: string) {
    const id = current
    return await action(async () => {
      try {
        await api.request(`/api/runs/${id}/documents/save`, {
          id: doc.id,
          revision: doc.revision,
          title: doc.title,
          kind: doc.kind,
          body,
          ...(doc.delivery ? { delivery: doc.delivery } : {}),
          idempotency_key: key,
        })
      } catch (e) {
        if (e instanceof StudioHTTPError && e.status === 409 && currentId.current === id) {
          try {
            await studio.reload()
          } catch {
            /* Keep the original conflict and unsaved draft. */
          }
        }
        throw e
      }
      if (currentId.current === id) await studio.reload()
      try {
        await api.request(`/api/runs/${id}/canvas/sync`, {})
        if (currentId.current === id) await studio.reload()
      } catch {
        throw new Error('文档已保存，画布同步暂未完成。请稍后重新同步，无需重复保存。')
      }
    })
  }
  const context = contextInfo(run, catalog)
  const contextLabel =
    context.context.status === 'compacting'
      ? '正在整理上下文'
      : context.percent !== null
        ? `上次请求后剩余 ${context.percent}%`
        : context.input != null
          ? `上次输入 ${context.input.toLocaleString()} tokens`
          : '上下文用量未提供'

  const activeBatch = run?.batches?.find((b) => b.id === run.active_batch)
  const batchHasRunning = Object.values(activeBatch?.nodes || {}).some((node) =>
    ['running', 'submitting'].includes(node.status),
  )
  const mascotState = useMemo(
    () => doudouState(run, !!studio.streamState && studio.streamState !== '实时更新'),
    [run, studio.streamState],
  )
  const latestTask = [...(run?.events || [])]
    .reverse()
    .find((event) => ['cost', 'progress', 'tool'].includes(event.kind) && event.data?.tool)
  const replying = run?.events.some(
    (event) => event.kind === 'assistant' && event.data?.streaming && event.data.task_id === latestTask?.data?.task_id,
  )
  const status =
    {
      running: run?.stop ? '正在停止后续步骤' : doudouLabels[mascotState],
      waiting: '等待你确认',
      complete: '本轮完成',
      paused: '已暂停',
      error: '需要处理',
    }[run?.status || ''] || (loading ? '正在连接' : state.connected ? '已连接' : '未连接工作空间')
  function openDialog(value: typeof dialog) {
    setQuery('')
    setDialog((previous) => (previous === value ? null : value))
  }

  return (
    <StudioMediaContext.Provider value={mediaService}>
      <section ref={tooltipScope} className={`${styles.studio} ${className}`} aria-label="DoDo Agent">
        <TooltipLayer scope={tooltipScope} />
        <header className={styles.header}>
          <div className={styles.historyAnchor} ref={historyAnchor}>
            <button
              type="button"
              className={styles.titleButton}
              aria-expanded={history}
              onClick={() => setHistory(!history)}
            >
              <span>{current ? run?.title || '创作对话' : '新对话'}</span>
              <StudioIcon name="history" size={18} />
            </button>
            {history && (
              <div className={styles.historyMenu}>
                <h3>历史会话</h3>
                {state.runs.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    aria-current={current === item.id ? 'true' : undefined}
                    disabled={actionBusy || uploading}
                    onClick={() => {
                      followUpdates.current = true
                      setShowBottom(false)
                      setPendingSend(null)
                      studio.setCurrent(item.id)
                      setHistory(false)
                      if (uncertain && item.id === current) {
                        void action(async () => {
                          await studio.reload()
                          setUncertain(false)
                        })
                        return
                      }
                      setUncertain(false)
                      studio.setError('')
                    }}
                  >
                    <span>{item.title || '创作对话'}</span>
                    <small>
                      {
                        { running: '进行中', waiting: '待确认', complete: '已结束', paused: '已暂停', error: '待处理' }[
                          item.status
                        ]
                      }
                    </small>
                  </button>
                ))}
                {!state.runs.length && <p>还没有创作会话</p>}
                {state.next_offset != null && (
                  <button
                    type="button"
                    onClick={() =>
                      void action(async () => {
                        await studio.refreshHistory(state.next_offset!)
                      })
                    }
                  >
                    加载更早会话
                  </button>
                )}
                <button
                  type="button"
                  onClick={() =>
                    void action(async () => {
                      await studio.refreshHistory()
                    })
                  }
                >
                  刷新历史
                </button>
              </div>
            )}
          </div>
          <div className={styles.toolbar}>
            <button
              type="button"
              className={styles.iconButton}
              aria-label="新建会话"
              data-tooltip="新建对话"
              disabled={actionBusy || uploading}
              onClick={newConversation}
            >
              <StudioIcon name="new" size={16} />
            </button>
            <button
              type="button"
              className={styles.iconButton}
              aria-label="制作文档"
              data-tooltip="制作文档"
              disabled={!run}
              onClick={() => openDialog('documents')}
            >
              <StudioIcon name="file" size={16} />
            </button>
            <button
              type="button"
              className={styles.iconButton}
              aria-label="DoDo Agent 设置"
              data-tooltip="DoDo Agent 全局设置"
              onClick={() => openDialog('connection')}
            >
              <StudioIcon name="settings" size={16} />
            </button>
            <button
              type="button"
              className={styles.iconButton}
              aria-label={results ? '返回对话' : '查看制作成果'}
              data-tooltip={results ? '返回对话' : '查看制作成果'}
              aria-pressed={results}
              onClick={() => {
                followUpdates.current = true
                setResults(!results)
              }}
            >
              <StudioIcon name="layout" size={16} />
            </button>
            {onCollapse && (
              <button
                type="button"
                className={styles.iconButton}
                aria-label="收起 DoDo Agent"
                data-tooltip="收起 DoDo Agent"
                onClick={() => {
                  setDialog(null)
                  setHistory(false)
                  onCollapse()
                }}
              >
                <StudioIcon name="minus" />
              </button>
            )}
          </div>
        </header>
        <div
          className={styles.statusRow}
          hidden={state.connected && !loading && (!current || run?.status === 'complete')}
        >
          <span>
            {run ? <DoudouMascot state={mascotState} compact /> : <i />}
            {status}
          </span>
          <span>{state.workspace_id ? `工作空间 #${state.workspace_id}` : ''}</span>
        </div>
        {current &&
          (!run ||
            studio.streamState === '连接已断开' ||
            (run.stop && unfinished) ||
            (steeringDelivery === current && studio.error)) &&
          !loading && (
            <div className={styles.recovery}>
              <button
                type="button"
                disabled={actionBusy || mismatch || studio.streamState === '正在读取会话'}
                onClick={studio.reopen}
              >
                重新读取会话
              </button>
            </div>
          )}
        {mismatch && (
          <div role="alert" className={styles.alert}>
            当前 MCP 授权空间与页面不同。请在连接设置中重新授权，避免写入其他画布。
          </div>
        )}
        {!loading && state.connected && !mismatch && !studio.error && !catalog.planning_model && (
          <div role="alert" className={styles.alert}>
            推理模型暂不可用，无法发送消息。请管理员检查指定模型是否已启用，以及当前账号是否有使用权限。
          </div>
        )}
        {!loading &&
          state.connected &&
          !mismatch &&
          !studio.error &&
          !run &&
          ((modelDefaults?.imageModelVersionId && !image) || (modelDefaults?.videoModelVersionId && !video)) && (
            <div role="alert" className={styles.alert}>
              画布预选的模型已不可用，请在「选择模型」中重新选择。
            </div>
          )}
        {studio.error && (
          <div role="alert" className={styles.alert}>
            {studio.error}
            <button
              type="button"
              className={styles.iconButton}
              aria-label="关闭提示"
              onClick={() => studio.setError('')}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {uncertain && (
          <div className={styles.recovery}>
            <button
              type="button"
              disabled={actionBusy || mismatch}
              onClick={() =>
                void action(async () => {
                  await studio.refreshHistory()
                  setHistory(true)
                })
              }
            >
              刷新历史查看发送结果
            </button>
          </div>
        )}
        <div
          className={styles.scrollArea}
          ref={scroll}
          onScroll={(e) => {
            const box = e.currentTarget
            followUpdates.current = box.scrollHeight - box.scrollTop - box.clientHeight < 100
            setShowBottom(!followUpdates.current)
          }}
        >
          {results ? (
            <Results run={run} />
          ) : current && !run ? (
            <p className={styles.emptyHint}>正在读取会话…</p>
          ) : run ? (
            <>
              <div className={styles.conversation}>
                <Conversation
                  active={running && !run.stop}
                  events={[...(run.history_events || []), ...run.events]}
                  canvas={run.canvas}
                  onRecharge={canOpenRecharge ? () => openMemberCenterTab('recharge') : undefined}
                  onDocument={(id) => {
                    setSelectedDocument(id)
                    setDialog('documents')
                  }}
                />
              </div>
              {running && !run.stop && !stopping && !replying && mascotState === 'thinking' && (
                <div className={styles.replyPending} role="status">
                  正在思考<span aria-hidden="true">…</span>
                </div>
              )}
              {!!run.batches?.length && (
                <section className={styles.batches} aria-label="制作任务">
                  {run.batches.map((batch) => (
                    <details
                      key={batch.id}
                      open={
                        batch.id === run.active_batch &&
                        !batch.cancelled &&
                        ['running', 'waiting', 'paused', 'error'].includes(run.status) &&
                        Object.values(batch.nodes).some((node) => !['succeeded', 'cancelled'].includes(node.status))
                      }
                    >
                      <summary>
                        <List size={16} />
                        制作批次 · {Object.values(batch.nodes).filter((n) => n.status === 'succeeded').length}/
                        {Object.keys(batch.nodes).length} 完成
                      </summary>
                      <div className={styles.batchGrid}>
                        {Object.values(batch.nodes).map((node) => (
                          <article key={node.id}>
                            <strong>{node.title}</strong>
                            <span>
                              {{
                                planned: '待提交',
                                submitting: '正在提交',
                                running: '生成中',
                                succeeded: '已完成',
                                failed: node.output_issue ? '产物需核对' : '失败',
                                cancelled: '已取消',
                              }[node.status] || node.status}
                            </span>
                            {node.task_id && <small>任务 #{node.task_id}</small>}
                            {node.error && <p>{node.error}</p>}
                            {batch.id === run.active_batch &&
                              ['error', 'paused'].includes(run.status) &&
                              !run.pending &&
                              !batch.cancelled &&
                              !batchHasRunning &&
                              !node.output_issue &&
                              node.status === 'failed' && (
                                <button
                                  type="button"
                                  disabled={actionBusy}
                                  onClick={() =>
                                    setRetryTarget({ runId: run.id, id: node.task_id!, version: Date.now() })
                                  }
                                >
                                  查看原因与处理方案
                                </button>
                              )}
                          </article>
                        ))}
                      </div>
                    </details>
                  ))}
                </section>
              )}
              {run.status === 'waiting' && run.pending && (
                <Approval
                  models={catalog.models}
                  key={run.decision_id}
                  run={run}
                  busy={actionBusy}
                  onDecision={decide}
                />
              )}
              {run.status === 'complete' && run.has_pending_receipts && (
                <div className={styles.recovery}>
                  <p>旧任务结果待确认。</p>
                  <button type="button" disabled={actionBusy} onClick={() => void operation('resume')}>
                    查询旧任务结果
                  </button>
                </div>
              )}
              {['paused', 'error'].includes(run.status) && (
                <div className={styles.recovery}>
                  {run.status === 'error' && !creditBlocked && (
                    <p role="alert">执行已暂停，进度已保留。请查看上方的具体原因。</p>
                  )}
                  {!creditBlocked && 'Notification' in window && Notification.permission !== 'granted' && (
                    <button
                      type="button"
                      onClick={() => {
                        void Notification.requestPermission()
                          .then((permission) =>
                            setNotificationMessage(
                              permission === 'granted'
                                ? '已开启浏览器提醒'
                                : '未开启浏览器通知，失败时仍会在页面内提醒',
                            ),
                          )
                          .catch(() => setNotificationMessage('浏览器通知暂不可用，失败时仍会在页面内提醒'))
                      }}
                    >
                      开启浏览器提醒
                    </button>
                  )}
                  {notificationMessage && <p role="status">{notificationMessage}</p>}
                  {!creditBlocked && !run.pending && (
                    <MediaRetry
                      key={run.id}
                      api={api}
                      runId={run.id}
                      models={catalog.models}
                      reload={studio.reload}
                      requestedTask={retryTarget?.runId === run.id ? retryTarget : undefined}
                    />
                  )}
                  <p>已成功的素材会保留。恢复会先查询已提交任务；失败素材重试需要单独确认。</p>
                  <button type="button" disabled={actionBusy} onClick={() => void operation('resume')}>
                    {creditBlocked ? '充值后继续执行' : '恢复执行 / 查询已有任务'}
                  </button>
                  {run.inference_failure?.retryable && (
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={() => void decide({ retry_inference_task_id: run.inference_failure!.task_id })}
                    >
                      重试这次推理（保留素材，按实际用量计费）
                    </button>
                  )}
                </div>
              )}
            </>
          ) : (
            <section className={styles.welcome}>
              <DoudouMascot />
              <h1>让 DoDo Agent 辅助你的无限创意</h1>
              <div className={styles.starters}>
                <button type="button" onClick={() => openDialog('skills')}>
                  <StudioIcon name="welcome_skill" size={16} />
                  <span>选择 Skill 开始创作</span>
                  <StudioIcon name="welcome_arrow" size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMessage('帮我创作一部短剧。先讨论核心创意、人物与冲突，确认大纲后再开始制作。')
                    prompt.current?.focus()
                  }}
                >
                  <StudioIcon name="welcome_script" size={16} />
                  <span>从创意开始剧本原创</span>
                  <StudioIcon name="welcome_arrow" size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => (state.connected ? files.current?.click() : openDialog('connection'))}
                >
                  <StudioIcon name="welcome_adaptation" size={16} />
                  <span>上传故事来改编</span>
                  <StudioIcon name="welcome_arrow" size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMessage('根据我的故事规划第1集分镜、镜头时长和角色参考，再生成素材，最后按顺序合并视频。')
                    prompt.current?.focus()
                  }}
                >
                  <StudioIcon name="welcome_storyboard" size={16} />
                  <span>批量创建分镜</span>
                  <StudioIcon name="welcome_arrow" size={16} />
                </button>
              </div>
              {!state.connected && !loading && (
                <button type="button" className={styles.connectButton} onClick={() => openDialog('connection')}>
                  {business ? '检查业务登录' : '连接工作空间，开始创作'}
                </button>
              )}
            </section>
          )}
        </div>
        <div className={styles.composerArea} ref={composerAnchor}>
          {canvasLockControls}
          {showBottom && run && !results && (
            <button
              type="button"
              className={styles.scrollBottom}
              aria-label="回到底部"
              onClick={() => {
                followUpdates.current = true
                if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight
                setShowBottom(false)
              }}
            >
              <StudioIcon name="down" size={18} />
            </button>
          )}
          {!run && (
            <div className={styles.quickPrompts}>
              {['剧本原创', '剧本改编', '导演执导'].map((label) => (
                <button
                  type="button"
                  key={label}
                  onClick={() => {
                    setMessage(
                      label === '剧本原创'
                        ? '帮我创作一部短剧。'
                        : label === '剧本改编'
                          ? '根据我上传的剧本改编，先只制作第1集。'
                          : '帮我规划分镜，保持人物和场景一致，最终合并完整视频。',
                    )
                    prompt.current?.focus()
                  }}
                >
                  <StudioIcon
                    name={
                      label === '剧本原创'
                        ? 'welcome_script'
                        : label === '剧本改编'
                          ? 'welcome_adaptation'
                          : 'welcome_storyboard'
                    }
                    size={16}
                  />
                  {label}
                </button>
              ))}
            </div>
          )}
          <form
            className={styles.composer}
            onSubmit={(e) => {
              e.preventDefault()
              void send()
            }}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes('Files')) e.preventDefault()
            }}
            onDrop={(e) => {
              e.preventDefault()
              void upload([...e.dataTransfer.files])
            }}
          >
            {!!skills.length && (
              <div className={styles.chips} aria-label="已添加的 Skill">
                {skills.map((name) => {
                  const label = catalog.skills.find((s) => s.name === name)?.description || name
                  return (
                    <span key={name}>
                      Skill · {label}
                      <button
                        type="button"
                        aria-label={`移除 Skill ${label}`}
                        disabled={draftDisabled}
                        onClick={() => setSkills((old) => old.filter((item) => item !== name))}
                      >
                        <X size={13} />
                      </button>
                    </span>
                  )
                })}
              </div>
            )}
            {!!attachments.length && (
              <div className={styles.attachments}>
                {attachments.map((item, index) => (
                  <div key={`${item.id || item.name}-${index}`}>
                    <StudioIcon name="file" size={18} />
                    <span>
                      {item.name}
                      <small>
                        {item.error || (item.type === 'prompt' ? `已读取 ${item.characters} 字` : '参考素材已就绪')}
                      </small>
                    </span>
                    <button
                      type="button"
                      aria-label={`移除 ${item.name}`}
                      disabled={uploading}
                      onClick={() => setAttachments((old) => old.filter((_, i) => i !== index))}
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {run?.selection?.episode_models && (
              <div className={styles.referenceHint} aria-label="已保存的制作配置">
                <details>
                  <summary>
                    已保存 {Object.keys(run.selection.episode_models).length} 集配置
                    {run.selection.media_allowed === false ? ' · 等待你的要求' : ''}
                  </summary>
                  {Object.entries(run.selection.episode_models).map(([id, episode]) => (
                    <p key={id}>
                      {episode.title}
                      <br />
                      生图：
                      {catalog.models.find((m) => m.id === episode.image)?.display_name ||
                        catalog.models.find((m) => m.id === episode.image)?.model ||
                        episode.image}{' '}
                      · {Object.values(episode.image_params || {}).join(' · ')}
                      <br />
                      视频：
                      {catalog.models.find((m) => m.id === episode.video)?.display_name ||
                        catalog.models.find((m) => m.id === episode.video)?.model ||
                        episode.video}{' '}
                      · {Object.values(episode.video_params || {}).join(' · ')}
                    </p>
                  ))}
                </details>
                {run.selection.media_allowed === false && (
                  <>
                    <span>可继续补充要求；准备好后直接说“开始制作”，也可点击按钮。</span>
                    <button
                      type="button"
                      disabled={!ready || disabled || unfinished || uncertain || !!attachments.length}
                      onClick={() => void send(undefined, true)}
                    >
                      开始制作
                    </button>
                  </>
                )}
              </div>
            )}
            {attachments.some((a) => a.type === 'prompt' && a.id) && (
              <ScriptEpisodes
                key={current || 'new'}
                request={api.request}
                attachmentIds={attachments.flatMap((a) => (a.id ? [a.id] : []))}
                message={message.trim()}
                models={catalog.models}
                image={image}
                video={video}
                mode={mode}
                disabled={disabled || unfinished || uncertain}
                open={episodeDialog}
                onOpen={() => setEpisodeDialog(true)}
                onClose={() => setEpisodeDialog(false)}
                onConfirm={(decision) => void send(decision)}
              />
            )}
            {canResumeWithGuidance && (attachments.length > 0 || canvasReferences.length > 0) && (
              <div className={styles.referenceHint}>请先移除已有附件或画布引用，再发送补充要求。</div>
            )}
            {canvasId && !canResumeWithGuidance && (
              <div className={styles.referenceHint}>
                点击画布节点添加引用{canvasReferences.length > 0 ? ` · ${canvasReferences.length}/8` : ''}
                {canvasReferences.length === 8 ? '，移除后可添加其他节点' : ''}
              </div>
            )}
            {!!canvasReferences.length && (
              <div className={styles.attachments} aria-label="画布引用">
                {canvasReferences.map((item) => (
                  <div key={item.id}>
                    <StudioIcon name="file" size={18} />
                    <span>
                      {item.title}
                      <small>画布节点引用</small>
                    </span>
                    <button
                      type="button"
                      aria-label={`移除引用 ${item.title}`}
                      disabled={actionBusy}
                      onClick={() => setCanvasReferences((old) => old.filter((entry) => entry.id !== item.id))}
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <textarea
              ref={prompt}
              aria-label="创作要求"
              placeholder={
                running
                  ? '输入补充要求，或停止当前任务后发送新要求…'
                  : canResumeWithGuidance
                    ? '给 Agent 补充要求，例如先完成剩下的场景图…'
                    : sendToNewConversation
                      ? '输入新要求，可直接发送到新对话…'
                      : unfinished
                        ? '可先输入下一条要求，恢复或结束后发送…'
                        : '开始你的创作，或者上传图片与剧本文档…'
              }
              maxLength={12000}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key !== 'Enter' ||
                  e.shiftKey ||
                  e.ctrlKey ||
                  e.altKey ||
                  e.metaKey ||
                  e.nativeEvent.isComposing ||
                  e.nativeEvent.keyCode === 229
                )
                  return
                e.preventDefault()
                if (!e.repeat) void send()
              }}
              disabled={draftDisabled}
              onPaste={(e) => {
                if (e.clipboardData.files.length) {
                  e.preventDefault()
                  void upload([...e.clipboardData.files])
                }
              }}
            />
            {running && steeringDelivery === current && (
              <small role="status" className={styles.referenceHint}>
                补充要求已发送。已提交的素材任务仍可能继续完成。
              </small>
            )}
            {running && !!skills.length && (
              <small className={styles.referenceHint}>已选 Skill 随下一条创作要求发送。</small>
            )}
            {sendToNewConversation && (
              <small className={styles.referenceHint}>新要求将发到新对话。原会话保留在历史记录中。</small>
            )}
            <div className={styles.composerToolbar}>
              <div className={styles.composerActions}>
                <button
                  type="button"
                  className={styles.iconButton}
                  aria-label="上传图片或剧本"
                  data-tooltip="添加附件"
                  disabled={!state.connected || disabled || unfinished}
                  aria-expanded={dialog === 'attachments'}
                  onClick={() => openDialog('attachments')}
                >
                  <StudioIcon name="plus" size={16} />
                </button>
                <button
                  type="button"
                  aria-label="模型"
                  data-tooltip="选择模型"
                  aria-expanded={dialog === 'models'}
                  disabled={disabled || unfinished}
                  onClick={() => openDialog('models')}
                >
                  <StudioIcon name="box" size={16} />
                  <span>模型</span>
                </button>
                <button
                  type="button"
                  aria-label="Skill"
                  data-tooltip="选择 Skill"
                  aria-expanded={dialog === 'skills'}
                  disabled={draftDisabled}
                  onClick={() => openDialog('skills')}
                >
                  <StudioIcon name="skill" size={16} />
                  <span>Skill</span>
                </button>
                <button
                  type="button"
                  data-tooltip={mode === 'auto' ? '自动生成' : '手动确认'}
                  aria-label={mode === 'auto' ? '自动生成' : '手动确认'}
                  aria-expanded={dialog === 'mode'}
                  disabled={disabled || unfinished}
                  onClick={() => openDialog('mode')}
                >
                  {mode === 'auto' ? <StudioIcon name="auto" size={16} /> : <StudioIcon name="hand" size={16} />}
                  <span>{mode === 'auto' ? '自动生成' : '手动确认'}</span>
                </button>
              </div>
              <span
                role="img"
                tabIndex={0}
                className={styles.contextButton}
                aria-label="上下文用量"
                data-tooltip={contextLabel}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <circle cx="6" cy="6" r="5.25" stroke="currentColor" strokeWidth="1.5" opacity=".25" />
                  {context.percent !== null && (
                    <circle
                      cx="6"
                      cy="6"
                      r="5.25"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeDasharray="32.9867"
                      strokeDashoffset={(32.9867 * context.percent) / 100}
                      transform="rotate(-90 6 6)"
                    />
                  )}
                </svg>
              </span>
              {running && (
                <button type="submit" className={styles.send} aria-label="发送补充要求" disabled={!canSteer}>
                  <StudioIcon name="send" size={12} />
                </button>
              )}
              {run && ['running', 'waiting'].includes(run.status) ? (
                <button
                  type="button"
                  className={styles.send}
                  aria-label={stopping || run.stop ? '正在停止' : '停止回复'}
                  disabled={stopping || run.stop}
                  onClick={() => void operation('stop')}
                >
                  <Square size={19} fill="currentColor" />
                </button>
              ) : (
                <button
                  type="submit"
                  className={styles.send}
                  aria-label={
                    canResumeWithGuidance ? '发送补充要求' : sendToNewConversation ? '发送到新对话' : '发送创作要求'
                  }
                  data-tooltip={sendToNewConversation ? '发送到新对话' : undefined}
                  disabled={
                    canResumeWithGuidance
                      ? !canSendGuidance
                      : !ready ||
                        disabled ||
                        unfinished ||
                        uncertain ||
                        attachments.some((a) => !a.id) ||
                        (!message.trim() && !attachments.length)
                  }
                >
                  <StudioIcon name="send" size={12} />
                </button>
              )}
            </div>
          </form>
          <footer className={styles.footer}>
            <span aria-live="polite" aria-atomic="true">
              已消耗{' '}
              {conversationCredits([...(run?.history_events || []), ...(run?.events || [])]).toLocaleString('zh-CN', {
                maximumFractionDigits: 3,
              })}{' '}
              积分
            </span>
            <span>{run ? studio.streamState : '推理与素材按实际用量扣积分'}</span>
          </footer>
        </div>
        <input
          ref={files}
          type="file"
          multiple
          accept=".png,.jpg,.jpeg,.webp,.pdf,.docx,.txt,.md"
          hidden
          onChange={(e) => void upload([...(e.target.files || [])])}
        />
        {dialog === 'attachments' && (
          <Popover anchor={composerAnchor.current} title="添加附件" onClose={() => setDialog(null)}>
            <div className={styles.optionList}>
              <button
                type="button"
                onClick={() => {
                  setDialog(null)
                  files.current?.click()
                }}
              >
                本地上传
              </button>
              <button type="button" disabled={attachments.length >= 8} onClick={() => setDialog('assets')}>
                从素材库选择
              </button>
            </div>
          </Popover>
        )}
        {dialog === 'assets' && (
          <StudioAssetPicker
            api={api}
            remaining={8 - attachments.length}
            onClose={() => setDialog(null)}
            onSelect={(items) => {
              setAttachments((old) => [
                ...new Map(
                  [...old, ...items].map((item) => [
                    item.asset_id ? `asset:${item.asset_id}` : item.id || item.name,
                    item,
                  ]),
                ).values(),
              ])
              setDialog(null)
            }}
          />
        )}
        {dialog === 'connection' && (
          <Dialog error={studio.error} title="DoDo Agent 全局设置" onClose={() => setDialog(null)}>
            <p className={styles.settingsNotice}>对话按实际用量消耗积分，图片与视频生成单独计算。</p>
            <label className={styles.settingRow}>
              <span>
                <strong>自动生成图片 / 视频</strong>
                <small>开启后无需逐次确认，直接提交生成任务</small>
              </span>
              <input
                type="checkbox"
                role="switch"
                aria-label="自动生成图片和视频"
                checked={mode === 'auto'}
                disabled={disabled || unfinished}
                onChange={(e) => setMode(e.target.checked ? 'auto' : 'manual')}
              />
            </label>
            <p>
              {state.connected
                ? `当前已连接工作空间 #${state.workspace_id}`
                : business
                  ? '请先登录业务系统；DoDo Agent 会复用当前账号和空间权限。'
                  : '使用业务账号登录，并授权可使用的工作空间。'}
            </p>
            <p className={styles.muted}>生成按实际用量结算。你可以随时停止后续步骤，已提交任务会保留。</p>
            <button
              type="button"
              className={styles.primary}
              disabled={actionBusy || running}
              onClick={() =>
                void action(async () => {
                  if (business) {
                    await studio.initialize()
                    return
                  }
                  const response = await api.request<{ url: string }>('/api/connect', {})
                  const url = new URL(response.url)
                  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('授权链接无效')
                  window.location.assign(url.href)
                })
              }
            >
              {business ? '重新检查业务登录' : state.connected ? '重新授权' : '登录并连接'}
            </button>
            <button
              type="button"
              disabled={actionBusy}
              onClick={() =>
                void action(async () => {
                  await studio.initialize()
                })
              }
            >
              刷新连接
            </button>
          </Dialog>
        )}
        {(dialog === 'models' || dialog === 'skills') && (
          <Popover
            anchor={composerAnchor.current}
            title={dialog === 'models' ? '选择模型' : 'Skill'}
            onClose={() => setDialog(null)}
          >
            {dialog === 'models' && (
              <div className={styles.tabs}>
                {(['image', 'video'] as const).map((kind) => (
                  <button type="button" key={kind} aria-pressed={modelTab === kind} onClick={() => setModelTab(kind)}>
                    {kind === 'image' ? '图片模型' : '视频模型'}
                  </button>
                ))}
              </div>
            )}
            <input
              type="search"
              aria-label={dialog === 'models' ? '搜索模型' : '搜索 Skill'}
              placeholder="搜索…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className={styles.optionList}>
              {dialog === 'models'
                ? catalog.models
                    .filter(
                      (model) =>
                        model.operation_codes.includes(
                          modelTab === 'image' ? 'image.text_to_image' : 'video.generate',
                        ) && `${model.display_name} ${model.model}`.toLowerCase().includes(query.toLowerCase()),
                    )
                    .map((model) => (
                      <button
                        type="button"
                        key={model.id}
                        disabled={disabled || unfinished}
                        aria-pressed={(modelTab === 'image' ? image : video) === model.id}
                        onClick={() => (modelTab === 'image' ? setImage(model.id) : setVideo(model.id))}
                      >
                        <span className={styles.optionIcon}>
                          <StudioIcon name="box" size={19} />
                        </span>
                        <span>
                          <strong>{model.display_name || model.model}</strong>
                          <small>{model.description || model.model}</small>
                        </span>
                        {(modelTab === 'image' ? image : video) === model.id ? (
                          <Check size={16} />
                        ) : (
                          <StudioIcon name="new" size={16} />
                        )}
                      </button>
                    ))
                : catalog.skills
                    .filter((item) => `${item.name} ${item.description}`.toLowerCase().includes(query.toLowerCase()))
                    .map((item) => (
                      <button
                        type="button"
                        key={item.name}
                        disabled={draftDisabled || (!skills.includes(item.name) && skills.length >= 8)}
                        aria-pressed={skills.includes(item.name)}
                        onClick={() => {
                          setSkills((old) => (old.includes(item.name) ? old : [...old, item.name].slice(0, 8)))
                          setDialog(null)
                          prompt.current?.focus()
                        }}
                      >
                        <span className={styles.optionIcon}>
                          <StudioIcon name="skill" size={18} />
                        </span>
                        <span>
                          <strong>{item.description || item.name}</strong>
                          {item.name && <small>/{item.name}</small>}
                        </span>
                        {skills.includes(item.name) && <Check size={16} />}
                      </button>
                    ))}
            </div>
            {!state.connected && <p>请先连接工作空间。</p>}
            {dialog === 'models' && (
              <p className={styles.muted}>
                规划模型：{catalog.planning_model?.display_name || catalog.planning_model?.model || '等待后台配置'}
              </p>
            )}
          </Popover>
        )}
        {dialog === 'mode' && (
          <Popover anchor={composerAnchor.current} title="生成方式" onClose={() => setDialog(null)}>
            <div className={styles.optionList}>
              <button
                type="button"
                aria-pressed={mode === 'manual'}
                disabled={disabled || unfinished}
                onClick={() => {
                  setMode('manual')
                  setDialog(null)
                }}
              >
                <StudioIcon name="hand" size={18} />
                <span>
                  <strong>手动确认</strong>
                  <small>先看制作方案，每次生成前确认。</small>
                </span>
                {mode === 'manual' && <Check size={16} />}
              </button>
              <button
                type="button"
                aria-pressed={mode === 'auto'}
                disabled={disabled || unfinished}
                onClick={() => {
                  setMode('auto')
                  setDialog(null)
                }}
              >
                <StudioIcon name="auto" size={16} />
                <span>
                  <strong>自动生成</strong>
                  <small>按你的要求连续执行并计费，可随时停止。必要的信息仍会向你询问。</small>
                </span>
                {mode === 'auto' && <Check size={16} />}
              </button>
            </div>
          </Popover>
        )}
        {dialog === 'documents' && (
          <Dialog error={studio.error} title="制作文档" onClose={() => setDialog(null)}>
            <div className={styles.tabs}>
              {run?.documents?.map((doc) => (
                <button
                  key={doc.id}
                  type="button"
                  aria-pressed={selectedDoc?.id === doc.id}
                  onClick={() => setSelectedDocument(doc.id)}
                >
                  {doc.title}
                </button>
              ))}
            </div>
            {selectedDoc ? (
              <DocumentEditor
                key={`${current}-${selectedDoc.id}`}
                document={selectedDoc}
                busy={running || actionBusy}
                onSave={saveDocument}
              />
            ) : (
              <p className={styles.muted}>DoDo Agent 保存的计划、角色参考和分镜会出现在这里。</p>
            )}
            {run?.canvas && (
              <button
                type="button"
                disabled={running || actionBusy}
                onClick={() =>
                  void action(async () => {
                    await api.request(`/api/runs/${current}/canvas/sync`, {})
                    await studio.reload()
                  })
                }
              >
                同步画布
              </button>
            )}
          </Dialog>
        )}
      </section>
    </StudioMediaContext.Provider>
  )
}
