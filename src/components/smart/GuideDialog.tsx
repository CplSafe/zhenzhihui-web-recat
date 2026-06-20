/**
 * AI 引导对话框(交互式)。
 * 按信息流广告思路问几个问题(人群/剧情/目标/卖点,均可选可跳过)→ 生成「创作需求」建议预览
 * → 用户确认后才回填到输入框(不擅自改写原文)。结果回填仍受 SmartEntry 的撤销/重做管理。
 */
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { guideRequirement } from '@/api/aiPolish'
import { useToast } from '@/composables/useToast'
import './GuideDialog.css'

const AUDIENCE = ['宝妈', 'Z世代', '职场白领', '银发人群', '小镇青年', '学生党', '新手宝爸', '都市女性']
const PLOT = ['痛点解决', '剧情反转', '测评种草', '口播带货', '悬念揭秘', '福利促销', '第一人称vlog', '对比测评']
const GOAL = ['转化下单', '涨粉引流', '留资获客', '促活复购', '品牌曝光']

interface GuideDialogProps {
  open: boolean
  initialText: string
  onClose: () => void
  onApply: (brief: string) => void
}

export default function GuideDialog({ open, initialText, onClose, onApply }: GuideDialogProps) {
  const { showToast } = useToast()
  const [audience, setAudience] = useState<string[]>([])
  const [plot, setPlot] = useState('')
  const [goal, setGoal] = useState('')
  const [extra, setExtra] = useState('')
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState('')

  if (!open) return null

  const toggleAud = (a: string) =>
    setAudience((prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]))

  const compose = () => {
    const lines = [`【我的想法】${initialText.trim() || '(未填写,请你基于下面的选择给出合理方向)'}`]
    if (audience.length) lines.push(`【目标人群】${audience.join('、')}`)
    if (plot) lines.push(`【剧情套路】${plot}`)
    if (goal) lines.push(`【营销目标】${goal}`)
    if (extra.trim()) lines.push(`【补充卖点/信息】${extra.trim()}`)
    return lines.join('\n')
  }

  const generate = async () => {
    if (loading) return
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
          <button type="button" className="gdlg__x" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className="gdlg__body">
          {initialText.trim() && <div className="gdlg__idea">你的想法:{initialText.trim()}</div>}

          <div className="gdlg__q">
            <div className="gdlg__label">
              ① 给谁看?<span>目标人群 · 可多选 / 跳过</span>
            </div>
            <div className="gdlg__chips">
              {AUDIENCE.map((a) => (
                <button
                  key={a}
                  type="button"
                  className={`gdlg__chip${audience.includes(a) ? ' is-on' : ''}`}
                  onClick={() => toggleAud(a)}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>

          <div className="gdlg__q">
            <div className="gdlg__label">
              ② 想要的剧情套路?<span>单选 / 跳过</span>
            </div>
            <div className="gdlg__chips">
              {PLOT.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`gdlg__chip${plot === p ? ' is-on' : ''}`}
                  onClick={() => setPlot(plot === p ? '' : p)}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div className="gdlg__q">
            <div className="gdlg__label">
              ③ 营销目标?<span>单选 / 跳过</span>
            </div>
            <div className="gdlg__chips">
              {GOAL.map((g) => (
                <button
                  key={g}
                  type="button"
                  className={`gdlg__chip${goal === g ? ' is-on' : ''}`}
                  onClick={() => setGoal(goal === g ? '' : g)}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>

          <div className="gdlg__q">
            <div className="gdlg__label">
              ④ 核心卖点 / 补充信息<span>选填</span>
            </div>
            <textarea
              className="gdlg__extra"
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              placeholder="如:主打性价比、限时五折、独家配方、明星同款…"
            />
          </div>

          {preview && (
            <div className="gdlg__preview">
              <div className="gdlg__label">建议的创作需求 · 确认后才会填入输入框</div>
              <div className="gdlg__preview-text">{preview}</div>
            </div>
          )}
        </div>

        <div className="gdlg__foot">
          <button type="button" className="gdlg__btn gdlg__btn--ghost" onClick={onClose}>
            取消
          </button>
          {!preview ? (
            <button type="button" className="gdlg__btn gdlg__btn--primary" onClick={generate} disabled={loading}>
              {loading ? '生成中…' : '生成建议'}
            </button>
          ) : (
            <>
              <button type="button" className="gdlg__btn gdlg__btn--ghost" onClick={generate} disabled={loading}>
                {loading ? '生成中…' : '重新生成'}
              </button>
              <button type="button" className="gdlg__btn gdlg__btn--primary" onClick={apply}>
                应用到输入框
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
