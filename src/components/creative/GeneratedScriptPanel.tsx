/**
 * GeneratedScriptPanel — 生成脚本展示与编辑面板
 * 流式渲染 AI 生成的创意脚本 Markdown，内嵌分镜词 JSON 的可视化编辑（标题/画面描述/旁白/字幕/音效），
 * 支持编辑后回写 generatedScript 文本。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Streamdown } from 'streamdown'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { extractStoryboardPayload } from '@/utils/creativeScript'
import { getMaterialPoster, isVideoMaterial } from '@/utils/materials'
import { getRatioIconStyle } from '@/utils/videoOptions'
import './GeneratedScriptPanel.css'

const MARKER_OPEN = '<<<STORYBOARD_JSON>>>'
const MARKER_CLOSE = '<<<END_STORYBOARD_JSON>>>'

// 外部传入的脚本生成面板状态。
// 这个组件同时承担“脚本展示”和“脚本局部编辑”两件事，但真实数据依然由父级维护。
interface GeneratedScriptPanelProps {
  panelStyle: Record<string, any>
  compactMaterialStack: any[]
  compactPromptText: string
  promptText: string
  activeMenu?: string
  selectedDuration: string
  selectedRatio: string
  selectedStyleText: string
  durations: string[]
  ratios: string[]
  styleOptions: string[]
  selectedStyles: string[]
  customStyle?: string
  generatedScript?: string
  isPending?: boolean
  isStreaming?: boolean
  canGenerateStoryboard?: boolean
  // 对父级抛出的脚本相关事件。
  // 包括参数切换、重新生成、复制、脚本回写、分镜解析结果同步等。
  onOpenLibrary?: () => void
  onToggleMenu?: (menu: string) => void
  onSelectOption?: (type: string, option: string) => void
  onToggleStyle?: (option: string) => void
  onCustomStyleChange?: (value: string) => void
  onPromptTextChange?: (value: string) => void
  onAddCustomStyle?: () => void
  onGenerate?: () => void
  onCopy?: () => void
  onRegenerate?: () => void
  onGeneratedScriptChange?: (value: string) => void
  onGenerateStoryboard?: () => void
  onStoryboardsParsed?: (items: any[]) => void
  onStoryboardsUpdated?: (items: any[]) => void
  onRemoveMaterial?: (id: any) => void
}

export default function GeneratedScriptPanel(props: GeneratedScriptPanelProps) {
  const {
    panelStyle,
    compactMaterialStack,
    promptText,
    activeMenu = '',
    selectedDuration,
    selectedRatio,
    selectedStyleText,
    durations,
    ratios,
    styleOptions,
    selectedStyles,
    customStyle = '',
    generatedScript = '',
    isPending = false,
    isStreaming = false,
    canGenerateStoryboard = false,
  } = props

  // 本地 UI 状态。
  // 主要控制时长横向滚动、Prompt 行内编辑、脚本 Markdown 编辑器和分镜预览区域。
  const durationScrollerRef = useRef<HTMLDivElement | null>(null)
  const [showDurationFadeLeft, setShowDurationFadeLeft] = useState(false)
  const [showDurationFadeRight, setShowDurationFadeRight] = useState(false)
  const editingPromptRef = useRef(false)

  // 只有在非生成中状态下，才允许直接编辑 Prompt 文本。
  const canEditPrompt = !isStreaming && !isPending

  // 时长菜单滚动时的左右渐隐提示。
  const updateDurationIndicators = useCallback(() => {
    const el = durationScrollerRef.current
    if (!el) {
      setShowDurationFadeLeft(false)
      setShowDurationFadeRight(false)
      return
    }

    const maxScrollLeft = el.scrollWidth - el.clientWidth
    setShowDurationFadeLeft(el.scrollLeft > 1)
    setShowDurationFadeRight(maxScrollLeft > 1 && el.scrollLeft < maxScrollLeft - 1)
  }, [])

  // 打开时长菜单后，自动把当前选中项滚动到可见区域。
  const scrollSelectedDurationIntoView = useCallback(() => {
    const el = durationScrollerRef.current
    if (!el) return

    const selected = el.querySelector(`[data-duration="${String(selectedDuration)}"]`) as HTMLElement | null
    selected?.scrollIntoView?.({ block: 'nearest', inline: 'center' })
  }, [selectedDuration])

  // 支持用鼠标滚轮横向滚动时长选项。
  function handleDurationWheel(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault()
    const el = durationScrollerRef.current
    if (!el) return
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
    el.scrollLeft += delta
    updateDurationIndicators()
  }

  // Prompt 富文本编辑器（原 contenteditable，改用 @tiptap/react）。
  // 将父级最新 Prompt 文本同步到编辑器；当用户正在编辑时不强行覆盖，避免输入中的内容跳动。
  const promptEditor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: '修改广告描述' }),
    ],
    editable: canEditPrompt,
    content: String(promptText || ''),
    onFocus: () => {
      // Prompt 区聚焦后进入本地编辑态。
      if (!canEditPrompt) return
      editingPromptRef.current = true
    },
    onBlur: ({ editor }) => {
      // Prompt 失焦后，把编辑结果回写给父级。
      if (!canEditPrompt) return
      editingPromptRef.current = false
      const text = String(editor.getText() || '').trim()
      props.onPromptTextChange?.(text)
    },
    editorProps: {
      handleKeyDown: (_view, event) => {
        // @keydown.enter.prevent —— 禁止换行。
        if (event.key === 'Enter') {
          event.preventDefault()
          return true
        }
        return false
      },
    },
  })

  // 将父级最新 Prompt 文本同步到编辑器。
  useEffect(() => {
    if (!promptEditor) return
    if (editingPromptRef.current) return
    const next = String(promptText || '')
    if (promptEditor.getText() !== next) {
      promptEditor.commands.setContent(next)
    }
  }, [promptEditor, promptText])

  // 同步可编辑态。
  useEffect(() => {
    promptEditor?.setEditable(canEditPrompt)
  }, [promptEditor, canEditPrompt])

  // 展开时长菜单时，同步刷新滚动位置与渐隐状态。
  useEffect(() => {
    if (activeMenu !== 'duration') return
    // nextTick 等价：等待菜单 DOM 渲染后再滚动。
    const id = requestAnimationFrame(() => {
      scrollSelectedDurationIntoView()
      updateDurationIndicators()
    })
    return () => cancelAnimationFrame(id)
  }, [activeMenu, scrollSelectedDurationIntoView, updateDurationIndicators])

  // 已选时长发生变化后，保持选中项仍处于可视区域。
  useEffect(() => {
    if (activeMenu !== 'duration') return
    const id = requestAnimationFrame(() => {
      scrollSelectedDurationIntoView()
      updateDurationIndicators()
    })
    return () => cancelAnimationFrame(id)
  }, [selectedDuration, activeMenu, scrollSelectedDurationIntoView, updateDurationIndicators])

  // 从生成脚本文本中解析 Markdown 正文与内嵌分镜 JSON。
  // 这里是脚本面板和分镜面板之间的重要桥梁。
  const scriptPayload = useMemo(() => extractStoryboardPayload(generatedScript || ''), [generatedScript])

  const markdownText = useMemo(() => scriptPayload.markdown || '', [scriptPayload])

  const storyboardPreview = useMemo(
    () => ({
      items: scriptPayload.storyboards,
      rawJson: scriptPayload.jsonText,
      visible: scriptPayload.hasMarker,
    }),
    [scriptPayload],
  )

  // 脚本正文编辑区域的本地状态。
  const canEditScript = !isStreaming && !isPending
  const scriptEditorRef = useRef<HTMLTextAreaElement | null>(null)
  const [editingScript, setEditingScript] = useState(false)
  const [scriptDraftMarkdown, setScriptDraftMarkdown] = useState('')
  const storyboardPreviewRef = useRef<HTMLElement | null>(null)
  const editingStoryboardsRef = useRef(false)

  // 把“Markdown 正文 + 原始分镜 JSON”重新拼回完整脚本文本。
  // 这样在只编辑 Markdown 时，内嵌的分镜 JSON 仍然可以保持不丢失。
  const buildScriptTextFromMarkdown = useCallback(
    (markdown: string): string => {
      const md = String(markdown ?? '').trimEnd()
      if (!scriptPayload.hasMarker) {
        return md
      }
      const rawJson = String(scriptPayload.jsonText ?? '').trim()
      const lines: string[] = []
      if (md) lines.push(md, '')
      lines.push(MARKER_OPEN)
      if (rawJson) lines.push(rawJson)
      lines.push(MARKER_CLOSE)
      return lines.join('\n').trimEnd()
    },
    [scriptPayload],
  )

  // 打开脚本编辑器时，先把当前 Markdown 内容拷贝到本地草稿。
  function openScriptEditor() {
    if (!canEditScript) return
    if (editingScript) return
    setEditingScript(true)
    setScriptDraftMarkdown(markdownText)
    requestAnimationFrame(() => scriptEditorRef.current?.focus?.())
  }

  // 关闭脚本编辑器，退出局部编辑态。
  function closeScriptEditor() {
    if (!editingScript) return
    setEditingScript(false)
    const nextText = buildScriptTextFromMarkdown(scriptDraftMarkdown)
    if (nextText !== (generatedScript || '').trimEnd()) {
      props.onGeneratedScriptChange?.(nextText)
    }
  }

  // 父级 generatedScript 变化时，若未在编辑则同步本地草稿。
  useEffect(() => {
    if (!editingScript) {
      setScriptDraftMarkdown(markdownText)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generatedScript])

  // 分镜可视化编辑本地状态。
  const [editableStoryboards, setEditableStoryboards] = useState<any[]>([])

  // storyboardPreview.items 变化时，若未处于编辑态则同步可编辑副本。
  useEffect(() => {
    if (editingStoryboardsRef.current) return
    const list = Array.isArray(storyboardPreview.items) ? storyboardPreview.items : []
    setEditableStoryboards(list.map((item: any) => ({ ...item })))
     
  }, [storyboardPreview.items])

  function updateStoryboardField(index: number, field: string, value: any) {
    setEditableStoryboards((prevList) => {
      const list = Array.isArray(prevList) ? prevList.slice() : []
      const prev = list[index] || {}
      list[index] = { ...prev, [field]: value }
      return list
    })
  }

  function autoResizeTextarea(target: any) {
    const el = target && typeof target === 'object' ? target : null
    if (!el || el.tagName !== 'TEXTAREA') return
    el.style.height = '0px'
    el.style.height = `${el.scrollHeight}px`
  }

  const resizeAllStoryboardTextareas = useCallback(() => {
    requestAnimationFrame(() => {
      const root = storyboardPreviewRef.current
      const nodes = root?.querySelectorAll?.('textarea.storyboard-inline-textarea') || []
      nodes.forEach((node) => autoResizeTextarea(node))
    })
  }, [])

  function handleStoryboardTextareaInput(index: number, field: string, event: React.ChangeEvent<HTMLTextAreaElement>) {
    autoResizeTextarea(event?.target)
    updateStoryboardField(index, field, event?.target?.value ?? '')
  }

  function commitStoryboards() {
    if (!canEditScript) return
    const list = Array.isArray(editableStoryboards) ? editableStoryboards : []
    if (!list.length) return
    props.onStoryboardsUpdated?.(
      list.map((item, idx) => ({
        ...item,
        index: idx,
      })),
    )
  }

  // editableStoryboards 变化后重新计算 textarea 高度。
  useEffect(() => {
    resizeAllStoryboardTextareas()
  }, [editableStoryboards, resizeAllStoryboardTextareas])

  // 可编辑态恢复时重新计算 textarea 高度。
  useEffect(() => {
    if (canEditScript) resizeAllStoryboardTextareas()
  }, [canEditScript, resizeAllStoryboardTextareas])

  // 解析到分镜数据时，向父级抛出 storyboards-parsed。
  useEffect(() => {
    const items = storyboardPreview.items
    if (items && items.length) {
      props.onStoryboardsParsed?.(items)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyboardPreview.items])

  return (
    <section className="generating-view" style={panelStyle} aria-label="创意生成中">
      <section className="generated-prompt-panel" aria-label="创意生成请求">
        {compactMaterialStack.length ? (
          <div className="compact-material-stack" aria-hidden="true">
            {compactMaterialStack.map((material, index) => (
              <figure
                key={material.id}
                style={{ left: `${index * 10}px`, top: `${index === 2 ? 24 : 14}px` }}
              >
                <button
                  type="button"
                  className="compact-material-remove"
                  aria-label={`删除素材 ${material.name}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    props.onRemoveMaterial?.(material.id)
                  }}
                >
                  <svg viewBox="0 0 12 12" aria-hidden="true">
                    <path d="M3 3 9 9M9 3 3 9" />
                  </svg>
                </button>
                {isVideoMaterial(material) && getMaterialPoster(material) ? (
                  <img src={getMaterialPoster(material)} alt={material.name} />
                ) : material?.src ? (
                  <img src={material.src} alt={material.name} />
                ) : (
                  <span className="compact-material-fallback">{isVideoMaterial(material) ? '视频' : '图片'}</span>
                )}
              </figure>
            ))}
          </div>
        ) : null}

        <EditorContent
          editor={promptEditor}
          className="compact-prompt-text compact-prompt-editor"
          role="textbox"
          aria-label="修改广告描述"
          spellCheck={false}
        />

        <button type="button" className="compact-add-material" onClick={() => props.onOpenLibrary?.()}>
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <g clipPath="url(#compactAddMaterialClip)">
              <path
                d="M9.23499 6.5184C9.34107 6.5184 9.44282 6.56054 9.51783 6.63556C9.59284 6.71057 9.63499 6.81231 9.63499 6.9184V8.5928H11.3086C11.3611 8.5928 11.4131 8.60315 11.4617 8.62325C11.5102 8.64335 11.5543 8.67281 11.5914 8.70996C11.6286 8.7471 11.658 8.7912 11.6781 8.83973C11.6982 8.88826 11.7086 8.94027 11.7086 8.9928C11.7086 9.04533 11.6982 9.09734 11.6781 9.14587C11.658 9.1944 11.6286 9.2385 11.5914 9.27564C11.5543 9.31279 11.5102 9.34225 11.4617 9.36235C11.4131 9.38245 11.3611 9.3928 11.3086 9.3928H9.63499V11.0672C9.63499 11.1733 9.59284 11.275 9.51783 11.35C9.44282 11.4251 9.34107 11.4672 9.23499 11.4672C9.1289 11.4672 9.02716 11.4251 8.95214 11.35C8.87713 11.275 8.83499 11.1733 8.83499 11.0672V9.392H7.15979C7.0537 9.392 6.95196 9.34986 6.87695 9.27484C6.80193 9.19983 6.75979 9.09809 6.75979 8.992C6.75979 8.88591 6.80193 8.78417 6.87695 8.70916C6.95196 8.63414 7.0537 8.592 7.15979 8.592H8.83419V6.9184C8.83419 6.81231 8.87633 6.71057 8.95134 6.63556C9.02636 6.56054 9.1281 6.5184 9.23419 6.5184H9.23499ZM8.26139 0C9.14299 0 9.86539 0.684 9.92699 1.5504L9.93099 1.6704V2.0168C10.2641 2.18754 10.5476 2.44125 10.7542 2.75345C10.9607 3.06566 11.0833 3.42582 11.1102 3.7992L11.1158 3.956V5.548C11.116 5.64796 11.0787 5.74436 11.0114 5.81823C10.944 5.89209 10.8515 5.93807 10.7519 5.9471C10.6524 5.95613 10.5531 5.92756 10.4735 5.86702C10.394 5.80648 10.34 5.71836 10.3222 5.62L10.3158 5.548V3.956C10.3158 3.2352 9.76219 2.644 9.05739 2.5832L8.93819 2.5784H4.19739C3.47739 2.5784 2.88539 3.132 2.82459 3.8368L2.81979 3.956V8.6968C2.81979 9.4168 3.37339 10.0088 4.07899 10.0696L4.19739 10.0744H6.30939C6.40927 10.0744 6.50554 10.1118 6.57925 10.1792C6.65297 10.2466 6.69879 10.3392 6.70772 10.4387C6.71665 10.5381 6.68803 10.6374 6.62749 10.7168C6.56695 10.7963 6.47888 10.8502 6.38059 10.868L6.30859 10.8744H4.19739C3.82145 10.8747 3.45185 10.7775 3.12462 10.5925C2.79739 10.4074 2.52369 10.1407 2.33019 9.8184L2.25819 9.6888H1.91179C1.48957 9.68887 1.08301 9.52896 0.773961 9.24129C0.464913 8.95362 0.276332 8.55954 0.246188 8.1384L0.242188 8.0184V2.1784C0.241767 1.62357 0.453147 1.0895 0.833169 0.685243C1.21319 0.280988 1.73319 0.037036 2.28699 0.0032L2.41979 0H8.26139ZM8.26139 0.8H2.41979C1.65899 0.8 1.04219 1.4168 1.04219 2.1776V8.0192C1.04219 8.4992 1.43179 8.8888 1.91179 8.8888H2.02859C2.02299 8.8248 2.02059 8.7608 2.02059 8.6968V3.956C2.02059 3.3786 2.2499 2.82484 2.65811 2.41649C3.06632 2.00813 3.61999 1.77861 4.19739 1.7784H8.93819C9.00299 1.7784 9.06779 1.7808 9.13099 1.7864V1.6696C9.13099 1.1896 8.74139 0.8 8.26139 0.8Z"
                fill="#5767E5"
              />
            </g>
            <defs>
              <clipPath id="compactAddMaterialClip">
                <rect width="12" height="12" fill="white" />
              </clipPath>
            </defs>
          </svg>
          新增素材
        </button>

        <div className="compact-control-strip">
          <div className="compact-control">
            <span>
              <svg viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <g clipPath="url(#compactDurationClip)">
                  <path
                    d="M6 11C8.76142 11 11 8.76142 11 6C11 3.23858 8.76142 1 6 1C3.23858 1 1 3.23858 1 6C1 8.76142 3.23858 11 6 11Z"
                    stroke="#666666"
                    strokeWidth="1.16667"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M6 3V6L8 7"
                    stroke="#666666"
                    strokeWidth="1.16667"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </g>
                <defs>
                  <clipPath id="compactDurationClip">
                    <rect width="12" height="12" fill="white" />
                  </clipPath>
                </defs>
              </svg>
              时长
            </span>
            <button type="button" onClick={() => props.onToggleMenu?.('duration')}>
              {selectedDuration}
              <svg viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path
                  d="M9.06741 3.87751L5.99991 7.24501L2.93241 3.87751C2.89742 3.83869 2.85492 3.80738 2.80747 3.78547C2.76003 3.76356 2.70864 3.7515 2.6564 3.75003C2.60417 3.74856 2.55218 3.7577 2.50358 3.77691C2.45498 3.79611 2.41078 3.82498 2.37366 3.86176C2.29733 3.93766 2.25305 4.03998 2.24998 4.14759C2.24691 4.25519 2.28528 4.35987 2.35716 4.44001L5.71266 8.12176C5.749 8.16184 5.79334 8.19388 5.84281 8.2158C5.89228 8.23772 5.9458 8.24905 5.99991 8.24905C6.05402 8.24905 6.10753 8.23772 6.157 8.2158C6.20647 8.19388 6.25081 8.16184 6.28716 8.12176L9.64266 4.44001C9.71454 4.35987 9.7529 4.25519 9.74983 4.14759C9.74676 4.03998 9.70249 3.93766 9.62616 3.86176C9.58899 3.82502 9.54475 3.79621 9.49612 3.77707C9.44749 3.75793 9.39549 3.74886 9.34325 3.7504C9.29101 3.75194 9.23963 3.76407 9.19222 3.78605C9.1448 3.80802 9.10234 3.83939 9.06741 3.87826V3.87751Z"
                  fill="#666666"
                />
              </svg>
            </button>
            {activeMenu === 'duration' ? (
              <div className="control-menu compact-menu duration-menu">
                <span
                  className="duration-fade left"
                  aria-hidden="true"
                  style={{ display: showDurationFadeLeft ? undefined : 'none' }}
                ></span>
                <span
                  className="duration-fade right"
                  aria-hidden="true"
                  style={{ display: showDurationFadeRight ? undefined : 'none' }}
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
                      onClick={() => props.onSelectOption?.('duration', option)}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="compact-control">
            <span>
              <svg viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path
                  d="M11.0452 0.6315C11.538 0.6315 11.946 0.969 11.9948 1.40175L12 1.4895V10.518C12 10.9628 11.6228 11.328 11.1427 11.3715L11.0452 11.376H0.95475C0.462 11.376 0.054 11.0385 0.00525 10.6058L0 10.518V1.4895C0 1.04475 0.37725 0.6795 0.85725 0.636L0.95475 0.6315H11.0452ZM11.0452 1.452H0.95475L0.91725 10.518L11.0452 10.5555L11.0828 1.4895L11.0452 1.452Z"
                  fill="#666666"
                />
                <path
                  d="M8.42978 3.8175L10.3678 5.7555C10.4878 5.8755 10.5028 6.06075 10.4128 6.19725L10.3678 6.25201L8.37653 8.19L7.77803 7.539L9.33953 6.03L7.77803 4.416L8.42978 3.8175H8.42903H8.42978ZM3.62303 3.8175L4.22153 4.4685L2.66003 5.9775L4.22153 7.5915L3.57053 8.19L1.63253 6.25201C1.57544 6.19489 1.5398 6.11984 1.5316 6.03951C1.5234 5.95917 1.54315 5.87847 1.58753 5.811L1.63253 5.7555L3.56978 3.8175H3.62228H3.62303Z"
                  fill="#666666"
                />
              </svg>
              比例
            </span>
            <button type="button" onClick={() => props.onToggleMenu?.('ratio')}>
              {selectedRatio}
              <svg viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path
                  d="M9.06741 3.87751L5.99991 7.24501L2.93241 3.87751C2.89742 3.83869 2.85492 3.80738 2.80747 3.78547C2.76003 3.76356 2.70864 3.7515 2.6564 3.75003C2.60417 3.74856 2.55218 3.7577 2.50358 3.77691C2.45498 3.79611 2.41078 3.82498 2.37366 3.86176C2.29733 3.93766 2.25305 4.03998 2.24998 4.14759C2.24691 4.25519 2.28528 4.35987 2.35716 4.44001L5.71266 8.12176C5.749 8.16184 5.79334 8.19388 5.84281 8.2158C5.89228 8.23772 5.9458 8.24905 5.99991 8.24905C6.05402 8.24905 6.10753 8.23772 6.157 8.2158C6.20647 8.19388 6.25081 8.16184 6.28716 8.12176L9.64266 4.44001C9.71454 4.35987 9.7529 4.25519 9.74983 4.14759C9.74676 4.03998 9.70249 3.93766 9.62616 3.86176C9.58899 3.82502 9.54475 3.79621 9.49612 3.77707C9.44749 3.75793 9.39549 3.74886 9.34325 3.7504C9.29101 3.75194 9.23963 3.76407 9.19222 3.78605C9.1448 3.80802 9.10234 3.83939 9.06741 3.87826V3.87751Z"
                  fill="#666666"
                />
              </svg>
            </button>
            {activeMenu === 'ratio' ? (
              <div className="control-menu compact-menu ratio-menu">
                <div className="ratio-menu-title">选择比例</div>
                <div className="ratio-menu-options">
                  {ratios.map((option) => (
                    <button
                      key={option}
                      type="button"
                      className={`ratio-menu-option${option === selectedRatio ? ' checked' : ''}`}
                      onClick={() => props.onSelectOption?.('ratio', option)}
                    >
                      <span className="ratio-menu-icon" style={getRatioIconStyle(option)}></span>
                      <span className="ratio-menu-label">{option}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="compact-control compact-style-control">
            <span>
              <svg viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <g clipPath="url(#compactStyleClip)">
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
                  <clipPath id="compactStyleClip">
                    <rect width="12" height="12" fill="white" />
                  </clipPath>
                </defs>
              </svg>
              风格
            </span>
            <button type="button" onClick={() => props.onToggleMenu?.('style')}>
              {selectedStyleText}
              <svg viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path
                  d="M9.06741 3.87751L5.99991 7.24501L2.93241 3.87751C2.89742 3.83869 2.85492 3.80738 2.80747 3.78547C2.76003 3.76356 2.70864 3.7515 2.6564 3.75003C2.60417 3.74856 2.55218 3.7577 2.50358 3.77691C2.45498 3.79611 2.41078 3.82498 2.37366 3.86176C2.29733 3.93766 2.25305 4.03998 2.24998 4.14759C2.24691 4.25519 2.28528 4.35987 2.35716 4.44001L5.71266 8.12176C5.749 8.16184 5.79334 8.19388 5.84281 8.2158C5.89228 8.23772 5.9458 8.24905 5.99991 8.24905C6.05402 8.24905 6.10753 8.23772 6.157 8.2158C6.20647 8.19388 6.25081 8.16184 6.28716 8.12176L9.64266 4.44001C9.71454 4.35987 9.7529 4.25519 9.74983 4.14759C9.74676 4.03998 9.70249 3.93766 9.62616 3.86176C9.58899 3.82502 9.54475 3.79621 9.49612 3.77707C9.44749 3.75793 9.39549 3.74886 9.34325 3.7504C9.29101 3.75194 9.23963 3.76407 9.19222 3.78605C9.1448 3.80802 9.10234 3.83939 9.06741 3.87826V3.87751Z"
                  fill="#666666"
                />
              </svg>
            </button>
            {activeMenu === 'style' ? (
              <div className="control-menu style-menu compact-menu">
                {styleOptions.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={selectedStyles.includes(option) ? 'checked' : undefined}
                    onClick={() => props.onToggleStyle?.(option)}
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
                    onChange={(e) => props.onCustomStyleChange?.(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        props.onAddCustomStyle?.()
                      }
                    }}
                  />
                  <button type="button" className="custom-style-button" onClick={() => props.onAddCustomStyle?.()}>
                    添加
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <button
          type="button"
          className="compact-send-button"
          aria-label="重新发送生成创意脚本"
          disabled={isPending}
          onClick={() => props.onGenerate?.()}
        >
          <svg viewBox="0 0 32 32" aria-hidden="true">
            <path
              d="M27.3125 4.68741C21.0642 -1.56247 10.934 -1.56247 4.68721 4.68741C-1.55954 10.9373 -1.56266 21.0656 4.68721 27.3139C10.9371 33.5622 21.0654 33.5618 27.3137 27.3139C33.562 21.066 33.5605 10.9342 27.3125 4.68741ZM24.5345 14.8333L18.2959 19.5738C18.2467 19.6115 18.188 19.6348 18.1263 19.641C18.0647 19.6471 18.0025 19.636 17.9468 19.6087C17.8911 19.5815 17.8441 19.5393 17.8111 19.4868C17.7781 19.4343 17.7604 19.3737 17.76 19.3117V17.1985C17.7596 17.114 17.7271 17.0329 17.6691 16.9716C17.611 16.9103 17.5318 16.8734 17.4475 16.8684C14.6179 16.6903 12.1378 16.9879 10.4586 18.7528C9.59922 19.6562 8.56291 21.448 8.31487 21.9738C8.27972 22.048 8.21488 22.1855 8.05863 22.2374L8.04496 22.2417C7.9913 22.2586 7.93426 22.2617 7.87909 22.2507C7.82393 22.2397 7.77243 22.215 7.72934 22.1789C7.58169 22.055 7.49223 21.98 8.08558 19.5574C9.09142 15.4559 13.0171 12.7751 17.4635 12.2822C17.5448 12.2737 17.62 12.2355 17.6748 12.175C17.7296 12.1144 17.7601 12.0357 17.7604 11.9541V9.83066C17.7612 9.76888 17.7791 9.70853 17.8122 9.65636C17.8453 9.60418 17.8922 9.56224 17.9478 9.53521C18.0034 9.50818 18.0653 9.49713 18.1268 9.50329C18.1883 9.50946 18.2468 9.5326 18.2959 9.57012L24.5345 14.3091C24.5751 14.3397 24.608 14.3793 24.6307 14.4247C24.6534 14.4702 24.6652 14.5204 24.6652 14.5712C24.6652 14.622 24.6534 14.6722 24.6307 14.7176C24.608 14.7631 24.5751 14.8027 24.5345 14.8333Z"
              fill="#909090"
            />
          </svg>
        </button>
      </section>

      <div className="generated-script-main">
        <div className="generation-status">
          <span className={`generation-title${isPending ? ' is-pending' : ''}`}>
            <svg viewBox="0 0 14 14" aria-hidden="true">
              <g clipPath="url(#generationStatusClip)">
                <path
                  d="M7.93348 13.9533H6.06682C5.03735 13.9533 4.20015 13.1161 4.20015 12.0867V11.2747C4.20015 10.6255 3.81515 9.63667 3.37648 9.15833C3.33448 9.11167 2.33348 8.00193 2.33348 6.38307C2.33348 3.80987 4.42695 1.7164 7.00015 1.7164C9.57335 1.7164 11.6668 3.80987 11.6668 6.38307C11.6668 8.0024 10.6658 9.11213 10.6238 9.15833C10.1847 9.6362 9.80015 10.6255 9.80015 11.2747V12.0867C9.80015 13.1161 8.96295 13.9533 7.93348 13.9533ZM7.00015 2.64973C4.94168 2.64973 3.26682 4.3246 3.26682 6.38307C3.26682 7.64307 4.05642 8.519 4.06482 8.52787C4.66402 9.1812 5.13348 10.388 5.13348 11.2751V12.0871C5.13348 12.6019 5.55208 13.0205 6.06682 13.0205H7.93348C8.44822 13.0205 8.86682 12.6019 8.86682 12.0871V11.2751C8.86682 10.388 9.33628 9.18167 9.93548 8.52787C9.94248 8.51993 10.7335 7.62953 10.7335 6.38307C10.7335 4.3246 9.05862 2.64973 7.00015 2.64973ZM8.86682 7.93333C8.67128 7.93333 8.48928 7.80967 8.42442 7.61413L8.19622 6.93047L7.33055 7.7966C7.14808 7.97907 6.85315 7.97907 6.67068 7.7966L5.80455 6.93047L5.57682 7.61413C5.49515 7.8582 5.23148 7.99167 4.98648 7.90907C4.74195 7.82787 4.60988 7.56373 4.69155 7.31873L5.15822 5.91873C5.18344 5.8433 5.22749 5.77556 5.28621 5.7219C5.34492 5.66825 5.41636 5.63047 5.49375 5.61213C5.65055 5.5748 5.81668 5.62193 5.93102 5.73627L7.00015 6.8068L8.07022 5.73673C8.18408 5.6224 8.34975 5.57573 8.50748 5.6126C8.58491 5.63086 8.65638 5.66862 8.71511 5.72228C8.77383 5.77595 8.81786 5.84373 8.84302 5.9192L9.30968 7.3192C9.39135 7.56373 9.25928 7.82833 9.01475 7.90953C8.96528 7.9254 8.91535 7.93333 8.86682 7.93333ZM12.1288 3.27133C12.0014 3.27133 11.8745 3.21953 11.7825 3.11733C11.6099 2.926 11.6248 2.63107 11.8161 2.45793L12.2903 2.03047C12.4812 1.8578 12.7761 1.87273 12.9492 2.06453C13.1219 2.25587 13.1069 2.5508 12.9156 2.72393L12.4415 3.15093C12.3524 3.23167 12.2403 3.27133 12.1288 3.27133ZM1.87195 3.27133C1.75661 3.27147 1.64533 3.22873 1.55975 3.1514L1.08562 2.72347C0.894284 2.5508 0.879351 2.25587 1.05155 2.06407C1.22375 1.87227 1.51868 1.85733 1.71095 2.03L2.18508 2.45747C2.37642 2.63013 2.39135 2.92507 2.21915 3.11687C2.17535 3.16553 2.1218 3.20443 2.06199 3.23104C2.00217 3.25766 1.93742 3.27138 1.87195 3.27133ZM7.00015 1.4C6.74255 1.4 6.53348 1.19093 6.53348 0.933333V0.466667C6.53348 0.209067 6.74255 0 7.00015 0C7.25775 0 7.46682 0.209067 7.46682 0.466667V0.933333C7.46682 1.19093 7.25775 1.4 7.00015 1.4ZM7.93348 12.1333H6.06682C5.80922 12.1333 5.60015 11.9247 5.60015 11.6667C5.60015 11.4086 5.80922 11.2 6.06682 11.2H7.93348C8.19155 11.2 8.40015 11.4086 8.40015 11.6667C8.40015 11.9247 8.19155 12.1333 7.93348 12.1333Z"
                  fill="#666666"
                />
              </g>
              <defs>
                <clipPath id="generationStatusClip">
                  <rect width="14" height="14" fill="white" />
                </clipPath>
              </defs>
            </svg>
            {isStreaming ? 'AI创意生成中…' : 'AI创意生成中'}
          </span>
          <span className="generation-tip">可直接编辑修改或在对话框中输入修改意见</span>
        </div>

        <div className="generated-script-wrap">
          <div className="generated-script-render" aria-label="创意脚本内容" spellCheck={false}>
            <div
              className={`script-markdown-area${canEditScript ? ' clickable' : ''}`}
              onClick={openScriptEditor}
            >
              {editingScript ? (
                <textarea
                  ref={scriptEditorRef}
                  value={scriptDraftMarkdown}
                  className="generated-script-editor"
                  aria-label="编辑创意脚本文案"
                  onClick={(e) => e.stopPropagation()}
                  onFocus={() => {
                    editingStoryboardsRef.current = false
                  }}
                  onChange={(e) => setScriptDraftMarkdown(e.target.value)}
                  onBlur={closeScriptEditor}
                ></textarea>
              ) : markdownText ? (
                <Streamdown>{markdownText}</Streamdown>
              ) : (
                <p className="generated-script-empty">
                  {isStreaming
                    ? '正在生成中…'
                    : canEditScript
                      ? '点击此处编辑创意脚本文案'
                      : '点击右上角生成按钮开始创作。'}
                </p>
              )}
            </div>

            {storyboardPreview.visible ? (
              <section
                className="storyboard-preview"
                ref={storyboardPreviewRef}
                contentEditable={false}
                aria-label="分镜数据预览"
                onFocus={() => {
                  editingStoryboardsRef.current = true
                }}
                onBlur={() => {
                  editingStoryboardsRef.current = false
                }}
              >
                <header className="storyboard-preview-header">
                  <span className="storyboard-preview-title">分镜数据</span>
                  {storyboardPreview.items.length ? (
                    <span className="storyboard-preview-count">已解析 {storyboardPreview.items.length} 段</span>
                  ) : (
                    <span className="storyboard-preview-count">解析中…</span>
                  )}
                </header>

                {storyboardPreview.items.length ? (
                  <ol className="storyboard-preview-list">
                    {editableStoryboards.map((item, idx) => (
                      <li key={idx} className="storyboard-preview-card">
                        <div className="storyboard-preview-card-head">
                          <span className="storyboard-preview-card-index">分镜 {idx + 1}</span>
                          {canEditScript ? (
                            <input
                              className="storyboard-inline-input storyboard-title-input"
                              value={item.title ?? ''}
                              type="text"
                              aria-label="编辑分镜标题"
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => updateStoryboardField(idx, 'title', e.target.value)}
                              onBlur={commitStoryboards}
                            />
                          ) : (
                            <span className="storyboard-preview-card-title">{item.title}</span>
                          )}
                          <span className="storyboard-preview-card-duration">{item.duration}s</span>
                        </div>
                        {canEditScript ? (
                          <textarea
                            className="storyboard-inline-textarea storyboard-prompt-input"
                            value={item.prompt ?? ''}
                            rows={2}
                            aria-label="编辑分镜画面描述"
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => handleStoryboardTextareaInput(idx, 'prompt', e)}
                            onBlur={commitStoryboards}
                          ></textarea>
                        ) : item.prompt ? (
                          <p className="storyboard-preview-card-prompt">{item.prompt}</p>
                        ) : null}
                        <dl className="storyboard-preview-card-meta">
                          {item.voiceover ? (
                            <div>
                              <dt>旁白</dt>
                              {!canEditScript ? (
                                <dd>{item.voiceover}</dd>
                              ) : (
                                <dd>
                                  <textarea
                                    className="storyboard-inline-textarea"
                                    value={item.voiceover}
                                    rows={2}
                                    aria-label="编辑分镜旁白"
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={(e) => handleStoryboardTextareaInput(idx, 'voiceover', e)}
                                    onBlur={commitStoryboards}
                                  ></textarea>
                                </dd>
                              )}
                            </div>
                          ) : null}
                          {item.subtitle ? (
                            <div>
                              <dt>字幕</dt>
                              {!canEditScript ? (
                                <dd>{item.subtitle}</dd>
                              ) : (
                                <dd>
                                  <textarea
                                    className="storyboard-inline-textarea"
                                    value={item.subtitle}
                                    rows={2}
                                    aria-label="编辑分镜字幕"
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={(e) => handleStoryboardTextareaInput(idx, 'subtitle', e)}
                                    onBlur={commitStoryboards}
                                  ></textarea>
                                </dd>
                              )}
                            </div>
                          ) : null}
                          {item.sfx ? (
                            <div>
                              <dt>音效</dt>
                              {!canEditScript ? (
                                <dd>{item.sfx}</dd>
                              ) : (
                                <dd>
                                  <textarea
                                    className="storyboard-inline-textarea"
                                    value={item.sfx}
                                    rows={2}
                                    aria-label="编辑分镜音效"
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={(e) => handleStoryboardTextareaInput(idx, 'sfx', e)}
                                    onBlur={commitStoryboards}
                                  ></textarea>
                                </dd>
                              )}
                            </div>
                          ) : null}
                        </dl>
                      </li>
                    ))}
                  </ol>
                ) : storyboardPreview.rawJson ? (
                  <pre className="storyboard-preview-raw">{storyboardPreview.rawJson}</pre>
                ) : null}
              </section>
            ) : null}
          </div>
        </div>
      </div>

      <div className="generated-script-footer">
        <button type="button" className="script-action copy-action" onClick={() => props.onCopy?.()}>
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <g clipPath="url(#copyScriptClip)">
              <path
                d="M13.3335 5.33334H6.66683C5.93045 5.33334 5.3335 5.9303 5.3335 6.66668V13.3333C5.3335 14.0697 5.93045 14.6667 6.66683 14.6667H13.3335C14.0699 14.6667 14.6668 14.0697 14.6668 13.3333V6.66668C14.6668 5.9303 14.0699 5.33334 13.3335 5.33334Z"
                stroke="#666666"
                strokeWidth="1.16667"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M2.66683 10.6667C1.9335 10.6667 1.3335 10.0667 1.3335 9.33334V2.66668C1.3335 1.93334 1.9335 1.33334 2.66683 1.33334H9.3335C10.0668 1.33334 10.6668 1.93334 10.6668 2.66668"
                stroke="#666666"
                strokeWidth="1.16667"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
            <defs>
              <clipPath id="copyScriptClip">
                <rect width="16" height="16" fill="white" />
              </clipPath>
            </defs>
          </svg>
          复制脚本
        </button>
        <button
          type="button"
          className="script-action regenerate-action"
          disabled={isPending}
          onClick={() => props.onRegenerate?.()}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M7.48102 2.5625C10.4341 2.5625 12.8355 4.92495 12.8982 7.86302L13.118 7.64331L13.1272 7.63431C13.3231 7.44811 13.6329 7.45109 13.8251 7.64331C14.0173 7.83552 14.0203 8.14528 13.8341 8.34117L13.8251 8.35042L13.2046 8.97094C12.7652 9.41027 12.0529 9.41027 11.6136 8.97094L10.993 8.35042C10.7978 8.15516 10.7978 7.83858 10.993 7.64331C11.1883 7.44805 11.5049 7.44805 11.7002 7.64331L11.8973 7.84048C11.8231 5.46523 9.87428 3.5625 7.48102 3.5625C5.04073 3.5625 3.0625 5.54073 3.0625 7.98102C3.0625 10.4213 5.04073 12.3995 7.48102 12.3995C8.69578 12.3995 9.79525 11.91 10.5945 11.1162C10.7904 10.9216 11.107 10.9227 11.3016 11.1187C11.4962 11.3146 11.4951 11.6312 11.2992 11.8258C10.3202 12.798 8.97038 13.3995 7.48102 13.3995C4.48845 13.3995 2.0625 10.9736 2.0625 7.98102C2.0625 4.98845 4.48845 2.5625 7.48102 2.5625Z"
              fill="#666666"
            />
          </svg>
          重新生成
        </button>
        <button
          type="button"
          className="storyboard-button"
          disabled={isPending || isStreaming || !canGenerateStoryboard}
          onClick={() => props.onGenerateStoryboard?.()}
        >
          生成分镜图片
        </button>
      </div>
    </section>
  )
}
