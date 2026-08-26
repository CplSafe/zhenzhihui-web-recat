/**
 * AgentChatPanel —— 独立的智能体对话组件。
 *
 * 不依赖画布或任何具体页面:传 workspaceId 即可用,画布、创意页、独立页面都能挂。
 * 与宿主的联系只有可选回调(onCollapse / onOpenHistory / onGenerated)和 headerExtra 插槽。
 *
 * 交互要点:
 *  - SSE 单向流,无法在流内回传输入。「等待确认」不是挂起连接,而是结束当前流,
 *    用户表态后用 continueSession 续跑,中间状态由后端落库(关页面也不丢)。
 *  - 生成前的确认闸门是钱包安全的最后一道:手动模式下必须用户点确认才提交扣费,
 *    只带 message 的追问("能不能改成10秒")绝不当作确认。
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  continueSession,
  describeGeneration,
  getSession,
  listArtifacts,
  listChatModels,
  listSessions,
  setExecMode as setExecModeApi,
  startSession,
  type AgentChatModel,
  type AgentEvent,
  type AgentExecMode,
  type AgentKind,
  type AgentMessage,
  type AgentArtifactStatus,
  type AgentPendingCall,
  type AgentRunStats,
  type AgentPendingField,
  type AgentSession,
} from '@/api/agent'
import { uploadAssetFile } from '@/api/business'
import Markdown from '@/components/common/Markdown'
import { useSpeechInput } from '@/composables/useSpeechInput'
import styles from './AgentChatPanel.module.css'

/** 会话内渲染的一条内容。工具轨迹与对话消息同列展示,靠样式区分权重。 */
/**
 * 稳定的列表 key。
 *
 * 直接用下标做 key 时,status 条目进出、或流式追加导致列表长度变化,
 * React 会认为下标之后的每一条都变了,整片重新挂载——长对话里既慢又会
 * 让已展开的确认卡片状态丢失。这里按内容特征生成,同一条消息跨渲染保持一致。
 */
function entryKey(entry: Entry, index: number): string {
  switch (entry.kind) {
    // 确认卡片有服务端给的唯一 id,最稳。
    case 'confirm':
      return `confirm-${entry.call.call_id}`
    case 'generation':
      return `gen-${entry.callId}`
    // status 全局只有一条,固定 key 免得它进出时影响别人。
    case 'status':
      return 'status'
    default:
      return `${entry.kind}-${index}`
  }
}

type Entry =
  | { kind: 'user'; text: string; images?: string[] }
  | { kind: 'assistant'; text: string }
  // 模型在调工具前输出的中间文字。默认折叠:它是推理过程不是结论,
  // 平铺出来会把真正的答案淹没。
  | { kind: 'thinking'; text: string }
  // 行内进度。放在对话流里而不是底部状态条——进度是过程的一部分,
  // 固定在角落会让用户在"看对话"和"看状态"之间来回切换视线。
  | { kind: 'status'; text: string }
  // 只有工具名与次数:搜索词、URL 这些是内部实现细节,对用户没有价值,
  // 露出来既是噪音也是信息泄露。count>1 表示同类连续调用合并。
  | { kind: 'trace'; label: string; running?: boolean; count?: number }
  | { kind: 'question'; text: string; options: string[]; answered?: boolean }
  | { kind: 'confirm'; call: AgentPendingCall; settled?: 'done' | 'cancelled' }
  // 生成结果。像 ChatGPT 生图那样直接长在对话里,而不是浮在顶部的独立面板——
  // 用户看到的顺序就是「我提的要求 → 出的片子」,回溯时不必去别处找。
  // callId 是锚点:轮询回来的产出物按它归属到这一轮。
  | { kind: 'generation'; callId: string; count: number; mediaKind: string }

/** 待发送的附件。上传完成前 url 为空,用本地预览图占位。 */
interface Attachment {
  id: string
  name: string
  previewUrl: string
  /** 上传成功后的资产 ID。为 0 表示尚未就绪,不能随消息发出。 */
  assetId: number
  uploading: boolean
  error?: string
}

interface AgentChatPanelProps {
  workspaceId: number
  kind?: AgentKind
  /** 面板标题,默认「新建对话」。 */
  title?: string
  /** 问候语里的称呼,如用户昵称。 */
  userName?: string
  /** 快捷提示,不传用默认三条;传空数组则不显示。 */
  suggestions?: string[]
  /** 收起面板。未传则不显示收起按钮。 */
  onCollapse?: () => void
  /** 打开历史会话列表。未传则不显示该按钮。 */
  onOpenHistory?: () => void
  /** 生成任务提交后回调,宿主可据此插入节点或刷新任务列表。 */
  onGenerated?: (info: { callId: string; estimatedCredits: number }) => void
  /** 顶栏额外内容,宿主按需注入(如积分余额、通知)。 */
  headerExtra?: ReactNode
}

const EXEC_MODES: { value: AgentExecMode; title: string; desc: string }[] = [
  { value: 'manual', title: '手动确认', desc: 'Agent 在执行生成前都会寻求您的确认' },
  { value: 'auto', title: '自动生成', desc: 'Agent 会自主规划生成任务并自动执行' },
]

const DEFAULT_SUGGESTIONS = ['分析这个产品的选品价值', '帮我追踪这个品类的热点', '规划下一步怎么创作']

/** 工具名 → 展示标签。未知工具直接显示原名,不隐藏信息。 */
const TOOL_LABELS: Record<string, string> = {
  web_search: '搜索',
  fetch_page: '抓取',
  save_finding: '记录',
  list_findings: '盘点',
  generate_video: '生成视频',
  generate_image: '生成图片',
  update_todo: '规划任务',
  load_skill: '加载技能',
  dispatch_subagents: '并行调研',
}

/** 确认卡片里展示的参数,按这个顺序排;其余参数不展示避免噪音。 */
const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'

/** 生成任务的终态。到达这些状态就不必再轮询。 */
const TERMINAL_STATUS = new Set(['succeeded', 'failed', 'cancelled', 'canceled'])

/** 轮询间隔。视频生成动辄几分钟,3 秒足够及时又不至于打爆接口。 */
const ARTIFACT_POLL_MS = 3000

const STATUS_LABELS: Record<string, string> = {
  idle: '待开始',
  running: '进行中',
  awaiting_confirm: '等待确认',
  completed: '已完成',
  failed: '失败',
}

export default function AgentChatPanel({
  workspaceId,
  kind = 'product_analysis',
  title: initialTitle = '新建对话',
  userName,
  suggestions = DEFAULT_SUGGESTIONS,
  onCollapse,
  onOpenHistory,
  onGenerated,
  headerExtra,
}: AgentChatPanelProps) {
  const [entries, setEntries] = useState<Entry[]>([])
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [focused, setFocused] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [execMode, setExecMode] = useState<AgentExecMode>('manual')
  const [models, setModels] = useState<AgentChatModel[]>([])
  const [modelId, setModelId] = useState<number>(0)
  const [openMenu, setOpenMenu] = useState<'mode' | 'model' | 'plus' | null>(null)
  // 行内状态:替换对话流末尾的 status 条目而不是追加,
  // 否则十几轮下来会积几十条"正在搜索…"把对话挤没。
  const setStatus = useCallback((text: string) => {
    setEntries((prev) => {
      // 先摘掉旧的 status(它可能已被 trace 挤到中间),再追加到末尾。
      // 不这么做的话每次搜索都会留下一条"搜索中…",与紧随其后的
      // trace 内容重复,几轮下来就是满屏噪音。
      const next = prev.filter((e) => e.kind !== 'status')
      return [...next, { kind: 'status', text }]
    })
  }, [])

  /** 流结束时清掉行内状态条——它只在运行中有意义。 */
  const clearStatus = useCallback(() => {
    setEntries((prev) => (prev.length && prev[prev.length - 1].kind === 'status' ? prev.slice(0, -1) : prev))
  }, [])
  // 用量统计。保留上一轮的值:流结束后仍要显示,不能一跑完就清空。
  const [stats, setStats] = useState<AgentRunStats | null>(null)
  const [ctxOpen, setCtxOpen] = useState(false)
  // 生成中的产出物。视频要几分钟,轮询这个把进度显示出来——
  // 没有它用户提交后只看到一句「已提交」,再无下文。
  const [artifacts, setArtifacts] = useState<AgentArtifactStatus[]>([])
  // 对话里已声明的生成总条数。用来判断产出物是否已全部落库——
  // 没到齐就要继续轮询,否则新提交的那批永远不会出现。
  const expectedArtifacts = useMemo(
    () => entries.reduce((n, e) => (e.kind === 'generation' ? n + e.count : n), 0),
    [entries],
  )
  const [historyOpen, setHistoryOpen] = useState(false)
  const [sessions, setSessions] = useState<AgentSession[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [title, setTitle] = useState(initialTitle)

  const sessionRef = useRef<number>(0)
  const abortRef = useRef<AbortController | null>(null)
  // 本轮是否收到过 delta。done 事件据此决定要不要补正文——
  // 支持流式的模型不补(会重复),不支持的必须补(否则没有回复)。
  const streamedRef = useRef(false)
  const speech = useSpeechInput(
    useCallback((text: string) => {
      // 追加而非替换:用户可能先打了一半再改用说的。
      setInput((prev) => (prev ? `${prev}${prev.endsWith(' ') ? '' : ' '}${text}` : text))
    }, []),
  )
  const scrollRef = useRef<HTMLDivElement>(null)
  // 是否跟随到底部。用户往上翻时置 false,避免流式输出把他一次次拽回底部。
  const stickToBottomRef = useRef(true)
  const barRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

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

  // 自动滚动:只在用户本来就贴着底部时才跟随。
  //
  // 原来每次 entries 变化都无条件拉到底,流式输出时用户想往上翻看历史
  // 会被每个字拽回去一次,根本读不了。48px 容差覆盖行高误差。
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48
    if (atBottom || stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [entries])

  // 用户手动往上翻就停止跟随,滚回底部再恢复。
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => {
      stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

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

  /**
   * 追加轨迹。与末尾同类轨迹合并成一条并计数。
   *
   * 用户需要知道的是「Agent 在搜索」,不是搜了什么词——
   * 查询词是内部实现细节,对用户没有价值。
   */
  const pushTrace = useCallback((label: string, running?: boolean) => {
    setEntries((prev) => {
      const rest = prev.filter((x) => x.kind !== 'status')
      const status = prev.find((x) => x.kind === 'status')
      const last = rest[rest.length - 1]
      const next =
        last?.kind === 'trace' && last.label === label
          ? [...rest.slice(0, -1), { ...last, running, count: (last.count ?? 1) + 1 } as Entry]
          : [...rest, { kind: 'trace', label, running } as Entry]
      return status ? [...next, status] : next
    })
  }, [])

  // status 条目永远排在末尾:它表示「正在做什么」,被后续条目盖住就失去意义。
  const push = useCallback((e: Entry) => {
    setEntries((prev) => {
      const idx = prev.findIndex((x) => x.kind === 'status')
      if (idx === -1) return [...prev, e]
      return [...prev.slice(0, idx), ...prev.slice(idx + 1), e, prev[idx]]
    })
  }, [])

  /* ── 附件上传 ─────────────────────────────────────────── */

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const list = Array.from(files).filter((f) => f.type.startsWith('image/'))
      if (list.length === 0) return

      list.forEach((file) => {
        const id = `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`
        const previewUrl = URL.createObjectURL(file)
        setAttachments((prev) => [...prev, { id, name: file.name, previewUrl, assetId: 0, uploading: true }])

        uploadAssetFile({ workspaceId, file, source: 'agent-chat' })
          .then((res: { asset?: { id?: number } }) => {
            const assetId = Number(res?.asset?.id) || 0
            setAttachments((prev) =>
              prev.map((a) =>
                a.id === id
                  ? {
                      ...a,
                      uploading: false,
                      assetId,
                      error: assetId ? undefined : '上传未返回资产 ID',
                    }
                  : a,
              ),
            )
          })
          .catch((err: Error) => {
            setAttachments((prev) =>
              prev.map((a) => (a.id === id ? { ...a, uploading: false, error: err?.message || '上传失败' } : a)),
            )
          })
      })
    },
    [workspaceId],
  )

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const hit = prev.find((a) => a.id === id)
      if (hit) URL.revokeObjectURL(hit.previewUrl)
      return prev.filter((a) => a.id !== id)
    })
  }, [])

  /* ── SSE 事件 → 界面条目 ──────────────────────────────── */

  const handleEvent = useCallback(
    (ev: AgentEvent) => {
      switch (ev.type) {
        case 'session':
          sessionRef.current = ev.data.session_id
          if (ev.data.title) setTitle(ev.data.title)
          break

        case 'turn':
          streamedRef.current = false
          setStatus(
            ev.data.turn === 1
              ? '正在思考…'
              : `正在思考…(第 ${ev.data.turn} 轮 · 已用 ${Math.round(ev.data.tokens / 1000)}k tokens)`,
          )
          break

        case 'stats':
          setStats(ev.data)
          break

        case 'delta':
          // 逐字追加到末尾的 assistant 气泡;没有就新建一个。
          // 这是与 Claude 对话手感一致的关键:文字边生成边出现,
          // 而不是等整轮跑完一次性弹出。
          if (ev.data.text) {
            streamedRef.current = true
            setEntries((prev) => {
              const rest = prev.filter((x) => x.kind !== 'status')
              const status = prev.find((x) => x.kind === 'status')
              const last = rest[rest.length - 1]
              const next: Entry[] =
                last?.kind === 'assistant'
                  ? [...rest.slice(0, -1), { kind: 'assistant', text: last.text + ev.data.text }]
                  : [...rest, { kind: 'assistant', text: ev.data.text }]
              return status ? [...next, status] : next
            })
          }
          break

        case 'thinking':
          if (ev.data.content) push({ kind: 'thinking', text: ev.data.content })
          break

        case 'tool_call': {
          const label = TOOL_LABELS[ev.data.name] ?? ev.data.name
          setStatus(`${label}中…`)
          pushTrace(label, true)
          break
        }

        case 'tool_result':
          // 把最近一条 running 轨迹标记完成,而不是再加一条。
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
          push({ kind: 'question', text: ev.data.question, options: ev.data.options ?? [] })
          break

        case 'await_confirm':
          push({ kind: 'confirm', call: ev.data })
          break

        case 'subagent': {
          const d = ev.data
          if (d.stage === 'start') {
            setStatus(`正在并行调研 ${d.topics?.length ?? 0} 个方向…`)
            push({ kind: 'trace', label: '并行调研', running: true })
          } else if (d.stage === 'tool') {
            setStatus('调研搜索中…')
            pushTrace('调研搜索', true)
          } else if (d.stage === 'done') {
            // 标完成而不是再加一条:否则几十条轨迹会把对话淹没。
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
            setStatus(`调研进度 ${d.finished}/${d.total}…`)
            if (d.finished === d.total) {
              push({ kind: 'trace', label: '调研完成' })
              setStatus('正在汇总调研结果…')
            }
          }
          break
        }

        case 'compaction':
          setStatus('正在压缩上下文…')
          if (ev.data.stage === 'summarize' && ev.data.replaced) {
            push({ kind: 'trace', label: '上下文压缩' })
          }
          break

        case 'generating': {
          const kind = ev.data.kind === 'image' ? 'image' : 'video'
          const count = Math.max(1, Number(ev.data.count) || 1)
          setStatus(kind === 'image' ? '正在提交图片生成…' : '正在提交视频生成…')
          // 提交成功后立刻开始轮询,不等下一次自然触发。
          setPollGen((n) => n + 1)
          // 占位骨架由 GenerationGroup 按 count 渲染,这里只声明「这一轮生成了几条」。
          push({ kind: 'generation', callId: ev.data.call_id, count, mediaKind: kind })
          onGenerated?.({
            callId: ev.data.call_id,
            estimatedCredits: ev.data.estimated_credits,
          })
          break
        }

        case 'done':
          // 流式下正文已由 delta 逐字铺好,再 push 会出现两份。
          // 用显式标记而非文本比对:模型可能正好输出与增量相同的内容,
          // 比对相等就漏掉了该补的那一份。
          if (ev.data.content && !streamedRef.current) {
            push({ kind: 'assistant', text: ev.data.content })
          }
          streamedRef.current = false
          break

        case 'error':
          setError(ev.data.message)
          break
      }
    },
    [push, pushTrace, setStatus, onGenerated],
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
        clearStatus()
        abortRef.current = null
      }
    },
    [running, handleEvent, clearStatus],
  )

  const uploading = attachments.some((a) => a.uploading)
  // 有附件时必须至少一张就绪:否则发出去的是一条"看不见图"的消息,
  // 模型会答非所问(它只看到文字),用户却以为图已送达。
  const attachmentsReady = attachments.length === 0 || attachments.some((a) => a.assetId > 0)
  const canSend = (input.trim().length > 0 || attachments.length > 0) && !running && !uploading && attachmentsReady

  const send = useCallback(
    (text: string) => {
      const message = text.trim()
      if (running || uploading) return

      const assetIds = attachments.map((a) => a.assetId).filter((id) => id > 0)
      // 有附件但一个都没就绪:静默丢弃会让用户以为图发出去了,
      // 而模型那边根本没收到——必须显式拦下并说明原因。
      if (attachments.length > 0 && assetIds.length === 0) {
        setError('图片上传失败，请移除后重试；或先删掉图片只发文字。')
        return
      }
      if (!message && assetIds.length === 0) return

      push({ kind: 'user', text: message, images: attachments.map((a) => a.previewUrl) })
      setInput('')
      // 预览 URL 交给已发出的消息继续引用,这里不 revoke,否则气泡里的图会裂。
      setAttachments([])

      void runStream((onEvent, signal) =>
        sessionRef.current
          ? continueSession(
              {
                workspaceId,
                sessionId: sessionRef.current,
                message,
                assetIds,
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
                assetIds,
                execMode,
                modelVersionId: modelId || undefined,
              },
              onEvent,
              signal,
            ),
      )
    },
    [attachments, running, uploading, push, runStream, workspaceId, kind, execMode, modelId],
  )

  /** 确认或取消一次待定的生成。confirm=true 才会真正提交扣费。 */
  const settleConfirm = useCallback(
    (callId: string, confirm: boolean, confirmedArgs?: Record<string, unknown>) => {
      // 上一轮流还没结束时点确认会被静默丢弃——用户点了没反应,
      // 只会以为按钮坏了。给出明确提示而不是无声 return。
      if (running) {
        setError('上一步还在进行中，请等它结束后再确认。')
        return
      }
      setEntries((prev) =>
        prev.map((e) =>
          e.kind === 'confirm' && e.call.call_id === callId ? { ...e, settled: confirm ? 'done' : 'cancelled' } : e,
        ),
      )
      void runStream((onEvent, signal) =>
        continueSession(
          { workspaceId, sessionId: sessionRef.current, confirm, cancel: !confirm, confirmedArgs },
          onEvent,
          signal,
        ),
      )
    },
    [running, runStream, workspaceId],
  )

  const answer = useCallback(
    (text: string) => {
      setEntries((prev) => prev.map((e) => (e.kind === 'question' && !e.answered ? { ...e, answered: true } : e)))
      send(text)
    },
    [send],
  )

  /**
   * 轮询生成进度,直到所有任务都到终态。
   *
   * 视频生成要几分钟。不轮询的话用户提交后只看到「已提交」——
   * 既不知道还要等多久,也拿不到最终的视频。
   *
   * 只在有未完成任务时继续:全部完成后停掉定时器,避免空转打接口。
   */
  // pollGen 递增即触发一次重新拉取。用它而不是把 artifacts 放进依赖:
  // 后者会让每次轮询结果都重建定时器,间隔失去意义。
  const [pollGen, setPollGen] = useState(0)
  const hasPending = artifacts.some((a) => !TERMINAL_STATUS.has(a.status))

  useEffect(() => {
    const sid = sessionRef.current
    if (!sid) return
    // 已全部完成就不再轮询,避免空转打接口。
    //
    // 但有占位卡时必须继续轮:第二次生成时 artifacts 里还是上一批(全是终态),
    // 只看 hasPending 会直接 return,新视频永远不会出现在列表里。
    // 产出物已到齐且全是终态才停轮询。
    //
    // 只看 hasPending 不够:第二次生成时 artifacts 里还是上一批(全终态),
    // 会直接 return,新提交的那批永远不出现。用「声明了几条」兜住这个缺口。
    if (artifacts.length >= expectedArtifacts && artifacts.length > 0 && !hasPending) return

    let cancelled = false
    const tick = () => {
      listArtifacts(sid, workspaceId)
        .then(({ items }) => {
          if (cancelled) return
          setArtifacts(items)
        })
        .catch(() => {
          // 轮询失败静默重试:网络抖动不该在对话里弹错误,
          // 下一次 tick 会自己恢复。
        })
    }
    tick()
    const timer = window.setInterval(tick, ARTIFACT_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
    // 依赖只放「是否还需要轮询」与触发信号,不放 artifacts 本身:
    // 放进去会让每次轮询结果都重建定时器,间隔失去意义。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, hasPending, pollGen, expectedArtifacts])

  /** 打开历史列表并拉取。每次打开都重拉:会话在别处也可能新增。 */
  const openHistory = useCallback(() => {
    setHistoryOpen(true)
    setHistoryLoading(true)
    listSessions(workspaceId, kind)
      .then(({ items }) => setSessions(items))
      .catch((err: Error) => setError(err?.message || '加载历史对话失败'))
      .finally(() => setHistoryLoading(false))
  }, [workspaceId, kind])

  /** 载入一个历史会话:把库里的消息还原成界面条目。 */
  const loadSession = useCallback(
    (id: number) => {
      if (running) return
      setHistoryOpen(false)
      setError('')
      getSession(id, workspaceId)
        .then(({ session, messages }) => {
          abortRef.current?.abort()
          sessionRef.current = session.id
          // 换会话必须清掉上一个会话的产出物与占位卡,
          // 否则上一条对话的「生成中」会跟着显示到这条对话里。
          setArtifacts([])
          setTitle(session.title || '历史对话')
          setExecMode(session.exec_mode)
          if (session.model_version_id) setModelId(session.model_version_id)
          setEntries(restoreEntries(messages))
          setAttachments([])
          setInput('')
        })
        .catch((err: Error) => setError(err?.message || '载入会话失败'))
    },
    [running, workspaceId],
  )

  /** 切换执行模式。已有会话要同步到后端,否则续跑仍按旧模式判断闸门。 */
  const switchExecMode = useCallback(
    (mode: AgentExecMode) => {
      setExecMode(mode)
      closeMenu()
      if (sessionRef.current) {
        void setExecModeApi(sessionRef.current, workspaceId, mode).catch((err: Error) =>
          setError(err?.message || '切换模式失败'),
        )
      }
    },
    [closeMenu, workspaceId],
  )

  /** 开新对话:清空本地状态,下次发送会重新建会话。 */
  const newChat = useCallback(() => {
    abortRef.current?.abort()
    sessionRef.current = 0
    setArtifacts([])
    setEntries([])
    setAttachments([])
    setInput('')
    setError('')
    setTitle(initialTitle)
  }, [initialTitle])

  const currentModel = useMemo(() => models.find((m) => m.id === modelId), [models, modelId])
  const currentMode = EXEC_MODES.find((m) => m.value === execMode) ?? EXEC_MODES[0]
  const empty = entries.length === 0

  return (
    <div
      className={styles.panel}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files)
      }}
    >
      <div className={styles.header}>
        <button
          className={styles.iconBtn}
          onClick={() => {
            onOpenHistory?.()
            openHistory()
          }}
          title="历史对话"
        >
          <ListIcon />
        </button>
        <span className={styles.title}>{title}</span>
        <div className={styles.headerActions}>
          {headerExtra}
          <button className={styles.iconBtn} onClick={newChat} title="新建对话">
            <NewChatIcon />
          </button>
          {onCollapse && (
            <button className={styles.iconBtn} onClick={onCollapse} title="收起对话">
              <CollapseIcon />
            </button>
          )}
        </div>
      </div>

      {historyOpen && (
        <div className={styles.historyPanel}>
          <div className={styles.historyHeader}>
            <span>历史对话</span>
            <button className={styles.iconBtn} onClick={() => setHistoryOpen(false)} title="关闭">
              <CloseIcon />
            </button>
          </div>
          <div className={styles.historyList}>
            {historyLoading ? (
              <div className={styles.historyEmpty}>加载中…</div>
            ) : sessions.length === 0 ? (
              <div className={styles.historyEmpty}>还没有历史对话</div>
            ) : (
              sessions.map((sess) => (
                <button
                  key={sess.id}
                  className={styles.historyItem}
                  onClick={() => loadSession(sess.id)}
                  disabled={running}
                >
                  <span className={styles.historyItemTitle}>{sess.title || `会话 #${sess.id}`}</span>
                  <span className={styles.historyItemMeta}>
                    {STATUS_LABELS[sess.status] ?? sess.status}
                    {sess.spent_credits > 0 ? ` · ${sess.spent_credits} 积分` : ''}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      <div className={styles.scroll} ref={scrollRef}>
        {empty ? (
          <div className={styles.greeting}>
            <div className={styles.greetingHi}>Hi{userName ? ` ${userName}` : ''}!</div>
            <div className={styles.greetingAsk}>今天一起创作点什么？</div>
          </div>
        ) : (
          entries.map((entry, i) => (
            <EntryView
              key={entryKey(entry, i)}
              entry={entry}
              busy={running}
              workspaceId={workspaceId}
              artifacts={artifacts}
              onAnswer={answer}
              onSettle={settleConfirm}
            />
          ))
        )}
      </div>

      {error && <div className={styles.errorBar}>{error}</div>}

      {empty && !running && suggestions.length > 0 && (
        <div className={styles.suggestions}>
          {suggestions.map((s) => (
            <button key={s} className={styles.suggestion} onClick={() => send(s)}>
              <SparkIcon />
              {s}
            </button>
          ))}
        </div>
      )}

      <div className={`${styles.composer} ${focused ? styles.composerFocused : ''}`}>
        {attachments.length > 0 && (
          <div className={styles.attachments}>
            {attachments.map((a) => (
              <div
                key={a.id}
                className={`${styles.thumb} ${a.error ? styles.thumbError : ''}`}
                title={a.error || a.name}
              >
                <img src={a.previewUrl} alt={a.name} />
                {a.uploading && <span className={styles.thumbMask}>上传中</span>}
                {a.error && <span className={styles.thumbMask}>失败</span>}
                <button className={styles.thumbRemove} onClick={() => removeAttachment(a.id)} aria-label="移除附件">
                  <CloseIcon />
                </button>
              </div>
            ))}
          </div>
        )}

        <textarea
          className={styles.textarea}
          rows={2}
          value={input}
          placeholder="随心输入"
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files)
            if (files.length) {
              e.preventDefault()
              addFiles(files)
            }
          }}
          onKeyDown={(e) => {
            // Enter 发送，Shift+Enter 换行。
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              if (canSend) send(input)
            }
          }}
        />

        {/* 中间结果与错误:说话时要能看到「听到了什么」,
            否则用户不知道该继续说还是重说。 */}
        {speech.listening && (
          <div className={styles.speechHint}>
            <span className={styles.speechDot} />
            {speech.interim || '正在聆听…'}
          </div>
        )}
        {speech.error && (
          <div className={styles.speechError} onClick={speech.clearError}>
            {speech.error}
          </div>
        )}

        <div className={styles.composerBar} ref={barRef}>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files)
              e.target.value = ''
            }}
          />

          <div className={styles.menuWrap}>
            <button
              className={`${styles.pickerBtn} ${openMenu === 'plus' ? styles.pickerBtnActive : ''}`}
              onClick={() => setOpenMenu(openMenu === 'plus' ? null : 'plus')}
              title="添加内容"
            >
              <PlusIcon />
            </button>
            {openMenu === 'plus' && (
              <div className={styles.menu}>
                <button
                  className={styles.menuItem}
                  onClick={() => {
                    fileRef.current?.click()
                    closeMenu()
                  }}
                >
                  <span className={styles.menuItemIcon}>
                    <ClipIcon />
                  </span>
                  <span className={styles.menuItemBody}>
                    <span className={styles.menuItemTitle}>上传附件</span>
                    <span className={styles.menuItemDesc}>支持图片，也可直接拖入或粘贴</span>
                  </span>
                </button>
              </div>
            )}
          </div>

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
                  <button key={m.value} className={styles.menuItem} onClick={() => switchExecMode(m.value)}>
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

          {speech.supported && (
            <button
              className={`${styles.pickerBtn} ${speech.listening ? styles.micActive : ''}`}
              onClick={speech.toggle}
              title={speech.listening ? '停止语音输入' : '语音输入'}
              aria-label={speech.listening ? '停止语音输入' : '语音输入'}
              aria-pressed={speech.listening}
            >
              <MicIcon />
            </button>
          )}

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

          <button className={styles.sendBtn} disabled={!canSend} onClick={() => send(input)} aria-label="发送">
            <ArrowUpIcon />
          </button>
        </div>

        {stats && <StatsBar stats={stats} open={ctxOpen} onToggle={() => setCtxOpen((v) => !v)} />}
      </div>
    </div>
  )
}

function ArtifactCard({ item }: { item: AgentArtifactStatus }) {
  const url = item.assets?.[0]
  const failed = item.status === 'failed'
  const running = !TERMINAL_STATUS.has(item.status)

  return (
    <div className={styles.artifactCard}>
      <div className={styles.artifactThumb}>
        {url ? (
          item.kind === 'video' ? (
            // 给 poster 留空:视频首帧由浏览器解码,比额外拉一张缩略图快。
            <video className={styles.artifactMedia} src={url} controls preload="metadata" />
          ) : (
            <img className={styles.artifactMedia} src={url} alt={item.title} />
          )
        ) : (
          <div className={`${styles.artifactPlaceholder} ${running ? styles.artifactPulse : ''}`}>
            {failed ? '生成失败' : running ? '生成中' : '等待中'}
          </div>
        )}
      </div>
      <div className={styles.artifactMeta}>
        <span className={styles.artifactTitle}>{item.title}</span>
        <span className={`${styles.artifactStatus} ${failed ? styles.artifactStatusFailed : ''}`}>
          {failed ? item.error_message || '生成失败' : ARTIFACT_STATUS_LABELS[item.status] || item.status}
        </span>
      </div>
    </div>
  )
}

const ARTIFACT_STATUS_LABELS: Record<string, string> = {
  queued: '排队中',
  submitting: '提交中',
  running: '生成中',
  processing: '生成中',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
  canceled: '已取消',
}

/**
 * 输入框底部的用量与耗时统计。
 *
 * 放在底部而不是浮在对话流里:它是整轮的汇总,不属于任何一条消息;
 * 而且用户多数时候不看它,占据对话区不划算。
 */
function StatsBar({ stats, open, onToggle }: { stats: AgentRunStats; open: boolean; onToggle: () => void }) {
  const used = stats.context_system + stats.context_tools + stats.context_messages
  const pct = stats.context_limit > 0 ? Math.round((used / stats.context_limit) * 100) : 0
  // 缓存命中率按输入 token 算:缓存只作用于重复前缀(system + 工具 + 历史)。
  const cacheRate = stats.input_tokens > 0 ? Math.round((stats.cached_tokens / stats.input_tokens) * 100) : 0

  return (
    <div className={styles.statsBar}>
      <span>
        {stats.turns} 轮 · {stats.steps} 步
      </span>
      <span className={styles.statsDot}>|</span>
      <span>
        LLM {fmtSec(stats.llm_ms)} · 工具 {fmtSec(stats.tool_ms)}
      </span>
      {stats.cached_tokens > 0 && (
        <>
          <span className={styles.statsDot}>|</span>
          <span>缓存命中 {cacheRate}%</span>
        </>
      )}
      <span className={styles.statsDot}>|</span>
      <span>
        输入 {fmtTok(stats.input_tokens)} · 输出 {fmtTok(stats.output_tokens)}
      </span>

      <button className={styles.statsCtxBtn} onClick={onToggle} title="上下文占用明细">
        上下文 {pct}%
      </button>

      {open && (
        <div className={styles.ctxPopover}>
          <div className={styles.ctxHeader}>
            <span>上下文已用 {pct}%</span>
            <span className={styles.ctxTotal}>
              ~{fmtTok(used)} / {fmtTok(stats.context_limit)}
            </span>
          </div>
          <div className={styles.ctxTrack}>
            <span
              className={`${styles.ctxSeg} ${styles.ctxSegSystem}`}
              style={{ width: `${segPct(stats.context_system, stats.context_limit)}%` }}
            />
            <span
              className={`${styles.ctxSeg} ${styles.ctxSegTools}`}
              style={{ width: `${segPct(stats.context_tools, stats.context_limit)}%` }}
            />
            <span
              className={`${styles.ctxSeg} ${styles.ctxSegMsgs}`}
              style={{ width: `${segPct(stats.context_messages, stats.context_limit)}%` }}
            />
          </div>
          <CtxRow color={styles.ctxDotSystem} label="系统提示词" value={stats.context_system} />
          <CtxRow color={styles.ctxDotTools} label="工具" value={stats.context_tools} />
          <CtxRow color={styles.ctxDotMsgs} label="对话消息" value={stats.context_messages} />
        </div>
      )}
    </div>
  )
}

function CtxRow({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className={styles.ctxRow}>
      <span className={`${styles.ctxDot} ${color}`} />
      <span className={styles.ctxLabel}>{label}</span>
      <span className={styles.ctxValue}>~{fmtTok(value)}</span>
    </div>
  )
}

/** 毫秒转秒,保留一位小数——统计栏里 34.3s 比 34300ms 好读。 */
function fmtSec(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

/** token 数转 K,小于 1000 时直接显示原值。 */
function fmtTok(n: number): string {
  if (n < 1000) return String(n)
  return `${(n / 1000).toFixed(1)}K`
}

/** 单段占总量的百分比,用于上下文进度条。 */
function segPct(value: number, limit: number): number {
  if (limit <= 0) return 0
  return Math.min(100, (value / limit) * 100)
}

/**
 * 把持久化的消息还原成界面条目。
 *
 * system 消息不显示(是行为约束不是对话);tool 消息还原成轨迹而非正文——
 * 工具结果动辄上万字,原样铺开会把历史对话变成搜索日志。
 */
function restoreEntries(messages: AgentMessage[]): Entry[] {
  const out: Entry[] = []
  for (const m of messages) {
    if (m.role === 'system') continue

    if (m.role === 'user') {
      // 压缩摘要与工具占位是内部机制,不该出现在用户看到的历史里。
      if (m.content.startsWith('[以下是此前对话的摘要]') || m.content.startsWith('[当前任务清单]')) {
        continue
      }
      if (m.content.trim()) out.push({ kind: 'user', text: m.content })
      continue
    }

    if (m.role === 'assistant') {
      if (m.content.trim()) out.push({ kind: 'assistant', text: m.content })
      // tool_calls 还原成轨迹,让用户看到 Agent 当时做了什么。
      const calls = Array.isArray(m.tool_calls) ? m.tool_calls : []
      for (const raw of calls) {
        const call = raw as { function?: { name?: string; arguments?: string } }
        const name = call?.function?.name
        if (!name) continue
        const label = TOOL_LABELS[name] ?? name
        const last = out[out.length - 1]
        // 与实时渲染同一套合并规则,否则历史看起来比当时更啰嗦。
        if (last?.kind === 'trace' && last.label === label) {
          out[out.length - 1] = { ...last, count: (last.count ?? 1) + 1 }
        } else {
          out.push({ kind: 'trace', label })
        }
      }
      continue
    }
    // role === 'tool':结果本身不展示,轨迹已由上面的 tool_calls 表达。
  }
  return out
}

/**
 * 模型的中间思考,默认折叠。
 *
 * 这些文字是推理过程("我先查供货价,再对比竞品…"),不是给用户的结论。
 * 平铺出来会让真正的答案淹没在过程里;完全隐藏又失去了可解释性,
 * 所以折叠——想看的人点开,不想看的人只读最终正文。
 */
function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const preview = text.length > 40 ? `${text.slice(0, 40)}…` : text

  return (
    <div className={styles.thinking}>
      <button className={styles.thinkingToggle} onClick={() => setOpen((v) => !v)}>
        <span className={`${styles.thinkingCaret} ${open ? styles.thinkingCaretOpen : ''}`}>›</span>
        <span className={styles.thinkingLabel}>思考</span>
        {!open && <span className={styles.thinkingPreview}>{preview}</span>}
      </button>
      {open && (
        <div className={styles.thinkingBody}>
          <Markdown>{text}</Markdown>
        </div>
      )}
    </div>
  )
}

/* ── 条目渲染 ───────────────────────────────────────────── */

/**
 * 单条消息。用 memo 包住:流式逐字追加时每个字都触发一次 setEntries，
 * 不记忆化的话整个列表每来一个字就全量重渲染一遍——长对话里这是卡顿主因。
 *
 * busy 只影响待确认/待回答那两种条目，其余条目不该因为 busy 变化而重渲染，
 * 所以在比较函数里按 kind 区分对待。
 */
const EntryView = memo(function EntryView({
  entry,
  onAnswer,
  busy,
  workspaceId,
  onSettle,
  artifacts,
}: {
  entry: Entry
  busy: boolean
  workspaceId: number
  onAnswer: (text: string) => void
  onSettle: (callId: string, confirm: boolean, args?: Record<string, unknown>) => void
  /** 实时产出物,供 generation 条目渲染进度与结果。 */
  artifacts: AgentArtifactStatus[]
}) {
  if (entry.kind === 'user') {
    return (
      <div className={styles.userGroup}>
        {entry.images && entry.images.length > 0 && (
          <div className={styles.userImages}>
            {entry.images.map((src) => (
              <img key={src} src={src} alt="" />
            ))}
          </div>
        )}
        {entry.text && <div className={styles.bubbleUser}>{entry.text}</div>}
      </div>
    )
  }
  if (entry.kind === 'assistant') {
    // 模型输出的是 Markdown(加粗/表格/列表/分级标题),纯文本渲染会把
    // **卖点** 这类标记原样显示。用项目现成的 Markdown 组件——
    // 不引 streamdown:它会把 shiki + mermaid 全打包进来(数 MB),
    // 而选品报告只需要 GFM 文本能力(见 common/Markdown.tsx 的说明)。
    return (
      <div className={`${styles.bubbleAssistant} ${styles.markdown}`}>
        <Markdown>{entry.text}</Markdown>
      </div>
    )
  }

  if (entry.kind === 'status') {
    return (
      <div className={styles.statusInline}>
        <span className={styles.dot} />
        {entry.text}
      </div>
    )
  }

  if (entry.kind === 'thinking') {
    return <ThinkingBlock text={entry.text} />
  }

  if (entry.kind === 'trace') {
    return (
      <div className={`${styles.trace} ${entry.running ? styles.traceRunning : ''}`}>
        <span className={styles.traceLabel}>{entry.label}</span>
        {entry.count && entry.count > 1 && <span className={styles.traceCount}>×{entry.count}</span>}
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

  if (entry.kind === 'generation') {
    return <GenerationGroup entry={entry} artifacts={artifacts} />
  }

  return <ConfirmCard entry={entry} busy={busy} workspaceId={workspaceId} onSettle={onSettle} />
})

/**
 * 对话内的生成结果组。像 ChatGPT 生图那样:先出占位骨架,任务跑完就地换成成片。
 *
 * 产出物按会话维度轮询回来,这里按声明的条数取对应的几条。后端目前不回传
 * call_id 归属,所以用「按顺序取前 count 条尚未被占用的」近似——单轮生成
 * 场景下等价,多轮时最坏是显示顺序不同,不会串台或丢失。
 */
function GenerationGroup({
  entry,
  artifacts,
}: {
  entry: Extract<Entry, { kind: 'generation' }>
  artifacts: AgentArtifactStatus[]
}) {
  const mine = artifacts.filter((a) => a.kind === entry.mediaKind).slice(0, entry.count)
  const done = mine.filter((a) => TERMINAL_STATUS.has(a.status)).length
  // 产出物还没落库时先摆骨架,数量按用户选的条数——
  // 空窗期什么都不显示会让人以为没提交上。
  const cards: (AgentArtifactStatus | null)[] = mine.length > 0 ? mine : Array.from({ length: entry.count }, () => null)

  return (
    <div className={styles.genGroup}>
      <div className={styles.genHeader}>
        <span>{entry.mediaKind === 'image' ? '生成图片' : '生成视频'}</span>
        <span className={styles.genCount}>
          {mine.length > 0 ? `${done}/${mine.length} 完成` : `${entry.count} 条排队中`}
        </span>
      </div>
      <div className={styles.genList}>
        {cards.map((a, i) =>
          a ? (
            <ArtifactCard key={a.artifact_id} item={a} />
          ) : (
            <div key={`skeleton-${i}`} className={styles.genSkeleton}>
              <div className={styles.genSkeletonThumb} />
              <span className={styles.genSkeletonLabel}>等待中…</span>
            </div>
          ),
        )}
      </div>
    </div>
  )
}

/**
 * 生成确认卡片。参数是可选的控件,不是只读展示。
 *
 * 生成参数(时长/画幅/画质/张数)本该由用户定,模型只给建议值——
 * 所以这里按后端下发的 schema 渲染成下拉/数字框,默认选中模型的建议值,
 * 用户改完再提交。fields 为空时(拿不到 schema)退化成只读。
 */
function ConfirmCard({
  entry,
  busy,
  workspaceId,
  onSettle,
}: {
  entry: Extract<Entry, { kind: 'confirm' }>
  workspaceId: number
  /** 上一轮流是否仍在进行。为 true 时禁用按钮,避免点了没反应。 */
  busy: boolean
  onSettle: (callId: string, confirm: boolean, args?: Record<string, unknown>) => void
}) {
  const { call, settled } = entry
  const [edits, setEdits] = useState<Record<string, unknown>>({})
  // 换模型后重取的字段与模型名。null 表示仍用后端首次下发的。
  //
  // 必须重取:各模型档位差异很大(Seedance 2.5 支持到 30 秒,2.0 只到 15 秒),
  // 沿用旧模型的选项会让用户选到一个非法值,提交时被兜底成默认值——
  // 他以为自己选的生效了。
  const [override, setOverride] = useState<{
    fields: AgentPendingField[]
    modelName: string
  } | null>(null)
  const [loadingSchema, setLoadingSchema] = useState(false)

  const fields = override?.fields ?? call.fields ?? []
  const isImage = call.name === 'generate_image'
  const valueOf = (f: AgentPendingField) => (f.name in edits ? edits[f.name] : f.value)

  return (
    <div className={styles.confirmCard}>
      <div className={styles.confirmTitle}>{isImage ? '确认生成图片' : '确认生成视频'}</div>

      {/* 模型也要能换:只显示名字而不给切换,等于把选择权留在模型手里。
          只有一个可选模型时退化成文本,避免给一个点了没反应的下拉框。

          已知限制:切换模型后下方参数仍是原模型的档位(各模型 schema 不同)。
          后端在提交时会按新模型的 schema 重新校验并兜底,不会提交非法值,
          但界面上看不到新模型的可选项。要彻底解决需要切换时回后端重取 schema。 */}
      {call.models && call.models.length > 1 ? (
        <div className={styles.confirmField}>
          <span className={styles.confirmFieldLabel}>模型</span>
          <select
            className={styles.confirmSelect}
            value={String(edits.model ?? call.models.find((m) => m.selected)?.value ?? '')}
            disabled={!!settled || loadingSchema}
            onChange={(e) => {
              const model = e.target.value
              // 清掉已改的参数:旧模型的档位在新模型上多半非法。
              setEdits({ model })
              // 重取新模型的档位——这是「选了 30 秒却只有 15 秒可选」的解法。
              setLoadingSchema(true)
              describeGeneration({
                workspaceId,
                tool: call.name,
                args: { ...call.args, model },
              })
                .then((res) => setOverride({ fields: res.fields, modelName: res.model_name }))
                .catch(() => {
                  // 重取失败时保留旧档位:总好过让确认框变成空白。
                  // 后端提交时仍会按新模型的 schema 校验并兜底。
                  setOverride(null)
                })
                .finally(() => setLoadingSchema(false))
            }}
          >
            {call.models.map((m) => (
              <option key={m.value} value={m.value}>
                {m.display_name}
              </option>
            ))}
          </select>
        </div>
      ) : (
        call.model_name && (
          <div className={styles.confirmField}>
            <span className={styles.confirmFieldLabel}>模型</span>
            <span className={styles.confirmModel}>{call.model_name}</span>
          </div>
        )
      )}

      {typeof call.args.prompt === 'string' && <div className={styles.confirmPrompt}>{call.args.prompt}</div>}

      {fields.map((f) => (
        <div key={f.name} className={styles.confirmField}>
          <span className={styles.confirmFieldLabel}>{f.display_name || f.name}</span>
          {/* 类型判断必须排在 options 之前:布尔字段即使带了 options
              也该渲染成开关,落进下拉框会变成手填 true/false。 */}
          {f.type === 'bool' || f.type === 'boolean' ? (
            <input
              type="checkbox"
              className={styles.confirmCheckbox}
              checked={!!valueOf(f)}
              disabled={!!settled}
              onChange={(e) => setEdits((prev) => ({ ...prev, [f.name]: e.target.checked }))}
            />
          ) : f.options && f.options.length > 0 ? (
            <select
              className={styles.confirmSelect}
              value={String(valueOf(f) ?? '')}
              disabled={!!settled}
              onChange={(e) => {
                // 从 options 里取回原始类型:select 的 value 恒为 string,
                // 直接提交会把数字档位(如 duration=5)变成 "5" 被上游拒。
                const picked = f.options?.find((o) => String(o) === e.target.value)
                setEdits((prev) => ({ ...prev, [f.name]: picked ?? e.target.value }))
              }}
            >
              {f.options.map((o) => (
                <option key={String(o)} value={String(o)}>
                  {String(o)}
                </option>
              ))}
            </select>
          ) : (
            <input
              className={styles.confirmInput}
              type={f.type === 'number' ? 'number' : 'text'}
              value={String(valueOf(f) ?? '')}
              min={f.min}
              max={f.max}
              disabled={!!settled}
              onChange={(e) =>
                setEdits((prev) => ({
                  ...prev,
                  [f.name]: f.type === 'number' ? Number(e.target.value) : e.target.value,
                }))
              }
            />
          )}
        </div>
      ))}

      <div className={styles.confirmCredits}>
        预计消耗 <span className={styles.confirmCreditsValue}>{call.estimated_credits}</span> 积分
      </div>

      {settled ? (
        <div className={styles.confirmCredits}>{settled === 'done' ? '已确认执行' : '已取消'}</div>
      ) : (
        <div className={styles.confirmActions}>
          <button className={styles.btnGhost} disabled={busy} onClick={() => onSettle(call.call_id, false)}>
            取消
          </button>
          <button
            className={styles.btnPrimary}
            disabled={busy}
            title={busy ? '上一步还在进行中' : undefined}
            onClick={() => {
              // 只提交改动过的字段:未改的交给后端用模型建议值,
              // 全量回传会把 schema 默认值固化成用户显式选择。
              onSettle(call.call_id, true, Object.keys(edits).length ? edits : undefined)
            }}
          >
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

function ListIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" {...stroke}>
      <circle cx="4" cy="4.5" r="1.6" />
      <circle cx="4" cy="11.5" r="1.6" />
      <path d="M8.5 3.5h5M8.5 6h3M8.5 10.5h5M8.5 13h3" />
    </svg>
  )
}

function NewChatIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" {...stroke}>
      <path d="M13.5 9.5a2 2 0 01-2 2H6l-3 2.5v-2.5H4a2 2 0 01-2-2v-6a2 2 0 012-2h7.5a2 2 0 012 2z" />
      <path d="M7.75 4.75v3.5M6 6.5h3.5" />
    </svg>
  )
}

function CollapseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" {...stroke}>
      <path d="M6.5 9.5L2.5 13.5M6.5 9.5H3.5M6.5 9.5V12.5M9.5 6.5L13.5 2.5M9.5 6.5H12.5M9.5 6.5V3.5" />
    </svg>
  )
}

function MicIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" {...stroke}>
      <rect x="6" y="2" width="4" height="7.5" rx="2" />
      <path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" {...stroke}>
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  )
}

function ClipIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" {...stroke}>
      <path d="M11.5 7.5l-4 4a2.5 2.5 0 01-3.5-3.5l5-5a1.7 1.7 0 012.4 2.4l-5 5a.9.9 0 01-1.2-1.2l4.3-4.3" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" {...stroke} strokeWidth={2}>
      <path d="M4 4l8 8M12 4l-8 8" />
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
