/**
 * 智能成片「制作图片」对话视图(2.1,按 Figma 664:2740 还原)。
 * 与「制作视频」的 4 步流程不同:图片模式是 chat 聊天形式 —— 上方可滚动消息流
 * (用户气泡靠右 + 上传图缩略图;AI 回复靠左,文字 + 生成图),输入框沉底。
 * 输入框工具栏只保留「比例(16:9)」与「@ 引用素材」两项(不含时长/SKILLS)。
 * 每次发送 → 调父级 onSend(文本, 参考图, 比例),由父级出图并把结果追加到 messages。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import EntryDropdown from '../EntryDropdown'
import { fileToDataUrl } from '@/utils/imageFile'
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
  onSend: (text: string, images: string[], ratio: string) => void
  /** 「创建新对话」:清空会话回到入口 */
  onNewChat?: () => void
}

const RATIO_OPTIONS = ['16:9', '9:16', '1:1', '4:3', '3:4']
const MAX_IMAGES = 9
const PLACEHOLDER =
  '最多上传9张图片，输入文字或@参考素材，生成精彩广告图片。例如：把 @图片1 中的产品放到 @图片2 中的场景里'

// 高亮渲染匹配:@图片N(绿)
const HL_RE = /@图片\d+/g

export default function ImageChat({ messages, initialRatio, busy, onSend, onNewChat }: ImageChatProps) {
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
  const removeImage = (url: string) => setImages((prev) => prev.filter((u) => u !== url))

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
                icon={
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7">
                    <rect x="3" y="6" width="18" height="12" rx="2" />
                  </svg>
                }
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

            <button
              type="button"
              className={styles.send}
              disabled={!canSubmit}
              onClick={submit}
              aria-label="生成"
              title="生成(Ctrl/⌘ + Enter)"
            >
              <svg
                width="40"
                height="40"
                viewBox="0 0 40 40"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <path
                  d="M34.1395 5.85926C26.3291 -1.95309 13.6662 -1.95309 5.85779 5.85926C-1.95064 13.6716 -1.95455 26.332 5.85779 34.1424C13.6701 41.9528 26.3305 41.9523 34.1409 34.1424C41.9513 26.3325 41.9494 13.6677 34.1395 5.85926ZM30.6669 18.5416L22.8687 24.4673C22.8072 24.5144 22.7338 24.5435 22.6567 24.5512C22.5796 24.5589 22.5019 24.545 22.4323 24.5109C22.3627 24.4769 22.304 24.4241 22.2627 24.3585C22.2215 24.2929 22.1993 24.2171 22.1988 24.1397V21.4981C22.1983 21.3926 22.1577 21.2911 22.0851 21.2145C22.0126 21.1378 21.9135 21.0917 21.8082 21.0855C18.2711 20.8629 15.1711 21.2349 13.072 23.4409C11.9978 24.5703 10.7024 26.81 10.3924 27.4672C10.3484 27.56 10.2674 27.7319 10.0721 27.7968L10.055 27.8022C9.98791 27.8233 9.9166 27.8271 9.84765 27.8134C9.77869 27.7997 9.71431 27.7688 9.66045 27.7236C9.47589 27.5688 9.36407 27.475 10.1058 24.4468C11.3631 19.3199 16.2702 15.9689 21.8282 15.3527C21.9297 15.3421 22.0238 15.2944 22.0923 15.2187C22.1607 15.143 22.1989 15.0447 22.1993 14.9426V12.2883C22.2002 12.2111 22.2227 12.1357 22.264 12.0704C22.3054 12.0052 22.3641 11.9528 22.4335 11.919C22.503 11.8852 22.5804 11.8714 22.6573 11.8791C22.7341 11.8868 22.8073 11.9157 22.8687 11.9627L30.6669 17.8864C30.7176 17.9246 30.7588 17.9741 30.7872 18.0309C30.8155 18.0878 30.8303 18.1505 30.8303 18.214C30.8303 18.2775 30.8155 18.3402 30.7872 18.3971C30.7588 18.4539 30.7176 18.5034 30.6669 18.5416Z"
                  fill={canSubmit ? '#1FCFA9' : '#D9D9D9'}
                />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
