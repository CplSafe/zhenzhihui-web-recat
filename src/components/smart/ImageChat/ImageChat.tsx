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
import styles from './ImageChat.module.less'

export interface ChatImg {
  url: string
  assetId?: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text?: string
  images?: ChatImg[]
  /** 仅 assistant:出图状态 */
  status?: 'pending' | 'done' | 'error'
  error?: string
}

interface ImageChatProps {
  messages: ChatMessage[]
  /** 入口带进来的初始比例(后续每轮可在输入框内改) */
  initialRatio?: string
  /** 是否有一轮正在出图(出图中禁用发送) */
  busy?: boolean
  /** 提交前积分预估文案(单张口径,如「每张约 X 积分 · 余额 Y」);空则不显示 */
  costText?: string
  /** 预估超过余额:在 costText 后追加「积分不足,请前往充值积分」(可点击跳会员中心) */
  costInsufficient?: boolean
  onSend: (text: string, images: string[], ratio: string) => void
  /** 「创建新对话」:清空会话回到入口 */
  onNewChat?: () => void
}

const MAX_IMAGES = 9
const PLACEHOLDER =
  '最多上传9张图片，输入文字或@参考素材，生成精彩广告图片。例如：把 @图片1 中的产品放到 @图片2 中的场景里'

// 高亮渲染匹配:@图片N(绿)
const HL_RE = /@图片\d+/g

export default function ImageChat({
  messages,
  initialRatio,
  busy,
  costText,
  costInsufficient,
  onSend,
  onNewChat,
}: ImageChatProps) {
  const { showToast } = useToast()
  const [text, setText] = useState('')
  const [ratio, setRatio] = useState(initialRatio || '16:9')
  const [images, setImages] = useState<string[]>([])
  const [atOpen, setAtOpen] = useState(false)

  const fileRef = useRef<HTMLInputElement | null>(null)
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const hlRef = useRef<HTMLDivElement | null>(null)
  const caretRef = useRef(0)
  const listRef = useRef<HTMLDivElement | null>(null)

  // 新消息进来 → 滚到底
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  const pickImages = async (files: FileList | null) => {
    if (!files?.length) return
    const room = MAX_IMAGES - images.length
    if (room <= 0) {
      showToast(`最多上传 ${MAX_IMAGES} 张图片`, 'info')
      return
    }
    const sel = Array.from(files).slice(0, room)
    const picked = (await Promise.all(sel.map((f) => fileToDataUrl(f).catch(() => null)))).filter(Boolean) as string[]
    if (picked.length) setImages((prev) => [...prev, ...picked])
  }
  const removeImage = (url: string) => {
    const idx = images.indexOf(url) // 被删图的 0-based 位置
    if (idx < 0) return
    setImages((prev) => prev.filter((_, i) => i !== idx)) // 仅删该位置(重复 URL 不会被一起删掉)
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
  const canSubmit = (cleanText.length > 0 || images.length > 0) && !busy
  const submit = () => {
    if (!canSubmit) return
    onSend(cleanText, images, ratio)
    setText('')
    setImages([])
    setAtOpen(false)
    caretRef.current = 0
  }

  return (
    <div className={styles.chat}>
      {/* 消息流 */}
      <div className={styles.list} ref={listRef}>
        {messages.map((msg) =>
          msg.role === 'user' ? (
            <div className={`${styles.row} ${styles.user}`} key={msg.id}>
              <div className={styles.userCol}>
                {!!msg.images?.length && (
                  <div className={styles.userImgs}>
                    {msg.images.map((im, i) => (
                      <img className={styles.userImg} src={im.url} alt="" key={im.url + i} />
                    ))}
                  </div>
                )}
                {!!msg.text && <div className={styles.userBubble}>{renderHighlight(msg.text)}</div>}
              </div>
            </div>
          ) : (
            <div className={`${styles.row} ${styles.ai}`} key={msg.id}>
              <div className={styles.aiCol}>
                {msg.status === 'pending' ? (
                  <div className={styles.pending}>
                    <span className={styles.spin} aria-hidden="true" />
                    营销图片生成中…
                  </div>
                ) : msg.status === 'error' ? (
                  <div className={styles.aiError}>{msg.error || '生成失败,请重试'}</div>
                ) : (
                  <>
                    {!!msg.text && <div className={styles.aiText}>{msg.text}</div>}
                    {!!msg.images?.length && (
                      <div className={styles.aiImgs}>
                        {msg.images.map((im, i) => (
                          <img className={styles.aiImg} src={im.url} alt="" key={im.url + i} />
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
        {onNewChat && (
          <div className={styles.footerHead}>
            <button type="button" className={styles.newChat} onClick={onNewChat}>
              创建新对话
            </button>
          </div>
        )}
        <div className={styles.card}>
          {images.length > 0 && (
            <div className={styles.attachments}>
              {images.map((url) => (
                <div className={styles.thumb} key={url}>
                  <img src={url} alt="" />
                  <button type="button" className={styles.thumbX} onClick={() => removeImage(url)} aria-label="移除">
                    ×
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
                value={text}
                placeholder={PLACEHOLDER}
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
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
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
              />
              <span className={styles.atAnchor}>
                <button type="button" className={styles.pillBtn} onClick={handleAt} title="引用参考素材">
                  @
                </button>
                {atOpen && (
                  <>
                    <div className={styles.atMask} onClick={() => setAtOpen(false)} />
                    <div className={styles.atMenu}>
                      <div className={styles.atMenuTitle}>选择参考素材</div>
                      <div className={styles.atMenuGrid}>
                        {images.map((url, i) => (
                          <button type="button" className={styles.atItem} key={url} onClick={() => pickRef(i)}>
                            <img src={url} alt="" />
                            <span className={styles.atItemName}>@图片{i + 1}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </span>
            </div>

            {costText && (
              <span className={`${styles.cost}${costInsufficient ? ' ' + styles.costErr : ''}`}>
                {costText}
                {costInsufficient && (
                  <>
                    {' · 积分不足,'}
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
              title="生成(Ctrl/⌘ + Enter)"
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
    </div>
  )
}
