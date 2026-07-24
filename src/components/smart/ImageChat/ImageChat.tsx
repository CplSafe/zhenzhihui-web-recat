/**
 * 智能成片「制作图片」对话视图(2.1,按 Figma 664:2740 还原)。
 * 与「制作视频」的 4 步流程不同:图片模式是 chat 聊天形式 —— 上方可滚动消息流
 * (用户气泡靠右 + 上传图缩略图;AI 回复靠左,文字 + 生成图),输入框沉底。
 * 输入框工具栏只保留「比例(16:9)」与「@ 引用素材」两项(不含时长/SKILLS)。
 * 每次发送 → 调父级 onSend(文本, 参考图, 比例),由父级出图并把结果追加到 messages。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import EntryDropdown from '../EntryDropdown'
import RatioIcon from '@/components/common/RatioIcon'
import { openMemberCenter } from '@/stores/ui'
import { fileToDataUrl } from '@/utils/imageFile'
import { ENTRY_RATIO_OPTIONS as RATIO_OPTIONS } from '@/utils/videoOptions'
import { useToast } from '@/composables/useToast'
import type { BackendGenerationModel, GenerationModelVersionId } from '@/utils/generationModelCatalog'
import type { LockedSmartImageQuotedCost } from '@/utils/smartImageQueueSafety'
import styles from './ImageChat.module.less'

/** 对话消息中的图片地址及可选后端资产 ID。 */
export interface ChatImg {
  url: string
  assetId?: number
}

/** 图片生成对话的一条用户或助手消息及生成状态。 */
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text?: string
  images?: ChatImg[]
  /** 仅 assistant:出图状态 */
  status?: 'pending' | 'done' | 'error'
  error?: string
  /** 后端任务信息用于刷新后恢复同一次生成，避免重复扣费。 */
  taskId?: number
  /** 只有后端明确返回失败/取消等终态时为 true；否则重试必须继续查询原 taskId。 */
  terminalFailure?: boolean
  idempotencyKey?: string
  operationCode?: 'image.text_to_image' | 'image.image_to_image'
  /** 同一轮多图生成的分组信息；每张图片仍对应一个独立、可恢复的后端任务。 */
  batchId?: string
  batchIndex?: number
  batchTotal?: number
  request?: {
    text: string
    ratio: string
    refAssetIds?: number[]
    refImages?: ChatImg[]
    outputCount?: number
    /** 创建队列时锁定的后端模型；刷新恢复后继续使用同一模型，避免批次内漂移。 */
    modelVersionId?: GenerationModelVersionId
    modelVersion?: BackendGenerationModel
    /** 用户确认时冻结的工作空间、模型 schema、请求参数和整批报价。 */
    quotedCost?: LockedSmartImageQuotedCost
  }
  startedAt?: number
}

/** 返回入口或恢复页面时需要保留的未发送图片创作内容。 */
export interface ImageComposerDraft {
  text: string
  ratio: string
  images: ChatImg[]
  outputCount: number
}

/** 从生成记录中选中、准备交给视频入口的一张图片及其来源消息。 */
export interface ImageVideoSelection {
  image: ChatImg
  message: ChatMessage
}

/** 对话历史、当前生成状态、成本提示与发送/新建会话回调。 */
export interface ImageChatProps {
  messages: ChatMessage[]
  /** 入口带进来的初始比例(后续每轮可在输入框内改) */
  initialRatio?: string
  initialOutputCount?: number
  initialComposerDraft?: Partial<ImageComposerDraft>
  /** 是否有一轮正在出图(出图中禁用发送) */
  busy?: boolean
  /** 当前图片操作尚未选择模型等原因，仅禁用新生成，不影响返回或新建对话。 */
  generationDisabled?: boolean
  generationDisabledReason?: string
  /** 提交前积分预估文案(单张口径,如「每张约 X 积分 · 余额 Y」);空则不显示 */
  costText?: string
  /** 预估超过余额:在 costText 后追加「积分不足,请前往充值积分」(可点击跳会员中心) */
  costInsufficient?: boolean
  /** 返回 false 表示用户取消付费确认，组件会保留本轮输入。 */
  onSend: (
    text: string,
    images: string[],
    ratio: string,
    assetIds?: number[],
    outputCount?: number,
  ) => void | boolean | Promise<void | boolean>
  /** 非破坏性返回创作入口；回调会同步带回尚未发送的输入。 */
  onBack?: (draft: ImageComposerDraft) => void
  backDisabled?: boolean
  /** 「创建新对话」:清空会话回到入口 */
  onNewChat?: () => void
  /** 除生成状态外，父级还可以显式禁用新建对话。 */
  newChatDisabled?: boolean
  /** 生成结果操作；未传预览/下载回调时组件提供浏览器原生回退。 */
  onPreview?: (image: ChatImg, message: ChatMessage) => void
  onDownload?: (image: ChatImg, message: ChatMessage) => void
  /** 图片会先加入当前输入框，再通知父级。 */
  onUseAsReference?: (image: ChatImg, message: ChatMessage) => void
  /** 用一至九张生成结果开启一个独立的视频项目，避免覆盖当前图片项目。 */
  onContinueToVideo?: (selections: ImageVideoSelection[]) => void | Promise<void>
  onRetry?: (message: ChatMessage) => void
  /**
   * 按失败消息判断是否允许重试。未提供时沿用 generationDisabled，
   * 这样已有 taskId 的恢复可以不受当前输入框模型选择影响。
   */
  isRetryDisabled?: (message: ChatMessage) => boolean
  getRetryDisabledReason?: (message: ChatMessage) => string
  /** 当前输入框参考图数量变化，供父级实时切换文生图/图生图费用预估。 */
  onComposerReferenceCountChange?: (count: number) => void
  /** 当前输入框比例变化，供父级实时刷新费用预估。 */
  onRatioChange?: (ratio: string) => void
  onOutputCountChange?: (count: number) => void
  onComposerDraftChange?: (draft: ImageComposerDraft) => void
}

/** 单轮图片对话最多携带的参考图数量。 */
const MAX_IMAGES = 9
const OUTPUT_COUNT_OPTIONS = Array.from({ length: MAX_IMAGES }, (_, index) => `${index + 1}张`)
const clampOutputCount = (value: unknown) => Math.min(MAX_IMAGES, Math.max(1, Math.floor(Number(value) || 1)))

/** 图片生成输入框的示例提示文案。 */
const PLACEHOLDER =
  '最多上传9张图片，输入文字或@参考素材，生成精彩广告图片。例如：把 @图片1 中的产品放到 @图片2 中的场景里'

// 高亮渲染匹配:@图片N(绿)
const HL_RE = /@图片\d+/g

/** 限制原生预览/下载回退到浏览器可安全导航的图片 URL。 */
const isSafeImageUrl = (url: string) => {
  const value = url.trim()
  if (/^data:image\//i.test(value) || /^blob:/i.test(value)) return true
  try {
    const protocol = new URL(value, window.location.href).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

const chatImageKey = (image: ChatImg) =>
  Number(image.assetId || 0) > 0 ? `asset:${Number(image.assetId)}` : `url:${String(image.url || '')}`

const ResultActionIcon = ({ type }: { type: 'preview' | 'download' | 'edit' | 'video' | 'retry' }) => {
  if (type === 'preview') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M2.8 12s3.4-6 9.2-6 9.2 6 9.2 6-3.4 6-9.2 6-9.2-6-9.2-6Z" />
        <circle cx="12" cy="12" r="2.8" />
      </svg>
    )
  }
  if (type === 'download') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3v11m0 0 4-4m-4 4-4-4M5 18v2h14v-2" />
      </svg>
    )
  }
  if (type === 'edit') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m4 16-.8 4 4-.8L18.5 7.9l-3.2-3.2L4 16Z" />
        <path d="m13.8 6.2 3.2 3.2" />
      </svg>
    )
  }
  if (type === 'video') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="5" width="14" height="14" rx="3" />
        <path d="m10 9 4 3-4 3V9ZM17 10l4-2v8l-4-2" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M19.4 8A8 8 0 1 0 20 14m-.6-6V3m0 5h-5" />
    </svg>
  )
}

/** 管理图片对话输入、参考图下标引用和消息滚动，并把生成请求交给父级执行。 */
export default function ImageChat({
  messages,
  initialRatio,
  initialOutputCount,
  initialComposerDraft,
  busy,
  generationDisabled = false,
  generationDisabledReason = '',
  costText,
  costInsufficient,
  onSend,
  onBack,
  backDisabled,
  onNewChat,
  newChatDisabled,
  onPreview,
  onDownload,
  onUseAsReference,
  onContinueToVideo,
  onRetry,
  isRetryDisabled,
  getRetryDisabledReason,
  onComposerReferenceCountChange,
  onRatioChange,
  onOutputCountChange,
  onComposerDraftChange,
}: ImageChatProps) {
  const { showToast } = useToast()
  const [text, setText] = useState(initialComposerDraft?.text || '')
  const [ratio, setRatio] = useState(initialComposerDraft?.ratio || initialRatio || '16:9')
  const [images, setImages] = useState<ChatImg[]>(() => initialComposerDraft?.images || [])
  const [outputCount, setOutputCount] = useState(() =>
    clampOutputCount(initialComposerDraft?.outputCount ?? initialOutputCount ?? 1),
  )
  const [editingImageKey, setEditingImageKey] = useState(() =>
    initialComposerDraft?.images?.length === 1 ? chatImageKey(initialComposerDraft.images[0]) : '',
  )
  const [atOpen, setAtOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [selectedVideoImageKeys, setSelectedVideoImageKeys] = useState<string[]>([])
  const [continuingToVideo, setContinuingToVideo] = useState(false)
  const [previewing, setPreviewing] = useState<{
    image: ChatImg
    message: ChatMessage
    label: string
  } | null>(null)

  const fileRef = useRef<HTMLInputElement | null>(null)
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const hlRef = useRef<HTMLDivElement | null>(null)
  const caretRef = useRef(0)
  const listRef = useRef<HTMLDivElement | null>(null)
  const previewDialogRef = useRef<HTMLDivElement | null>(null)
  const previewCloseRef = useRef<HTMLButtonElement | null>(null)
  const previewTriggerRef = useRef<HTMLElement | null>(null)
  const composerDraftRef = useRef<ImageComposerDraft>({ text, ratio, images, outputCount })
  const composerDraftChangeRef = useRef(onComposerDraftChange)
  composerDraftRef.current = { text, ratio, images, outputCount }
  composerDraftChangeRef.current = onComposerDraftChange

  const videoCandidates: ImageVideoSelection[] = []
  const videoCandidateKeys = new Set<string>()
  for (const message of messages) {
    if (message.role !== 'assistant' || message.status !== 'done') continue
    for (const image of message.images || []) {
      const key = chatImageKey(image)
      if (!image.url || videoCandidateKeys.has(key)) continue
      videoCandidateKeys.add(key)
      videoCandidates.push({ image, message })
    }
  }
  const selectedVideoImageKeySet = new Set(selectedVideoImageKeys)
  const selectedVideoCandidates = videoCandidates.filter(({ image }) =>
    selectedVideoImageKeySet.has(chatImageKey(image)),
  )
  const videoCandidateNumberByKey = new Map(
    videoCandidates.map(({ image }, index) => [chatImageKey(image), index + 1] as const),
  )

  // 新消息进来 → 滚到底
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  useEffect(() => {
    setRatio(initialComposerDraft?.ratio || initialRatio || '16:9')
  }, [initialComposerDraft?.ratio, initialRatio])

  useEffect(() => {
    setOutputCount(clampOutputCount(initialComposerDraft?.outputCount ?? initialOutputCount ?? 1))
  }, [initialComposerDraft?.outputCount, initialOutputCount])

  useEffect(() => {
    onComposerReferenceCountChange?.(images.length)
  }, [images.length, onComposerReferenceCountChange])

  useEffect(() => {
    onRatioChange?.(ratio)
  }, [onRatioChange, ratio])

  useEffect(() => {
    onOutputCountChange?.(outputCount)
  }, [onOutputCountChange, outputCount])

  useEffect(() => {
    if (!onComposerDraftChange) return
    const timer = window.setTimeout(() => {
      onComposerDraftChange({ text, ratio, images, outputCount })
    }, 300)
    return () => window.clearTimeout(timer)
  }, [images, onComposerDraftChange, outputCount, ratio, text])

  // 侧栏跳转、刷新或父级切页可能早于 300ms 防抖；卸载时同步交回最新输入，避免丢字或参考图。
  useEffect(
    () => () => {
      composerDraftChangeRef.current?.(composerDraftRef.current)
    },
    [],
  )

  useEffect(() => {
    if (editingImageKey && !images.some((image) => chatImageKey(image) === editingImageKey)) {
      setEditingImageKey('')
    }
  }, [editingImageKey, images])

  const previewOpen = Boolean(previewing)
  useEffect(() => {
    if (!previewOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusFrame = window.requestAnimationFrame(() => previewCloseRef.current?.focus())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setPreviewing(null)
        return
      }
      if (event.key !== 'Tab' || !previewDialogRef.current) return
      const focusable = Array.from(
        previewDialogRef.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
        ),
      )
      if (!focusable.length) {
        event.preventDefault()
        previewDialogRef.current.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      window.requestAnimationFrame(() => {
        if (previewTriggerRef.current?.isConnected) previewTriggerRef.current.focus()
      })
    }
  }, [previewOpen])

  const pickImages = async (files: FileList | null) => {
    if (!files?.length) return
    const room = MAX_IMAGES - images.length
    if (room <= 0) {
      showToast(`最多上传 ${MAX_IMAGES} 张图片`, 'info')
      return
    }
    const selected = Array.from(files)
    const imageFiles = selected.filter((file) => file.type.startsWith('image/'))
    const invalidCount = selected.length - imageFiles.length
    if (invalidCount > 0) showToast(`已忽略 ${invalidCount} 个非图片文件`, 'info')
    if (imageFiles.length > room) showToast(`最多上传 ${MAX_IMAGES} 张图片`, 'info')
    const candidates = imageFiles.slice(0, room)
    const decoded = await Promise.all(candidates.map((file) => fileToDataUrl(file).catch(() => null)))
    const picked = decoded.filter(Boolean) as string[]
    const failedCount = decoded.length - picked.length
    if (failedCount > 0) showToast(`${failedCount} 张图片读取失败，请重新选择`, 'error')
    if (picked.length) {
      setImages((prev) => [...prev, ...picked.map((url) => ({ url }))].slice(0, MAX_IMAGES))
    }
  }
  const removeImage = (idx: number) => {
    // 按【下标】删,而不是按 url indexOf——两张相同图(同 dataURL)时 indexOf 只命中第一张,
    // 点第二张的 × 会误删第一张。下标删才精确。
    if (idx < 0 || idx >= images.length) return
    setImages((prev) => prev.filter((_, i) => i !== idx))
    // 同步重排文本里的位置型引用 @图片N:指向被删图的去掉,其后的整体 -1(否则引用错图)
    setText((t) =>
      t.replace(/@图片(\d+)/g, (m, d) => {
        const n = Number(d) // 1-based
        if (n - 1 === idx) return ''
        if (n - 1 > idx) return `@图片${n - 1}`
        return m
      }),
    )
  }

  // 在记录的光标位置插入文本,并把光标移到插入内容之后,回焦
  const insertAtCaret = (snippet: string) => {
    const pos = Math.min(caretRef.current, text.length)
    const next = text.slice(0, pos) + snippet + text.slice(pos)
    setText(next)
    const newPos = pos + snippet.length
    caretRef.current = newPos
    requestAnimationFrame(() => {
      const ta = taRef.current
      if (ta) {
        ta.focus()
        ta.setSelectionRange(newPos, newPos)
      }
    })
  }

  const handleAt = () => {
    const ta = taRef.current
    caretRef.current = ta ? (ta.selectionStart ?? text.length) : text.length
    if (images.length === 0) {
      insertAtCaret('@')
      return
    }
    setAtOpen(true)
  }
  const pickRef = (index: number) => {
    insertAtCaret(`@图片${index + 1} `)
    setAtOpen(false)
  }

  // 高亮:@图片N 标绿,其余普通文本(textarea 文字透明,叠在此层上)
  const renderHighlight = (t: string) => {
    if (!t) return null
    const out: ReactNode[] = []
    let last = 0
    let m: RegExpExecArray | null
    HL_RE.lastIndex = 0
    while ((m = HL_RE.exec(t))) {
      if (m.index > last) out.push(t.slice(last, m.index))
      out.push(
        <span className={styles.refTag} key={m.index}>
          {m[0]}
        </span>,
      )
      last = m.index + m[0].length
    }
    out.push(t.slice(last))
    return out
  }

  const cleanText = text.trim()
  const canSubmit =
    (cleanText.length > 0 || images.length > 0) && !busy && !submitting && !costInsufficient && !generationDisabled
  // 父级确认接受生成后才清空本轮输入；用户取消付费确认时原内容不会丢失。
  const submit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    const submittedText = text
    const submittedImages = images
    try {
      const urls = submittedImages.map((image) => image.url)
      const assetIds = submittedImages.map((image) => Number(image.assetId || 0))
      const accepted = assetIds.some(Boolean)
        ? outputCount > 1
          ? await onSend(cleanText, urls, ratio, assetIds, outputCount)
          : await onSend(cleanText, urls, ratio, assetIds)
        : outputCount > 1
          ? await onSend(cleanText, urls, ratio, undefined, outputCount)
          : await onSend(cleanText, urls, ratio)
      if (accepted === false) return
      setText((current) => {
        if (current !== submittedText) return current
        caretRef.current = 0
        return ''
      })
      setImages((current) => (current === submittedImages ? [] : current))
      setEditingImageKey('')
      setAtOpen(false)
    } finally {
      setSubmitting(false)
    }
  }

  const previewImage = (image: ChatImg, message: ChatMessage, label = 'AI 生成图片') => {
    if (onPreview) {
      onPreview(image, message)
      return
    }
    if (!isSafeImageUrl(image.url)) {
      showToast('图片地址无效，暂时无法预览', 'error')
      return
    }
    previewTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setPreviewing({ image, message, label })
  }

  const downloadImage = (image: ChatImg, message: ChatMessage) => {
    if (onDownload) {
      onDownload(image, message)
      return
    }
    if (!isSafeImageUrl(image.url)) {
      showToast('图片地址无效，暂时无法下载', 'error')
      return
    }
    const link = document.createElement('a')
    link.href = image.url
    link.download = `ai-image-${message.id}.png`
    link.rel = 'noopener'
    document.body.appendChild(link)
    link.click()
    link.remove()
  }

  const selectImageForEdit = (image: ChatImg, message: ChatMessage) => {
    const key = chatImageKey(image)
    if (editingImageKey === key && images.length === 1 && chatImageKey(images[0]) === key) {
      setImages([])
      setEditingImageKey('')
      showToast('已取消修改图片', 'info')
      return
    }
    setImages([image])
    setEditingImageKey(key)
    onUseAsReference?.(image, message)
    showToast('已选择这张图片，请输入修改要求', 'success')
    requestAnimationFrame(() => taRef.current?.focus())
  }

  const toggleVideoSelection = (image: ChatImg) => {
    const key = chatImageKey(image)
    const selected = selectedVideoImageKeySet.has(key)
    if (!selected && selectedVideoCandidates.length >= MAX_IMAGES) {
      showToast(`最多选择 ${MAX_IMAGES} 张图片制作视频`, 'info')
      return
    }
    setSelectedVideoImageKeys((current) => {
      const liveKeys = current.filter((candidateKey) => videoCandidateKeys.has(candidateKey))
      return selected ? liveKeys.filter((candidateKey) => candidateKey !== key) : [...liveKeys, key]
    })
  }

  const continueToVideo = async () => {
    if (!onContinueToVideo || !selectedVideoCandidates.length || busy || submitting || continuingToVideo) return
    setContinuingToVideo(true)
    try {
      await onContinueToVideo(selectedVideoCandidates.slice(0, MAX_IMAGES))
    } finally {
      setContinuingToVideo(false)
    }
  }

  const backToEntry = () => {
    if (!onBack || busy || submitting || backDisabled) return
    onBack({ text, ratio, images, outputCount })
  }

  return (
    <div className={styles.chat}>
      <header className={styles.pageHeader}>
        <div className={styles.pageTitleRow}>
          <h1 className={styles.pageTitle}>制作图片</h1>
          <span className={styles.pageMode}>仅生成图片</span>
        </div>
        <p className={styles.pageDescription}>
          当前页面只会生成或修改图片，不会直接生成视频；如需制作视频，请先选择生成结果，再点击「做视频」。
        </p>
      </header>

      {/* 消息流 */}
      <div className={styles.list} ref={listRef}>
        {messages.map((msg) =>
          msg.role === 'user' ? (
            <div className={`${styles.row} ${styles.user}`} key={msg.id}>
              <div className={styles.userCol}>
                {!!msg.images?.length && (
                  <div className={styles.userImgs}>
                    {msg.images.map((im, i) => (
                      <img className={styles.userImg} src={im.url} alt={`用户参考图片 ${i + 1}`} key={im.url + i} />
                    ))}
                  </div>
                )}
                {!!msg.text && <div className={styles.userBubble}>{renderHighlight(msg.text)}</div>}
              </div>
            </div>
          ) : (
            <div className={`${styles.row} ${styles.ai}`} key={msg.id}>
              <div className={`${styles.aiCol}${(msg.images?.length || 0) > 1 ? ' ' + styles.aiColWide : ''}`}>
                {msg.status === 'pending' ? (
                  <div className={styles.pending} role="status" aria-live="polite">
                    <span className={styles.spin} aria-hidden="true" />
                    {Number(msg.batchTotal || 0) > 1
                      ? `正在生成第 ${Number(msg.batchIndex || 0) + 1}/${msg.batchTotal} 张图片…`
                      : '营销图片生成中…'}
                  </div>
                ) : msg.status === 'error' ? (
                  <div className={styles.errorCard}>
                    <div className={styles.aiError} role="alert">
                      {msg.error || '生成失败，请重试'}
                    </div>
                    {onRetry &&
                      (() => {
                        const hasMessageRetryGate = typeof isRetryDisabled === 'function'
                        const retryDisabled = hasMessageRetryGate
                          ? Boolean(isRetryDisabled(msg))
                          : Boolean(costInsufficient || generationDisabled)
                        const retryDisabledReason =
                          getRetryDisabledReason?.(msg) ||
                          (retryDisabled
                            ? costInsufficient
                              ? '积分不足，请先充值'
                              : generationDisabledReason || '当前图片任务暂时无法重试'
                            : '')
                        return (
                          <button
                            type="button"
                            className={styles.retry}
                            onClick={() => onRetry(msg)}
                            disabled={busy || submitting || retryDisabled}
                            aria-label="重新生成这张图片"
                            title={retryDisabledReason || undefined}
                          >
                            <ResultActionIcon type="retry" />
                            重新生成
                          </button>
                        )
                      })()}
                  </div>
                ) : (
                  <>
                    {!!msg.text && <div className={styles.aiText}>{msg.text}</div>}
                    {!!msg.images?.length && (
                      <div className={styles.aiImgs}>
                        {msg.images.map((im, i) => (
                          <figure
                            className={`${styles.resultCard}${editingImageKey === chatImageKey(im) ? ' ' + styles.resultCardSelected : ''}${selectedVideoImageKeySet.has(chatImageKey(im)) ? ' ' + styles.resultCardVideoSelected : ''}`}
                            key={im.url + i}
                          >
                            {onContinueToVideo && (
                              <button
                                type="button"
                                className={styles.videoSelect}
                                onClick={() => toggleVideoSelection(im)}
                                aria-label={`${selectedVideoImageKeySet.has(chatImageKey(im)) ? '取消选择' : '选择'}图片 ${videoCandidateNumberByKey.get(chatImageKey(im)) || i + 1} 用于制作视频`}
                                aria-pressed={selectedVideoImageKeySet.has(chatImageKey(im))}
                                disabled={continuingToVideo}
                              >
                                <span aria-hidden="true">
                                  {selectedVideoImageKeySet.has(chatImageKey(im)) ? '✓' : ''}
                                </span>
                              </button>
                            )}
                            <button
                              type="button"
                              className={styles.resultPreview}
                              onClick={() => previewImage(im, msg, `AI 生成图片 ${i + 1}`)}
                              aria-label={`预览生成图片 ${i + 1}`}
                            >
                              <img className={styles.aiImg} src={im.url} alt={`AI 生成图片 ${i + 1}`} />
                              <span className={styles.previewHint} aria-hidden="true">
                                查看原图
                              </span>
                            </button>
                            <figcaption className={styles.resultActions}>
                              <button
                                type="button"
                                onClick={() => previewImage(im, msg, `AI 生成图片 ${i + 1}`)}
                                aria-label={`预览图片 ${i + 1}`}
                              >
                                <ResultActionIcon type="preview" />
                                预览
                              </button>
                              <button
                                type="button"
                                onClick={() => downloadImage(im, msg)}
                                aria-label={`下载图片 ${i + 1}`}
                              >
                                <ResultActionIcon type="download" />
                                下载
                              </button>
                              <button
                                type="button"
                                onClick={() => selectImageForEdit(im, msg)}
                                aria-label={`修改图片 ${i + 1}`}
                                aria-pressed={editingImageKey === chatImageKey(im)}
                              >
                                <ResultActionIcon type="edit" />
                                {editingImageKey === chatImageKey(im) ? '修改中' : '修改'}
                              </button>
                            </figcaption>
                          </figure>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          ),
        )}
      </div>

      {/* 输入框(沉底);「创建新对话」位于输入框右上角 */}
      <div className={styles.footer}>
        {onContinueToVideo && videoCandidates.length > 0 && (
          <div className={styles.videoBatchBar} aria-label="选择图片制作视频">
            <div className={styles.videoBatchCopy}>
              <strong>选择图片制作视频</strong>
              <span role="status" aria-live="polite">
                {selectedVideoCandidates.length > 0
                  ? `已选 ${selectedVideoCandidates.length} 张，最多 9 张`
                  : '勾选上方生成图片，可多选'}
              </span>
            </div>
            <div className={styles.videoBatchActions}>
              {selectedVideoCandidates.length > 0 && (
                <button
                  type="button"
                  className={styles.clearVideoSelection}
                  onClick={() => setSelectedVideoImageKeys([])}
                  disabled={continuingToVideo}
                >
                  清空选择
                </button>
              )}
              <button
                type="button"
                className={styles.continueVideo}
                onClick={() => void continueToVideo()}
                disabled={!selectedVideoCandidates.length || busy || submitting || continuingToVideo}
              >
                <ResultActionIcon type="video" />
                {continuingToVideo ? '准备中…' : '做视频'}
              </button>
            </div>
          </div>
        )}
        {(onBack || onNewChat) && (
          <div className={styles.footerHead}>
            {onBack ? (
              <button
                type="button"
                className={styles.back}
                onClick={backToEntry}
                disabled={busy || submitting || backDisabled}
                title={busy ? '图片生成完成后可返回' : '返回创作入口'}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m14.5 6-6 6 6 6M9 12h10" />
                </svg>
                返回上一步
              </button>
            ) : (
              <span />
            )}
            {onNewChat && (
              <button
                type="button"
                className={styles.newChat}
                onClick={onNewChat}
                disabled={busy || submitting || newChatDisabled}
                title={submitting ? '正在确认生成，请稍候' : busy ? '图片生成中，请稍候' : undefined}
              >
                创建新对话
              </button>
            )}
          </div>
        )}
        <div className={styles.card}>
          {editingImageKey && images.length > 0 && (
            <div className={styles.editingStatus} role="status" aria-live="polite">
              <span className={styles.editingDot} aria-hidden="true" />
              已选中图片作为修改参考，请输入希望调整的内容
            </div>
          )}
          {images.length > 0 && (
            <div className={styles.attachments}>
              {images.map((image, i) => (
                <div className={styles.thumb} key={`${image.url}-${i}`}>
                  <img src={image.url} alt={`待发送参考图片 ${i + 1}`} />
                  <button
                    type="button"
                    className={styles.thumbX}
                    onClick={() => removeImage(i)}
                    aria-label={`移除图片 ${i + 1}`}
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                </div>
              ))}
              {images.length < MAX_IMAGES && (
                <button
                  type="button"
                  className={styles.add}
                  onClick={() => fileRef.current?.click()}
                  aria-label="继续上传"
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="20"
                    height="20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  >
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
              )}
            </div>
          )}

          <div className={styles.cardBody}>
            {images.length === 0 && (
              <button
                type="button"
                className={styles.upload}
                onClick={() => fileRef.current?.click()}
                aria-label="上传图片"
                title="上传图片"
              >
                <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.7">
                  <rect x="3" y="3" width="18" height="18" rx="3" />
                  <path d="M3 16l5-4 4 3 4-5 5 6" />
                  <circle cx="8.5" cy="8.5" r="1.6" />
                </svg>
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                pickImages(e.target.files)
                e.target.value = ''
              }}
            />
            <div className={styles.inputWrap}>
              <div className={styles.inputHl} ref={hlRef} aria-hidden="true">
                {renderHighlight(text)}
              </div>
              <textarea
                ref={taRef}
                className={styles.input}
                aria-label="图片创作描述"
                value={text}
                placeholder={
                  editingImageKey ? '描述你想如何修改这张图片，例如：保留人物，把场景改为篮球馆' : PLACEHOLDER
                }
                onChange={(e) => {
                  setText(e.target.value)
                  caretRef.current = e.target.selectionStart ?? e.target.value.length
                }}
                onScroll={(e) => {
                  if (hlRef.current) hlRef.current.scrollTop = e.currentTarget.scrollTop
                }}
                onSelect={(e) => {
                  caretRef.current = e.currentTarget.selectionStart ?? 0
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    void submit()
                  }
                }}
              />
            </div>
          </div>

          <div className={styles.toolbar}>
            <div className={styles.tools}>
              <EntryDropdown
                value={ratio}
                options={RATIO_OPTIONS}
                onChange={setRatio}
                icon={<RatioIcon ratio={ratio} />}
                valueMinWidth={34}
                ariaLabel="图片比例"
                placement="top"
              />
              <EntryDropdown
                value={`${outputCount}张`}
                options={OUTPUT_COUNT_OPTIONS}
                onChange={(value) => setOutputCount(clampOutputCount(String(value).replace('张', '')))}
                ariaLabel="生成图片数量"
                placement="top"
                icon={
                  <svg
                    viewBox="0 0 24 24"
                    width="20"
                    height="20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <rect x="5" y="5" width="14" height="14" rx="3" />
                    <path d="M8.5 15.5l3-3 2.2 2.2 1.8-2 3.5 3.5M9 9.5h.01" />
                  </svg>
                }
                valueMinWidth={28}
              />
              <span className={styles.atAnchor}>
                <button
                  type="button"
                  className={styles.pillBtn}
                  onClick={handleAt}
                  title="引用参考素材"
                  aria-label="引用参考素材"
                  aria-haspopup="dialog"
                  aria-expanded={atOpen}
                >
                  @
                </button>
                {atOpen && (
                  <>
                    <div className={styles.atMask} onClick={() => setAtOpen(false)} aria-hidden="true" />
                    <div className={styles.atMenu} role="dialog" aria-label="选择参考素材">
                      <div className={styles.atMenuTitle}>选择参考素材</div>
                      <div className={styles.atMenuGrid}>
                        {images.map((image, i) => (
                          <button
                            type="button"
                            className={styles.atItem}
                            key={`${image.url}-${i}`}
                            onClick={() => pickRef(i)}
                            aria-label={`@图片${i + 1}`}
                          >
                            <img src={image.url} alt={`参考图片 ${i + 1}`} />
                            <span className={styles.atItemName}>@图片{i + 1}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </span>
            </div>

            {(costText || costInsufficient) && (
              <span
                id="image-generation-cost"
                className={`${styles.cost}${costInsufficient ? ' ' + styles.costErr : ''}`}
                role={costInsufficient ? 'alert' : undefined}
              >
                {costText}
                {costInsufficient && (
                  <>
                    {costText ? ' · 积分不足，' : '积分不足，'}
                    <button type="button" className={styles.costRecharge} onClick={openMemberCenter}>
                      请前往充值积分
                    </button>
                  </>
                )}
              </span>
            )}

            <button
              type="button"
              className={styles.send}
              disabled={!canSubmit}
              onClick={submit}
              aria-label="生成"
              aria-describedby={costText || costInsufficient ? 'image-generation-cost' : undefined}
              title={
                costInsufficient
                  ? '积分不足，请先充值'
                  : generationDisabled
                    ? generationDisabledReason || '请先选择图片生成模型'
                    : '生成(Ctrl/⌘ + Enter)'
              }
            >
              {/* 白色右箭头;圆底由 .send 控制(可点=品牌绿,不可点=禁用灰) */}
              <svg
                width="20"
                height="14"
                viewBox="0 0 20 14"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <path
                  d="M1.05649 8.0251H16.5914L12.2367 12.2495C12.0385 12.4418 11.9271 12.7025 11.9271 12.9745C11.927 13.2464 12.0383 13.5072 12.2364 13.6995C12.4346 13.8919 12.7034 13.9999 12.9836 14C13.2639 14.0001 13.5327 13.8921 13.7309 13.6998L19.7078 7.90093C19.9614 7.65491 20.0398 7.3181 19.9819 7.00004C20.0398 6.68257 19.9608 6.34518 19.7078 6.09916L13.7309 0.300249C13.5328 0.108003 13.2641 0 12.9838 0C12.7036 0 12.4349 0.108003 12.2367 0.300249C12.0386 0.492495 11.9273 0.753236 11.9273 1.02511C11.9273 1.29699 12.0386 1.55773 12.2367 1.74998L16.5914 5.97498H1.05649C0.776285 5.97498 0.507557 6.08298 0.309422 6.27522C0.111287 6.46745 -2.3859e-05 6.72818 -2.3859e-05 7.00004C-2.3859e-05 7.27191 0.111287 7.53263 0.309422 7.72487C0.507557 7.91711 0.776285 8.0251 1.05649 8.0251Z"
                  fill="white"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {previewing && (
        <div
          ref={previewDialogRef}
          className={styles.previewOverlay}
          role="dialog"
          aria-modal="true"
          aria-label="图片预览"
          tabIndex={-1}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPreviewing(null)
          }}
        >
          <div className={styles.previewToolbar}>
            <span>大图预览</span>
            <div className={styles.previewToolbarActions}>
              <button type="button" onClick={() => downloadImage(previewing.image, previewing.message)}>
                <ResultActionIcon type="download" />
                下载
              </button>
              <button
                ref={previewCloseRef}
                type="button"
                className={styles.previewClose}
                onClick={() => setPreviewing(null)}
                aria-label="关闭图片预览"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m6 6 12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
          </div>
          <div className={styles.previewStage} onMouseDown={(event) => event.stopPropagation()}>
            <img src={previewing.image.url} alt={`${previewing.label}大图预览`} />
          </div>
        </div>
      )}
    </div>
  )
}
