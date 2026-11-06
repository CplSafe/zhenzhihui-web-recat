import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  ArrowDown,
  Check,
  ArrowUp,
  Box,
  ChevronDown,
  CirclePlus,
  Clapperboard,
  Diamond,
  FileText,
  Hand,
  LayoutPanelLeft,
  List,
  Plus,
  SlidersHorizontal,
  Sparkles,
  Square,
  X,
} from 'lucide-react'
import { Approval, Dialog, Popover, DocumentEditor, Conversation, Results } from './StudioCards'
import { defaultModel, StudioHTTPError } from './studio'
import type { Data, StudioAttachment, StudioDocument } from './studio'
import { useStudio } from './useStudio'
import { StudioMediaContext } from './StudioMedia'
import styles from './DeepAgentStudio.module.css'

export interface DeepAgentStudioProps {
  apiBase?: string
  workspaceId?: number
  canvasId?: number
  onCanvasChange?: (canvas: Data) => void
  onCollapse?: () => void
  className?: string
}
/** Embeddable Studio: the host owns placement; the service owns auth, tools, billing and execution. */
export default function DeepAgentStudio({
  apiBase = '/agent-studio',
  workspaceId,
  canvasId,
  onCanvasChange,
  onCollapse,
  className = '',
}: DeepAgentStudioProps) {
  const studio = useStudio(apiBase, workspaceId)
  const { api, state, catalog, current, run, loading, mismatch } = studio
  const mediaService = useMemo(
    () => ({ refresh: (assetId: number) => api.request<Data>(`/api/runs/${current}/assets/${assetId}`) }),
    [api, current],
  )
  const [message, setMessage] = useState(''),
    [mode, setMode] = useState<'manual' | 'auto'>('manual')
  const [image, setImage] = useState<number>(),
    [video, setVideo] = useState<number>(),
    [skill, setSkill] = useState('')
  const [dialog, setDialog] = useState<'models' | 'skills' | 'mode' | 'connection' | 'documents' | 'context' | null>(
    null,
  )
  const [modelTab, setModelTab] = useState<'image' | 'video'>('image'),
    [query, setQuery] = useState('')
  const [history, setHistory] = useState(false),
    [results, setResults] = useState(false)
  const [attachments, setAttachments] = useState<StudioAttachment[]>([]),
    [uploading, setUploading] = useState(false)
  const [stopping, setStopping] = useState(false)
  const stopLock = useRef(false)
  const [actionBusy, setActionBusy] = useState(false),
    [uncertain, setUncertain] = useState(false)
  const [selectedDocument, setSelectedDocument] = useState<string>('')
  const [showBottom, setShowBottom] = useState(false)
  const composerAnchor = useRef<HTMLDivElement>(null)
  const historyAnchor = useRef<HTMLDivElement>(null)
  const uploadLock = useRef(false)
  const scroll = useRef<HTMLDivElement>(null)
  const followUpdates = useRef(true)
  const actionLock = useRef(false),
    files = useRef<HTMLInputElement>(null),
    prompt = useRef<HTMLTextAreaElement>(null)
  const threadRef = useRef(current),
    currentId = useRef(current),
    lastCanvas = useRef<Data | null>(null)
  currentId.current = current
  const running = run?.status === 'running',
    unfinished = !!run && run.status !== 'complete'
  const disabled = loading || actionBusy || running || uploading || mismatch
  const ready = state.connected && !mismatch && !!image && !!video && !!catalog.planning_model
  const selectedDoc = run?.documents?.find((d) => d.id === selectedDocument) || run?.documents?.[0]

  useEffect(() => {
    setImage((old) => old ?? defaultModel(catalog, 'image'))
    setVideo((old) => old ?? defaultModel(catalog, 'video'))
  }, [catalog])
  useEffect(() => {
    if (threadRef.current !== current) {
      threadRef.current = current
      setAttachments([])
      setMessage('')
      setResults(false)
      setSelectedDocument('')
    }
    if (run?.selection) {
      setImage(run.selection.image)
      setVideo(run.selection.video)
      setMode(run.selection.mode)
      setSkill(run.skill_name || '')
    }
  }, [current, run?.selection, run?.skill_name])
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
  }, [runCursor, results])
  useEffect(() => {
    if (results && scroll.current) scroll.current.scrollTop = 0
  }, [results])

  async function action(fn: () => Promise<void>) {
    if (actionLock.current) return
    actionLock.current = true
    setActionBusy(true)
    studio.setError('')
    try {
      await fn()
      return true
    } catch (e) {
      studio.setError(e instanceof Error ? e.message : '操作未完成，请稍后重试。')
      return false
    } finally {
      actionLock.current = false
      setActionBusy(false)
    }
  }
  function newConversation() {
    if (actionLock.current || uploading) return
    followUpdates.current = true
    setShowBottom(false)
    studio.setCurrent(null)
    setMessage('')
    setAttachments([])
    setSkill('')
    setHistory(false)
    setResults(false)
    setUncertain(false)
    studio.setError('')
    prompt.current?.focus()
  }
  async function send() {
    if (
      !ready ||
      disabled ||
      unfinished ||
      uncertain ||
      attachments.some((a) => !a.id) ||
      (!message.trim() && !attachments.length)
    )
      return
    await action(async () => {
      let response: { id: string }
      try {
        response = await api.request('/api/runs', {
          message: message.trim(),
          selection: { image, video, mode },
          skill,
          attachments: attachments.map((a) => a.id),
          previous: run?.status === 'complete' ? current : null,
          ...(canvasId ? { canvas_id: canvasId } : {}),
        })
      } catch (e) {
        if (!(e instanceof StudioHTTPError) || e.status >= 500) {
          setUncertain(true)
          throw new Error('发送结果尚未确认。请先刷新历史会话查找已开始的创作，避免重复生成。')
        }
        throw e
      }
      studio.setCurrent(response.id)
      setMessage('')
      setAttachments([])
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
    uploadLock.current = true
    setUploading(true)
    studio.setError('')
    try {
      for (const file of list) {
        let entry: StudioAttachment = { name: file.name }
        try {
          if (!file.size || file.size > 10 * 1024 * 1024) throw new Error('单个文件须为 1 字节至 10 MB。')
          entry = await api.upload(file)
        } catch (e) {
          entry.error = e instanceof Error ? e.message : '上传失败'
        }
        setAttachments((old) => [...old, entry])
      }
    } finally {
      uploadLock.current = false
      setUploading(false)
      if (files.current) files.current.value = ''
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
      await api.request(`/api/runs/${id}/${name}`, {})
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
  const modelName = (id?: number) => {
    const model = catalog.models.find((m) => m.id === id)
    return model?.display_name || model?.model || (id ? `模型 #${id}` : '选择模型')
  }
  const currentSkill = catalog.skills.find((s) => s.name === skill)
  const latestUsage = [...(run?.events || [])]
    .reverse()
    .find(
      (event) =>
        event.kind === 'cost' &&
        event.data?.tool === 'model.generate_text' &&
        Number.isFinite(event.data?.usage?.input_tokens) &&
        event.data?.usage?.input_tokens >= 0,
    )?.data?.usage

  const activeBatch = run?.batches?.find((b) => b.id === run.active_batch)
  const batchHasRunning = Object.values(activeBatch?.nodes || {}).some((node) =>
    ['running', 'submitting'].includes(node.status),
  )
  const status =
    {
      running: run?.stop ? '正在停止后续步骤' : '正在创作',
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
      <section className={`${styles.studio} ${className}`} aria-label="帧智汇导演">
        <header className={styles.header}>
          <div className={styles.historyAnchor} ref={historyAnchor}>
            <button
              type="button"
              className={styles.titleButton}
              aria-expanded={history}
              onClick={() => setHistory(!history)}
            >
              <span>{current ? run?.title || '创作对话' : '新对话'}</span>
              <ChevronDown size={18} />
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
                      studio.setCurrent(item.id)
                      setHistory(false)
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
              disabled={actionBusy || uploading}
              onClick={newConversation}
            >
              <CirclePlus size={16} />
            </button>
            <button
              type="button"
              className={styles.iconButton}
              aria-label="制作文档"
              disabled={!run}
              onClick={() => openDialog('documents')}
            >
              <FileText size={16} />
            </button>
            <button
              type="button"
              className={styles.iconButton}
              aria-label="导演设置"
              title="导演设置与连接"
              onClick={() => openDialog('connection')}
            >
              <SlidersHorizontal size={16} />
            </button>
            <button
              type="button"
              className={styles.iconButton}
              aria-label={results ? '返回对话' : '查看制作成果'}
              aria-pressed={results}
              onClick={() => {
                followUpdates.current = true
                setResults(!results)
              }}
            >
              <LayoutPanelLeft size={16} />
            </button>
            {onCollapse && (
              <button
                type="button"
                className={styles.iconButton}
                aria-label="收起导演"
                onClick={() => {
                  setDialog(null)
                  setHistory(false)
                  onCollapse()
                }}
              >
                −
              </button>
            )}
          </div>
        </header>
        <div className={styles.statusRow} hidden={!current && state.connected && !loading}>
          <span>
            <i />
            {status}
          </span>
          <span>{state.workspace_id ? `工作空间 #${state.workspace_id}` : ''}</span>
        </div>
        {mismatch && (
          <div role="alert" className={styles.alert}>
            当前 MCP 授权空间与页面不同。请在连接设置中重新授权，避免写入其他画布。
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
                  events={run.events}
                  canvas={run.canvas}
                  onDocument={(id) => {
                    setSelectedDocument(id)
                    setDialog('documents')
                  }}
                />
              </div>
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
                                failed: '失败',
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
                              node.status === 'failed' &&
                              node.attempt < 3 && (
                                <button
                                  type="button"
                                  disabled={actionBusy}
                                  onClick={() =>
                                    void action(async () => {
                                      const id = current
                                      await api.request(`/api/runs/${id}/batches/${batch.id}/retry`, {
                                        node_ids: [node.id],
                                        revision: batch.revision,
                                        idempotency_key: `retry-${batch.id}-${node.id}-${batch.revision}`,
                                      })
                                      await api.request(`/api/runs/${id}/resume`, {})
                                      if (currentId.current === id) await studio.reload()
                                    })
                                  }
                                >
                                  申请重试此任务
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
                <Approval key={run.decision_id} run={run} busy={actionBusy} onDecision={decide} />
              )}
              {['paused', 'error'].includes(run.status) && (
                <div className={styles.recovery}>
                  <p>已成功的素材会保留。恢复会先查询已提交任务；失败素材重试需要单独确认。</p>
                  <button type="button" disabled={actionBusy} onClick={() => void operation('resume')}>
                    恢复执行 / 查询已有任务
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
              {run?.billing && (
                <details
                  className={styles.billing}
                  title={`推理 ${run.billing.by_kind?.text ?? '未知'} · 图片 ${run.billing.by_kind?.image ?? '未知'} · 视频 ${run.billing.by_kind?.video ?? '未知'}`}
                >
                  <summary>本次共消耗 {run.billing.settled_credits} 积分</summary>
                  <p>
                    推理 {run.billing.by_kind?.text ?? '未知'} · 图片 {run.billing.by_kind?.image ?? '未知'} · 视频{' '}
                    {run.billing.by_kind?.video ?? '未知'}
                  </p>
                  {Number(run.billing.pending_tasks) > 0
                    ? ` · ${run.billing.pending_tasks} 项待结算（已预留 ${run.billing.reserved_credits}）`
                    : ''}
                </details>
              )}
            </>
          ) : (
            <section className={styles.welcome}>
              <div className={styles.orb} aria-hidden="true" />
              <h1>让帧智汇导演辅助你的无限创意</h1>
              <div className={styles.starters}>
                <button type="button" onClick={() => openDialog('skills')}>
                  <SlidersHorizontal size={20} />
                  <span>选择 Skill 开始创作</span>
                  <ArrowRight size={18} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMessage('帮我创作一部短剧。先讨论核心创意、人物与冲突，确认大纲后再开始制作。')
                    prompt.current?.focus()
                  }}
                >
                  <Sparkles size={20} />
                  <span>从创意开始剧本原创</span>
                  <ArrowRight size={18} />
                </button>
                <button
                  type="button"
                  onClick={() => (state.connected ? files.current?.click() : openDialog('connection'))}
                >
                  <FileText size={20} />
                  <span>上传故事来改编</span>
                  <ArrowRight size={18} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMessage('根据我的故事规划第1集分镜、镜头时长和角色参考，再生成素材，最后按顺序合并视频。')
                    prompt.current?.focus()
                  }}
                >
                  <Clapperboard size={20} />
                  <span>批量创建分镜</span>
                  <ArrowRight size={18} />
                </button>
              </div>
              {!state.connected && !loading && (
                <button type="button" className={styles.connectButton} onClick={() => openDialog('connection')}>
                  连接工作空间，开始创作
                </button>
              )}
            </section>
          )}
        </div>
        <div className={styles.composerArea} ref={composerAnchor}>
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
              <ArrowDown size={18} />
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
                  <Clapperboard size={16} />
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
            <div className={styles.chips}>
              {image && <span>图片 · {modelName(image)}</span>}
              {video && <span>视频 · {modelName(video)}</span>}
              {currentSkill && <span>Skill · {currentSkill.description || currentSkill.name}</span>}
            </div>
            {!!attachments.length && (
              <div className={styles.attachments}>
                {attachments.map((item, index) => (
                  <div key={`${item.id || item.name}-${index}`}>
                    <FileText size={18} />
                    <span>
                      {item.name}
                      <small>
                        {item.error || (item.type === 'prompt' ? `已读取 ${item.characters} 字` : '参考图片已就绪')}
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
            <textarea
              ref={prompt}
              aria-label="创作要求"
              placeholder="开始你的创作，或者上传图片与剧本文档…"
              maxLength={12000}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              disabled={disabled || unfinished}
              onPaste={(e) => {
                if (e.clipboardData.files.length) {
                  e.preventDefault()
                  void upload([...e.clipboardData.files])
                }
              }}
            />
            <div className={styles.composerToolbar}>
              <div className={styles.composerActions}>
                <button
                  type="button"
                  className={styles.iconButton}
                  aria-label="上传图片或剧本"
                  disabled={!state.connected || disabled || unfinished}
                  onClick={() => files.current?.click()}
                >
                  <Plus size={24} />
                </button>
                <button
                  type="button"
                  aria-label="模型"
                  title="选择模型"
                  aria-expanded={dialog === 'models'}
                  disabled={disabled || unfinished}
                  onClick={() => openDialog('models')}
                >
                  <Box size={20} />
                  <span>模型</span>
                </button>
                <button
                  type="button"
                  aria-label="Skill"
                  title="选择 Skill"
                  aria-expanded={dialog === 'skills'}
                  disabled={disabled || unfinished}
                  onClick={() => openDialog('skills')}
                >
                  <Sparkles size={20} />
                  <span>Skill</span>
                </button>
                <button
                  type="button"
                  title={mode === 'auto' ? '自动生成' : '手动确认'}
                  aria-label={mode === 'auto' ? '自动生成' : '手动确认'}
                  aria-expanded={dialog === 'mode'}
                  disabled={disabled || unfinished}
                  onClick={() => openDialog('mode')}
                >
                  {mode === 'auto' ? <Diamond size={20} /> : <Hand size={20} />}
                  <span>{mode === 'auto' ? '自动生成' : '手动确认'}</span>
                </button>
              </div>
              <button
                type="button"
                className={styles.contextButton}
                aria-label="上下文用量"
                title={latestUsage ? `上次输入 ${latestUsage.input_tokens} tokens` : '上下文用量未提供'}
                aria-expanded={dialog === 'context'}
                onClick={() => openDialog('context')}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <circle
                    cx="8"
                    cy="8"
                    r="5.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeDasharray="2 2"
                  />
                </svg>
              </button>
              {run && ['running', 'waiting'].includes(run.status) ? (
                <button
                  type="button"
                  className={styles.send}
                  aria-label="停止后续执行"
                  disabled={stopping || run.stop}
                  onClick={() => void operation('stop')}
                >
                  <Square size={19} fill="currentColor" />
                </button>
              ) : (
                <button
                  type="submit"
                  className={styles.send}
                  aria-label="发送创作要求"
                  disabled={
                    !ready ||
                    disabled ||
                    unfinished ||
                    uncertain ||
                    attachments.some((a) => !a.id) ||
                    (!message.trim() && !attachments.length)
                  }
                >
                  <ArrowUp size={27} />
                </button>
              )}
            </div>
          </form>
          <footer className={styles.footer}>
            <span>{uploading ? '正在上传…' : mode === 'auto' ? '自动调用并计费，可随时停止' : '每次生成前确认'}</span>
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
        {dialog === 'connection' && (
          <Dialog error={studio.error} title="导演全局设置" onClose={() => setDialog(null)}>
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
                : '使用业务账号登录，并授权可使用的工作空间。'}
            </p>
            <p className={styles.muted}>生成按实际用量结算。你可以随时停止后续步骤，已提交任务会保留。</p>
            <button
              type="button"
              className={styles.primary}
              disabled={actionBusy || running}
              onClick={() =>
                void action(async () => {
                  const response = await api.request<{ url: string }>('/api/connect', {})
                  const url = new URL(response.url)
                  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('授权链接无效')
                  window.location.assign(url.href)
                })
              }
            >
              {state.connected ? '重新授权' : '登录并连接'}
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
                          <Box size={19} />
                        </span>
                        <span>
                          <strong>{model.display_name || model.model}</strong>
                          <small>{model.description || model.model}</small>
                        </span>
                        {(modelTab === 'image' ? image : video) === model.id ? (
                          <Check size={16} />
                        ) : (
                          <CirclePlus size={16} />
                        )}
                      </button>
                    ))
                : [{ name: '', description: '未选择', id: 0 }, ...catalog.skills]
                    .filter((item) => `${item.name} ${item.description}`.toLowerCase().includes(query.toLowerCase()))
                    .map((item) => (
                      <button
                        type="button"
                        key={item.name}
                        disabled={disabled || unfinished}
                        aria-pressed={skill === item.name}
                        onClick={() => {
                          setSkill(item.name)
                          setDialog(null)
                        }}
                      >
                        <span className={styles.optionIcon}>
                          <Sparkles size={18} />
                        </span>
                        <span>
                          <strong>{item.description || item.name}</strong>
                          {item.name && <small>/{item.name}</small>}
                        </span>
                        {skill === item.name && <Check size={16} />}
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
                <Hand size={18} />
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
                <Diamond size={18} />
                <span>
                  <strong>自动生成</strong>
                  <small>按你的要求连续执行并计费，可随时停止。必要的信息仍会向你询问。</small>
                </span>
                {mode === 'auto' && <Check size={16} />}
              </button>
            </div>
          </Popover>
        )}
        {dialog === 'context' && (
          <Popover anchor={composerAnchor.current} title="上下文用量" onClose={() => setDialog(null)}>
            <div className={styles.contextInfo}>
              <p>{latestUsage ? `上次输入 ${latestUsage.input_tokens.toLocaleString()} tokens` : '上下文用量未提供'}</p>
              <p>模型上下文总容量：未提供</p>
              <p>自动摘要：未启用</p>
              <small>输入用量来自最近一次推理的实际回执，不代表剩余上下文比例。</small>
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
              <p className={styles.muted}>导演保存的计划、角色参考和分镜会出现在这里。</p>
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
