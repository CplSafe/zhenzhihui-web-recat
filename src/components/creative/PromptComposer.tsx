/**
 * PromptComposer — 创意 Prompt 组合输入区
 * 聚合描述文本、时长、比例、风格、参考素材选择，带 token 计数和 AI 改写入口。
 */
import { useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import { getRatioIconStyle } from '@/utils/videoOptions'

// 外部传入的面板状态与表单数据。
// 这个组件本身不持有业务数据，所有选中值、加载状态和面板开关都由父级维护。
interface PromptComposerProps {
  panelStyle: CSSProperties
  description?: string
  activeMenu?: string
  selectedDuration: string
  selectedRatio: string
  selectedStyleText: string
  durations: string[]
  ratios: string[]
  styleOptions: string[]
  selectedStyles: string[]
  customStyle?: string
  isUploading?: boolean
  isGenerating?: boolean
  // 对父级暴露的交互事件。
  // 组件内部只负责采集用户操作，再通过回调通知父级更新状态或执行业务逻辑。
  onUpdateDescription?: (value: string) => void
  onUpdateCustomStyle?: (value: string) => void
  onFilesUpload?: (files: FileList | File[]) => void
  onToggleMenu?: (menu: string) => void
  onSelectOption?: (type: string, value: string) => void
  onToggleStyle?: (option: string) => void
  onAddCustomStyle?: () => void
  onGenerate?: () => void
}

export default function PromptComposer({
  panelStyle,
  description = '',
  activeMenu = '',
  selectedDuration,
  selectedRatio,
  selectedStyleText,
  durations,
  ratios,
  styleOptions,
  selectedStyles,
  customStyle = '',
  isUploading = false,
  isGenerating = false,
  onUpdateDescription,
  onUpdateCustomStyle,
  onFilesUpload,
  onToggleMenu,
  onSelectOption,
  onToggleStyle,
  onAddCustomStyle,
  onGenerate,
}: PromptComposerProps) {
  // 本地 DOM 引用与菜单滚动状态。
  // 这里保存的是当前组件自己要控制的细节状态，例如隐藏文件输入框和时长菜单滚动阴影。
  const fileInput = useRef<HTMLInputElement>(null)
  const durationScrollerRef = useRef<HTMLDivElement>(null)
  const showDurationFadeLeft = useRef(false)
  const showDurationFadeRight = useRef(false)
  // 用于驱动渐隐显隐重渲染（ref 本身变化不触发渲染，故配合一个强制刷新位）。
  const fadeLeftRef = useRef<HTMLSpanElement>(null)
  const fadeRightRef = useRef<HTMLSpanElement>(null)

  // 时长菜单横向滚动时，用于控制左右渐隐提示。
  // 左右两侧的渐隐只是一种"还有内容可滚动"的视觉提示，不影响真实选择逻辑。
  function updateDurationIndicators() {
    const el = durationScrollerRef.current
    if (!el) {
      showDurationFadeLeft.current = false
      showDurationFadeRight.current = false
      applyFadeVisibility()
      return
    }

    const maxScrollLeft = el.scrollWidth - el.clientWidth
    showDurationFadeLeft.current = el.scrollLeft > 1
    showDurationFadeRight.current = maxScrollLeft > 1 && el.scrollLeft < maxScrollLeft - 1
    applyFadeVisibility()
  }

  // 直接操作 DOM 显隐，对应 Vue 的 v-show（避免引入额外 state 触发整树重渲染）。
  function applyFadeVisibility() {
    if (fadeLeftRef.current) {
      fadeLeftRef.current.style.display = showDurationFadeLeft.current ? '' : 'none'
    }
    if (fadeRightRef.current) {
      fadeRightRef.current.style.display = showDurationFadeRight.current ? '' : 'none'
    }
  }

  // 打开时长菜单后，让当前选中的值自动滚动到可见区域。
  // 这样用户每次打开菜单时，都会优先看到当前已选项，避免在长列表里重新查找。
  function scrollSelectedDurationIntoView() {
    const el = durationScrollerRef.current
    if (!el) return

    const selected = el.querySelector<HTMLElement>(`[data-duration="${String(selectedDuration)}"]`)
    selected?.scrollIntoView?.({ block: 'nearest', inline: 'center' })
  }

  // 支持鼠标滚轮横向滚动时长列表。
  // 这里把纵向滚轮位移转换成横向滚动，适配这类横向按钮列表的交互体验。
  function handleDurationWheel(event: React.WheelEvent) {
    event.preventDefault()
    const el = durationScrollerRef.current
    if (!el) return
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
    el.scrollLeft += delta
    updateDurationIndicators()
  }


  // 切到时长菜单时，同步刷新滚动位置与渐隐状态。
  // 这里监听 activeMenu，是为了只在真正展开"时长"菜单时做 DOM 计算。
  useEffect(() => {
    if (activeMenu !== 'duration') return
    // nextTick：等待菜单 DOM 挂载后再计算。
    const id = window.setTimeout(() => {
      scrollSelectedDurationIntoView()
      updateDurationIndicators()
    }, 0)
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMenu])

  // 已选时长变化后，保持当前项仍然处于可视区域。
  // 例如用户点击了一个较靠后的时长按钮，更新后要继续把它留在视口中心附近。
  useEffect(() => {
    if (activeMenu !== 'duration') return
    const id = window.setTimeout(() => {
      scrollSelectedDurationIntoView()
      updateDurationIndicators()
    }, 0)
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDuration])

  // 统一从按钮触发隐藏的文件选择框。
  // 页面上看到的是自定义上传按钮，真实文件选择仍然依赖原生 input[type=file]。
  function triggerUpload() {
    fileInput.current?.click()
  }

  // 文件选择完成后，把文件列表交给父级处理，并清空 input 以支持重复选择同一文件。
  // 如果不手动清空 value，连续两次选择同一张文件时，change 事件可能不会再次触发。
  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    onFilesUpload?.(event.target.files || [])
    event.target.value = ''
  }

  return (
    <section className="prompt-panel" style={panelStyle} aria-label="广告描述输入">
      {/*
        文案输入区：负责承接用户对广告需求的自由描述。
        这里的 description 是整个创意流程的起点，后面脚本生成会基于这段文本继续展开。
      */}
      <div className="prompt-heading">你想生成什么广告？</div>

      <textarea
        value={description}
        data-testid="creative-description"
        placeholder="例：竖屏 9:16，拍一个生活化买菜 APP 广告；主体是一只手提着装满蔬菜的牛皮纸袋，从门口走进家里；场景是夜晚窗边，左暖光右冷光；镜头中近景，突出纸袋、生菜、葡萄和小番茄；整体温馨真实，不要 logo 和广告字。"
        aria-label="广告描述"
        onChange={(e) => onUpdateDescription?.(e.target.value)}
      ></textarea>

      <button type="button" className="upload-button" disabled={isUploading} onClick={triggerUpload}>
        <svg viewBox="0 0 14 14" aria-hidden="true">
          <path
            d="M10.071 5.95874C10.6935 5.96445 11.2889 6.21426 11.7291 6.65445C12.1692 7.09463 12.4191 7.69001 12.4248 8.31249C12.4251 8.92327 12.1875 9.51016 11.7624 9.94874C11.3144 10.4186 10.7098 10.6557 10.0728 10.6645C9.14001 10.6759 9.13914 12.1231 10.0728 12.1117C11.0764 12.0988 12.0352 11.6944 12.7449 10.9847C13.4547 10.275 13.8591 9.3161 13.872 8.31249C13.8983 6.22474 12.1194 4.53949 10.0728 4.51324C9.13914 4.50099 9.14001 5.94824 10.0728 5.95962L10.071 5.95874ZM3.89963 10.6549C3.2779 10.6485 2.68346 10.3986 2.24389 9.95888C1.80431 9.51914 1.55466 8.9246 1.54851 8.30287C1.54821 7.69209 1.78579 7.1052 2.21088 6.66662C2.65888 6.19587 3.26351 5.95787 3.90051 5.95087C4.83326 5.93862 4.83413 4.49137 3.90051 4.50362C2.89675 4.51631 1.93766 4.92064 1.22776 5.63038C0.517858 6.34012 0.113311 7.29911 0.100385 8.30287C0.0741345 10.3897 1.85301 12.075 3.89963 12.1021C4.83326 12.1135 4.83238 10.6671 3.89963 10.6549ZM4.64459 5.25263C4.65075 4.63075 4.90052 4.03608 5.34028 3.59632C5.78004 3.15656 6.37471 2.90679 6.99659 2.90063C7.60737 2.90034 8.19426 3.13792 8.63284 3.56301C9.10272 4.01101 9.33984 4.61563 9.34859 5.25263C9.36084 6.18538 10.8072 6.18626 10.7958 5.25263C10.7829 4.24902 10.3785 3.29016 9.66878 2.58044C8.95906 1.87073 8.0002 1.4663 6.99659 1.45338C4.90884 1.42713 3.22359 3.20601 3.19734 5.25263C3.18509 6.18626 4.63234 6.18538 4.64459 5.25263ZM7.45159 6.46801C7.56017 6.57663 7.62116 6.72392 7.62116 6.87751C7.62116 7.03109 7.56017 7.17838 7.45159 7.28701L5.77159 8.96701C5.66222 9.07185 5.51613 9.12966 5.36463 9.12806C5.21313 9.12646 5.06829 9.06557 4.96116 8.95844C4.85403 8.85131 4.79314 8.70647 4.79154 8.55497C4.78994 8.40347 4.84775 8.25738 4.95259 8.14801L6.63259 6.46801C6.74122 6.35943 6.88851 6.29844 7.04209 6.29844C7.19568 6.29844 7.34297 6.35943 7.45159 6.46801Z"
            fill="#909090"
          />
          <path
            d="M6.63232 6.468C6.74094 6.35942 6.88824 6.29843 7.04182 6.29843C7.1954 6.29843 7.3427 6.35942 7.45132 6.468L9.13132 8.148C9.23305 8.25786 9.28829 8.40283 9.28545 8.55253C9.28262 8.70223 9.22193 8.84501 9.11612 8.95094C9.01031 9.05687 8.86759 9.11771 8.71789 9.1207C8.5682 9.1237 8.42316 9.06861 8.3132 8.967L6.6332 7.287C6.52462 7.17838 6.46363 7.03108 6.46363 6.8775C6.46363 6.72392 6.52462 6.57662 6.6332 6.468H6.63232ZM7.02782 8.6695C7.35594 8.6695 7.62107 8.9355 7.62107 9.26275V11.6979C7.62107 11.8552 7.55857 12.0061 7.44731 12.1174C7.33606 12.2286 7.18516 12.2911 7.02782 12.2911C6.87048 12.2911 6.71959 12.2286 6.60833 12.1174C6.49707 12.0061 6.43457 11.8552 6.43457 11.6979V9.26275C6.43457 8.93462 6.70057 8.6695 7.02782 8.6695Z"
            fill="#909090"
          />
        </svg>
        {isUploading ? '上传中' : '上传文件'}
      </button>
      <input
        ref={fileInput}
        className="file-input"
        type="file"
        multiple
        accept="image/*,video/*"
        onChange={handleFileChange}
      />

      {/*
        参数控制区：把"时长 / 比例 / 风格"三类结构化条件集中展示。
        这部分负责补充描述文本之外的硬约束，让后续生成结果更可控。
      */}
      <div className="control-strip">
        <div className="control-item">
          {/* 时长选择：使用横向滚动列表承载多个时长选项。 */}
          <span>
            <svg className="control-icon" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <g clipPath="url(#durationIconClip)">
                <path
                  d="M6 11C8.76142 11 11 8.76142 11 6C11 3.23858 8.76142 1 6 1C3.23858 1 1 3.23858 1 6C1 8.76142 3.23858 11 6 11Z"
                  stroke="#909090"
                  strokeWidth="1.16667"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M6 3V6L8 7"
                  stroke="#909090"
                  strokeWidth="1.16667"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
              <defs>
                <clipPath id="durationIconClip">
                  <rect width="12" height="12" fill="white" />
                </clipPath>
              </defs>
            </svg>
            时长
          </span>
          <button type="button" onClick={() => onToggleMenu?.('duration')}>
            {selectedDuration}
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <path d="M3 4.5 6 7.5 9 4.5" />
            </svg>
          </button>
          {activeMenu === 'duration' && (
            <div className="control-menu duration-menu">
              <span
                ref={fadeLeftRef}
                className="duration-fade left"
                aria-hidden="true"
                style={{ display: showDurationFadeLeft.current ? '' : 'none' }}
              ></span>
              <span
                ref={fadeRightRef}
                className="duration-fade right"
                aria-hidden="true"
                style={{ display: showDurationFadeRight.current ? '' : 'none' }}
              ></span>
              <div
                ref={durationScrollerRef}
                className="duration-scroll"
                onScroll={updateDurationIndicators}
                onWheel={handleDurationWheel}
              >
                {durations.map((option) => (
                  <button
                    key={option}
                    data-duration={option}
                    type="button"
                    className={option === selectedDuration ? 'checked' : undefined}
                    onClick={() => onSelectOption?.('duration', option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="control-item">
          {/* 比例选择：通过简化图标展示不同宽高比。 */}
          <span>
            <svg className="control-icon" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path
                d="M11.0452 0.6315C11.538 0.6315 11.946 0.969 11.9948 1.40175L12 1.4895V10.518C12 10.9628 11.6228 11.328 11.1427 11.3715L11.0452 11.376H0.95475C0.462 11.376 0.054 11.0385 0.00525 10.6058L0 10.518V1.4895C0 1.04475 0.37725 0.6795 0.85725 0.636L0.95475 0.6315H11.0452ZM11.0452 1.452H0.95475L0.91725 10.518L11.0452 10.5555L11.0828 1.4895L11.0452 1.452Z"
                fill="#909090"
              />
              <path
                d="M8.42978 3.8175L10.3678 5.7555C10.4878 5.8755 10.5028 6.06075 10.4128 6.19725L10.3678 6.25201L8.37653 8.19L7.77803 7.539L9.33953 6.03L7.77803 4.416L8.37653 3.8175H8.42903H8.42978ZM3.62303 3.8175L4.22153 4.4685L2.66003 5.9775L4.22153 7.5915L3.57053 8.19L1.63253 6.25201C1.57544 6.19489 1.5398 6.11984 1.5316 6.03951C1.5234 5.95917 1.54315 5.87847 1.58753 5.811L1.63253 5.7555L3.56978 3.8175H3.62228H3.62303Z"
                fill="#909090"
              />
            </svg>
            比例
          </span>
          <button type="button" onClick={() => onToggleMenu?.('ratio')}>
            {selectedRatio}
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <path d="M3 4.5 6 7.5 9 4.5" />
            </svg>
          </button>
          {activeMenu === 'ratio' && (
            <div className="control-menu ratio-menu">
              <div className="ratio-menu-title">选择比例</div>
              <div className="ratio-menu-options">
                {ratios.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={['ratio-menu-option', option === selectedRatio ? 'checked' : '']
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => onSelectOption?.('ratio', option)}
                  >
                    <span className="ratio-menu-icon" style={getRatioIconStyle(option)}></span>
                    <span className="ratio-menu-label">{option}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="control-item style-control">
          {/* 风格选择：支持多选预设风格，并允许录入一个自定义风格标签。 */}
          <span className="style-label">
            <svg className="control-icon" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <g clipPath="url(#styleIconClip)">
                <path
                  d="M6.75 3.5C6.88807 3.5 7 3.38807 7 3.25C7 3.11193 6.88807 3 6.75 3C6.61193 3 6.5 3.11193 6.5 3.25C6.5 3.38807 6.61193 3.5 6.75 3.5Z"
                  fill="#909090"
                  stroke="#909090"
                  strokeWidth="1.16667"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M8.75 5.5C8.88807 5.5 9 5.38807 9 5.25C9 5.11193 8.88807 5 8.75 5C8.61193 5 8.5 5.11193 8.5 5.25C8.5 5.38807 8.61193 5.5 8.75 5.5Z"
                  fill="#909090"
                  stroke="#909090"
                  strokeWidth="1.16667"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M4.25 4C4.38807 4 4.5 3.88807 4.5 3.75C4.5 3.61193 4.38807 3.5 4.25 3.5C4.11193 3.5 4 3.61193 4 3.75C4 3.88807 4.11193 4 4.25 4Z"
                  fill="#909090"
                  stroke="#909090"
                  strokeWidth="1.16667"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M3.25 6.5C3.38807 6.5 3.5 6.38807 3.5 6.25C3.5 6.11193 3.38807 6 3.25 6C3.11193 6 3 6.11193 3 6.25C3 6.38807 3.11193 6.5 3.25 6.5Z"
                  fill="#909090"
                  stroke="#909090"
                  strokeWidth="1.16667"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M6 1C3.25 1 1 3.25 1 6C1 8.75 3.25 11 6 11C6.463 11 6.824 10.627 6.824 10.156C6.824 9.9375 6.734 9.7385 6.6055 9.5935C6.4605 9.449 6.3865 9.2675 6.3865 9.031C6.3846 8.92095 6.40488 8.81165 6.44612 8.70961C6.48736 8.60757 6.54873 8.51487 6.62655 8.43705C6.70437 8.35923 6.79707 8.29786 6.89911 8.25662C7.00115 8.21538 7.11045 8.1951 7.2205 8.197H8.2185C9.744 8.197 10.996 6.9455 10.996 5.42C10.9825 3.006 8.7305 1 6 1Z"
                  stroke="#909090"
                  strokeWidth="1.16667"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
              <defs>
                <clipPath id="styleIconClip">
                  <rect width="12" height="12" fill="white" />
                </clipPath>
              </defs>
            </svg>
            风格
          </span>
          <button type="button" onClick={() => onToggleMenu?.('style')}>
            {selectedStyleText}
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <path d="M3 4.5 6 7.5 9 4.5" />
            </svg>
          </button>
          {activeMenu === 'style' && (
            <div className="control-menu style-menu">
              {styleOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={selectedStyles.includes(option) ? 'checked' : undefined}
                  onClick={() => onToggleStyle?.(option)}
                >
                  {option}
                </button>
              ))}
              <div className="custom-style-row">
                <input
                  value={customStyle}
                  type="text"
                  placeholder="自定义风格"
                  aria-label="自定义风格"
                  onChange={(e) => onUpdateCustomStyle?.(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      onAddCustomStyle?.()
                    }
                  }}
                />
                <button type="button" className="custom-style-button" onClick={() => onAddCustomStyle?.()}>
                  添加
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/*
        主操作按钮：汇总当前文本、上传素材和结构化选项，通知父级开始生成创意脚本。
        真正的生成逻辑不在当前组件内部，而是在父级收到 generate 事件后执行。
      */}
      <button
        type="button"
        className="send-button"
        aria-label="生成创意脚本"
        disabled={isGenerating}
        onClick={() => onGenerate?.()}
      >
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path d="M27.3125 4.68741C21.0642 -1.56247 10.934 -1.56247 4.68721 4.68741C-1.55954 10.9373 -1.56266 21.0656 4.68721 27.3139C10.9371 33.5622 21.0654 33.5618 27.3137 27.3139C33.562 21.066 33.5605 10.9342 27.3125 4.68741ZM24.5345 14.8333L18.2959 19.5738C18.2467 19.6115 18.188 19.6348 18.1263 19.641C18.0647 19.6471 18.0025 19.636 17.9468 19.6087C17.8911 19.5815 17.8441 19.5393 17.8111 19.4868C17.7781 19.4343 17.7604 19.3737 17.76 19.3117V17.1985C17.7596 17.114 17.7271 17.0329 17.6691 16.9716C17.611 16.9103 17.5318 16.8734 17.4475 16.8684C14.6179 16.6903 12.1378 16.9879 10.4586 18.7528C9.59922 19.6562 8.56291 21.448 8.31487 21.9738C8.27972 22.048 8.21488 22.1855 8.05863 22.2374L8.04496 22.2417C7.9913 22.2586 7.93426 22.2617 7.87909 22.2507C7.82393 22.2397 7.77243 22.215 7.72934 22.1789C7.58169 22.055 7.49223 21.98 8.08558 19.5574C9.09142 15.4559 13.0171 12.7751 17.4635 12.2822C17.5448 12.2737 17.62 12.2355 17.6748 12.175C17.7296 12.1144 17.7601 12.0357 17.7604 11.9541V9.83066C17.7612 9.76888 17.7791 9.70853 17.8122 9.65636C17.8453 9.60418 17.8922 9.56224 17.9478 9.53521C18.0034 9.50818 18.0653 9.49713 18.1268 9.50329C18.1883 9.50946 18.2468 9.5326 18.2959 9.57012L24.5345 14.3091C24.5751 14.3397 24.608 14.3793 24.6307 14.4247C24.6534 14.4702 24.6652 14.5204 24.6652 14.5712C24.6652 14.622 24.6534 14.6722 24.6307 14.7176C24.608 14.7631 24.5751 14.8027 24.5345 14.8333Z" />
        </svg>
      </button>
    </section>
  )
}
