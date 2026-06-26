/**
 * AI 引导对话框(交互式)。
 * 每题 = 可自由填写的输入框 + 下方建议 chips(点击自动追加进框,可继续多写)。
 * 两种模式:wizard 向导式一问一答(默认) / all 全部展示(熟练用户)。
 * 模式记忆:先存 localStorage(后端就绪后改为后端记录用户上次行为)。
 * 流程:答题 → 生成「创作需求」建议预览 → 用户确认「应用到输入框」才回填(不擅自改原文)。
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Markdown from '@/components/common/Markdown'
import { guideRequirement, analyzeForGuide, suggestOptions } from '@/api/aiPolish'
import { fileToDataUrl } from '@/utils/imageFile'
import { useToast } from '@/composables/useToast'
import styles from './GuideDialog.module.less'

/** 把素材的 objectURL 缩放并转 base64 data url(控制体积后再喂给多模态模型) */
function urlToDataUrl(url: string, max = 768): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height))
      const w = Math.max(1, Math.round(img.width * scale))
      const h = Math.max(1, Math.round(img.height * scale))
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const ctx = c.getContext('2d')
      if (!ctx) return resolve(null)
      ctx.drawImage(img, 0, 0, w, h)
      try {
        resolve(c.toDataURL('image/jpeg', 0.82))
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = url
  })
}

const FIELD_KEYS = ['product', 'sellpoint', 'audience', 'pain', 'scene', 'goal', 'plot', 'tone'] as const

interface Question {
  key: string
  label: string
  hint?: string
  aiHint?: string // 给 AI 的维度定义+示例,确保候选具体且互相区分
  placeholder: string
  rows?: number
  required?: boolean
  suggestions: string[]
}

const QUESTIONS: Question[] = [
  {
    key: 'product',
    label: '产品 / 品牌',
    hint: '必填',
    aiHint: '产品品类或一句话定位,如 控油洗发水/智能电动车/在线少儿英语',
    placeholder: '一句话说清是什么。例:雅迪智能电动车。或点下方建议',
    required: true,
    rows: 2,
    suggestions: [
      '美妆护肤',
      '日化清洁',
      '食品饮料',
      '3C数码',
      '服饰鞋包',
      '家居家电',
      '母婴用品',
      '教育课程',
      'APP/小程序',
    ],
  },
  {
    key: 'sellpoint',
    label: '核心卖点',
    hint: '凭什么打动人',
    aiHint: '产品最打动人的具体功能或利益点(紧扣该产品),如 一次充电跑100公里/0硅油不伤发/外教1对1',
    placeholder: '最打动人的点,或点下方建议',
    suggestions: ['效果显著', '成分安全', '性价比高', '大牌平替', '操作简单', '省时省力', '专利技术'],
  },
  {
    key: 'audience',
    label: '目标人群',
    hint: '给谁看',
    aiHint: '具体人群画像(年龄/身份/特征),如 25-35岁宝妈/大学新生/油痘肌女生',
    placeholder: '具体人群,或点下方建议',
    suggestions: ['宝妈', 'Z世代', '职场白领', '银发人群', '小镇青年', '学生党', '油皮人群'],
  },
  {
    key: 'pain',
    label: '用户痛点',
    hint: '戳中什么',
    aiHint: '该人群面对该产品的真实烦恼/顾虑,如 续航焦虑/头发出油快/孩子不敢开口',
    placeholder: '用户的烦恼/顾虑,或点下方建议',
    suggestions: ['续航焦虑', '太麻烦', '没时间', '不会挑选', '踩过坑', '担心安全', '反复复购'],
  },
  {
    key: 'scene',
    label: '使用场景',
    hint: '什么场景',
    aiHint: '产品被使用或出现的具体场景,如 早晚通勤/健身房/睡前护理/带娃时',
    placeholder: '使用/出现场景,或点下方建议',
    suggestions: ['通勤路上', '居家日常', '办公室', '健身运动', '聚会出游', '睡前', '换季'],
  },
  {
    key: 'goal',
    label: '营销目标 & 行动号召',
    hint: '想让用户做什么',
    aiHint: '希望用户采取的行动+给的利益(CTA),如 限时5折下单/到店试驾/点击领试听课',
    placeholder: '目标 + 利益,或点下方建议',
    suggestions: ['转化下单', '留资获客', '涨粉引流', '到店核销', '限时五折', '下单送赠品', '点击领券'],
  },
  {
    key: 'plot',
    label: '表现形式 / 剧情',
    hint: '怎么拍',
    aiHint: '短视频广告的拍法/叙事套路,如 单人口播/情景剧/痛点解决/剧情反转/测评种草',
    placeholder: '叙事/表现方式,或点下方建议',
    suggestions: ['单人口播', '情景剧', '商品展示', '痛点解决', '剧情反转', '测评种草', '开箱体验'],
  },
  {
    key: 'tone',
    label: '风格调性',
    hint: '什么氛围',
    aiHint: '画面/语气的氛围调性,如 真实质朴/幽默搞笑/高端精致/温情治愈/专业权威',
    placeholder: '想要的氛围,或点下方建议',
    suggestions: ['真实质朴', '幽默搞笑', '高端精致', '温情治愈', '专业权威', '叫卖促销', '青春活力'],
  },
]

// 8 个维度按主题合并为 4 个步骤(每步 2 个相关字段,降低认知负担、各步区分清晰)
interface StepGroup {
  title: string
  desc: string
  keys: string[]
}
const GROUPS: StepGroup[] = [
  { title: '产品 & 卖点', desc: '它是什么 · 凭什么打动人', keys: ['product', 'sellpoint'] },
  { title: '人群 & 痛点', desc: '给谁看 · 戳中什么', keys: ['audience', 'pain'] },
  { title: '场景 & 目标', desc: '什么场景 · 想让用户做什么', keys: ['scene', 'goal'] },
  { title: '表现 & 风格', desc: '怎么拍 · 什么调性', keys: ['plot', 'tone'] },
]
const Q_BY_KEY: Record<string, Question> = Object.fromEntries(QUESTIONS.map((q) => [q.key, q]))

// 本地记忆上次模式(后端就绪后改为后端记录用户上次行为)
const MODE_KEY = 'smart_guide_mode'
function readMode(): 'wizard' | 'all' {
  try {
    return localStorage.getItem(MODE_KEY) === 'all' ? 'all' : 'wizard'
  } catch {
    return 'wizard'
  }
}

interface GuideDialogProps {
  open: boolean
  initialText: string
  images?: string[]
  onClose: () => void
  onApply: (brief: string) => void
  /** 在对话框内上传的素材回传给父级(并入流程素材) */
  onAddImages?: (urls: string[]) => void
}

export default function GuideDialog({
  open,
  initialText,
  images = [],
  onClose,
  onApply,
  onAddImages,
}: GuideDialogProps) {
  const { showToast } = useToast()
  const [mode, setMode] = useState<'wizard' | 'all'>(readMode)
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [prefillDone, setPrefillDone] = useState(false)
  const prefilledRef = useRef(false)
  // 在对话框内上传的素材
  const [extraImages, setExtraImages] = useState<string[]>([])
  const fileRef = useRef<HTMLInputElement | null>(null)
  // AI 生成的候选(每题 5 个)+ 加载态
  const [suggs, setSuggs] = useState<Record<string, string[]>>({})
  const [suggLoading, setSuggLoading] = useState<Record<string, boolean>>({})

  const allImages = [...images, ...extraImages]
  const noContext = !initialText.trim() && !allImages.length

  const buildSuggContext = (qKey: string) => {
    const parts: string[] = []
    if (initialText.trim()) parts.push(`想法:${initialText.trim()}`)
    QUESTIONS.forEach((q) => {
      if (q.key === qKey) return
      const v = (answers[q.key] || '').trim()
      if (v) parts.push(`${q.label.replace(/[?? ]/g, '')}:${v}`)
    })
    return parts.join(';')
  }

  const loadSuggs = async (qKey: string, replace = false) => {
    const q = QUESTIONS.find((x) => x.key === qKey)
    if (!q || suggLoading[qKey]) return
    setSuggLoading((m) => ({ ...m, [qKey]: true }))
    try {
      const exclude = replace ? suggs[qKey] || [] : []
      const out = await suggestOptions({ label: q.label, hint: q.aiHint, context: buildSuggContext(qKey), exclude })
      setSuggs((m) => ({ ...m, [qKey]: out.length ? out : q.suggestions.slice(0, 5) }))
    } catch {
      setSuggs((m) => ({ ...m, [qKey]: q.suggestions.slice(0, 5) }))
    } finally {
      setSuggLoading((m) => ({ ...m, [qKey]: false }))
    }
  }

  // 为当前可见的问题按需加载候选(向导=当前步;全部=全部)
  useEffect(() => {
    if (!open) return
    const targets = mode === 'all' ? QUESTIONS : (GROUPS[step]?.keys || []).map((k) => Q_BY_KEY[k]).filter(Boolean)
    targets.forEach((q) => {
      if (!suggs[q.key] && !suggLoading[q.key]) void loadSuggs(q.key)
    })
    // prefillDone 加入依赖:预填完成清空候选后,这里按新解析上下文重新拉取
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, step, prefillDone])

  // 智能预填:用多模态模型据 文字+素材 填空(不覆盖用户已填)
  const runPrefill = async (imgs: string[]) => {
    if (!initialText.trim() && !imgs.length) return
    setAnalyzing(true)
    try {
      const dataUrls = (await Promise.all(imgs.slice(0, 6).map((u) => urlToDataUrl(u)))).filter(Boolean) as string[]
      const sug = await analyzeForGuide({ text: initialText, images: dataUrls })
      setAnswers((prev) => {
        const next = { ...prev }
        FIELD_KEYS.forEach((k) => {
          const v = (sug as any)[k]
          if (v && !(next[k] || '').trim()) next[k] = String(v).trim()
        })
        return next
      })
      setPrefillDone(true)
      // 预填带来了新上下文(产品/素材等)→ 候选作废,触发按新信息重拉
      setSuggs({})
      setSuggLoading({})
    } catch {
      /* 静默:预填失败不影响手动引导 */
    } finally {
      setAnalyzing(false)
    }
  }

  // 打开时:有文字/素材则自动预填一次
  useEffect(() => {
    if (!open) {
      prefilledRef.current = false
      setPrefillDone(false)
      setSuggs({})
      setSuggLoading({})
      setExtraImages([])
      return
    }
    if (prefilledRef.current) return
    if (!initialText.trim() && !images.length) return
    prefilledRef.current = true
    void runPrefill(images)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialText, images])

  // 在对话框内上传素材 → 立即据新素材预填。
  // 有父级回调则只交给父级(由 images prop 反映,避免与本地重复计数);否则本地保存。
  const onPickFiles = async (files: FileList | null) => {
    if (!files?.length) return
    const urls = (await Promise.all(Array.from(files).map((f) => fileToDataUrl(f).catch(() => null)))).filter(
      Boolean,
    ) as string[]
    if (!urls.length) return
    if (onAddImages) {
      onAddImages(urls)
    } else {
      setExtraImages((prev) => [...prev, ...urls])
    }
    prefilledRef.current = true
    void runPrefill([...allImages, ...urls])
  }

  if (!open) return null

  const last = GROUPS.length - 1

  const switchMode = (m: 'wizard' | 'all') => {
    setMode(m)
    if (m === 'wizard') setStep(0)
    try {
      localStorage.setItem(MODE_KEY, m)
    } catch {
      /* ignore */
    }
  }

  const setAns = (k: string, v: string) => setAnswers((a) => ({ ...a, [k]: v }))
  const appendChip = (k: string, chip: string) =>
    setAnswers((a) => {
      const cur = a[k] || ''
      if (cur.includes(chip)) return a
      const sep = cur.trim() ? (/[，,、;；\s]$/.test(cur) ? '' : '、') : ''
      return { ...a, [k]: cur + sep + chip }
    })

  const compose = () => {
    const lines = [`【我的想法】${initialText.trim() || '(未填写,请基于以下选择给出合理方向)'}`]
    QUESTIONS.forEach((q) => {
      const v = (answers[q.key] || '').trim()
      if (v) lines.push(`【${q.label.replace(/[?? ]/g, '')}】${v}`)
    })
    return lines.join('\n')
  }

  const goNext = () => {
    const g = GROUPS[step]
    const missing = g.keys.map((k) => Q_BY_KEY[k]).find((q) => q?.required && !(answers[q.key] || '').trim())
    if (missing) {
      showToast(`请先填写${missing.label}`, 'info')
      return
    }
    setStep(step + 1)
  }

  const generate = async () => {
    if (loading) return
    if (!(answers.product || '').trim()) {
      showToast('请先填写产品 / 品牌简介(必填)', 'info')
      if (mode === 'wizard') setStep(0)
      return
    }
    setLoading(true)
    try {
      const out = await guideRequirement(compose())
      setPreview(out)
    } catch (e: any) {
      showToast(e?.message || '生成失败,请重试', 'error')
    } finally {
      setLoading(false)
    }
  }

  const apply = () => {
    if (!preview) return
    onApply(preview)
    onClose()
  }

  const renderQuestion = (q: Question) => (
    <div className={styles.gdlgQ} key={q.key}>
      <div className={styles.gdlgLabel}>
        {q.label}
        {q.required && <i className={styles.gdlgReq}>*</i>}
        {q.hint && <span>{q.hint}</span>}
      </div>
      <textarea
        className={styles.gdlgField}
        rows={q.rows || 2}
        value={answers[q.key] || ''}
        onChange={(e) => setAns(q.key, e.target.value)}
        placeholder={q.placeholder}
      />
      <div className={styles.gdlgChips}>
        <div className={styles.gdlgChipList}>
          {suggLoading[q.key] && !suggs[q.key] ? (
            <span className={styles.gdlgSuggLoading}>
              <span className={styles.gdlgSuggSpin} aria-hidden="true" />
              AI 生成建议中…
            </span>
          ) : (
            (suggs[q.key] || q.suggestions.slice(0, 5)).map((s) => (
              <button key={s} type="button" className={styles.gdlgChip} onClick={() => appendChip(q.key, s)}>
                {s}
              </button>
            ))
          )}
        </div>
        <button
          type="button"
          className={styles.gdlgRefresh}
          onClick={() => loadSuggs(q.key, true)}
          disabled={!!suggLoading[q.key]}
          title="换一批建议"
        >
          <svg
            viewBox="0 0 24 24"
            width="13"
            height="13"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 12a9 9 0 1 1-2.64-6.36M21 4v5h-5" />
          </svg>
          换一批
        </button>
      </div>
    </div>
  )

  return createPortal(
    <div
      className={styles.gdlgMask}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className={styles.gdlg} role="dialog" aria-label="AI 引导">
        <div className={styles.gdlgHead}>
          <span className={styles.gdlgTitle}>AI 引导 · 把需求想得更专业</span>
          <div className={styles.gdlgMode} role="tablist" aria-label="引导模式">
            <button
              type="button"
              className={`${styles.gdlgModeBtn}${mode === 'wizard' ? ' ' + styles.on : ''}`}
              onClick={() => switchMode('wizard')}
            >
              向导
            </button>
            <button
              type="button"
              className={`${styles.gdlgModeBtn}${mode === 'all' ? ' ' + styles.on : ''}`}
              onClick={() => switchMode('all')}
            >
              全部
            </button>
          </div>
          <button type="button" className={styles.gdlgX} onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className={styles.gdlgBody}>
          {preview ? (
            <div className={styles.gdlgPreview}>
              <div className={styles.gdlgLabel}>建议的创作需求 · 确认后才会填入输入框</div>
              <div className={`${styles.gdlgPreviewText} ${styles.gdlgMd}`}>
                <Markdown>{preview}</Markdown>
              </div>
            </div>
          ) : (
            <>
              {analyzing ? (
                <div className={`${styles.gdlgAiNote} ${styles.busy}`}>
                  <span className={styles.gdlgAiSpin} aria-hidden="true" />
                  正在根据你的内容/素材智能预填…
                </div>
              ) : (
                prefillDone && <div className={styles.gdlgAiNote}>✦ 已根据你的内容/素材智能预填,可修改</div>
              )}

              {/* 素材上传区(随时可加,加完即用 AI 预填) */}
              <div className={styles.gdlgUpload}>
                <div className={styles.gdlgUploadThumbs}>
                  {allImages.map((url, i) => (
                    <div className={styles.gdlgUpthumb} key={i}>
                      <img src={url} alt="" />
                    </div>
                  ))}
                  <button type="button" className={styles.gdlgUpbtn} onClick={() => fileRef.current?.click()}>
                    <svg
                      viewBox="0 0 24 24"
                      width="18"
                      height="18"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />
                    </svg>
                    上传素材
                  </button>
                </div>
                {noContext && (
                  <div className={styles.gdlgUploadHint}>
                    还没素材/想法?在此上传素材,AI 帮你预填(也可直接在下方填写)
                  </div>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={(e) => {
                    onPickFiles(e.target.files)
                    e.target.value = ''
                  }}
                />
              </div>

              {initialText.trim() && <div className={styles.gdlgIdea}>你的想法:{initialText.trim()}</div>}
              {mode === 'all' ? (
                GROUPS.map((g) => (
                  <div className={styles.gdlgGroup} key={g.title}>
                    <div className={styles.gdlgGroupTitle}>
                      {g.title}
                      <span>{g.desc}</span>
                    </div>
                    {g.keys.map((k) => renderQuestion(Q_BY_KEY[k]))}
                  </div>
                ))
              ) : (
                <>
                  <div className={styles.gdlgSteps}>
                    第 {step + 1} / {GROUPS.length} 步 · {GROUPS[step]?.title}
                    <span className={styles.gdlgDots}>
                      {GROUPS.map((g, i) => (
                        <i key={g.title} className={i === step ? styles.on : i < step ? styles.done : ''} />
                      ))}
                    </span>
                  </div>
                  <div className={styles.gdlgGroupDesc}>{GROUPS[step]?.desc}</div>
                  {(GROUPS[step]?.keys || []).map((k) => renderQuestion(Q_BY_KEY[k]))}
                </>
              )}
            </>
          )}
        </div>

        <div className={styles.gdlgFoot}>
          {preview ? (
            <>
              <button
                type="button"
                className={`${styles.gdlgBtn} ${styles.gdlgBtnGhost}`}
                onClick={() => setPreview('')}
              >
                返回修改
              </button>
              <span className={styles.gdlgFootGap} />
              <button
                type="button"
                className={`${styles.gdlgBtn} ${styles.gdlgBtnGhost}`}
                onClick={generate}
                disabled={loading}
              >
                {loading ? '生成中…' : '重新生成'}
              </button>
              <button type="button" className={`${styles.gdlgBtn} ${styles.gdlgBtnPrimary}`} onClick={apply}>
                应用到输入框
              </button>
            </>
          ) : mode === 'all' ? (
            <>
              <button type="button" className={`${styles.gdlgBtn} ${styles.gdlgBtnGhost}`} onClick={onClose}>
                取消
              </button>
              <span className={styles.gdlgFootGap} />
              <button
                type="button"
                className={`${styles.gdlgBtn} ${styles.gdlgBtnPrimary}`}
                onClick={generate}
                disabled={loading}
              >
                {loading ? '生成中…' : '生成建议'}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className={`${styles.gdlgBtn} ${styles.gdlgBtnGhost}`}
                onClick={() => (step > 0 ? setStep(step - 1) : onClose())}
              >
                {step > 0 ? '上一步' : '取消'}
              </button>
              <span className={styles.gdlgFootGap} />
              {step < last ? (
                <button type="button" className={`${styles.gdlgBtn} ${styles.gdlgBtnPrimary}`} onClick={goNext}>
                  下一步
                </button>
              ) : (
                <button
                  type="button"
                  className={`${styles.gdlgBtn} ${styles.gdlgBtnPrimary}`}
                  onClick={generate}
                  disabled={loading}
                >
                  {loading ? '生成中…' : '生成建议'}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
