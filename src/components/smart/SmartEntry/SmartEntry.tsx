/**
 * 智能成片「入口/需求输入」页(2.1,按 Figma 79:3966 还原)。
 * 大标题 + 制作视频/制作图片 Tab + 上传&提示词卡片 +
 * 风格(叫卖/幽默/商业)/比例(16:9)/时长(5s) 下拉 + @ + 发送。背景彩色渐变光晕。
 * 提交 → 调 onSubmit(需求文本, 选项),由父级进入分镜脚本流程。
 */
import { useRef, useState } from 'react'
import EntryDropdown from '../EntryDropdown'
import GuideDialog from '../GuideDialog'
import { fileToDataUrl } from '@/utils/imageFile'
import { useToast } from '@/composables/useToast'
import styles from './SmartEntry.module.less'

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
  const [styleTags, setStyleTags] = useState<string[]>(['叫卖', '幽默', '商业'])
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
    const picked = (await Promise.all(sel.map((f) => fileToDataUrl(f).catch(() => null)))).filter(Boolean) as string[]
    if (picked.length) setImages((prev) => [...prev, ...picked])
  }
  const removeImage = (url: string) => {
    setImages((prev) => prev.filter((u) => u !== url))
    URL.revokeObjectURL(url)
  }

  const canSubmit = text.trim().length > 0 || images.length > 0
  const submit = () => {
    if (!canSubmit) return
    onSubmit(text.trim(), { mode, style: styleTags.join('、'), ratio, duration, imageCount: images.length, images })
  }

  return (
    <div className={styles.screate}>
      {/* 背景三层(Figma):大椭圆 + 小椭圆 + 白雾蒙层 */}
      <div className={styles.bg} aria-hidden="true">
        <div className={styles.bgEllipseLg} />
        <div className={styles.bgVeil} />
      </div>

      <h1 className={styles.title}>让每一帧创意，都成为转化利器！</h1>

      <div className={styles.panel}>
        {/* Tab:制作视频 / 制作图片 */}
        <div className={styles.tabs}>
          <button
            type="button"
            className={`${styles.tab}${mode === 'video' ? ' ' + styles.active : ''}`}
            onClick={() => setMode('video')}
          >
            制作视频
          </button>
          <button
            type="button"
            className={`${styles.tab}${mode === 'image' ? ' ' + styles.active : ''}`}
            onClick={() => setMode('image')}
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
            <textarea
              className={styles.input}
              value={text}
              placeholder={PLACEHOLDER}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
              }}
            />
          </div>

          <div className={styles.toolbar}>
            <div className={styles.tools}>
              <EntryDropdown
                multiple
                placeholder="风格"
                value={styleTags}
                options={STYLE_OPTIONS}
                onChange={setStyleTags}
                icon={
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path
                      d="M9.75 2C12.0706 2 14.2962 2.92187 15.9372 4.56282C17.5781 6.20376 18.5 8.42936 18.5 10.75C18.5 13.1838 17.2038 13.38 15.65 13.295L14.4325 13.2075C13.3888 13.1425 12.3488 13.1675 11.595 13.8113C9.33625 15.1213 15.4825 19.5 9.75 19.5C7.42936 19.5 5.20376 18.5781 3.56282 16.9372C1.92187 15.2962 1 13.0706 1 10.75C1 8.42936 1.92187 6.20376 3.56282 4.56282C5.20376 2.92187 7.42936 2 9.75 2ZM9.75 3.25C8.76509 3.25 7.78982 3.44399 6.87987 3.8209C5.96993 4.19781 5.14314 4.75026 4.4467 5.4467C3.75026 6.14314 3.19781 6.96993 2.8209 7.87987C2.44399 8.78982 2.25 9.76509 2.25 10.75C2.25 11.7349 2.44399 12.7102 2.8209 13.6201C3.19781 14.5301 3.75026 15.3569 4.4467 16.0533C5.14314 16.7497 5.96993 17.3022 6.87987 17.6791C7.78982 18.056 8.76509 18.25 9.75 18.25C10.245 18.25 10.62 18.2125 10.8725 18.1538L11.0075 18.1162L10.9363 17.9175C10.8434 17.6818 10.7429 17.4492 10.635 17.22L10.535 17.0087C9.53375 14.9012 9.335 13.7662 10.7975 12.8337L10.8787 12.7825L10.895 12.77L10.965 12.7137L10.98 12.7013C11.845 12.0525 12.8225 11.8837 14.2263 11.945L14.5588 11.9637L15.5113 12.0325C16.3238 12.0837 16.675 12.0612 16.9088 11.9563C17.1187 11.8625 17.25 11.5988 17.25 10.75C17.25 8.76088 16.4598 6.85322 15.0533 5.4467C13.6468 4.04018 11.7391 3.25 9.75 3.25ZM6.625 12.0562C7.12228 12.0562 7.59919 12.2538 7.95083 12.6054C8.30246 12.9571 8.5 13.434 8.5 13.9312C8.5 14.4285 8.30246 14.9054 7.95083 15.2571C7.59919 15.6087 7.12228 15.8062 6.625 15.8062C6.12772 15.8062 5.65081 15.6087 5.29917 15.2571C4.94754 14.9054 4.75 14.4285 4.75 13.9312C4.75 13.434 4.94754 12.9571 5.29917 12.6054C5.65081 12.2538 6.12772 12.0563 6.625 12.0562ZM6.625 13.3062C6.45924 13.3062 6.30027 13.3721 6.18306 13.4893C6.06585 13.6065 6 13.7655 6 13.9312C6 14.097 6.06585 14.256 6.18306 14.3732C6.30027 14.4904 6.45924 14.5562 6.625 14.5562C6.79076 14.5562 6.94973 14.4904 7.06694 14.3732C7.18415 14.256 7.25 14.097 7.25 13.9312C7.25 13.7655 7.18415 13.6065 7.06694 13.4893C6.94973 13.3721 6.79076 13.3062 6.625 13.3062ZM12.8763 5.7525C13.1225 5.7525 13.3663 5.801 13.5938 5.89523C13.8213 5.98945 14.028 6.12756 14.2021 6.30167C14.3762 6.47578 14.5143 6.68248 14.6085 6.90997C14.7028 7.13745 14.7513 7.38127 14.7513 7.6275C14.7513 7.87373 14.7028 8.11755 14.6085 8.34503C14.5143 8.57252 14.3762 8.77922 14.2021 8.95333C14.028 9.12744 13.8213 9.26555 13.5938 9.35977C13.3663 9.454 13.1225 9.5025 12.8763 9.5025C12.379 9.5025 11.9021 9.30496 11.5504 8.95333C11.1988 8.60169 11.0013 8.12478 11.0013 7.6275C11.0013 7.13022 11.1988 6.65331 11.5504 6.30167C11.9021 5.95004 12.379 5.7525 12.8763 5.7525ZM6.625 5.75C6.87123 5.75 7.11505 5.7985 7.34253 5.89273C7.57002 5.98695 7.77672 6.12506 7.95083 6.29917C8.12494 6.47328 8.26305 6.67998 8.35727 6.90747C8.4515 7.13495 8.5 7.37877 8.5 7.625C8.5 7.87123 8.4515 8.11505 8.35727 8.34253C8.26305 8.57002 8.12494 8.77672 7.95083 8.95083C7.77672 9.12494 7.57002 9.26305 7.34253 9.35727C7.11505 9.4515 6.87123 9.5 6.625 9.5C6.12772 9.5 5.65081 9.30246 5.29917 8.95083C4.94754 8.59919 4.75 8.12228 4.75 7.625C4.75 7.12772 4.94754 6.65081 5.29917 6.29917C5.65081 5.94754 6.12772 5.75 6.625 5.75ZM12.8763 7.0025C12.7105 7.0025 12.5515 7.06835 12.4343 7.18556C12.3171 7.30277 12.2513 7.46174 12.2513 7.6275C12.2513 7.79326 12.3171 7.95223 12.4343 8.06944C12.5515 8.18665 12.7105 8.2525 12.8763 8.2525C13.042 8.2525 13.201 8.18665 13.3182 8.06944C13.4354 7.95223 13.5013 7.79326 13.5013 7.6275C13.5013 7.46174 13.4354 7.30277 13.3182 7.18556C13.201 7.06835 13.042 7.0025 12.8763 7.0025ZM6.625 7C6.45924 7 6.30027 7.06585 6.18306 7.18306C6.06585 7.30027 6 7.45924 6 7.625C6 7.79076 6.06585 7.94973 6.18306 8.06694C6.30027 8.18415 6.45924 8.25 6.625 8.25C6.79076 8.25 6.94973 8.18415 7.06694 8.06694C7.18415 7.94973 7.25 7.79076 7.25 7.625C7.25 7.45924 7.18415 7.30027 7.06694 7.18306C6.94973 7.06585 6.79076 7 6.625 7Z"
                      fill="#333333"
                    />
                  </svg>
                }
              />
              <EntryDropdown
                value={ratio}
                options={RATIO_OPTIONS}
                onChange={setRatio}
                icon={
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7">
                    <rect x="3" y="6" width="18" height="12" rx="2" />
                  </svg>
                }
              />
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

              <button
                type="button"
                className={styles.pillBtn}
                onClick={() => showToast('@参考素材(待接入)', 'info')}
                title="引用参考素材"
              >
                @
              </button>

              {/* AI 引导:打开交互式引导对话框(询问人群/剧情/目标…) */}
              <button
                type="button"
                className={styles.guide}
                onClick={() => setGuideOpen(true)}
                title="AI 引导:按信息流广告思路问几个问题,帮你把需求想得更专业"
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
                  <path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8z" />
                  <path d="M18 14l.9 2.1L21 17l-2.1.9L18 20l-.9-2.1L15 17l2.1-.9z" />
                </svg>
                AI 引导
              </button>

              {/* 撤销 / 重做(主要用于回退 AI 引导的改动) */}
              <button
                type="button"
                className={styles.iconBtn}
                onClick={undo}
                disabled={!canUndo}
                title="撤销"
                aria-label="撤销"
              >
                <svg
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M9 7H5V3" />
                  <path d="M5 7a8 8 0 1 1-2 5.3" />
                </svg>
              </button>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={redo}
                disabled={!canRedo}
                title="重做"
                aria-label="重做"
              >
                <svg
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M15 7h4V3" />
                  <path d="M19 7a8 8 0 1 0 2 5.3" />
                </svg>
              </button>
            </div>

            <button
              type="button"
              className={styles.send}
              disabled={!canSubmit}
              onClick={submit}
              aria-label="生成"
              title="生成(Ctrl/⌘ + Enter)"
            >
              {/* 发送图标:有输入=品牌绿(#1FCFA9),无输入=禁用灰(#D9D9D9) */}
              <svg
                width="40"
                height="40"
                viewBox="0 0 40 40"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <path
                  d="M34.1395 5.85926C26.3291 -1.95309 13.6662 -1.95309 5.85779 5.85926C-1.95064 13.6716 -1.95455 26.332 5.85779 34.1424C13.6701 41.9528 26.3305 41.9523 34.1409 34.1424C41.9513 26.3325 41.9494 13.6677 34.1395 5.85926ZM30.6669 18.5416L22.8687 24.4673C22.8072 24.5144 22.7338 24.5435 22.6567 24.5512C22.5796 24.5589 22.5019 24.545 22.4323 24.5109C22.3627 24.4769 22.304 24.4241 22.2627 24.3585C22.2215 24.2929 22.1993 24.2171 22.1988 24.1397V21.4981C22.1983 21.3926 22.1577 21.2911 22.0851 21.2145C22.0126 21.1378 21.9135 21.0917 21.8082 21.0855C18.2711 20.8629 15.1711 21.2349 13.072 23.4409C11.9978 24.5703 10.7024 26.81 10.3924 27.4672C10.3484 27.56 10.2674 27.7319 10.0721 27.7968L10.055 27.8022C9.98791 27.8233 9.9166 27.8271 9.84765 27.8134C9.77869 27.7997 9.71431 27.7688 9.66045 27.7236C9.47589 27.5688 9.36407 27.475 10.1058 24.4468C11.3631 19.3199 16.2702 15.9689 21.8282 15.3527C21.9297 15.3421 22.0238 15.2944 22.0923 15.2187C22.1607 15.143 22.1989 15.0447 22.1993 14.9426V12.2883C22.2002 12.2111 22.2227 12.1357 22.264 12.0704C22.3054 12.0052 22.3641 11.9528 22.4335 11.919C22.503 11.8852 22.5804 11.8714 22.6573 11.8791C22.7341 11.8868 22.8073 11.9157 22.8687 11.9627L30.6669 17.8864C30.7176 17.9246 30.7588 17.9741 30.7872 18.0309C30.8155 18.0878 30.8303 18.1505 30.8303 18.214C30.8303 18.2775 30.8155 18.3402 30.7872 18.3971C30.7588 18.4539 30.7176 18.5034 30.6669 18.5416Z"
                  fill={canSubmit ? '#1FCFA9' : '#D9D9D9'}
                />
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
