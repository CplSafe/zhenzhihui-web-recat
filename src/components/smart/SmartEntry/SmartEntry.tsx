/**
 * 智能成片「入口/需求输入」页(2.1,按 Figma 79:3966 还原)。
 * 大标题 + 制作视频/制作图片 Tab + 上传&提示词卡片 +
 * 比例(16:9)/时长(5s) 下拉 + @ + 发送。背景彩色渐变光晕。
 * 提交 → 调 onSubmit(需求文本, 选项),由父级进入分镜脚本流程。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import EntryCanvasBg from '../EntryCanvasBg'
import EntryDropdown from '../EntryDropdown'
import {
  filterGenerationModelGroupsByOperations,
  GenerationModelDropdown,
  getGenerationModelSelectionConflicts,
  isGenerationModelSelectionComplete,
  type GenerationModelErrorState,
  type GenerationModelGroup,
  type GenerationModelLoadingState,
} from '../GenerationModelPicker'
import RatioIcon from '@/components/common/RatioIcon'
import { fileToDataUrl } from '@/utils/imageFile'
import {
  clearSmartEntryDraft,
  loadSmartEntryDraft,
  saveSmartEntryDraft,
  type SmartEntryDraftStore,
} from '@/utils/smartEntryDraft'
import { ALL_SMART_SCRIPT_NAMES, SMART_SCRIPT_OPTIONS, normalizeSmartScriptName } from '@/utils/smartScriptOptions'
import { ENTRY_RATIO_OPTIONS as RATIO_OPTIONS } from '@/utils/videoOptions'
import { SMART_VIDEO_DURATIONS } from '@/utils/videoDurationValue'
import {
  REQUIRED_GENERATION_OPERATION_CODES_BY_MODE,
  areGenerationModelOperationsReady,
  getImageGenerationOperationCode,
  type GenerationModelOperationStateMap,
  type GenerationModelSelectionMap,
  type GenerationOperationCode,
} from '@/utils/generationModelCatalog'
import { parseDurationSeconds } from '@/utils/videoDurationValue'
import { useToast } from '@/composables/useToast'
import styles from './SmartEntry.module.less'

/** 入口提交给智能成片编排器的制作模式、画幅、时长和参考素材元数据。 */
export interface EntryMeta {
  mode: 'video' | 'image'
  style: string
  ratio: string
  duration: string
  imageCount: number
  images: string[]
  imageAssetIds?: number[]
  /** 图片模式单轮生成数量，限制为 1–9；视频模式忽略。 */
  outputCount?: number
  /** 选中的营销 SKILL(空=不使用,走现有逻辑;非空=多一步「营销思路拆解」) */
  skill?: string
  /** 按后端 operation_code 保存的模型版本选择；草稿恢复和后续任务都使用同一份配置。 */
  generationModels?: GenerationModelSelectionMap
}

/** 智能成片入口的提交、恢复、新建及初始草稿参数。 */
interface SmartEntryProps {
  onSubmit: (requirement: string, meta: EntryMeta) => void | boolean | Promise<void | boolean>
  /**
   * 是否允许恢复当前标签页尚未提交的入口草稿。
   * 显式“新建视频”会在首次渲染就设为 false，早于布局副作用清理 sessionStorage，避免旧输入闪回。
   */
  restoreSessionDraft?: boolean
  /** 「制作新视频」/「创建新对话」:清空输入/项目,初始化为全新空白页(保留当前 Tab 模式)。 */
  onNewVideo?: (mode: 'video' | 'image') => void
  /**
   * 是否可「下一步/恢复」:从流程里点上一步退回入口、且已有生成结果时为 true(仅制作视频)。
   * 为 true 时(且当前在视频 Tab):发送按钮变「下一步」(onResume,回到已生成流程,不重生成);
   * 并显示「重新生成」(走 onSubmit,按当前输入重新生成)。
   */
  canResume?: boolean
  /**
   * 「下一步」:回到已生成的流程(只往前一步),不重新生成。
   * 旧草稿可能没有模型配置，因此把用户在首页补选的配置一并交回父级持久化。
   */
  onResume?: (generationModels: GenerationModelSelectionMap) => void | Promise<void>
  /** 后端动态返回的生成模型分组；模型名称不会在入口组件中写死。 */
  modelGroups?: GenerationModelGroup[]
  modelLoading?: GenerationModelLoadingState
  modelError?: GenerationModelErrorState
  /** 每个固定 operation 的加载/可用状态；用于防止部分接口失败时只校验剩余分组。 */
  modelOperationStates?: GenerationModelOperationStateMap
  onReloadModels?: () => void
  /** 已登录且工作空间就绪后开启当前步骤模型门禁；游客仍可先点击并进入登录流程。 */
  requireModelSelection?: boolean
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
    imageAssetIds?: number[]
    outputCount?: number
    skill?: string
    generationModels?: GenerationModelSelectionMap
  }
}

/** 智能成片支持从 1 秒到 15 秒逐秒选择。 */
const DURATION_OPTIONS = SMART_VIDEO_DURATIONS.map((seconds) => `${seconds}s`)

/** 可选的智能成片脚本。 */
const SCRIPT_OPTIONS = [...SMART_SCRIPT_OPTIONS]

/** 入口最多接收的参考图数量。 */
const MAX_IMAGES = 9
const IMAGE_OUTPUT_COUNT_OPTIONS = Array.from({ length: MAX_IMAGES }, (_, index) => `${index + 1}张`)
const clampImageOutputCount = (value: unknown) => Math.min(MAX_IMAGES, Math.max(1, Math.floor(Number(value) || 1)))
/** 文件扩展名图片识别兜底规则。 */
const IMAGE_FILE_RE = /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i

/** 同时依据 MIME 与扩展名判断是否为可接收图片。 */
const isImageFile = (file: File) => file.type.startsWith('image/') || IMAGE_FILE_RE.test(file.name)

/** 视频模式的输入示例文案。 */
const PLACEHOLDER_VIDEO =
  '最多上传或粘贴9张图片，输入文字或@参考素材，生成精彩广告视频。例如：把 @图片1 中的产品放到 @图片2 中的场景里'
/** 图片模式的输入示例文案。 */
const PLACEHOLDER_IMAGE =
  '最多上传或粘贴9张图片，输入文字或@参考素材，生成精彩广告图片。例如：把 @图片1 中的产品放到 @图片2 中的场景里'

// 选中智能脚本后插入到输入框的提示语(高亮显示)。提交/展示前会被剥离,保持需求正文干净。
const skillLine = (s: string) => `使用${normalizeSmartScriptName(s)}帮我优化`
/** 保存/提交前移除仅用于界面高亮的技能提示语，保持原始需求干净。 */
const stripSkillLine = (t: string) =>
  ALL_SMART_SCRIPT_NAMES.reduce((acc, name) => acc.split(`使用${name}帮我优化`).join(''), t)
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t\n]+$/, '')
// 把智能脚本提示语拼到正文后面(正文非空时空一行)
const composeWithSkill = (base: string, s: string) => (s ? (base ? `${base}\n\n${skillLine(s)}` : skillLine(s)) : base)

// 高亮渲染匹配:@图片N(绿) + 使用××智能脚本帮我优化(智能脚本提示语,着色)
const HL_RE = new RegExp(`@图片\\d+|${ALL_SMART_SCRIPT_NAMES.map((name) => `使用${name}帮我优化`).join('|')}`, 'g')

// ── 入口未提交输入的「跨路由保活」 ──
// 切到别的页面会卸载本组件、丢失全部内部 state(文字/图片/比例/时长/skill/模式)。
// initial 只在「同一次挂载内点上一步返回」时回填,跨路由重新挂载时父级 state 已清空、initial 为空 → 输入消失。
// 故把当前输入实时写进 sessionStorage,重新进入空白 /smart 时优先回填;提交成功 / 点「新建」即清空。
// 用 sessionStorage:仅本标签页有效、关页即清,符合「别丢我刚输入的」语义,也避免长期残留旧草稿。
export { clearSmartEntryDraft }
/** 转出智能成片入口草稿的存储结构类型。 */
export type { SmartEntryDraftStore }

/** 管理需求输入、参考图、比例时长、@ 引用和会话级草稿恢复。 */
export default function SmartEntry({
  onSubmit,
  onNewVideo,
  canResume,
  onResume,
  modelGroups = [],
  modelLoading = false,
  modelError = '',
  modelOperationStates,
  onReloadModels,
  requireModelSelection = false,
  initial,
  restoreSessionDraft = true,
}: SmartEntryProps) {
  const { showToast } = useToast()
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const draftPersistenceEnabledRef = useRef(true)
  // 回填优先级:initial(同一次挂载内「上一步」回填,值非空时为准)> sessionStorage 暂存(跨路由保活)> 默认。
  // 注意 initial.text 跨路由时是父级空串(非 undefined),故用「非空才采纳」而非 ?? 来回退到暂存。
  const [stored] = useState(() => (restoreSessionDraft ? loadSmartEntryDraft() : null))
  const seedText = (initial?.text && initial.text.length ? initial.text : stored?.text) ?? ''
  const seedSkill = normalizeSmartScriptName(initial?.skill ?? stored?.skill ?? '')
  const seedImages = (initial?.images && initial.images.length ? initial.images : stored?.images) ?? []
  const seedImageAssetIds =
    (initial?.images && initial.images.length ? initial.imageAssetIds : stored?.imageAssetIds) ?? []
  const [mode, setMode] = useState<'video' | 'image'>(initial?.mode ?? stored?.mode ?? 'video')
  // 切换 Tab:背景弥散位移 + 涟漪动画由 <EntryCanvasBg mode> 监听 mode 变化驱动(Canvas 实现,不卡)
  const switchMode = (m: 'video' | 'image') => {
    if (m === mode) return
    setMode(m)
  }
  // 回填:正文 + (若已选 skill)插入提示语,使其在输入框内带色展示
  const [text, setText] = useState(() => composeWithSkill(seedText, seedSkill))
  const [ratio, setRatio] = useState(initial?.ratio ?? stored?.ratio ?? '16:9')
  const [duration, setDuration] = useState(initial?.duration ?? stored?.duration ?? '10s')
  const [images, setImages] = useState<string[]>(seedImages)
  const [imageAssetIds, setImageAssetIds] = useState<number[]>(() =>
    seedImages.map((_, index) => Math.max(0, Math.floor(Number(seedImageAssetIds[index]) || 0))),
  )
  const [outputCount, setOutputCount] = useState(() =>
    clampImageOutputCount(initial?.outputCount ?? stored?.outputCount ?? 1),
  )
  // 选中的营销 SKILL(单选,空=不使用)
  const [skill, setSkill] = useState(seedSkill)
  const [generationModels, setGenerationModels] = useState<GenerationModelSelectionMap>(
    () => initial?.generationModels ?? stored?.generationModels ?? {},
  )
  const [modelAttentionRequest, setModelAttentionRequest] = useState(0)
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const dragDepthRef = useRef(0)

  // ── @ 引用素材:点击 @ 在光标处弹出已上传素材;选中插入「@图片N」;无素材则直接插入「@」──
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const hlRef = useRef<HTMLDivElement | null>(null)
  const caretRef = useRef(0) // 最近一次光标位置(点 @ 按钮会失焦,需提前记下)
  const [atOpen, setAtOpen] = useState(false)

  // 实时把当前输入写进 sessionStorage(防抖 300ms),切走再回来可回填。text 存「剥离 skill 提示语」的干净正文。
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (!draftPersistenceEnabledRef.current) return
      saveSmartEntryDraft({
        mode,
        text: stripSkillLine(text).trim(),
        ratio,
        duration,
        skill,
        images,
        imageAssetIds,
        outputCount,
        generationModels,
      })
    }, 300)
    return () => window.clearTimeout(t)
  }, [mode, text, ratio, duration, skill, images, imageAssetIds, outputCount, generationModels])
  // 本地图片先转成受控 data URL；过滤非图片并限制数量，避免无效文件进入后续资产上传流程。
  const pickImages = async (files: FileList | File[] | null) => {
    if (!files?.length) return
    const room = MAX_IMAGES - images.length
    if (room <= 0) {
      showToast(`最多上传 ${MAX_IMAGES} 张图片`, 'info')
      return
    }
    const sel = Array.from(files).filter(isImageFile).slice(0, room)
    if (!sel.length) {
      showToast('智能成片仅支持添加图片素材', 'info')
      return
    }
    const picked = (await Promise.all(sel.map((f) => fileToDataUrl(f).catch(() => null)))).filter(Boolean) as string[]
    if (picked.length < sel.length) {
      showToast(picked.length ? '部分图片读取失败，请重试' : '图片读取失败，请重试', 'error')
    }
    if (picked.length) {
      const accepted = picked.slice(0, MAX_IMAGES - images.length)
      setImages((prev) => [...prev, ...accepted])
      setImageAssetIds((prev) => [...prev, ...accepted.map(() => 0)])
    }
  }
  const removeImage = (index: number) => {
    const url = images[index]
    setImages((prev) => prev.filter((_, itemIndex) => itemIndex !== index))
    setImageAssetIds((prev) => prev.filter((_, itemIndex) => itemIndex !== index))
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
  // 模型只允许在入口选择。视频一次配置完整工作流；图片按当前是否有参考图，
  // 只展示并要求文生图或图生图中的一个，避免用户必须为一次创作选择两个图片模型。
  const requiredModelOperations: readonly GenerationOperationCode[] =
    mode === 'image'
      ? [getImageGenerationOperationCode(images.length)]
      : REQUIRED_GENERATION_OPERATION_CODES_BY_MODE.video
  const visibleModelGroups =
    mode === 'video' ? modelGroups : filterGenerationModelGroupsByOperations(modelGroups, requiredModelOperations)
  const conflictModelGroups = visibleModelGroups
  const modelSelectionComplete = isGenerationModelSelectionComplete(visibleModelGroups, generationModels)
  const modelSelectionConflicts = getGenerationModelSelectionConflicts(conflictModelGroups, generationModels, {
    ratio,
    ...(mode === 'video'
      ? { durationSec: parseDurationSeconds(duration) ?? undefined }
      : { referenceImageCount: images.length }),
  })
  const modelCatalogReady =
    !modelOperationStates || areGenerationModelOperationsReady(modelOperationStates, requiredModelOperations)
  const modelGatePassed =
    !requireModelSelection || (modelCatalogReady && modelSelectionComplete && modelSelectionConflicts.length === 0)
  const modelGateMessage = !requireModelSelection
    ? ''
    : !modelCatalogReady
      ? '当前有必需模型不可用，请在模型选择中检查后重试'
      : !modelSelectionComplete
        ? '请先选择本次创作使用的全部模型'
        : modelSelectionConflicts.length > 0
          ? '当前创作参数与所选模型不兼容，请调整模型或创作参数'
          : ''
  const canSubmit = cleanText.length > 0 || images.length > 0
  // 恢复态:已有生成结果且当前在视频 Tab → 发送按钮变「下一步」,并显示「重新生成」
  const resumeMode = !!canResume && mode === (initial?.mode || 'video')
  const updateGenerationModel = (groupKey: string, modelId: number | string, subgroupKey?: string) => {
    const operationCode = (subgroupKey || groupKey) as GenerationOperationCode
    setGenerationModels((previous) => ({ ...previous, [operationCode]: modelId }))
  }
  const requestModelSelectionAttention = () => {
    setModelAttentionRequest((request) => request + 1)
    showToast(modelGateMessage || '请先完成本次创作的模型选择', 'info')
  }
  const submit = async () => {
    if (!canSubmit || submittingRef.current) return
    if (!modelGatePassed) {
      requestModelSelectionAttention()
      return
    }
    submittingRef.current = true
    setSubmitting(true)
    try {
      const accepted = await onSubmit(cleanText, {
        mode,
        style: '',
        ratio,
        duration,
        imageCount: images.length,
        images,
        ...(imageAssetIds.some((assetId) => assetId > 0) ? { imageAssetIds } : {}),
        ...(mode === 'image' ? { outputCount } : {}),
        skill: mode === 'video' && skill ? skill : undefined,
        ...(Object.keys(generationModels).length ? { generationModels } : {}),
      })
      // 项目和临时素材均准备成功后才清空入口暂存。失败时保留输入，刷新后仍可重试。
      if (accepted !== false) {
        draftPersistenceEnabledRef.current = false
        clearSmartEntryDraft()
      }
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }
  const resume = () => {
    if (submittingRef.current) return
    if (!modelGatePassed) {
      requestModelSelectionAttention()
      return
    }
    void onResume?.(generationModels)
  }

  // 选中/切换 SKILL:把提示语插入输入框(替换旧的);未选则移除
  const pickSkill = (s: string) => {
    setText((cur) => composeWithSkill(stripSkillLine(cur), s))
    setSkill(s)
  }

  return (
    <div
      className={`${styles.screate}${isDraggingFiles ? ` ${styles.dragging}` : ''}`}
      data-mode={mode}
      onPaste={(event) => {
        const files = Array.from(event.clipboardData?.items || [])
          .filter((item) => item.kind === 'file')
          .map((item) => item.getAsFile())
          .filter((file): file is File => !!file)
        if (!files.length) return
        event.preventDefault()
        void pickImages(files)
      }}
      onDragEnter={(event) => {
        if (!Array.from(event.dataTransfer?.items || []).some((item) => item.kind === 'file')) return
        event.preventDefault()
        dragDepthRef.current += 1
        setIsDraggingFiles(true)
      }}
      onDragOver={(event) => {
        if (!Array.from(event.dataTransfer?.items || []).some((item) => item.kind === 'file')) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={() => {
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
        if (!dragDepthRef.current) setIsDraggingFiles(false)
      }}
      onDrop={(event) => {
        event.preventDefault()
        dragDepthRef.current = 0
        setIsDraggingFiles(false)
        void pickImages(Array.from(event.dataTransfer.files))
      }}
    >
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
        <div className={styles.tabs} role="tablist" aria-label="创作类型">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'video'}
            className={`${styles.tab}${mode === 'video' ? ' ' + styles.active : ''}`}
            onClick={() => switchMode('video')}
          >
            制作视频
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'image'}
            className={`${styles.tab}${mode === 'image' ? ' ' + styles.active : ''}`}
            onClick={() => switchMode('image')}
          >
            制作图片
          </button>
        </div>

        <div className={styles.card} data-guide="smart-input">
          {/* 已选图片:独立成一行(可换行),不挤压文本框;参考主流 AI 输入框做法 */}
          {images.length > 0 && (
            <div className={styles.attachments}>
              {images.map((url, index) => (
                <div className={styles.thumb} key={`${url}-${index}`}>
                  <img src={url} alt="" />
                  <button type="button" className={styles.thumbX} onClick={() => removeImage(index)} aria-label="移除">
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
              aria-label="选择上传图片"
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
                aria-label="创作需求"
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

              {mode === 'image' && (
                <EntryDropdown
                  value={`${outputCount}张`}
                  options={IMAGE_OUTPUT_COUNT_OPTIONS}
                  onChange={(value) => setOutputCount(clampImageOutputCount(String(value).replace('张', '')))}
                  ariaLabel="生成图片数量"
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
                      aria-hidden="true"
                    >
                      <rect x="5" y="5" width="14" height="14" rx="3" />
                      <path d="M8.5 15.5l3-3 2.2 2.2 1.8-2 3.5 3.5M9 9.5h.01" />
                    </svg>
                  }
                  valueMinWidth={28}
                />
              )}

              <span className={styles.atAnchor} data-guide="smart-at">
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

              {/* 智能成片脚本(仅「制作视频」展示;「制作图片」隐藏,对齐设计) */}
              {mode === 'video' && (
                <span data-guide="smart-skills" style={{ display: 'inline-flex' }}>
                  <EntryDropdown
                    clearable
                    placeholder="爆款脚本自动生成"
                    value={skill}
                    options={SCRIPT_OPTIONS}
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
                </span>
              )}

              {(visibleModelGroups.length > 0 || Boolean(modelLoading) || Boolean(modelError)) && (
                <GenerationModelDropdown
                  groups={visibleModelGroups}
                  selected={generationModels}
                  loading={modelLoading}
                  error={modelError}
                  onRetry={onReloadModels ? () => onReloadModels() : undefined}
                  onChange={updateGenerationModel}
                  conflicts={modelSelectionConflicts}
                  attentionRequest={modelAttentionRequest}
                  attentionMessage={modelGateMessage}
                />
              )}
            </div>

            <div className={styles.sendArea}>
              {resumeMode && (
                <button
                  type="button"
                  className={`${styles.send} ${styles.sendResume}`}
                  data-guide="smart-next"
                  disabled={submitting}
                  onClick={resume}
                  aria-label={mode === 'image' ? '返回图片对话' : '返回下一步'}
                  title={mode === 'image' ? '返回图片对话' : '返回下一步'}
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 30 30"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    aria-hidden="true"
                  >
                    <path
                      d="M2.11194 25.7576L1.88126 25.5588C1.63745 25.3525 1.49117 25.2249 2.4664 21.1664C4.14869 14.141 10.8384 9.60425 18.3272 8.92721V3.74719L30 12.8132L18.3272 21.8791V16.6972C13.4753 16.3296 9.21243 16.7535 6.35423 19.818C4.94576 21.3352 3.24847 24.3322 2.8415 25.2156C2.78336 25.3412 2.67833 25.5719 2.42139 25.6582L2.11194 25.7576Z"
                      fill="black"
                    />
                  </svg>
                </button>
              )}
              <button
                type="button"
                className={`${styles.send} ${styles.sendPlain}`}
                data-guide={resumeMode ? 'smart-regen' : 'smart-next'}
                disabled={!canSubmit || submitting}
                onClick={() => void submit()}
                aria-label={submitting ? '正在准备创作' : '去制作'}
                title={submitting ? '正在准备创作' : '去制作'}
              >
                <span className={styles.sendPlainText}>{submitting ? '准备中…' : '去制作'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
