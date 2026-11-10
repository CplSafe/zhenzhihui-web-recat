import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, Download, ImageIcon, LoaderCircle, X } from 'lucide-react'
import { StudioIcon } from './StudioIcons'
import { isSettled } from './studio'
import { Media } from './StudioMedia'
import type { Data, StudioDocument, StudioEvent, StudioRun, StudioModel } from './studio'
import styles from './DeepAgentStudio.module.css'

/** Tooltip surface is outside the panel so rounded overflow never cuts it off. */
export function TooltipLayer({ scope }: { scope: React.RefObject<HTMLElement> }) {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; below: boolean } | null>(null)
  const tooltip = useRef<HTMLDivElement>(null)
  const target = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const root = scope.current
    if (!root) return
    const hide = () => {
      target.current = null
      setTip(null)
    }
    const show = (event: Event) => {
      const button = (event.target as Element).closest<HTMLElement>('[data-tooltip]')
      if (!button || button.hasAttribute('disabled') || button.getAttribute('aria-expanded') === 'true') {
        hide()
        return
      }
      target.current = button
      const rect = button.getBoundingClientRect()
      setTip({
        text: button.dataset.tooltip || '',
        x: rect.left + rect.width / 2,
        y: rect.top < 44 ? rect.bottom + 8 : rect.top - 8,
        below: rect.top < 44,
      })
    }
    const leave = (event: Event) => {
      if (!target.current?.contains((event as FocusEvent).relatedTarget as Node)) hide()
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide()
    }
    root.addEventListener('pointerover', show)
    root.addEventListener('focusin', show)
    root.addEventListener('pointerout', leave)
    root.addEventListener('focusout', leave)
    document.addEventListener('pointerdown', hide)
    document.addEventListener('click', hide)
    document.addEventListener('scroll', hide, true)
    document.addEventListener('keydown', key)
    window.addEventListener('resize', hide)
    return () => {
      root.removeEventListener('pointerover', show)
      root.removeEventListener('focusin', show)
      root.removeEventListener('pointerout', leave)
      root.removeEventListener('focusout', leave)
      document.removeEventListener('pointerdown', hide)
      document.removeEventListener('click', hide)
      document.removeEventListener('scroll', hide, true)
      document.removeEventListener('keydown', key)
      window.removeEventListener('resize', hide)
    }
  }, [scope])
  useLayoutEffect(() => {
    const box = tooltip.current
    if (!box || !tip) return
    const width = box.offsetWidth
    box.style.left = Math.max(8, Math.min(tip.x - width / 2, window.innerWidth - width - 8)) + 'px'
  }, [tip])
  return tip
    ? createPortal(
        <div
          ref={tooltip}
          role="tooltip"
          className={styles.tooltip}
          data-below={tip.below}
          style={{ top: tip.y, left: tip.x }}
        >
          {tip.text}
        </div>,
        document.body,
      )
    : null
}

export function Markdown({ children }: { children: string }) {
  return (
    <div className={styles.markdown}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          img: ({ alt }) => <span>{alt || '图片引用'}</span>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
export function Dialog({
  title,
  onClose,
  children,
  error,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
  error?: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])
  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className={styles.dialogBody}>
        <header>
          <h2>{title}</h2>
          <button type="button" className={styles.iconButton} aria-label="关闭" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        {error && (
          <p role="alert" className={styles.alert}>
            {error}
          </p>
        )}
        {children}
      </div>
    </dialog>
  )
}
/** Non-modal composer popover; outside/Escape dismissal preserves the draft. */
export function Popover({
  title,
  anchor,
  onClose,
  children,
}: {
  title: string
  anchor: HTMLElement | null
  onClose: () => void
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: 12, top: 12 })
  useLayoutEffect(() => {
    const place = () => {
      const rect = anchor?.getBoundingClientRect()
      const box = ref.current
      if (!rect || !box) return
      setPosition({
        left: Math.max(12, Math.min(rect.left - 16, window.innerWidth - box.offsetWidth - 12)),
        top: Math.max(12, rect.top - box.offsetHeight - 10),
      })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [anchor, children])
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    ref.current?.querySelector<HTMLElement>('input,button')?.focus()
    const outside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node) && !anchor?.contains(event.target as Node)) onClose()
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', key)
      previous?.focus()
    }
    // The lifetime is one opening. Callbacks only close the popover.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return createPortal(
    <div ref={ref} role="dialog" aria-label={title} className={styles.popover} style={position}>
      <header>
        <h2>{title}</h2>
        <button type="button" aria-label="关闭选择" onClick={onClose}>
          <X size={16} />
        </button>
      </header>
      {children}
    </div>,
    document.body,
  )
}

function CopyMessage({ text }: { text: string }) {
  const [copied, setCopied] = useState(false),
    [failed, setFailed] = useState(false)
  return (
    <div className={styles.messageActions}>
      <button
        type="button"
        aria-label={copied ? '已复制' : '复制消息'}
        data-tooltip={copied ? '已复制' : '复制'}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text)
            setCopied(true)
            setFailed(false)
          } catch {
            setFailed(true)
          }
        }}
      >
        {copied ? <Check size={14} /> : <StudioIcon name="copy" size={14} />}
      </button>
      {failed && <span role="status">复制失败，请选择文字复制。</span>}
    </div>
  )
}

const taskNames: Record<string, string> = {
  'model.generate_text': '思考',
  'model.generate_image': '生成图片',
  'model.generate_video': '生成视频',
  'asset.get': '读取素材',
  'asset.list': '查找素材',
  'model.get': '读取模型设置',
  'model.list': '查看可用模型',
  'billing.get_balance': '查询余额',
  'task.get': '查询任务',
  'task.wait': '等待任务完成',
  'canvas.get': '读取画布',
  'canvas.update': '更新画布',
  save_document: '保存制作文档',
  'studio.read_context': '读取制作资料',
  'studio.load_tools': '准备制作工具',
}
function publicReasoning(event: StudioEvent) {
  return event.data?.reasoning_enabled === true && typeof event.data?.reasoning_summary === 'string'
    ? event.data.reasoning_summary.trim()
    : ''
}
function isInferenceEvent(event: StudioEvent) {
  return (
    ['cost', 'tool', 'progress'].includes(event.kind) &&
    event.data?.tool === 'model.generate_text' &&
    event.data?.purpose !== 'context_compaction'
  )
}
export function EventCard({
  event,
  canvas,
  onDocument,
  active = true,
}: {
  active?: boolean
  event: StudioEvent
  canvas?: Data | null
  onDocument?: (id: string) => void
}) {
  const data = event.data || {},
    settled = isSettled(event),
    failed = ['failed', 'cancelled', 'canceled', 'payment_failed'].includes(data.status)
  const decisionLabel =
    event.kind === 'user'
      ? data.decision === 'reply' && data.tool === 'ask_user'
        ? '已回答'
        : data.decision === 'approve'
          ? '已确认制作'
          : data.decision === 'reject'
            ? '已拒绝制作'
            : null
      : null
  if (decisionLabel)
    return (
      <article className={`${styles.event} ${styles.answeredCard}`}>
        <div className={styles.artifactStatus}>
          {data.decision === 'reject' ? <X size={14} /> : <Check size={14} />}
          {decisionLabel}
        </div>
        <Markdown>{event.text}</Markdown>
        <CopyMessage text={event.text} />
      </article>
    )
  if (event.kind === 'document' && data.id)
    return (
      <article className={styles.event}>
        <div className={styles.artifactStatus}>
          <StudioIcon name="file" size={14} />
          创作文本已保存
        </div>
        <button
          type="button"
          className={styles.documentCard}
          disabled={!onDocument}
          onClick={() => onDocument?.(data.id)}
        >
          <StudioIcon name="document" size={22} />
          <span>
            {data.title || '制作文档'}
            <small>制作文档 · 版本 {data.revision}</small>
          </span>
          <StudioIcon name="chevron" size={16} />
        </button>
      </article>
    )
  if (['canvas', 'node', 'batch', 'context', 'tool_start'].includes(event.kind)) return null
  if (isInferenceEvent(event)) {
    const summary = publicReasoning(event)
    if (!summary) return null
    return (
      <article className={styles.event}>
        <details className={`${styles.taskCard} ${styles.thinkingCard}`}>
          <summary>
            <StudioIcon name="process" size={14} />
            <strong>思考</strong>
          </summary>
          <div className={styles.taskContent}>
            <Markdown>{summary}</Markdown>
          </div>
        </details>
      </article>
    )
  }
  const taskLabel =
    event.kind === 'progress'
      ? event.text
      : data.purpose === 'context_compaction'
        ? '整理上下文'
        : taskNames[data.tool] ||
          (event.kind === 'merge' ? '合并完整视频' : event.kind === 'tool' ? '处理制作资料' : '制作进度')
  const taskState = settled
    ? '已完成'
    : failed
      ? '未完成'
      : event.kind === 'tool'
        ? '已返回'
        : active
          ? '处理中'
          : '已暂停'
  const mediaType = data.tool === 'model.generate_image' ? '图片' : data.tool === 'model.generate_video' ? '视频' : null
  const hasMedia = !!(data.assets?.length || data.asset)
  const mediaPending =
    mediaType &&
    !settled &&
    !failed &&
    ['submitting', 'submitted', 'queued', 'pending', 'running', 'processing', 'waiting'].includes(data.status)

  if (['cost', 'tool', 'merge'].includes(event.kind) || (event.kind === 'progress' && data.status))
    return (
      <article className={styles.event}>
        <details className={styles.taskCard}>
          <summary>
            {data.tool === 'model.generate_text' ? (
              <StudioIcon name="process" size={16} />
            ) : settled ? (
              <Check size={16} />
            ) : failed ? (
              <span>!</span>
            ) : event.kind === 'tool' ? (
              <StudioIcon name="chevron" size={18} />
            ) : !active ? (
              <StudioIcon name="minus" size={18} />
            ) : (
              <LoaderCircle size={18} className={styles.spin} />
            )}
            <strong>{taskLabel}</strong>
            <small>{taskState}</small>
          </summary>
          <div className={styles.taskContent}>
            <p>
              {taskLabel} · {taskState}
            </p>
            {settled && data.actual_cost != null && <p>实际消耗 {data.actual_cost} 积分</p>}
            {!settled && !failed && data.estimated_cost != null && <p>已预留 {data.estimated_cost} 积分 · 待结算</p>}
          </div>
        </details>
        {mediaType && !hasMedia && (mediaPending || failed || settled) && (
          <div
            className={`${styles.mediaPlaceholder} ${mediaPending && active ? styles.mediaGenerating : ''}`}
            role="status"
            aria-busy={!!mediaPending && active}
            aria-label={
              failed
                ? `${mediaType}未生成`
                : settled
                  ? `${mediaType}已生成，素材准备中`
                  : active
                    ? `正在生成${mediaType}`
                    : `${mediaType}进度已保留`
            }
          >
            {mediaType === '视频' ? <StudioIcon name="film" size={26} /> : <ImageIcon size={26} />}
            <span>
              {failed
                ? `${mediaType}未生成`
                : settled
                  ? '已生成，素材准备中'
                  : active
                    ? `正在生成${mediaType}…`
                    : '进度已保留，等待恢复'}
            </span>
          </div>
        )}
        {(data.assets || data.asset) && (
          <>
            {settled && (
              <div className={styles.artifactStatus}>
                {event.kind === 'merge'
                  ? '成片已合成'
                  : data.tool === 'model.generate_video'
                    ? '视频已生成'
                    : data.tool === 'model.generate_image'
                      ? '图片已生成'
                      : '素材已生成'}
              </div>
            )}
            <Media canvas={canvas} data={{ assets: data.assets, asset: data.asset }} />
          </>
        )}
      </article>
    )
  return (
    <article
      className={`${styles.event} ${event.kind === 'user' ? styles.userMessage : event.kind === 'error' ? styles.errorMessage : styles.assistantMessage}`}
    >
      <Markdown>{event.text}</Markdown>
      {event.kind === 'user' && data.delivery === 'sending' && <small role="status">发送中…</small>}
      {event.data && event.kind !== 'inspection' && <Media canvas={canvas} data={event.data} />}
      {['user', 'assistant'].includes(event.kind) && <CopyMessage text={event.text} />}
    </article>
  )
}
/** Group only adjacent tool receipts. Never regroup across messages or hide media results. */
export function Conversation({
  events,
  canvas,
  onDocument,
  active = true,
}: {
  active?: boolean
  events: StudioEvent[]
  canvas?: Data | null
  onDocument: (id: string) => void
}) {
  const groups: StudioEvent[][] = []
  let tools: StudioEvent[] = []
  for (const event of events) {
    if (isInferenceEvent(event) && !publicReasoning(event)) continue
    if (event.kind === 'tool' && !event.data?.assets && !event.data?.asset) tools.push(event)
    else {
      if (tools.length) groups.push(tools)
      tools = []
      groups.push([event])
    }
  }
  if (tools.length) groups.push(tools)
  return (
    <>
      {groups.map((group) =>
        group.length > 1 ? (
          <details className={styles.toolGroup} key={group[0].id}>
            <summary>
              <StudioIcon name="chevron" size={14} />
              已执行 {group.length} 个工具
            </summary>
            {group.map((event) => (
              <EventCard key={event.id} event={event} canvas={canvas} onDocument={onDocument} active={active} />
            ))}
          </details>
        ) : (
          <EventCard key={group[0].id} event={group[0]} canvas={canvas} onDocument={onDocument} active={active} />
        ),
      )}
    </>
  )
}

export function Results({ run }: { run: StudioRun | null }) {
  const events = run?.events || []
  const images = events.filter(
    (e) => e.kind === 'cost' && isSettled(e) && e.data?.tool === 'model.generate_image' && e.data.assets?.length,
  )
  const videos = events.filter(
    (e) => e.kind === 'cost' && isSettled(e) && e.data?.tool === 'model.generate_video' && e.data.assets?.length,
  )
  const merges = events.filter((e) => e.kind === 'merge' && isSettled(e))
  return (
    <section className={styles.results}>
      <h2>制作成果</h2>
      <p>
        {images.reduce((n, e) => n + e.data!.assets.length, 0)} 张图片 · {videos.length} 段视频 · {merges.length} 个成片
      </p>
      {!images.length && !videos.length && !merges.length && (
        <p className={styles.muted}>制作完成的图片、镜头和合并视频会在这里呈现。</p>
      )}
      {(
        [
          ['合并完整视频', merges],
          ['视频结果集', videos],
          ['图片结果集', images],
        ] as const
      ).map(
        ([title, list]) =>
          list.length > 0 && (
            <section key={title}>
              <h3>{title}</h3>
              {list.map((e) => (
                <article key={e.id}>
                  <p>{e.text}</p>
                  <Media canvas={run?.canvas} data={{ assets: e.data?.assets, asset: e.data?.asset }} />
                </article>
              ))}
            </section>
          ),
      )}
      {events
        .filter((e) => e.kind === 'inspection' || e.kind === 'delivery')
        .map((e) => (
          <details key={e.id}>
            <summary>成片检查</summary>
            <Markdown>{e.text}</Markdown>
          </details>
        ))}
    </section>
  )
}
function ApprovalScope({ argumentsValue, models }: { argumentsValue: Data; models: StudioModel[] }) {
  const nodes: Data[] = Array.isArray(argumentsValue.nodes) ? argumentsValue.nodes : [{ arguments: argumentsValue }]
  const fields = [
    ['prompt', '创作描述'],
    ['duration', '时长（秒）'],
    ['resolution', '清晰度'],
    ['aspect_ratio', '画面比例'],
    ['ratio', '画面比例'],
    ['generate_audio', '生成声音'],
    ['audio', '生成声音'],
    ['num_images', '图片数量'],
  ]
  return (
    <div className={styles.approvalScope}>
      {nodes.map((node, index) => {
        const args = node.arguments || {},
          params = args.params || {}
        const model = models.find((item) => item.id === args.model_version_id)
        return (
          <section key={index}>
            <strong>{node.title || `制作项目 ${index + 1}`}</strong>
            {model && <p>模型：{model.display_name || model.model}</p>}
            {fields.map(([key, label]) => {
              const value = params[key] ?? args[key]
              return ['string', 'number', 'boolean'].includes(typeof value) ? (
                <p key={key}>
                  {label}：{typeof value === 'boolean' ? (value ? '是' : '否') : String(value)}
                </p>
              ) : null
            })}
            {Array.isArray(args.input_assets) && args.input_assets.length > 0 && (
              <p>参考素材：{args.input_assets.length} 项</p>
            )}
            {node.estimated_cost != null && <p>预计积分：{String(node.estimated_cost)}</p>}
          </section>
        )
      })}
      <p>需要调整时，请在下方说明；DoDo Agent 会重新准备方案，再由你确认。</p>
    </div>
  )
}
export function Approval({
  run,
  busy,
  onDecision,
  models = [],
}: {
  run: StudioRun
  busy: boolean
  onDecision: (data: Data) => Promise<void>
  models?: StudioModel[]
}) {
  const pending = run.pending!,
    ask = pending.tool === 'ask_user',
    replan = pending.requires_replan
  const [feedback, setFeedback] = useState(''),
    [error, setError] = useState('')
  const [answers, setAnswers] = useState<Record<number, string>>({}),
    [page, setPage] = useState(0)
  const questions: Data[] = Array.isArray(pending.arguments?.questions) ? pending.arguments.questions : []
  async function submit(approve: boolean) {
    let message = feedback.trim()
    if (ask && approve && questions.length) {
      if (questions.some((_, index) => !answers[index]?.trim())) {
        setError('请完成全部问题后继续。')
        return
      }
      message =
        questions.map((q, i) => `${i + 1}. ${q.question}\n回答：${answers[i]}`).join('\n\n') +
        (message ? '\n补充：' + message : '')
    }
    if (ask && approve && !message) {
      setError('请输入回复后继续。')
      return
    }
    await onDecision({
      decision_id: run.decision_id,
      decision: approve ? (ask || replan ? 'reply' : 'approve') : 'reject',
      message: message || (approve ? (replan ? '按最新制作文档重新规划。' : '用户确认继续') : '用户取消了这个操作'),
      ...(!ask && !replan && approve ? { arguments: pending.arguments || {} } : {}),
    })
  }
  return (
    <section className={styles.approval} aria-label={ask ? 'DoDo Agent 的问题' : '生成确认'}>
      <h3>{replan ? '制作资料已更新' : ask ? '需要你的想法' : '确认这一步制作'}</h3>
      <Markdown>{pending.message || ''}</Markdown>
      {ask && questions.length > 0 && (
        <>
          <p className={styles.muted}>
            问题 {page + 1} / {questions.length}
          </p>
          <fieldset>
            <legend>{questions[page].question}</legend>
            {(questions[page].options || []).map((choice: Data, index: number) =>
              choice.type === 'input' ? (
                <input
                  key={`${page}-${index}`}
                  aria-label={choice.content || '其他想法'}
                  placeholder={choice.content}
                  maxLength={2000}
                  value={answers[page] || ''}
                  onChange={(e) => setAnswers((old) => ({ ...old, [page]: e.target.value }))}
                />
              ) : (
                <label key={index} className={styles.choice}>
                  <input
                    type="radio"
                    name={`question-${page}`}
                    checked={answers[page] === choice.content}
                    onChange={() => setAnswers((old) => ({ ...old, [page]: choice.content }))}
                  />
                  {choice.content}
                </label>
              ),
            )}
          </fieldset>
          <div className={styles.row}>
            <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>
              上一题
            </button>
            <button type="button" disabled={page === questions.length - 1} onClick={() => setPage(page + 1)}>
              下一题
            </button>
          </div>
        </>
      )}
      {!ask && (
        <details>
          <summary>查看制作内容</summary>
          <ApprovalScope argumentsValue={pending.arguments || {}} models={models} />
        </details>
      )}
      <textarea
        aria-label="补充意见"
        placeholder={ask ? '输入你的回复或补充说明…' : '告诉 DoDo Agent 你的想法，或者直接确认继续…'}
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        maxLength={12000}
      />
      {error && <p role="alert">{error}</p>}
      <div className={styles.row}>
        <button type="button" disabled={busy} onClick={() => void submit(false)}>
          取消此操作
        </button>
        <button type="button" className={styles.primary} disabled={busy} onClick={() => void submit(true)}>
          {replan ? '按最新文档继续' : ask ? '提交并继续' : '确认并继续'}
        </button>
      </div>
    </section>
  )
}
export function DocumentEditor({
  document,
  busy,
  onSave,
}: {
  document: StudioDocument
  busy: boolean
  onSave: (document: StudioDocument, body: string, key: string) => Promise<void | boolean>
}) {
  const [body, setBody] = useState(document.body),
    [editing, setEditing] = useState<StudioDocument | null>(null)
  const request = useRef<{ body: string; revision: number; key: string } | null>(null)
  return (
    <section>
      <h3>
        <StudioIcon name="file" size={18} /> {document.title}
      </h3>
      <div className={styles.documentMeta}>
        <p className={styles.muted}>版本 {document.revision}</p>
        <a
          download={`${document.title.replace(/[\\/:*?"<>|]/g, '_')}.md`}
          href={`data:text/markdown;charset=utf-8,${encodeURIComponent(document.body)}`}
        >
          <Download size={14} />
          下载文档
        </a>
      </div>
      {editing && editing.revision !== document.revision && (
        <div role="status" className={styles.alert}>
          文档已更新为版本 {document.revision}。当前草稿仍基于版本 {editing.revision}，不会覆盖新版本。
          <details>
            <summary>查看最新正文</summary>
            <Markdown>{document.body}</Markdown>
          </details>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setBody(document.body)
              setEditing({ ...document })
              request.current = null
            }}
          >
            用最新版本替换当前草稿
          </button>
        </div>
      )}
      {editing ? (
        <textarea
          className={styles.documentEditor}
          aria-label="制作文档正文"
          maxLength={40000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      ) : (
        <Markdown>{document.body}</Markdown>
      )}
      <div className={styles.row}>
        {editing ? (
          <>
            <button type="button" disabled={busy} onClick={() => setEditing(null)}>
              关闭编辑
            </button>
            <button
              type="button"
              className={styles.primary}
              disabled={busy || !body.trim()}
              onClick={async () => {
                if (request.current?.body !== body || request.current.revision !== editing.revision)
                  request.current = { body, revision: editing.revision, key: crypto.randomUUID() }
                if (await onSave(editing, body, request.current.key)) setEditing(null)
              }}
            >
              保存修订
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setBody(document.body)
              setEditing({ ...document })
            }}
          >
            编辑文档
          </button>
        )}
      </div>
    </section>
  )
}
