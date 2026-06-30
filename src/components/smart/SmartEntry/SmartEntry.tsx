/**
 * 智能成片「入口/需求输入」页(2.1,按 Figma 79:3966 还原)。
 * 大标题 + 制作视频/制作图片 Tab + 上传&提示词卡片 +
 * 比例(16:9)/时长(5s) 下拉 + @ + 发送。背景彩色渐变光晕。
 * 提交 → 调 onSubmit(需求文本, 选项),由父级进入分镜脚本流程。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import EntryCanvasBg from '../EntryCanvasBg'
import EntryDropdown from '../EntryDropdown'
import GuideDialog from '../GuideDialog'
import RatioIcon from '@/components/common/RatioIcon'
import { fileToDataUrl } from '@/utils/imageFile'
import { ENTRY_RATIO_OPTIONS as RATIO_OPTIONS } from '@/utils/videoOptions'
import { useToast } from '@/composables/useToast'
import styles from './SmartEntry.module.less'

export interface EntryMeta {
  mode: 'video' | 'image'
  style: string
  ratio: string
  duration: string
  imageCount: number
  images: string[]
  /** 选中的营销 SKILL(空=不使用,走现有逻辑;非空=多一步「营销思路拆解」) */
  skill?: string
}

interface SmartEntryProps {
  onSubmit: (requirement: string, meta: EntryMeta) => void
  /** 「制作新视频」/「创建新对话」:清空输入/项目,初始化为全新空白页(保留当前 Tab 模式)。 */
  onNewVideo?: (mode: 'video' | 'image') => void
  /**
   * 是否可「下一步/恢复」:从流程里点上一步退回入口、且已有生成结果时为 true(仅制作视频)。
   * 为 true 时(且当前在视频 Tab):发送按钮变「下一步」(onResume,回到已生成流程,不重生成);
   * 并显示「重新生成」(走 onSubmit,按当前输入重新生成)。
   */
  canResume?: boolean
  /** 「下一步」:回到已生成的流程(只往前一步),不重新生成。 */
  onResume?: () => void
  /**
   * 回填初始值:从分镜脚本「上一步」返回输入框时,恢复上次输入(需求文本/图片/风格/比例/时长/模式/skill)。
   * 仅在挂载时生效(useState 初值);路由切换会卸载本组件,数据随之清空。
   */
  initial?: {
    mode?: 'video' | 'image'
    text?: string
    ratio?: string
    duration?: string
    images?: string[]
    skill?: string
  }
}

const DURATION_OPTIONS = ['5s', '10s', '15s']
const SKILL_OPTIONS = ['信息电商Skill', '本地生活Skill']
const MAX_IMAGES = 9

const PLACEHOLDER_VIDEO =
  '最多上传9张图片，输入文字或@参考素材，生成精彩广告视频。例如：把 @图片1 中的产品放到 @图片2 中的场景里'
const PLACEHOLDER_IMAGE =
  '最多上传9张图片，输入文字或@参考素材，生成精彩广告图片。例如：把 @图片1 中的产品放到 @图片2 中的场景里'

// 选中 SKILL 后插入到输入框的提示语(高亮显示)。提交/展示前会被剥离,保持需求正文干净。
const skillLine = (s: string) => `使用${s}帮我优化`
const stripSkillLine = (t: string) =>
  SKILL_OPTIONS.reduce((acc, opt) => acc.split(skillLine(opt)).join(''), t)
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t\n]+$/, '')
// 把 skill 提示语拼到正文后面(正文非空时空一行)
const composeWithSkill = (base: string, s: string) => (s ? (base ? `${base}\n\n${skillLine(s)}` : skillLine(s)) : base)

// 高亮渲染匹配:@图片N(绿) + 使用×××skills帮我优化(skill 提示语,着色)
const HL_RE = new RegExp(`@图片\\d+|${SKILL_OPTIONS.map((s) => skillLine(s)).join('|')}`, 'g')

// ── 入口未提交输入的「跨路由保活」 ──
// 切到别的页面会卸载本组件、丢失全部内部 state(文字/图片/比例/时长/skill/模式)。
// initial 只在「同一次挂载内点上一步返回」时回填,跨路由重新挂载时父级 state 已清空、initial 为空 → 输入消失。
// 故把当前输入实时写进 sessionStorage,重新进入空白 /smart 时优先回填;提交成功 / 点「新建」即清空。
// 用 sessionStorage:仅本标签页有效、关页即清,符合「别丢我刚输入的」语义,也避免长期残留旧草稿。
const ENTRY_DRAFT_KEY = 'zzh.smart-entry.draft'
interface EntryDraftStore {
  mode?: 'video' | 'image'
  text?: string // 已剥离 skill 提示语的干净正文(与 onSubmit/initial.text 同口径)
  ratio?: string
  duration?: string
  skill?: string
  images?: string[]
}
function loadSmartEntryDraft(): EntryDraftStore | null {
  try {
    const raw = sessionStorage.getItem(ENTRY_DRAFT_KEY)
    return raw ? (JSON.parse(raw) as EntryDraftStore) : null
  } catch {
    return null
  }
}
function saveSmartEntryDraft(d: EntryDraftStore) {
  try {
    sessionStorage.setItem(ENTRY_DRAFT_KEY, JSON.stringify(d))
  } catch {
    // 多半是图片 dataURL 撑爆配额:退化为不含图片再存一次,至少保住文字与选项。
    try {
      sessionStorage.setItem(ENTRY_DRAFT_KEY, JSON.stringify({ ...d, images: [] }))
    } catch {
      /* ignore */
    }
  }
}
/** 清空入口暂存(提交进入流程 / 重置为全新入口时调用)。父级 resetToNewVideo、restart 路径也会调。 */
export function clearSmartEntryDraft() {
  try {
    sessionStorage.removeItem(ENTRY_DRAFT_KEY)
  } catch {
    /* ignore */
  }
}

export default function SmartEntry({ onSubmit, onNewVideo, canResume, onResume, initial }: SmartEntryProps) {
  const { showToast } = useToast()
  // 回填优先级:initial(同一次挂载内「上一步」回填,值非空时为准)> sessionStorage 暂存(跨路由保活)> 默认。
  // 注意 initial.text 跨路由时是父级空串(非 undefined),故用「非空才采纳」而非 ?? 来回退到暂存。
  const [stored] = useState(loadSmartEntryDraft)
  const seedText = (initial?.text && initial.text.length ? initial.text : stored?.text) ?? ''
  const seedSkill = initial?.skill ?? stored?.skill ?? ''
  const seedImages = (initial?.images && initial.images.length ? initial.images : stored?.images) ?? []
  const [mode, setMode] = useState<'video' | 'image'>(initial?.mode ?? stored?.mode ?? 'video')
  // 切换 Tab:背景弥散位移 + 涟漪动画由 <EntryCanvasBg mode> 监听 mode 变化驱动(Canvas 实现,不卡)
  const switchMode = (m: 'video' | 'image') => {
    if (m === mode) return
    // 「制作图片」暂未开放:点击只提示,不切换;图片模式原逻辑代码保留,开放时去掉此拦截即可
    if (m === 'image') {
      showToast('功能暂未开放', 'info')
      return
    }
    setMode(m)
  }
  // 回填:正文 + (若已选 skill)插入提示语,使其在输入框内带色展示
  const [text, setText] = useState(() => composeWithSkill(seedText, seedSkill))
  const [ratio, setRatio] = useState(initial?.ratio ?? stored?.ratio ?? '16:9')
  const [duration, setDuration] = useState(initial?.duration ?? stored?.duration ?? '10s')
  const [images, setImages] = useState<string[]>(seedImages)
  // 选中的营销 SKILL(单选,空=不使用)
  const [skill, setSkill] = useState(seedSkill)
  const [guideOpen, setGuideOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  // ── @ 引用素材:点击 @ 在光标处弹出已上传素材;选中插入「@图片N」;无素材则直接插入「@」──
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const hlRef = useRef<HTMLDivElement | null>(null)
  const caretRef = useRef(0) // 最近一次光标位置(点 @ 按钮会失焦,需提前记下)
  const [atOpen, setAtOpen] = useState(false)

  // ── 需求文本的撤销/重做历史(AI 引导会改写文本,需可回退/前进)──
  const histRef = useRef<string[]>([seedText])
  const idxRef = useRef(0)
  const [, bumpHist] = useState(0)

  // 实时把当前输入写进 sessionStorage(防抖 300ms),切走再回来可回填。text 存「剥离 skill 提示语」的干净正文。
  useEffect(() => {
    const t = window.setTimeout(
      () => saveSmartEntryDraft({ mode, text: stripSkillLine(text).trim(), ratio, duration, skill, images }),
      300,
    )
    return () => window.clearTimeout(t)
  }, [mode, text, ratio, duration, skill, images])
  const commitText = (val: string) => {
    if (histRef.current[idxRef.current] === val) return
    const next = histRef.current.slice(0, idxRef.current + 1)
    next.push(val)
    histRef.current = next
    idxRef.current = next.length - 1
    bumpHist((v) => v + 1)
  }

  // AI 引导:打开交互式对话框(问人群/剧情/目标…),用户确认后再回填(不擅自改原文)。
  const applyGuide = (brief: string) => {
    commitText(text) // 快照当前输入,便于回退
    setText(brief)
    commitText(brief) // 快照引导结果,便于重做
  }

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
    setImages((prev) => prev.filter((u) => u !== url))
    URL.revokeObjectURL(url)
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

  // 点击 @:记录光标 → 无素材直接插「@」;有素材在光标处弹出素材选择
  const handleAt = () => {
    const ta = taRef.current
    caretRef.current = ta ? (ta.selectionStart ?? text.length) : text.length
    if (images.length === 0) {
      insertAtCaret('@') // 无上传素材 → 直接在光标处插入 @
      return
    }
    setAtOpen(true) // 有素材 → 在 @ 按钮附近弹出素材选择
  }

  // 选中某张已上传素材 → 在光标处插入「@图片N 」(高亮渲染由 hl 层处理)
  const pickRef = (index: number) => {
    insertAtCaret(`@图片${index + 1} `)
    setAtOpen(false)
  }

  // 高亮渲染:@图片N 标绿 + 「使用×××skills帮我优化」着色,其余为普通文本(textarea 文字透明,叠在此层上)
  const renderHighlight = (t: string) => {
    if (!t) return null
    const out: ReactNode[] = []
    let last = 0
    let m: RegExpExecArray | null
    HL_RE.lastIndex = 0
    while ((m = HL_RE.exec(t))) {
      if (m.index > last) out.push(t.slice(last, m.index))
      const isRef = m[0].startsWith('@图片')
      out.push(
        <span className={isRef ? styles.refTag : styles.skillTag} key={m.index}>
          {m[0]}
        </span>,
      )
      last = m.index + m[0].length
    }
    out.push(t.slice(last))
    return out
  }

  // 正文(剥离 skill 提示语后)用于提交/校验,保证需求干净
  const cleanText = stripSkillLine(text).trim()
  const canSubmit = cleanText.length > 0 || images.length > 0
  // 恢复态:已有生成结果且当前在视频 Tab → 发送按钮变「下一步」,并显示「重新生成」
  const resumeMode = !!canResume && mode === 'video'
  const submit = () => {
    if (!canSubmit) return
    onSubmit(cleanText, {
      mode,
      style: '',
      ratio,
      duration,
      imageCount: images.length,
      images,
      skill: skill || undefined,
    })
    // 已提交进入流程:清掉入口暂存,避免下次空白 /smart 又回填这次已用过的输入。
    clearSmartEntryDraft()
  }

  // 选中/切换 SKILL:把提示语插入输入框(替换旧的);未选则移除
  const pickSkill = (s: string) => {
    setText((cur) => composeWithSkill(stripSkillLine(cur), s))
    setSkill(s)
  }

  return (
    <div className={styles.screate} data-mode={mode}>
      {/* 背景弥散:Canvas 精确复刻 UI 设计「背景颜色」(Figma 677:3996)三层叠加;只绘制一次,
          切换 mode 时对画布做纯位移动画(GPU 合成,不卡) */}
      <div className={styles.bg} aria-hidden="true">
        <EntryCanvasBg index={mode === 'image' ? 1 : 0} count={2} anim="glide" />
      </div>

      <h1 className={styles.title}>{mode === 'image' ? '想打造什么样的营销图片？' : '想打造什么样的爆款短视频？'}</h1>

      <div className={styles.panel}>
        {/* 右上角:与 Tab 同一行、右对齐卡片;点击初始化为全新空白页(等同切换路由再回来) */}
        {onNewVideo && (
          <button type="button" className={styles.newVideoBtn} onClick={() => onNewVideo(mode)}>
            {mode === 'image' ? '创建新对话' : '制作新视频'}
          </button>
        )}
        {/* Tab:制作视频 / 制作图片 */}
        <div className={styles.tabs}>
          <button
            type="button"
            className={`${styles.tab}${mode === 'video' ? ' ' + styles.active : ''}`}
            onClick={() => switchMode('video')}
          >
            制作视频
          </button>
          <button
            type="button"
            className={`${styles.tab}${mode === 'image' ? ' ' + styles.active : ''}`}
            onClick={() => switchMode('image')}
          >
            制作图片
          </button>
        </div>

        <div className={styles.card}>
          {/* 已选图片:独立成一行(可换行),不挤压文本框;参考主流 AI 输入框做法 */}
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
            {/* 无图时:左侧上传框(Figma 初始态);有图时上传入口在上方缩略图行 */}
            {images.length === 0 && (
              <button
                type="button"
                className={styles.upload}
                onClick={() => fileRef.current?.click()}
                aria-label="上传图片"
              >
                {/* 倾斜浅灰卡片 + 加号(还原 Figma Group 388,无虚线边) */}
                <svg
                  className={styles.uploadCard}
                  width="96"
                  height="117"
                  viewBox="0 0 109 133"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <rect
                    x="-0.635504"
                    y="15.0473"
                    width="90.3131"
                    height="120.417"
                    rx="4"
                    transform="rotate(-10 -0.635504 15.0473)"
                    fill="#F8F8F8"
                  />
                  <path
                    d="M52.5478 56.6177C52.839 56.5663 53.1387 56.6327 53.381 56.8024C53.6232 56.972 53.7881 57.2309 53.8395 57.5221L55.1948 65.2083L62.881 63.853C63.1722 63.8017 63.4719 63.8681 63.7142 64.0377C63.9564 64.2074 64.1213 64.4663 64.1727 64.7575C64.224 65.0487 64.1576 65.3484 63.988 65.5906C63.8184 65.8328 63.5595 65.9978 63.2683 66.0491L55.582 67.4044L56.9373 75.0907C56.9886 75.3819 56.9222 75.6816 56.7526 75.9238C56.583 76.166 56.3241 76.331 56.0329 76.3823C55.7416 76.4337 55.442 76.3672 55.1997 76.1976C54.9575 76.028 54.7926 75.7691 54.7412 75.4779L53.3859 67.7916L45.6997 69.1469C45.4084 69.1983 45.1087 69.1318 44.8665 68.9622C44.6243 68.7926 44.4594 68.5337 44.408 68.2425C44.3567 67.9513 44.4231 67.6516 44.5927 67.4094C44.7623 67.1671 45.0212 67.0022 45.3124 66.9509L52.9987 65.5956L51.6434 57.9093C51.592 57.6181 51.6585 57.3184 51.8281 57.0762C51.9977 56.8339 52.2566 56.669 52.5478 56.6177Z"
                    fill="#909090"
                  />
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
              {/* 高亮层:渲染文本并把 @图片N 标绿;textarea 文字透明叠在其上 */}
              <div className={styles.inputHl} ref={hlRef} aria-hidden="true">
                {renderHighlight(text)}
              </div>
              <textarea
                ref={taRef}
                className={styles.input}
                value={text}
                placeholder={mode === 'image' ? PLACEHOLDER_IMAGE : PLACEHOLDER_VIDEO}
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
              {/* 时长仅「制作视频」需要;「制作图片」隐藏(对齐设计) */}
              {mode === 'video' && (
                <EntryDropdown
                  value={duration}
                  options={DURATION_OPTIONS}
                  onChange={setDuration}
                  icon={
                    <svg
                      viewBox="0 0 24 24"
                      width="20"
                      height="20"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                    >
                      <circle cx="12" cy="12" r="8" />
                      <path d="M12 8v4l3 2" />
                    </svg>
                  }
                />
              )}

              <span className={styles.atAnchor}>
                <button type="button" className={styles.pillBtn} onClick={handleAt} title="引用参考素材">
                  @
                </button>
                {/* @ 素材选择:在 @ 按钮附近(上方)弹出,展示历史上传素材 */}
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

              {/* SKILLS:营销技能包(仅「制作视频」展示;「制作图片」隐藏,对齐设计) */}
              {mode === 'video' && (
                <EntryDropdown
                  clearable
                  placeholder="SKILLS"
                  value={skill}
                  options={SKILL_OPTIONS}
                  onChange={pickSkill}
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
                    >
                      <path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8z" />
                      <path d="M18 14l.9 2.1L21 17l-2.1.9L18 20l-.9-2.1L15 17l2.1-.9z" />
                    </svg>
                  }
                />
              )}
            </div>

            <div className={styles.sendArea}>
              {/* 恢复态:重新生成(按当前输入重新走流程) */}
              {resumeMode && (
                <button
                  type="button"
                  className={styles.regen}
                  disabled={!canSubmit}
                  onClick={() => submit()}
                  title="按当前输入重新生成"
                >
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
                    <path d="M20 12a8 8 0 1 1-2.3-5.6" />
                    <path d="M20 4v4h-4" />
                  </svg>
                  重新生成
                </button>
              )}
              <button
                type="button"
                className={styles.send}
                // 恢复态(下一步)始终可点;普通发送需有输入
                disabled={resumeMode ? false : !canSubmit}
                onClick={() => (resumeMode ? onResume?.() : submit())}
                aria-label={resumeMode ? '下一步' : '生成'}
                title={resumeMode ? '下一步' : '生成(Ctrl/⌘ + Enter)'}
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

      <GuideDialog
        open={guideOpen}
        initialText={text}
        images={images}
        onAddImages={(urls) => setImages((prev) => [...prev, ...urls].slice(0, MAX_IMAGES))}
        onClose={() => setGuideOpen(false)}
        onApply={applyGuide}
      />
    </div>
  )
}
