/**
 * Composable: 分镜图生成编排
 * 管理分镜图批量生成、单张修改、插入/替换、版本历史、图片上传、人脸脱敏等全流程。
 * 采用 deps-injection 模式接收外层状态和回调。
 *
 * React 迁移说明：原 Vue ref 状态改为暴露在返回对象上的 React state（通过 useState），
 * 而内部编排逻辑大量依赖"读到最新值并同步推导"，因此内部统一改用 useRef 持有可变状态，
 * 并提供 setXxx 包装同步刷新 React state 触发渲染。deps 中传入的"外层状态"以 { value } 形式
 * （RefLike）保持与原 Vue ref 兼容的读写接口。
 */
import { useCallback, useRef, useState } from 'react'
import { toPositiveInt } from '../utils/common'
import {
  createAiTask,
  deleteAsset,
  extractAssetPageItems,
  getBusinessErrorMessage,
  isAbortedTaskError,
  listAiModels,
  listAssets,
  uploadAssetFile,
  waitForAiTask,
} from '../api/business'
import { resolveGeneratedMediaUrls } from '../utils/taskMedia'
import { buildFallbackStoryboards } from '../utils/creativeScript'
import { buildStoryboardEditInputAssets, buildStoryboardImageParams } from '../utils/storyboardTasks'
import { sanitizeMediaUrl } from '../utils/urlSafety'
import { isImageMaterial } from '../utils/materials'

const STORYBOARD_MODEL_KEYWORDS = ['seedream', 'seeddream', 'doubao-seedream']
const STORYBOARD_POLL_INTERVAL_MS = 2000
const STORYBOARD_POLL_TIMEOUT_MS = 5 * 60 * 1000
const MAX_STORYBOARDS = 9
const STORYBOARD_HISTORY_LIMIT = 10
const REFERENCE_PROMPT_SUFFIX =
  '\n请将参考图中的主体元素自然融入当前场景，确保像真实道具/发光装饰一样与光照、透视、材质一致，不要像贴纸叠加。'

const DEFAULT_NEW_BOARD = {
  title: '新增分镜',
  prompt: '新增分镜',
  duration: 2,
  voiceover: '',
  subtitle: '',
  sfx: '',
}

/** 与原 Vue ref 兼容的可读写引用接口（deps 通过它注入外层响应式状态）。 */
export interface RefLike<T> {
  value: T
}

export interface StoryboardItem {
  id: string
  title: string
  order: number
  status: string
  src: string
  assetId: number
  taskId: number
  versionHistory: ImageVersion[]
  currentVersionIndex: number
  historyImages: string[]
  blurredSrc?: string
  blurredAssetId?: number
  [key: string]: any
}

interface ImageVersion {
  src: string
  assetId: number
  taskId: number
}

export interface UseStoryboardGenerationDeps {
  selectedRatio: RefLike<string>
  selectedMaterials: RefLike<any[]>
  editReferenceMaterials?: RefLike<any[]>
  modelPlanCandidates: RefLike<any[]>
  creativeStoryboards: RefLike<any[]>
  buildBoardPrompt: (board: any, index: number, opts: any) => string
  buildEditPrompt: (item: any, prompt: any) => string
  getWorkspaceIdOrNotify: () => number
  ensureModelPlanCandidatesLoaded: () => Promise<void> | void
  showToast: (message: string, type?: string) => void
  setCurrentStep: (step: string) => void
  onBeforeRun?: () => void
  onBoardGenerated?: (boardIndex: number) => Promise<void>
  storyboardGenerationBlockReason?: RefLike<string>
  createTaskAbortController: () => AbortController
  releaseTaskAbortController: (controller: AbortController) => void
  abortAllPendingTasks: () => void
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max))
const toInt = (value: any) => Math.floor(Number(value) || 0)
const clampIndex = (value: any, length: number) => (length <= 0 ? 0 : clamp(toInt(value), 0, length - 1))
const asArray = (value: any): any[] => (Array.isArray(value) ? value : [])

const extractOutputAssetId = (task: any) =>
  toPositiveInt(task?.outputs?.find?.((output: any) => output?.asset_id)?.asset_id)

// 懒加载缓存"人脸检测抠图"模型 ID，避免每次脱敏都查模型列表。
// 先按精确名称搜，搜不到则放宽条件取任意 image.face_detect 模型兜底。
let cachedFaceDetectModelId: number | null = null
async function getFaceDetectModelId() {
  if (cachedFaceDetectModelId) return cachedFaceDetectModelId
  try {
    const models = await listAiModels({ operationCode: 'image.face_detect' })
    const list = Array.isArray(models) ? models : []
    const hit =
      list.find((m: any) => String(m?.name || '').includes('人脸检测抠图')) ||
      list.find((m: any) => String(m?.name || '').includes('人脸')) ||
      list[0]
    if (hit?.id) cachedFaceDetectModelId = toPositiveInt(hit.id)
  } catch {
    /* 查不到就用 0，createAiTask 会报错 */
  }
  return cachedFaceDetectModelId || 0
}

async function findAssetIdByTaskId({ workspaceId, taskId }: { workspaceId?: any; taskId?: any } = {}) {
  const wsId = toPositiveInt(workspaceId)
  const tId = toPositiveInt(taskId)
  if (!wsId || !tId) return 0
  try {
    const payload = await listAssets({ workspaceId: wsId, type: 'image', limit: 100 })
    const hit = extractAssetPageItems(payload).find((asset: any) => asset?.task_id === tId)
    return toPositiveInt(hit?.id)
  } catch {
    return 0
  }
}

async function uploadImageUrlAsAsset({ workspaceId, url, name = '' }: { workspaceId?: any; url?: any; name?: string } = {}) {
  const wsId = toPositiveInt(workspaceId)
  if (!wsId || !url) return 0
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`图片下载失败 (${response.status})`)
  }
  const blob = await response.blob()
  const file = new File([blob], name || `storyboard-${Date.now()}.png`, {
    type: blob?.type || 'image/png',
  })
  const { asset } = await uploadAssetFile({ workspaceId: wsId, file, prompt: '' })
  return toPositiveInt(asset?.id)
}

function shouldRetryStoryboardAsTextToImage(error: any) {
  const code = String(error?.code || '')
    .trim()
    .toUpperCase()
  const message = String(error?.message || '').toLowerCase()

  return (
    error?.status >= 500 ||
    code === '50008' ||
    code === 'INTERNAL_ERROR' ||
    /internal_error|服务内部错误|服务器内部错误|provider task failed|status failed/i.test(message)
  )
}

function findLastAssetId(materials: any, predicate: (m: any) => boolean = () => true) {
  const list = asArray(materials)
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const id = toPositiveInt(list[i]?.assetId)
    if (id && predicate(list[i])) return id
  }
  return 0
}


// Encapsulates chained image-to-image storyboard generation:
//  - first frame: text-to-image
//  - mid frames: image-to-image with previous frame as reference
//  - last frame: image-to-image as last_frame role (handled by buildInputAssets caller)
//
// Plus edit-one-storyboard flow that swaps a single board's image.
export function useStoryboardGeneration(deps: UseStoryboardGenerationDeps) {
  const {
    selectedRatio,
    selectedMaterials,
    editReferenceMaterials,
    modelPlanCandidates,
    creativeStoryboards,
    buildBoardPrompt, // (board, index, { withReference }) => string
    buildEditPrompt, // (item, prompt) => string
    getWorkspaceIdOrNotify,
    ensureModelPlanCandidatesLoaded,
    showToast,
    setCurrentStep,
    onBeforeRun, // optional: () => void, called before starting fresh run
    onBoardGenerated, // optional: (boardIndex) => Promise<void>, 每张分镜图生成后自动续写脚本词
    storyboardGenerationBlockReason,
    createTaskAbortController,
    releaseTaskAbortController,
    abortAllPendingTasks,
  } = deps

  // React state（暴露给视图层）
  const [storyboardItems, setStoryboardItemsState] = useState<StoryboardItem[]>([])
  const [storyboardTotal, setStoryboardTotalState] = useState(0)
  const [storyboardProgressCount, setStoryboardProgressCountState] = useState(0)
  const [storyboardGenerating, setStoryboardGeneratingState] = useState(false)
  const [isModifyingStoryboardImage, setIsModifyingStoryboardImageState] = useState(false)

  // 内部可变镜像（保证编排逻辑读到最新值），与 React state 同步更新。
  const itemsRef = useRef<StoryboardItem[]>([])
  const totalRef = useRef(0)
  const progressRef = useRef(0)
  const generatingRef = useRef(false)
  const modifyingRef = useRef(false)

  const idCounterRef = useRef(0)
  const runIdRef = useRef(0)

  const setItems = useCallback((next: StoryboardItem[]) => {
    itemsRef.current = next
    setStoryboardItemsState(next)
  }, [])
  const setTotal = useCallback((next: number) => {
    totalRef.current = next
    setStoryboardTotalState(next)
  }, [])
  const setProgress = useCallback((next: number) => {
    progressRef.current = next
    setStoryboardProgressCountState(next)
  }, [])
  const setGenerating = useCallback((next: boolean) => {
    generatingRef.current = next
    setStoryboardGeneratingState(next)
  }, [])
  const setModifying = useCallback((next: boolean) => {
    modifyingRef.current = next
    setIsModifyingStoryboardImageState(next)
  }, [])

  function normalizeImageVersion(value?: any): ImageVersion {
    return {
      src: String(value?.src || ''),
      assetId: toPositiveInt(value?.assetId),
      taskId: toPositiveInt(value?.taskId),
    }
  }

  function buildInitialHistory(value?: any): ImageVersion[] {
    const version = normalizeImageVersion(value)
    return version.src || version.assetId || version.taskId ? [version] : []
  }

  function computeHistoryImages(versionHistory: ImageVersion[], currentVersionIndex: number) {
    const images: string[] = []
    for (let i = versionHistory.length - 1; i >= 0 && images.length < STORYBOARD_HISTORY_LIMIT; i -= 1) {
      if (i === currentVersionIndex) continue
      const src = String(versionHistory[i]?.src || '').trim()
      if (src) images.push(src)
    }
    return images
  }

  function trimVersionHistory(versionHistory: ImageVersion[], currentVersionIndex: number) {
    const overflow = versionHistory.length - (STORYBOARD_HISTORY_LIMIT + 1)
    if (overflow <= 0) return { versionHistory, currentVersionIndex }
    return {
      versionHistory: versionHistory.slice(overflow),
      currentVersionIndex: Math.max(0, toInt(currentVersionIndex) - overflow),
    }
  }

  function commitItems(items: StoryboardItem[], { progress }: { progress?: 'reset' | 'fill' } = {}) {
    const next = normalizeStoryboardOrders(items)
    setItems(next)
    setTotal(next.length)
    switch (progress) {
      case 'reset':
        setProgress(0)
        break
      case 'fill':
        setProgress(next.length)
        break
      default:
        setProgress(Math.min(progressRef.current, next.length))
    }
  }

  function bumpProgress() {
    setProgress(Math.min(progressRef.current + 1, totalRef.current))
  }

  function emptyBoard(board: StoryboardItem): StoryboardItem {
    return {
      ...board,
      src: '',
      assetId: 0,
      taskId: 0,
      versionHistory: [],
      currentVersionIndex: 0,
      historyImages: [],
    }
  }

  function withHistoryDerived(board: any, versionHistory: ImageVersion[], currentVersionIndex: number): StoryboardItem {
    const current = versionHistory[currentVersionIndex] || normalizeImageVersion()
    return {
      ...board,
      src: current.src,
      assetId: current.assetId,
      taskId: current.taskId,
      versionHistory,
      currentVersionIndex,
      historyImages: computeHistoryImages(versionHistory, currentVersionIndex),
    }
  }

  function createStoryboardItem(board: any, index: number, overrides: any = {}): StoryboardItem {
    idCounterRef.current += 1
    const versionHistory = buildInitialHistory(overrides)
    const currentVersionIndex = versionHistory.length ? versionHistory.length - 1 : 0
    return withHistoryDerived(
      {
        id: `storyboard-${idCounterRef.current}`,
        title: board.title,
        order: index + 1,
        status: overrides.status || 'pending',
      },
      versionHistory,
      currentVersionIndex,
    )
  }

  function normalizeStoryboardOrders(items: StoryboardItem[]): StoryboardItem[] {
    return items.map((item, index) => ({ ...item, order: index + 1 }))
  }

  function updateItem(itemId: string, updater: (item: StoryboardItem) => StoryboardItem) {
    setItems(itemsRef.current.map((item) => (item.id === itemId ? updater(item) : item)))
  }

  function findStoryboardItem(itemId: string) {
    return itemsRef.current.find((board) => board.id === itemId)
  }

  function withItemHistory(itemId: string, mutate: (board: StoryboardItem, history: ImageVersion[]) => StoryboardItem | void) {
    updateItem(itemId, (board) => {
      const history = asArray(board.versionHistory)
      if (!history.length) return board
      const result = mutate(board, history)
      return (result as StoryboardItem) || board
    })
  }

  function bumpRunId() {
    runIdRef.current += 1
    return runIdRef.current
  }

  async function awaitTaskCompletion(workspaceId: any, task: any) {
    const controller = createTaskAbortController()
    try {
      return await waitForAiTask({
        workspaceId,
        task,
        intervalMs: STORYBOARD_POLL_INTERVAL_MS,
        timeoutMs: STORYBOARD_POLL_TIMEOUT_MS,
        signal: controller.signal,
      } as any)
    } finally {
      releaseTaskAbortController(controller)
    }
  }

  async function runImageTask({ workspaceId, task, missingUrlMessage }: any) {
    const completedTask = await awaitTaskCompletion(workspaceId, task)
    const mediaUrls = await resolveGeneratedMediaUrls({
      workspaceId,
      task: completedTask,
      type: 'image',
    })
    if (!mediaUrls[0]) {
      throw new Error(missingUrlMessage)
    }
    const assetId =
      extractOutputAssetId(completedTask) || (await findAssetIdByTaskId({ workspaceId, taskId: completedTask?.id }))
    return { completedTask, src: mediaUrls[0], assetId } as any
  }

  function createImageTask({ workspaceId, prompt, referenceImageAssetId, inputAssets }: any) {
    return createAiTask({
      workspaceId,
      capability: 'image',
      operationCode: referenceImageAssetId ? 'image.image_to_image' : 'image.text_to_image',
      preferredModelKeywords: STORYBOARD_MODEL_KEYWORDS,
      modelPlanCandidates: modelPlanCandidates.value,
      prompt,
      inputAssets:
        inputAssets ||
        (referenceImageAssetId ? () => [{ asset_id: referenceImageAssetId, role: 'reference_image' }] : undefined),
      params: (model: any) => buildStoryboardImageParams(model, selectedRatio.value),
    } as any)
  }

  async function generateBoardImage({
    workspaceId,
    board,
    index,
    referenceImageAssetId,
    previousBoard,
    allPreviousBoards,
    nextBoard,
    nextImageAssetId,
    afterBoards,
  }: any) {
    const basePrompt = buildBoardPrompt(board, index, {
      withReference: Boolean(referenceImageAssetId),
      previousBoard,
      allPreviousBoards,
      nextBoard,
      afterBoards,
    })
    const prompt = referenceImageAssetId ? `${basePrompt}${REFERENCE_PROMPT_SUFFIX}` : basePrompt

    // 插入场景：同时以前后两张图作为视觉参考，让模型桥接过渡
    const hasNextRef = Boolean(nextImageAssetId && referenceImageAssetId)

    let result: any
    try {
      const task = await createImageTask({
        workspaceId,
        prompt,
        referenceImageAssetId,
        inputAssets: hasNextRef
          ? () => [
              { asset_id: referenceImageAssetId, role: 'reference_image' },
              { asset_id: nextImageAssetId, role: 'reference_image' },
            ]
          : undefined,
      })
      result = await runImageTask({
        workspaceId,
        task,
        missingUrlMessage: '分镜图片生成完成，但没有返回图片地址',
      })
    } catch (error) {
      if (!referenceImageAssetId || !shouldRetryStoryboardAsTextToImage(error)) {
        throw error
      }

      const fallbackTask = await createImageTask({
        workspaceId,
        prompt: buildBoardPrompt(board, index, {
          withReference: false,
          previousBoard: null,
        }),
        referenceImageAssetId: 0,
      })
      result = await runImageTask({
        workspaceId,
        task: fallbackTask,
        missingUrlMessage: '分镜图片生成完成，但没有返回图片地址',
      })
    }

    // 每生成一张图片后调用脱敏/模型接口
    const opCode = referenceImageAssetId ? 'image.image_to_image' : 'image.text_to_image'
    listAiModels({ operationCode: opCode }).catch(() => {})

    // 人脸脱敏：先尝试同步读取，若 outputs 为空则按异步任务轮询等待
    const blurAssetId = result.assetId || extractOutputAssetId(result.completedTask)
    if (blurAssetId) {
      try {
        const blurTask = await createAiTask({
          workspaceId,
          operationCode: 'image.face_detect',
          modelVersionId: await getFaceDetectModelId(),
          prompt: '人脸检测',
          inputAssets: [{ asset_id: blurAssetId, role: 'image' }],
        } as any)
        let blurUrl = blurTask?.outputs?.[0]?.url || blurTask?.data?.outputs?.[0]?.url
        let resolvedBlurAssetId = extractOutputAssetId(blurTask)
        if (!blurUrl) {
          const completedBlurTask = await awaitTaskCompletion(workspaceId, blurTask)
          blurUrl = completedBlurTask?.outputs?.[0]?.url || completedBlurTask?.data?.outputs?.[0]?.url
          resolvedBlurAssetId = extractOutputAssetId(completedBlurTask)
        }
        if (blurUrl) {
          result.blurredSrc = blurUrl
          // 优先使用任务 output 中已有的 asset_id，避免 fetch 上传失败
          if (resolvedBlurAssetId) {
            result.blurredAssetId = resolvedBlurAssetId
          } else {
            try {
              const res = await fetch(blurUrl)
              const blob = await res.blob()
              const file = new File([blob], `blurred-${Date.now()}.jpg`, { type: 'image/jpeg' })
              const { asset } = await uploadAssetFile({ workspaceId, file, prompt: '人脸脱敏' })
              if (asset?.id) {
                result.blurredAssetId = asset.id
              }
            } catch {
              // 上传失败不阻塞
            }
          }
        }
      } catch {
        // 脱敏失败不阻塞
      }
    }

    return result
  }

  function ensureHistory(board: StoryboardItem): ImageVersion[] {
    const existing = asArray(board.versionHistory)
    if (existing.length) return existing
    return buildInitialHistory({ src: board.src, assetId: board.assetId, taskId: board.taskId })
  }

  function applyGeneratedVersion(
    board: StoryboardItem,
    { src, assetId, completedTask, blurredSrc, blurredAssetId }: any,
    { reset }: { reset?: boolean } = {},
  ): StoryboardItem {
    const nextVersion = normalizeImageVersion({
      src,
      assetId: assetId || (reset ? 0 : board.assetId),
      taskId: completedTask?.id || board.taskId,
    })
    const nextStatus = completedTask?.status || (reset ? 'succeeded' : board.status)

    const blurredSrcValue = blurredSrc || (reset ? board.blurredSrc : '') || ''
    const blurredAssetIdValue = blurredAssetId || (reset ? board.blurredAssetId : 0) || 0
    if (reset) {
      return withHistoryDerived(
        { ...board, status: nextStatus, blurredSrc: blurredSrcValue, blurredAssetId: blurredAssetIdValue },
        [nextVersion],
        0,
      )
    }

    const history = ensureHistory(board)
    const pivot = Math.min(history.length, Math.max(0, toInt(board.currentVersionIndex) + 1))
    const trimmed = trimVersionHistory([...history.slice(0, pivot), nextVersion], pivot)
    return withHistoryDerived(
      { ...board, status: nextStatus, blurredSrc: blurredSrcValue, blurredAssetId: blurredAssetIdValue },
      trimmed.versionHistory,
      trimmed.currentVersionIndex,
    )
  }

  function restoreVersionHistory(item: any): ImageVersion[] {
    if (Array.isArray(item?.versionHistory)) {
      return item.versionHistory.map((v: any) => normalizeImageVersion({ ...v, src: sanitizeMediaUrl(v?.src) }))
    }
    const legacy = item?.currentImage || { src: item?.src, assetId: item?.assetId, taskId: item?.taskId }
    return buildInitialHistory({ ...legacy, src: sanitizeMediaUrl(legacy?.src) })
  }

  function adoptRestoredStoryboardItems(items: any) {
    if (!Array.isArray(items)) return
    const sanitized = items.map((item: any) => {
      const initialHistory = restoreVersionHistory(item)
      const fallbackIndex = initialHistory.length ? initialHistory.length - 1 : 0
      const rawIndex = Number(item?.currentVersionIndex)
      const safeIndex = Number.isFinite(rawIndex) ? Math.floor(rawIndex) : fallbackIndex
      const trimmed = trimVersionHistory(initialHistory, clampIndex(safeIndex, initialHistory.length))
      return withHistoryDerived(
        item,
        trimmed.versionHistory,
        clampIndex(trimmed.currentVersionIndex, trimmed.versionHistory.length),
      )
    })
    commitItems(sanitized, { progress: 'fill' })
    for (const item of sanitized) {
      const id = Number(String(item?.id || '').replace('storyboard-', ''))
      if (Number.isFinite(id) && id > idCounterRef.current) idCounterRef.current = id
    }
  }

  async function ensureReferenceAssetId({ workspaceId, assetId, src, index }: any) {
    const directAssetId = toPositiveInt(assetId)
    if (directAssetId) return directAssetId
    const safeSrc = String(src || '').trim()
    if (!safeSrc) return 0
    try {
      return await uploadImageUrlAsAsset({
        workspaceId,
        url: safeSrc,
        name: `storyboard-chain-${index + 1}.png`,
      })
    } catch {
      return 0
    }
  }

  function spliceCreativeStoryboards(index: number, deleteCount: number, ...inserted: any[]) {
    if (!Array.isArray(creativeStoryboards?.value)) return
    const next = [...creativeStoryboards.value]
    next.splice(index, deleteCount, ...inserted)
    creativeStoryboards.value = next.slice(0, MAX_STORYBOARDS)
  }

  function insertStoryboardSlot({ anchorId, side, board }: any = {}) {
    if (itemsRef.current.length >= MAX_STORYBOARDS) {
      showToast(`最多只能生成 ${MAX_STORYBOARDS} 张分镜图片`, 'error')
      return null
    }

    const anchorIndex = itemsRef.current.findIndex((item) => item.id === anchorId)
    const baseIndex = anchorIndex >= 0 ? anchorIndex : itemsRef.current.length - 1
    const insertAt = side === 'left' ? baseIndex : baseIndex + 1
    const clampedIndex = clamp(insertAt, 0, itemsRef.current.length)

    const newBoard = board || { ...DEFAULT_NEW_BOARD }
    const newItem = createStoryboardItem(newBoard, clampedIndex, {
      status: 'pending',
      src: '',
      assetId: 0,
      taskId: 0,
    })

    spliceCreativeStoryboards(clampedIndex, 0, newBoard)

    const nextItems = [...itemsRef.current]
    nextItems.splice(clampedIndex, 0, newItem)
    commitItems(nextItems)

    return { id: newItem.id, index: clampedIndex, board: newBoard }
  }

  async function insertStoryboardImage({ anchorId, side, prompt, board }: any = {}) {
    if (generatingRef.current || modifyingRef.current) return null

    const workspaceId = getWorkspaceIdOrNotify()
    if (!workspaceId) return null

    const trimmed = String(prompt || board?.prompt || board?.title || '').trim()
    if (!trimmed) {
      showToast('请输入分镜图片描述', 'error')
      return null
    }

    const nextBoardArg = board || { ...DEFAULT_NEW_BOARD, title: trimmed, prompt: trimmed }

    const inserted = insertStoryboardSlot({ anchorId, side, board: nextBoardArg })
    if (!inserted?.id) return null

    const { id: insertedId, index: insertedIndex, board: insertedBoard } = inserted

    updateItem(insertedId, (item) => ({ ...item, status: 'submitting' }))

    try {
      await ensureModelPlanCandidatesLoaded()
      showToast('分镜图片生成中', 'success')

      // 获取前面所有分镜作为上下文
      const previousBoards: any[] = []
      for (let i = 0; i < insertedIndex; i++) {
        const item = itemsRef.current[i]
        if (item) {
          const b = creativeStoryboards.value[i] || { title: item.title, prompt: item.title }
          previousBoards.push(b)
        }
      }
      const previousBoard = previousBoards.length > 0 ? previousBoards[previousBoards.length - 1] : null

      // 以前一张分镜图作为视觉参考，保证人物/服装/画风一致
      const prevItem = itemsRef.current[insertedIndex - 1]
      const referenceImageAssetId =
        findLastAssetId(editReferenceMaterials?.value) ||
        (prevItem?.assetId ? prevItem.assetId : 0) ||
        pickReferenceImageAssetId()

      // 收集后续分镜信息，用于桥接上下文（保证插入的图与前后都有关联）
      const nextItem = itemsRef.current[insertedIndex + 1]
      const nextBoard = nextItem
        ? creativeStoryboards.value[insertedIndex + 1] || { title: nextItem.title, prompt: nextItem.title }
        : null
      const nextImageAssetId = nextItem?.assetId || 0
      const afterBoards: any[] = []
      if (nextBoard) {
        for (let i = insertedIndex + 1; i < itemsRef.current.length; i++) {
          const item = itemsRef.current[i]
          if (item && creativeStoryboards.value[i]) {
            afterBoards.push(creativeStoryboards.value[i])
          }
        }
      }

      const result = await generateBoardImage({
        workspaceId,
        board: insertedBoard,
        index: insertedIndex,
        referenceImageAssetId,
        previousBoard,
        allPreviousBoards: previousBoards,
        nextBoard,
        nextImageAssetId,
        afterBoards,
      })

      updateItem(insertedId, (item) => applyGeneratedVersion(item, result, { reset: true }))

      bumpProgress()

      showToast('分镜图片已生成', 'success')
      return { insertedId, insertedIndex }
    } catch (error: any) {
      if (isAbortedTaskError(error)) return null
      updateItem(insertedId, (item) => ({ ...item, status: 'failed' }))
      showToast(getBusinessErrorMessage(error, error.message || '分镜图片生成失败'), 'error')
      return null
    }
  }

  async function startStoryboardGeneration(options: any = {}) {
    const keepStep = Boolean(options?.keepStep)
    const silent = Boolean(options?.silent)
    const resume = Boolean(options?.resume)
    if (storyboardGenerationBlockReason?.value) {
      showToast(storyboardGenerationBlockReason.value, 'error')
      return
    }

    const id = getWorkspaceIdOrNotify()
    if (!id || generatingRef.current) return

    if (typeof onBeforeRun === 'function') onBeforeRun()

    if (!creativeStoryboards.value.length) {
      creativeStoryboards.value = buildFallbackStoryboards()
    }

    const boards = creativeStoryboards.value.slice(0, MAX_STORYBOARDS)

    if (boards.length < creativeStoryboards.value.length) {
      showToast(`分镜数量已截断到最多 ${MAX_STORYBOARDS} 张`, 'success')
    }

    abortAllPendingTasks()
    const runId = bumpRunId()
    if (!keepStep) setCurrentStep('storyboard')

    if (resume && itemsRef.current.length) {
      // 续跑模式：保留已生成的分镜，只重新生成未完成的
      const mergedItems = boards.map((board: any, index: number) => {
        const existingItem = itemsRef.current[index]
        if (existingItem && String(existingItem.src || '').trim()) {
          return { ...existingItem, order: index + 1 }
        }
        return createStoryboardItem(board, index, {
          status: 'pending',
          src: '',
          assetId: 0,
          taskId: 0,
        })
      })
      commitItems(mergedItems, { progress: 'reset' })
    } else {
      const initialItems = boards.map((board: any, index: number) =>
        createStoryboardItem(board, index, { status: 'pending', src: '', assetId: 0, taskId: 0 }),
      )
      commitItems(initialItems, { progress: 'reset' })
    }
    setGenerating(true)
    if (!silent) showToast('分镜图片生成中', 'success')

    const isCurrentRun = () => runId === runIdRef.current

    try {
      await ensureModelPlanCandidatesLoaded()
      const jobSnapshots = itemsRef.current.map((item, index) => ({
        itemId: item.id,
        board: boards[index],
        index,
      }))
      let previousGenerated: any = null
      // 以用户上传的产品/素材图片作为第一张分镜的视觉参考
      const productRefId = pickReferenceImageAssetId()

      for (const job of jobSnapshots) {
        if (!job || !isCurrentRun()) break

        updateItem(job.itemId, (item) => ({ ...item, status: 'submitting' }))

        try {
          const result = await generateBoardImage({
            workspaceId: id,
            board: job.board,
            index: job.index,
            referenceImageAssetId: previousGenerated?.referenceAssetId || productRefId || 0,
            previousBoard: previousGenerated?.board || null,
          })

          if (!isCurrentRun()) break

          const sanitizedResult = { ...result, src: sanitizeMediaUrl(result.src) }
          updateItem(job.itemId, (item) => applyGeneratedVersion(item, sanitizedResult, { reset: true }))

          // 分镜图生成后自动续写脚本词（旁白/字幕/音效）
          if (typeof onBoardGenerated === 'function') {
            onBoardGenerated(job.index).catch(() => {})
          }

          previousGenerated = {
            board: job.board,
            src: sanitizedResult.src,
            assetId: sanitizedResult.assetId,
            referenceAssetId: await ensureReferenceAssetId({
              workspaceId: id,
              assetId: sanitizedResult.assetId,
              src: sanitizedResult.src,
              index: job.index,
            }),
          }
        } catch (error) {
          if (isAbortedTaskError(error) || !isCurrentRun()) return
          updateItem(job.itemId, (item) => ({ ...item, status: 'failed' }))
          throw new Error(`第 ${job.index + 1} 张分镜生成失败，后续已停止`)
        } finally {
          if (isCurrentRun()) bumpProgress()
        }
      }

      if (isCurrentRun() && !silent) {
        showToast('分镜图片已生成', 'success')
      }
    } catch (error: any) {
      if (isAbortedTaskError(error)) return
      if (isCurrentRun()) {
        showToast(getBusinessErrorMessage(error, error.message || '分镜图片生成失败'), 'error')
      }
    } finally {
      if (isCurrentRun()) {
        setGenerating(false)
      }
    }
  }

  async function removeStoryboardItem(itemId: string, { onAfterRemove }: any = {}) {
    const id = getWorkspaceIdOrNotify()
    if (!id) return

    const itemIndex = itemsRef.current.findIndex((board) => board.id === itemId)
    if (itemIndex === -1) return
    const item = itemsRef.current[itemIndex]

    let assetId = toPositiveInt(item?.assetId)
    if (!assetId && toPositiveInt(item?.taskId)) {
      assetId = await findAssetIdByTaskId({ workspaceId: id, taskId: item.taskId })
    }

    if (assetId) {
      try {
        await deleteAsset({ workspaceId: id, assetId })
      } catch (error) {
        showToast(getBusinessErrorMessage(error, '删除失败，请稍后重试'), 'error')
        return
      }
    }

    commitItems(itemsRef.current.filter((board) => board.id !== itemId))
    spliceCreativeStoryboards(itemIndex, 1)

    if (typeof onAfterRemove === 'function') onAfterRemove(itemId)
    showToast(assetId ? '分镜已删除' : '分镜已删除（未关联素材）', 'success')
  }

  function reorderStoryboardItems({ fromId, toId }: any) {
    const items = itemsRef.current
    const fromIndex = items.findIndex((item) => item.id === fromId)
    const toIndex = items.findIndex((item) => item.id === toId)
    if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return

    const nextItems = [...items]
    const [moved] = nextItems.splice(fromIndex, 1)
    nextItems.splice(toIndex, 0, moved)
    setItems(normalizeStoryboardOrders(nextItems))

    const boards = asArray(creativeStoryboards?.value)
    const movedBoard = boards[fromIndex]
    if (!movedBoard) return
    const nextBoards = [...boards]
    nextBoards.splice(fromIndex, 1)
    nextBoards.splice(toIndex, 0, movedBoard)
    creativeStoryboards.value = nextBoards.slice(0, MAX_STORYBOARDS)
  }

  async function runModifyWithFeedback({ itemId, workspaceId, item, prompt, inputAssets, referenceImageAssetId }: any) {
    setModifying(true)
    try {
      await ensureModelPlanCandidatesLoaded()
      showToast('图片修改生成中', 'success')

      // 修改只基于当前图片和用户描述，不需要前面分镜上下文
      const task = await createImageTask({
        workspaceId,
        prompt: buildEditPrompt(item, prompt),
        referenceImageAssetId,
        inputAssets,
      })

      const result = await runImageTask({
        workspaceId,
        task,
        missingUrlMessage: '图片修改完成，但没有返回图片地址',
      })

      // 人脸脱敏：先尝试同步读取，若 outputs 为空则按异步任务轮询等待
      const blurAssetId = result.assetId || extractOutputAssetId(result.completedTask)
      if (blurAssetId) {
        try {
          const blurTask = await createAiTask({
            workspaceId,
            operationCode: 'image.face_detect',
            modelVersionId: await getFaceDetectModelId(),
            prompt: '人脸检测',
            inputAssets: [{ asset_id: blurAssetId, role: 'image' }],
          } as any)
          let blurUrl = blurTask?.outputs?.[0]?.url || blurTask?.data?.outputs?.[0]?.url
          let resolvedBlurAssetId = extractOutputAssetId(blurTask)
          if (!blurUrl) {
            const completedBlurTask = await awaitTaskCompletion(workspaceId, blurTask)
            blurUrl = completedBlurTask?.outputs?.[0]?.url || completedBlurTask?.data?.outputs?.[0]?.url
            resolvedBlurAssetId = extractOutputAssetId(completedBlurTask)
          }
          if (blurUrl) {
            result.blurredSrc = blurUrl
            // 优先使用任务 output 中已有的 asset_id，避免 fetch 上传失败
            if (resolvedBlurAssetId) {
              result.blurredAssetId = resolvedBlurAssetId
            } else {
              try {
                const res = await fetch(blurUrl)
                const blob = await res.blob()
                const file = new File([blob], `blurred-${Date.now()}.jpg`, { type: 'image/jpeg' })
                const { asset } = await uploadAssetFile({ workspaceId, file, prompt: '人脸脱敏' })
                if (asset?.id) {
                  result.blurredAssetId = asset.id
                }
              } catch {
                /* 上传失败不阻塞 */
              }
            }
          }
        } catch {
          /* 脱敏失败不阻塞 */
        }
      }

      updateItem(itemId, (board) => applyGeneratedVersion(board, result))
      showToast('图片修改已完成', 'success')

      const opCode = referenceImageAssetId ? 'image.image_to_image' : 'image.text_to_image'
      listAiModels({ operationCode: opCode }).catch(() => {})
    } catch (error: any) {
      if (isAbortedTaskError(error)) return
      showToast(getBusinessErrorMessage(error, error.message || '图片修改失败'), 'error')
    } finally {
      setModifying(false)
    }
  }

  async function modifyStoryboardImage({ itemId, prompt }: any = {}) {
    if (modifyingRef.current) return

    const id = getWorkspaceIdOrNotify()
    if (!id) return

    const item = findStoryboardItem(itemId)
    if (!item) {
      showToast('当前分镜不存在，请刷新后重试', 'error')
      return
    }

    // 以当前分镜图片为修改基础，素材库参考图作为风格/元素补充
    const referenceImageAssetId = toPositiveInt(item?.assetId) || 0

    // 收集编辑参考素材的 assetId（用户在修改弹窗中上传的素材）
    const editRefIds = asArray(editReferenceMaterials?.value)
      .map((m) => toPositiveInt(m?.assetId))
      .filter(Boolean)

    const hasAnyRef = referenceImageAssetId || editRefIds.length || buildStoryboardEditInputAssets(item).length
    if (!hasAnyRef) {
      showToast('请先生成分镜图片后再修改', 'error')
      return
    }

    // 构建 inputAssets：当前分镜图片 + 编辑参考素材 + 选中素材，合并去重
    const buildModifyInputAssets = (model: any) => {
      const assets = buildStoryboardEditInputAssets(item, selectedMaterials.value, model)
      for (const refId of editRefIds) {
        if (!assets.some((a: any) => a.asset_id === refId)) {
          assets.push({ asset_id: refId, role: 'reference_image' })
        }
      }
      return assets
    }

    await runModifyWithFeedback({
      itemId,
      workspaceId: id,
      item,
      prompt,
      referenceImageAssetId: referenceImageAssetId || undefined,
      inputAssets: buildModifyInputAssets,
    })
  }

  function setStoryboardImageVersion({ itemId, index }: any = {}) {
    const id = String(itemId || '')
    const nextIndex = Number(index)
    if (!id || !Number.isFinite(nextIndex)) return

    withItemHistory(id, (board, history) => withHistoryDerived(board, history, clampIndex(nextIndex, history.length)))
  }

  function stepStoryboardImageVersion({ itemId, delta }: any = {}) {
    const id = String(itemId || '')
    const d = Number(delta)
    if (!id || !Number.isFinite(d) || !d) return
    withItemHistory(id, (board, history) =>
      withHistoryDerived(board, history, clamp(toInt(board.currentVersionIndex) + d, 0, history.length - 1)),
    )
  }

  function removeStoryboardImageVersion({ itemId, index }: any = {}) {
    const id = String(itemId || '')
    const removeIndex = Number(index)
    if (!id || !Number.isFinite(removeIndex)) return

    withItemHistory(id, (board, currentHistory) => {
      const clamped = clampIndex(removeIndex, currentHistory.length)
      const history = currentHistory.filter((_, i) => i !== clamped)
      if (!history.length) return emptyBoard(board)
      const currentIndex = clamp(toInt(board.currentVersionIndex), 0, history.length)
      const shifted = clamped <= currentIndex ? currentIndex - 1 : currentIndex
      return withHistoryDerived(board, history, clamp(shifted, 0, history.length - 1))
    })
  }

  function resetStoryboard() {
    bumpRunId()
    setItems([])
    setTotal(0)
    setProgress(0)
    setGenerating(false)
    setModifying(false)
  }

  /** 用本地图片替换分镜图片，自动人脸脱敏并保留历史记录 */
  async function replaceStoryboardImage({ itemId, src, assetId }: any) {
    const workspaceId = getWorkspaceIdOrNotify()

    // 人脸脱敏：最多重试 2 次，失败则提示用户
    let blurredSrc = ''
    let blurredAssetId = 0
    if (workspaceId && assetId) {
      const faceModelId = await getFaceDetectModelId()
      if (!faceModelId) {
        showToast('人脸脱敏模型不可用，视频生成可能因人脸审核失败', 'error')
      } else {
        for (let retry = 0; retry < 2 && !blurredAssetId; retry += 1) {
          try {
            const blurTask = await createAiTask({
              workspaceId,
              operationCode: 'image.face_detect',
              modelVersionId: faceModelId,
              prompt: '人脸检测',
              inputAssets: [{ asset_id: assetId, role: 'image' }],
            } as any)
            let blurUrl = blurTask?.outputs?.[0]?.url || blurTask?.data?.outputs?.[0]?.url
            let resolvedBlurAssetId = extractOutputAssetId(blurTask)
            if (!blurUrl) {
              const completedBlurTask = await awaitTaskCompletion(workspaceId, blurTask)
              blurUrl = completedBlurTask?.outputs?.[0]?.url || completedBlurTask?.data?.outputs?.[0]?.url
              resolvedBlurAssetId = extractOutputAssetId(completedBlurTask)
            }
            if (blurUrl) {
              blurredSrc = blurUrl
              blurredAssetId = resolvedBlurAssetId
              if (!blurredAssetId) {
                try {
                  const res = await fetch(blurUrl)
                  const blob = await res.blob()
                  const file = new File([blob], `blurred-${Date.now()}.jpg`, { type: 'image/jpeg' })
                  const uploadResult = await uploadAssetFile({ workspaceId, file, prompt: '人脸脱敏' })
                  if (uploadResult?.asset?.id) {
                    blurredAssetId = uploadResult.asset.id
                  }
                } catch {
                  /* 上传失败不阻塞 */
                }
              }
            }
          } catch {
            /* 单次脱敏失败，重试 */
          }
        }
        if (!blurredAssetId) {
          showToast('人脸脱敏失败，该分镜可能无法用于视频生成', 'error')
        }
      }
    }

    updateItem(itemId, (board) => {
      const result = { src, assetId, blurredSrc, blurredAssetId, completedTask: { status: 'succeeded' } }
      return applyGeneratedVersion(board, result)
    })
  }

  function pickReferenceImageAssetId() {
    return findLastAssetId(selectedMaterials?.value, isImageMaterial)
  }

  return {
    // state
    storyboardItems,
    storyboardTotal,
    storyboardProgressCount,
    storyboardGenerating,
    isModifyingStoryboardImage,
    // actions
    startStoryboardGeneration,
    removeStoryboardItem,
    reorderStoryboardItems,
    modifyStoryboardImage,
    replaceStoryboardImage,
    setStoryboardImageVersion,
    stepStoryboardImageVersion,
    removeStoryboardImageVersion,
    insertStoryboardSlot,
    insertStoryboardImage,
    adoptRestoredStoryboardItems,
    cancelInFlightStoryboard: bumpRunId,
    resetStoryboard,
    // setters（CreativeScriptView 直接写回分镜状态时需要；内部名为 setItems/setGenerating）
    setStoryboardItems: setItems,
    setStoryboardGenerating: setGenerating,
  }
}
