/**
 * AgentChatPanel —— 画布右侧智能体对话栏。
 *
 * 交互要点:
 *  - SSE 单向流,无法在流内回传输入。「等待确认」不是挂起连接,而是结束当前流,
 *    用户表态后用 continueSession 续跑,中间状态由后端落库(关页面也不丢)。
 *  - 生成前的确认闸门是钱包安全的最后一道:手动模式下必须用户点确认才提交扣费,
 *    只带 message 的追问("能不能改成10秒")绝不当作确认。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  continueSession,
  listChatModels,
  startSession,
  type AgentChatModel,
  type AgentEvent,
  type AgentExecMode,
  type AgentKind,
  type AgentPendingCall,
} from '@/api/agent'
import styles from './AgentChatPanel.module.css'

/** 会话内渲染的一条内容。工具轨迹与对话消息同列展示,靠样式区分权重。 */
type Entry =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'trace'; label: string; text: string; running?: boolean }
  | { kind: 'question'; text: string; options: string[]; answered?: boolean }
  | { kind: 'confirm'; call: AgentPendingCall; settled?: 'done' | 'cancelled' }

interface AgentChatPanelProps {
  workspaceId: number
  kind?: AgentKind
  /** 面板标题,默认「新建对话」。 */
  title?: string
  /** 收起面板。未传则不显示收起按钮。 */
  onCollapse?: () => void
  /** 生成任务提交后回调,便于画布侧插入节点或刷新任务列表。 */
  onGenerated?: (info: { callId: string; estimatedCredits: number }) => void
}

const EXEC_MODES: { value: AgentExecMode; title: string; desc: string }[] = [
  { value: 'manual', title: '手动确认', desc: 'Agent 在执行生成前都会寻求您的确认' },
  { value: 'auto', title: '自动生成', desc: 'Agent 会自主规划生成任务并自动执行' },
]

const SUGGESTIONS = ['分析这个产品的选品价值', '帮我追踪这个品类的热点', '规划下一步怎么创作']

/** 工具名 → 展示标签。未知工具直接显示原名,不隐藏信息。 */
const TOOL_LABELS: Record<string, string> = {
  web_search: '搜索',
  fetch_page: '抓取',
  save_finding: '记录',
  list_findings: '盘点',
  generate_video: '生成视频',
}

/** 确认卡片里展示的参数,按这个顺序排;其余参数不展示避免噪音。 */
const PARAM_LABELS: [string, string][] = [
  ['model', '模型'],
  ['resolution', '清晰度'],
  ['duration', '时长(秒)'],
  ['aspect', '画幅'],
  ['count', '数量'],
]

export default function AgentChatPanel({
  workspaceId,
  kind = 'product_analysis',
  title = '新建对话',
  onCollapse,
  onGenerated,
}: AgentChatPanelProps) {
  const [entries, setEntries] = useState<Entry[]>([])
  const [input, setInput] = useState('')
  const [focused, setFocused] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [execMode, setExecMode] = useState<AgentExecMode>('manual')
  const [models, setModels] = useState<AgentChatModel[]>([])
  const [modelId, setModelId] = useState<number>(0)
  const [openMenu, setOpenMenu] = useState<'mode' | 'model' | null>(null)

  const sessionRef = useRef<number>(0)
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const barRef = useRef<HTMLDivElement>(null)

  // 模型列表来自后端 catalog,运营上下架模型后前端自动跟随。
  useEffect(() => {
    let alive = true
    listChatModels()
      .then(({ items }) => {
        if (!alive) return
        setModels(items)
        setModelId(items.find((m) => m.default)?.id ?? items[0]?.id ?? 0)
      })
      .catch(() => {
        // 模型列表拉不到不该挡住对话:后端会用默认模型兜底。
      })
    return () => {
      alive = false
    }
  }, [])

  // 新内容到达时贴底。
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entries])

  // 卸载时中断进行中的流,避免离开页面后仍在后台跑。
  useEffect(() => () => abortRef.current?.abort(), [])

  const closeMenu = useCallback(() => setOpenMenu(null), [])
  useEffect(() => {
    if (!openMenu) return
    const onDown = (e: MouseEvent) => {
      // 点在选择器区域内不关:mousedown 早于 click 触发,
      // 无差别关闭会让刚点开的菜单立刻消失。
      if (barRef.current?.contains(e.target as Node)) return
      closeMenu()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeMenu()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [openMenu, closeMenu])

  const push = useCallback((e: Entry) => setEntries((prev) => [...prev, e]), [])

  /** 把 SSE 事件翻译成界面条目。 */
  const handleEvent = useCallback(
    (ev: AgentEvent) => {
      switch (ev.type) {
        case 'session':
          sessionRef.current = ev.data.session_id
          break

        case 'thinking':
          if (ev.data.content) push({ kind: 'assistant', text: ev.data.content })
          break

        case 'tool_call': {
          const label = TOOL_LABELS[ev.data.name] ?? ev.data.name
          const text =
            (ev.data.args?.query as string) || (ev.data.args?.topic as string) || (ev.data.args?.url as string) || ''
          push({ kind: 'trace', label, text, running: true })
          break
        }

        case 'tool_result':
          // 把最近一条同名 running 轨迹标记完成,而不是再加一条。
          setEntries((prev) => {
            const next = [...prev]
            for (let i = next.length - 1; i >= 0; i -= 1) {
              const e = next[i]
              if (e.kind === 'trace' && e.running) {
                next[i] = { ...e, running: false }
                break
              }
            }
            return next
          })
          break

        case 'await_input':
          push({
            kind: 'question',
            text: ev.data.question,
            options: ev.data.options ?? [],
          })
          break

        case 'await_confirm':
          push({ kind: 'confirm', call: ev.data })
          break

        case 'generating':
          push({ kind: 'trace', label: '生成视频', text: '已提交，生成中', running: true })
          onGenerated?.({
            callId: ev.data.call_id,
            estimatedCredits: ev.data.estimated_credits,
          })
          break

        case 'done':
          if (ev.data.content) push({ kind: 'assistant', text: ev.data.content })
          break

        case 'error':
          setError(ev.data.message)
          break
      }
    },
    [push, onGenerated],
  )

  /** 统一的流执行入口:管好 running 状态、abort 与错误。 */
  const runStream = useCallback(
    async (fn: (onEvent: (e: AgentEvent) => void, signal: AbortSignal) => Promise<void>) => {
      if (running) return
      setError('')
      setRunning(true)
      const controller = new AbortController()
      abortRef.current = controller
      try {
        await fn(handleEvent, controller.signal)
      } catch (err) {
        if ((err as Error)?.name !== 'AbortError') {
          setError((err as Error)?.message || '请求失败')
        }
      } finally {
        setRunning(false)
        abortRef.current = null
      }
    },
    [running, handleEvent],
  )

  const send = useCallback(
    (text: string) => {
      const message = text.trim()
      if (!message || running) return
      push({ kind: 'user', text: message })
      setInput('')

      void runStream((onEvent, signal) =>
        sessionRef.current
          ? continueSession(
              {
                workspaceId,
                sessionId: sessionRef.current,
                message,
                modelVersionId: modelId || undefined,
              },
              onEvent,
              signal,
            )
          : startSession(
              {
                workspaceId,
                kind,
                message,
                execMode,
                modelVersionId: modelId || undefined,
              },
              onEvent,
              signal,
            ),
      )
    },
    [running, push, runStream, workspaceId, kind, execMode, modelId],
  )

  /** 确认或取消一次待定的生成。confirm=true 才会真正提交扣费。 */
  const settleConfirm = useCallback(
    (callId: string, confirm: boolean) => {
      if (running) return
      setEntries((prev) =>
        prev.map((e) =>
          e.kind === 'confirm' && e.call.call_id === callId ? { ...e, settled: confirm ? 'done' : 'cancelled' } : e,
        ),
      )
      void runStream((onEvent, signal) =>
        continueSession(
          {
            workspaceId,
            sessionId: sessionRef.current,
            confirm,
            cancel: !confirm,
          },
          onEvent,
          signal,
        ),
      )
    },
    [running, runStream, workspaceId],
  )

  /** 回答 Agent 的提问。 */
  const answer = useCallback(
    (text: string) => {
      setEntries((prev) => prev.map((e) => (e.kind === 'question' && !e.answered ? { ...e, answered: true } : e)))
      send(text)
    },
    [send],
  )

  const currentModel = useMemo(() => models.find((m) => m.id === modelId), [models, modelId])
  const currentMode = EXEC_MODES.find((m) => m.value === execMode) ?? EXEC_MODES[0]
  const empty = entries.length === 0

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>{title}</span>
        {onCollapse && (
          <button className={styles.iconBtn} onClick={onCollapse} aria-label="收起对话">
            <CollapseIcon />
          </button>
        )}
      </div>

      <div className={styles.scroll} ref={scrollRef}>
        {empty ? (
          <div className={styles.greeting}>
            <div className={styles.greetingHi}>Hi，</div>
            <div className={styles.greetingAsk}>今天一起创作点什么？</div>
          </div>
        ) : (
          entries.map((entry, i) => <EntryView key={i} entry={entry} onAnswer={answer} onSettle={settleConfirm} />)
        )}
      </div>

      {running && (
        <div className={styles.statusBar}>
          <span className={styles.dot} />
          Agent 正在思考…
        </div>
      )}
      {error && <div className={styles.errorBar}>{error}</div>}

      {empty && !running && (
        <div className={styles.suggestions}>
          {SUGGESTIONS.map((s) => (
            <button key={s} className={styles.suggestion} onClick={() => send(s)}>
              <SparkIcon />
              {s}
            </button>
          ))}
        </div>
      )}

      <div className={`${styles.composer} ${focused ? styles.composerFocused : ''}`}>
        <textarea
          ref={textareaRef}
          className={styles.textarea}
          rows={2}
          value={input}
          placeholder="随心输入"
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            // Enter 发送，Shift+Enter 换行。
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send(input)
            }
          }}
        />

        <div className={styles.composerBar} ref={barRef}>
          <div className={styles.menuWrap}>
            <button
              className={`${styles.pickerBtn} ${openMenu === 'mode' ? styles.pickerBtnActive : ''}`}
              onClick={() => setOpenMenu(openMenu === 'mode' ? null : 'mode')}
              title={currentMode.desc}
            >
              {execMode === 'manual' ? <HandIcon /> : <AutoIcon />}
            </button>
            {openMenu === 'mode' && (
              <div className={styles.menu}>
                {EXEC_MODES.map((m) => (
                  <button
                    key={m.value}
                    className={styles.menuItem}
                    onClick={() => {
                      setExecMode(m.value)
                      closeMenu()
                    }}
                  >
                    <span className={styles.menuItemIcon}>{m.value === 'manual' ? <HandIcon /> : <AutoIcon />}</span>
                    <span className={styles.menuItemBody}>
                      <span className={styles.menuItemTitle}>{m.title}</span>
                      <span className={styles.menuItemDesc}>{m.desc}</span>
                    </span>
                    {execMode === m.value && (
                      <span className={styles.menuItemCheck}>
                        <CheckIcon />
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className={styles.spacer} />

          <div className={styles.menuWrap}>
            <button
              className={`${styles.pickerBtn} ${openMenu === 'model' ? styles.pickerBtnActive : ''}`}
              onClick={() => setOpenMenu(openMenu === 'model' ? null : 'model')}
            >
              <span className={styles.pickerLabel}>{currentModel?.display_name ?? '默认模型'}</span>
              <ChevronIcon />
            </button>
            {openMenu === 'model' && (
              <div className={`${styles.menu} ${styles.menuRight}`}>
                {models.length === 0 ? (
                  <div className={styles.menuEmpty}>暂无可选模型</div>
                ) : (
                  models.map((m) => (
                    <button
                      key={m.id}
                      className={styles.menuItem}
                      onClick={() => {
                        setModelId(m.id)
                        closeMenu()
                      }}
                    >
                      <span className={styles.menuItemBody}>
                        <span className={styles.menuItemTitle}>{m.display_name}</span>
                        <span className={styles.menuItemDesc}>{m.provider}</span>
                      </span>
                      {modelId === m.id && (
                        <span className={styles.menuItemCheck}>
                          <CheckIcon />
                        </span>
                      )}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <button
            className={styles.sendBtn}
            disabled={!input.trim() || running}
            onClick={() => send(input)}
            aria-label="发送"
          >
            <ArrowUpIcon />
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── 条目渲染 ───────────────────────────────────────────── */

function EntryView({
  entry,
  onAnswer,
  onSettle,
}: {
  entry: Entry
  onAnswer: (text: string) => void
  onSettle: (callId: string, confirm: boolean) => void
}) {
  if (entry.kind === 'user') return <div className={styles.bubbleUser}>{entry.text}</div>
  if (entry.kind === 'assistant') return <div className={styles.bubbleAssistant}>{entry.text}</div>

  if (entry.kind === 'trace') {
    return (
      <div className={`${styles.trace} ${entry.running ? styles.traceRunning : ''}`}>
        <span className={styles.traceLabel}>{entry.label}</span>
        {entry.text && <span className={styles.traceText}>{entry.text}</span>}
      </div>
    )
  }

  if (entry.kind === 'question') {
    return (
      <div className={styles.questionCard}>
        <div className={styles.questionText}>{entry.text}</div>
        {!entry.answered && entry.options.length > 0 && (
          <div className={styles.optionList}>
            {entry.options.map((opt) => (
              <button key={opt} className={styles.optionBtn} onClick={() => onAnswer(opt)}>
                {opt}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  const { call, settled } = entry
  return (
    <div className={styles.confirmCard}>
      <div className={styles.confirmTitle}>确认生成视频</div>
      {PARAM_LABELS.map(([key, label]) =>
        call.args[key] == null ? null : (
          <div key={key} className={styles.confirmRow}>
            <span>{label}</span>
            <span>{String(call.args[key])}</span>
          </div>
        ),
      )}
      {typeof call.args.prompt === 'string' && (
        <div className={styles.confirmRow}>
          <span>提示词</span>
          <span>{call.args.prompt}</span>
        </div>
      )}
      <div className={styles.confirmCredits}>
        预计消耗 <span className={styles.confirmCreditsValue}>{call.estimated_credits}</span> 积分
      </div>
      {settled ? (
        <div className={styles.confirmCredits}>{settled === 'done' ? '已确认执行' : '已取消'}</div>
      ) : (
        <div className={styles.confirmActions}>
          <button className={styles.btnGhost} onClick={() => onSettle(call.call_id, false)}>
            取消
          </button>
          <button className={styles.btnPrimary} onClick={() => onSettle(call.call_id, true)}>
            确认生成
          </button>
        </div>
      )}
    </div>
  )
}

/* ── 图标 ───────────────────────────────────────────────── */

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

function CollapseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" {...stroke}>
      <path d="M9.5 2.5v11M3 6l2.5 2L3 10" />
    </svg>
  )
}

function ChevronIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" {...stroke}>
      <path d="M4 6.5L8 10.5l4-4" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" {...stroke}>
      <path d="M3 8.5l3.5 3.5L13 5" />
    </svg>
  )
}

function ArrowUpIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" {...stroke}>
      <path d="M8 12.5v-9M4 7.5L8 3.5l4 4" />
    </svg>
  )
}

function HandIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" {...stroke}>
      <path d="M5 7V3.8a1 1 0 112 0V7m0 0V3a1 1 0 112 0v4m0 0V4.3a1 1 0 112 0V9m-6-.5v3.2a2.5 2.5 0 002.5 2.5h1.2a3 3 0 003-3V7.5" />
    </svg>
  )
}

function AutoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" {...stroke}>
      <path d="M13.5 8a5.5 5.5 0 11-1.8-4.1M13.5 2v3h-3" />
    </svg>
  )
}

function SparkIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" {...stroke}>
      <path d="M8 2.5l1.4 3.6L13 7.5l-3.6 1.4L8 12.5l-1.4-3.6L3 7.5l3.6-1.4z" />
    </svg>
  )
}
