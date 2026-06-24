/**
 * HelpCenter — 全局 AI 助手(可拖拽悬浮球 + 弹出面板)。
 * - 悬浮球可自由拖动,位置记忆到 localStorage;点击(未拖动)弹出/收起面板。
 * - 面板首屏(home)按 Figma「AI 助手悬浮球」:问候 + 搜索 + 帮助/学习 + 反馈/客服。
 * - 入口复用既有子视图:帮助中心(FAQ)/ 学习中心(教程)/ 意见反馈 / 智能客服。
 * - 内容暂为前端占位,后端就绪后替换;搜索为占位。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useToast } from '@/composables/useToast'
import './HelpCenter.css'

const POS_KEY = 'zzh_help_ball_pos'
const BALL = 56
const MARGIN = 8
const GAP = 14
const CARD_W = 384

type View = 'home' | 'faq' | 'tutorial' | 'contact' | 'feedback'
interface Pos {
  x: number
  y: number
}

const FAQ: { q: string; a: string }[] = [
  {
    q: '如何用「智能成片」快速生成一条视频?',
    a: '在首页进入「智能成片」,输入创作需求并准备素材,系统会依次生成分镜脚本、分镜图,再编排镜头后一键生成视频。每一步都可手动微调。',
  },
  {
    q: '生成视频会消耗多少算力 / 积分?',
    a: '不同模型与时长消耗不同,生成前的面板会显示预计消耗。可在「会员中心」查看余额与消耗明细。',
  },
  {
    q: '分镜图 / 视频生成失败了怎么办?',
    a: '通常是素材不符合要求或模型临时繁忙。可在对应分镜上点「重试」,或更换素材 / 切换模型后重新生成。',
  },
  {
    q: '上传素材支持哪些格式和大小?',
    a: '图片支持 JPG / PNG / WebP,视频支持 MP4。单个文件建议不超过 200MB,过大文件请先压缩。',
  },
  {
    q: '「爆款复制」怎么用?',
    a: '上传一条爆款源视频 + 1~9 张替换主体图,系统会按源视频的节奏与运镜,替换为你的主体,一次成片。',
  },
]

const TUTORIALS = ['3 分钟上手智能成片', '如何编排镜头与时间线', '如何替换 / 编辑分镜图', '爆款复制实操指南']

function clampPos(p: Pos): Pos {
  const maxX = Math.max(MARGIN, window.innerWidth - BALL - MARGIN)
  const maxY = Math.max(MARGIN, window.innerHeight - BALL - MARGIN)
  return {
    x: Math.min(Math.max(MARGIN, p.x), maxX),
    y: Math.min(Math.max(MARGIN, p.y), maxY),
  }
}

// ── 面板图标(内联,描边色 currentColor)──
const IconSearch = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.2-3.2" />
  </svg>
)
const IconPlay = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M10 8.5l5 3.5-5 3.5z" fill="currentColor" stroke="none" />
  </svg>
)
const IconHelp = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M9.3 9a2.7 2.7 0 1 1 4 2.5c-.9.5-1.3 1-1.3 2" />
    <circle cx="12" cy="16.5" r="0.9" fill="currentColor" stroke="none" />
  </svg>
)
const IconBook = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 5.5A2 2 0 0 1 6 4h6v15H6a2 2 0 0 0-2 1.5z" />
    <path d="M20 5.5A2 2 0 0 0 18 4h-6v15h6a2 2 0 0 1 2 1.5z" />
  </svg>
)
const IconPen = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
)
const IconChat = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.5 9 9 0 0 1-4-1L3 20l1-3.5a8.4 8.4 0 0 1-1-4A8.5 8.5 0 0 1 21 11.5z" />
  </svg>
)

export default function HelpCenter() {
  const { showToast } = useToast()
  const [pos, setPos] = useState<Pos | null>(null)
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<View>('home')
  const [openFaq, setOpenFaq] = useState<number>(-1)
  const [feedback, setFeedback] = useState('')
  const [contact, setContact] = useState('')
  const [search, setSearch] = useState('')

  const ballRef = useRef<HTMLButtonElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const posRef = useRef<Pos>({ x: 0, y: 0 })
  const drag = useRef({ dragging: false, moved: false, offX: 0, offY: 0, startX: 0, startY: 0 })

  const setPosBoth = useCallback((p: Pos) => {
    const c = clampPos(p)
    posRef.current = c
    setPos(c)
  }, [])

  useEffect(() => {
    let init: Pos | null = null
    try {
      const saved = localStorage.getItem(POS_KEY)
      if (saved) {
        const p = JSON.parse(saved)
        if (typeof p?.x === 'number' && typeof p?.y === 'number') init = p
      }
    } catch {
      init = null
    }
    if (!init) init = { x: window.innerWidth - BALL - 24, y: window.innerHeight - BALL - 24 }
    setPosBoth(init)
  }, [setPosBoth])

  useEffect(() => {
    function onResize() {
      if (posRef.current) setPosBoth(posRef.current)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [setPosBoth])

  useEffect(() => {
    if (!open) return
    function onDocPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDocPointerDown)
    return () => document.removeEventListener('pointerdown', onDocPointerDown)
  }, [open])

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!pos) return
      ballRef.current?.setPointerCapture(e.pointerId)
      drag.current = {
        dragging: true,
        moved: false,
        offX: e.clientX - pos.x,
        offY: e.clientY - pos.y,
        startX: e.clientX,
        startY: e.clientY,
      }
    },
    [pos],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const st = drag.current
      if (!st.dragging) return
      if (!st.moved && Math.hypot(e.clientX - st.startX, e.clientY - st.startY) > 5) st.moved = true
      if (st.moved) setPosBoth({ x: e.clientX - st.offX, y: e.clientY - st.offY })
    },
    [setPosBoth],
  )

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const st = drag.current
    if (!st.dragging) return
    st.dragging = false
    ballRef.current?.releasePointerCapture?.(e.pointerId)
    if (st.moved) {
      try {
        localStorage.setItem(POS_KEY, JSON.stringify(posRef.current))
      } catch {
        /* 忽略存储失败(隐私模式等) */
      }
    } else {
      setOpen((o) => !o)
    }
  }, [])

  const goHome = useCallback(() => setView('home'), [])
  const submitFeedback = useCallback(() => {
    if (!feedback.trim()) {
      showToast('请先填写反馈内容', 'info')
      return
    }
    showToast('感谢反馈,我们会尽快处理', 'success')
    setFeedback('')
    setContact('')
    setView('home')
  }, [feedback, showToast])

  if (!pos) return null

  const openLeft = pos.x + BALL / 2 > window.innerWidth / 2
  const openUp = pos.y + BALL / 2 > window.innerHeight / 2
  const cardStyle: React.CSSProperties = {
    width: CARD_W,
    [openLeft ? 'right' : 'left']: openLeft ? window.innerWidth - (pos.x + BALL) : pos.x,
    [openUp ? 'bottom' : 'top']: openUp ? window.innerHeight - pos.y + GAP : pos.y + BALL + GAP,
  }

  const subTitle = view === 'faq' ? '帮助中心' : view === 'tutorial' ? '学习中心' : view === 'contact' ? '智能客服' : '意见反馈'

  return (
    <div ref={rootRef} className="hc-root">
      {open && (
        <div className={`hc-card${view === 'home' ? ' hc-card--ai' : ''}`} style={cardStyle} role="dialog" aria-label="AI 助手">
          {view === 'home' ? (
            <div className="hc-ai">
              <button type="button" className="hc-ai-close" aria-label="关闭" onClick={() => setOpen(false)}>
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                  <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                </svg>
              </button>

              <div className="hc-ai-greet">
                你好!
                <br />
                我能帮上什么忙?
              </div>

              <label className="hc-ai-search">
                <IconSearch />
                <input
                  value={search}
                  placeholder="搜索模板、项目、IP..."
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') showToast('搜索功能待开放', 'info')
                  }}
                />
              </label>

              <div className="hc-ai-card">
                <button type="button" className="hc-ai-row" onClick={() => showToast('教程视频即将上线', 'info')}>
                  <span className="hc-ai-row-ic"><IconPlay /></span>
                  <span className="hc-ai-row-text">2分钟学会使用帧智汇</span>
                  <ChevronRight />
                </button>
                <div className="hc-ai-divider" />
                <button type="button" className="hc-ai-row" onClick={() => setView('faq')}>
                  <span className="hc-ai-row-ic"><IconHelp /></span>
                  <span className="hc-ai-row-text">帮助中心</span>
                  <ChevronRight />
                </button>
                <div className="hc-ai-divider" />
                <button type="button" className="hc-ai-row" onClick={() => setView('tutorial')}>
                  <span className="hc-ai-row-ic"><IconBook /></span>
                  <span className="hc-ai-row-text">学习中心</span>
                  <ChevronRight />
                </button>
              </div>

              <div className="hc-ai-card hc-ai-card--row">
                <button type="button" className="hc-ai-col" onClick={() => setView('feedback')}>
                  <span className="hc-ai-col-ic"><IconPen /></span>
                  意见反馈
                </button>
                <span className="hc-ai-vline" />
                <button type="button" className="hc-ai-col" onClick={() => setView('contact')}>
                  <span className="hc-ai-col-ic"><IconChat /></span>
                  智能客服
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="hc-head">
                <button type="button" className="hc-head-btn" aria-label="返回" onClick={goHome}>
                  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                    <path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <div className="hc-head-titles">
                  <strong>{subTitle}</strong>
                </div>
                <button type="button" className="hc-head-btn" aria-label="关闭" onClick={() => setOpen(false)}>
                  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                    <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                  </svg>
                </button>
              </div>

              <div className="hc-body">
                {view === 'faq' && (
                  <ul className="hc-faq">
                    {FAQ.map((item, i) => (
                      <li key={i} className={`hc-faq-item${openFaq === i ? ' is-open' : ''}`}>
                        <button type="button" className="hc-faq-q" onClick={() => setOpenFaq(openFaq === i ? -1 : i)}>
                          <span>{item.q}</span>
                          <svg className="hc-faq-arrow" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                            <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                        {openFaq === i && <div className="hc-faq-a">{item.a}</div>}
                      </li>
                    ))}
                  </ul>
                )}

                {view === 'tutorial' && (
                  <ul className="hc-list">
                    {TUTORIALS.map((t, i) => (
                      <li key={i}>
                        <button type="button" className="hc-list-item" onClick={() => showToast('教程即将上线', 'info')}>
                          <span className="hc-list-no">{i + 1}</span>
                          <span className="hc-list-text">{t}</span>
                          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                            <path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {view === 'contact' && (
                  <div className="hc-contact">
                    <div className="hc-qr">
                      <div className="hc-qr-box" aria-hidden="true" />
                      <span>微信扫码联系客服</span>
                    </div>
                    <ul className="hc-contact-list">
                      <li><span>在线客服</span><em>工作日 9:00–18:00</em></li>
                      <li><span>客服微信</span><em>zhenzhihui-helper</em></li>
                      <li><span>客服电话</span><a href="tel:400-000-0000">400-000-0000</a></li>
                      <li><span>邮箱</span><a href="mailto:support@zhenzhihui.com">support@zhenzhihui.com</a></li>
                    </ul>
                  </div>
                )}

                {view === 'feedback' && (
                  <div className="hc-feedback">
                    <textarea
                      className="hc-textarea"
                      value={feedback}
                      maxLength={500}
                      placeholder="遇到的问题或建议,越具体我们越能帮上忙…"
                      onChange={(e) => setFeedback(e.target.value)}
                    />
                    <input
                      className="hc-input"
                      value={contact}
                      maxLength={60}
                      placeholder="联系方式(选填,便于回复)"
                      onChange={(e) => setContact(e.target.value)}
                    />
                    <button type="button" className="hc-submit" onClick={submitFeedback}>
                      提交反馈
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      <button
        ref={ballRef}
        type="button"
        className={`hc-ball${open ? ' is-open' : ''}`}
        style={{ left: pos.x, top: pos.y }}
        aria-label="AI 助手"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {open ? (
          <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
            <path d="M6 14l6-6 6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
            <path d="M12 3l1.7 4.1L18 8.8l-4.3 1.7L12 15l-1.7-4.5L6 8.8l4.3-1.7z" fill="currentColor" />
            <circle cx="18" cy="16.5" r="1.6" fill="currentColor" />
          </svg>
        )}
      </button>
    </div>
  )
}

const ChevronRight = () => (
  <svg className="hc-ai-row-arrow" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
