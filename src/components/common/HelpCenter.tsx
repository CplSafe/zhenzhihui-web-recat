/**
 * HelpCenter — 全局 AI 助手(可拖拽悬浮球 + 弹出面板)。
 * - 悬浮球可自由拖动,位置记忆到 localStorage;点击(未拖动)弹出/收起面板。
 * - 面板首屏(home)按 Figma「AI 助手悬浮球」:问候 + 搜索 + 帮助/学习 + 反馈/客服。
 * - 入口复用既有子视图:帮助中心(FAQ)/ 学习中心(教程)/ 意见反馈 / 智能客服。
 * - 内容暂为前端占位,后端就绪后替换;搜索为占位。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useToast } from '@/composables/useToast'
import { uploadAssetFile } from '@/api/business'
import {
  listFeedbackTypes,
  listMyFeedback,
  submitFeedback as apiSubmitFeedback,
  type FeedbackRecord,
} from '@/api/feedback'
import { useWorkspaceId } from '@/stores/workspaceSession'
import { guideKeyForPath, guideLabelForPath, openGuide } from '@/stores/guide'
import kefuQr from '@/assets/kefu-qr.png'
import helpBallIcon from '@/assets/1f7fa9801ef8d3ffb61b903b44f58fc3.png'
import './HelpCenter.css'

// 使用教程:跳转外部飞书文档(「2分钟学会使用帧智汇」「3分钟上手智能成片」共用)
const FEISHU_GUIDE_URL = 'https://zcnyqlah2rse.feishu.cn/wiki/LeMwwtrRQiJyxKkMepOcnbIDnvg'
// 爆款复制实操指南(飞书文档)
const HOTCOPY_GUIDE_URL = 'https://zcnyqlah2rse.feishu.cn/wiki/EuaXw2pNHin1abkRVx5ci1yVnhd'
const openGuideDoc = () => window.open(FEISHU_GUIDE_URL, '_blank', 'noopener,noreferrer')

// 固定反馈类型(按设计):功能反馈带子分类下拉,优化建议 / 其他反馈为普通项。
// 后端 feedback_type 仍按名称匹配 /feedback-types 的 id(匹配不到用首个兜底,完整分类写进 content)。
const FB_TOP: { k: string; label: string; subs: string[] }[] = [
  { k: 'feature', label: '功能反馈', subs: ['生成效果不佳', '生成失败或异常', '工具使用问题', '账户与权益'] },
  { k: 'optimize', label: '优化建议', subs: [] },
  { k: 'other', label: '其他反馈', subs: [] },
]
// 各类型(按名称匹配)的动态追问 + 多选项 + 提示;多选项会拼进 content 一起提交
const FB_DETAILS: Record<string, { q: string; opts: string[]; hint: string }> = {
  生成效果不佳: {
    q: '具体是哪里不满意?',
    opts: ['人物脸部崩坏', '肢体扭曲', '画面闪烁', '运镜混乱', '风格不符', '声音/口型问题'],
    hint: '可补充:出问题的分镜、所用提示词,有截图更好。',
  },
  生成失败或异常: {
    q: '遇到的是哪种情况?',
    opts: ['一直排队', '生成中断', '报错提示', '下载失败'],
    hint: '可补充:报错文案、发生时间、所在项目。',
  },
  工具使用问题: {
    q: '哪个环节出了问题?',
    opts: ['时间轴卡顿', '素材无法上传', '特效不生效', '预览黑屏'],
    hint: '可补充:所在页面、操作步骤、浏览器。',
  },
  账户与权益: {
    q: '具体是什么问题?',
    opts: ['积分/算力扣除异常', '会员未生效', '充值问题'],
    hint: '可补充:订单号、扣费时间、预期与实际。',
  },
  产品建议与需求: {
    q: '你的诉求是?',
    opts: ['希望增加某功能', '优化某流程', '求新增某模板'],
    hint: '说说你的使用场景和期望效果,越具体越好。',
  },
}
const FB_MAX_IMAGES = 3 // 附件数量上限(图片 / 短视频)
const FB_MAX_FILE_MB = 50 // 单个附件大小上限
const FB_MAX_LEN = 200

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

// 学习中心条目;有 url 的可点开飞书文档,无 url 显示「即将上线」。
// 「爆款复制实操指南」(带新链接)已移到第 2 位。
const TUTORIALS: { title: string; url?: string }[] = [
  { title: '3 分钟上手智能成片', url: FEISHU_GUIDE_URL },
  { title: '爆款复制实操指南', url: HOTCOPY_GUIDE_URL },
  { title: '如何编排镜头与时间线' },
  { title: '如何替换 / 编辑分镜图' },
]

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
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
  >
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.2-3.2" />
  </svg>
)
const IconPlay = () => (
  <svg
    viewBox="0 0 24 24"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M10 8.5l5 3.5-5 3.5z" fill="currentColor" stroke="none" />
  </svg>
)
const IconHelp = () => (
  <svg
    viewBox="0 0 24 24"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M9.3 9a2.7 2.7 0 1 1 4 2.5c-.9.5-1.3 1-1.3 2" />
    <circle cx="12" cy="16.5" r="0.9" fill="currentColor" stroke="none" />
  </svg>
)
const IconBook = () => (
  <svg
    viewBox="0 0 24 24"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M4 5.5A2 2 0 0 1 6 4h6v15H6a2 2 0 0 0-2 1.5z" />
    <path d="M20 5.5A2 2 0 0 0 18 4h-6v15h6a2 2 0 0 1 2 1.5z" />
  </svg>
)
const IconPen = () => (
  <svg
    viewBox="0 0 24 24"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
)
const IconChat = () => (
  <svg
    viewBox="0 0 24 24"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.5 9 9 0 0 1-4-1L3 20l1-3.5a8.4 8.4 0 0 1-1-4A8.5 8.5 0 0 1 21 11.5z" />
  </svg>
)

export default function HelpCenter() {
  const { showToast } = useToast()
  const location = useLocation() // 当前路由:用于「新手引导」按页分类展示 + 定位对应引导
  const workspaceId = Number(useWorkspaceId() || 0)
  const [pos, setPos] = useState<Pos | null>(null)
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<View>('home')
  const [openFaq, setOpenFaq] = useState<number>(-1)
  const [feedback, setFeedback] = useState('')
  const [contact, setContact] = useState('')
  const [search, setSearch] = useState('')
  // 反馈类型来自接口(/feedback-types);为空时用 FB_FALLBACK_TYPES 兜底
  const [fbTypes, setFbTypes] = useState<{ id: number; name: string }[]>([])
  const [fbTop, setFbTop] = useState('feature') // 选中的顶层类型 key
  const [fbSub, setFbSub] = useState(FB_TOP[0].subs[0]) // 功能反馈下的子分类
  const [fbDropOpen, setFbDropOpen] = useState(false) // 功能反馈子分类下拉是否展开
  const [fbTags, setFbTags] = useState<string[]>([])
  const [fbImages, setFbImages] = useState<{ url: string; file: File }[]>([])
  const [fbTab, setFbTab] = useState<'submit' | 'history'>('submit')
  const [fbSubmitting, setFbSubmitting] = useState(false)
  const [fbHistory, setFbHistory] = useState<FeedbackRecord[]>([])
  const [fbHistoryLoading, setFbHistoryLoading] = useState(false)
  const fbFileRef = useRef<HTMLInputElement>(null)

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
  // 点顶层类型:功能反馈 → 选中并切换下拉;其余 → 选中并收起下拉。切换时清空多选标签
  const pickTop = useCallback((k: string) => {
    setFbTags([])
    setFbDropOpen((prev) => (k === 'feature' ? !prev : false))
    setFbTop(k)
  }, [])
  // 选子分类:归到功能反馈,收起下拉
  const pickSub = useCallback((name: string) => {
    setFbSub(name)
    setFbTop('feature')
    setFbDropOpen(false)
    setFbTags([])
  }, [])
  const toggleTag = useCallback((tag: string) => {
    setFbTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]))
  }, [])

  // 进入反馈页拉取类型列表(空时用兜底名),并默认选中第一个
  useEffect(() => {
    if (view !== 'feedback') return
    let alive = true
    // 仍拉取后端类型,仅用于把固定分类按名称映射成 feedback_type id
    listFeedbackTypes().then((list) => {
      if (alive) setFbTypes(list)
    })
    return () => {
      alive = false
    }
  }, [view])

  // 切到「反馈历史」tab 时拉取历史
  useEffect(() => {
    if (view !== 'feedback' || fbTab !== 'history') return
    let alive = true
    setFbHistoryLoading(true)
    listMyFeedback({ limit: 20 })
      .then((list) => alive && setFbHistory(list))
      .finally(() => alive && setFbHistoryLoading(false))
    return () => {
      alive = false
    }
  }, [view, fbTab])

  const submitFeedback = useCallback(async () => {
    if (fbSubmitting) return
    if (!feedback.trim()) {
      showToast('请先填写反馈内容', 'info')
      return
    }
    const topDef = FB_TOP.find((t) => t.k === fbTop) || FB_TOP[0]
    const selectedName = fbTop === 'feature' ? fbSub : topDef.label
    // 后端 feedback_type id:按名称匹配(子分类 → 顶层名),都没有则用首个可用类型兜底
    const typeId =
      fbTypes.find((t) => t.name === selectedName)?.id ||
      fbTypes.find((t) => t.name === topDef.label)?.id ||
      fbTypes[0]?.id ||
      0
    if (!typeId) {
      showToast('反馈类型暂未配置,暂时无法提交,请联系管理员', 'info')
      return
    }
    setFbSubmitting(true)
    try {
      // ① 反馈图先上传成 asset(source=feedback)拿 asset_id
      let assetIds: number[] = []
      if (fbImages.length) {
        if (!workspaceId) {
          showToast('缺少 workspace,本次不带图提交', 'info')
        } else {
          const results = await Promise.all(
            fbImages.map((img) =>
              uploadAssetFile({ workspaceId, file: img.file, source: 'feedback' })
                .then((r: any) => Number(r?.asset?.id || 0) || 0)
                .catch(() => 0),
            ),
          )
          assetIds = results.filter(Boolean)
        }
      }
      // ② 把所选分类 + 多选标签拼进 content(后端类型粒度不够,避免丢信息)
      const catLine = fbTop === 'feature' ? `【功能反馈 / ${fbSub}】` : `【${topDef.label}】`
      const tagPart = fbTags.length ? ` ${fbTags.join('、')}` : ''
      const content = [catLine + tagPart, feedback.trim()].filter(Boolean).join('\n')
      await apiSubmitFeedback({ feedbackType: typeId, content, contact, assetIds })
      showToast('感谢反馈,我们会尽快处理', 'success')
      setFeedback('')
      setContact('')
      fbImages.forEach((img) => {
        try {
          URL.revokeObjectURL(img.url)
        } catch {
          /* ignore */
        }
      })
      setFbImages([])
      setFbTags([])
      setFbTop('feature')
      setFbSub(FB_TOP[0].subs[0])
      setFbDropOpen(false)
      setView('home')
    } catch (e: any) {
      showToast(e?.message || '提交失败,请稍后重试', 'error')
    } finally {
      setFbSubmitting(false)
    }
  }, [fbSubmitting, feedback, fbTop, fbSub, fbTypes, fbImages, workspaceId, fbTags, contact, showToast])

  if (!pos) return null

  const fbTopDef = FB_TOP.find((t) => t.k === fbTop) || FB_TOP[0]
  const fbSelectedName = fbTop === 'feature' ? fbSub : fbTopDef.label
  const fbDetail = FB_DETAILS[fbSelectedName] || { q: '', opts: [], hint: '' }
  const openLeft = pos.x + BALL / 2 > window.innerWidth / 2
  const openUp = pos.y + BALL / 2 > window.innerHeight / 2
  const cardStyle: React.CSSProperties = {
    width: CARD_W,
    [openLeft ? 'right' : 'left']: openLeft ? window.innerWidth - (pos.x + BALL) : pos.x,
    [openUp ? 'bottom' : 'top']: openUp ? window.innerHeight - pos.y + GAP : pos.y + BALL + GAP,
  }

  const subTitle =
    view === 'faq' ? '帮助中心' : view === 'tutorial' ? '学习中心' : view === 'contact' ? '智能客服' : '意见反馈'

  return (
    <div ref={rootRef} className="hc-root">
      {open && (
        <div
          className={`hc-card${view === 'home' ? ' hc-card--ai' : ''}${view === 'feedback' ? ' hc-card--fb' : ''}`}
          style={cardStyle}
          role="dialog"
          aria-label="AI 助手"
        >
          {view === 'home' ? (
            <div className="hc-ai">
              <button type="button" className="hc-ai-close" aria-label="关闭" onClick={() => setOpen(false)}>
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                  <path
                    d="M4 4l8 8M12 4l-8 8"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                  />
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
                {/* 新手引导放在第一位,按当前页分类:首页→「首页新手引导」,智能成片→「智能成片新手引导」 */}
                <button
                  type="button"
                  className="hc-ai-row"
                  onClick={() => {
                    const key = guideKeyForPath(location.pathname)
                    if (!key) {
                      showToast('本页暂无新手引导', 'info')
                      return
                    }
                    setOpen(false) // 收起帮助面板,露出引导蒙层
                    openGuide(key)
                  }}
                >
                  <span className="hc-ai-row-ic">
                    <IconHelp />
                  </span>
                  <span className="hc-ai-row-text">{guideLabelForPath(location.pathname)}</span>
                  <ChevronRight />
                </button>
                <div className="hc-ai-divider" />
                <button type="button" className="hc-ai-row" onClick={openGuideDoc}>
                  <span className="hc-ai-row-ic">
                    <IconPlay />
                  </span>
                  <span className="hc-ai-row-text">2分钟学会使用帧智汇</span>
                  <ChevronRight />
                </button>
                <div className="hc-ai-divider" />
                <button type="button" className="hc-ai-row" onClick={() => setView('faq')}>
                  <span className="hc-ai-row-ic">
                    <IconHelp />
                  </span>
                  <span className="hc-ai-row-text">帮助中心</span>
                  <ChevronRight />
                </button>
                <div className="hc-ai-divider" />
                <button type="button" className="hc-ai-row" onClick={() => setView('tutorial')}>
                  <span className="hc-ai-row-ic">
                    <IconBook />
                  </span>
                  <span className="hc-ai-row-text">学习中心</span>
                  <ChevronRight />
                </button>
              </div>

              <div className="hc-ai-card hc-ai-card--row">
                <button type="button" className="hc-ai-col" onClick={() => setView('feedback')}>
                  <span className="hc-ai-col-ic">
                    <IconPen />
                  </span>
                  意见反馈
                </button>
                <span className="hc-ai-vline" />
                <button type="button" className="hc-ai-col" onClick={() => setView('contact')}>
                  <span className="hc-ai-col-ic">
                    <IconChat />
                  </span>
                  智能客服
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="hc-head">
                <button type="button" className="hc-head-btn" aria-label="返回" onClick={goHome}>
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
                <div className="hc-head-titles">
                  <strong>{subTitle}</strong>
                </div>
                <button type="button" className="hc-head-btn" aria-label="关闭" onClick={() => setOpen(false)}>
                  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                    <path
                      d="M4 4l8 8M12 4l-8 8"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                    />
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
                )}

                {view === 'tutorial' && (
                  <ul className="hc-list">
                    {TUTORIALS.map((t, i) => (
                      <li key={i}>
                        <button
                          type="button"
                          className="hc-list-item"
                          onClick={() =>
                            t.url
                              ? window.open(t.url, '_blank', 'noopener,noreferrer')
                              : showToast('教程即将上线', 'info')
                          }
                        >
                          <span className="hc-list-no">{i + 1}</span>
                          <span className="hc-list-text">{t.title}</span>
                          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                            <path
                              d="M6 3l5 5-5 5"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.6"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {view === 'contact' && (
                  <div className="hc-contact">
                    <div className="hc-qr">
                      <img className="hc-qr-box" src={kefuQr} alt="微信扫码联系客服" />
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
                        <a href="tel:01068968819">010-6896-8819</a>
                      </li>
                      <li>
                        <span>邮箱</span>
                        <a href="mailto:support@bjzhenzhihui.cn">support@bjzhenzhihui.cn</a>
                      </li>
                    </ul>
                  </div>
                )}

                {view === 'feedback' && (
                  <div className="hc-fb">
                    <div className="hc-fb-tabs">
                      <button
                        type="button"
                        className={`hc-fb-tab${fbTab === 'submit' ? ' is-active' : ''}`}
                        onClick={() => setFbTab('submit')}
                      >
                        提交反馈
                      </button>
                      <button
                        type="button"
                        className={`hc-fb-tab${fbTab === 'history' ? ' is-active' : ''}`}
                        onClick={() => setFbTab('history')}
                      >
                        反馈历史
                      </button>
                    </div>

                    {fbTab === 'submit' ? (
                      <>
                        <div className="hc-fb-label">反馈类型</div>
                        <div className="hc-fb-chips">
                          {FB_TOP.map((t) => {
                            const isFeature = t.k === 'feature'
                            // 功能反馈选中态:其子分类被选中(顶层=feature);其余:顶层 key 匹配
                            const active = isFeature ? fbTop === 'feature' : fbTop === t.k
                            // 功能反馈 chip 上显示当前选中的子分类名
                            const chipLabel = isFeature && fbTop === 'feature' ? fbSub : t.label
                            return (
                              <div key={t.k} className={`hc-fb-chip-wrap${isFeature ? ' has-drop' : ''}`}>
                                <button
                                  type="button"
                                  className={`hc-fb-chip${active ? ' is-active' : ''}`}
                                  onClick={() => pickTop(t.k)}
                                >
                                  {chipLabel}
                                  {isFeature && (
                                    <svg
                                      className={`hc-fb-caret${fbDropOpen ? ' is-open' : ''}`}
                                      viewBox="0 0 16 16"
                                      width="12"
                                      height="12"
                                      aria-hidden="true"
                                    >
                                      <path
                                        d="M4 6l4 4 4-4"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="1.6"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                      />
                                    </svg>
                                  )}
                                </button>
                                {isFeature && fbDropOpen && (
                                  <div className="hc-fb-dropdown">
                                    {t.subs.map((s) => (
                                      <button
                                        type="button"
                                        key={s}
                                        className={`hc-fb-drop-item${fbTop === 'feature' && fbSub === s ? ' is-active' : ''}`}
                                        onClick={() => pickSub(s)}
                                      >
                                        {s}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>

                        <div className="hc-fb-label hc-fb-label--row">
                          <span>
                            反馈内容<em className="hc-fb-req">（必填）</em>
                          </span>
                          <span className="hc-fb-count">
                            {feedback.length}/{FB_MAX_LEN}
                          </span>
                        </div>
                        <textarea
                          className="hc-fb-textarea"
                          value={feedback}
                          maxLength={FB_MAX_LEN}
                          placeholder="请输入您的反馈与建议,我们将作为功能优化的主要参考"
                          onChange={(e) => setFeedback(e.target.value)}
                        />

                        {/* 多选标签:去掉追问标题,放在反馈内容下方;选中项拼进 content 提交 */}
                        {fbDetail.opts.length > 0 && (
                          <div className="hc-fb-tags">
                            {fbDetail.opts.map((opt) => (
                              <button
                                key={opt}
                                type="button"
                                className={`hc-fb-tag${fbTags.includes(opt) ? ' is-active' : ''}`}
                                onClick={() => toggleTag(opt)}
                              >
                                {opt}
                              </button>
                            ))}
                          </div>
                        )}

                        {fbDetail.hint && <p className="hc-fb-hint">{fbDetail.hint}</p>}

                        <div className="hc-fb-label">
                          附件<em className="hc-fb-opt">（选填）</em>
                        </div>
                        <p className="hc-fb-hint hc-fb-attach-tip">上传截图或录屏,能帮我们快 3 倍解决问题哦!</p>
                        <div className="hc-fb-uploads">
                          {fbImages.map((img, i) => {
                            const isVideo = img.file.type.startsWith('video')
                            return (
                              <div className="hc-fb-thumb" key={i}>
                                {isVideo ? (
                                  <video src={img.url} muted playsInline preload="metadata" />
                                ) : (
                                  <img src={img.url} alt="" />
                                )}
                                {isVideo && <span className="hc-fb-thumb-badge">视频</span>}
                                <button
                                  type="button"
                                  onClick={() => {
                                    try {
                                      URL.revokeObjectURL(img.url)
                                    } catch {
                                      /* ignore */
                                    }
                                    setFbImages((a) => a.filter((_, j) => j !== i))
                                  }}
                                  aria-label="移除"
                                >
                                  ×
                                </button>
                              </div>
                            )
                          })}
                          {fbImages.length < FB_MAX_IMAGES && (
                            <button type="button" className="hc-fb-up" onClick={() => fbFileRef.current?.click()}>
                              <svg
                                viewBox="0 0 24 24"
                                width="22"
                                height="22"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.6"
                                strokeLinecap="round"
                              >
                                <path d="M12 5v14M5 12h14" />
                              </svg>
                              <span>图片/视频 ≤{FB_MAX_FILE_MB}MB</span>
                            </button>
                          )}
                          <input
                            ref={fbFileRef}
                            type="file"
                            accept="image/*,video/*"
                            multiple
                            hidden
                            onChange={(e) => {
                              const files = Array.from(e.target.files || [])
                              e.target.value = ''
                              const room = FB_MAX_IMAGES - fbImages.length
                              const picked: { url: string; file: File }[] = []
                              let tooBig = false
                              for (const f of files) {
                                if (picked.length >= room) break
                                if (f.size > FB_MAX_FILE_MB * 1024 * 1024) {
                                  tooBig = true
                                  continue
                                }
                                picked.push({ url: URL.createObjectURL(f), file: f })
                              }
                              if (tooBig) showToast(`单个附件不能超过 ${FB_MAX_FILE_MB}MB`, 'info')
                              if (picked.length) setFbImages((a) => [...a, ...picked])
                            }}
                          />
                        </div>

                        <div className="hc-fb-label">联系方式</div>
                        <input
                          className="hc-fb-input"
                          value={contact}
                          maxLength={20}
                          placeholder="请输入您的手机号"
                          onChange={(e) => setContact(e.target.value)}
                        />

                        <button type="button" className="hc-fb-submit" disabled={fbSubmitting} onClick={submitFeedback}>
                          {fbSubmitting ? '提交中…' : '提交反馈'}
                        </button>
                      </>
                    ) : (
                      <div className="hc-fb-history">
                        {fbHistoryLoading ? (
                          <p className="hc-fb-hint">加载中…</p>
                        ) : !fbHistory.length ? (
                          <p className="hc-fb-hint">暂无反馈记录</p>
                        ) : (
                          fbHistory.map((f) => (
                            <div className="hc-fb-hitem" key={f.id}>
                              <div className="hc-fb-item-head">
                                <span className="hc-fb-item-type">
                                  {fbTypes.find((t) => t.id === f.feedbackType)?.name || '反馈'}
                                </span>
                                {f.status && <span className="hc-fb-item-status">{f.status}</span>}
                              </div>
                              <p className="hc-fb-item-content">{f.content}</p>
                              {f.createdAt && <span className="hc-fb-item-time">{f.createdAt.slice(0, 10)}</span>}
                            </div>
                          ))
                        )}
                      </div>
                    )}
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
        {/* 收起态=机器人客服头像(帮助中心图标),展开态=白色圆角上箭头(⌃) */}
        {open ? (
          <svg viewBox="0 0 70 70" width="30" height="30" aria-hidden="true">
            <path
              d="M22.475 39.0107C22.0934 39.3791 21.8778 39.8854 21.875 40.415C21.9247 41.6104 22.9297 42.5413 24.125 42.4991C24.7438 42.5019 25.3372 42.2572 25.775 41.8204L35 32.6591L44.225 41.8204C44.6628 42.2572 45.2563 42.5019 45.875 42.4991C47.0703 42.5413 48.0753 41.6104 48.125 40.415C48.1222 39.8854 47.9066 39.3791 47.525 39.0107L36.65 28.175C35.7341 27.275 34.2659 27.275 33.35 28.175L22.475 39.0107Z"
              fill="currentColor"
            />
          </svg>
        ) : (
          <img className="hc-ball-icon" src={helpBallIcon} alt="" draggable={false} />
        )}
      </button>
    </div>
  )
}

const ChevronRight = () => (
  <svg className="hc-ai-row-arrow" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
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
