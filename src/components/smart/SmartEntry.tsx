/**
 * 智能成片「入口/需求输入」页(2.1,按 Figma 79:3966 还原)。
 * 大标题 + 制作视频/制作图片 Tab + 上传&提示词卡片 +
 * 风格(叫卖/幽默/商业)/比例(16:9)/时长(5s) 下拉 + @ + 发送。背景彩色渐变光晕。
 * 提交 → 调 onSubmit(需求文本, 选项),由父级进入分镜脚本流程。
 */
import { useRef, useState } from 'react'
import EntryDropdown from './EntryDropdown'
import { polishText } from '@/api/aiPolish'
import { useToast } from '@/composables/useToast'
import './SmartEntry.css'

export interface EntryMeta {
  mode: 'video' | 'image'
  style: string
  ratio: string
  duration: string
  imageCount: number
}

interface SmartEntryProps {
  onSubmit: (requirement: string, meta: EntryMeta) => void
}

const STYLE_OPTIONS = ['叫卖', '幽默', '商业', '治愈', '科技感', '剧情']
const RATIO_OPTIONS = ['16:9', '9:16', '1:1', '4:3', '3:4']
const DURATION_OPTIONS = ['5s', '10s', '15s', '30s']
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
  const [polishing, setPolishing] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  // AI 润色:把用户的粗略需求扩写润色成更完整的创作 brief(本地 Qwen)。
  const handlePolish = async () => {
    if (polishing) return
    if (!text.trim()) {
      showToast('请先输入创作需求', 'info')
      return
    }
    setPolishing(true)
    try {
      const out = await polishText(text, { kind: 'script' })
      setText(out)
      showToast('已润色', 'success')
    } catch (e: any) {
      showToast(e?.message || '润色失败,请重试', 'error')
    } finally {
      setPolishing(false)
    }
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
    onSubmit(text.trim(), { mode, style, ratio, duration, imageCount: images.length })
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

              {/* AI 润色:把需求扩写润色得更完整 */}
              <button
                type="button"
                className="screate__pill screate__polish"
                onClick={handlePolish}
                disabled={polishing}
                title="AI 润色:把你的需求扩写得更完整"
              >
                {polishing ? (
                  <span className="screate__polish-spin" aria-hidden="true" />
                ) : (
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8z" />
                    <path d="M18 14l.9 2.1L21 17l-2.1.9L18 20l-.9-2.1L15 17l2.1-.9z" />
                  </svg>
                )}
                {polishing ? '润色中…' : 'AI 润色'}
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
    </div>
  )
}
