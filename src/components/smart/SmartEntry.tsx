/**
 * 智能成片「入口/需求输入」页(2.1,按 Figma 79:3966 还原)。
 * 大标题 + 制作视频/制作图片 Tab + 上传&提示词卡片 +
 * 风格(叫卖/幽默/商业)/比例(16:9)/时长(5s) 下拉 + @ + 发送。背景彩色渐变光晕。
 * 提交 → 调 onSubmit(需求文本, 选项),由父级进入分镜脚本流程。
 */
import { useRef, useState } from 'react'
import EntryDropdown from './EntryDropdown'
import GuideDialog from './GuideDialog'
import { fileToDataUrl } from '@/utils/imageFile'
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
  // 风格支持多选(可叠加多种调性),提交时合并成一个风格描述串
  const [styles, setStyles] = useState<string[]>(['叫卖', '幽默', '商业'])
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

  const pickImages = async (files: FileList | null) => {
    if (!files?.length) return
    const room = MAX_IMAGES - images.length
    if (room <= 0) {
      showToast(`最多上传 ${MAX_IMAGES} 张图片`, 'info')
      return
    }
    const sel = Array.from(files).slice(0, room)
    const picked = (await Promise.all(sel.map((f) => fileToDataUrl(f).catch(() => null)))).filter(
      Boolean,
    ) as string[]
    if (picked.length) setImages((prev) => [...prev, ...picked])
  }
  const removeImage = (url: string) => {
    setImages((prev) => prev.filter((u) => u !== url))
    URL.revokeObjectURL(url)
  }

  const canSubmit = text.trim().length > 0 || images.length > 0
  const submit = () => {
    if (!canSubmit) return
    onSubmit(text.trim(), { mode, style: styles.join('、'), ratio, duration, imageCount: images.length, images })
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
                {/* 倾斜浅灰卡片 + 加号(还原 Figma Group 388,无虚线边) */}
                <svg className="screate__upload-card" width="96" height="117" viewBox="0 0 109 133" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="-0.635504" y="15.0473" width="90.3131" height="120.417" rx="4" transform="rotate(-10 -0.635504 15.0473)" fill="#F8F8F8" />
                  <path d="M52.5478 56.6177C52.839 56.5663 53.1387 56.6327 53.381 56.8024C53.6232 56.972 53.7881 57.2309 53.8395 57.5221L55.1948 65.2083L62.881 63.853C63.1722 63.8017 63.4719 63.8681 63.7142 64.0377C63.9564 64.2074 64.1213 64.4663 64.1727 64.7575C64.224 65.0487 64.1576 65.3484 63.988 65.5906C63.8184 65.8328 63.5595 65.9978 63.2683 66.0491L55.582 67.4044L56.9373 75.0907C56.9886 75.3819 56.9222 75.6816 56.7526 75.9238C56.583 76.166 56.3241 76.331 56.0329 76.3823C55.7416 76.4337 55.442 76.3672 55.1997 76.1976C54.9575 76.028 54.7926 75.7691 54.7412 75.4779L53.3859 67.7916L45.6997 69.1469C45.4084 69.1983 45.1087 69.1318 44.8665 68.9622C44.6243 68.7926 44.4594 68.5337 44.408 68.2425C44.3567 67.9513 44.4231 67.6516 44.5927 67.4094C44.7623 67.1671 45.0212 67.0022 45.3124 66.9509L52.9987 65.5956L51.6434 57.9093C51.592 57.6181 51.6585 57.3184 51.8281 57.0762C51.9977 56.8339 52.2566 56.669 52.5478 56.6177Z" fill="#909090" />
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
                multiple
                placeholder="风格"
                value={styles}
                options={STYLE_OPTIONS}
                onChange={setStyles}
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
