/**
 * 智能成片「入口/需求输入」页(2.1,按 Figma 79:3966 还原)。
 * 大标题 + 制作视频/制作图片 Tab + 上传&提示词卡片 +
 * 比例(16:9)/时长(5s) 下拉 + @ + 发送。背景彩色渐变光晕。
 * 提交 → 调 onSubmit(需求文本, 选项),由父级进入分镜脚本流程。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import EntryCanvasBg from '../EntryCanvasBg'
import EntryDropdown from '../EntryDropdown'
import { CreativeModelSlots } from '../CreativeModelSlots'
import { CreativeParamsDropdown, type CreativeParamsOptions, type CreativeParamsValue } from '../CreativeParamsDropdown'
import {
  filterGenerationModelGroupsByOperations,
  getGenerationModelDurationOptions,
  getGenerationModelRatioOptions,
  getGenerationModelReferenceImageLimit,
  getGenerationModelResolutionOptions,
  getGenerationModelSelectionConflicts,
  isGenerationModelSelectionComplete,
  type GenerationModelErrorState,
  type GenerationModelGroup,
  type GenerationModelLoadingState,
  type GenerationModelEstimateRequest,
  type GenerationModelEstimateResult,
  type GenerationModelEstimateSummary,
} from '../GenerationModelPicker'
import { fileToDataUrl } from '@/utils/imageFile'
import {
  clearSmartEntryDraft,
  loadSmartEntryDraft,
  saveSmartEntryDraft,
  type SmartEntryDraftStore,
} from '@/utils/smartEntryDraft'
import { ALL_SMART_SCRIPT_NAMES, SMART_SCRIPT_OPTIONS, normalizeSmartScriptName } from '@/utils/smartScriptOptions'
import {
  DEFAULT_VIDEO_RESOLUTIONS,
  ENTRY_RATIO_OPTIONS as RATIO_OPTIONS,
  LEGACY_DEFAULT_VIDEO_RESOLUTION,
  normalizeVideoResolution,
} from '@/utils/videoOptions'
import { matchModelParamOptionValue } from '@/utils/modelSchema'
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
import type { SmartRealPersonReference } from '@/utils/smartRealPerson'
import RealPersonMaterialPicker from './RealPersonMaterialPicker'
import MaterialLibraryPicker from '@/components/material/MaterialLibraryPicker'
import { listAllAssets, listAllCreativeProjects } from '@/utils/businessPagination'
import { assetStreamUrl } from '@/utils/assetUrl'
import { createMaterialFromAsset } from '@/utils/materials'
import { filterAssetsByProjectAccess, getAccessibleProjectIds } from '@/utils/projectAssetAccess'
import { resolveUserId } from '@/utils/creativeDraftMetadata'
import { useCurrentUser } from '@/stores/workspaceSession'
import { estimateAiTaskCost } from '@/api/business'
import styles from './SmartEntry.module.less'

/** 入口提交给智能成片编排器的制作模式、画幅、时长和参考素材元数据。 */
export interface EntryMeta {
  mode: 'video' | 'image'
  style: string
  ratio: string
  duration: string
  /** 视频出片分辨率；档位来自所选视频模型 schema，图片模式忽略。 */
  resolution?: string
  imageCount: number
  images: string[]
  imageAssetIds?: number[]
  realPersonReferences?: SmartRealPersonReference[]
  /** 图片模式单轮生成数量，限制为 1–9；视频模式忽略。 */
  outputCount?: number
  /** 选中的营销 SKILL(空=不使用,走现有逻辑;非空=多一步「营销思路拆解」) */
  skill?: string
  /** 按后端 operation_code 保存的模型版本选择；草稿恢复和后续任务都使用同一份配置。 */
  generationModels?: GenerationModelSelectionMap
}

/** 智能成片入口的提交、恢复、新建及初始草稿参数。 */
interface SmartEntryProps {
  /** 真人成片只复用生成能力，入口视觉和交互语义保持独立。 */
  variant?: 'smart' | 'real-person'
  workspaceId?: number
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
  /** 游客态：模型入口照常展示但置灰，点击交由 onAuthRequired 引导登录。 */
  authRequired?: boolean
  onAuthRequired?: () => void
  /**
   * 回填初始值:从分镜脚本「上一步」返回输入框时,恢复上次输入(需求文本/图片/风格/比例/时长/模式/skill)。
   * 仅在挂载时生效(useState 初值);路由切换会卸载本组件,数据随之清空。
   */
  initial?: {
    mode?: 'video' | 'image'
    text?: string
    ratio?: string
    duration?: string
    resolution?: string
    images?: string[]
    imageAssetIds?: number[]
    realPersonReferences?: SmartRealPersonReference[]
    outputCount?: number
    skill?: string
    generationModels?: GenerationModelSelectionMap
  }
}

/**
 * 尚未选择时长时的取值：空串而不是 '0s'。
 *
 * '0s' 看起来是个可解析的秒数，下游 `parseDurationSeconds(duration) || DEFAULT_DURATION_SEC`
 * 会把它静默回落成默认时长，用户就拿到了自己没选过的秒数；空串则只会走「未选」分支。
 */
const UNSET_DURATION = ''

/** 可选的智能成片脚本。 */
const SCRIPT_OPTIONS = [...SMART_SCRIPT_OPTIONS]

/**
 * 图片模式单轮出图数量的上限（与参考图上限无关，后者跟随所选模型）。
 */
const MAX_IMAGE_OUTPUT_COUNT = 9
const clampImageOutputCount = (value: unknown) =>
  Math.min(MAX_IMAGE_OUTPUT_COUNT, Math.max(1, Math.floor(Number(value) || 1)))

/**
 * 尚未选中视频模型时的参考图上限兜底。
 *
 * 参考图真实上限由所选模型决定（见 getGenerationModelReferenceImageLimit）。
 * 没选模型时给 9：这是历史行为，也是主力模型 Seedance 2.0 的真实上限；
 * 选定模型后立即收敛到该模型的真值。
 */
const FALLBACK_REFERENCE_IMAGE_LIMIT = 9
/** 文件扩展名图片识别兜底规则。 */
const IMAGE_FILE_RE = /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i

/** 同时依据 MIME 与扩展名判断是否为可接收图片。 */
const isImageFile = (file: File) => file.type.startsWith('image/') || IMAGE_FILE_RE.test(file.name)

/**
 * 输入示例文案。不再写死张数——参考图上限跟着所选模型变（缩略图行有实时用量提示），
 * 文案里再写一个固定数字只会和真实上限矛盾。
 */
const PLACEHOLDER_VIDEO =
  '上传或粘贴图片，输入文字或@参考素材，生成精彩广告视频。例如：把 @图片1 中的产品放到 @图片2 中的场景里'
/** 图片模式的输入示例文案。 */
const PLACEHOLDER_IMAGE =
  '上传或粘贴图片，输入文字或@参考素材，生成精彩广告图片。例如：把 @图片1 中的产品放到 @图片2 中的场景里'

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
  variant = 'smart',
  workspaceId = 0,
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
  authRequired = false,
  onAuthRequired,
  initial,
  restoreSessionDraft = true,
}: SmartEntryProps) {
  const isRealPersonVariant = variant === 'real-person'
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
  const [mode, setMode] = useState<'video' | 'image'>(
    isRealPersonVariant ? 'video' : (initial?.mode ?? stored?.mode ?? 'video'),
  )
  // 切换 Tab:背景弥散位移 + 涟漪动画由 <EntryCanvasBg mode> 监听 mode 变化驱动(Canvas 实现,不卡)
  const switchMode = (m: 'video' | 'image') => {
    if (m === mode) return
    if (m === 'image' && realPersonReferences.length > 0) {
      showToast('已选择真人素材，真人素材仅支持生成视频', 'info')
      return
    }
    setMode(m)
  }
  // 回填:正文 + (若已选 skill)插入提示语,使其在输入框内带色展示
  const [text, setText] = useState(() => composeWithSkill(seedText, seedSkill))
  const [ratio, setRatio] = useState(initial?.ratio ?? stored?.ratio ?? '16:9')
  // 默认 0s = 尚未选择：时长必须在选定视频模型、看到该模型真实支持的档位之后再由用户选。
  const [duration, setDuration] = useState(initial?.duration ?? stored?.duration ?? UNSET_DURATION)
  // 分辨率沿用历史默认 720p；所选模型不支持时，下面的档位副作用会就近吸附到该模型真实支持的规格。
  const [resolution, setResolution] = useState(
    initial?.resolution ?? stored?.resolution ?? LEGACY_DEFAULT_VIDEO_RESOLUTION,
  )
  const [images, setImages] = useState<string[]>(seedImages)
  const [imageAssetIds, setImageAssetIds] = useState<number[]>(() =>
    seedImages.map((_, index) => Math.max(0, Math.floor(Number(seedImageAssetIds[index]) || 0))),
  )
  const [realPersonReferences, setRealPersonReferences] = useState<SmartRealPersonReference[]>(
    () => initial?.realPersonReferences ?? stored?.realPersonReferences ?? [],
  )
  const [realPersonPickerOpen, setRealPersonPickerOpen] = useState(false)
  // 加号的来源菜单：本地上传 / 素材库 / 真人素材。与爆款复制同一套交互，
  // 素材库复用 MaterialLibraryPicker，真人素材仍走已认证真人库。
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [libraryLoading, setLibraryLoading] = useState(false)
  const [libraryMaterials, setLibraryMaterials] = useState<any[]>([])
  const [libraryTab, setLibraryTab] = useState('mine')
  const [libraryQuery, setLibraryQuery] = useState('')
  const currentUser = useCurrentUser()
  const currentUserId = resolveUserId(currentUser)
  const sourceMenuRef = useRef<HTMLDivElement | null>(null)

  // 点击菜单外部关闭
  useEffect(() => {
    if (!sourceMenuOpen) return
    const onPointerDown = (event: MouseEvent) => {
      if (!sourceMenuRef.current?.contains(event.target as Node)) setSourceMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [sourceMenuOpen])

  /** 拉取素材库里的图片素材（只取本人可见的项目资产）。 */
  const loadLibraryImages = async () => {
    const ws = Number(workspaceId || 0)
    if (!ws || !currentUserId) {
      showToast(ws ? '登录身份尚未就绪，请稍后重试' : '未选择工作空间', 'error')
      return
    }
    setLibraryLoading(true)
    try {
      const [assetItems, projectResult] = await Promise.all([
        listAllAssets({ workspaceId: ws, type: 'image' }),
        listAllCreativeProjects({ workspaceId: ws })
          .then((items) => ({ loaded: true, items }))
          .catch(() => ({ loaded: false, items: [] as any[] })),
      ])
      const assets = filterAssetsByProjectAccess(
        assetItems,
        getAccessibleProjectIds(projectResult.items, currentUserId),
        projectResult.loaded,
      ).filter((asset: any) => asset?.id && asset.type === 'image')
      const materials = assets
        .map((asset: any) => {
          const src =
            assetStreamUrl(Number(asset.id), ws) || asset?.thumbnail_url || asset?.preview_url || asset?.url || ''
          return createMaterialFromAsset(asset, src)
        })
        .filter((material: any) => material.src)
      setLibraryMaterials(materials)
    } catch (error: any) {
      showToast(error?.message || '素材库加载失败', 'error')
    } finally {
      setLibraryLoading(false)
    }
  }

  /** 素材库确认：选中的图片已有 asset_id，直接进素材列表，不必再上传一次。 */
  const confirmLibraryImages = (picked: any[]) => {
    const room = referenceImageLimit - images.length
    if (room <= 0) {
      showToast(`当前模型最多支持 ${referenceImageLimit} 张参考图`, 'info')
      setLibraryOpen(false)
      return
    }
    const chosen = (picked || [])
      .filter((material: any) => !/video/i.test(String(material?.type || material?.serverAsset?.type || '')))
      .map((material: any) => ({
        url: String(material?.src || ''),
        assetId: Number(material?.assetId ?? material?.serverAsset?.id ?? material?.id ?? 0) || 0,
      }))
      .filter((item) => item.url && item.assetId > 0)
      .slice(0, room)
    if (chosen.length) {
      setImages((prev) => [...prev, ...chosen.map((item) => item.url)])
      setImageAssetIds((prev) => [...prev, ...chosen.map((item) => item.assetId)])
    }
    if (picked.length > chosen.length) showToast('部分素材不可用，已跳过', 'info')
    setLibraryOpen(false)
  }

  /** 加号菜单选择来源。 */
  const chooseImageSource = (source: 'local' | 'library' | 'realPerson') => {
    setSourceMenuOpen(false)
    if (images.length >= referenceImageLimit) {
      showToast(`当前模型最多支持 ${referenceImageLimit} 张参考图`, 'info')
      return
    }
    if (source === 'local') {
      fileRef.current?.click()
      return
    }
    if (source === 'realPerson') {
      setRealPersonPickerOpen(true)
      return
    }
    setLibraryOpen(true)
    void loadLibraryImages()
  }
  const [outputCount, setOutputCount] = useState(() =>
    clampImageOutputCount(initial?.outputCount ?? stored?.outputCount ?? 1),
  )
  // 选中的营销 SKILL(单选,空=不使用)
  const [skill, setSkill] = useState(seedSkill)
  const [generationModels, setGenerationModels] = useState<GenerationModelSelectionMap>(
    () => initial?.generationModels ?? stored?.generationModels ?? {},
  )
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const dragDepthRef = useRef(0)

  const hasSelectedRealPerson = realPersonReferences.some((reference) => Number(reference?.realPersonId) > 0)

  useEffect(() => {
    if (hasSelectedRealPerson && mode !== 'video') setMode('video')
  }, [hasSelectedRealPerson, mode])

  // ── @ 引用素材:点击 @ 在光标处弹出已上传素材;选中插入「@图片N」;无素材则直接插入「@」──
  const taRef = useRef<HTMLTextAreaElement | null>(null)
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
        resolution,
        skill,
        images,
        imageAssetIds,
        realPersonReferences,
        outputCount,
        generationModels,
      })
    }, 300)
    return () => window.clearTimeout(t)
  }, [
    mode,
    text,
    ratio,
    duration,
    resolution,
    skill,
    images,
    imageAssetIds,
    realPersonReferences,
    outputCount,
    generationModels,
  ])
  // 本地图片先转成受控 data URL；过滤非图片并限制数量，避免无效文件进入后续资产上传流程。
  const pickImages = async (files: FileList | File[] | null) => {
    if (!files?.length) return
    const room = referenceImageLimit - images.length
    if (room <= 0) {
      showToast(`当前模型最多支持 ${referenceImageLimit} 张参考图`, 'info')
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
      const accepted = picked.slice(0, referenceImageLimit - images.length)
      setImages((prev) => [...prev, ...accepted])
      setImageAssetIds((prev) => [...prev, ...accepted.map(() => 0)])
    }
  }
  const removeImage = (index: number) => {
    const url = images[index]
    const removedAssetId = Number(imageAssetIds[index] || 0)
    setImages((prev) => prev.filter((_, itemIndex) => itemIndex !== index))
    setImageAssetIds((prev) => prev.filter((_, itemIndex) => itemIndex !== index))
    // 真人引用按 localAssetId 关联而不是按下标:真人与普通素材可以混着传,
    // 下标会随普通图片的增删而错位,assetId 不会。
    setRealPersonReferences((prev) =>
      removedAssetId > 0 ? prev.filter((item) => Number(item?.localAssetId) !== removedAssetId) : prev,
    )
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
  // 选了真人不再额外要求图生图模型:真人素材曾经要先过一遍图生图重画,那一步已随
  // 「准备素材」移除,现在真人素材原样作为参考图提交,只用得到视频模型。
  const requiredModelOperations: readonly GenerationOperationCode[] =
    mode === 'image'
      ? [getImageGenerationOperationCode(images.length)]
      : REQUIRED_GENERATION_OPERATION_CODES_BY_MODE.video
  // 两种模式都按「本次创作真正会用到的 operation」过滤：
  // 视频模式下 video.edit 已不属于智能成片流程（修改走视频生视频），不能再出现在模型面板里。
  const visibleModelGroups = filterGenerationModelGroupsByOperations(modelGroups, requiredModelOperations)
  const conflictModelGroups = visibleModelGroups
  const modelSelectionComplete = isGenerationModelSelectionComplete(visibleModelGroups, generationModels)
  // 视频模式也要报参考图数量冲突：上传的素材现在直接作为参考图提交给视频模型，
  // 换到一个只收 1 张的模型时必须当场提示，而不是等提交被后端拒。
  // 只把「用户已经定下来」的参数交给冲突校验。
  //
  // 时长默认未选，若照样把这一项传下去，模型一被选中就会立刻报「当前模型要求提供时长」——
  // 那是在指责用户还没来得及做的事。参数改成弹窗后这条更刺眼：提示挂在模型卡片上，
  // 而要改的东西在另一个弹窗里。等用户真的选了时长，不兼容照样会报。
  // 注意 getModelConstraintConflicts 用 hasOwn 判断「是否提供」，传 undefined 也算提供，
  // 所以必须整个键不传。
  const selectedDurationForConflicts = mode === 'video' ? (parseDurationSeconds(duration) ?? undefined) : undefined
  const modelSelectionConflicts = getGenerationModelSelectionConflicts(conflictModelGroups, generationModels, {
    ratio,
    referenceImageCount: images.length,
    ...(selectedDurationForConflicts !== undefined ? { durationSec: selectedDurationForConflicts } : {}),
    ...(mode === 'video' && resolution ? { resolution } : {}),
  })
  // 时长档位跟随所选视频模型：schema 声明了支持哪些秒数就只展示哪些，未声明才回落 1–15 秒。
  const durationOptions = useMemo(
    () =>
      getGenerationModelDurationOptions(visibleModelGroups, generationModels, 'video.generate', SMART_VIDEO_DURATIONS),
    [visibleModelGroups, generationModels],
  )
  const durationUnset = parseDurationSeconds(duration) === null
  //
  // 时长与模型是双向约束，不是单向顺序：秒数是用户的需求，模型是实现选择，谁先定都合理。
  // 这里既不锁时长（未选模型时 getGenerationModelDurationOptions 本来就返回默认档位），
  // 也不在换模型后把用户选的 30 秒静默吸附成 15 秒——那是在悄悄丢掉用户的输入。
  // 不兼容的组合交给 modelSelectionConflicts 明说，并由 modelGatePassed 拦住提交，
  // 改模型还是改秒数由用户自己决定。
  //
  // 分辨率档位同样跟随所选视频模型；模型未声明 resolution/size 时回落到通用档位。
  const resolutionOptions = useMemo(
    () =>
      getGenerationModelResolutionOptions(
        visibleModelGroups,
        generationModels,
        'video.generate',
        DEFAULT_VIDEO_RESOLUTIONS,
      ),
    [visibleModelGroups, generationModels],
  )
  /**
   * 分辨率与时长的差别：它一直带着默认值（720p），用户可能压根没碰过。
   * 换模型后若把这个从没被选择过的默认值也报成冲突，用户会被要求去解决一个不是自己造成的问题；
   * 所以未经手时继续就近收敛，一旦用户显式选过就不再改写，交给冲突提示。
   */
  const resolutionTouchedRef = useRef(false)
  const pickResolution = useCallback((value: string) => {
    resolutionTouchedRef.current = true
    setResolution(value)
  }, [])
  useEffect(() => {
    if (mode !== 'video' || resolutionOptions.length === 0) return
    if (resolutionTouchedRef.current) return
    const normalized = normalizeVideoResolution(resolution, resolutionOptions)
    if (normalized !== resolution) setResolution(normalized)
  }, [mode, resolution, resolutionOptions])

  /**
   * 画面比例同样只放模型做得了的那几项。
   *
   * 比例此前是固定五项，与时长/分辨率不同口径：模型只支持 16:9 时，
   * 9:16 照样能选，要等提交被后端拒才知道。三者必须同源。
   * 图片模式不参与——比例约束取自 video.generate 槽位。
   */
  const ratioOptions = useMemo(() => {
    if (mode !== 'video') return [...RATIO_OPTIONS]
    return getGenerationModelRatioOptions(visibleModelGroups, generationModels, 'video.generate', RATIO_OPTIONS)
  }, [mode, visibleModelGroups, generationModels])

  /**
   * 参考图上限跟随所选模型（与时长/分辨率/比例同源）。
   *
   * 用户上传的素材会直接作为参考图提交给视频模型，各模型能收的张数差别很大，
   * 写死 9 会让 Seedance 2.5 少传 21 张、让只收 1 张的模型白传后被后端拒。
   * 图片模式取 image.* 槽位，视频模式取 video.generate。
   */
  const referenceImageLimit = useMemo(() => {
    const operationCode: GenerationOperationCode =
      mode === 'image' ? getImageGenerationOperationCode(images.length) : 'video.generate'
    return getGenerationModelReferenceImageLimit(
      visibleModelGroups,
      generationModels,
      operationCode,
      FALLBACK_REFERENCE_IMAGE_LIMIT,
    )
  }, [mode, images.length, visibleModelGroups, generationModels])
  // 与分辨率同一条原则：用户显式选过就不再改写，只有没碰过的默认值才跟着模型收敛
  const ratioTouchedRef = useRef(false)
  const pickRatio = useCallback((value: string) => {
    ratioTouchedRef.current = true
    setRatio(value)
  }, [])
  useEffect(() => {
    if (mode !== 'video' || ratioOptions.length === 0) return
    if (ratioTouchedRef.current) return
    // 必须和冲突校验用同一个比较函数：那边是归一化匹配（忽略大小写与首尾空格），
    // 这里若用精确 includes，两处会对同一个值给出相反结论——本轮反复修的正是这类分歧。
    // 命中后统一写回 schema 的原始拼写，提交时才不会被后端按未知取值拒掉。
    const matched = matchModelParamOptionValue(ratio, ratioOptions)
    if (matched === undefined) setRatio(ratioOptions[0])
    else if (matched !== ratio) setRatio(matched)
  }, [mode, ratio, ratioOptions])

  /**
   * 弹层里的档位。都在上面按所选模型的 schema 算好了，这里只做形状转换：
   * 视频是 比例 / 分辨率 / 时长，图片是 比例 / 出图数量。
   */
  const creativeParamsOptions: CreativeParamsOptions = useMemo(
    () => ({
      ratios: ratioOptions,
      durations: mode === 'video' ? durationOptions : [],
      resolutions: mode === 'video' ? resolutionOptions : [],
      counts: mode === 'video' ? [] : Array.from({ length: MAX_IMAGE_OUTPUT_COUNT }, (_, index) => index + 1),
    }),
    [mode, ratioOptions, durationOptions, resolutionOptions],
  )

  const creativeParamsValue: CreativeParamsValue = useMemo(
    () => ({
      ratio,
      // 0 = 尚未选择；弹层据此显示占位而不是一个用户没选过的秒数。
      durationSec: parseDurationSeconds(duration) ?? 0,
      resolution,
      count: outputCount,
    }),
    [ratio, duration, resolution, outputCount],
  )

  const applyCreativeParams = useCallback(
    (next: CreativeParamsValue) => {
      if (next.ratio !== ratio) pickRatio(next.ratio)
      if (next.resolution !== resolution) pickResolution(next.resolution)
      if (next.durationSec > 0 && `${next.durationSec}s` !== duration) setDuration(`${next.durationSec}s`)
      if (next.count !== outputCount) setOutputCount(clampImageOutputCount(next.count))
    },
    [ratio, resolution, duration, outputCount, pickRatio, pickResolution],
  )

  /**
   * 模型合计预估。放在「去制作」旁边而不是模型弹窗里：弹窗选完就关，
   * 数字只在弹窗开着时可见，而用户恰恰是在点主按钮那一刻才需要知道要花多少。
   */
  const [modelEstimate, setModelEstimate] = useState<GenerationModelEstimateSummary | null>(null)

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
  // 每个真人引用都要仍然指向当前素材列表里的一张图(用户可能已经把它删掉了)。
  // 不再限制「只能有一个真人」:多人同框、真人配产品图都是常见广告场景,后端逐个
  // asset 查真人库并各自校验授权,并不要求列表里只有一个真人。
  const hasValidSelectedRealPerson =
    !hasSelectedRealPerson ||
    realPersonReferences.every(
      (reference) =>
        Boolean(reference?.realPersonId) &&
        Number(reference?.localAssetId) > 0 &&
        imageAssetIds.some((assetId) => Number(assetId) === Number(reference.localAssetId)),
    )
  // 真人成片必须至少选一个已认证真人;普通智能成片可选。
  const hasRequiredRealPerson = !isRealPersonVariant || (hasSelectedRealPerson && hasValidSelectedRealPerson)
  const canSubmit =
    hasRequiredRealPerson &&
    hasValidSelectedRealPerson &&
    (isRealPersonVariant || cleanText.length > 0 || images.length > 0)
  // 恢复态:已有生成结果且当前在视频 Tab → 发送按钮变「下一步」,并显示「重新生成」
  const resumeMode = !!canResume && mode === (initial?.mode || 'video')
  const updateGenerationModel = (groupKey: string, modelId: number | string, subgroupKey?: string) => {
    const operationCode = (subgroupKey || groupKey) as GenerationOperationCode
    setGenerationModels((previous) => ({ ...previous, [operationCode]: modelId }))
  }
  const estimateSelectedModel = useCallback(
    async ({
      operationCode,
      modelVersionId,
    }: GenerationModelEstimateRequest): Promise<GenerationModelEstimateResult> => {
      if (!workspaceId) throw new Error('工作空间未就绪')
      const durationSec = parseDurationSeconds(duration) || 5
      const params =
        operationCode === 'responses.multimodal'
          ? { temperature: 0.7, max_output_tokens: 1200 }
          : operationCode.startsWith('image.')
            ? { ratio, count: mode === 'image' ? outputCount : 1 }
            : { duration: durationSec, ratio, resolution }
      const result = await estimateAiTaskCost({
        workspaceId,
        modelVersionId,
        operationCode,
        prompt: cleanText,
        params,
        inputAssets: imageAssetIds.filter((assetId) => assetId > 0),
      })
      return {
        estimatedCost: Number(result?.estimated_cost ?? 0),
        balance: Number.isFinite(Number(result?.balance)) ? Number(result.balance) : undefined,
        canAfford: result?.can_afford,
      }
    },
    [cleanText, duration, imageAssetIds, mode, outputCount, ratio, resolution, workspaceId],
  )
  /**
   * 合计预估：把每个已选模型各跑一次估价后求和，显示在「去制作」旁边。
   *
   * 原本这段在模型弹窗内部；换成创作台样式的胶囊后那里没有落脚点，
   * 而预估本来就该跟着「花钱的那一下」走，所以搬到入口自己算。
   */
  // 已选模型的稳定签名。visibleModelGroups 每次渲染都是新数组，直接进依赖会
  // 「effect → setState → 重渲染 → 新数组 → effect」无限循环；这里压成字符串比较。
  const estimateTargetsKey = useMemo(() => {
    const slotKeys = visibleModelGroups.flatMap((group) => [
      ...(group.models?.length ? [group.key] : []),
      ...(group.subgroups ?? []).filter((subgroup) => subgroup.models.length > 0).map((subgroup) => subgroup.key),
    ])
    return slotKeys
      .map((operationCode) => `${operationCode}:${Number(generationModels[operationCode] || 0)}`)
      .filter((entry) => !entry.endsWith(':0'))
      .join('|')
  }, [visibleModelGroups, generationModels])

  useEffect(() => {
    const picked = estimateTargetsKey
      .split('|')
      .filter(Boolean)
      .map((entry) => {
        const [operationCode, modelVersionId] = entry.split(':')
        return { operationCode, modelVersionId: Number(modelVersionId) }
      })

    if (!workspaceId || !modelSelectionComplete || !picked.length) {
      setModelEstimate(null)
      return
    }

    let alive = true
    setModelEstimate({ total: 0, canAfford: true, loading: true, failed: false })
    // 防抖：用户连着改比例/时长时不必每次都打一轮估价接口。
    const timer = window.setTimeout(() => {
      void Promise.all(
        picked.map((item) =>
          estimateSelectedModel(item)
            .then((result) => ({ ok: true as const, result }))
            .catch(() => ({ ok: false as const, result: null })),
        ),
      ).then((results) => {
        if (!alive) return
        const succeeded = results.filter((item) => item.ok).map((item) => item.result!)
        const total = succeeded.reduce((sum, item) => sum + (Number(item.estimatedCost) || 0), 0)
        const balance = succeeded.find((item) => Number.isFinite(Number(item.balance)))?.balance
        setModelEstimate({
          total,
          balance,
          canAfford: !succeeded.some((item) => item.canAfford === false) && (balance == null || total <= balance),
          loading: false,
          failed: results.some((item) => !item.ok),
        })
      })
    }, 400)

    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [estimateSelectedModel, estimateTargetsKey, modelSelectionComplete, workspaceId])

  /**
   * 提交时未选够模型：提示原因。
   * 旧实现还会展开模型面板并高亮，换成创作台样式的胶囊后没有受控展开入口，
   * 改为只给提示——胶囊本身就在工具条最左，不需要再被指出来。
   */
  const requestModelSelectionAttention = () => {
    showToast(modelGateMessage || '请先完成本次创作的模型选择', 'info')
  }
  const submit = async () => {
    if (!canSubmit || submittingRef.current) return
    if (!modelGatePassed) {
      requestModelSelectionAttention()
      return
    }
    // 时长必须由用户显式选择：0s 是未选状态，提交会被后端按无效时长拒绝。
    if (mode === 'video' && durationUnset) {
      // 模型未选的情况已由上面的 modelGatePassed 拦下并给出自己的文案，这里只谈时长
      showToast('请先选择视频时长', 'info')
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
        ...(mode === 'video' ? { resolution } : {}),
        imageCount: images.length,
        images,
        ...(imageAssetIds.some((assetId) => assetId > 0) ? { imageAssetIds } : {}),
        ...(realPersonReferences.length ? { realPersonReferences } : {}),
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

  /*
    来源菜单：本地上传 / 素材库 / 真人素材。
    原来「选择真人素材」是底栏一枚独立按钮，与加号并列——两者都是「添加素材」，
    拆成两个入口反而要用户先想清楚素材从哪来。现在统一收进加号。
    空态大方块与缩略图行的「+」共用这一份。
  */
  const sourceMenu = !isRealPersonVariant && sourceMenuOpen && (
    <div className={styles.sourceMenu} role="menu" aria-label="添加素材">
      <button type="button" role="menuitem" onClick={() => chooseImageSource('local')}>
        本地上传
      </button>
      <button type="button" role="menuitem" onClick={() => chooseImageSource('library')}>
        素材库
      </button>
      {mode === 'video' && (
        <button type="button" role="menuitem" onClick={() => chooseImageSource('realPerson')}>
          真人素材
        </button>
      )}
    </div>
  )

  return (
    <div
      className={`${styles.screate}${isRealPersonVariant ? ` ${styles.realPerson}` : ''}${isDraggingFiles ? ` ${styles.dragging}` : ''}`}
      data-mode={mode}
      onPaste={(event) => {
        if (isRealPersonVariant) return
        const files = Array.from(event.clipboardData?.items || [])
          .filter((item) => item.kind === 'file')
          .map((item) => item.getAsFile())
          .filter((file): file is File => !!file)
        if (!files.length) return
        event.preventDefault()
        void pickImages(files)
      }}
      onDragEnter={(event) => {
        if (isRealPersonVariant) return
        if (!Array.from(event.dataTransfer?.items || []).some((item) => item.kind === 'file')) return
        event.preventDefault()
        dragDepthRef.current += 1
        setIsDraggingFiles(true)
      }}
      onDragOver={(event) => {
        if (isRealPersonVariant) return
        if (!Array.from(event.dataTransfer?.items || []).some((item) => item.kind === 'file')) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={() => {
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
        if (!dragDepthRef.current) setIsDraggingFiles(false)
      }}
      onDrop={(event) => {
        if (isRealPersonVariant) return
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

      {isRealPersonVariant ? (
        <header className={styles.realPersonHero}>
          <h1 className={styles.title}>让真实人物，成为视频主角</h1>
          <p>使用已认证真人素材保持人物特征，完成脚本、镜头与成片的一站式创作。</p>
          <div className={styles.realPersonTrust} aria-label="真人成片能力">
            <span>身份已授权</span>
            <span>人物特征保留</span>
            <span>全流程可追踪</span>
          </div>
        </header>
      ) : (
        <h1 className={styles.title}>{mode === 'image' ? '想打造什么样的营销图片？' : '想打造什么样的爆款短视频？'}</h1>
      )}

      <div className={styles.panel}>
        {/* 右上角:与 Tab 同一行、右对齐卡片;点击初始化为全新空白页(等同切换路由再回来) */}
        {onNewVideo && (
          <button type="button" className={styles.newVideoBtn} onClick={() => onNewVideo(mode)}>
            {isRealPersonVariant ? '新建真人成片' : mode === 'image' ? '创建新对话' : '制作新视频'}
          </button>
        )}
        {/* Tab:制作视频 / 制作图片 */}
        {!isRealPersonVariant && (
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
        )}
        {isRealPersonVariant && (
          <div className={styles.realPersonPanelTitle}>
            <span className={styles.realPersonPanelIcon} aria-hidden="true">
              人
            </span>
            <div>
              <strong>真人成片工作台</strong>
              <small>先从已认证真人素材库选择出镜人物，未选择不能进入下一步</small>
            </div>
          </div>
        )}

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
              {/* 继续添加：真人变体只从真人库选，普通变体点开来源菜单（本地 / 素材库 / 真人） */}
              {images.length < referenceImageLimit && (
                <div className={styles.uploadWrap} ref={sourceMenuRef}>
                  <button
                    type="button"
                    className={styles.add}
                    onClick={() =>
                      isRealPersonVariant ? setRealPersonPickerOpen(true) : setSourceMenuOpen((open) => !open)
                    }
                    aria-label={isRealPersonVariant ? '继续添加真人素材' : '继续添加素材'}
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
                  {sourceMenu}
                </div>
              )}
              {/* 上限跟着所选模型变，必须一直显示当前用量，否则用户不知道还能传几张、
                  也不知道为什么上传按钮消失了。 */}
              <span className={styles.attachmentCount} aria-live="polite">
                {images.length}/{referenceImageLimit} 张参考图
              </span>
            </div>
          )}

          <div className={styles.cardBody}>
            {/* 无图时:左侧上传框(Figma 初始态);有图时上传入口在上方缩略图行 */}
            {images.length === 0 && (
              <div className={styles.uploadWrap} ref={sourceMenuRef}>
                <button
                  type="button"
                  className={styles.upload}
                  onClick={() =>
                    isRealPersonVariant ? setRealPersonPickerOpen(true) : setSourceMenuOpen((open) => !open)
                  }
                  aria-label={isRealPersonVariant ? '从真人素材库选择' : '添加素材'}
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
                {sourceMenu}
              </div>
            )}
            {!isRealPersonVariant && (
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
            )}
            {isRealPersonVariant && images.length === 0 && (
              <div className={styles.realPersonRequired}>
                <strong>选择已认证真人素材</strong>
                <span>必选项 · 未选择无法开始制作</span>
              </div>
            )}
            {/* 滚动只发生在 inputWrap 上；inputInner 不可滚，负责给 textarea 撑出整段文字的高度 */}
            <div className={styles.inputWrap}>
              <div className={styles.inputInner}>
                {/* 高亮层:渲染文本并把 @图片N 标绿;textarea 文字透明叠在其上 */}
                <div className={styles.inputHl} aria-hidden="true">
                  {renderHighlight(text)}
                </div>
                <textarea
                  ref={taRef}
                  className={styles.input}
                  aria-label="创作需求"
                  value={text}
                  placeholder={
                    isRealPersonVariant
                      ? '描述真人出镜的场景、动作、台词与产品信息。真人素材必须从认证素材库选择。'
                      : mode === 'image'
                        ? PLACEHOLDER_IMAGE
                        : PLACEHOLDER_VIDEO
                  }
                  onChange={(e) => {
                    setText(e.target.value)
                    caretRef.current = e.target.selectionStart ?? e.target.value.length
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
          </div>

          {/*
            模型不可用与参数不兼容的提示。原本长在模型弹窗内部，换成创作台样式的胶囊后
            那里没有落脚点；放在工具条上方常驻，比藏进一个要点开才看得见的面板更早被看到。
          */}
          {(modelError || modelSelectionConflicts.length > 0) && (
            <div className={styles.capabilityNotice} role="status">
              {modelError ? (
                <>
                  {modelError}
                  {onReloadModels && (
                    <button type="button" className={styles.noticeAction} onClick={() => onReloadModels()}>
                      重新加载
                    </button>
                  )}
                </>
              ) : (
                modelSelectionConflicts[0]
              )}
            </div>
          )}

          <div className={styles.toolbar}>
            <div className={styles.tools}>
              {/*
                模型排在工具条最前：参数档位由所选模型的 schema 决定，先定模型才有档位可选。
                每个槽位一枚胶囊，与 AI 创作台同一套 UI。
                游客态也保留入口（置灰 + 点击引导登录），否则未登录时这一格直接消失，
                用户根本不知道创作前可以选模型。
              */}
              <CreativeModelSlots
                groups={visibleModelGroups}
                selected={generationModels}
                onChange={updateGenerationModel}
                loading={Boolean(modelLoading)}
                authRequired={authRequired}
                onAuthRequired={onAuthRequired}
              />
              {/*
                创作参数（比例 / 时长 / 分辨率 / 出图数量）收进一个弹窗，形式与「本次创作使用的模型」一致。
                此前它们在底栏各占一个 chip，与模型 chip 等距排开——「用什么生成」和「生成成什么样」
                是两层决策，平铺在一行读不出层次，chip 一多底栏也开始换行。
              */}
              <CreativeParamsDropdown
                value={creativeParamsValue}
                options={creativeParamsOptions}
                onChange={applyCreativeParams}
                /*
                  先选模型再选参数：比例/时长/分辨率的可选档位都由所选模型的 schema 决定，
                  没选模型时给出的只是兜底档位——用户可能选中一个该模型根本做不到的秒数，
                  然后在提交时才被告知不兼容。锁上入口即可避免这条弯路。
                */
                disabled={!modelSelectionComplete}
                disabledHint="请先选择本次创作使用的模型"
              />

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
              {mode === 'video' && !isRealPersonVariant && (
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
              {modelEstimate && (
                <span
                  className={`${styles.sendCost}${modelEstimate.canAfford ? '' : ` ${styles.sendCostShort}`}`}
                  aria-live="polite"
                >
                  {modelEstimate.loading
                    ? '预估中…'
                    : modelEstimate.failed
                      ? '预估失败'
                      : `约 ${modelEstimate.total} 积分${modelEstimate.canAfford ? '' : ' · 余额不足'}`}
                </span>
              )}
              <button
                type="button"
                className={`${styles.send} ${styles.sendPlain}`}
                data-guide={resumeMode ? 'smart-regen' : 'smart-next'}
                disabled={!canSubmit || submitting}
                onClick={() => void submit()}
                aria-label={submitting ? '正在准备创作' : '去制作'}
                title={
                  submitting
                    ? '正在准备创作'
                    : isRealPersonVariant && !hasRequiredRealPerson
                      ? '请先从真人素材库选择一张已认证真人图片'
                      : '去制作'
                }
              >
                <span className={styles.sendPlainText}>{submitting ? '准备中…' : '去制作'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
      <MaterialLibraryPicker
        modelValue={libraryOpen}
        workspaceId={Number(workspaceId || 0)}
        materials={libraryMaterials}
        tab={libraryTab}
        query={libraryQuery}
        isLoading={libraryLoading}
        onModelValueChange={setLibraryOpen}
        onTabChange={setLibraryTab}
        onQueryChange={setLibraryQuery}
        onConfirm={confirmLibraryImages}
      />
      <RealPersonMaterialPicker
        open={realPersonPickerOpen}
        workspaceId={workspaceId}
        onClose={() => setRealPersonPickerOpen(false)}
        onSelect={(url, reference) => {
          setMode('video')
          // 真人素材与普通素材平权:都作为参考图追加到同一份素材列表(三个数组按下标对齐,
          // removeImage 据此同步移除)。多人同框、真人配产品图都是常见广告场景,
          // 后端逐个 asset 查真人库、命中就换成可信资产 URI,并不限制只能有一个真人。
          if (images.length >= referenceImageLimit) {
            showToast(`当前模型最多支持 ${referenceImageLimit} 张参考图`, 'info')
            return
          }
          if (realPersonReferences.some((item) => Number(item?.localAssetId) === Number(reference.localAssetId))) {
            showToast('该真人素材已添加', 'info')
            return
          }
          setImages((prev) => [...prev, url])
          setImageAssetIds((prev) => [...prev, reference.localAssetId])
          setRealPersonReferences((prev) => [...prev, reference])
        }}
      />
    </div>
  )
}
