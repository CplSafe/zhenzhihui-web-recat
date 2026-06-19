/*
  CreativeScriptView — 创意脚本全流程主视图（项目最大页面）
  管理从 Prompt 输入到视频生成的完整链路：
    1. 输入描述 → 生成创意脚本（含分镜词 JSON）
    2. 分镜图生成（支持编辑/替换/插入/历史版本）
    3. 时间线编辑（分段旁白/字幕/音效）
    4. 视频生成与发布
  状态通过 composables 管理，草稿持久化到 localStorage 和后端。
*/
import './CreativeScriptView.css'
import '@/styles/creative.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import library1 from '@/assets/creative/library-1.png'
import library2 from '@/assets/creative/library-2.png'
import library3 from '@/assets/creative/library-3.png'
import library4 from '@/assets/creative/library-4.png'
import library5 from '@/assets/creative/library-5.png'
import AppLayout from '@/components/layout/AppLayout'
import AppToast from '@/components/AppToast'
import CreativeHeroTitle from '@/components/creative/CreativeHeroTitle'
import CreativeTopbar from '@/components/creative/CreativeTopbar'
import CreativeDraftHistoryDrawer from '@/components/creative/CreativeDraftHistoryDrawer'
import CreativeVersionHistoryDrawer from '@/components/creative/CreativeVersionHistoryDrawer'
import DraftSavedDialog from '@/components/creative/DraftSavedDialog'
import GeneratedScriptPanel from '@/components/creative/GeneratedScriptPanel'
import MaterialPreviewModal from '@/components/creative/MaterialPreviewModal'
import PromptComposer from '@/components/creative/PromptComposer'
import SelectedMaterials from '@/components/creative/SelectedMaterials'
import StoryboardEditDialog from '@/components/creative/StoryboardEditDialog'
import type { StoryboardEditMaterial } from '@/components/creative/StoryboardEditDialog'
import StoryboardGenerationPanel from '@/components/creative/StoryboardGenerationPanel'
import TimelineEditorPanel from '@/components/creative/TimelineEditorPanel'
import VideoGenerationPanel from '@/components/creative/VideoGenerationPanel'
import MaterialLibraryPicker from '@/components/material/MaterialLibraryPicker'
import {
  extractAssetPageItems,
  createAiResponse,
  downloadAssetFile,
  getAssetDownloadUrl,
  getBusinessErrorMessage,
  getCreativeProject,
  getCreativeProjectVersion,
  listCreativeProjects,
  listCreativeProjectVersions,
  createCreativeProjectVersion,
  deleteCreativeProject,
  deleteCreativeProjectVersion,
  deleteAsset,
  restoreCreativeProjectVersion,
  patchCreativeProject,
  updateCreativeProjectDraft,
  listAssets,
  streamAiResponse,
  uploadAssetFile,
} from '@/api/business'
import { createMaterialFromAsset, isSupportedMaterialFile, mergeMaterials } from '@/utils/materials'
import { isSafeMediaUrl } from '@/utils/urlSafety'
import {
  buildFallbackStoryboards,
  buildTimelineTracks,
  extractStoryboardPayload,
  getTimelineDuration,
} from '@/utils/creativeScript'
import { toPositiveInt } from '@/utils/common'
import { useTaskAbort } from '@/composables/useTaskAbort'
import { useVideoGeneration } from '@/composables/useVideoGeneration'
import { useStoryboardGeneration } from '@/composables/useStoryboardGeneration'
import { useScriptPrompts } from '@/composables/useScriptPrompts'
import { useWorkflowPersistence } from '@/composables/useWorkflowPersistence'
import {
  SEEDANCE_DURATION_OPTIONS,
  SEEDANCE_RATIO_OPTIONS,
  getModelParamOptions,
} from '@/utils/videoOptions'
import {
  canStartStoryboardGeneration,
  canStartTimelineGeneration,
  getStoryboardGenerationBlockReason,
  getTimelineGenerationBlockReason,
} from '@/utils/workflowGuards'
import { useMaterialLibraryStore } from '@/stores/materialLibrary'
import {
  useWorkspaceSessionStore,
  useWorkspaceId,
  useAllWorkspaces,
  useModelPlanCandidates,
  useCurrentConcurrencyLimit,
} from '@/stores/workspaceSession'
import { useUiStore } from '@/stores/ui'
import { useToast, useConfirmDialog } from '@/composables/useToast'
import { saveLastCreativeProjectId } from '@/utils/creativeStorage'

// 小工具：返回 [state, setState, ref]。ref.current 始终与最新 state 同步，
// 供在异步回调里同步读取最新值（对应原 Vue 里直接读取 ref.value 的行为）。
function useStateRef<T>(
  initial: T,
): [T, (v: T | ((prev: T) => T)) => void, React.MutableRefObject<T>] {
  const [state, setState] = useState<T>(initial)
  const ref = useRef<T>(state)
  ref.current = state
  const set = useCallback((v: T | ((prev: T) => T)) => {
    setState((prev) => {
      const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v
      ref.current = next
      return next
    })
  }, [])
  // composable（useScriptPrompts / useStoryboardGeneration / useVideoGeneration）按原 Vue 的
  // RefLike（{ value }）契约读写依赖；这里给 ref 附加 .value 桥：读取 live current，
  // 写入经 set 触发 re-render（并同步更新 current 以便同一 tick 内回读）。
  defineValueAlias(ref, set)
  return [state, set, ref]
}

// 给普通 useRef 附加只读 .value（= .current），兼容 composable 的 RefLike 读取契约。
function useValueAlias<T>(value: T): React.MutableRefObject<T> {
  const ref = useRef<T>(value)
  ref.current = value
  defineValueAlias(ref)
  return ref
}

// 在 ref 对象上挂 .value 访问器（幂等：ref 跨渲染稳定，只定义一次）。
function defineValueAlias<T>(ref: React.MutableRefObject<T>, set?: (v: T) => void) {
  if (Object.prototype.hasOwnProperty.call(ref, 'value')) return
  Object.defineProperty(ref, 'value', {
    configurable: true,
    get() {
      return ref.current
    },
    set(v: T) {
      ref.current = typeof v === 'function' ? (v as (p: T) => T)(ref.current) : v
      set?.(ref.current)
    },
  })
}

// 按视频总时长把各分镜 duration 等比缩放到合计为 totalSec，再交给 buildTimelineTracks。
// buildTimelineTracks 仅按各分镜 duration 顺序铺排时间线，故归一化在调用前完成。
function normalizeStoryboardDurations<T extends { duration?: number }>(
  storyboards: T[],
  totalSec: number,
): T[] {
  if (!Array.isArray(storyboards) || !storyboards.length) return storyboards
  const target = Number(totalSec)
  if (!Number.isFinite(target) || target <= 0) return storyboards
  const current = storyboards.reduce((sum, board) => {
    const d = Number(board?.duration)
    return sum + (Number.isFinite(d) && d > 0 ? d : 2)
  }, 0)
  if (current <= 0) return storyboards
  const scale = target / current
  return storyboards.map((board) => {
    const d = Number(board?.duration)
    const base = Number.isFinite(d) && d > 0 ? d : 2
    return { ...board, duration: Number((base * scale).toFixed(2)) }
  })
}

const DEFAULT_GENERATING_PROMPT = '结合提供的素材图片，我要做一个买菜APP的五一宣传视频'
const MAX_STORYBOARDS = 9
const MAX_SELECTED_MATERIALS = 4
const CREATIVE_DEBUG_KEY = '__creativeScriptDebug__'

interface CreativeScriptViewProps {
  // 原视图通过 props auth-session / emit('logout-success') 与 App 通信，
  // React 改用 useAuth()。logout 仍可由父级透传回调。
  onLogoutSuccess?: () => void
}

export default function CreativeScriptView(props: CreativeScriptViewProps): ReactNode {
  return <CreativeScriptViewBody onLogoutSuccess={props.onLogoutSuccess} />
}

function CreativeScriptViewBody(props: CreativeScriptViewProps): ReactNode {
  const navigate = useNavigate()
  const location = useLocation()
  const params = useParams()

  // ── 基础状态 ──
  const [description, setDescription, descriptionRef] = useStateRef('')
  const [generatedPrompt, setGeneratedPrompt, generatedPromptRef] = useStateRef('')
  const [generatedScript, setGeneratedScript, generatedScriptRef] = useStateRef('')
  const [generationPending, setGenerationPending] = useStateRef(false)
  const [isSubmittingScript, setIsSubmittingScript, isSubmittingScriptRef] = useStateRef(false)
  const [isScriptStreaming, setIsScriptStreaming] = useState(false)
  const [isUploadingSelected, setIsUploadingSelected, isUploadingSelectedRef] = useStateRef(false)
  const [isUploadingLibrary, setIsUploadingLibrary, isUploadingLibraryRef] = useStateRef(false)
  const [isLoadingLibrary, setIsLoadingLibrary, isLoadingLibraryRef] = useStateRef(false)
  const assetsLoadedRef = useRef(false)
  const [, forceAssetsLoaded] = useState(0)
  const setAssetsLoaded = (v: boolean) => {
    assetsLoadedRef.current = v
    forceAssetsLoaded((n) => n + 1)
  }
  const [isGenerating, setIsGenerating] = useStateRef(false)
  const [, setIsSavingDraft, isSavingDraftRef] = useStateRef(false)
  const [draftSavedDialogOpen, setDraftSavedDialogOpen] = useState(false)
  const isSavingVideoRef = useRef(false)
  const draftRevisionRef = useRef(0)
  const serverProjectTitleRef = useRef('')
  const [serverProjectTitle, setServerProjectTitleState] = useState('')
  const setServerProjectTitle = (v: string) => {
    serverProjectTitleRef.current = v
    setServerProjectTitleState(v)
  }
  const projectTitleSyncedRef = useRef(false)
  const projectTitleSyncTimerRef = useRef<ReturnType<typeof setTimeout> | 0>(0)
  const [versionDrawerOpen, setVersionDrawerOpen, versionDrawerOpenRef] = useStateRef(false)
  const [isLoadingVersions, setIsLoadingVersions, isLoadingVersionsRef] = useStateRef(false)
  const [isSavingVersion, setIsSavingVersion, isSavingVersionRef] = useStateRef(false)
  const [isDeletingVersion, setIsDeletingVersion, isDeletingVersionRef] = useStateRef(false)
  const [isRestoringVersion, setIsRestoringVersion, isRestoringVersionRef] = useStateRef(false)
  const [isLoadingVersionDetail, setIsLoadingVersionDetail] = useState(false)
  const [versionHistoryList, setVersionHistoryList] = useState<any[]>([])
  const [selectedVersionId, setSelectedVersionId, selectedVersionIdRef] = useStateRef(0)
  const [selectedVersionDetail, setSelectedVersionDetail] = useState<any>(null)
  const versionTargetProjectIdRef = useRef(0)
  const [versionTargetProjectId, setVersionTargetProjectIdState] = useState(0)
  const setVersionTargetProjectId = (v: number) => {
    versionTargetProjectIdRef.current = v
    setVersionTargetProjectIdState(v)
  }
  const versionTargetWorkspaceIdRef = useRef(0)
  const setVersionTargetWorkspaceId = (v: number) => {
    versionTargetWorkspaceIdRef.current = v
  }
  const [draftHistoryOpen, setDraftHistoryOpen] = useState(false)
  const [draftHistoryLoading, setDraftHistoryLoading, draftHistoryLoadingRef] = useStateRef(false)
  const [draftHistoryProjects, setDraftHistoryProjects] = useState<any[]>([])
  const [isDeletingDraftProject, setIsDeletingDraftProject, isDeletingDraftProjectRef] = useStateRef(false)
  const [currentStep, setCurrentStep, currentStepRef] = useStateRef('script')
  const [maxStepIndex, setMaxStepIndex, maxStepIndexRef] = useStateRef(0)
  const [previewMaterial, setPreviewMaterial, previewMaterialRef] = useStateRef<any>(null)
  const [activeMenu, setActiveMenu, activeMenuRef] = useStateRef('')
  const [selectedPlatform, setSelectedPlatform, selectedPlatformRef] = useStateRef('抖音')
  const [selectedDuration, setSelectedDuration, selectedDurationRef] = useStateRef('10s')
  const [selectedRatio, setSelectedRatio, selectedRatioRef] = useStateRef('9:16')
  const [selectedStyles, setSelectedStyles, selectedStylesRef] = useStateRef<string[]>(['叫卖型', '幽默', '商业'])
  const [customStyle, setCustomStyle, customStyleRef] = useStateRef('')
  const [libraryTab, setLibraryTab] = useState('mine')
  const [libraryQuery, setLibraryQuery] = useState('')
  const libraryContextRef = useRef('default')
  const [storyboardPreviewMaterials, setStoryboardPreviewMaterials, storyboardPreviewMaterialsRef] = useStateRef<any[]>([])
  const createdObjectUrlsRef = useRef<string[]>([])

  // ── 素材库 store ──
  const libraryOpen = useMaterialLibraryStore((s) => s.libraryOpen)
  const selectedMaterials = useMaterialLibraryStore((s) => s.selectedMaterials)
  const selectedMaterialIds = useMemo(() => selectedMaterials.map((m: any) => m.id), [selectedMaterials])
  const openLibraryAction = useMaterialLibraryStore((s) => s.openLibrary)
  const closeLibraryAction = useMaterialLibraryStore((s) => s.closeLibrary)
  const setSelectedMaterialsAction = useMaterialLibraryStore((s) => s.setSelectedMaterials)
  const addSelectedMaterialsAction = useMaterialLibraryStore((s) => s.addSelectedMaterials)
  const removeSelectedMaterialAction = useMaterialLibraryStore((s) => s.removeSelectedMaterial)
  // libraryOpen 在 store 中没有直接 setter，用 open/close 模拟 v-model:libraryOpen
  const setLibraryOpen = (v: boolean) => (v ? openLibraryAction() : closeLibraryAction())
  // 同步读取最新 selectedMaterials
  const selectedMaterialsRef = useValueAlias(selectedMaterials)

  // ── Task abort ──
  const { createTaskAbortController, releaseTaskAbortController, abortAllPendingTasks } = useTaskAbort()

  // ── 路由派生 ──
  const projectId = useMemo(() => {
    const raw = params?.id
    const id = Number(raw || 0)
    return Number.isFinite(id) && id > 0 ? Math.floor(id) : 0
  }, [params?.id])
  const projectIdRef = useRef(projectId)
  projectIdRef.current = projectId

  // creative-blank 路由：路径为 /creative/blank（无 id）
  const isBlankMode = useMemo(
    () => location.pathname.endsWith('/creative/blank') && !projectId,
    [location.pathname, projectId],
  )
  const isBlankModeRef = useRef(isBlankMode)
  isBlankModeRef.current = isBlankMode

  // ── 选项常量 ──
  const durations = useMemo(
    () =>
      SEEDANCE_DURATION_OPTIONS.filter((option: any) => {
        const seconds = Number.parseInt(String(option || ''), 10)
        return Number.isFinite(seconds) && seconds >= 4
      }),
    [],
  )
  const ratios = useMemo(() => [...SEEDANCE_RATIO_OPTIONS].slice().reverse(), [])
  const [styleOptions, setStyleOptions, styleOptionsRef] = useStateRef<string[]>([
    '叫卖型',
    '幽默',
    '商业',
    '真实口播',
    '高级感',
    '治愈',
  ])

  const [libraryMaterials, setLibraryMaterials, libraryMaterialsRef] = useStateRef<any[]>([
    { id: 'library-1', src: library1, name: '蔬菜主图' },
    { id: 'library-2', src: library2, name: '促销场景' },
    { id: 'library-3', src: library3, name: '人物素材' },
    { id: 'library-4', src: library4, name: '生鲜组合' },
    { id: 'library-5', src: library5, name: '海报素材' },
  ])

  const [creativeStoryboards, setCreativeStoryboards, creativeStoryboardsRef] = useStateRef<any[]>([])
  const [editingStoryboardId, setEditingStoryboardId, editingStoryboardIdRef] = useStateRef('')
  const [selectedStoryboardId, setSelectedStoryboardId, selectedStoryboardIdRef] = useStateRef('')
  // watch(selectedStoryboardId) → 清空预览素材
  useEffect(() => {
    setStoryboardPreviewMaterials([])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStoryboardId])

  const [timelineState, setTimelineState, timelineStateRef] = useStateRef<any>({
    segments: [],
    voiceover: [],
    subtitle: [],
    sfx: [],
  })
  const [, setTimelineAutoGenerated, timelineAutoGeneratedRef] = useStateRef(false)
  const [timelineReloading, setTimelineReloading, timelineReloadingRef] = useStateRef(false)
  const [timelineReloadReady, setTimelineReloadReady, timelineReloadReadyRef] = useStateRef(false)
  const timelineDirtyForVideoRef = useRef(false)

  // ── 标题派生 ──
  const projectTitle = useMemo(() => {
    const desc = (description || '').trim()
    if (!desc) return '当前创意项目'
    return desc.length > 24 ? desc.slice(0, 24) + '…' : desc
  }, [description])
  const projectTitleRef = useRef(projectTitle)
  projectTitleRef.current = projectTitle

  const displayProjectName = useMemo(() => {
    const serverTitle = String(serverProjectTitle || '').trim()
    if (serverTitle) return serverTitle
    const draftTitle = String(projectTitle || '').trim()
    if (draftTitle) return draftTitle
    return '未命名项目'
  }, [serverProjectTitle, projectTitle])

  // ── 工作空间 / 计费 状态（共享 store）──
  const workspaceId = useWorkspaceId()
  const workspaceIdRef = useValueAlias(workspaceId)
  const allWorkspaces = useAllWorkspaces()
  const allWorkspacesRef = useRef(allWorkspaces)
  allWorkspacesRef.current = allWorkspaces
  const modelPlanCandidates = useModelPlanCandidates()
  const modelPlanCandidatesRef = useValueAlias(modelPlanCandidates)
  const currentConcurrencyLimit = useCurrentConcurrencyLimit()
  const loadWorkspaces = useWorkspaceSessionStore((s) => s.loadWorkspaces)
  const switchWorkspace = useWorkspaceSessionStore((s) => s.switchWorkspace)
  const ensureModelPlanCandidatesLoadedAction = useWorkspaceSessionStore((s) => s.ensureModelPlanCandidatesLoaded)
  const ensureModelPlanCandidatesLoaded = useCallback(
    () => ensureModelPlanCandidatesLoadedAction(),
    [ensureModelPlanCandidatesLoadedAction],
  )

  // ── Toast / Confirm（全局 ui store）──
  const setDirty = useUiStore((s) => s.setDirty)
  const dirtyRef = useRef(false)
  const getDirty = () => useUiStore.getState().dirty
  const { showToast } = useToast()
  const { requestConfirm } = useConfirmDialog()
  // showToast 引用恒定，存入 ref 供回调使用
  const showToastRef = useRef(showToast)
  showToastRef.current = showToast

  // ── 布局样式（基于 AppLayout 设置的 CSS 变量）──
  const headerStyle = useMemo<React.CSSProperties>(() => ({ left: 'calc(var(--sidebar-width) + 320px)' } as any), [])
  const promptStyle = useMemo<React.CSSProperties>(
    () => ({ left: 'calc(var(--sidebar-width) + 300px)', width: 'calc(var(--content-width) - 600px)' } as any),
    [],
  )
  const selectedStyleBox = useMemo<React.CSSProperties>(
    () => ({ left: 'calc(var(--sidebar-width) + 300px)', width: 'calc(var(--content-width) - 600px)' } as any),
    [],
  )
  const storyboardStyle = useMemo<React.CSSProperties>(
    () => ({ left: 'var(--sidebar-width)', width: 'var(--content-width)' } as any),
    [],
  )
  const timelineStyle = useMemo<React.CSSProperties>(
    () => ({ left: 'var(--sidebar-width)', width: 'var(--content-width)' } as any),
    [],
  )
  const videoStyle = useMemo<React.CSSProperties>(
    () => ({ left: 'var(--sidebar-width)', width: 'var(--content-width)' } as any),
    [],
  )

  const selectedStyleText = useMemo(() => selectedStyles.join(' '), [selectedStyles])
  const selectedStyleTextRef = useRef(selectedStyleText)
  selectedStyleTextRef.current = selectedStyleText
  const compactPromptText = useMemo(
    () => generatedPrompt || description.trim() || DEFAULT_GENERATING_PROMPT,
    [generatedPrompt, description],
  )

  const storyboardOutline = useMemo(() => {
    const boards = creativeStoryboards
    if (!boards || !boards.length) return ''
    return boards.map((b: any, i: number) => `${b.title || `分镜${i + 1}`}`).join(' → ')
  }, [creativeStoryboards])

  const compactMaterialStack = useMemo(() => selectedMaterials.slice(0, 3), [selectedMaterials])
  const timelineTotalDuration = useMemo(
    () => getTimelineDuration(timelineState) || Number.parseInt(String(selectedDuration), 10) || 10,
    [timelineState, selectedDuration],
  )

  const filteredLibraryMaterials = useMemo(() => {
    const keyword = libraryQuery.trim().toLowerCase()
    if (!keyword) return libraryMaterials
    return libraryMaterials.filter((material: any) => material.name.toLowerCase().includes(keyword))
  }, [libraryQuery, libraryMaterials])

  const [storyboardEditHistory, setStoryboardEditHistory, storyboardEditHistoryRef] = useStateRef<Record<string, any[]>>({})
  const storyboardHistoryItems = useMemo(() => {
    const id = editingStoryboardId
    if (!id) return []
    const list = storyboardEditHistory?.[id]
    return Array.isArray(list) ? list.slice(0, 3) : []
  }, [editingStoryboardId, storyboardEditHistory])

  const storyboardSelectedHistoryItems = useMemo(() => {
    const id = selectedStoryboardId
    if (!id) return []
    const list = storyboardEditHistory?.[id]
    return Array.isArray(list) ? list.slice(0, 3) : []
  }, [selectedStoryboardId, storyboardEditHistory])

  const storyboardGenerationState = useMemo(
    () => ({ isSubmittingScript, generationPending, generatedScript }),
    [isSubmittingScript, generationPending, generatedScript],
  )
  const storyboardGenerationBlockReason = useMemo(
    () => getStoryboardGenerationBlockReason(storyboardGenerationState),
    [storyboardGenerationState],
  )
  const storyboardGenerationBlockReasonRef = useValueAlias(storyboardGenerationBlockReason)
  const canGenerateStoryboard = useMemo(
    () => canStartStoryboardGeneration(storyboardGenerationState),
    [storyboardGenerationState],
  )

  // ── Extracted script prompt builders / AI helpers ──
  const {
    buildCreativeScriptPrompt,
    buildStoryboardPrompt,
    buildStoryboardEditPrompt,
    buildStoryboardInsertIdeaPrompt,
    buildCreativeScriptInputAssets,
    buildSeedanceVideoPrompt,
    getVideoInputAssets,
    getCandidateVideoAssets,
    requestCreativeScriptWithFallback,
    parseStoryboardFromAiText,
    serializeStoryboardsForScript,
  } = useScriptPrompts({
    description: descriptionRef,
    generatedPrompt: generatedPromptRef,
    selectedDuration: selectedDurationRef,
    selectedRatio: selectedRatioRef,
    selectedStyles: selectedStylesRef,
    selectedMaterials: selectedMaterialsRef,
    creativeStoryboards: creativeStoryboardsRef,
    getStoryboardItems: () => storyboardItemsRef.current,
    timelineState: timelineStateRef,
    modelPlanCandidates: modelPlanCandidatesRef,
    getWorkspaceIdOrNotify,
    showToast,
  } as any)

  const {
    storyboardItems,
    storyboardTotal,
    storyboardProgressCount,
    storyboardGenerating,
    isModifyingStoryboardImage,
    startStoryboardGeneration,
    removeStoryboardItem: removeStoryboardItemAction,
    reorderStoryboardItems,
    modifyStoryboardImage,
    replaceStoryboardImage,
    setStoryboardImageVersion,
    stepStoryboardImageVersion,
    removeStoryboardImageVersion,
    insertStoryboardSlot,
    insertStoryboardImage,
    adoptRestoredStoryboardItems,
    cancelInFlightStoryboard,
    resetStoryboard,
    setStoryboardItems,
    setStoryboardGenerating,
  } = useStoryboardGeneration({
    selectedRatio: selectedRatioRef,
    selectedMaterials: selectedMaterialsRef,
    editReferenceMaterials: storyboardPreviewMaterialsRef,
    modelPlanCandidates: modelPlanCandidatesRef,
    concurrencyLimit: currentConcurrencyLimit,
    creativeStoryboards: creativeStoryboardsRef,
    buildBoardPrompt: buildStoryboardPrompt,
    buildEditPrompt: buildStoryboardEditPrompt,
    getWorkspaceIdOrNotify,
    ensureModelPlanCandidatesLoaded,
    showToast,
    setCurrentStep: (step: string) => {
      resumeWorkflowPersistence()
      setCurrentStep(step)
      setActiveMenu('')
      setLibraryOpen(false)
      setEditingStoryboardId('')
    },
    storyboardGenerationBlockReason: storyboardGenerationBlockReasonRef,
    createTaskAbortController,
    releaseTaskAbortController,
    abortAllPendingTasks,
  } as any) as any

  const storyboardItemsRef = useRef<any[]>(storyboardItems)
  storyboardItemsRef.current = storyboardItems
  const storyboardGeneratingRef = useRef<boolean>(storyboardGenerating)
  storyboardGeneratingRef.current = storyboardGenerating
  const isModifyingStoryboardImageRef = useRef<boolean>(isModifyingStoryboardImage)
  isModifyingStoryboardImageRef.current = isModifyingStoryboardImage
  const storyboardTotalRef = useRef<number>(storyboardTotal)
  storyboardTotalRef.current = storyboardTotal
  const storyboardProgressCountRef = useRef<number>(storyboardProgressCount)
  storyboardProgressCountRef.current = storyboardProgressCount

  const storyboardGeneratedCount = useMemo(
    () => Math.min(storyboardProgressCount, storyboardTotal),
    [storyboardProgressCount, storyboardTotal],
  )
  const nextStoryboardTitle = useMemo(() => {
    const index = storyboardGeneratedCount
    return (
      creativeStoryboards[index]?.title ||
      creativeStoryboards[creativeStoryboards.length - 1]?.title ||
      '下一张分镜'
    )
  }, [storyboardGeneratedCount, creativeStoryboards])
  const editingStoryboardItem = useMemo(
    () => storyboardItems.find((item: any) => item.id === editingStoryboardId) || null,
    [storyboardItems, editingStoryboardId],
  )
  const editingStoryboardIndex = useMemo(
    () => storyboardItems.findIndex((item: any) => item.id === editingStoryboardId),
    [storyboardItems, editingStoryboardId],
  )
  const timelineGenerationState = useMemo(
    () => ({ storyboardGenerating, storyboardItems, storyboardTotal }),
    [storyboardGenerating, storyboardItems, storyboardTotal],
  )
  const timelineGenerationBlockReason = useMemo(
    () => getTimelineGenerationBlockReason(timelineGenerationState),
    [timelineGenerationState],
  )
  const timelineGenerationBlockReasonRef = useRef(timelineGenerationBlockReason)
  timelineGenerationBlockReasonRef.current = timelineGenerationBlockReason
  const canGenerateTimeline = useMemo(
    () => canStartTimelineGeneration(timelineGenerationState),
    [timelineGenerationState],
  )

  const restoringWorkflowFromStorageRef = useRef(false)
  const storyboardRatioSyncTimerRef = useRef<ReturnType<typeof setTimeout> | 0>(0)
  const projectCoverDraftSyncTimerRef = useRef<ReturnType<typeof setTimeout> | 0>(0)
  const projectCoverDraftSyncInFlightRef = useRef(false)
  const lastProjectCoverDraftSyncKeyRef = useRef('')
  const versionDetailRequestTokenRef = useRef(0)

  // watch(selectedRatio): 比例切换后自动同步更新分镜图片
  const prevRatioRef = useRef(selectedRatio)
  useEffect(() => {
    const prevRatio = prevRatioRef.current
    prevRatioRef.current = selectedRatio
    if (restoringWorkflowFromStorageRef.current) return
    const prev = String(prevRatio || '').trim()
    const next = String(selectedRatio || '').trim()
    if (!prev || prev === next) return
    if (storyboardGeneratingRef.current || isModifyingStoryboardImageRef.current || isSubmittingScriptRef.current) return
    if (!storyboardItemsRef.current.length) return
    const hasGenerated = storyboardItemsRef.current.some((item: any) => String(item?.src || '').trim())
    if (!hasGenerated) return

    if (storyboardRatioSyncTimerRef.current) clearTimeout(storyboardRatioSyncTimerRef.current)
    storyboardRatioSyncTimerRef.current = setTimeout(() => {
      if (storyboardGeneratingRef.current || isModifyingStoryboardImageRef.current || isSubmittingScriptRef.current) return
      cancelInFlightStoryboard()
      showToastRef.current(`比例已切换为 ${next}，正在同步更新分镜图片`, 'success')
      startStoryboardGeneration({ keepStep: true, silent: true })
    }, 320)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRatio])

  useEffect(() => {
    return () => {
      if (storyboardRatioSyncTimerRef.current) clearTimeout(storyboardRatioSyncTimerRef.current)
    }
  }, [])

  function removeStoryboardItem(itemId: string) {
    removeStoryboardItemAction(itemId, {
      onAfterRemove: (id: string) => {
        if (previewMaterialRef.current?.id === id) closePreview()
        if (editingStoryboardIdRef.current === id) closeStoryboardEditor()
      },
    })
    // Force timeline re-sync so removed storyboard doesn't leave a ghost segment
    queueMicrotask(() => {
      syncTimelineFromStoryboards()
    })
  }

  function stepStoryboardVersionFromPanel(payload: any) {
    const itemId = payload?.itemId
    const delta = payload?.delta
    stepStoryboardImageVersion({ itemId, delta })
  }

  async function setStoryboardVersionFromPanel(payload: any) {
    const itemId = payload?.itemId
    const index = payload?.index

    // 切到历史版本前先刷新该版本的 S3 URL（15 分钟过期）
    const item = storyboardItemsRef.current.find((i: any) => i.id === itemId)
    const targetVersion = item?.versionHistory?.[index]
    const assetId = toPositiveInt(targetVersion?.assetId)
    if (assetId) {
      const wsId = workspaceIdRef.current
      try {
        const freshUrl = await getAssetDownloadUrl({ workspaceId: wsId, assetId })
        if (freshUrl) {
          const history = [...(item.versionHistory || [])]
          history[index] = { ...history[index], src: freshUrl }
          setStoryboardItems(
            storyboardItemsRef.current.map((i: any) =>
              i.id === itemId ? { ...i, versionHistory: history } : i,
            ),
          )
        }
      } catch {
        // 刷新失败就用旧 URL
      }
    }

    setStoryboardImageVersion({ itemId, index })
  }

  function removeStoryboardVersionFromPanel(payload: any) {
    const itemId = payload?.itemId
    const index = payload?.index
    removeStoryboardImageVersion({ itemId, index })
  }

  // ── 视频生成 composable ──
  const {
    generatedVideoUrl,
    generatedVideoTask,
    generatedVideoAssetId,
    videoHistoryList,
    activeVideoHistoryId,
    isVideoGenerating,
    videoProgress,
    generateVideo,
    regenerateVideo,
    modifyVideoWithPrompt,
    handleSelectVideoHistory,
    deleteVideoHistoryItem,
    refreshGeneratedVideoUrl,
    refreshAllHistoryUrls,
    handleVideoNotify,
    saveVideoDraft,
    publishVideo,
    resetVideo,
    videoCostEstimate,
    isEstimatingVideoCost,
    videoCostEstimateError,
    estimateVideoCost,
    setGeneratedVideoUrl,
    setGeneratedVideoTask,
    setGeneratedVideoAssetId,
    setVideoHistoryList,
  } = useVideoGeneration({
    workspaceId: workspaceIdRef,
    selectedDuration: selectedDurationRef,
    selectedRatio: selectedRatioRef,
    modelPlanCandidates: modelPlanCandidatesRef,
    timelineDuration: () => getTimelineDuration(timelineStateRef.current),
    buildPrompt: buildSeedanceVideoPrompt,
    buildInputAssets: getVideoInputAssets,
    getAllCandidateAssets: getCandidateVideoAssets,
    getSupportedDurationOptions,
    formatDurationOptions,
    getWorkspaceIdOrNotify,
    ensureModelPlanCandidatesLoaded,
    showToast,
    setCurrentStep: (step: string) => {
      resumeWorkflowPersistence()
      setCurrentStep(step)
    },
    createTaskAbortController,
    releaseTaskAbortController,
    abortAllPendingTasks,
    // 视频生成成功后自动保存到项目管理
    onGenerated: () => handleSaveVideo({ auto: true }),
  } as any) as any

  const generatedVideoUrlRef = useRef(generatedVideoUrl)
  generatedVideoUrlRef.current = generatedVideoUrl
  const generatedVideoAssetIdRef = useRef(generatedVideoAssetId)
  generatedVideoAssetIdRef.current = generatedVideoAssetId
  const isVideoGeneratingRef = useRef(isVideoGenerating)
  isVideoGeneratingRef.current = isVideoGenerating

  // watch(currentStep) → 进入 timeline 时静默估算视频成本
  useEffect(() => {
    if (currentStep === 'timeline') estimateVideoCost({ silent: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep])

  // ── 全局指针：点击空白处关闭菜单 ──
  const handleGlobalPointerDown = useCallback((event: any) => {
    if (!activeMenuRef.current) return
    const target = event?.target
    if (!target || typeof target.closest !== 'function') {
      setActiveMenu('')
      return
    }
    if (
      target.closest('.control-menu') ||
      target.closest('.control-item') ||
      target.closest('.compact-control') ||
      target.closest('.compact-control-strip')
    ) {
      return
    }
    setActiveMenu('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function toggleMenu(name: string) {
    setActiveMenu(activeMenuRef.current === name ? '' : name)
  }

  function selectOption(kind: string, value: string) {
    if (kind === 'platform') setSelectedPlatform(value)
    if (kind === 'duration') setSelectedDuration(value)
    if (kind === 'ratio') setSelectedRatio(value)
    setActiveMenu('')
  }

  function toggleStyle(style: string) {
    const list = selectedStylesRef.current
    const exists = list.includes(style)
    if (exists && list.length > 1) {
      setSelectedStyles(list.filter((item) => item !== style))
      return
    }
    if (!exists) {
      setSelectedStyles([...list, style])
    }
  }

  function addCustomStyle() {
    const style = customStyleRef.current.trim()
    if (!style) return
    if (!styleOptionsRef.current.includes(style)) {
      setStyleOptions([...styleOptionsRef.current, style])
    }
    if (!selectedStylesRef.current.includes(style)) {
      setSelectedStyles([...selectedStylesRef.current, style])
    }
    setCustomStyle('')
  }

  function getWorkspaceIdOrNotify(): number {
    if (workspaceIdRef.current > 0) {
      return workspaceIdRef.current
    }
    showToastRef.current('当前登录空间不可用，请刷新后重试', 'error')
    return 0
  }

  function normalizeProjectTitle(payload: any): string {
    const candidates = [payload?.title, payload?.name, payload?.project_name, payload?.projectName]
    const picked = candidates.find((value) => typeof value === 'string' && value.trim())
    return String(picked || '').trim()
  }

  function isUnnamedProjectTitle(title: any): boolean {
    const t = String(title || '').trim()
    if (!t) return true
    return t.includes('未命名')
  }

  function deriveProjectTitleFromDescription(text: any): string {
    const raw = String(text || '').trim()
    if (!raw) return ''
    const firstLine =
      raw
        .split('\n')
        .map((s) => s.trim())
        .find(Boolean) || ''
    if (!firstLine) return ''
    return firstLine.length > 32 ? firstLine.slice(0, 32) : firstLine
  }

  async function syncProjectTitleByDescription(text: any) {
    if (projectTitleSyncedRef.current) return
    if (isBlankModeRef.current) return
    if (!projectIdRef.current) return

    const title = deriveProjectTitleFromDescription(text)
    if (!title) return
    if (!isUnnamedProjectTitle(serverProjectTitleRef.current)) {
      projectTitleSyncedRef.current = true
      return
    }

    const wsId = await resolveProjectWorkspaceId({ silent: true })
    if (!wsId) return

    try {
      const payload = await patchCreativeProject({ projectId: projectIdRef.current, workspaceId: wsId, title })
      setServerProjectTitle(normalizeProjectTitle(payload) || title)
      projectTitleSyncedRef.current = true
    } catch {
      projectTitleSyncedRef.current = true
    }
  }

  async function resolveProjectWorkspaceId({ silent = false }: { silent?: boolean } = {}): Promise<number> {
    if (!projectIdRef.current) {
      return workspaceIdRef.current
    }

    let workspaceList = Array.isArray(allWorkspacesRef.current) ? allWorkspacesRef.current : []
    let ids = workspaceList.map((w: any) => Number(w?.id || 0)).filter((id: number) => id > 0)
    ids = [...new Set(ids)]

    if (!ids.length && typeof loadWorkspaces === 'function') {
      await loadWorkspaces()
      workspaceList = Array.isArray(allWorkspacesRef.current) ? allWorkspacesRef.current : []
      ids = [...new Set(workspaceList.map((w: any) => Number(w?.id || 0)).filter((id: number) => id > 0))]
    }

    const current = Number(workspaceIdRef.current || 0)
    const ordered = current > 0 ? [current, ...ids.filter((id: number) => id !== current)] : ids

    for (const id of ordered) {
      try {
        await getCreativeProject({ projectId: projectIdRef.current, workspaceId: id })
        if (id && id !== current) {
          switchWorkspace(id)
          await Promise.resolve()
        }
        return id
      } catch {
        continue
      }
    }

    if (!silent) showToastRef.current('未找到该项目所属团队，请从历史草稿入口进入', 'error')
    return 0
  }

  async function resolveWorkspaceIdForProject(
    targetProjectId: any,
    { silent = false, preferredWorkspaceId = 0 }: { silent?: boolean; preferredWorkspaceId?: number } = {},
  ): Promise<number> {
    const pid = Number(targetProjectId || 0)
    if (!pid) return 0
    const preferred = Number(preferredWorkspaceId || 0)
    if (preferred > 0) return preferred

    if (projectIdRef.current && pid === projectIdRef.current) {
      return resolveProjectWorkspaceId({ silent })
    }

    let workspaceList = Array.isArray(allWorkspacesRef.current) ? allWorkspacesRef.current : []
    let ids = workspaceList.map((w: any) => Number(w?.id || 0)).filter((id: number) => id > 0)
    ids = [...new Set(ids)]

    if (!ids.length && typeof loadWorkspaces === 'function') {
      await loadWorkspaces()
      workspaceList = Array.isArray(allWorkspacesRef.current) ? allWorkspacesRef.current : []
      ids = [...new Set(workspaceList.map((w: any) => Number(w?.id || 0)).filter((id: number) => id > 0))]
    }

    for (const id of ids) {
      try {
        await getCreativeProject({ projectId: pid, workspaceId: id })
        return id
      } catch {
        continue
      }
    }

    if (!silent) showToastRef.current('未找到该项目所属团队，请从历史草稿入口进入', 'error')
    return 0
  }

  function getSupportedDurationOptions(model: any): number[] {
    return getModelParamOptions(model, 'duration')
      .map((option: any) => Number.parseInt(String(option), 10))
      .filter((option: number) => Number.isFinite(option))
  }

  function formatDurationOptions(options: number[]): string {
    return options.map((option) => `${option}s`).join('、')
  }

  function applyParsedStoryboards(scriptText: string) {
    const { storyboards, jsonText } = extractStoryboardPayload(scriptText)
    if (storyboards.length) {
      setCreativeStoryboards(storyboards.slice(0, MAX_STORYBOARDS))
      return
    }
    if (import.meta.env.DEV) {
      console.warn('[storyboard parse failed]', {
        scriptLen: scriptText?.length || 0,
        jsonTextLen: jsonText?.length || 0,
      })
    }
  }

  function handleStoryboardsParsed(items: any[]) {
    if (!Array.isArray(items) || !items.length) return
    setCreativeStoryboards(items.slice(0, MAX_STORYBOARDS))
  }

  function handleStoryboardsUpdated(items: any[]) {
    if (!Array.isArray(items) || !items.length) return
    setCreativeStoryboards(items.slice(0, MAX_STORYBOARDS))
    syncGeneratedScriptStoryboardJson()
    if (
      currentStepRef.current === 'timeline' ||
      timelineAutoGeneratedRef.current ||
      !timelineHasAnyAudio(timelineStateRef.current)
    ) {
      syncTimelineFromStoryboards()
    }
  }

  function updatePromptTextFromPanel(value: any) {
    const text = String(value || '').trim()
    setDescription(text)
    setGeneratedPrompt(text)
  }

  async function generateScript() {
    if (isSubmittingScriptRef.current) return

    const id = getWorkspaceIdOrNotify()
    if (!id) return

    resumeWorkflowPersistence()
    setCurrentStep('script')
    cancelInFlightStoryboard()
    setStoryboardGenerating(false)
    setGeneratedPrompt(descriptionRef.current.trim() || DEFAULT_GENERATING_PROMPT)
    setGeneratedScript('')
    setCreativeStoryboards([])
    setActiveMenu('')

    await Promise.resolve()

    startGenerationPending()
    setIsGenerating(true)
    setIsSubmittingScript(true)
    setIsScriptStreaming(true)
    showToastRef.current('创意脚本生成中', 'success')

    // 注册可中止控制器：重绘/卸载时经 abortAllPendingTasks() 中止流式 SSE，
    // 防止残留的 onDelta 继续写入、覆盖已重置的脚本状态。
    const scriptAbortController = createTaskAbortController()
    const scriptSignal = scriptAbortController.signal

    try {
      await ensureModelPlanCandidatesLoaded()
      const scriptPrompt = buildCreativeScriptPrompt(generatedPromptRef.current)
      const scriptInputAssets = buildCreativeScriptInputAssets()

      const result = await requestCreativeScriptWithFallback({
        workspaceId: id,
        prompt: scriptPrompt,
        inputAssets: scriptInputAssets,
        signal: scriptSignal,
        onDelta: (_delta: any, aggregated: any) => {
          if (scriptSignal.aborted) return
          setGeneratedScript(aggregated)
        },
      })

      // 已被取消：直接退出，交由新的生成流程接管，不提交本次结果。
      if (scriptSignal.aborted) return

      const scriptText = result?.text || generatedScriptRef.current

      if (!scriptText) {
        throw new Error('AI 未返回创意脚本')
      }

      setGeneratedScript(scriptText)
      applyParsedStoryboards(scriptText)

      if (!creativeStoryboardsRef.current.length) {
        setCreativeStoryboards(buildFallbackStoryboards())
      }

      showToastRef.current('创意脚本已生成', 'success')
    } catch (error: any) {
      if (scriptSignal.aborted) {
        return
      }
      if (generatedScriptRef.current && generatedScriptRef.current.length > 0) {
        applyParsedStoryboards(generatedScriptRef.current)
        if (!creativeStoryboardsRef.current.length) {
          setCreativeStoryboards(buildFallbackStoryboards())
        }
        showToastRef.current('创意脚本部分生成（已截断），可基于已有内容继续', 'error')
      } else {
        setIsGenerating(false)
        setGeneratedScript('')
        setCreativeStoryboards([])
        showToastRef.current(getBusinessErrorMessage(error, error.message || '创意脚本生成失败'), 'error')
      }
    } finally {
      releaseTaskAbortController(scriptAbortController)
      // 已被取消时，UI 标志由接管方（重绘/卸载流程）负责，避免覆盖其新状态。
      if (!scriptSignal.aborted) {
        setIsSubmittingScript(false)
        setIsScriptStreaming(false)
        stopGenerationPending()
      }
    }
  }

  function startGenerationPending() {
    setGenerationPending(true)
  }

  function stopGenerationPending() {
    setGenerationPending(false)
  }

  async function copyScript() {
    const text = generatedScriptRef.current.trim()
    if (!text) {
      showToastRef.current('暂无可复制内容', 'error')
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      showToastRef.current('脚本已复制', 'success')
    } catch {
      showToastRef.current('复制失败，请手动选中文本后 Ctrl+C 复制', 'error')
    }
  }

  function regenerateScript() {
    generateScript()
  }

  function generateTimeline() {
    if (timelineGenerationBlockReasonRef.current) {
      showToastRef.current(timelineGenerationBlockReasonRef.current, 'error')
      return
    }

    // 只包含已生成图片的分镜，跳过空白占位
    const items = storyboardItemsRef.current
    const boards = creativeStoryboardsRef.current
    const aligned: any[] = []
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (!item?.src || item?.status !== 'succeeded') continue
      const board = boards[i]
      aligned.push(
        board
          ? { ...board }
          : {
              title: item.title,
              prompt: item.title,
              duration: 2,
              voiceover: '',
              subtitle: '',
              sfx: '',
            },
      )
    }

    if (!aligned.length) {
      showToastRef.current('请先生成分镜图片', 'error')
      return
    }

    // 按用户选择的视频总时长归一化各段秒数
    const totalSec = Number.parseInt(String(selectedDurationRef.current), 10) || 10
    setTimelineState(buildTimelineTracks(normalizeStoryboardDurations(aligned, totalSec)))
    setTimelineAutoGenerated(true)
    setCurrentStep('timeline')
    setActiveMenu('')
    setLibraryOpen(false)
    setEditingStoryboardId('')
    showToastRef.current('时间线已生成', 'success')
  }

  function handleTimelineUpdate(nextTimeline: any) {
    setTimelineState({
      segments: nextTimeline.segments || [],
      voiceover: nextTimeline.voiceover || [],
      subtitle: nextTimeline.subtitle || [],
      sfx: nextTimeline.sfx || [],
    })
    setTimelineAutoGenerated(false)
    timelineDirtyForVideoRef.current = true
  }

  function handleTimelineSynced() {
    showToastRef.current('已同步更新', 'success')
    timelineDirtyForVideoRef.current = true
  }

  function handleTimelineStoryboardPromptUpdate({ storyboardIndex, prompt }: any = {}) {
    const index = Number(storyboardIndex)
    if (!Number.isInteger(index) || index < 0) return
    const prevList = Array.isArray(creativeStoryboardsRef.current) ? creativeStoryboardsRef.current.slice() : []
    const item = storyboardItemsRef.current[index] || null
    const prev = prevList[index] || {
      title: item?.title || `分镜 ${index + 1}`,
      prompt: item?.title || '',
      duration: 2,
      voiceover: '',
      subtitle: '',
      sfx: '',
    }
    prevList[index] = {
      ...prev,
      title: prev.title || item?.title || `分镜 ${index + 1}`,
      prompt: String(prompt || ''),
    }
    setCreativeStoryboards(prevList)
    syncGeneratedScriptStoryboardJson()
    timelineDirtyForVideoRef.current = true
  }

  // watch(currentStep) → 进入 video 时若 timeline 脏，自动生成/重新生成视频
  const prevStepForVideoRef = useRef(currentStep)
  useEffect(() => {
    const step = currentStep
    prevStepForVideoRef.current = step
    if (step !== 'video') return
    if (!timelineDirtyForVideoRef.current) return
    if (isVideoGeneratingRef.current) return
    timelineDirtyForVideoRef.current = false
    if (generatedVideoUrlRef.current) {
      regenerateVideo()
      return
    }
    generateVideo()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep])

  // watch(resolveStoryboardCoverState().key) & watch(storyboardGenerating)
  const prevCoverKeyRef = useRef('')
  useEffect(() => {
    const next = resolveStoryboardCoverState().key
    const prev = prevCoverKeyRef.current
    prevCoverKeyRef.current = next
    if (!next || next === prev) return
    if (restoringWorkflowFromStorageRef.current) return
    scheduleProjectCoverDraftSync()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyboardItems])

  const prevStoryboardGeneratingRef = useRef(storyboardGenerating)
  useEffect(() => {
    const next = storyboardGenerating
    const prev = prevStoryboardGeneratingRef.current
    prevStoryboardGeneratingRef.current = next
    if (next || !prev) return
    if (restoringWorkflowFromStorageRef.current) return
    scheduleProjectCoverDraftSync()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyboardGenerating])

  async function reloadTimeline({ segmentId, instruction }: any = {}) {
    if (timelineReloadingRef.current) return
    const trimmed = String(instruction || '').trim()
    if (!trimmed) {
      showToastRef.current('请输入修改描述后再重新加载', 'error')
      return
    }

    const segment = (timelineStateRef.current?.segments || []).find((item: any) => item?.id === segmentId) || null
    const storyboardIndex = segment?.storyboardIndex ?? -1
    const item = storyboardItemsRef.current[storyboardIndex] || null
    if (!item?.id) {
      showToastRef.current('未找到对应分镜图片，请先生成分镜图片', 'error')
      return
    }

    if (storyboardGeneratingRef.current || isModifyingStoryboardImageRef.current) {
      return
    }

    setTimelineReloading(true)
    setTimelineReloadReady(false)
    try {
      await modifyStoryboardImage({ itemId: item.id, prompt: trimmed })
      await rewriteStoryboardCopyAfterImageEdit({ itemId: item.id, editInstruction: trimmed })
      syncTimelineFromStoryboards()
      setTimelineReloadReady(true)
      showToastRef.current('已重新加载并更新分镜词', 'success')
    } finally {
      setTimelineReloading(false)
    }
  }

  function approveTimelineReload() {
    if (timelineReloadingRef.current) return
    if (!timelineReloadReadyRef.current) return
    setTimelineReloadReady(false)
    generateVideo()
  }

  function hasStoryboardAudio(storyboards: any[] = []) {
    return storyboards.some((board) => board?.voiceover || board?.subtitle || board?.sfx)
  }

  function timelineHasAnyAudio(timeline: any) {
    const segments = timeline?.segments || []
    const tracks = [
      ...(timeline?.voiceover || []),
      ...(timeline?.subtitle || []),
      ...(timeline?.sfx || []),
    ]
    if (tracks.length) return true
    return segments.some((segment: any) => segment?.voiceover || segment?.subtitle || segment?.sfx)
  }

  function syncTimelineFromStoryboards() {
    const items = storyboardItemsRef.current
    const boards = creativeStoryboardsRef.current
    if (!boards.length && !items.length) return

    // 只包含已生成图片的分镜
    const aligned: any[] = []
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (!item?.src || item?.status !== 'succeeded') continue
      const board = boards[i]
      aligned.push(
        board
          ? { ...board }
          : {
              title: item.title,
              prompt: item.title,
              duration: 2,
              voiceover: '',
              subtitle: '',
              sfx: '',
            },
      )
    }

    if (!aligned.length) return

    const totalSec = Number.parseInt(String(selectedDurationRef.current), 10) || 10
    setTimelineState(buildTimelineTracks(normalizeStoryboardDurations(aligned, totalSec)))
    setTimelineAutoGenerated(true)
  }

  // watch(creativeStoryboards, deep) → 有脚本词音频时自动同步时间线
  useEffect(() => {
    const next = creativeStoryboards
    if (!Array.isArray(next) || !next.length) return
    if (!hasStoryboardAudio(next)) return

    const hasSegments = (timelineStateRef.current?.segments || []).length > 0
    const hasAudio = timelineHasAnyAudio(timelineStateRef.current)

    if (!hasSegments) {
      syncTimelineFromStoryboards()
      return
    }
    if (timelineAutoGeneratedRef.current) {
      syncTimelineFromStoryboards()
      return
    }
    if (!hasAudio) {
      syncTimelineFromStoryboards()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creativeStoryboards])

  function openStoryboardEditor(item: any) {
    setEditingStoryboardId(item.id)
    setPreviewMaterial(null)
    setLibraryOpen(false)
  }

  function closeStoryboardEditor() {
    setEditingStoryboardId('')
    setLibraryOpen(false)
  }

  function buildStoryboardCopyRewritePrompt({ board, durationSec, editInstruction }: any = {}) {
    const safeTitle = String(board?.title || '').trim()
    const safeVisual = String(board?.prompt || '').trim()
    const safeVoiceover = String(board?.voiceover || '').trim()
    const safeSubtitle = String(board?.subtitle || '').trim()
    const safeSfx = String(board?.sfx || '').trim()
    const safeEdit = String(editInstruction || '').trim()
    const safeRatio = String(selectedRatioRef.current || '').trim()
    const safeStyle = String(selectedStyleTextRef.current || '').trim()
    const duration = Number(durationSec || board?.duration || 2)

    return [
      '你是一名短视频分镜导演和文案。',
      '我已经对当前分镜的图片做了“图片修改”，需要你把分镜文案（画面描述/旁白/字幕/音效）同步更新为“修改后画面”。',
      '',
      `分镜标题：${safeTitle || '分镜'}`,
      `原画面描述（参考）：${safeVisual || '无'}`,
      `原旁白（参考）：${safeVoiceover || '无'}`,
      `原字幕（参考）：${safeSubtitle || '无'}`,
      `原音效（参考）：${safeSfx || '无'}`,
      '',
      `图片修改要求：${safeEdit || '无'}`,
      '',
      `约束：时长固定为 ${Number.isFinite(duration) ? duration : 2}s；画面比例 ${safeRatio || '9:16'}；风格 ${safeStyle || '自然口播'}。`,
      '输出要求：只输出下面 JSON，必须严格包含字段 title/prompt/duration/voiceover/subtitle/sfx；不要任何解释、不要 markdown。',
      '其中：prompt 要写清修改后的新增元素/场景/风格；voiceover 要像人在说话；subtitle 更短更口语；sfx 用关键词即可。',
      '',
      '<<<STORYBOARD_JSON>>>',
      JSON.stringify(
        [
          {
            title: safeTitle || '分镜',
            prompt: '',
            duration: Number.isFinite(duration) ? duration : 2,
            voiceover: '',
            subtitle: '',
            sfx: '',
          },
        ],
        null,
        2,
      ),
      '<<<END_STORYBOARD_JSON>>>',
    ].join('\n')
  }

  function syncGeneratedScriptStoryboardJson() {
    const payload = extractStoryboardPayload(generatedScriptRef.current || '')
    const storyboards = serializeStoryboardsForScript(creativeStoryboardsRef.current).slice(0, MAX_STORYBOARDS)
    if (!storyboards.length) return

    const markerOpen = '<<<STORYBOARD_JSON>>>'
    const markerClose = '<<<END_STORYBOARD_JSON>>>'
    const markdown = String((payload as any)?.markdown ?? '').trimEnd()
    const json = JSON.stringify(storyboards, null, 2)
    const nextText = [markdown, '', markerOpen, json, markerClose].filter(Boolean).join('\n')
    setGeneratedScript(nextText.trimEnd())
  }

  async function rewriteStoryboardCopyAfterImageEdit({ itemId, editInstruction }: any = {}) {
    const id = getWorkspaceIdOrNotify()
    if (!id) return

    const index = storyboardItemsRef.current.findIndex((item: any) => item.id === itemId)
    if (index < 0) return

    const board = creativeStoryboardsRef.current[index] || {
      title: storyboardItemsRef.current[index]?.title || `分镜 ${index + 1}`,
      prompt: storyboardItemsRef.current[index]?.title || '',
      duration: 2,
      voiceover: '',
      subtitle: '',
      sfx: '',
    }

    const durationSec = Number(board?.duration || 2)
    const promptText = buildStoryboardCopyRewritePrompt({ board, durationSec, editInstruction })

    await ensureModelPlanCandidatesLoaded()

    const prevList = Array.isArray(creativeStoryboardsRef.current) ? creativeStoryboardsRef.current : []
    const fallbackTitle = storyboardItemsRef.current[index]?.title || `分镜 ${index + 1}`
    const fallbackPrompt = storyboardItemsRef.current[index]?.title || ''
    const prev = prevList[index] || board

    // 第一次尝试：流式请求
    let next: any = null
    try {
      const result = await requestCreativeScriptWithFallback({ workspaceId: id, prompt: promptText })
      next = parseStoryboardFromAiText(result?.text)
    } catch {
      // 继续重试
    }

    // 第二次尝试：换一种措辞，纯 JSON 输出不带标记
    if (!next) {
      try {
        const safeTitle = String(board?.title || '').trim()
        const safeVisual = String(board?.prompt || '').trim()
        const safeEdit = String(editInstruction || '').trim()
        const safeRatio = String(selectedRatioRef.current || '').trim()
        const safeStyle = String(selectedStyleTextRef.current || '').trim()

        const prompt2 = [
          '你是一名短视频分镜导演和文案。',
          '图片已修改，请为修改后的画面更新分镜文案。',
          `分镜标题：${safeTitle || '分镜'}`,
          `原画面描述：${safeVisual || '无'}`,
          `修改要求：${safeEdit || '优化画面'}`,
          `约束：时长 ${Number.isFinite(durationSec) ? durationSec : 2}s；比例 ${safeRatio || '9:16'}；风格 ${safeStyle || '自然口播'}。`,
          '输出完整 JSON，字段：title/prompt/duration/voiceover/subtitle/sfx。',
          JSON.stringify(
            [
              {
                title: safeTitle || '分镜',
                prompt: '',
                duration: Number.isFinite(durationSec) ? durationSec : 2,
                voiceover: '',
                subtitle: '',
                sfx: '',
              },
            ],
            null,
            2,
          ),
        ].join('\n')

        const result2 = await requestCreativeScriptWithFallback({ workspaceId: id, prompt: prompt2 })
        next = parseStoryboardFromAiText(result2?.text)
      } catch {
        // 降级
      }
    }

    // 降级兜底：保留原有 title/prompt，脚本词用原有内容
    if (!next) {
      next = {
        title: prev?.title || fallbackTitle,
        prompt: prev?.prompt || fallbackPrompt,
        duration: prev?.duration || durationSec || 2,
        voiceover: prev?.voiceover || '',
        subtitle: prev?.subtitle || '',
        sfx: prev?.sfx || '',
      }
    }

    const patched = {
      ...prev,
      title: prev?.title || fallbackTitle,
      prompt: prev?.prompt || fallbackPrompt,
      duration: Number(next.duration || prev?.duration || 2) || Number(prev?.duration || 2) || 2,
      voiceover: String(next.voiceover || '').trim(),
      subtitle: String(next.subtitle || '').trim(),
      sfx: String(next.sfx || '').trim(),
    }

    const nextList = prevList.slice()
    nextList[index] = patched
    setCreativeStoryboards(nextList)

    syncGeneratedScriptStoryboardJson()

    if (
      currentStepRef.current === 'timeline' ||
      timelineAutoGeneratedRef.current ||
      !timelineHasAnyAudio(timelineStateRef.current)
    ) {
      syncTimelineFromStoryboards()
    }
  }

  async function confirmStoryboardEdit({ itemId, prompt }: any = {}) {
    const before = storyboardItemsRef.current.find((item: any) => item.id === itemId)?.src || ''
    await modifyStoryboardImage({ itemId, prompt })
    const after = storyboardItemsRef.current.find((item: any) => item.id === itemId)?.src || ''
    if (!before || !after || after === before) {
      return
    }

    await rewriteStoryboardCopyAfterImageEdit({ itemId, editInstruction: prompt })

    const nextList = Array.isArray(storyboardEditHistoryRef.current?.[itemId])
      ? [...storyboardEditHistoryRef.current[itemId]]
      : []
    const exists = nextList.some((entry: any) => entry?.src === before)
    if (exists) {
      return
    }
    const nextIndex = nextList.length + 1
    const record = {
      id: `edit_${itemId}_${Date.now()}`,
      title: `版本 ${String(nextIndex).padStart(2, '0')}`,
      src: before,
    }
    setStoryboardEditHistory({
      ...storyboardEditHistoryRef.current,
      [itemId]: [record, ...nextList].slice(0, 12),
    })
  }

  function handleSelectStoryboardItem(itemId: string) {
    setSelectedStoryboardId(itemId || '')
  }

  // ── Directly replace storyboard image with a local upload ──
  async function handleDirectReplaceStoryboardImage(file: File) {
    const id = getWorkspaceIdOrNotify()
    if (!id) return

    const itemId = selectedStoryboardIdRef.current
    if (!itemId) {
      showToastRef.current('请先选中一张分镜图片', 'error')
      return
    }

    showToastRef.current('图片上传中…', 'success')

    try {
      const { asset } = await uploadAssetFile({
        workspaceId: id,
        file,
        prompt: descriptionRef.current.trim(),
      })

      let src = ''
      try {
        src = await getAssetDownloadUrl({ workspaceId: id, assetId: asset.id })
      } catch {
        src = asset?.thumbnail_url || asset?.preview_url || asset?.cover_url || asset?.url || ''
      }

      if (!src) {
        throw new Error('无法获取图片地址')
      }

      // 通过 composable 替换图片，自动将当前版本保存到历史记录
      await replaceStoryboardImage({ itemId, src, assetId: asset.id })

      showToastRef.current('图片已替换', 'success')
    } catch (error: any) {
      showToastRef.current(getBusinessErrorMessage(error, error.message || '图片替换失败'), 'error')
    }
  }

  // ── Directly insert a new storyboard card with a local upload ──
  async function handleDirectInsertStoryboardImage({ file, anchorId, side }: any) {
    const id = getWorkspaceIdOrNotify()
    if (!id) return

    showToastRef.current('图片上传中…', 'success')

    try {
      const { asset } = await uploadAssetFile({
        workspaceId: id,
        file,
        prompt: descriptionRef.current.trim(),
      })

      let src = ''
      try {
        src = await getAssetDownloadUrl({ workspaceId: id, assetId: asset.id })
      } catch {
        src = asset?.thumbnail_url || asset?.preview_url || asset?.cover_url || asset?.url || ''
      }

      if (!src) {
        throw new Error('无法获取图片地址')
      }

      // Insert a new storyboard slot, then fill it with the uploaded image
      const inserted = insertStoryboardSlot({ anchorId, side: side || 'right' })
      if (!inserted?.id) {
        throw new Error('插入分镜卡位失败')
      }

      // 通过 composable 设置图片（自动人脸脱敏 + 版本历史）
      await replaceStoryboardImage({ itemId: inserted.id, src, assetId: asset.id })

      // 先让 AI 分析图片生成 prompt（画面描述），再基于 prompt 生成脚本词
      try {
        const analyzePrompt = [
          '请仔细观察这张图片，输出一段可直接用于 AI 生图和分镜理解的中文画面描述，不要任何解释。',
          '描述要具体到：主体是什么、在做什么、场景在哪里、镜头景别或角度、前后景关系、光线氛围、关键细节。',
          '尽量写得具体自然，不要空泛词，不超过80字。',
        ].join('\n')
        const analyzeResult = await requestCreativeScriptWithFallback({
          workspaceId: id,
          prompt: analyzePrompt,
          inputAssets: [{ asset_id: asset.id, role: 'image' }],
        })
        const generatedPromptText = String(analyzeResult?.text || '').trim()
        if (generatedPromptText) {
          const nextBoards = [...creativeStoryboardsRef.current]
          nextBoards[inserted.index] = {
            ...nextBoards[inserted.index],
            prompt: generatedPromptText,
            title: generatedPromptText.slice(0, 20),
          }
          setCreativeStoryboards(nextBoards)
        }
      } catch {
        /* 分析失败不阻塞，用原有 prompt */
      }

      // 基于 prompt 生成完整脚本词（旁白/字幕/音效）
      try {
        await generateScriptWord(inserted.index)
      } catch {
        showToastRef.current('分镜词生成失败，请手动填写', 'error')
      }

      // 同步时间线
      const hasTimeline = (timelineStateRef.current?.segments || []).length > 0
      if (hasTimeline) {
        syncTimelineFromStoryboards()
      }

      showToastRef.current('图片已添加', 'success')
    } catch (error: any) {
      showToastRef.current(getBusinessErrorMessage(error, error.message || '图片添加失败'), 'error')
    }
  }

  // ── 为新插入分镜生成完整脚本词（JSON 格式，和编辑分镜一样的成熟方案）──
  function buildInsertedBoardScriptPrompt({ board, baseIdea, styleText, boardSamples }: any) {
    const safeTitle = String(board?.title || '').trim() || '新增分镜'
    const safeVisual = String(board?.prompt || '').trim() || safeTitle
    const safeRatio = String(selectedRatioRef.current || '').trim() || '9:16'
    const sampleBlock = boardSamples
      ? `已有分镜词样例（参考风格）：${boardSamples}。`
      : `风格：${styleText || '自然口播'}。`

    return [
      '你是一名短视频分镜导演和文案。',
      `这个分镜的画面是：${safeVisual}`,
      safeTitle ? `分镜标题：${safeTitle}` : '',
      baseIdea ? `（项目背景：${baseIdea}）` : '',
      sampleBlock,
      '请根据这个分镜的画面内容，为它生成旁白、字幕、音效。',
      '',
      `约束：时长 2s；画面比例 ${safeRatio}；风格 ${styleText || '自然口播'}。`,
      '输出要求：只输出下面 JSON，必须严格包含字段 title/prompt/duration/voiceover/subtitle/sfx；不要任何解释、不要 markdown。',
      '其中：prompt 保留原画面描述不变；voiceover 要像人在说话，围绕画面展开；subtitle 更短更口语；sfx 用关键词即可。',
      '',
      '<<<STORYBOARD_JSON>>>',
      JSON.stringify([{ title: safeTitle || '', prompt: safeVisual, duration: 2, voiceover: '', subtitle: '', sfx: '' }], null, 2),
    ]
      .filter(Boolean)
      .join('\n')
  }

  async function generateScriptWord(boardIndex: number) {
    const id = getWorkspaceIdOrNotify()
    if (!id) return

    const boards = creativeStoryboardsRef.current
    const targetBoard = boards[boardIndex]
    if (!targetBoard) return

    await ensureModelPlanCandidatesLoaded()

    const baseIdea = generatedPromptRef.current || descriptionRef.current.trim() || DEFAULT_GENERATING_PROMPT
    const styleText = selectedStylesRef.current.join(' ') || '自然口播'

    // 取已有脚本词的分镜当风格样本
    const boardSamples = boards
      .filter((b: any, i: number) => i !== boardIndex && (b.voiceover || b.subtitle))
      .slice(0, 5)
      .map((b: any) => `分镜"${b.prompt || b.title}" → 旁白"${b.voiceover}"，字幕"${b.subtitle}"，音效"${b.sfx}"`)
      .join('；')

    const prompt = buildInsertedBoardScriptPrompt({
      board: targetBoard,
      boardIndex,
      baseIdea,
      styleText,
      boardSamples,
    })

    // 第一次尝试
    let parsed: any = null
    try {
      const result = await requestCreativeScriptWithFallback({ workspaceId: id, prompt })
      parsed = parseStoryboardFromAiText(result?.text)
    } catch {
      // 继续重试
    }

    // 第二次尝试：换一种措辞
    if (!parsed) {
      try {
        const boardPrompt = targetBoard.prompt || targetBoard.title || ''
        const prompt2 = [
          '你是一名短视频分镜导演和文案。',
          `这个分镜的画面是：${boardPrompt}`,
          baseIdea ? `（项目背景：${baseIdea}）` : '',
          boardSamples ? `其他分镜风格参考：${boardSamples}` : `风格：${styleText}。`,
          '请根据这个分镜的画面内容，为它生成旁白、字幕、音效。',
          '输出完整 JSON，字段：title/prompt/duration/voiceover/subtitle/sfx；prompt 保留原画面描述不变。',
          '<<<STORYBOARD_JSON>>>',
          JSON.stringify([{ title: targetBoard.title || '', prompt: boardPrompt, duration: 2, voiceover: '', subtitle: '', sfx: '' }], null, 2),
        ].join('\n')

        const result2 = await requestCreativeScriptWithFallback({ workspaceId: id, prompt: prompt2 })
        parsed = parseStoryboardFromAiText(result2?.text)
      } catch {
        // 降级
      }
    }

    // 降级兜底
    if (!parsed) {
      parsed = {
        title: targetBoard.title || '新增分镜',
        prompt: targetBoard.prompt || targetBoard.title || '',
        duration: 2,
        voiceover: generatedPromptRef.current || descriptionRef.current.trim() || targetBoard.title || '分镜脚本',
        subtitle: targetBoard.title || '新增分镜',
        sfx: '轻快背景音乐',
      }
    }

    // 写入：title 保持用户输入的，不覆盖；只更新脚本词
    const nextBoards = [...creativeStoryboardsRef.current]
    const current = nextBoards[boardIndex]
    nextBoards[boardIndex] = {
      ...current,
      duration: Number(parsed.duration || current?.duration || 2) || 2,
      voiceover: String(parsed.voiceover || '').trim(),
      subtitle: String(parsed.subtitle || '').trim(),
      sfx: String(parsed.sfx || '').trim(),
    }
    setCreativeStoryboards(nextBoards)
  }

  // ── Storyboard reference image: AI analyze ──
  const aiAnalyzeCancelledRef = useRef(false)

  function cancelAiAnalyzeRequest() {
    aiAnalyzeCancelledRef.current = true
  }

  // ── Video download ──
  async function handleDownloadVideo({ url, name }: any) {
    if (!url) {
      showToastRef.current('暂无可下载的视频', 'error')
      return
    }

    const assetId = generatedVideoAssetIdRef.current
    const date = new Date()
    const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
    const safeName = String(name || '视频').replace(/[\\/:*?"<>|]/g, '').trim() || '视频'
    const fallbackFileName = `${safeName}_${dateStr}.mp4`

    if (assetId > 0) {
      try {
        const wsId = getWorkspaceIdOrNotify()
        if (wsId) {
          showToastRef.current('视频下载中…', 'success')
          const { blob, fileName } = await downloadAssetFile({ workspaceId: wsId, assetId })
          const resolvedFileName = fileName || fallbackFileName

          let fileHandle: any = null
          if ((window as any).showSaveFilePicker) {
            try {
              fileHandle = await (window as any).showSaveFilePicker({
                suggestedName: resolvedFileName,
                types: [{ description: 'MP4 视频', accept: { 'video/mp4': ['.mp4'] } }],
              })
            } catch (err: any) {
              if (err?.name === 'AbortError') return
            }
          }

          if (fileHandle) {
            const writable = await fileHandle.createWritable()
            await writable.write(blob)
            await writable.close()
          } else {
            const objectUrl = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = objectUrl
            a.download = resolvedFileName
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
          }

          showToastRef.current('视频已开始下载', 'success')
          return
        }
      } catch {
        /* 降级使用签名 URL */
      }
    }

    let downloadUrl = url
    if (assetId > 0) {
      try {
        const wsId = getWorkspaceIdOrNotify()
        if (wsId) {
          const freshUrl = await getAssetDownloadUrl({ workspaceId: wsId, assetId })
          if (freshUrl) downloadUrl = freshUrl
        }
      } catch {
        /* 降级使用原 URL */
      }
    }

    const isSameOrigin = (() => {
      try {
        const u = new URL(downloadUrl, window.location.href)
        return u.origin === window.location.origin
      } catch {
        return false
      }
    })()

    if (isSameOrigin) {
      const a = document.createElement('a')
      a.href = downloadUrl
      a.download = fallbackFileName
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      showToastRef.current('视频已开始下载', 'success')
      return
    }

    let fileHandle: any = null
    if ((window as any).showSaveFilePicker) {
      try {
        fileHandle = await (window as any).showSaveFilePicker({
          suggestedName: fallbackFileName,
          types: [{ description: 'MP4 视频', accept: { 'video/mp4': ['.mp4'] } }],
        })
      } catch (err: any) {
        if (err?.name === 'AbortError') return
      }
    }

    if (fileHandle && isSameOrigin) {
      try {
        showToastRef.current('视频下载中…', 'success')
        const response = await fetch(downloadUrl)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const blob = new Blob([await response.blob()], { type: 'video/mp4' })
        const writable = await fileHandle.createWritable()
        await writable.write(blob)
        await writable.close()
        showToastRef.current('视频已保存', 'success')
        return
      } catch (err: any) {
        if (err?.name === 'AbortError') return
      }
    }

    // 路径2：隐藏 iframe 触发下载（跨域 CDN 走这条路，不跳转页面）
    const iframe = document.createElement('iframe')
    iframe.style.display = 'none'
    iframe.src = downloadUrl
    document.body.appendChild(iframe)
    setTimeout(() => document.body.removeChild(iframe), 3000)
    showToastRef.current('视频已开始下载', 'success')
  }

  async function handleAnalyzeReferenceImage(material: any) {
    const id = getWorkspaceIdOrNotify()
    if (!id) return

    aiAnalyzeCancelledRef.current = false

    const imageUrl = material?.src || material?.url || ''
    if (!imageUrl) {
      showToastRef.current('无法获取参考图片地址', 'error')
      return
    }

    showToastRef.current('AI正在分析图片元素…', 'success')

    try {
      await ensureModelPlanCandidatesLoaded()

      const prompt = [
        '你是一名专业的视觉分析专家。请仔细观察这张图片，分析其中的：',
        '1. 主体元素（人物、产品、物体等）',
        '2. 场景环境（室内/室外、具体场景描述）',
        '3. 色彩与光影（主色调、光源方向、氛围）',
        '4. 构图特点（视角、景别、布局）',
        '',
        '请用一段简洁的中文画面描述总结以上分析，可以直接用作AI生成图片的描述词。',
        '要求：100字以内，自然语言，不要编号，不要Markdown。',
      ].join('\n')

      const result = await requestCreativeScriptWithFallback({
        workspaceId: id,
        prompt,
        onDelta: undefined,
      })

      if (aiAnalyzeCancelledRef.current) return

      const desc = String(result?.text || '').trim()
      if (!desc) {
        throw new Error('AI未返回分析结果')
      }

      showToastRef.current('AI分析完成，请确认并修改描述', 'success')
    } catch (error) {
      if (aiAnalyzeCancelledRef.current) return
      showToastRef.current('AI分析失败，请手动输入描述', 'error')
      if (import.meta.env.DEV) {
        console.warn('[ai-analyze-image failed]', error)
      }
    }
  }

  function modifyStoryboardFromPanel({ itemId, prompt }: any = {}) {
    return confirmStoryboardEdit({ itemId, prompt })
  }

  function generateStoryboard(): any {
    const invokedFromStoryboard = currentStepRef.current === 'storyboard'
    if (!invokedFromStoryboard) {
      switchToStep('storyboard')
      if (currentStepRef.current !== 'storyboard') {
        return
      }

      if (storyboardGeneratingRef.current || isModifyingStoryboardImageRef.current) {
        return
      }

      cancelInFlightStoryboard()
      resetStoryboard()

      if (!creativeStoryboardsRef.current.length) {
        const text = generatedScriptRef.current.trim()
        if (text) {
          applyParsedStoryboards(text)
        }
      }

      if (!creativeStoryboardsRef.current.length) {
        setCreativeStoryboards(buildFallbackStoryboards())
      }

      if (!creativeStoryboardsRef.current.length) {
        showToastRef.current('分镜脚本为空，无法生成分镜图片', 'error')
        return
      }

      return startStoryboardGeneration()
    }
    const isCompleted =
      storyboardTotalRef.current > 0 &&
      storyboardProgressCountRef.current >= storyboardTotalRef.current &&
      storyboardItemsRef.current.length >= storyboardTotalRef.current

    if (isCompleted) {
      if (invokedFromStoryboard) {
        generateTimeline()
      }
      return
    }

    const promise = startStoryboardGeneration()

    if (!invokedFromStoryboard) {
      return promise
    }

    return Promise.resolve(promise).then(() => {
      const completedAfterRun =
        storyboardTotalRef.current > 0 &&
        storyboardProgressCountRef.current >= storyboardTotalRef.current &&
        storyboardItemsRef.current.length >= storyboardTotalRef.current
      if (completedAfterRun) {
        generateTimeline()
      }
    })
  }

  function regenerateStoryboard(): any {
    if (isSubmittingScriptRef.current || storyboardGeneratingRef.current || isModifyingStoryboardImageRef.current) {
      return
    }

    const id = getWorkspaceIdOrNotify()
    if (!id) return

    cancelInFlightStoryboard()
    resumeWorkflowPersistence()
    setCurrentStep('storyboard')
    setActiveMenu('')
    setLibraryOpen(false)
    setEditingStoryboardId('')
    setPreviewMaterial(null)

    const promptText = descriptionRef.current.trim() || DEFAULT_GENERATING_PROMPT
    setGeneratedPrompt(promptText)
    setGeneratedScript('')
    setCreativeStoryboards([])

    startGenerationPending()
    setIsGenerating(true)
    setIsSubmittingScript(true)
    setIsScriptStreaming(true)
    showToastRef.current('分镜脚本重新生成中', 'success')

    // 与 generateScript 一致：注册可中止控制器，重绘/卸载/再次触发时经 abortAllPendingTasks() 中止本流，
    // 防止残留 onDelta/结果覆盖已被新流程重置的脚本与分镜状态。
    const scriptAbortController = createTaskAbortController()
    const scriptSignal = scriptAbortController.signal

    const run = async () => {
      try {
        await ensureModelPlanCandidatesLoaded()
        const scriptPrompt = buildCreativeScriptPrompt(promptText)
        const scriptInputAssets = buildCreativeScriptInputAssets()

        const result = await requestCreativeScriptWithFallback({
          workspaceId: id,
          prompt: scriptPrompt,
          inputAssets: scriptInputAssets,
          signal: scriptSignal,
          onDelta: (_delta: any, aggregated: any) => {
            if (scriptSignal.aborted) return
            setGeneratedScript(aggregated)
          },
        })

        if (scriptSignal.aborted) return

        const scriptText = result?.text || generatedScriptRef.current
        if (!scriptText) {
          throw new Error('AI 未返回创意脚本')
        }

        setGeneratedScript(scriptText)
        applyParsedStoryboards(scriptText)

        if (!creativeStoryboardsRef.current.length) {
          setCreativeStoryboards(buildFallbackStoryboards())
        }
      } catch (error) {
        if (scriptSignal.aborted) return
        if (generatedScriptRef.current && generatedScriptRef.current.length > 0) {
          applyParsedStoryboards(generatedScriptRef.current)
          if (!creativeStoryboardsRef.current.length) {
            setCreativeStoryboards(buildFallbackStoryboards())
          }
        } else {
          setGeneratedScript('')
          setCreativeStoryboards([])
          throw error
        }
      } finally {
        releaseTaskAbortController(scriptAbortController)
        // 已被取消时 UI 标志由接管方负责，避免覆盖其新状态。
        if (!scriptSignal.aborted) {
          setIsSubmittingScript(false)
          setIsScriptStreaming(false)
          stopGenerationPending()
        }
      }
    }

    return Promise.resolve()
      .then(run)
      .then(async () => {
        if (scriptSignal.aborted) return
        if (!creativeStoryboardsRef.current.length) {
          showToastRef.current('分镜脚本为空，无法生成分镜图片', 'error')
          return
        }

        resetStoryboard()
        showToastRef.current('分镜图片生成中', 'success')
        await startStoryboardGeneration()
        showToastRef.current('分镜已重新生成', 'success')
      })
      .catch((error: any) => {
        if (scriptSignal.aborted) return
        showToastRef.current(getBusinessErrorMessage(error, error.message || '分镜重新生成失败'), 'error')
      })
  }

  function insertStoryboardItem(payload: any) {
    const { anchorId, side } = payload || {}
    const board = payload?.board
    const prompt = payload?.prompt || board?.prompt
    if (prompt || board) {
      insertStoryboardImage({ anchorId, side, prompt, board }).then(async ({ insertedId, insertedIndex }: any) => {
        if (insertedId) {
          setSelectedStoryboardId(insertedId)

          // 新分镜图片生成后，自动续写脚本词（旁白/字幕/音效）
          const boardIndex = storyboardItemsRef.current.findIndex((item: any) => item.id === insertedId)
          if (boardIndex >= 0) {
            await generateScriptWord(boardIndex)
          }

          // 脚本词生成后再同步时间线，保证镜头编排能拿到完整数据
          const hasTimeline = (timelineStateRef.current?.segments || []).length > 0
          if (hasTimeline) syncTimelineFromStoryboards()

          generateShotDescriptionForInsertedBoard(insertedIndex, prompt)
        }
      })
      resetInsertIdea()
      return
    }
    const inserted = insertStoryboardSlot({ anchorId, side })
    if (inserted?.id) {
      setSelectedStoryboardId(inserted.id)
    }
  }

  /** 为新增的分镜生成完整的分镜信息（镜头描述+台词旁白+音效配乐）并回写到 creativeStoryboards */
  async function generateShotDescriptionForInsertedBoard(insertedIndex: number, userPrompt: any) {
    const id = getWorkspaceIdOrNotify()
    if (!id || insertedIndex == null) return

    // 取前面已有分镜作为格式参考（取最近的 2-3 个）
    const refBoards = creativeStoryboardsRef.current
      .slice(0, insertedIndex)
      .filter((b: any) => b?.prompt)
      .slice(-3)
    const refText = refBoards.length
      ? '参考以下已有分镜的格式（每条包含镜头描述/台词旁白/音效配乐）：\n' +
        refBoards
          .map((b: any, i: number) => {
            const lines = [`--- 分镜${i + 1} ---`]
            if (b.prompt) lines.push(`镜头描述：${b.prompt}`)
            if (b.voiceover) lines.push(`台词旁白：${b.voiceover}`)
            if (b.subtitle) lines.push(`字幕文案：${b.subtitle}`)
            if (b.sfx) lines.push(`音效配乐：${b.sfx}`)
            return lines.join('\n')
          })
          .join('\n\n')
      : ''

    const aiPrompt = [
      '你是一名短视频分镜策划专家。',
      `项目主题：${generatedPromptRef.current || descriptionRef.current.trim() || ''}`,
      `新增分镜需求：${userPrompt}`,
      refText,
      `这是第 ${insertedIndex + 1} 张分镜。请为它生成分镜信息。`,
      '请严格按以下 JSON 格式输出（不要输出其他任何文字）：',
      '{"prompt":"结构化镜头描述（主体/场景/镜头/光线/风格/动作等字段，用分号分隔）","voiceover":"该分镜对应的台词或旁白内容","subtitle":"屏幕显示的字幕文案","sfx":"背景音乐或音效描述"}',
      '要求：',
      '- prompt 必须详细具体，与参考格式保持一致的结构化写法',
      '- voiceover 是人物说出的台词或画外旁白',
      '- subtitle 是屏幕上显示的文字',
      '- sfx 是背景音乐、环境音效或转场音效说明',
      '- 所有字段值用中文填写，若某项不需要则填空字符串 ""',
    ]
      .filter(Boolean)
      .join('\n')

    try {
      const result = await requestCreativeScriptWithFallback({
        workspaceId: id,
        prompt: aiPrompt,
      })
      const text = String(result?.text || '').trim()
      if (!text) return

      // 尝试从返回文本中提取 JSON
      let parsed: any = null
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0])
        } catch {
          /* ignore */
        }
      }

      // 更新对应 board 的所有字段
      const boards = [...creativeStoryboardsRef.current]
      if (boards[insertedIndex]) {
        boards[insertedIndex] = {
          ...boards[insertedIndex],
          prompt: String(parsed?.prompt || text).trim(),
          voiceover: String(parsed?.voiceover || ''),
          subtitle: String(parsed?.subtitle || ''),
          sfx: String(parsed?.sfx || ''),
        }
        setCreativeStoryboards(boards.slice(0, 9))
      }
    } catch {
      // 静默失败，保留原有字段
    }
  }

  const [insertIdeaText, setInsertIdeaText, insertIdeaTextRef] = useStateRef('')
  const [insertIdeaLoading, setInsertIdeaLoading] = useState(false)
  const insertIdeaAnchorIdRef = useRef('')
  const insertIdeaSideRef = useRef('right')
  const insertIdeaSeedPromptRef = useRef('')
  const insertIdeaRequestIdRef = useRef(0)

  function resetInsertIdea() {
    insertIdeaRequestIdRef.current += 1
    setInsertIdeaText('')
    setInsertIdeaLoading(false)
    insertIdeaAnchorIdRef.current = ''
    insertIdeaSideRef.current = 'right'
    insertIdeaSeedPromptRef.current = ''
  }

  async function suggestInsertIdea({ anchorId, side, seedPrompt }: any = {}) {
    const id = getWorkspaceIdOrNotify()
    if (!id) return

    const requestId = insertIdeaRequestIdRef.current + 1
    insertIdeaRequestIdRef.current = requestId
    insertIdeaAnchorIdRef.current = anchorId || ''
    insertIdeaSideRef.current = side === 'left' ? 'left' : 'right'
    insertIdeaSeedPromptRef.current = String(seedPrompt || '').trim()
    setInsertIdeaText('')
    setInsertIdeaLoading(true)

    try {
      await ensureModelPlanCandidatesLoaded()
      const promptText = buildStoryboardInsertIdeaPrompt(insertIdeaSeedPromptRef.current)
      let result: any = null
      try {
        result = await streamAiResponse({
          workspaceId: id,
          operationCode: 'responses.multimodal',
          prompt: promptText,
          modelPlanCandidates: modelPlanCandidatesRef.current,
          params: {
            temperature: 0.9,
            max_output_tokens: 4086,
          },
          onDelta: (_delta: any, aggregated: any) => {
            if (insertIdeaRequestIdRef.current !== requestId) return
            setInsertIdeaText(aggregated)
          },
        })
      } catch (error) {
        const message = getBusinessErrorMessage(error, '')
        const shouldFallback = /stream|response stream|status failed|bad_request|请求失败\s*\(400\)/i.test(message)
        if (!shouldFallback) {
          throw error
        }

        result = await createAiResponse({
          workspaceId: id,
          operationCode: 'responses.multimodal',
          prompt: promptText,
          modelPlanCandidates: modelPlanCandidatesRef.current,
          params: {
            temperature: 0.9,
            max_output_tokens: 4086,
          },
        })
      }

      if (insertIdeaRequestIdRef.current !== requestId) return

      const text = String(result?.text || insertIdeaTextRef.current || '').trim()
      if (!text) {
        throw new Error('AI 未返回创意文案')
      }
      setInsertIdeaText(text)
    } catch (error: any) {
      if (insertIdeaRequestIdRef.current === requestId) {
        setInsertIdeaText('')
        showToastRef.current(getBusinessErrorMessage(error, error.message || '创意文案生成失败'), 'error')
      }
    } finally {
      if (insertIdeaRequestIdRef.current === requestId) {
        setInsertIdeaLoading(false)
      }
    }
  }

  async function uploadFiles(files: any, { addToSelected = false }: { addToSelected?: boolean } = {}) {
    const id = getWorkspaceIdOrNotify()

    if (!id) {
      return { materials: [], failedCount: 0 }
    }

    const supportedFiles = Array.from(files || []).filter(isSupportedMaterialFile) as File[]

    if (!supportedFiles.length) {
      showToastRef.current('请选择图片或视频文件', 'error')
      return { materials: [], failedCount: 0 }
    }

    let filesToUpload = supportedFiles
    if (addToSelected) {
      const remaining = Math.max(0, MAX_SELECTED_MATERIALS - selectedMaterialsRef.current.length)
      if (remaining <= 0) {
        showToastRef.current(`最多只能添加 ${MAX_SELECTED_MATERIALS} 个素材`, 'error')
        return { materials: [], failedCount: 0 }
      }
      if (supportedFiles.length > remaining) {
        filesToUpload = supportedFiles.slice(0, remaining)
        showToastRef.current(
          `最多只能添加 ${MAX_SELECTED_MATERIALS} 个素材，本次仅上传前 ${remaining} 个`,
          'error',
        )
      }
    }

    const uploadedMaterials: any[] = []
    const failedFiles: string[] = []

    for (const file of filesToUpload) {
      const localSrc = URL.createObjectURL(file)

      try {
        const { asset } = await uploadAssetFile({
          workspaceId: id,
          file,
          prompt: descriptionRef.current.trim(),
        })

        createdObjectUrlsRef.current.push(localSrc)
        uploadedMaterials.push(createMaterialFromAsset(asset, localSrc))
      } catch (error: any) {
        URL.revokeObjectURL(localSrc)
        const name = file.name || '未命名文件'
        const reason = getBusinessErrorMessage(error, error?.message || '上传失败')
        failedFiles.push(`${name}（${reason}）`)
      }
    }

    if (!uploadedMaterials.length && failedFiles.length) {
      throw new Error(
        failedFiles.length === 1
          ? `${failedFiles[0]}`
          : `${failedFiles.length} 个文件上传失败（示例：${failedFiles[0]}）`,
      )
    }

    setLibraryMaterials(mergeMaterials(uploadedMaterials, libraryMaterialsRef.current))
    setAssetsLoaded(true)

    if (addToSelected) {
      addSelectedMaterialsAction(uploadedMaterials, { prepend: true })
    }

    return {
      materials: uploadedMaterials,
      failedCount: failedFiles.length,
    }
  }

  async function handleSelectedFiles(files: any) {
    if (isUploadingSelectedRef.current) {
      return
    }

    setIsUploadingSelected(true)

    try {
      const { materials, failedCount } = await uploadFiles(files, { addToSelected: true })

      if (materials.length) {
        showToastRef.current(
          failedCount ? `已上传 ${materials.length} 个文件，${failedCount} 个失败` : `已上传 ${materials.length} 个文件`,
          failedCount ? 'error' : 'success',
        )
      }
    } catch (error: any) {
      showToastRef.current(getBusinessErrorMessage(error, error.message || '素材上传失败'), 'error')
    } finally {
      setIsUploadingSelected(false)
    }
  }

  async function handleLibraryFiles(files: any) {
    if (isUploadingLibraryRef.current) {
      return
    }

    setIsUploadingLibrary(true)

    try {
      const shouldAddToSelected = libraryContextRef.current !== 'storyboard-editor'
      const { materials, failedCount } = await uploadFiles(files, { addToSelected: shouldAddToSelected })

      if (materials.length) {
        if (libraryContextRef.current === 'storyboard-editor') {
          const existing = new Set(storyboardPreviewMaterialsRef.current.map((item: any) => item.id))
          const appended = [...storyboardPreviewMaterialsRef.current]
          materials.forEach((item: any) => {
            if (item?.id && !existing.has(item.id)) {
              existing.add(item.id)
              appended.push(item)
            }
          })
          setStoryboardPreviewMaterials(appended.slice(-3))
          showToastRef.current(
            failedCount
              ? `已上传并添加 ${materials.length} 个素材，${failedCount} 个失败`
              : `已上传并添加 ${materials.length} 个素材`,
            failedCount ? 'error' : 'success',
          )
          closeLibrary()
          libraryContextRef.current = 'default'
        } else {
          showToastRef.current(
            failedCount
              ? `已上传并添加 ${materials.length} 个素材，${failedCount} 个失败`
              : `已上传并添加 ${materials.length} 个素材`,
            failedCount ? 'error' : 'success',
          )
        }
      }
    } catch (error: any) {
      showToastRef.current(getBusinessErrorMessage(error, error.message || '素材上传失败'), 'error')
    } finally {
      setIsUploadingLibrary(false)
    }
  }

  async function materialFromRemoteAsset(asset: any) {
    let src = ''

    try {
      src = await getAssetDownloadUrl({ workspaceId: workspaceIdRef.current, assetId: asset.id })
    } catch {
      src = ''
    }

    if (!src) {
      src = asset?.thumbnail_url || asset?.preview_url || asset?.cover_url || asset?.url || ''
    }

    return createMaterialFromAsset(asset, src)
  }

  function getMaterialAssetId(material: any): number {
    const candidate = material?.assetId || material?.serverAsset?.id || material?.serverAsset?.asset_id || 0
    const id = Number(candidate || 0)
    return Number.isFinite(id) && id > 0 ? Math.floor(id) : 0
  }

  function shouldRefreshMaterialSrc(material: any): boolean {
    const src = String(material?.src || '')
    if (!src) return true
    if (src.startsWith('blob:')) return true
    return false
  }

  async function hydrateSelectedMaterialUrls({ silent = true }: { silent?: boolean } = {}) {
    const wsId = workspaceIdRef.current
    if (!wsId) return

    const hydrateList = async (list: any[]) => {
      const items = Array.isArray(list) ? list : []
      if (!items.length) return items

      const settled = await Promise.allSettled(
        items.map(async (material: any) => {
          const assetId = getMaterialAssetId(material)
          if (!assetId) return material
          if (!shouldRefreshMaterialSrc(material)) return material

          let src = ''
          try {
            src = await getAssetDownloadUrl({ workspaceId: wsId, assetId })
          } catch {
            src = ''
          }

          if (!src) {
            const asset = material?.serverAsset || null
            src = asset?.thumbnail_url || asset?.preview_url || asset?.cover_url || asset?.url || ''
          }

          return { ...material, src }
        }),
      )

      return settled.map((result, index) => (result.status === 'fulfilled' ? result.value : items[index]))
    }

    try {
      const nextSelected = await hydrateList(selectedMaterialsRef.current)
      setSelectedMaterialsAction(nextSelected)
      setStoryboardPreviewMaterials(await hydrateList(storyboardPreviewMaterialsRef.current))
    } catch (error) {
      if (!silent) {
        showToastRef.current(getBusinessErrorMessage(error, '素材预览地址刷新失败'), 'error')
      }
    }
  }

  async function hydrateStoryboardUrls() {
    const wsId = workspaceIdRef.current
    if (!wsId) return

    const items = storyboardItemsRef.current
    if (!items.length) return

    const refreshed = await Promise.allSettled(
      items.map(async (item: any) => {
        const assetId = toPositiveInt(item?.assetId)
        if (!assetId) return null

        try {
          const url = await getAssetDownloadUrl({ workspaceId: wsId, assetId })
          if (url) {
            return { id: item.id, src: url }
          }
        } catch {
          // 单张刷新失败不影响其他
        }
        return null
      }),
    )

    const updates = refreshed
      .filter((r: any) => r.status === 'fulfilled' && r.value)
      .map((r: any) => r.value)

    if (!updates.length) return

    const updateMap = new Map(updates.map((u: any) => [u.id, u.src]))
    setStoryboardItems(
      storyboardItemsRef.current.map((item: any) => {
        const freshSrc = updateMap.get(item.id)
        if (freshSrc) {
          return { ...item, src: freshSrc }
        }
        return item
      }),
    )
  }

  function hydrateMaterialsFromLibrary(materials: any[]) {
    const index = new Map((materials || []).map((material: any) => [material?.id, material]))
    const hydrateList = (list: any[]) =>
      (list || []).map((material: any) => {
        if (!material?.id) return material
        const next = index.get(material.id)
        if (next?.src) return next
        if (String(material.src || '').startsWith('blob:')) {
          return { ...material, src: '' }
        }
        return material
      })

    setSelectedMaterialsAction(hydrateList(selectedMaterialsRef.current))
    setStoryboardPreviewMaterials(hydrateList(storyboardPreviewMaterialsRef.current))
  }

  async function loadWorkspaceAssets({ silent = false }: { silent?: boolean } = {}) {
    const id = workspaceIdRef.current

    if (!id || isLoadingLibraryRef.current) {
      return
    }

    setIsLoadingLibrary(true)

    try {
      const payload = await listAssets({ workspaceId: id, limit: 100 })
      const remoteAssets = extractAssetPageItems(payload).filter(
        (asset: any) => asset?.id && ['image', 'video'].includes(asset.type),
      )
      const remoteMaterials = await Promise.all(remoteAssets.map(materialFromRemoteAsset))
      const visibleRemoteMaterials = remoteMaterials.filter((material: any) => material.src)

      const nextLibraryMaterials = mergeMaterials(visibleRemoteMaterials, libraryMaterialsRef.current)
      setLibraryMaterials(nextLibraryMaterials)
      hydrateMaterialsFromLibrary(nextLibraryMaterials)
      setAssetsLoaded(true)
    } catch (error) {
      if (!silent) {
        showToastRef.current(getBusinessErrorMessage(error, '素材库加载失败'), 'error')
      }
    } finally {
      setIsLoadingLibrary(false)
    }
  }

  function previewSelectedMaterial(material: any) {
    setPreviewMaterial(material)
  }

  function closePreview() {
    setPreviewMaterial(null)
  }

  function removeSelectedMaterial(materialId: any) {
    removeSelectedMaterialAction(materialId)

    if (previewMaterialRef.current?.id === materialId) {
      closePreview()
    }

    showToastRef.current('素材已移除', 'success')
  }

  function openLibrary() {
    libraryContextRef.current = 'default'
    openLibraryAction()
    setActiveMenu('')
    setLibraryTab('mine')

    if (!assetsLoadedRef.current) {
      loadWorkspaceAssets()
    }
  }

  function openLibraryForStoryboardEditor() {
    libraryContextRef.current = 'storyboard-editor'
    openLibraryAction()
    setActiveMenu('')
    setLibraryTab('mine')
    if (!assetsLoadedRef.current) {
      loadWorkspaceAssets()
    }
  }

  function closeLibrary() {
    closeLibraryAction()
    setActiveMenu('')
  }

  // watch(libraryOpen)
  useEffect(() => {
    if (libraryOpen) {
      setActiveMenu('')
      setLibraryTab('mine')
      if (!assetsLoadedRef.current) {
        loadWorkspaceAssets()
      }
      return
    }
    setActiveMenu('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryOpen])

  function addMaterialsFromLibrary(materials: any) {
    const list = Array.isArray(materials) ? materials : []

    if (libraryContextRef.current === 'storyboard-editor') {
      const existing = new Set(storyboardPreviewMaterialsRef.current.map((item: any) => item.id))
      const appended = [...storyboardPreviewMaterialsRef.current]
      list.forEach((item: any) => {
        if (item?.id && !existing.has(item.id)) {
          existing.add(item.id)
          appended.push(item)
        }
      })
      const nextPreview = appended.slice(-3)
      setStoryboardPreviewMaterials(nextPreview)
      showToastRef.current(`已添加 ${nextPreview.length} 个素材`, 'success')
      closeLibrary()
      libraryContextRef.current = 'default'
      return
    }

    const existing = new Set(selectedMaterialsRef.current.map((item: any) => item?.id).filter(Boolean))
    const remaining = Math.max(0, MAX_SELECTED_MATERIALS - existing.size)
    if (remaining <= 0) {
      showToastRef.current(`最多只能添加 ${MAX_SELECTED_MATERIALS} 个素材`, 'error')
      return
    }

    const picked: any[] = []
    list.forEach((item: any) => {
      if (picked.length >= remaining) return
      if (item?.id && !existing.has(item.id)) {
        existing.add(item.id)
        picked.push(item)
      }
    })

    addSelectedMaterialsAction(picked)
    if (picked.length) {
      const overflow = list.length > picked.length
      showToastRef.current(
        overflow
          ? `最多只能添加 ${MAX_SELECTED_MATERIALS} 个素材，本次添加 ${picked.length} 个`
          : `已添加 ${picked.length} 个素材`,
        overflow ? 'error' : 'success',
      )
    }
  }

  async function removeMaterialsFromLibrary(ids: any) {
    const list = Array.isArray(ids) ? ids : []
    if (!list.length) return

    const wsId = Number(workspaceIdRef.current || 0)
    if (!wsId) {
      showToastRef.current('workspace_id 缺失，无法删除素材', 'error')
      return
    }

    const removeIdSet = new Set(list)
    const materialIndex = new Map((libraryMaterialsRef.current || []).map((item: any) => [item?.id, item]))

    const targets = list
      .map((id: any) => {
        const material = materialIndex.get(id)
        if (!material) return null
        const assetId = getMaterialAssetId(material)
        return assetId ? { id, assetId } : null
      })
      .filter(Boolean) as any[]

    const failed: any[] = []

    await Promise.all(
      targets.map(async (row: any) => {
        try {
          await deleteAsset({ workspaceId: wsId, assetId: row.assetId })
        } catch (error) {
          failed.push(row.id)
          if (import.meta.env.DEV) {
            console.warn('[delete asset failed]', row, error)
          }
        }
      }),
    )

    setLibraryMaterials((libraryMaterialsRef.current || []).filter((item: any) => !removeIdSet.has(item.id)))
    list.forEach((id: any) => removeSelectedMaterialAction(id))
    setStoryboardPreviewMaterials(
      storyboardPreviewMaterialsRef.current.filter((item: any) => !removeIdSet.has(item.id)),
    )

    const okCount = list.length - failed.length
    if (!failed.length) {
      showToastRef.current(`已删除 ${okCount} 个素材`, 'success')
      return
    }
    if (!okCount) {
      showToastRef.current('素材删除失败，请稍后重试', 'error')
      return
    }
    showToastRef.current(`已删除 ${okCount} 个，失败 ${failed.length} 个`, 'error')
  }

  function removeStoryboardPreviewMaterial(id: any) {
    if (!id) return
    const next = storyboardPreviewMaterialsRef.current.filter((item: any) => item.id !== id)
    if (next.length === storyboardPreviewMaterialsRef.current.length) return
    setStoryboardPreviewMaterials(next)
    showToastRef.current(`已添加 ${next.length} 个素材`, 'success')
  }

  function applyWorkflowSnapshot(snapshot: any) {
    if (!snapshot || typeof snapshot !== 'object') return
    const snapshotProjectId = Number(snapshot.projectId || 0)
    if (snapshotProjectId && snapshotProjectId !== Number(projectIdRef.current || 0)) return
    if (typeof snapshot.maxStepIndex === 'number' && Number.isFinite(snapshot.maxStepIndex)) {
      setMaxStepIndex(Math.max(0, Math.min(3, Math.floor(snapshot.maxStepIndex))))
    }
    if (typeof snapshot.description === 'string') setDescription(snapshot.description)
    if (typeof snapshot.generatedPrompt === 'string') setGeneratedPrompt(snapshot.generatedPrompt)
    if (typeof snapshot.generatedScript === 'string') setGeneratedScript(snapshot.generatedScript)
    if (Array.isArray(snapshot.creativeStoryboards)) setCreativeStoryboards(snapshot.creativeStoryboards)
    if (Array.isArray(snapshot.storyboardItems)) adoptRestoredStoryboardItems(snapshot.storyboardItems)

    if (snapshot.timelineState && typeof snapshot.timelineState === 'object') {
      setTimelineState({
        segments: Array.isArray(snapshot.timelineState.segments) ? snapshot.timelineState.segments : [],
        voiceover: Array.isArray(snapshot.timelineState.voiceover) ? snapshot.timelineState.voiceover : [],
        subtitle: Array.isArray(snapshot.timelineState.subtitle) ? snapshot.timelineState.subtitle : [],
        sfx: Array.isArray(snapshot.timelineState.sfx) ? snapshot.timelineState.sfx : [],
      })
    }
    setTimelineAutoGenerated(false)
    if (
      Array.isArray(creativeStoryboardsRef.current) &&
      creativeStoryboardsRef.current.length &&
      hasStoryboardAudio(creativeStoryboardsRef.current) &&
      !timelineHasAnyAudio(timelineStateRef.current)
    ) {
      syncTimelineFromStoryboards()
    }

    if (typeof snapshot.generatedVideoUrl === 'string' && isSafeMediaUrl(snapshot.generatedVideoUrl)) {
      setGeneratedVideoUrl(snapshot.generatedVideoUrl)
    }
    if (snapshot.generatedVideoTask && typeof snapshot.generatedVideoTask === 'object') {
      setGeneratedVideoTask(snapshot.generatedVideoTask)
    }

    const restoredAssetId = Number(snapshot.generatedVideoAssetId || 0)
    if (Number.isFinite(restoredAssetId) && restoredAssetId > 0) {
      setGeneratedVideoAssetId(restoredAssetId)
      refreshGeneratedVideoUrl(restoredAssetId)
    }

    if (Array.isArray(snapshot.videoHistoryList)) {
      setVideoHistoryList(snapshot.videoHistoryList.filter((item: any) => item && isSafeMediaUrl(item.url)))
    }
    if (typeof snapshot.selectedDuration === 'string') setSelectedDuration(snapshot.selectedDuration)
    if (typeof snapshot.selectedRatio === 'string') setSelectedRatio(snapshot.selectedRatio)
    if (Array.isArray(snapshot.selectedStyles) && snapshot.selectedStyles.length) {
      setSelectedStyles(snapshot.selectedStyles)
    }
    if (Array.isArray(snapshot.styleOptions) && snapshot.styleOptions.length) {
      setStyleOptions(snapshot.styleOptions)
    }
    if (Array.isArray(snapshot.selectedMaterials)) setSelectedMaterialsAction(snapshot.selectedMaterials)
    if (typeof snapshot.selectedPlatform === 'string') setSelectedPlatform(snapshot.selectedPlatform)
    if (typeof snapshot.customStyle === 'string') setCustomStyle(snapshot.customStyle)
    if (snapshot.storyboardEditHistory && typeof snapshot.storyboardEditHistory === 'object') {
      setStoryboardEditHistory(snapshot.storyboardEditHistory)
    }

    if (
      typeof snapshot.currentStep === 'string' &&
      ['script', 'storyboard', 'timeline', 'video'].includes(snapshot.currentStep)
    ) {
      const step = snapshot.currentStep
      const hasStoryboards = storyboardItemsRef.current.some((item: any) => Boolean(item?.src))
      const hasTimeline = (timelineStateRef.current?.segments || []).length > 0
      const hasVideo = Boolean(generatedVideoUrlRef.current) || generatedVideoAssetIdRef.current > 0
      const nextStep =
        step === 'storyboard'
          ? hasStoryboards
            ? 'storyboard'
            : 'script'
          : step === 'timeline'
            ? hasTimeline
              ? 'timeline'
              : hasStoryboards
                ? 'storyboard'
                : 'script'
            : step === 'video'
              ? hasVideo
                ? 'video'
                : hasTimeline
                  ? 'timeline'
                  : hasStoryboards
                    ? 'storyboard'
                    : 'script'
              : 'script'
      setCurrentStep(nextStep)
    }

    if (snapshot.generatedScript) setIsGenerating(true)
  }

  const {
    persist: persistWorkflowSnapshot,
    restore: restoreWorkflowFromStorage,
    clear: clearWorkflowSnapshot,
    resume: resumeWorkflowPersistence,
  } = useWorkflowPersistence({
    getSnapshot: () => ({
      projectId: projectIdRef.current,
      workspaceId: workspaceIdRef.current,
      currentStep: currentStepRef.current,
      maxStepIndex: maxStepIndexRef.current,
      description: descriptionRef.current,
      generatedPrompt: generatedPromptRef.current,
      generatedScript: generatedScriptRef.current,
      creativeStoryboards: creativeStoryboardsRef.current,
      storyboardItems: storyboardItemsRef.current,
      timelineState: timelineStateRef.current,
      generatedVideoUrl: generatedVideoUrlRef.current,
      generatedVideoTask,
      generatedVideoAssetId: generatedVideoAssetIdRef.current,
      videoHistoryList,
      selectedDuration: selectedDurationRef.current,
      selectedRatio: selectedRatioRef.current,
      selectedStyles: selectedStylesRef.current,
      styleOptions: styleOptionsRef.current,
      selectedMaterials: selectedMaterialsRef.current,
      selectedPlatform: selectedPlatformRef.current,
      customStyle: customStyleRef.current,
      storyboardEditHistory: storyboardEditHistoryRef.current,
    }),
    applySnapshot: applyWorkflowSnapshot,
  } as any) as any

  function canEnterStep(step: string): boolean {
    if (step === 'script') {
      return true
    }

    if (step === 'storyboard') {
      const hasImages = storyboardItemsRef.current.some((item: any) => Boolean(item?.src))
      return Boolean(generatedScriptRef.current.trim()) || hasImages
    }

    if (step === 'timeline') {
      const hasImages = storyboardItemsRef.current.some((item: any) => Boolean(item?.src))
      return hasImages || (timelineStateRef.current?.segments || []).length > 0
    }

    if (step === 'video') {
      return Boolean(generatedVideoUrlRef.current) || (timelineStateRef.current?.segments || []).length > 0
    }

    return false
  }

  function switchToStep(step: string) {
    if (step === currentStepRef.current) {
      return
    }

    if (!canEnterStep(step)) {
      const reasons: Record<string, string> = {
        storyboard: '请先生成创意脚本',
        timeline: '请先完成分镜图片生成',
        video: '请先生成时间线',
      }
      showToastRef.current(reasons[step] || '当前阶段尚未就绪', 'error')
      return
    }

    if (step === 'script' && generatedScriptRef.current) {
      setIsGenerating(true)
    }

    setCurrentStep(step)
    setActiveMenu('')
    setLibraryOpen(false)
    setEditingStoryboardId('')
  }

  function pickFirstNonEmptyString(...values: any[]): string {
    for (const value of values) {
      const text = String(value ?? '').trim()
      if (text) return text
    }
    return ''
  }

  function resolveStoryboardCoverState(items: any[] = storyboardItemsRef.current) {
    const list = Array.isArray(items) ? items : []
    const generated = list
      .map((item: any, index: number) => {
        const url = pickFirstNonEmptyString(
          item?.src,
          item?.currentImage?.src,
          item?.current_image?.src,
          item?.versionHistory?.[Number(item?.currentVersionIndex || 0)]?.src,
          item?.version_history?.[Number(item?.current_version_index || 0)]?.src,
        )
        const assetId = toPositiveInt(
          item?.assetId ||
            item?.asset_id ||
            item?.currentImage?.assetId ||
            item?.current_image?.asset_id ||
            item?.versionHistory?.[Number(item?.currentVersionIndex || 0)]?.assetId,
        )
        return {
          id: String(item?.id || `storyboard-${index + 1}`),
          url,
          assetId,
        }
      })
      .filter((item: any) => item.url || item.assetId)

    const cover = generated[0] || null
    return {
      url: cover?.url || '',
      assetId: cover?.assetId || 0,
      storyboardCount: generated.length,
      key: generated.map((item: any) => `${item.id}:${item.url}:${item.assetId}`).join('|'),
    }
  }

  function buildProjectCoverSnapshot() {
    const cover = resolveStoryboardCoverState()
    if (!cover.url && !cover.assetId && !cover.storyboardCount) return null
    return {
      url: cover.url,
      assetId: cover.assetId,
      storyboardCount: cover.storyboardCount,
    }
  }

  function buildDraftSnapshot() {
    return {
      currentStep: currentStepRef.current,
      maxStepIndex: maxStepIndexRef.current,
      description: descriptionRef.current,
      generatedPrompt: generatedPromptRef.current,
      generatedScript: generatedScriptRef.current,
      creativeStoryboards: creativeStoryboardsRef.current,
      storyboardItems: storyboardItemsRef.current,
      storyboardEditHistory: storyboardEditHistoryRef.current,
      editingStoryboardId: editingStoryboardIdRef.current,
      selectedStoryboardId: selectedStoryboardIdRef.current,
      storyboardPreviewMaterials: storyboardPreviewMaterialsRef.current,
      timelineState: timelineStateRef.current,
      timelineAutoGenerated: timelineAutoGeneratedRef.current,
      timelineDirtyForVideo: timelineDirtyForVideoRef.current,
      generatedVideoUrl: generatedVideoUrlRef.current,
      generatedVideoTask,
      generatedVideoAssetId: generatedVideoAssetIdRef.current,
      videoHistoryList,
      selectedPlatform: selectedPlatformRef.current,
      selectedDuration: selectedDurationRef.current,
      selectedRatio: selectedRatioRef.current,
      selectedStyles: selectedStylesRef.current,
      styleOptions: styleOptionsRef.current,
      customStyle: customStyleRef.current,
      selectedMaterials: selectedMaterialsRef.current,
      projectCover: buildProjectCoverSnapshot(),
      libraryTab,
      libraryQuery,
      libraryContext: libraryContextRef.current,
    }
  }

  async function handleSaveDraft() {
    if (isSavingDraftRef.current) return
    if (isBlankModeRef.current) {
      showToastRef.current('当前是空白页，请先从「历史草稿」进入项目或创建新项目后再保存', 'info' as any)
      return
    }
    if (!projectIdRef.current) {
      showToastRef.current('缺少项目 ID，无法保存草稿', 'error')
      return
    }

    setIsSavingDraft(true)
    try {
      const snapshot = buildDraftSnapshot()
      const hasContent = !isDraftSnapshotEmpty(snapshot)
      let projectName = ''
      let versionLabel = ''
      if (hasContent) {
        if (!serverProjectTitleRef.current) {
          await loadProjectDraftMeta({ silent: true, apply: false })
        }
        const suggested =
          deriveProjectTitleFromDescription(descriptionRef.current) || serverProjectTitleRef.current || '创意项目'
        const picked = await requestConfirm('请输入项目名称', {
          title: '保存草稿',
          inputEnabled: true,
          inputValue: suggested,
          inputLabel: '项目名称',
          inputPlaceholder: suggested,
          confirmLabel: '保存',
        } as any)
        if (picked === null) {
          showToastRef.current('已取消保存草稿', 'info' as any)
          return
        }
        projectName = String(picked).trim() || suggested
        versionLabel = `草稿保存 ${new Date().toLocaleString('zh-CN', { hour12: false })}`
      }

      const ok = await putDraftSnapshot(snapshot)
      if (!ok) return

      if (hasContent) {
        const wsId = await resolveProjectWorkspaceId({ silent: true })
        if (wsId && projectName) {
          try {
            await patchCreativeProject({
              projectId: projectIdRef.current,
              workspaceId: wsId,
              title: projectName,
              name: projectName,
            })
            setServerProjectTitle(projectName)
            projectTitleSyncedRef.current = true
          } catch (error) {
            projectTitleSyncedRef.current = false
            void error
          }
        }
        await createCreativeProjectVersion({
          projectId: projectIdRef.current,
          workspaceId: wsId || workspaceIdRef.current,
          label: versionLabel,
        })
        if (versionDrawerOpenRef.current) {
          loadCreativeProjectVersions({ silent: true })
        }
        showToastRef.current('草稿已保存', 'success')
        setDirty(false)
        setDraftSavedDialogOpen(true)
        return
      }

      showToastRef.current('草稿已保存', 'success')
      setDirty(false)
      setDraftSavedDialogOpen(true)
    } catch (error) {
      showToastRef.current(getBusinessErrorMessage(error, '草稿保存失败，请稍后重试'), 'error')
    } finally {
      setIsSavingDraft(false)
    }
  }

  async function handleSaveVideo({ auto = false }: { auto?: boolean } = {}) {
    // auto=true 为视频生成成功后的自动保存：不满足前置条件时静默跳过，不向用户弹错误。
    if (isSavingVideoRef.current) return
    if (isBlankModeRef.current) {
      if (!auto) showToastRef.current('当前是空白页，请先从「历史草稿」进入项目后再保存视频', 'info' as any)
      return
    }
    if (!projectIdRef.current) {
      if (!auto) showToastRef.current('缺少项目 ID，无法保存视频', 'error')
      return
    }
    if (!generatedVideoUrlRef.current) {
      if (!auto) showToastRef.current('暂无可保存的视频，请先生成视频', 'error')
      return
    }
    isSavingVideoRef.current = true
    try {

    // 1. 先保存到本地历史记录
    saveVideoDraft()

    // 2. 持久化项目草稿（包含视频数据）
    try {
      const snapshot = buildDraftSnapshot()
      const ok = await putDraftSnapshot(snapshot, { silent: true })
      if (!ok) {
        showToastRef.current('视频已保存到历史记录，但草稿同步失败', 'error')
        return
      }

      // 3. 创建版本快照，使其出现在项目管理中
      let wsId = await resolveProjectWorkspaceId({ silent: true })
      if (!wsId) {
        // 降级：使用当前工作空间 ID 直接尝试，避免静默跳过
        wsId = Number(workspaceIdRef.current || 0) || (undefined as any)
      }
      if (wsId) {
        try {
          const versionLabel = `视频保存 ${new Date().toLocaleString('zh-CN', { hour12: false })}`
          await createCreativeProjectVersion({
            projectId: projectIdRef.current,
            workspaceId: wsId,
            label: versionLabel,
          })
          showToastRef.current('视频已保存到项目管理', 'success')
        } catch (versionError) {
          void versionError
          showToastRef.current('视频草稿已保存，但版本快照创建失败，请稍后重试', 'warning' as any)
        }
      } else {
        showToastRef.current('视频草稿已保存，但无法创建工作空间版本快照', 'warning' as any)
      }
      setDirty(false)
    } catch (error) {
      showToastRef.current(getBusinessErrorMessage(error, '视频保存失败，请稍后重试'), 'error')
    }
    } finally {
      isSavingVideoRef.current = false
    }
  }

  function normalizeJsonPayload(value: any): any {
    if (!value) return null
    if (typeof value === 'string') {
      try {
        return JSON.parse(value)
      } catch {
        return null
      }
    }
    if (typeof value === 'object') return value
    return null
  }

  function normalizeCreativeProjectDraft(payload: any): any {
    const candidates = [
      payload?.draft_json,
      payload?.draftJson,
      payload?.draft,
      payload?.data?.draft_json,
      payload?.data?.draft,
    ]
    for (const item of candidates) {
      const parsed = normalizeJsonPayload(item)
      if (parsed) return parsed
    }
    return null
  }

  function normalizeCreativeProjectDraftRevision(payload: any): number {
    const candidates = [
      payload?.draft_revision,
      payload?.draftRevision,
      payload?.draft_rev,
      payload?.draftRev,
      payload?.data?.draft_revision,
      payload?.data?.draftRevision,
    ]
    for (const value of candidates) {
      const n = Number(value)
      if (Number.isFinite(n) && n >= 0) return Math.floor(n)
    }
    return 0
  }

  function normalizeCreativeProjectVersions(payload: any): any[] {
    const raw = normalizeJsonPayload(payload) ?? payload
    const list = Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.items)
        ? raw.items
        : Array.isArray(raw?.list)
          ? raw.list
          : Array.isArray(raw?.versions)
            ? raw.versions
            : []
    return list.filter((item: any) => item && typeof item === 'object')
  }

  function normalizeCreativeProjectVersionDetail(payload: any, fallback: any = null) {
    const raw = normalizeJsonPayload(payload) ?? payload
    const version =
      (raw?.version && typeof raw.version === 'object'
        ? raw.version
        : raw?.data?.version && typeof raw.data.version === 'object'
          ? raw.data.version
          : raw?.data && typeof raw.data === 'object'
            ? raw.data
            : raw && typeof raw === 'object'
              ? raw
              : {}) || {}

    const draft =
      normalizeCreativeProjectDraft(version) ||
      normalizeCreativeProjectDraft(raw) ||
      normalizeJsonPayload(version?.snapshot_json) ||
      normalizeJsonPayload(version?.snapshotJson) ||
      normalizeJsonPayload(version?.snapshot) ||
      null

    return {
      version: {
        ...(fallback && typeof fallback === 'object' ? fallback : {}),
        ...version,
      },
      draft: draft && typeof draft === 'object' ? draft : null,
      raw,
    }
  }

  function resolveVersionId(item: any): number {
    return Number(item?.vid || item?.version_id || item?.versionId || item?.id || item?.version_no || 0)
  }

  function resolveVersionLabel(item: any): string {
    return String(item?.label || item?.name || item?.title || '').trim()
  }

  function isDraftSnapshotEmpty(snapshot: any): boolean {
    const s = snapshot && typeof snapshot === 'object' ? snapshot : {}
    const hasText = (v: any) => typeof v === 'string' && v.trim()
    const hasStoryboards = Array.isArray(s.storyboardItems) && s.storyboardItems.some((it: any) => Boolean(it?.src))
    const hasTimeline = (s.timelineState?.segments || []).length > 0
    const hasMaterials = Array.isArray(s.selectedMaterials) && s.selectedMaterials.length > 0
    const hasVideo = Boolean(s.generatedVideoUrl) || Number(s.generatedVideoAssetId || 0) > 0
    const hasBoards = Array.isArray(s.creativeStoryboards) && s.creativeStoryboards.length > 0

    return !(
      hasText(s.description) ||
      hasText(s.generatedPrompt) ||
      hasText(s.generatedScript) ||
      hasStoryboards ||
      hasTimeline ||
      hasMaterials ||
      hasVideo ||
      hasBoards
    )
  }

  async function loadProjectDraftMeta({ silent = false, apply = false }: { silent?: boolean; apply?: boolean } = {}) {
    if (!projectIdRef.current) {
      if (!silent) showToastRef.current('缺少项目 ID', 'error')
      return null
    }
    try {
      const wsId = await resolveProjectWorkspaceId({ silent: true })
      if (!wsId) {
        if (!silent) showToastRef.current('workspace_id 缺失', 'error')
        return null
      }
      saveLastCreativeProjectId(wsId, projectIdRef.current)
      const project = await getCreativeProject({ projectId: projectIdRef.current, workspaceId: wsId })
      setServerProjectTitle(normalizeProjectTitle(project))
      draftRevisionRef.current = normalizeCreativeProjectDraftRevision(project)
      const draft = normalizeCreativeProjectDraft(project)
      if (apply && draft) {
        applyWorkflowSnapshot(draft)
        persistWorkflowSnapshot()
        if (
          !restoringWorkflowFromStorageRef.current &&
          !projectTitleSyncedRef.current &&
          isUnnamedProjectTitle(serverProjectTitleRef.current)
        ) {
          syncProjectTitleByDescription(descriptionRef.current)
        }
      }
      return { project, draft }
    } catch (error) {
      if (!silent) showToastRef.current(getBusinessErrorMessage(error, '项目加载失败，请稍后重试'), 'error')
      return null
    }
  }

  async function putDraftSnapshot(
    snapshot: any,
    { silent = false, confirmOnConflict = true }: { silent?: boolean; confirmOnConflict?: boolean } = {},
  ): Promise<boolean> {
    if (!projectIdRef.current) {
      if (!silent) showToastRef.current('缺少项目 ID，无法保存草稿', 'error')
      return false
    }

    const wsId = await resolveProjectWorkspaceId({ silent: true })
    if (!wsId) {
      if (!silent) showToastRef.current('workspace_id 缺失，无法保存草稿', 'error')
      return false
    }

    if (!draftRevisionRef.current) {
      await loadProjectDraftMeta({ silent: true })
    }

    try {
      const payload = await updateCreativeProjectDraft({
        projectId: projectIdRef.current,
        workspaceId: wsId,
        draft: JSON.stringify(snapshot ?? {}),
        draftRevision: draftRevisionRef.current,
      })
      const nextRevision = normalizeCreativeProjectDraftRevision(payload)
      if (nextRevision || nextRevision === 0) {
        draftRevisionRef.current = nextRevision
      } else {
        await loadProjectDraftMeta({ silent: true })
      }
      return true
    } catch (error: any) {
      if (error?.status !== 409) {
        if (!silent) showToastRef.current(getBusinessErrorMessage(error, '草稿保存失败，请稍后重试'), 'error')
        return false
      }

      await loadProjectDraftMeta({ silent: true })
      if (!confirmOnConflict) return false
      const confirmed = await requestConfirm('草稿已在其他地方更新，是否使用当前内容覆盖保存？')
      if (!confirmed) return false

      try {
        const payload = await updateCreativeProjectDraft({
          projectId: projectIdRef.current,
          workspaceId: wsId,
          draft: JSON.stringify(snapshot ?? {}),
          draftRevision: draftRevisionRef.current,
        })
        const nextRevision = normalizeCreativeProjectDraftRevision(payload)
        if (nextRevision || nextRevision === 0) {
          draftRevisionRef.current = nextRevision
        }
        return true
      } catch (err2) {
        if (!silent) showToastRef.current(getBusinessErrorMessage(err2, '草稿保存失败，请稍后重试'), 'error')
        return false
      }
    }
  }

  function scheduleProjectCoverDraftSync() {
    if (projectCoverDraftSyncTimerRef.current) {
      clearTimeout(projectCoverDraftSyncTimerRef.current)
    }
    projectCoverDraftSyncTimerRef.current = setTimeout(() => {
      syncProjectCoverDraftSilently()
    }, 900)
  }

  async function syncProjectCoverDraftSilently() {
    if (projectCoverDraftSyncInFlightRef.current) return
    if (isBlankModeRef.current) return
    if (!projectIdRef.current) return
    if (restoringWorkflowFromStorageRef.current) return
    const cover = resolveStoryboardCoverState()
    if (!cover.url && !cover.assetId) return
    const nextKey = `${cover.key}|count:${cover.storyboardCount}`
    if (!nextKey || nextKey === lastProjectCoverDraftSyncKeyRef.current) return

    projectCoverDraftSyncInFlightRef.current = true
    try {
      const ok = await putDraftSnapshot(buildDraftSnapshot(), {
        silent: true,
        confirmOnConflict: false,
      })
      if (ok) {
        lastProjectCoverDraftSyncKeyRef.current = nextKey
      }
    } finally {
      projectCoverDraftSyncInFlightRef.current = false
    }
  }

  async function loadCreativeProjectVersions({ silent = false }: { silent?: boolean } = {}) {
    const pid = Number(versionTargetProjectIdRef.current || projectIdRef.current || 0)
    if (!pid) {
      if (!silent) showToastRef.current('缺少项目 ID，无法加载历史记录', 'error')
      return
    }
    if (isLoadingVersionsRef.current) return
    setIsLoadingVersions(true)
    try {
      const wsId = await resolveWorkspaceIdForProject(pid, {
        silent: true,
        preferredWorkspaceId: versionTargetWorkspaceIdRef.current,
      })
      if (!wsId) {
        if (!silent) showToastRef.current('workspace_id 缺失，无法加载历史记录', 'error')
        return
      }
      const payload = await listCreativeProjectVersions({
        projectId: pid,
        workspaceId: wsId,
      })
      const list = normalizeCreativeProjectVersions(payload)
      const sorted = list.slice().sort((a: any, b: any) => {
        const ano = Number(a?.version_no || a?.versionNo || 0)
        const bno = Number(b?.version_no || b?.versionNo || 0)
        if (Number.isFinite(ano) && Number.isFinite(bno) && (ano || bno)) {
          return bno - ano
        }
        const at = new Date(a?.created_at || a?.createdAt || 0).getTime()
        const bt = new Date(b?.created_at || b?.createdAt || 0).getTime()
        if (Number.isFinite(at) && Number.isFinite(bt) && (at || bt)) return bt - at
        return resolveVersionId(b) - resolveVersionId(a)
      })
      setVersionHistoryList(sorted)
      const currentSelected = Number(selectedVersionIdRef.current || 0)
      const nextSelected = sorted.find((item: any) => resolveVersionId(item) === currentSelected) || sorted[0] || null
      if (nextSelected) {
        await loadCreativeProjectVersionDetail(nextSelected, { silent: true })
      } else {
        setSelectedVersionId(0)
        setSelectedVersionDetail(null)
        setIsLoadingVersionDetail(false)
      }
    } catch (error) {
      if (!silent) showToastRef.current(getBusinessErrorMessage(error, '历史记录加载失败，请稍后重试'), 'error')
    } finally {
      setIsLoadingVersions(false)
    }
  }

  async function loadCreativeProjectVersionDetail(item: any, { silent = false }: { silent?: boolean } = {}) {
    const pid = Number(versionTargetProjectIdRef.current || projectIdRef.current || 0)
    const vid = resolveVersionId(item)
    if (!pid || !vid) {
      if (!silent) showToastRef.current('版本 ID 无效，无法加载版本详情', 'error')
      return
    }

    const wsId = await resolveWorkspaceIdForProject(pid, {
      silent: true,
      preferredWorkspaceId: versionTargetWorkspaceIdRef.current,
    })
    if (!wsId) {
      if (!silent) showToastRef.current('workspace_id 缺失，无法加载版本详情', 'error')
      return
    }

    const requestToken = ++versionDetailRequestTokenRef.current
    setSelectedVersionId(vid)
    setIsLoadingVersionDetail(true)

    try {
      const payload = await getCreativeProjectVersion({
        projectId: pid,
        workspaceId: wsId,
        vid,
      })
      if (requestToken !== versionDetailRequestTokenRef.current) return
      setSelectedVersionDetail(normalizeCreativeProjectVersionDetail(payload, item))
    } catch (error) {
      if (requestToken !== versionDetailRequestTokenRef.current) return
      setSelectedVersionDetail(normalizeCreativeProjectVersionDetail(item, item))
      if (!silent) showToastRef.current(getBusinessErrorMessage(error, '版本详情加载失败，请稍后重试'), 'error')
    } finally {
      if (requestToken === versionDetailRequestTokenRef.current) {
        setIsLoadingVersionDetail(false)
      }
    }
  }

  function openVersionHistoryForDraft(item: any) {
    const pid = Number(item?.id || 0)
    const wsId = Number(item?.workspaceId || 0)
    if (!pid) return
    setDraftHistoryOpen(false)
    setVersionTargetProjectId(pid)
    setVersionTargetWorkspaceId(wsId)
    setVersionDrawerOpen(true)
    setSelectedVersionId(0)
    setSelectedVersionDetail(null)
    loadCreativeProjectVersions()
  }

  function closeVersionHistoryDrawer() {
    setVersionDrawerOpen(false)
    versionDetailRequestTokenRef.current += 1
    setSelectedVersionId(0)
    setSelectedVersionDetail(null)
    setIsLoadingVersionDetail(false)
    setVersionTargetProjectId(0)
    setVersionTargetWorkspaceId(0)
  }

  async function loadDraftHistoryProjects({ silent = false }: { silent?: boolean } = {}) {
    if (draftHistoryLoadingRef.current) return
    let workspaceList = Array.isArray(allWorkspacesRef.current) ? allWorkspacesRef.current : []
    let ids = workspaceList.length ? workspaceList.map((w: any) => Number(w?.id || 0)).filter((id: number) => id > 0) : []
    let uniqueIds = [...new Set(ids)]

    if (!uniqueIds.length && typeof loadWorkspaces === 'function') {
      await loadWorkspaces()
      workspaceList = Array.isArray(allWorkspacesRef.current) ? allWorkspacesRef.current : []
      ids = workspaceList.length ? workspaceList.map((w: any) => Number(w?.id || 0)).filter((id: number) => id > 0) : []
      uniqueIds = [...new Set(ids)]
    }

    if (!uniqueIds.length && !workspaceIdRef.current) {
      if (!silent) showToastRef.current('workspace_id 缺失，无法加载历史草稿', 'error')
      return
    }

    setDraftHistoryLoading(true)
    try {
      const tasks = (uniqueIds.length ? uniqueIds : [workspaceIdRef.current]).map((id: number) =>
        listCreativeProjects({ workspaceId: id, limit: 50 }).then((items: any) => ({ id, items })),
      )
      const settled = await Promise.allSettled(tasks)
      const merged: any[] = []
      settled.forEach((res: any) => {
        if (res.status !== 'fulfilled') return
        const wsId = Number(res.value?.id || 0)
        const items = Array.isArray(res.value?.items) ? res.value.items : []
        const ws = workspaceList.find((w: any) => Number(w?.id || 0) === wsId)
        items.forEach((item: any) => {
          if (!item || typeof item !== 'object') return
          merged.push({
            ...item,
            workspaceId: wsId,
            workspaceName: ws?.name || '',
          })
        })
      })
      merged.sort((a: any, b: any) => {
        const at = new Date(a?.updated_at || a?.updatedAt || a?.created_at || a?.createdAt || 0).getTime()
        const bt = new Date(b?.updated_at || b?.updatedAt || b?.created_at || b?.createdAt || 0).getTime()
        if (Number.isFinite(at) && Number.isFinite(bt) && (at || bt)) return bt - at
        return Number(b?.id || 0) - Number(a?.id || 0)
      })
      setDraftHistoryProjects(merged)
    } catch (error) {
      if (!silent) showToastRef.current(getBusinessErrorMessage(error, '历史草稿加载失败，请稍后重试'), 'error')
    } finally {
      setDraftHistoryLoading(false)
    }
  }

  function openDraftHistory() {
    setDraftHistoryOpen(true)
    loadDraftHistoryProjects({ silent: false })
  }

  function continueFromDraftProject(item: any) {
    const id = Number(item?.id || 0)
    const wsId = Number(item?.workspaceId || 0)
    if (!id) return
    setDraftHistoryOpen(false)
    if (wsId && wsId !== workspaceIdRef.current) {
      switchWorkspace(wsId)
    }
    navigate(`/creative/${id}`)
  }

  async function deleteDraftProject(item: any) {
    if (isDeletingDraftProjectRef.current) return
    const id = Number(item?.id || 0)
    const wsId = Number(item?.workspaceId || 0)
    if (!id) return
    if (!wsId) {
      showToastRef.current('workspace_id 缺失，无法删除草稿', 'error')
      return
    }
    const title = String(item?.name || item?.title || `项目 #${id}`).trim()
    const confirmed = await requestConfirm(`确定删除「${title}」吗？删除后不可恢复。`, { danger: true })
    if (!confirmed) return
    setIsDeletingDraftProject(true)
    try {
      await deleteCreativeProject({ projectId: id, workspaceId: wsId })
      if (projectIdRef.current && id === projectIdRef.current) {
        navigate('/creative/blank', { replace: true })
      }
      await loadDraftHistoryProjects({ silent: true })
      showToastRef.current('历史草稿已删除', 'success')
    } catch (error) {
      showToastRef.current(getBusinessErrorMessage(error, '历史草稿删除失败，请稍后重试'), 'error')
    } finally {
      setIsDeletingDraftProject(false)
    }
  }

  async function deleteDraftProjects(items: any) {
    if (isDeletingDraftProjectRef.current) return
    const list = Array.isArray(items) ? items : []
    const normalized = list
      .map((item: any) => ({
        projectId: Number(item?.id || 0),
        workspaceId: Number(item?.workspaceId || 0),
        title: String(item?.name || item?.title || '').trim(),
      }))
      .filter((row: any) => row.projectId > 0 && row.workspaceId > 0)
    if (!normalized.length) return

    const confirmed = await requestConfirm(`确定批量删除 ${normalized.length} 个草稿吗？删除后不可恢复。`, {
      danger: true,
    })
    if (!confirmed) return

    setIsDeletingDraftProject(true)
    try {
      const tasks = normalized.map((row: any) =>
        deleteCreativeProject({ projectId: row.projectId, workspaceId: row.workspaceId }).then(
          () => ({ ok: true, row }),
          (error: any) => ({ ok: false, row, error }),
        ),
      )
      const settled = await Promise.all(tasks)
      const okCount = settled.filter((res: any) => res.ok).length
      const failCount = settled.length - okCount

      if (projectIdRef.current && normalized.some((row: any) => row.projectId === projectIdRef.current)) {
        navigate('/creative/blank', { replace: true })
      }

      await loadDraftHistoryProjects({ silent: true })

      if (!failCount) {
        showToastRef.current(`已删除 ${okCount} 个草稿`, 'success')
      } else {
        showToastRef.current(`已删除 ${okCount} 个，失败 ${failCount} 个`, 'error')
      }
    } catch (error) {
      showToastRef.current(getBusinessErrorMessage(error, '批量删除失败，请稍后重试'), 'error')
    } finally {
      setIsDeletingDraftProject(false)
    }
  }

  async function saveCreativeProjectVersion({ label, silent = false }: any = {}): Promise<boolean> {
    if (isSavingVersionRef.current) return false
    if (!projectIdRef.current) {
      if (!silent) showToastRef.current('缺少项目 ID，无法保存版本', 'error')
      return false
    }
    const wsId = await resolveProjectWorkspaceId({ silent: true })
    if (!wsId) {
      if (!silent) showToastRef.current('workspace_id 缺失，无法保存版本', 'error')
      return false
    }
    const note = String(label || '').trim()
    if (!note) {
      if (!silent) showToastRef.current('请输入版本备注', 'error')
      return false
    }
    const snapshot = buildDraftSnapshot()
    if (isDraftSnapshotEmpty(snapshot)) {
      if (!silent) showToastRef.current('版本内容为空，无法保存', 'error')
      return false
    }

    setIsSavingVersion(true)
    try {
      const ok = await putDraftSnapshot(snapshot, { silent })
      if (!ok) return false
      await createCreativeProjectVersion({
        projectId: projectIdRef.current,
        workspaceId: wsId,
        label: note,
      })
      await loadCreativeProjectVersions({ silent: true })
      if (!silent) showToastRef.current('版本已保存', 'success')
      return true
    } catch (error) {
      if (!silent) showToastRef.current(getBusinessErrorMessage(error, '版本保存失败，请稍后重试'), 'error')
      return false
    } finally {
      setIsSavingVersion(false)
    }
  }

  async function deleteCreativeProjectVersionByItem(item: any) {
    if (isDeletingVersionRef.current) return
    const pid = Number(versionTargetProjectIdRef.current || projectIdRef.current || 0)
    if (!pid) {
      showToastRef.current('缺少项目 ID，无法删除历史记录', 'error')
      return
    }
    const wsId = await resolveWorkspaceIdForProject(pid, {
      silent: true,
      preferredWorkspaceId: versionTargetWorkspaceIdRef.current,
    })
    if (!wsId) {
      showToastRef.current('workspace_id 缺失，无法删除历史记录', 'error')
      return
    }
    const vid = resolveVersionId(item)
    if (!vid) {
      showToastRef.current('版本 ID 无效，无法删除', 'error')
      return
    }
    const label = resolveVersionLabel(item) || `版本 ${vid}`
    const confirmed = await requestConfirm(`确定删除「${label}」吗？删除后不可恢复。`, { danger: true })
    if (!confirmed) return
    setIsDeletingVersion(true)
    try {
      await deleteCreativeProjectVersion({
        projectId: pid,
        workspaceId: wsId,
        vid,
      })
      await loadCreativeProjectVersions({ silent: true })
      showToastRef.current('历史记录已删除', 'success')
    } catch (error) {
      showToastRef.current(getBusinessErrorMessage(error, '历史记录删除失败，请稍后重试'), 'error')
    } finally {
      setIsDeletingVersion(false)
    }
  }

  async function restoreCreativeProjectVersionByItem(item: any) {
    if (isRestoringVersionRef.current) return
    const pid = Number(versionTargetProjectIdRef.current || projectIdRef.current || 0)
    const restoringFromDraft = Boolean(versionTargetProjectIdRef.current && pid !== projectIdRef.current)
    if (!pid) {
      showToastRef.current('缺少项目 ID，无法恢复版本', 'error')
      return
    }
    const wsId = await resolveWorkspaceIdForProject(pid, {
      silent: true,
      preferredWorkspaceId: versionTargetWorkspaceIdRef.current,
    })
    if (!wsId) {
      showToastRef.current('workspace_id 缺失，无法恢复版本', 'error')
      return
    }
    const vid = resolveVersionId(item)
    if (!vid) {
      showToastRef.current('版本 ID 无效，无法恢复', 'error')
      return
    }

    const label = resolveVersionLabel(item) || `版本 ${vid}`
    const confirmed = await requestConfirm(`确定恢复到「${label}」吗？当前未保存的内容将丢失。`)
    if (!confirmed) return

    setIsRestoringVersion(true)
    try {
      await restoreCreativeProjectVersion({
        projectId: pid,
        workspaceId: wsId,
        vid,
      })
      setVersionDrawerOpen(false)
      if (restoringFromDraft || isBlankModeRef.current) {
        if (wsId && wsId !== workspaceIdRef.current) {
          switchWorkspace(wsId)
        }
        navigate(`/creative/${pid}`)
        showToastRef.current(`已恢复到「${label}」`, 'success')
        return
      }

      const meta = await loadProjectDraftMeta({ silent: true, apply: false })
      const restored = normalizeCreativeProjectDraft(meta?.project)
      if (!restored || !meta?.project) {
        throw new Error('未获取到草稿内容')
      }
      applyWorkflowSnapshot(restored)
      draftRevisionRef.current = normalizeCreativeProjectDraftRevision(meta.project)
      persistWorkflowSnapshot()
      showToastRef.current(`已恢复到「${label}」`, 'success')
    } catch (error) {
      showToastRef.current(getBusinessErrorMessage(error, '版本恢复失败，请稍后重试'), 'error')
    } finally {
      setIsRestoringVersion(false)
    }
  }

  function handleRedraw() {
    clearWorkflowSnapshot()
    abortAllPendingTasks()
    cancelInFlightStoryboard()
    resetStoryboard()
    resetVideo()

    setDescription('')
    setGeneratedPrompt('')
    setGeneratedScript('')
    setGenerationPending(false)
    setIsUploadingSelected(false)
    setIsUploadingLibrary(false)
    setIsLoadingLibrary(false)
    setAssetsLoaded(false)
    setIsGenerating(false)
    setIsScriptStreaming(false)
    setIsSubmittingScript(false)

    setSelectedPlatform('抖音')
    setSelectedDuration('10s')
    setSelectedRatio('9:16')
    setSelectedStyles(['叫卖型', '幽默', '商业'])
    setCustomStyle('')

    setCreativeStoryboards([])
    setStoryboardEditHistory({})
    setStoryboardPreviewMaterials([])
    setEditingStoryboardId('')
    setSelectedStoryboardId('')
    setPreviewMaterial(null)
    setTimelineState({ segments: [], voiceover: [], subtitle: [], sfx: [] })
    setTimelineAutoGenerated(false)
    timelineDirtyForVideoRef.current = false

    setActiveMenu('')
    setLibraryOpen(false)
    setLibraryTab('mine')
    setLibraryQuery('')
    libraryContextRef.current = 'default'
    setSelectedMaterialsAction([])

    setCurrentStep('script')
    setMaxStepIndex(0)

    queueMicrotask(() => {
      resumeWorkflowPersistence()
    })

    showToastRef.current('已重新绘制，所有编辑内容已清空', 'success')
    setDirty(false)
  }

  // ── 持久化 + maxStepIndex 推进（对应 deep watch）──
  useEffect(() => {
    const steps = ['script', 'storyboard', 'timeline', 'video']
    const nextIndex = steps.indexOf(currentStepRef.current)
    if (nextIndex > maxStepIndexRef.current) {
      setMaxStepIndex(nextIndex)
    }
    persistWorkflowSnapshot()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentStep,
    maxStepIndex,
    description,
    generatedPrompt,
    generatedScript,
    creativeStoryboards,
    storyboardItems,
    timelineState,
    generatedVideoUrl,
    generatedVideoTask,
    generatedVideoAssetId,
    selectedDuration,
    selectedRatio,
    selectedStyles,
    styleOptions,
    selectedMaterials,
    // 这些字段也进入 getSnapshot，必须纳入依赖，否则只改它们时防抖落盘不触发
    selectedPlatform,
    customStyle,
    storyboardEditHistory,
  ])

  // ── Dirty tracking ──
  const dirtyTrackInitedRef = useRef(false)
  useEffect(() => {
    // 跳过首挂载（对应 Vue watch 默认不立即触发）
    if (!dirtyTrackInitedRef.current) {
      dirtyTrackInitedRef.current = true
      return
    }
    if (!isBlankModeRef.current && !restoringWorkflowFromStorageRef.current) {
      setDirty(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    description,
    generatedPrompt,
    generatedScript,
    creativeStoryboards,
    storyboardItems,
    timelineState,
    generatedVideoUrl,
    selectedMaterials,
    selectedPlatform,
    customStyle,
    storyboardEditHistory,
  ])

  // ── Page-close guard (browser-native prompt) ──
  const handleBeforeUnload = useCallback((event: BeforeUnloadEvent) => {
    if (getDirty() && !isBlankModeRef.current) {
      event.preventDefault()
      event.returnValue = '' // Required for Chrome
    }
     
  }, [])

  function registerCreativeDebugBridge() {
    if (!import.meta.env.DEV || typeof window === 'undefined') return
    const debugBridge = {
      generateScriptWord,
      get creativeStoryboards() {
        return creativeStoryboardsRef.current
      },
    }
    ;(window as any)[CREATIVE_DEBUG_KEY] = debugBridge
  }

  function unregisterCreativeDebugBridge() {
    if (!import.meta.env.DEV || typeof window === 'undefined') return
    delete (window as any)[CREATIVE_DEBUG_KEY]
  }

  // ── onMounted / onBeforeUnmount ──
  // 仅挂载执行一次
  useEffect(() => {
    // 复制到局部变量，供 cleanup 使用（避免 cleanup 时 ref.current 已变化）
    const createdObjectUrls = createdObjectUrlsRef.current
    window.addEventListener('pointerdown', handleGlobalPointerDown, true)
    window.addEventListener('beforeunload', handleBeforeUnload)
    registerCreativeDebugBridge()

    if (isBlankModeRef.current) {
      clearWorkflowSnapshot()
      restoringWorkflowFromStorageRef.current = false
      queueMicrotask(() => {
        openDraftHistory()
      })
    } else {
      restoringWorkflowFromStorageRef.current = true
      const restored = restoreWorkflowFromStorage()
      queueMicrotask(async () => {
        const sameProject = Number(restored?.projectId || 0) === Number(projectIdRef.current || 0)
        const preferLocal = sameProject && restored && !isDraftSnapshotEmpty(restored)
        await loadProjectDraftMeta({ silent: true, apply: !preferLocal })
        restoringWorkflowFromStorageRef.current = false
        hydrateSelectedMaterialUrls({ silent: true })
        hydrateStoryboardUrls()

        // 切走页面再回来时，未完成的分镜处于 submitting 状态但轮询已中断，自动续跑
        if (storyboardItemsRef.current.some((item: any) => item.status === 'submitting')) {
          await ensureModelPlanCandidatesLoaded()
          await startStoryboardGeneration({ resume: true, silent: true })
        }
      })
    }
    // AppLayout 已在挂载时加载计费候选，这里再触发一次确保生成逻辑可用。
    ensureModelPlanCandidatesLoaded()

    return () => {
      window.removeEventListener('pointerdown', handleGlobalPointerDown, true)
      window.removeEventListener('beforeunload', handleBeforeUnload)
      unregisterCreativeDebugBridge()
      cancelInFlightStoryboard()
      abortAllPendingTasks()
      createdObjectUrls.forEach((url) => URL.revokeObjectURL(url))
      if (projectCoverDraftSyncTimerRef.current) {
        clearTimeout(projectCoverDraftSyncTimerRef.current)
        projectCoverDraftSyncTimerRef.current = 0
      }
      if (projectTitleSyncTimerRef.current) {
        clearTimeout(projectTitleSyncTimerRef.current)
        projectTitleSyncTimerRef.current = 0
      }
    }
    // 仅挂载时执行一次，刻意省略依赖，复刻原 Vue onMounted 语义
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── watch(projectId) ──
  const prevProjectIdRef = useRef<number | undefined>(undefined)
  useEffect(() => {
    const next = projectId
    const prev = prevProjectIdRef.current
    prevProjectIdRef.current = next
    if (prev === undefined) return // 跳过初始挂载（与 Vue watch 默认行为一致）
    if (!next || next === prev) return
    ;(async () => {
      lastProjectCoverDraftSyncKeyRef.current = ''
      setServerProjectTitle('')
      projectTitleSyncedRef.current = false
      if (projectTitleSyncTimerRef.current) {
        clearTimeout(projectTitleSyncTimerRef.current)
        projectTitleSyncTimerRef.current = 0
      }
      resumeWorkflowPersistence()
      restoringWorkflowFromStorageRef.current = true
      await loadProjectDraftMeta({ silent: true, apply: true })
      restoringWorkflowFromStorageRef.current = false
      hydrateSelectedMaterialUrls({ silent: true })
      hydrateStoryboardUrls()
      ensureModelPlanCandidatesLoaded()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  // ── watch(currentStep) 进入「分镜图片」步骤 → 刷新分镜图签名 URL ──
  // OSS 预签名地址会过期：最早生成的几张分镜（典型如走完视频生成再跳回分镜步骤）
  // 签名会先失效导致图片空白。每次进入该步骤按 assetId 重新签名，自愈过期 URL。
  useEffect(() => {
    if (currentStep !== 'storyboard') return
    if (storyboardGeneratingRef.current) return
    if (!storyboardItemsRef.current.length) return
    hydrateStoryboardUrls()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep])

  // ── watch(currentStep) 进入「视频生成」步骤 → 刷新视频签名 URL ──
  // 同分镜图：OSS/S3 预签名地址会过期，历史视频与当前视频在往返后需按 assetId 重新签名，
  // 否则点击播放/缩略图失败。refreshAllHistoryUrls 之前已实现但从未被调用。
  useEffect(() => {
    if (currentStep !== 'video') return
    if (isVideoGeneratingRef.current) return
    refreshAllHistoryUrls()
    if (generatedVideoAssetIdRef.current) refreshGeneratedVideoUrl(generatedVideoAssetIdRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep])

  // ── watch(description) → 自动同步项目标题 ──
  const prevDescriptionRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    const next = description
    const prev = prevDescriptionRef.current
    prevDescriptionRef.current = next
    if (prev === undefined) return // 跳过初始挂载
    if (isBlankModeRef.current) return
    if (!projectIdRef.current) return
    if (restoringWorkflowFromStorageRef.current) return
    if (projectTitleSyncedRef.current) return
    if (!isUnnamedProjectTitle(serverProjectTitleRef.current)) {
      projectTitleSyncedRef.current = true
      return
    }

    const nextText = String(next || '').trim()
    if (!nextText) return

    if (projectTitleSyncTimerRef.current) clearTimeout(projectTitleSyncTimerRef.current)
    const shouldTreatAsFirstFill = !String(prev || '').trim()
    if (!shouldTreatAsFirstFill && serverProjectTitleRef.current) return
    projectTitleSyncTimerRef.current = setTimeout(() => {
      syncProjectTitleByDescription(nextText)
    }, 600)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [description])

  // ── watch(workspaceId) ── 切换空间：素材按空间隔离，需重置并重新拉取。
  const prevWorkspaceIdRef = useRef<number | undefined>(undefined)
  useEffect(() => {
    const next = workspaceId
    const prev = prevWorkspaceIdRef.current
    prevWorkspaceIdRef.current = next
    if (prev === undefined) return // 跳过初始挂载
    setAssetsLoaded(false)
    if (next) loadWorkspaceAssets({ silent: true })

    if (next) {
      hydrateSelectedMaterialUrls({ silent: true })
      hydrateStoryboardUrls()
    }

    if (next && generatedVideoAssetIdRef.current) {
      refreshGeneratedVideoUrl(generatedVideoAssetIdRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  // dirtyRef 与 store 同步（供潜在用途）
  dirtyRef.current = getDirty()

  return renderBody()

   
  function renderBody(): any {
    return (
      <AppLayout activeNav="分步创作" onLogoutSuccess={() => props.onLogoutSuccess?.()}>
        <AppToast />
        <DraftSavedDialog
          open={draftSavedDialogOpen}
          onClose={() => setDraftSavedDialogOpen(false)}
          onOpenHistory={() => {
            setDraftSavedDialogOpen(false)
            openDraftHistory()
          }}
        />
        <CreativeTopbar
          activeStep={currentStep}
          maxStepIndex={maxStepIndex}
          projectName={displayProjectName}
          disableSaveDraft={isBlankMode}
          onSaveDraft={handleSaveDraft}
          onOpenDrafts={openDraftHistory}
          onRedraw={handleRedraw}
          onSwitchStep={switchToStep}
        />

        <CreativeDraftHistoryDrawer
          open={draftHistoryOpen}
          projects={draftHistoryProjects}
          loading={draftHistoryLoading}
          deleting={isDeletingDraftProject}
          currentWorkspaceId={workspaceId}
          currentProjectId={projectId}
          onClose={() => setDraftHistoryOpen(false)}
          onSelect={continueFromDraftProject}
          onVersions={openVersionHistoryForDraft}
          onDelete={deleteDraftProject}
          onDeleteMany={deleteDraftProjects}
        />

        <CreativeVersionHistoryDrawer
          open={versionDrawerOpen}
          versions={versionHistoryList}
          loading={isLoadingVersions}
          saving={isSavingVersion}
          deleting={isDeletingVersion}
          restoring={isRestoringVersion}
          selectedVersionId={selectedVersionId}
          detail={selectedVersionDetail}
          detailLoading={isLoadingVersionDetail}
          allowSave={!isBlankMode && !versionTargetProjectId}
          onClose={closeVersionHistoryDrawer}
          onSave={(label: any) => saveCreativeProjectVersion({ label })}
          onSelect={loadCreativeProjectVersionDetail}
          onRestore={restoreCreativeProjectVersionByItem}
          onDelete={deleteCreativeProjectVersionByItem}
        />

        <div className="main-canvas"></div>

        {isBlankMode ? (
          <div className="creative-empty">
            <div className="creative-empty-card">
              <strong>开始创作</strong>
              <p>重新登录默认进入空白页。请在「历史草稿」里选择你之前的项目继续编辑，或创建新项目。</p>
              <div className="creative-empty-actions">
                <button type="button" className="creative-empty-primary" onClick={openDraftHistory}>
                  从历史草稿继续
                </button>
                <button
                  type="button"
                  className="creative-empty-secondary"
                  onClick={() => navigate('/creative')}
                >
                  创建新项目
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div key={currentStep}>
              {currentStep === 'script' && <CreativeHeroTitle headerStyle={headerStyle} />}

              {currentStep === 'script' && !isGenerating ? (
                <PromptComposer
                  panelStyle={promptStyle}
                  description={description}
                  activeMenu={activeMenu}
                  selectedDuration={selectedDuration}
                  selectedRatio={selectedRatio}
                  selectedStyleText={selectedStyleText}
                  durations={durations}
                  ratios={ratios}
                  styleOptions={styleOptions}
                  selectedStyles={selectedStyles}
                  customStyle={customStyle}
                  isUploading={isUploadingSelected}
                  isGenerating={isSubmittingScript}
                  onUpdateDescription={(v: string) => setDescription(v)}
                  onUpdateCustomStyle={(v: string) => setCustomStyle(v)}
                  onFilesUpload={handleSelectedFiles}
                  onToggleMenu={toggleMenu}
                  onSelectOption={selectOption}
                  onToggleStyle={toggleStyle}
                  onAddCustomStyle={addCustomStyle}
                  onGenerate={generateScript}
                />
              ) : currentStep === 'script' ? (
                <GeneratedScriptPanel
                  panelStyle={promptStyle}
                  compactMaterialStack={compactMaterialStack}
                  compactPromptText={compactPromptText}
                  promptText={compactPromptText}
                  activeMenu={activeMenu}
                  selectedDuration={selectedDuration}
                  selectedRatio={selectedRatio}
                  selectedStyleText={selectedStyleText}
                  durations={durations}
                  ratios={ratios}
                  styleOptions={styleOptions}
                  selectedStyles={selectedStyles}
                  customStyle={customStyle}
                  generatedScript={generatedScript}
                  isPending={generationPending || isSubmittingScript}
                  isStreaming={isScriptStreaming}
                  canGenerateStoryboard={canGenerateStoryboard}
                  onOpenLibrary={openLibrary}
                  onToggleMenu={toggleMenu}
                  onSelectOption={selectOption}
                  onToggleStyle={toggleStyle}
                  onCustomStyleChange={(v: string) => setCustomStyle(v)}
                  onAddCustomStyle={addCustomStyle}
                  onGenerate={generateScript}
                  onCopy={copyScript}
                  onRegenerate={regenerateScript}
                  onGeneratedScriptChange={(v: string) => setGeneratedScript(v)}
                  onGenerateStoryboard={generateStoryboard}
                  onStoryboardsParsed={handleStoryboardsParsed}
                  onStoryboardsUpdated={handleStoryboardsUpdated}
                  onRemoveMaterial={removeSelectedMaterial}
                  onPromptTextChange={updatePromptTextFromPanel}
                />
              ) : null}

              {currentStep === 'script' && !isGenerating && selectedMaterials.length ? (
                <SelectedMaterials
                  panelStyle={selectedStyleBox}
                  materials={selectedMaterials}
                  onPreview={previewSelectedMaterial}
                  onRemove={removeSelectedMaterial}
                  onOpenLibrary={openLibrary}
                />
              ) : null}

              {currentStep === 'storyboard' && (
                <StoryboardGenerationPanel
                  panelStyle={storyboardStyle}
                  isLibraryOpen={libraryOpen}
                  selectedRatio={selectedRatio}
                  items={storyboardItems}
                  total={storyboardTotal}
                  generatedCount={storyboardGeneratedCount}
                  isGenerating={storyboardGenerating}
                  nextTitle={nextStoryboardTitle}
                  canGenerateTimeline={canGenerateTimeline}
                  historyItems={storyboardSelectedHistoryItems}
                  isSubmittingEdit={isModifyingStoryboardImage}
                  insertIdeaText={insertIdeaText}
                  insertIdeaLoading={insertIdeaLoading}
                  selectedMaterials={storyboardPreviewMaterials}
                  onPreview={openStoryboardEditor}
                  onRemove={removeStoryboardItem}
                  onReorder={reorderStoryboardItems}
                  onRegenerate={regenerateStoryboard}
                  onGenerateStoryboard={generateStoryboard}
                  onGenerateTimeline={generateTimeline}
                  onSelectItem={handleSelectStoryboardItem}
                  onModifyImage={modifyStoryboardFromPanel}
                  onStepImageVersion={stepStoryboardVersionFromPanel}
                  onSetImageVersion={setStoryboardVersionFromPanel}
                  onRemoveImageVersion={removeStoryboardVersionFromPanel}
                  onInsertItem={insertStoryboardItem}
                  onSuggestInsertIdea={suggestInsertIdea}
                  onResetInsertIdea={resetInsertIdea}
                  onOpenLibrary={openLibraryForStoryboardEditor}
                  onRemoveMaterial={removeStoryboardPreviewMaterial}
                  onUploadReplaceStoryboard={handleDirectReplaceStoryboardImage}
                  onUploadInsertStoryboard={handleDirectInsertStoryboardImage}
                  onAnalyzeReferenceImage={handleAnalyzeReferenceImage}
                  onCancelAiAnalyze={cancelAiAnalyzeRequest}
                />
              )}

              {currentStep === 'timeline' && (
                <TimelineEditorPanel
                  panelStyle={timelineStyle}
                  selectedRatio={selectedRatio}
                  storyboardItems={storyboardItems}
                  storyboards={creativeStoryboards}
                  timeline={timelineState}
                  totalDuration={timelineTotalDuration}
                  isReloading={timelineReloading}
                  reloadReady={timelineReloadReady}
                  videoCostEstimate={videoCostEstimate}
                  isEstimatingVideoCost={isEstimatingVideoCost}
                  videoCostEstimateError={videoCostEstimateError}
                  onEstimateVideoCost={estimateVideoCost}
                  onUpdateTimeline={handleTimelineUpdate}
                  onUpdateStoryboardPrompt={handleTimelineStoryboardPromptUpdate}
                  onSynced={handleTimelineSynced}
                  onGenerateVideo={generateVideo}
                  onReload={reloadTimeline}
                  onApproveReload={approveTimelineReload}
                  onComingSoon={(label: string) => showToastRef.current(`${label}功能即将开放`, 'success')}
                />
              )}

              {currentStep === 'video' && (
                <VideoGenerationPanel
                  panelStyle={videoStyle}
                  videoUrl={generatedVideoUrl}
                  isGenerating={isVideoGenerating}
                  generationProgress={videoProgress}
                  taskStatus={generatedVideoTask?.status || ''}
                  selectedDuration={selectedDuration}
                  selectedRatio={selectedRatio}
                  selectedPlatform={selectedPlatform}
                  selectedStyleText={selectedStyleText}
                  creativePrompt={storyboardOutline || generatedPrompt || description}
                  projectName={projectTitle}
                  videoHistory={videoHistoryList}
                  activeHistoryId={activeVideoHistoryId}
                  onRegenerate={regenerateVideo}
                  onModifyVideo={modifyVideoWithPrompt}
                  onSelectHistory={handleSelectVideoHistory}
                  onDeleteHistory={deleteVideoHistoryItem}
                  onSaveDraft={saveVideoDraft}
                  onSaveVideo={handleSaveVideo}
                  onDownloadVideo={handleDownloadVideo}
                  onPublishVideo={publishVideo}
                  onNotify={handleVideoNotify}
                />
              )}
            </div>

            <StoryboardEditDialog
              item={editingStoryboardItem}
              itemIndex={editingStoryboardIndex}
              materials={selectedMaterials as StoryboardEditMaterial[]}
              historyItems={storyboardHistoryItems}
              isSubmitting={isModifyingStoryboardImage}
              onClose={closeStoryboardEditor}
              onConfirm={confirmStoryboardEdit}
              onOpenLibrary={openLibrary}
              onRemoveMaterial={removeSelectedMaterial}
            />

            <MaterialLibraryPicker
              modelValue={libraryOpen}
              onModelValueChange={(v: boolean) => setLibraryOpen(v)}
              workspaceId={workspaceId}
              projectName={projectTitle}
              materials={filteredLibraryMaterials}
              selectedMaterialIds={selectedMaterialIds}
              tab={libraryTab}
              query={libraryQuery}
              isLoading={isLoadingLibrary}
              isUploading={isUploadingLibrary}
              onTabChange={(v: string) => setLibraryTab(v)}
              onQueryChange={(v: string) => setLibraryQuery(v)}
              onFilesUpload={handleLibraryFiles}
              onConfirm={addMaterialsFromLibrary}
              onBatchDelete={removeMaterialsFromLibrary}
            />

            <MaterialPreviewModal
              material={previewMaterial}
              onClose={closePreview}
              onRemove={removeSelectedMaterial}
            />
          </>
        )}
      </AppLayout>
    )
  }
}
