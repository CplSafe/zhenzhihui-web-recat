/**
 * AI 引导对话框(交互式)。
 * 每题 = 可自由填写的输入框 + 下方建议 chips(点击自动追加进框,可继续多写)。
 * 两种模式:wizard 向导式一问一答(默认) / all 全部展示(熟练用户)。
 * 模式记忆:先存 localStorage(后端就绪后改为后端记录用户上次行为)。
 * 流程:答题 → 生成「创作需求」建议预览 → 用户确认「应用到输入框」才回填(不擅自改原文)。
 */
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { guideRequirement } from '@/api/aiPolish'
import { useToast } from '@/composables/useToast'
import './GuideDialog.css'

interface Question {
  key: string
  label: string
  hint?: string
  placeholder: string
  rows?: number
  required?: boolean
  suggestions: string[]
}

// 按"信息流需求三角(创造需求→介绍产品→呼吁行动)"组织,产品为根(必填)。
const QUESTIONS: Question[] = [
  {
    key: 'product',
    label: '产品 / 品牌简介',
    hint: '必填 · 一句话说清是什么',
    placeholder: '例:XX 控油洗发水(日化),主打去屑控油。或点下方品类快速填入',
    required: true,
    rows: 2,
    suggestions: ['美妆护肤', '日化清洁', '食品饮料', '3C数码', '服饰鞋包', '家居家电', '母婴用品', '保健健康', '教育课程', '本地服务', 'APP/小程序', '金融理财'],
  },
  {
    key: 'sellpoint',
    label: '核心卖点 / 利益点',
    hint: '为什么选它',
    placeholder: '产品最打动人的点,或点下方建议',
    suggestions: ['效果显著', '成分安全', '性价比高', '大牌平替', '操作简单', '省时省力', '专利技术', '独家配方', '明星同款'],
  },
  {
    key: 'audience',
    label: '目标人群',
    hint: '给谁看 · 可多个',
    placeholder: '描述目标人群,或点下方建议',
    suggestions: ['宝妈', 'Z世代', '职场白领', '银发人群', '小镇青年', '学生党', '新手宝爸', '都市女性', '油皮人群', '敏感肌'],
  },
  {
    key: 'pain',
    label: '用户痛点 / 想解决的问题',
    hint: '创造需求',
    placeholder: '用户当下的烦恼/顾虑,或点下方建议',
    suggestions: ['价格太贵', '效果不好', '太麻烦', '没时间', '不会挑选', '踩过坑', '担心安全', '反复复购'],
  },
  {
    key: 'scene',
    label: '使用场景',
    hint: '什么时候用',
    placeholder: '在什么场景下使用/出现,或点下方建议',
    suggestions: ['通勤路上', '居家日常', '办公室', '健身运动', '聚会出游', '睡前', '带娃时', '换季'],
  },
  {
    key: 'goal',
    label: '营销目标 & 行动号召',
    hint: '呼吁行动',
    placeholder: '希望用户做什么 + 给什么利益,或点下方建议',
    suggestions: ['转化下单', '留资获客', '涨粉引流', '促活复购', '下载APP', '到店核销', '限时五折', '下单送赠品', '点击领券'],
  },
  {
    key: 'plot',
    label: '表现形式 / 剧情类型',
    hint: '怎么演',
    placeholder: '想要的叙事/表现方式,或点下方建议',
    suggestions: ['单人口播', '情景剧', '商品展示', '痛点解决', '剧情反转', '测评种草', '开箱体验', '对比测评', '街头采访', '专家背书'],
  },
  {
    key: 'tone',
    label: '风格调性 & 信任背书',
    hint: '选填',
    placeholder: '想要的氛围/可用的背书(销量、好评、资质…)',
    rows: 2,
    suggestions: ['真实质朴', '幽默搞笑', '高端精致', '温情治愈', '专业权威', '叫卖促销', '销量数据', '用户好评', '资质认证', '明星代言'],
  },
]

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
  onClose: () => void
  onApply: (brief: string) => void
}

export default function GuideDialog({ open, initialText, onClose, onApply }: GuideDialogProps) {
  const { showToast } = useToast()
  const [mode, setMode] = useState<'wizard' | 'all'>(readMode)
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState('')

  if (!open) return null

  const last = QUESTIONS.length - 1

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
    const q = QUESTIONS[step]
    if (q.required && !(answers[q.key] || '').trim()) {
      showToast(`请先填写${q.label}`, 'info')
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
    <div className="gdlg__q" key={q.key}>
      <div className="gdlg__label">
        {q.label}
        {q.required && <i className="gdlg__req">*</i>}
        {q.hint && <span>{q.hint}</span>}
      </div>
      <textarea
        className="gdlg__field"
        rows={q.rows || 2}
        value={answers[q.key] || ''}
        onChange={(e) => setAns(q.key, e.target.value)}
        placeholder={q.placeholder}
      />
      <div className="gdlg__chips">
        {q.suggestions.map((s) => (
          <button key={s} type="button" className="gdlg__chip" onClick={() => appendChip(q.key, s)}>
            + {s}
          </button>
        ))}
      </div>
    </div>
  )

  return createPortal(
    <div
      className="gdlg-mask"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="gdlg" role="dialog" aria-label="AI 引导">
        <div className="gdlg__head">
          <span className="gdlg__title">AI 引导 · 把需求想得更专业</span>
          <div className="gdlg__mode" role="tablist" aria-label="引导模式">
            <button
              type="button"
              className={`gdlg__mode-btn${mode === 'wizard' ? ' is-on' : ''}`}
              onClick={() => switchMode('wizard')}
            >
              向导
            </button>
            <button
              type="button"
              className={`gdlg__mode-btn${mode === 'all' ? ' is-on' : ''}`}
              onClick={() => switchMode('all')}
            >
              全部
            </button>
          </div>
          <button type="button" className="gdlg__x" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className="gdlg__body">
          {preview ? (
            <div className="gdlg__preview">
              <div className="gdlg__label">建议的创作需求 · 确认后才会填入输入框</div>
              <div className="gdlg__preview-text">{preview}</div>
            </div>
          ) : (
            <>
              {initialText.trim() && <div className="gdlg__idea">你的想法:{initialText.trim()}</div>}
              {mode === 'all' ? (
                QUESTIONS.map(renderQuestion)
              ) : (
                <>
                  <div className="gdlg__steps">
                    第 {step + 1} / {QUESTIONS.length} 步
                    <span className="gdlg__dots">
                      {QUESTIONS.map((q, i) => (
                        <i key={q.key} className={i === step ? 'is-on' : i < step ? 'is-done' : ''} />
                      ))}
                    </span>
                  </div>
                  {renderQuestion(QUESTIONS[step])}
                </>
              )}
            </>
          )}
        </div>

        <div className="gdlg__foot">
          {preview ? (
            <>
              <button type="button" className="gdlg__btn gdlg__btn--ghost" onClick={() => setPreview('')}>
                返回修改
              </button>
              <span className="gdlg__foot-gap" />
              <button type="button" className="gdlg__btn gdlg__btn--ghost" onClick={generate} disabled={loading}>
                {loading ? '生成中…' : '重新生成'}
              </button>
              <button type="button" className="gdlg__btn gdlg__btn--primary" onClick={apply}>
                应用到输入框
              </button>
            </>
          ) : mode === 'all' ? (
            <>
              <button type="button" className="gdlg__btn gdlg__btn--ghost" onClick={onClose}>
                取消
              </button>
              <span className="gdlg__foot-gap" />
              <button type="button" className="gdlg__btn gdlg__btn--primary" onClick={generate} disabled={loading}>
                {loading ? '生成中…' : '生成建议'}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="gdlg__btn gdlg__btn--ghost"
                onClick={() => (step > 0 ? setStep(step - 1) : onClose())}
              >
                {step > 0 ? '上一步' : '取消'}
              </button>
              <span className="gdlg__foot-gap" />
              {step < last ? (
                <button type="button" className="gdlg__btn gdlg__btn--primary" onClick={goNext}>
                  下一步
                </button>
              ) : (
                <button type="button" className="gdlg__btn gdlg__btn--primary" onClick={generate} disabled={loading}>
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
