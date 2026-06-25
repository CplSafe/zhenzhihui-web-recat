/**
 * HelpCenter — 全局帮助中心(可拖拽悬浮球 + 弹出面板)。
 * - 悬浮球可上下/自由拖动,位置记忆到 localStorage;点击(未拖动)弹出/收起面板。
 * - 面板无遮罩,锚定在球附近(按球所在象限决定向上/下、左/右展开);点击外部关闭。
 * - 主面板按设计稿还原:问候标题 + 搜索框 + 菜单卡(教程/帮助中心/学习中心)+ 快捷卡(意见反馈/智能客服)。
 * - 子页面:帮助中心 FAQ(手风琴)/ 学习中心(教程列表)/ 智能客服 / 意见反馈。
 * - 内容暂为前端占位;搜索与反馈提交先走 toast,后端就绪后替换。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useToast } from '@/composables/useToast'
import './HelpCenter.css'

const POS_KEY = 'zzh_help_ball_pos'
const BALL = 56
const MARGIN = 8
const GAP = 16
const CARD_W = 360

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

const SUB_TITLES: Record<Exclude<View, 'home'>, string> = {
  faq: '帮助中心',
  tutorial: '学习中心',
  contact: '智能客服',
  feedback: '意见反馈',
}

function clampPos(p: Pos): Pos {
  const maxX = Math.max(MARGIN, window.innerWidth - BALL - MARGIN)
  const maxY = Math.max(MARGIN, window.innerHeight - BALL - MARGIN)
  return {
    x: Math.min(Math.max(MARGIN, p.x), maxX),
    y: Math.min(Math.max(MARGIN, p.y), maxY),
  }
}

export default function HelpCenter() {
  const { showToast } = useToast()
  const [pos, setPos] = useState<Pos | null>(null)
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<View>('home')
  const [openFaq, setOpenFaq] = useState<number>(-1)
  const [query, setQuery] = useState('')
  const [feedback, setFeedback] = useState('')
  const [contact, setContact] = useState('')

  const ballRef = useRef<HTMLButtonElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const posRef = useRef<Pos>({ x: 0, y: 0 })
  const drag = useRef({ dragging: false, moved: false, offX: 0, offY: 0, startX: 0, startY: 0 })

  const setPosBoth = useCallback((p: Pos) => {
    const c = clampPos(p)
    posRef.current = c
    setPos(c)
  }, [])

  // 初始化位置:localStorage 记忆,否则默认右下角(距右、距底各 24px)
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

  // 窗口缩放时把球夹回视口内
  useEffect(() => {
    function onResize() {
      if (posRef.current) setPosBoth(posRef.current)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [setPosBoth])

  // 点击面板外部关闭
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

  const onSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      if (!query.trim()) return
      // 占位:全局搜索接口就绪后替换为真实跳转 / 检索
      showToast('搜索功能即将上线', 'info')
    },
    [query, showToast],
  )

  const submitFeedback = useCallback(() => {
    if (!feedback.trim()) {
      showToast('请先填写反馈内容', 'info')
      return
    }
    // 占位:后端反馈接口就绪后替换为真实提交
    showToast('感谢反馈,我们会尽快处理', 'success')
    setFeedback('')
    setContact('')
    setView('home')
  }, [feedback, showToast])

  if (!pos) return null

  const openLeft = pos.x + BALL / 2 > window.innerWidth / 2
  const openUp = pos.y + BALL / 2 > window.innerHeight / 2
  const panelStyle: React.CSSProperties = {
    width: CARD_W,
    [openLeft ? 'right' : 'left']: openLeft ? window.innerWidth - (pos.x + BALL) : pos.x,
    [openUp ? 'bottom' : 'top']: openUp ? window.innerHeight - pos.y + GAP : pos.y + BALL + GAP,
  }

  return (
    <div ref={rootRef} className="hc-root">
      {open && (
        <div className="hc-panel" style={panelStyle} role="dialog" aria-label="帮助中心">
          {view === 'home' ? (
            <div className="hc-home">
              <div className="hc-greet">
                <span>你好!</span>
                <span>我能帮上什么忙?</span>
              </div>

              <form className="hc-search" onSubmit={onSearch}>
                <input
                  className="hc-search-input"
                  value={query}
                  maxLength={60}
                  placeholder="搜索模板、项目、IP…"
                  onChange={(e) => setQuery(e.target.value)}
                />
                <button type="submit" className="hc-search-btn" aria-label="搜索">
                  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                    <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="1.8" />
                    <path
                      d="M20 20l-3.6-3.6"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </form>

              <div className="hc-menu-card">
                <button type="button" className="hc-menu-item" onClick={() => showToast('教程即将上线', 'info')}>
                  <span className="hc-menu-ic">
                    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                      <path d="M13 2 4 14h6l-1 8 9-12h-6z" fill="currentColor" />
                    </svg>
                  </span>
                  <span className="hc-menu-text">2 分钟学会使用帧智汇</span>
                  <ChevronRight />
                </button>
                <button type="button" className="hc-menu-item" onClick={() => setView('faq')}>
                  <span className="hc-menu-ic">
                    <svg
                      viewBox="0 0 24 24"
                      width="22"
                      height="22"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M9.5 17.5h5" />
                      <path d="M10 21h4" />
                      <path d="M12 3a6 6 0 0 0-4 10.4c.7.6 1 1.3 1 2.1h6c0-.8.3-1.5 1-2.1A6 6 0 0 0 12 3z" />
                    </svg>
                  </span>
                  <span className="hc-menu-text">帮助中心</span>
                  <ChevronRight />
                </button>
                <button type="button" className="hc-menu-item" onClick={() => setView('tutorial')}>
                  <span className="hc-menu-ic">
                    <svg
                      viewBox="0 0 24 24"
                      width="22"
                      height="22"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M2 9.2 12 5l10 4.2-10 4.2z" />
                      <path d="M6 11.2V16c0 1.1 2.7 2.6 6 2.6s6-1.5 6-2.6v-4.8" />
                      <path d="M22 9.2v5" />
                    </svg>
                  </span>
                  <span className="hc-menu-text">学习中心</span>
                  <ChevronRight />
                </button>
              </div>

              <div className="hc-quick-card">
                <button type="button" className="hc-quick" onClick={() => setView('feedback')}>
                  <span className="hc-quick-ic">
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
                      <rect x="3" y="5" width="18" height="14" rx="2.5" />
                      <path d="m3.5 7 8.5 6 8.5-6" />
                    </svg>
                  </span>
                  意见反馈
                </button>
                <button type="button" className="hc-quick" onClick={() => setView('contact')}>
                  <span className="hc-quick-ic">
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
                      <rect x="4" y="8.5" width="16" height="10.5" rx="3" />
                      <path d="M12 8.5V5" />
                      <circle cx="12" cy="4" r="1.2" fill="currentColor" stroke="none" />
                      <circle cx="9.2" cy="13.4" r="1.1" fill="currentColor" stroke="none" />
                      <circle cx="14.8" cy="13.4" r="1.1" fill="currentColor" stroke="none" />
                    </svg>
                  </span>
                  智能客服
                </button>
              </div>
            </div>
          ) : (
            <div className="hc-sub">
              <div className="hc-sub-head">
                <button type="button" className="hc-back" aria-label="返回" onClick={goHome}>
                  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                    <path
                      d="M10 3 5 8l5 5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                <strong>{SUB_TITLES[view]}</strong>
              </div>

              <div className="hc-sub-body">
                {view === 'faq' && (
                  <div className="hc-sub-card">
                    <ul className="hc-faq">
                      {FAQ.map((item, i) => (
                        <li key={i} className={`hc-faq-item${openFaq === i ? ' is-open' : ''}`}>
                          <button type="button" className="hc-faq-q" onClick={() => setOpenFaq(openFaq === i ? -1 : i)}>
                            <span>{item.q}</span>
                            <svg className="hc-faq-arrow" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                              <path
                                d="M4 6l4 4 4-4"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.6"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </button>
                          {openFaq === i && <div className="hc-faq-a">{item.a}</div>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {view === 'tutorial' && (
                  <div className="hc-sub-card">
                    <ul className="hc-list">
                      {TUTORIALS.map((t, i) => (
                        <li key={i}>
                          <button
                            type="button"
                            className="hc-list-item"
                            onClick={() => showToast('教程即将上线', 'info')}
                          >
                            <span className="hc-list-no">{i + 1}</span>
                            <span className="hc-list-text">{t}</span>
                            <ChevronRight />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {view === 'contact' && (
                  <div className="hc-sub-card hc-contact">
                    <div className="hc-qr">
                      <div className="hc-qr-box" aria-hidden="true" />
                      <span>微信扫码联系客服</span>
                    </div>
                    <ul className="hc-contact-list">
                      <li>
                        <span>在线客服</span>
                        <em>工作日 9:00–18:00</em>
                      </li>
                      <li>
                        <span>客服微信</span>
                        <em>zhenzhihui-helper</em>
                      </li>
                      <li>
                        <span>客服电话</span>
                        <a href="tel:400-000-0000">400-000-0000</a>
                      </li>
                      <li>
                        <span>邮箱</span>
                        <a href="mailto:support@zhenzhihui.com">support@zhenzhihui.com</a>
                      </li>
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
            </div>
          )}
        </div>
      )}

      <button
        ref={ballRef}
        type="button"
        className={`hc-ball${open ? ' is-open' : ''}`}
        style={{ left: pos.x, top: pos.y }}
        aria-label="帮助中心"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <svg className="hc-ball-ic" viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
          <path
            d="M6 15l6-6 6 6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  )
}

function ChevronRight() {
  return (
    <svg className="hc-chevron" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M6 3l5 5-5 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
