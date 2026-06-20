/**
 * 智能成片「入口/需求输入」页(2.1,按 Figma 79:3966 还原)。
 * 大标题 + 制作视频/制作图片 Tab + 上传&提示词卡片 +
 * 风格(叫卖/幽默/商业)/比例(16:9)/时长(5s) 下拉 + @ + 发送。背景彩色渐变光晕。
 * 提交 → 调 onSubmit(需求文本, 选项),由父级进入分镜脚本流程。
 */
import { useRef, useState } from 'react'
import EntryDropdown from './EntryDropdown'
import GuideDialog from './GuideDialog'
import { useToast } from '@/composables/useToast'
import './SmartEntry.css'

export interface EntryMeta {
  mode: 'video' | 'image'
  style: string
  ratio: string
  duration: string
  imageCount: number
  images: string[]
}

interface SmartEntryProps {
  onSubmit: (requirement: string, meta: EntryMeta) => void
}

const STYLE_OPTIONS = ['叫卖', '幽默', '商业', '治愈', '科技感', '剧情']
const RATIO_OPTIONS = ['16:9', '9:16', '1:1', '4:3', '3:4']
const DURATION_OPTIONS = ['5s', '10s', '15s']
const MAX_IMAGES = 9

const PLACEHOLDER =
  '最多上传9张图片，输入文字或@参考素材，生成精彩广告视频。例如：把 @图片1 中的产品放到 @图片2 中的场景里'

export default function SmartEntry({ onSubmit }: SmartEntryProps) {
  const { showToast } = useToast()
  const [mode, setMode] = useState<'video' | 'image'>('video')
  const [text, setText] = useState('')
  const [style, setStyle] = useState('商业')
  const [ratio, setRatio] = useState('16:9')
  const [duration, setDuration] = useState('5s')
  const [images, setImages] = useState<string[]>([])
  const [guideOpen, setGuideOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  // ── 需求文本的撤销/重做历史(AI 引导会改写文本,需可回退/前进)──
  const histRef = useRef<string[]>([''])
  const idxRef = useRef(0)
  const [, bumpHist] = useState(0)
  const commitText = (val: string) => {
    if (histRef.current[idxRef.current] === val) return
    const next = histRef.current.slice(0, idxRef.current + 1)
    next.push(val)
    histRef.current = next
    idxRef.current = next.length - 1
    bumpHist((v) => v + 1)
  }
  const undo = () => {
    // 有未提交的手动编辑 → 先回到最近快照;否则回退一步
    if (text !== histRef.current[idxRef.current]) {
      setText(histRef.current[idxRef.current])
    } else if (idxRef.current > 0) {
      idxRef.current -= 1
      setText(histRef.current[idxRef.current])
    }
    bumpHist((v) => v + 1)
  }
  const redo = () => {
    if (text === histRef.current[idxRef.current] && idxRef.current < histRef.current.length - 1) {
      idxRef.current += 1
      setText(histRef.current[idxRef.current])
      bumpHist((v) => v + 1)
    }
  }
  const canUndo = idxRef.current > 0 || text !== histRef.current[idxRef.current]
  const canRedo = text === histRef.current[idxRef.current] && idxRef.current < histRef.current.length - 1

  // AI 引导:打开交互式对话框(问人群/剧情/目标…),用户确认后再回填(不擅自改原文)。
  const applyGuide = (brief: string) => {
    commitText(text) // 快照当前输入,便于回退
    setText(brief)
    commitText(brief) // 快照引导结果,便于重做
  }

  const pickImages = (files: FileList | null) => {
    if (!files?.length) return
    const room = MAX_IMAGES - images.length
    if (room <= 0) {
      showToast(`最多上传 ${MAX_IMAGES} 张图片`, 'info')
      return
    }
    const picked = Array.from(files)
      .slice(0, room)
      .map((f) => URL.createObjectURL(f))
    setImages((prev) => [...prev, ...picked])
  }
  const removeImage = (url: string) => {
    setImages((prev) => prev.filter((u) => u !== url))
    URL.revokeObjectURL(url)
  }

  const canSubmit = text.trim().length > 0 || images.length > 0
  const submit = () => {
    if (!canSubmit) return
    onSubmit(text.trim(), { mode, style, ratio, duration, imageCount: images.length, images })
  }

  return (
    <div className="screate">
      <h1 className="screate__title">让每一帧创意，都成为转化利器！</h1>

      <div className="screate__panel">
        {/* Tab:制作视频 / 制作图片 */}
        <div className="screate__tabs">
          <button
            type="button"
            className={`screate__tab${mode === 'video' ? ' is-active' : ''}`}
            onClick={() => setMode('video')}
          >
            制作视频
          </button>
          <button
            type="button"
            className={`screate__tab${mode === 'image' ? ' is-active' : ''}`}
            onClick={() => setMode('image')}
          >
            制作图片
          </button>
        </div>

        <div className="screate__card">
          {/* 已选图片:独立成一行(可换行),不挤压文本框;参考主流 AI 输入框做法 */}
          {images.length > 0 && (
            <div className="screate__attachments">
              {images.map((url) => (
                <div className="screate__thumb" key={url}>
                  <img src={url} alt="" />
                  <button type="button" className="screate__thumb-x" onClick={() => removeImage(url)} aria-label="移除">
                    ×
                  </button>
                </div>
              ))}
              {images.length < MAX_IMAGES && (
                <button
                  type="button"
                  className="screate__add"
                  onClick={() => fileRef.current?.click()}
                  aria-label="继续上传"
                >
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
              )}
            </div>
          )}

          <div className="screate__card-body">
            {/* 无图时:左侧上传框(Figma 初始态);有图时上传入口在上方缩略图行 */}
            {images.length === 0 && (
              <button type="button" className="screate__upload" onClick={() => fileRef.current?.click()} aria-label="上传图片">
                <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
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
            <textarea
              className="screate__input"
              value={text}
              placeholder={PLACEHOLDER}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
              }}
            />
          </div>

          <div className="screate__toolbar">
            <div className="screate__tools">
              <EntryDropdown
                value={style}
                options={STYLE_OPTIONS}
                onChange={setStyle}
                icon={
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8z" />
                  </svg>
                }
              />
              <EntryDropdown
                value={ratio}
                options={RATIO_OPTIONS}
                onChange={setRatio}
                icon={
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7">
                    <rect x="3" y="6" width="18" height="12" rx="2" />
                  </svg>
                }
              />
              <EntryDropdown
                value={duration}
                options={DURATION_OPTIONS}
                onChange={setDuration}
                icon={
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
                    <circle cx="12" cy="12" r="8" />
                    <path d="M12 8v4l3 2" />
                  </svg>
                }
              />

              <button
                type="button"
                className="screate__pill screate__pill--btn"
                onClick={() => showToast('@参考素材(待接入)', 'info')}
                title="引用参考素材"
              >
                @
              </button>

              {/* AI 引导:打开交互式引导对话框(询问人群/剧情/目标…) */}
              <button
                type="button"
                className="screate__pill screate__guide"
                onClick={() => setGuideOpen(true)}
                title="AI 引导:按信息流广告思路问几个问题,帮你把需求想得更专业"
              >
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8z" />
                  <path d="M18 14l.9 2.1L21 17l-2.1.9L18 20l-.9-2.1L15 17l2.1-.9z" />
                </svg>
                AI 引导
              </button>

              {/* 撤销 / 重做(主要用于回退 AI 引导的改动) */}
              <button
                type="button"
                className="screate__pill screate__icon-btn"
                onClick={undo}
                disabled={!canUndo}
                title="撤销"
                aria-label="撤销"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 7H5V3" />
                  <path d="M5 7a8 8 0 1 1-2 5.3" />
                </svg>
              </button>
              <button
                type="button"
                className="screate__pill screate__icon-btn"
                onClick={redo}
                disabled={!canRedo}
                title="重做"
                aria-label="重做"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 7h4V3" />
                  <path d="M19 7a8 8 0 1 0 2 5.3" />
                </svg>
              </button>
            </div>

            <button
              type="button"
              className="screate__send"
              disabled={!canSubmit}
              onClick={submit}
              aria-label="生成"
              title="生成(Ctrl/⌘ + Enter)"
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </button>
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
