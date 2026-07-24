/**
 * HotCopyEntry — 爆款复制「入口/上传」步(三步流程的第 1 步)。
 * 标题 + 两 Tab(同款翻拍 / 精准复刻)+ 卡片(左:上传爆款视频 / 上传替换素材;右:文案输入)
 * + @ 引用替换素材 + 圆形发送。受控:点发送回调 onSubmit(payload),由编排器(HotCopyCreateView)进入「准备素材」。
 * 不含壳子(侧栏/顶栏)与出视频逻辑——那些在编排器里。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useToast } from '@/composables/useToast'
import { fileToDataUrl } from '@/utils/imageFile'
import { useCurrentUser, useWorkspaceId } from '@/stores/workspaceSession'
import { listAiTasks, extractAssetPageItems } from '@/api/business'
import { listAllAssets, listAllCreativeProjects } from '@/utils/businessPagination'
import { assetStreamUrl } from '@/utils/assetUrl'
import { createMaterialFromAsset } from '@/utils/materials'
import { resolveUserId } from '@/utils/creativeDraftMetadata'
import { filterAssetsByProjectAccess, getAccessibleProjectIds } from '@/utils/projectAssetAccess'
import { SMART_VIDEO_DURATIONS } from '@/utils/videoDurationValue'
import MaterialLibraryPicker from '@/components/material/MaterialLibraryPicker'
import HotCopyCaseModal, { type HotCopyCaseTab } from '@/components/hotcopy/HotCopyCaseModal/HotCopyCaseModal'
import EntryCanvasBg, { type BgLayerStops } from '@/components/smart/EntryCanvasBg'
import EntryDropdown from '@/components/smart/EntryDropdown'
import {
  GenerationModelDropdown,
  getGenerationModelSelectionConflicts,
  isGenerationModelSelectionComplete,
  type GenerationModelErrorState,
  type GenerationModelGroup,
  type GenerationModelLoadingState,
} from '@/components/smart/GenerationModelPicker'
import RatioIcon from '@/components/common/RatioIcon'
import videoIcon from '@/assets/icons/hotcopy-video.svg'
import materialIcon from '@/assets/icons/hotcopy-material.svg'
import helpIcon from '@/assets/icons/help-circle.svg'
import './HotCopyEntry.css'

/** 爆款复制入口当前选择的制作模式。 */
export type HotCopyTab = 'remake' | 'replica'

/** 爆款原视频尚未选择、来自本地或来自素材库的来源状态。 */
export type HotCopyVideoSource = '' | 'local' | 'library'

/** 一张替换主体素材的预览、原始文件和后端资产关联信息。 */
export interface HotCopyProduct {
  url: string
  /** 本地选择带 File(待上传);素材库选择无 File(已有 assetId) */
  file: File | null
  isVideo: boolean
  /** 素材库选中的替换素材已有 asset_id;本地上传的留空,出片前再上传 */
  assetId?: number
  /** 真正传给 video.replicate 的人脸/抠脸素材 asset_id;展示仍使用 url/assetId 对应的原图 */
  submitAssetId?: number
  /** 人脸预处理结果；no_face 表示已确认无人脸，可直接复用原图。 */
  faceCheckStatus?: 'blurred' | 'no_face'
  /** 上述检测结果对应的原图 asset_id；原图变化后必须重新检测。 */
  faceCheckedAssetId?: number
}
/** 从入口页提交给爆款复制编排器的完整输入快照。 */
export interface HotCopyEntryPayload {
  tab: HotCopyTab
  videoSource: HotCopyVideoSource
  videoFile: File | null
  libraryVideo: { assetId: number; src: string } | null
  videoFileName: string
  videoPreview: string
  products: HotCopyProduct[]
  text: string
  /** 用户选择的成片尺寸(画面比例)与时长(秒数带 s,如 15s) */
  ratio: string
  duration: string
  /** 本次爆款复制固定使用的 video.replicate 后端模型版本 ID。 */
  modelVersionId?: number
}

/** 每个制作模式独立保存的入口草稿，模式键由外层映射维护。 */
type HotCopyTabDraft = Omit<HotCopyEntryPayload, 'tab'>

// 成片尺寸/时长可选项 —— 与智能成片完全一致(同样的列表顺序与默认值 16:9 / 10s)。
const RATIO_OPTIONS = ['16:9', '9:16', '1:1', '4:3', '3:4']
/** 爆款复制同样支持从 1 秒到 15 秒逐秒选择。 */
const DURATION_OPTIONS = SMART_VIDEO_DURATIONS.map((seconds) => `${seconds}s`)

/** 入口页与父级编排器之间的提交、草稿同步及恢复协议。 */
interface HotCopyEntryProps {
  onSubmit: (payload: HotCopyEntryPayload) => void
  /**
   * 仅同步当前入口草稿而不发起生成；父级用它提前保存项目素材、提示词、比例和时长，
   * 确保用户点击“去制作”前刷新页面也能恢复输入。
   */
  onDraftChange?: (payload: HotCopyEntryPayload) => void
  /** 入口右上角「创建新视频」:清空当前输入,回到全新入口态 */
  onNewVideo?: () => void
  /** 外部正在发起生成(含点击后到 running 生效前的短窗口),用于禁用重复点击 */
  busy?: boolean
  /** 从第二步返回第一页时,可直接回到已生成/生成中的视频页而不重新发起生成 */
  canResume?: boolean
  /** 恢复到第二步:只切回流程,不重新提交生成 */
  onResume?: () => void
  /** 返回上一步时回填上次输入(数据存在编排器 state) */
  initial?: Partial<HotCopyEntryPayload>
  /** 比例下拉可选项:取自 replicate 模型 schema 的 ratio options(只放模型真支持的);缺省用默认列表 */
  ratioOptions?: string[]
  /** 爆款复制首页可选的 video.replicate 模型目录。 */
  modelGroups?: GenerationModelGroup[]
  modelLoading?: GenerationModelLoadingState
  modelError?: GenerationModelErrorState
  modelReady?: boolean
  onReloadModels?: () => void
  /** 登录且工作空间就绪后开启模型必选门禁；游客仍先走原有登录拦截。 */
  requireModelSelection?: boolean
}

/** 两种爆款复制模式的标题、说明与帮助提示。 */
const TABS = [
  {
    key: 'remake',
    title: '同款翻拍',
    sub: '拆解底层逻辑,创造爆款视频',
    tip: '保留原视频镜头节奏与爆点结构,把主体替换为你的产品。(案例示例待补充)',
  },
  {
    key: 'replica',
    title: '精准复刻',
    sub: '还原原作巅峰,复刻热门爆款',
    tip: '尽量 1:1 还原原视频画面与运镜,适合高度复用爆款模板。(案例示例待补充)',
  },
] as const

/** 单次生成最多允许的替换主体数量。 */
const MAX_PRODUCTS = 9

/** 本地文件名的图片格式兜底识别规则。 */
const IMAGE_FILE_RE = /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i

/** 本地文件名的视频格式兜底识别规则。 */
const VIDEO_FILE_RE = /\.(mp4|mov|avi|mkv|webm|m4v)$/i

/** 同时根据 MIME 与扩展名判断图片，兼容浏览器未填 type 的文件。 */
const isImageFile = (file: File) => file.type.startsWith('image/') || IMAGE_FILE_RE.test(file.name)

/** 同时根据 MIME 与扩展名判断视频，兼容浏览器未填 type 的文件。 */
const isVideoFile = (file: File) => file.type.startsWith('video/') || VIDEO_FILE_RE.test(file.name)

/** 从后端多种兼容字段中选出第一个有效正整数资产 ID。 */
const pickAssetId = (...values: any[]): number => {
  for (const value of values) {
    const id = Number(value)
    if (Number.isFinite(id) && id > 0) return Math.floor(id)
  }
  return 0
}

/** 递归收集任务、资产响应中可能嵌套的资产 ID。 */
const collectAssetIds = (value: any): number[] => {
  if (!value) return []
  if (Array.isArray(value)) return value.flatMap(collectAssetIds)
  if (typeof value === 'object') {
    const direct = pickAssetId(value.asset_id, value.assetId, value.id)
    const nested = collectAssetIds(value.asset || value.data || value.output || value.outputs || value.input_assets)
    return direct ? [direct, ...nested] : nested
  }
  const id = pickAssetId(value)
  return id ? [id] : []
}

/** 根据操作码和元数据语义判断资产是否为人脸检测/抠图派生结果。 */
const isFaceCutAsset = (asset: any): boolean => {
  let metaHints = ''
  try {
    metaHints = JSON.stringify(asset?.meta_json || asset?.metadata || asset?.meta || {})
  } catch {
    metaHints = ''
  }
  const hints = [
    asset?.operation_code,
    asset?.operationCode,
    asset?.prompt,
    asset?.name,
    asset?.file_name,
    asset?.description,
    asset?.category,
    asset?.kind,
    ...(Array.isArray(asset?.tags) ? asset.tags : []),
    asset?.meta_json?.operation_code,
    asset?.meta_json?.operationCode,
    asset?.meta_json?.prompt,
    asset?.meta_json?.name,
    asset?.meta_json?.file_name,
    asset?.meta_json?.description,
    asset?.meta_json?.category,
    asset?.meta_json?.kind,
    metaHints,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  const faceCue = /face[_\s-]?detect|人脸检测|人脸检测抠图|人脸脱敏|脱敏/.test(hints)
  const cutoutCue = /抠图|抠脸|cutout|matting|segment(?:ation)?|mask|alpha[_\s-]?matte/.test(hints)
  const portraitCue = /人脸|脸部|头像|人像|人物|portrait|person|face|head/.test(hints)
  const replicateMaskCue = /(replicate|subject)[\w\s-]*mask(?:ed)?|mask(?:ed)?[\w\s-]*(replicate|subject)/.test(hints)
  return faceCue || replicateMaskCue || (cutoutCue && portraitCue)
}

/** 从派生人脸资产中反查原始上传素材 ID。 */
const resolveSourceAssetId = (asset: any): number =>
  pickAssetId(
    asset?.source_asset_id,
    asset?.sourceAssetId,
    asset?.origin_asset_id,
    asset?.originAssetId,
    asset?.original_asset_id,
    asset?.originalAssetId,
    asset?.parent_asset_id,
    asset?.parentAssetId,
    asset?.input_asset_id,
    asset?.inputAssetId,
    asset?.from_asset_id,
    asset?.fromAssetId,
    asset?.base_asset_id,
    asset?.baseAssetId,
    asset?.meta_json?.source_asset_id,
    asset?.meta_json?.sourceAssetId,
    asset?.meta_json?.origin_asset_id,
    asset?.meta_json?.originAssetId,
    asset?.meta_json?.original_asset_id,
    asset?.meta_json?.originalAssetId,
    asset?.meta_json?.parent_asset_id,
    asset?.meta_json?.parentAssetId,
    asset?.meta_json?.input_asset_id,
    asset?.meta_json?.inputAssetId,
    asset?.meta_json?.from_asset_id,
    asset?.meta_json?.fromAssetId,
    asset?.meta_json?.base_asset_id,
    asset?.meta_json?.baseAssetId,
  )

/** 解析真正提交给复刻模型的人脸或抠图结果资产 ID。 */
const resolveFaceSubmitAssetId = (asset: any): number =>
  pickAssetId(
    asset?.face_asset_id,
    asset?.faceAssetId,
    asset?.face_asset?.id,
    asset?.faceAsset?.id,
    asset?.cutout_asset_id,
    asset?.cutoutAssetId,
    asset?.cutout_asset?.id,
    asset?.cutoutAsset?.id,
    asset?.masked_asset_id,
    asset?.maskedAssetId,
    asset?.mask_asset_id,
    asset?.maskAssetId,
    asset?.output_asset_id,
    asset?.outputAssetId,
    asset?.derived_asset_id,
    asset?.derivedAssetId,
    asset?.meta_json?.face_asset_id,
    asset?.meta_json?.faceAssetId,
    asset?.meta_json?.cutout_asset_id,
    asset?.meta_json?.cutoutAssetId,
    asset?.meta_json?.masked_asset_id,
    asset?.meta_json?.maskedAssetId,
    asset?.meta_json?.mask_asset_id,
    asset?.meta_json?.maskAssetId,
    asset?.meta_json?.output_asset_id,
    asset?.meta_json?.outputAssetId,
    asset?.meta_json?.derived_asset_id,
    asset?.meta_json?.derivedAssetId,
  )

/** 读取人脸预处理任务的首个输入资产。 */
const resolveTaskSourceAssetId = (task: any): number =>
  collectAssetIds(
    task?.input_assets || task?.inputAssets || task?.inputs || task?.input || task?.request?.input_assets,
  )[0] || 0

/** 读取人脸预处理任务的首个输出资产。 */
const resolveTaskOutputAssetId = (task: any): number =>
  collectAssetIds(task?.outputs || task?.output || task?.result?.outputs || task?.data?.outputs)[0] || 0

// 爆款复制背景配色(粉紫,取自本页 Figma):底部粉 + 紫色光晕 + 淡粉核
const HOTCOPY_LAYERS: BgLayerStops = {
  bottom: [
    [0, 'rgba(217,131,237,0)'],
    [0.38, 'rgba(217,131,237,0.12)'], // 紫
    [0.72, 'rgba(255,178,208,0.14)'], // 过渡粉
    [1, 'rgba(255,178,208,0.3)'], // 底部粉
  ],
  halo: [
    [0, 'rgba(217,131,237,0.08)'], // 紫核
    [0.45, 'rgba(190,108,233,0.12)'], // 紫
    [0.78, 'rgba(170,85,227,0.12)'], // 紫环
    [1, 'rgba(170,85,227,0)'],
  ],
  core: [
    [0, 'rgba(255,178,208,0.16)'], // 淡粉
    [1, 'rgba(255,178,208,0)'],
  ],
}

/** 管理两个制作模式的独立草稿、素材来源选择、@ 引用和最终提交校验。 */
export default function HotCopyEntry({
  onSubmit,
  onDraftChange,
  onNewVideo,
  busy = false,
  canResume,
  onResume,
  initial,
  ratioOptions,
  modelGroups = [],
  modelLoading = false,
  modelError = null,
  modelReady = false,
  onReloadModels,
  requireModelSelection = false,
}: HotCopyEntryProps) {
  // 比例下拉:优先用模型实际支持的 options(避免选了模型做不了的比例被悄悄回退);缺省用默认列表。
  const ratioOpts = ratioOptions && ratioOptions.length ? ratioOptions : RATIO_OPTIONS
  const defaultRatio = ratioOpts.includes('16:9') ? '16:9' : ratioOpts[0] || '16:9'
  const { showToast } = useToast()
  const workspaceId = useWorkspaceId()
  const currentUser = useCurrentUser()
  const currentUserId = resolveUserId(currentUser)
  const initialTab = (initial?.tab as HotCopyTab) ?? 'remake'
  const blankTabDraft = (): HotCopyTabDraft => ({
    videoSource: '',
    videoFile: null,
    libraryVideo: null,
    videoFileName: '',
    videoPreview: '',
    products: [],
    text: '',
    ratio: defaultRatio,
    duration: '10s',
    modelVersionId: undefined,
  })
  const initialTabDraft = (): HotCopyTabDraft => ({
    ...blankTabDraft(),
    videoSource: initial?.videoSource ?? '',
    videoFile: initial?.videoFile ?? null,
    libraryVideo: initial?.libraryVideo ?? null,
    videoFileName: initial?.videoFileName ?? '',
    videoPreview: initial?.videoPreview ?? '',
    products: initial?.products ?? [],
    text: initial?.text ?? '',
    ratio: initial?.ratio ?? defaultRatio,
    duration: initial?.duration ?? '10s',
    modelVersionId: initial?.modelVersionId,
  })
  const tabDraftsRef = useRef<Record<HotCopyTab, HotCopyTabDraft>>({
    remake: initialTab === 'remake' ? initialTabDraft() : blankTabDraft(),
    replica: initialTab === 'replica' ? initialTabDraft() : blankTabDraft(),
  })
  const [tab, setTab] = useState<HotCopyTab>(initialTab)
  // 点击 Tab 旁的「?」打开对应案例弹窗(Figma 还原);null=关闭
  const [caseTab, setCaseTab] = useState<HotCopyCaseTab | null>(null)
  // 切换 Tab:背景的位移/上升动画由 <EntryCanvasBg mode={tab}> 监听 tab 变化驱动
  const switchTab = (k: HotCopyTab) => {
    if (k === tab) return
    tabDraftsRef.current[tab] = {
      videoSource,
      videoFile,
      libraryVideo,
      videoFileName,
      videoPreview,
      products,
      text,
      ratio,
      duration,
      modelVersionId: modelVersionId || undefined,
    }
    const next = tabDraftsRef.current[k] || blankTabDraft()
    setVideoSource(next.videoSource)
    setVideoFile(next.videoFile)
    setLibraryVideo(next.libraryVideo)
    setVideoFileName(next.videoFileName)
    setVideoPreview(next.videoPreview)
    setProducts(next.products)
    setText(next.text)
    setRatio(next.ratio)
    setDuration(next.duration)
    setModelVersionId(next.modelVersionId)
    caretRef.current = next.text.length
    setVideoMenuOpen(false)
    setProductMenuOpen(false)
    setLibraryOpen(false)
    setProductLibOpen(false)
    setAtOpen(false)
    setTab(k)
  }

  // 爆款视频来源(本地 / 素材库,二选一)
  const [videoMenuOpen, setVideoMenuOpen] = useState(false)
  const [videoSource, setVideoSource] = useState<HotCopyVideoSource>(tabDraftsRef.current[initialTab].videoSource)
  const [videoFile, setVideoFile] = useState<File | null>(tabDraftsRef.current[initialTab].videoFile)
  const [videoFileName, setVideoFileName] = useState(tabDraftsRef.current[initialTab].videoFileName)
  const [videoPreview, setVideoPreview] = useState(tabDraftsRef.current[initialTab].videoPreview)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [libraryMaterials, setLibraryMaterials] = useState<any[]>([])
  const [libraryMaterialsScope, setLibraryMaterialsScope] = useState('')
  const [libraryLoading, setLibraryLoading] = useState(false)
  const [libraryTab, setLibraryTab] = useState('mine')
  const [libraryQuery, setLibraryQuery] = useState('')
  const [libraryVideo, setLibraryVideo] = useState<{ assetId: number; src: string } | null>(
    tabDraftsRef.current[initialTab].libraryVideo,
  )
  const videoFileRef = useRef<HTMLInputElement | null>(null)
  const videoMenuRef = useRef<HTMLDivElement | null>(null)
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)
  const dragDepthRef = useRef(0)

  // 替换素材(仅图片):本地上传保留 File 待上传;素材库选择带 assetId
  const [products, setProducts] = useState<HotCopyProduct[]>(tabDraftsRef.current[initialTab].products)
  const productFileRef = useRef<HTMLInputElement | null>(null)
  // 替换素材来源菜单(本地 / 素材库)+ 素材库选图弹窗
  const [productMenuOpen, setProductMenuOpen] = useState(false)
  const productMenuRef = useRef<HTMLDivElement | null>(null)
  const [productLibOpen, setProductLibOpen] = useState(false)
  const [productLibMaterials, setProductLibMaterials] = useState<any[]>([])
  const [productLibMaterialsScope, setProductLibMaterialsScope] = useState('')
  const [productLibLoading, setProductLibLoading] = useState(false)
  const [productLibTab, setProductLibTab] = useState('mine')
  const [productLibQuery, setProductLibQuery] = useState('')
  const workspaceIdRef = useRef(Number(workspaceId || 0))
  workspaceIdRef.current = Number(workspaceId || 0)
  const currentUserIdRef = useRef(currentUserId)
  currentUserIdRef.current = currentUserId
  const currentMaterialScope = `${Number(workspaceId || 0)}:${currentUserId}`
  const scopedLibraryMaterials = libraryMaterialsScope === currentMaterialScope ? libraryMaterials : []
  const scopedProductLibMaterials = productLibMaterialsScope === currentMaterialScope ? productLibMaterials : []

  useEffect(() => {
    setLibraryMaterials([])
    setLibraryMaterialsScope('')
    setProductLibMaterials([])
    setProductLibMaterialsScope('')
    setLibraryLoading(false)
    setProductLibLoading(false)
    setLibraryOpen(false)
    setProductLibOpen(false)
  }, [workspaceId, currentUserId])

  const [text, setText] = useState(tabDraftsRef.current[initialTab].text)
  // 成片尺寸/时长(用户可选);默认与智能成片一致:16:9、10s
  const [ratio, setRatio] = useState(tabDraftsRef.current[initialTab].ratio)
  const [duration, setDuration] = useState(tabDraftsRef.current[initialTab].duration)
  const [modelVersionId, setModelVersionId] = useState<number | undefined>(
    tabDraftsRef.current[initialTab].modelVersionId,
  )
  const [modelAttentionRequest, setModelAttentionRequest] = useState(0)
  // 模型 options 到位后,若当前比例不在其中 → 收敛到第一个支持项(防止显示/提交一个模型做不了的比例)
  useEffect(() => {
    if (ratioOpts.length && !ratioOpts.includes(ratio)) setRatio(ratioOpts[0])
  }, [ratioOpts, ratio])
  // @ 引用替换素材(交互对齐智能成片;数据源是上传的替换素材 products)
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const hlRef = useRef<HTMLDivElement | null>(null)
  const caretRef = useRef(0) // 最近一次光标位置(点 @ 会失焦,需提前记下)
  const [atOpen, setAtOpen] = useState(false)

  useEffect(() => {
    if (!videoMenuOpen && !productMenuOpen) return
    const onDown = (e: PointerEvent) => {
      if (videoMenuRef.current && !videoMenuRef.current.contains(e.target as Node)) setVideoMenuOpen(false)
      if (productMenuRef.current && !productMenuRef.current.contains(e.target as Node)) setProductMenuOpen(false)
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [videoMenuOpen, productMenuOpen])

  // 加载素材库里的视频素材(复用现有 listAssets + 签名URL + material 映射)
  const loadLibraryVideos = async () => {
    const ws = Number(workspaceId || 0)
    const userId = currentUserId
    if (!ws) {
      showToast('未选择工作空间', 'error')
      return
    }
    if (!userId) {
      showToast('登录身份尚未就绪，请稍后重试', 'error')
      return
    }
    const isCurrentScope = () =>
      Number(workspaceIdRef.current || 0) === ws && Number(currentUserIdRef.current || 0) === userId
    setLibraryLoading(true)
    try {
      const [rawAssetItems, projectResult] = await Promise.all([
        listAllAssets({
          workspaceId: ws,
          type: 'video',
          isCurrent: isCurrentScope,
        }),
        listAllCreativeProjects({
          workspaceId: ws,
          isCurrent: isCurrentScope,
        })
          .then((items) => ({ loaded: true, items }))
          .catch(() => ({ loaded: false, items: [] as any[] })),
      ])
      if (!isCurrentScope()) return
      const accessibleProjectIds = getAccessibleProjectIds(projectResult.items, userId)
      const assets = filterAssetsByProjectAccess(rawAssetItems, accessibleProjectIds, projectResult.loaded).filter(
        (a: any) => a?.id && a.type === 'video',
      )
      const mats = assets.map((a: any) =>
        createMaterialFromAsset(
          a,
          assetStreamUrl(Number(a.id), ws) || a?.thumbnail_url || a?.preview_url || a?.cover_url || a?.url || '',
        ),
      )
      setLibraryMaterials(mats.filter((m: any) => m.src))
      setLibraryMaterialsScope(`${ws}:${userId}`)
    } catch (e: any) {
      if (isCurrentScope()) showToast(e?.message || '素材库加载失败', 'error')
    } finally {
      if (isCurrentScope()) setLibraryLoading(false)
    }
  }

  // 素材库确认选择:取选中的(第一个)视频作为爆款视频源
  const confirmLibraryVideo = (picked: any[]) => {
    const v =
      (picked || []).find((m: any) => /video/i.test(String(m?.type || m?.serverAsset?.type || ''))) || picked?.[0]
    if (!v) {
      setLibraryOpen(false)
      return
    }
    const assetId = Number(v?.assetId || v?.serverAsset?.id || v?.id || 0) || 0
    if (!assetId) {
      showToast('该素材无法识别,请换一个', 'error')
      return
    }
    setLibraryVideo({ assetId, src: v?.src || '' })
    setVideoSource('library')
    setVideoFile(null)
    setVideoFileName(v?.name || v?.serverAsset?.name || '素材库视频')
    setVideoPreview((prev) => {
      if (prev.startsWith('blob:')) URL.revokeObjectURL(prev)
      return v?.src || ''
    })
    setLibraryOpen(false)
  }

  const chooseSource = (src: 'local' | 'library') => {
    setVideoMenuOpen(false)
    if (src === 'local') {
      videoFileRef.current?.click()
    } else {
      setLibraryOpen(true)
      void loadLibraryVideos()
    }
  }

  // 加载素材库里的图片素材(替换素材只用图片)
  const loadLibraryImages = async () => {
    const ws = Number(workspaceId || 0)
    const userId = currentUserId
    if (!ws) {
      showToast('未选择工作空间', 'error')
      return
    }
    if (!userId) {
      showToast('登录身份尚未就绪，请稍后重试', 'error')
      return
    }
    const isCurrentScope = () =>
      Number(workspaceIdRef.current || 0) === ws && Number(currentUserIdRef.current || 0) === userId
    setProductLibLoading(true)
    try {
      const [allAssetItems, faceTaskPayload, projectResult] = await Promise.all([
        listAllAssets({
          workspaceId: ws,
          type: 'image',
          isCurrent: isCurrentScope,
        }),
        listAiTasks({ workspaceId: ws, operationCode: 'image.face_detect', limit: 100 }).catch(() => null),
        listAllCreativeProjects({
          workspaceId: ws,
          isCurrent: isCurrentScope,
        })
          .then((items) => ({ loaded: true, items }))
          .catch(() => ({ loaded: false, items: [] as any[] })),
      ])
      if (!isCurrentScope()) return
      const rawAssetItems = filterAssetsByProjectAccess(
        allAssetItems,
        getAccessibleProjectIds(projectResult.items, userId),
        projectResult.loaded,
      )
      const faceTaskIds = new Set<number>()
      const submitAssetBySource = new Map<number, number>()
      for (const task of extractAssetPageItems(faceTaskPayload)) {
        const taskId = pickAssetId(task?.id)
        if (taskId) faceTaskIds.add(taskId)
        const sourceId = resolveTaskSourceAssetId(task)
        const outputId = resolveTaskOutputAssetId(task)
        if (sourceId && outputId) submitAssetBySource.set(sourceId, outputId)
      }
      const rawAssets = rawAssetItems.filter((a: any) => a?.id && a.type === 'image')
      for (const asset of rawAssets) {
        const sourceId = resolveSourceAssetId(asset)
        const assetId = pickAssetId(asset?.id)
        const taskId = pickAssetId(asset?.task_id, asset?.taskId)
        if (sourceId && assetId && (isFaceCutAsset(asset) || (taskId && faceTaskIds.has(taskId)))) {
          submitAssetBySource.set(sourceId, assetId)
        }
      }
      const assets = rawAssets.filter((a: any) => {
        const taskId = pickAssetId(a?.task_id, a?.taskId)
        if (taskId && faceTaskIds.has(taskId)) return false
        return !isFaceCutAsset(a)
      })
      const mats = assets.map((a: any) => {
        const src = assetStreamUrl(Number(a.id), ws) || a?.thumbnail_url || a?.preview_url || a?.url || ''
        return {
          ...createMaterialFromAsset(a, src),
          submitAssetId:
            resolveFaceSubmitAssetId(a) || submitAssetBySource.get(pickAssetId(a?.id)) || pickAssetId(a?.id),
        }
      })
      setProductLibMaterials(mats.filter((m: any) => m.src))
      setProductLibMaterialsScope(`${ws}:${userId}`)
    } catch (e: any) {
      if (isCurrentScope()) showToast(e?.message || '素材库加载失败', 'error')
    } finally {
      if (isCurrentScope()) setProductLibLoading(false)
    }
  }

  // 替换素材来源:本地上传 / 素材库选图
  const chooseProductSource = (src: 'local' | 'library') => {
    setProductMenuOpen(false)
    if (src === 'local') {
      productFileRef.current?.click()
    } else {
      setProductLibOpen(true)
      void loadLibraryImages()
    }
  }

  // 素材库确认:把选中的图片素材(带 assetId)加入替换素材
  const confirmLibraryProducts = (picked: any[]) => {
    const room = MAX_PRODUCTS - products.length
    const imgs = (picked || [])
      .filter((m: any) => !/video/i.test(String(m?.type || m?.serverAsset?.type || '')))
      .slice(0, Math.max(0, room))
      .map((m: any) => {
        const displayAssetId = pickAssetId(m?.assetId, m?.serverAsset?.id, m?.id)
        const submitAssetId = pickAssetId(
          m?.submitAssetId,
          m?.serverAsset?.submitAssetId,
          resolveFaceSubmitAssetId(m?.serverAsset),
          displayAssetId,
        )
        return {
          url: m?.src || '',
          file: null as File | null,
          isVideo: false,
          assetId: displayAssetId,
          submitAssetId,
        }
      })
      .filter((p: HotCopyProduct) => p.url && (p.submitAssetId || p.assetId))
    if (imgs.length) setProducts((prev) => [...prev, ...imgs])
    if (room <= 0) showToast(`最多上传 ${MAX_PRODUCTS} 张替换素材`, 'info')
    setProductLibOpen(false)
  }

  // 本地视频预览使用对象 URL；替换视频时先释放旧 URL，避免频繁选择文件造成内存泄漏。
  const pickVideo = (files: FileList | File[] | null) => {
    const f = files?.[0]
    if (!f) return
    setVideoSource('local')
    setVideoFile(f)
    setVideoFileName(f.name)
    setVideoPreview((prev) => {
      if (prev.startsWith('blob:')) URL.revokeObjectURL(prev)
      return URL.createObjectURL(f)
    })
  }

  const clearVideo = () => {
    setVideoSource('')
    setVideoFile(null)
    setVideoFileName('')
    setVideoPreview((prev) => {
      if (prev.startsWith('blob:')) URL.revokeObjectURL(prev)
      return ''
    })
    setLibraryVideo(null)
  }

  // 替换素材本地上传:仅图片,缩放成 dataURL 预览,留 File 待出片前上传成 asset
  const pickProducts = async (files: FileList | File[] | null) => {
    if (!files?.length) return
    const room = MAX_PRODUCTS - products.length
    if (room <= 0) {
      showToast(`最多上传 ${MAX_PRODUCTS} 张替换素材`, 'info')
      return
    }
    const sel = Array.from(files).filter(isImageFile).slice(0, room)
    const picked = (
      await Promise.all(
        sel.map(async (f) => ({ url: (await fileToDataUrl(f).catch(() => '')) || '', file: f, isVideo: false })),
      )
    ).filter((p) => p.url)
    if (picked.length) setProducts((prev) => [...prev, ...picked])
  }

  const acceptLocalFiles = (files: File[]) => {
    const videos = files.filter(isVideoFile)
    const images = files.filter(isImageFile)
    if (!videos.length && !images.length) {
      showToast('爆款复制仅支持添加图片或视频素材', 'info')
      return
    }
    if (videos.length) pickVideo(videos)
    if (images.length) void pickProducts(images)
  }

  const removeProduct = (i: number) => setProducts((arr) => arr.filter((_, j) => j !== i))

  // ── @ 引用替换素材(对齐智能成片)──
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
  const handleAt = () => {
    const ta = taRef.current
    caretRef.current = ta ? (ta.selectionStart ?? text.length) : text.length
    if (products.length === 0) {
      insertAtCaret('@')
      return
    }
    setAtOpen(true)
  }
  // 某条替换素材的引用标签:图片→@图片N、视频→@视频N(各自按同类型顺序独立编号)
  const refLabel = (index: number) => {
    const p = products[index]
    const kind = p?.isVideo ? '视频' : '图片'
    const n = products.slice(0, index + 1).filter((q) => !!q.isVideo === !!p?.isVideo).length
    return `@${kind}${n}`
  }
  const pickRef = (index: number) => {
    insertAtCaret(`${refLabel(index)} `)
    setAtOpen(false)
  }
  // 高亮渲染:把「@图片N / @视频N」标绿,其余为普通文本(textarea 文字透明叠在此层上)
  const renderHighlight = (t: string): ReactNode[] | null => {
    if (!t) return null
    const out: ReactNode[] = []
    const re = /@(?:图片|视频)\d+/g
    let last = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(t))) {
      if (m.index > last) out.push(t.slice(last, m.index))
      out.push(
        <span className="hotcopy__refTag" key={m.index}>
          {m[0]}
        </span>,
      )
      last = m.index + m[0].length
    }
    out.push(t.slice(last))
    return out
  }

  const videoLabel =
    videoSource === 'local' ? videoFileName : videoSource === 'library' ? videoFileName || '素材库视频' : ''
  const hasHotVideo = (videoSource === 'local' && !!videoFile) || (videoSource === 'library' && !!libraryVideo)
  // 至少一张替换素材【图片】(products 里 isVideo=false 的)
  const hasProductImage = products.some((p) => !p.isVideo)
  // 齐全(视频 + 图片都有)才点亮发送图标;但按钮始终可点,缺哪个由 submit 弹提示
  const canSend = hasHotVideo && hasProductImage
  // 恢复态:从第二步回到第一页后,主按钮变「下一步」回到已生成内容;旁边提供「重新生成」。
  const resumeMode = !!canResume
  const modelSelection = { 'video.replicate': modelVersionId }
  const modelSelectionComplete = isGenerationModelSelectionComplete(modelGroups, modelSelection)
  const modelSelectionConflicts = getGenerationModelSelectionConflicts(modelGroups, modelSelection, {
    ratio,
    durationSec: Number.parseInt(duration, 10) || undefined,
    resolution: '720p',
    generateAudio: true,
    referenceImageCount: products.filter((product) => !product.isVideo).length,
  })
  const modelGatePassed =
    !requireModelSelection || (modelReady && modelSelectionComplete && modelSelectionConflicts.length === 0)
  const modelGateMessage = modelLoading
    ? '视频模型正在加载，请稍后再试'
    : typeof modelError === 'string' && modelError
      ? modelError
      : !modelReady
        ? '当前没有可用的视频生成模型，请重新加载'
        : !modelSelectionComplete
          ? '请先选择本次爆款复制使用的视频模型'
          : modelSelectionConflicts[0] || '当前参数与所选模型不兼容'
  // 用户点击生成后立即锁定本次模型选择；异步读取时长/估价期间也不能切换成另一模型。
  const modelsLocked = busy || (resumeMode && modelGatePassed)

  const buildPayload = (): HotCopyEntryPayload => ({
    tab,
    videoSource,
    videoFile,
    libraryVideo,
    videoFileName,
    videoPreview,
    products,
    text,
    ratio,
    duration,
    ...(modelVersionId ? { modelVersionId } : {}),
  })

  useEffect(() => {
    onDraftChange?.({
      tab,
      videoSource,
      videoFile,
      libraryVideo,
      videoFileName,
      videoPreview,
      products,
      text,
      ratio,
      duration,
      ...(modelVersionId ? { modelVersionId } : {}),
    })
  }, [
    duration,
    libraryVideo,
    modelVersionId,
    onDraftChange,
    products,
    ratio,
    tab,
    text,
    videoFile,
    videoFileName,
    videoPreview,
    videoSource,
  ])

  const requestModelSelectionAttention = () => {
    setModelAttentionRequest((value) => value + 1)
    showToast(modelGateMessage || '请先选择视频生成模型', 'info')
  }

  // 提交前同时要求原视频和至少一张替换图片，防止创建后端无法执行的空任务。
  const validateBeforeSubmit = () => {
    if (!hasHotVideo) {
      showToast('请先上传爆款视频(本地上传 / 素材库)', 'error')
      return false
    }
    if (!hasProductImage) {
      showToast('请至少上传一张替换素材图片', 'error')
      return false
    }
    if (!modelGatePassed) {
      requestModelSelectionAttention()
      return false
    }
    return true
  }

  const submit = () => {
    if (busy) return
    if (!validateBeforeSubmit()) return
    onSubmit(buildPayload())
  }
  const resume = () => {
    if (busy) return
    if (!modelGatePassed) {
      requestModelSelectionAttention()
      return
    }
    onResume?.()
  }

  return (
    <section
      className={`hotcopy__main${isDraggingFiles ? ' is-file-dragging' : ''}`}
      data-tab={tab}
      onPaste={(event) => {
        const files = Array.from(event.clipboardData?.items || [])
          .filter((item) => item.kind === 'file')
          .map((item) => item.getAsFile())
          .filter((file): file is File => !!file)
        if (!files.length) return
        event.preventDefault()
        acceptLocalFiles(files)
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
        acceptLocalFiles(Array.from(event.dataTransfer.files))
      }}
    >
      {/* 背景弥散:Canvas 实现(与智能成片同一套),配色用本页粉紫;切 Tab 时从底部上升 */}
      <div className="hotcopy__bg" aria-hidden="true">
        <EntryCanvasBg index={tab === 'replica' ? 1 : 0} count={2} anim="bloom" layers={HOTCOPY_LAYERS} />
      </div>

      <h1 className="hotcopy__title">爆款作业直接抄,你的产品当主角!</h1>

      <div className="hotcopy__panel">
        {onNewVideo && (
          <button
            type="button"
            className="hotcopy__newVideoBtn"
            disabled={busy}
            onClick={onNewVideo}
            title={busy ? '本次生成正在启动，请稍候' : '创建新视频'}
          >
            创建新视频
          </button>
        )}
        {/* 分段 Tab:同款翻拍 / 精准复刻(选中态白卡 + 名称 + ? + 副标题) */}
        <div className="hotcopy__tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`hotcopy__tab${tab === t.key ? ' is-active' : ''}`}
              onClick={() => switchTab(t.key)}
            >
              <span className="hotcopy__tab-head">
                <span className="hotcopy__tab-name">{t.title}</span>
                <img
                  className="hotcopy__tip"
                  src={helpIcon}
                  alt=""
                  title={`查看${t.title}案例`}
                  onClick={(e) => {
                    e.stopPropagation()
                    setCaseTab(t.key as HotCopyCaseTab)
                  }}
                />
              </span>
              <span className="hotcopy__tab-sub">{t.sub}</span>
            </button>
          ))}
        </div>

        {/* 主卡片:左 两个上传方块 + 右 文案输入;底部 @ + 圆形发送 */}
        <div className="hotcopy__card">
          <div className="hotcopy__body">
            <div className="hotcopy__tiles">
              {/* 上传爆款视频(必填,点选三来源) */}
              <div className="hotcopy__tilewrap" ref={videoMenuRef}>
                <button
                  type="button"
                  className={`hotcopy__tile${hasHotVideo ? ' is-done' : ''}`}
                  onClick={() => setVideoMenuOpen((v) => !v)}
                >
                  <img className="hotcopy__tile-icon" src={videoIcon} alt="" />
                  <span className="hotcopy__tile-label">上传爆款视频</span>
                  {hasHotVideo && <span className="hotcopy__tile-badge">✓</span>}
                </button>
                {videoMenuOpen && (
                  <div className="hotcopy__menu" onClick={(e) => e.stopPropagation()}>
                    <button type="button" onClick={() => chooseSource('local')}>
                      本地上传
                    </button>
                    <button type="button" onClick={() => chooseSource('library')}>
                      素材库
                    </button>
                  </div>
                )}
              </div>

              {/* 上传替换素材(仅图片,点选 本地 / 素材库) */}
              <div className="hotcopy__tilewrap" ref={productMenuRef}>
                <button
                  type="button"
                  className={`hotcopy__tile${products.length ? ' is-done' : ''}`}
                  onClick={() => setProductMenuOpen((v) => !v)}
                >
                  <img className="hotcopy__tile-icon" src={materialIcon} alt="" />
                  <span className="hotcopy__tile-label">上传替换素材</span>
                  {products.length > 0 && <span className="hotcopy__tile-badge">{products.length}</span>}
                </button>
                {productMenuOpen && (
                  <div className="hotcopy__menu" onClick={(e) => e.stopPropagation()}>
                    <button type="button" onClick={() => chooseProductSource('local')}>
                      本地上传
                    </button>
                    <button type="button" onClick={() => chooseProductSource('library')}>
                      素材库
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="hotcopy__inputWrap">
              {/* 高亮层:渲染文本并把 @图片N 标绿;textarea 文字透明叠在其上 */}
              <div className="hotcopy__inputHl" ref={hlRef} aria-hidden="true">
                {renderHighlight(text)}
              </div>
              <textarea
                ref={taRef}
                className="hotcopy__text"
                value={text}
                placeholder="最多上传9张图片,输入文字或@参考素材,生成精彩广告视频。例如:把 @图片1 中的产品放到 @图片2 中的场景里"
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
                  // Ctrl/Cmd+Enter 也走 submit:缺视频/图片会弹提示(校验在 submit 内)
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
                }}
              />
            </div>
          </div>

          {/* 已选爆款视频 / 替换素材缩略(有内容才显示) */}
          {(videoLabel || products.length > 0) && (
            <div className="hotcopy__selected">
              {/* 爆款视频:有预览(本地/素材库)用缩略图,否则用文字 chip */}
              {videoPreview ? (
                <div className="hotcopy__product hotcopy__product--hot" title={videoLabel}>
                  <video src={videoPreview} muted playsInline />
                  <span className="hotcopy__hotTag">爆款</span>
                  <button type="button" onClick={clearVideo} aria-label="移除">
                    ×
                  </button>
                </div>
              ) : (
                videoLabel && (
                  <span className="hotcopy__chip" title={videoLabel}>
                    🎬 {videoLabel}
                    <button type="button" onClick={clearVideo} aria-label="移除">
                      ×
                    </button>
                  </span>
                )
              )}
              {products.length > 0 && (
                <div className="hotcopy__products">
                  {products.map((p, i) => (
                    <div className="hotcopy__product" key={i}>
                      <img src={p.url} alt="" />
                      <button type="button" onClick={() => removeProduct(i)} aria-label="移除">
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 底部:尺寸/时长 + @ 参考素材(左) + 圆形发送(右) */}
          <div className="hotcopy__bottom">
            <div className="hotcopy__tools">
              {/* 成片尺寸(画面比例):选项取自 replicate 模型支持的比例 */}
              <EntryDropdown
                value={ratio}
                options={ratioOpts}
                onChange={setRatio}
                icon={<RatioIcon ratio={ratio} />}
                valueMinWidth={34}
              />
              {/* 成片时长 */}
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
              <GenerationModelDropdown
                groups={modelGroups}
                selected={modelSelection}
                placement="start"
                loading={modelLoading}
                error={modelError}
                locked={modelsLocked}
                conflicts={modelSelectionConflicts}
                attentionRequest={modelAttentionRequest}
                attentionMessage={modelGateMessage}
                onRetry={() => onReloadModels?.()}
                onChange={(_groupKey, nextModelId, subgroupKey) => {
                  if (subgroupKey !== 'video.replicate') return
                  const normalizedId = Number(nextModelId)
                  setModelVersionId(Number.isSafeInteger(normalizedId) && normalizedId > 0 ? normalizedId : undefined)
                }}
              />
              <span className="hotcopy__atAnchor">
                <button type="button" className="hotcopy__at" onClick={handleAt} title="引用替换素材">
                  @
                </button>
                {/* @ 素材选择:在 @ 按钮上方弹出,数据源是上传的替换素材 */}
                {atOpen && (
                  <>
                    <div className="hotcopy__atMask" onClick={() => setAtOpen(false)} />
                    <div className="hotcopy__atMenu">
                      <div className="hotcopy__atMenuTitle">选择替换素材</div>
                      <div className="hotcopy__atMenuGrid">
                        {products.map((p, i) => (
                          <button type="button" className="hotcopy__atItem" key={i} onClick={() => pickRef(i)}>
                            <img src={p.url} alt="" />
                            <span className="hotcopy__atItemName">{refLabel(i)}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </span>
            </div>
            <div className="hotcopy__sendArea">
              <button
                type="button"
                className={`hotcopy__send${resumeMode ? ' hotcopy__send--resume' : ' hotcopy__send--plain'}${!resumeMode && !canSend ? ' is-disabled' : ''}`}
                /* 恢复态下真正返回下一步;普通态仍走首次去制作。 */
                disabled={busy}
                onClick={() => (resumeMode ? resume() : submit())}
                aria-label={resumeMode ? '返回下一步' : '去制作'}
                title={busy ? '视频生成启动中…' : resumeMode ? '返回下一步' : '去制作'}
              >
                {resumeMode ? (
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
                ) : (
                  <span className="hotcopy__sendPlainText">去制作</span>
                )}
              </button>
              {resumeMode && (
                <button
                  type="button"
                  className="hotcopy__regen"
                  disabled={busy}
                  onClick={() => submit()}
                  title="去制作"
                >
                  去制作
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <input
        ref={videoFileRef}
        type="file"
        accept="video/*"
        hidden
        onChange={(e) => {
          pickVideo(e.target.files)
          e.target.value = ''
        }}
      />
      <input
        ref={productFileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          pickProducts(e.target.files)
          e.target.value = ''
        }}
      />

      {/* 素材库选择器(选爆款视频) */}
      <MaterialLibraryPicker
        modelValue={libraryOpen}
        onModelValueChange={setLibraryOpen}
        workspaceId={Number(workspaceId || 0)}
        projectName="爆款复刻"
        materials={scopedLibraryMaterials}
        tab={libraryTab}
        query={libraryQuery}
        isLoading={libraryLoading}
        onTabChange={setLibraryTab}
        onQueryChange={setLibraryQuery}
        onConfirm={confirmLibraryVideo}
      />

      {/* 素材库选择器(选替换素材图片,可多选) */}
      <MaterialLibraryPicker
        modelValue={productLibOpen}
        onModelValueChange={setProductLibOpen}
        workspaceId={Number(workspaceId || 0)}
        projectName="替换素材"
        materials={scopedProductLibMaterials}
        tab={productLibTab}
        query={productLibQuery}
        isLoading={productLibLoading}
        onTabChange={setProductLibTab}
        onQueryChange={setProductLibQuery}
        onConfirm={confirmLibraryProducts}
      />

      {/* 同款翻拍 / 精准复刻 案例弹窗(点 Tab 旁「?」打开) */}
      <HotCopyCaseModal tab={caseTab} onClose={() => setCaseTab(null)} />
    </section>
  )
}
