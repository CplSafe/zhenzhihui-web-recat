/**
 * AI 创作台（/studio）
 *
 * 页面效果：左侧控制台按「图片生成 / 视频生成」两种模式组织参数——模型、参考图、
 * 提示词、生成参数（清晰度/时长/比例/数量）与智能分镜；右侧是按批次倒序的结果流。
 * 数据源：图片走 smartShotImage.generateShotImage（image.text_to_image / image.image_to_image），
 * 视频走 smartVideo.generateFullVideo（video.generate），模型目录来自 useGenerationModelCatalog。
 *
 * 智能分镜：开启后先用 smartScript.generateScriptShotsStream 把一句需求拆成多镜脚本，
 * 用户可在分镜列表里改描述、调时长、拖排序、增删镜头，最终整份分镜作为时间线送入视频生成；
 * 关闭时按单镜（整段提示词 + 总时长）提交，行为与普通文生视频一致。
 *
 * 鉴权：页面本身允许游客浏览，仅「生成」动作经 useRequireAuth 拦截。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AppSidebar from '@/components/home/AppSidebar'
import AppTopbar from '@/components/layout/AppTopbar'
import StudioModelPicker from '@/components/studio/StudioModelPicker/StudioModelPicker'
import StudioParamsBar from '@/components/studio/StudioParamsBar/StudioParamsBar'
import StudioFrameSlots from '@/components/studio/StudioFrameSlots/StudioFrameSlots'
import StudioRefImages from '@/components/studio/StudioRefImages/StudioRefImages'
import StudioRefVideos from '@/components/studio/StudioRefVideos/StudioRefVideos'
import StudioVideoModeTabs from '@/components/studio/StudioVideoModeTabs/StudioVideoModeTabs'
import StudioResultFeed, {
  type StudioResultBatch,
  type StudioResultItem,
} from '@/components/studio/StudioResultFeed/StudioResultFeed'
import StudioShotList from '@/components/studio/StudioShotList/StudioShotList'
import { useGenerationModelCatalog } from '@/composables/useGenerationModelCatalog'
import { useRequireAuth } from '@/composables/useRequireAuth'
import { useSidebarNavigate } from '@/composables/useSidebarNavigate'
import { useStudioCostEstimate } from '@/composables/useStudioCostEstimate'
import { useStudioHistory } from '@/composables/useStudioHistory'
import { useToast } from '@/composables/useToast'
import { notifyGenerationDone } from '@/utils/studioNotify'
import { useWorkspaceId } from '@/stores/workspaceSession'
import { getBusinessErrorMessage, uploadAssetFile } from '@/api/business'
import { generateScriptShotsStream } from '@/api/smartScript'
import { ensureAssetId, generateShotImage } from '@/api/smartShotImage'
import { generateFullVideo, resumeFullVideo } from '@/api/smartVideo'
import { findResumableItems } from '@/utils/studioHistory'
import { toStudioModelChoice } from '@/utils/studioModelPresentation'
import {
  type StudioMode,
  type StudioParams,
  defaultStudioParams,
  formatParamsSummary,
  normalizeParams,
  resolveParamOptions,
} from '@/utils/studioParams'
import type { StudioRefImage } from '@/utils/studioRefImage'
import { type StudioRefVideo, resolveRefVideoLimits, validateRefVideos } from '@/utils/studioRefVideo'
import {
  DEFAULT_VIDEO_MODE,
  type StudioVideoMode,
  getVideoModeSpec,
  normalizeVideoMode,
  resolveAvailableVideoModes,
  validateVideoModeImages,
  videoReferenceMode,
} from '@/utils/studioVideoMode'
import {
  type StudioShot,
  createDefaultStudioShots,
  fromScriptShots,
  totalStudioShotSec,
  validateStudioShots,
} from '@/utils/studioShots'
import './StudioCreateView.css'

let batchSequence = 0
/** 生成批次 / 产物的稳定唯一 ID。 */
function createStudioId(prefix: string): string {
  batchSequence += 1
  return `${prefix}-${Date.now().toString(36)}-${batchSequence.toString(36)}`
}

/** AI 创作台主组件。 */
export default function StudioCreateView() {
  const workspaceId = useWorkspaceId()
  const handleNavigate = useSidebarNavigate()
  const requireAuth = useRequireAuth()
  const { showToast } = useToast()

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [mode, setMode] = useState<StudioMode>('video')
  const [prompt, setPrompt] = useState('')
  const [params, setParams] = useState<StudioParams>(() => defaultStudioParams('video'))
  const [refImages, setRefImages] = useState<StudioRefImage[]>([])
  const [refVideos, setRefVideos] = useState<StudioRefVideo[]>([])
  // 视频生成模式：首尾帧 / 参考生视频，决定参考图的数量与下发角色。
  const [videoMode, setVideoMode] = useState<StudioVideoMode>(DEFAULT_VIDEO_MODE)

  // 智能分镜：开关 + 分镜列表 + 是否展开自定义编辑面板。
  const [storyboardOn, setStoryboardOn] = useState(true)
  const [customOpen, setCustomOpen] = useState(false)
  const [shots, setShots] = useState<StudioShot[]>([])
  const [scripting, setScripting] = useState(false)

  const [submitting, setSubmitting] = useState(false)
  const [filter, setFilter] = useState<'all' | 'image' | 'video'>('all')

  // 页面卸载后不再 setState，避免在途生成回调打到已卸载组件。
  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  const ws = Number(workspaceId || 0)
  // 目录取 'all'：页面在图片/视频模式间切换，两类 operation 的模型都要就绪。
  const { groups, loading: modelLoading } = useGenerationModelCatalog(ws, 'all')

  // 右侧结果流跨刷新累计：历史创作从后端任务列表恢复，新生成追加到尾部。
  const {
    batches,
    setBatches,
    loading: historyLoading,
    loadingMore: historyLoadingMore,
    hasMore: historyHasMore,
    loadMore: loadOlderHistory,
  } = useStudioHistory(ws)

  /** 每个 operation 可选的模型（含 logo、描述与后端声明的参数约束）。 */
  const modelsByOperation = useMemo(() => {
    const map = new Map<string, ReturnType<typeof toStudioModelChoice>[]>()
    groups.forEach((group) => {
      group.operationGroups.forEach(({ operationCode, models }) => {
        map.set(operationCode, models.filter((model) => !model.unavailableReason).map(toStudioModelChoice))
      })
    })
    return map
  }, [groups])

  /** 该模式下主模型对应的 operation：视频用 video.generate，图片按有无参考图切换。 */
  const primaryOperation = useMemo(() => {
    if (mode === 'video') return 'video.generate'
    return refImages.length ? 'image.image_to_image' : 'image.text_to_image'
  }, [mode, refImages.length])

  // useMemo 稳定引用，否则下方收敛选择的 effect 每次渲染都会重跑。
  const primaryModels = useMemo(
    () => modelsByOperation.get(primaryOperation) || [],
    [modelsByOperation, primaryOperation],
  )
  const [selectedModelId, setSelectedModelId] = useState(0)

  // 模型目录到位或 operation 变化后，把选择收敛到当前 operation 的可用模型。
  useEffect(() => {
    if (!primaryModels.length) {
      setSelectedModelId(0)
      return
    }
    setSelectedModelId((current) =>
      primaryModels.some((model) => model.id === current) ? current : primaryModels[0].id,
    )
  }, [primaryModels])

  const selectedModel = primaryModels.find((model) => model.id === selectedModelId)

  /** 档位以选中模型声明的 schema 为准；未选中模型时用该模式的兜底档位。 */
  const paramOptions = useMemo(
    () => resolveParamOptions(mode, selectedModel?.constraints),
    [mode, selectedModel?.constraints],
  )

  // 模型或模式变化后把已选参数收敛到新档位：换模型后旧比例/时长可能已不被支持，
  // 继续提交会被后端按参数不合法拒绝。
  useEffect(() => {
    setParams((current) => {
      const next = normalizeParams(mode, current, paramOptions)
      const unchanged =
        next.ratio === current.ratio &&
        next.resolution === current.resolution &&
        next.durationSec === current.durationSec &&
        next.count === current.count
      return unchanged ? current : next
    })
  }, [mode, paramOptions])

  /** 该模型支持的视频生成模式（首尾帧 / 参考生视频）；纯文生模型返回空数组。 */
  const availableVideoModes = useMemo(
    () => resolveAvailableVideoModes(selectedModel?.source, selectedModel?.constraints),
    [selectedModel?.source, selectedModel?.constraints],
  )

  // 换模型后当前模式可能已不被支持，收敛到第一个可用模式。
  useEffect(() => {
    setVideoMode((current) => normalizeVideoMode(current, availableVideoModes))
  }, [availableVideoModes])

  /**
   * 参考图上限取「模式语义」与「模型声明」的较小值。
   * 首尾帧最多 2 张（首/尾），参考生视频最多 9 张。
   */
  const maxRefImages = useMemo(() => {
    if (mode === 'image') return paramOptions.maxReferenceImages
    // 纯文生模型没有任何可用模式，此时不收参考图。
    if (!availableVideoModes.length) return 0
    return Math.min(getVideoModeSpec(videoMode).maxImages, paramOptions.maxReferenceImages)
  }, [mode, videoMode, availableVideoModes.length, paramOptions.maxReferenceImages])

  // 上限变小（换模式/换模型）时裁掉多余参考图；纯文生模型上限为 0，等于整体清空。
  useEffect(() => {
    setRefImages((current) => {
      if (current.length <= maxRefImages) return current
      // 被截掉的那部分要回收 objectURL，否则原图会一直驻留内存。
      current.slice(maxRefImages).forEach((image) => {
        if (image.isObjectUrl) URL.revokeObjectURL(image.url)
      })
      return current.slice(0, maxRefImages)
    })
  }, [maxRefImages])

  /** 参考视频额度随所选模型变化（seedance 2.5 支持 30s，其余 15s）。 */
  const refVideoLimits = useMemo(() => resolveRefVideoLimits(selectedModel?.source), [selectedModel?.source])

  /** 切换创作模式：参数与参考图的收敛交给上面的 effect 统一处理。 */
  const switchMode = (next: StudioMode) => {
    if (next === mode) return
    setMode(next)
    setCustomOpen(false)
    if (next === 'image') {
      setShots([])
      // 参考视频只对视频生成有意义，切到图片模式时清空并回收预览地址。
      setRefVideos((current) => {
        current.forEach((video) => {
          if (video.isObjectUrl) URL.revokeObjectURL(video.url)
        })
        return []
      })
    }
  }

  /** 脚本模型：智能分镜依赖 responses.multimodal。 */
  const scriptModelVersionId = (modelsByOperation.get('responses.multimodal') || [])[0]?.id || 0

  /** 打开自定义分镜面板；尚无分镜时按当前总时长铺一份默认分镜。 */
  const openCustomStoryboard = () => {
    setShots((current) => (current.length ? current : createDefaultStudioShots(params.durationSec)))
    setCustomOpen(true)
    setStoryboardOn(true)
  }

  /** 用 AI 把当前提示词拆成分镜脚本，写入分镜列表。 */
  const runAiStoryboard = useCallback(async () => {
    const requirement = prompt.trim()
    if (!requirement) {
      showToast('请先填写创作需求，再生成智能分镜')
      return
    }
    const authed = await requireAuth()
    if (!authed) return

    setScripting(true)
    try {
      const scriptShots = await generateScriptShotsStream(
        {
          requirement,
          ratio: params.ratio,
          duration: `${params.durationSec}s`,
          ...(scriptModelVersionId ? { modelVersionId: scriptModelVersionId } : {}),
        },
        // 流式中间态即时回显，让用户看到分镜逐条出现。
        (streaming) => {
          if (aliveRef.current) setShots(fromScriptShots(streaming))
        },
      )
      if (!aliveRef.current) return
      setShots(fromScriptShots(scriptShots))
      setCustomOpen(true)
      showToast('智能分镜已生成，可继续调整每一镜')
    } catch (error: any) {
      if (aliveRef.current) showToast(getBusinessErrorMessage(error) || error?.message || '智能分镜生成失败')
    } finally {
      if (aliveRef.current) setScripting(false)
    }
  }, [prompt, params.ratio, params.durationSec, scriptModelVersionId, requireAuth, showToast])

  /**
   * 把本地参考图上传落库，返回与输入【同序】的 asset_id。
   *
   * 参考图按位置对应镜头画面，任一张失败都不能静默跳过——否则后面的图整体前移，
   * 会拿着错位的参考帧创建计费任务。因此这里失败即抛，由调用方整批失败。
   */
  const resolveRefImageAssetIds = useCallback(
    async (images: readonly StudioRefImage[]): Promise<number[]> => {
      if (!images.length) return []
      const cache: Record<string, number> = {}
      const ids = await Promise.all(images.map((image) => ensureAssetId(ws, image.url, cache)))
      const normalized = ids.map((id) => Number(id) || 0)
      if (normalized.some((id) => id <= 0)) throw new Error('参考图上传失败，请重试')
      return normalized
    },
    [ws],
  )

  /**
   * 把参考视频上传落库。
   *
   * 不能复用 ensureAssetId：它只接受图片（会按 MIME 与 magic bytes 校验并拒绝视频）。
   * 这里直接用原始 File 走 uploadAssetFile，由文件自身推断素材类型。
   */
  const resolveRefVideoAssetIds = useCallback(
    async (videos: readonly StudioRefVideo[]): Promise<number[]> => {
      if (!videos.length) return []
      const results = await Promise.all(videos.map((video) => uploadAssetFile({ workspaceId: ws, file: video.file })))
      const ids = results.map((out: any) => Number(out?.asset?.id || 0) || 0)
      if (ids.some((id) => id <= 0)) throw new Error('参考视频上传失败，请重试')
      return ids
    },
    [ws],
  )

  /** 把某个批次内的单条产物更新为完成/失败。 */
  const patchItem = useCallback(
    (batchId: string, itemId: string, patch: Partial<StudioResultItem>) => {
      if (!aliveRef.current) return
      setBatches((current) =>
        current.map((batch) =>
          batch.id === batchId
            ? { ...batch, items: batch.items.map((item) => (item.id === itemId ? { ...item, ...patch } : item)) }
            : batch,
        ),
      )
    },
    [setBatches],
  )

  /** 滚动到指定批次，用于点击系统通知回到页面后定位。 */
  const scrollToBatch = useCallback((batchId: string) => {
    document.getElementById(`studio-batch-${batchId}`)?.scrollIntoView({ block: 'center' })
  }, [])

  // 已认领续轮询的任务，避免历史刷新时对同一任务重复发起轮询。
  const resumedTaskIdsRef = useRef<Set<number>>(new Set())
  // 工作空间序号：切空间后在途的续轮询凭它判断自己是否已过期。
  const resumeScopeRef = useRef(0)

  // 切换工作空间后任务集合完全不同：清空认领记录，并让在途回调作废
  // （否则旧空间的结果会打到新空间的列表上，或旧 task_id 挡住新空间的同号任务）。
  useEffect(() => {
    resumeScopeRef.current += 1
    resumedTaskIdsRef.current = new Set()
  }, [ws])

  /**
   * 续接刷新前还没跑完的视频任务。
   *
   * 历史流里状态仍是「生成中」的批次，如果不续轮询就会永远停在转圈上。这里凭
   * task_id 直接续轮询到终态（不重新建任务、不重复扣积分）。
   */
  useEffect(() => {
    if (!ws) return
    const pending = findResumableItems(batches, resumedTaskIdsRef.current)
    if (!pending.length) return

    const scope = resumeScopeRef.current
    pending.forEach(({ batchId, itemId, taskId }) => {
      // 同步登记：本 effect 因 patchItem 触发的重跑会据此跳过该任务，不会重复轮询。
      resumedTaskIdsRef.current.add(taskId)

      void (async () => {
        try {
          const result = await resumeFullVideo({
            workspaceId: ws,
            taskId,
            onProgress: (progress) => {
              if (resumeScopeRef.current === scope) patchItem(batchId, itemId, { progress })
            },
          })
          if (resumeScopeRef.current !== scope) return
          patchItem(batchId, itemId, { status: 'done', url: result.url })
        } catch (error: any) {
          if (resumeScopeRef.current !== scope) return
          patchItem(batchId, itemId, {
            status: 'failed',
            error: getBusinessErrorMessage(error) || error?.message || '生成失败',
          })
        }
      })()
    })
  }, [batches, ws, patchItem])

  const promptText = prompt.trim()
  const useStoryboard = mode === 'video' && storyboardOn && shots.length > 0

  /**
   * 送去生成与估价的时间线。
   * 开启智能分镜时用整份分镜，否则退化为「整段提示词 + 总时长」的单镜。
   * 估价与提交共用这一份，保证「预估 = 实扣」。
   */
  const timeline = useMemo(
    () =>
      useStoryboard
        ? shots.map((shot) => ({
            desc: shot.desc,
            duration: `${shot.dur}s`,
            line: shot.line,
            subtitle: shot.subtitle,
            sfx: shot.sfx,
          }))
        : [{ desc: promptText, duration: `${params.durationSec}s` }],
    [useStoryboard, shots, promptText, params.durationSec],
  )

  /**
   * 送去估价的时间线：只保留影响计价的时长，画面描述一律置空。
   *
   * 计价由「模型 + 时长 + 比例 + 分辨率」决定，与描述文字无关。若把 desc 也带上，
   * 用户每敲一个字都会重新触发一次付费估价接口，纯属浪费。
   */
  // 依赖只取「各镜时长」序列：改画面描述不影响计价，不应重新估价。
  const shotDurationKey = useStoryboard ? shots.map((shot) => shot.dur).join(',') : String(params.durationSec)
  const estimateShots = useMemo(
    () => shotDurationKey.split(',').map((sec) => ({ desc: '', duration: `${sec}s` })),
    [shotDurationKey],
  )

  /** 提交前的积分预估，展示在生成按钮上。 */
  const { estimate, loading: estimating } = useStudioCostEstimate({
    workspaceId: ws,
    mode,
    modelVersionId: selectedModelId,
    modelVersion: selectedModel?.source,
    ratio: params.ratio,
    resolution: params.resolution,
    count: params.count,
    shots: estimateShots,
    referenceImageCount: refImages.length,
    ...(paramOptions.supportsAudio ? { generateAudio: params.generateAudio } : {}),
    enabled: Boolean(selectedModel) && (Boolean(promptText) || refImages.length > 0),
  })

  /** 提交一次生成：按模式分派到图片或视频链路，每条产物独立完成。 */
  const submit = async () => {
    const text = promptText

    if (!text && !useStoryboard && !refImages.length) {
      showToast('请先输入创作描述')
      return
    }
    if (!ws) {
      showToast('请先选择工作空间')
      return
    }
    if (useStoryboard) {
      const invalid = validateStudioShots(shots)
      if (invalid) {
        showToast(invalid)
        return
      }
    }
    if (mode === 'video') {
      // 生成模式对参考图数量有硬要求（首尾帧 1~2 张、参考生视频 1~9 张、文生视频不收图）。
      const invalidImages = validateVideoModeImages(videoMode, refImages.length)
      if (invalidImages) {
        showToast(invalidImages)
        return
      }
      if (refVideos.length) {
        const invalidVideos = validateRefVideos(refVideos, refVideoLimits)
        if (invalidVideos) {
          showToast(invalidVideos)
          return
        }
      }
    }
    if (!selectedModel) {
      showToast(modelLoading ? '模型目录加载中，请稍候' : '当前工作空间暂无可用模型')
      return
    }
    // 预估已明确算出余额不足时先拦一道，避免白跑一次上传再被后端拒绝。
    if (estimate && !estimate.canAfford) {
      showToast(
        `预计消耗 ${estimate.total} 积分${estimate.balance === null ? '' : `，当前余额 ${estimate.balance} 积分`}，积分不足`,
        'error',
      )
      return
    }

    const authed = await requireAuth()
    if (!authed) return

    const batchId = createStudioId('batch')
    const items: StudioResultItem[] = Array.from({ length: params.count }, () => ({
      id: createStudioId('item'),
      status: 'pending' as const,
    }))
    const batch: StudioResultBatch = {
      id: batchId,
      mode,
      prompt: text,
      summary: formatParamsSummary(mode, params),
      // 比例随批次固定下来，右侧格子据此占位，生成中与出图后同形。
      ratio: params.ratio,
      createdAt: Date.now(),
      items,
      ...(useStoryboard ? { shotCount: shots.length } : {}),
    }
    // 聊天式排列：新的一次生成追加到底部。
    setBatches((current) => [...current, batch])
    setSubmitting(true)

    try {
      // 图片与视频是彼此独立的上传，并行发起，避免用户白等一段串行时间。
      const [refAssetIds, refVideoAssetIds] = await Promise.all([
        resolveRefImageAssetIds(refImages),
        mode === 'video' ? resolveRefVideoAssetIds(refVideos) : Promise.resolve<number[]>([]),
      ])

      // 每条产物并发生成，单条失败不影响同批其他产物。
      let succeeded = 0
      await Promise.all(
        items.map(async (item, index) => {
          try {
            if (mode === 'image') {
              const result = await generateShotImage({
                workspaceId: ws,
                prompt: text,
                refAssetIds,
                modelVersionId: selectedModel.id,
                modelVersion: selectedModel.source,
                ratio: params.ratio,
              })
              patchItem(batchId, item.id, { status: 'done', url: result.url })
              succeeded += 1
              return
            }

            const result = await generateFullVideo({
              workspaceId: ws,
              shots: timeline,
              basePrompt: text,
              ratio: params.ratio,
              resolution: params.resolution,
              modelVersionId: selectedModel.id,
              modelVersion: selectedModel.source,
              ...(refAssetIds.length ? { imageAssetIds: refAssetIds } : {}),
              // 首尾帧 / 参考模式由 params.reference_mode 决定，图片一律以统一 role 下发。
              referenceMode: videoReferenceMode(videoMode),
              ...(refVideoAssetIds.length ? { sourceVideoAssetIds: refVideoAssetIds } : {}),
              ...(paramOptions.supportsAudio ? { generateAudio: params.generateAudio } : {}),
              ...(params.count > 1 ? { variationIndex: index + 1, variationTotal: params.count } : {}),
              // 任务一创建就把 task_id 记到【这条产物】上：刷新后凭它续轮询，而非重新生成。
              // 一批多个视频会各自建任务，所以必须逐条记录，不能共用批次上的一个字段。
              // 本次提交已经在轮询了，先登记为「已认领」，避免续轮询的 effect 再接一次。
              onTask: (taskId) => {
                resumedTaskIdsRef.current.add(taskId)
                patchItem(batchId, item.id, { taskId })
              },
              onProgress: (progress) => patchItem(batchId, item.id, { progress }),
            })
            patchItem(batchId, item.id, { status: 'done', url: result.url })
            succeeded += 1
          } catch (error: any) {
            patchItem(batchId, item.id, {
              status: 'failed',
              error: getBusinessErrorMessage(error) || error?.message || '生成失败',
            })
          }
        }),
      )

      // 生成成功且用户已经切走时叫他回来；页面就在眼前时不打扰（用户决策 2026-08-26）。
      if (succeeded > 0) {
        void notifyGenerationDone({
          count: succeeded,
          kind: mode,
          prompt: text,
          onClick: () => scrollToBatch(batchId),
        })
      }
    } catch (error: any) {
      // 参考图上传等前置步骤失败：整批标记失败，避免留下永久 pending。
      const message = getBusinessErrorMessage(error) || error?.message || '生成失败'
      if (aliveRef.current) {
        setBatches((current) =>
          current.map((entry) =>
            entry.id === batchId
              ? {
                  ...entry,
                  items: entry.items.map((item) =>
                    item.status === 'pending' ? { ...item, status: 'failed' as const, error: message } : item,
                  ),
                }
              : entry,
          ),
        )
      }
      showToast(message)
    } finally {
      if (aliveRef.current) setSubmitting(false)
    }
  }

  const storyboardTotal = totalStudioShotSec(shots)
  const canSubmit = !submitting && !scripting && Boolean(ws)

  return (
    <div className="studio-view">
      <AppSidebar
        activeKey="studio"
        onNavigate={handleNavigate}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="studio-view__main">
        <AppTopbar onMenu={() => setSidebarOpen(true)} />

        <div className="studio-view__body">
          {/* ── 左侧控制台 ── */}
          <section className="studio-console" aria-label="生成控制台">
            <div className="studio-console__tabs" role="tablist" aria-label="创作模式">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'image'}
                className={`studio-console__tab${mode === 'image' ? ' is-active' : ''}`}
                onClick={() => switchMode('image')}
              >
                图片生成
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'video'}
                className={`studio-console__tab${mode === 'video' ? ' is-active' : ''}`}
                onClick={() => switchMode('video')}
              >
                视频生成
              </button>
            </div>

            <div className="studio-console__scroll">
              {/* 模型选择：logo、名称、描述与约束标签均来自后端模型目录 */}
              <StudioModelPicker
                models={primaryModels}
                value={selectedModelId}
                onChange={setSelectedModelId}
                loading={modelLoading}
                disabled={submitting}
                placeholderDescription={mode === 'video' ? '支持多镜头叙事与时间线对齐' : '强化一致性，支持多参考图'}
              />

              {/* 视频生成模式：决定参考图的数量语义与下发角色 */}
              {mode === 'video' && (
                <StudioVideoModeTabs
                  modes={availableVideoModes}
                  value={videoMode}
                  onChange={setVideoMode}
                  disabled={submitting}
                />
              )}

              {/* 首尾帧用具名槽位：这两张图的顺序决定 first_frame / last_frame，必须可见可纠正 */}
              {maxRefImages > 0 &&
                (mode === 'video' && videoMode === 'first-last' ? (
                  <StudioFrameSlots images={refImages} onChange={setRefImages} disabled={submitting} />
                ) : (
                  <StudioRefImages
                    title={mode === 'video' ? '参考图' : '参考生图'}
                    images={refImages}
                    onChange={setRefImages}
                    max={maxRefImages}
                    hint={
                      mode === 'video'
                        ? `用 1~${maxRefImages} 张参考图约束主体与风格`
                        : `可选：上传参考图后自动走图生图，最多 ${maxRefImages} 张`
                    }
                    disabled={submitting}
                  />
                ))}

              {/* 参考视频：仅视频模式，额度随所选模型变化 */}
              {mode === 'video' && (
                <StudioRefVideos
                  videos={refVideos}
                  onChange={setRefVideos}
                  limits={refVideoLimits}
                  onReject={(reason) => showToast(reason)}
                  disabled={submitting}
                />
              )}

              {/* 提示词 */}
              <div className="studio-prompt">
                <textarea
                  className="studio-prompt__input"
                  value={prompt}
                  placeholder={
                    mode === 'video'
                      ? '描述你想生成的视频内容，如：谁在哪、发生了什么。开启智能分镜后会自动拆成多个镜头。'
                      : '直接描述想生成的图片内容，越具体效果越好。'
                  }
                  disabled={submitting}
                  onChange={(event) => setPrompt(event.target.value)}
                />
                <div className="studio-prompt__footer">
                  <span className="studio-prompt__count">{prompt.length}</span>
                  <span className="studio-prompt__actions">
                    <button
                      type="button"
                      className="studio-ghost-btn"
                      disabled={submitting || !prompt}
                      onClick={() => setPrompt('')}
                    >
                      清空
                    </button>
                  </span>
                </div>
              </div>

              {/* 智能分镜（仅视频模式） */}
              {mode === 'video' && (
                <>
                  <div className="studio-storyboard-bar">
                    <button
                      type="button"
                      className={`studio-switch${storyboardOn ? ' is-on' : ''}`}
                      role="switch"
                      aria-checked={storyboardOn}
                      aria-label="智能分镜"
                      disabled={submitting}
                      onClick={() => {
                        const next = !storyboardOn
                        setStoryboardOn(next)
                        if (!next) setCustomOpen(false)
                      }}
                    />
                    <span>
                      <span className="studio-storyboard-bar__label">智能分镜</span>
                      <br />
                      <span className="studio-storyboard-bar__hint">
                        {storyboardOn ? '把需求拆成多个镜头，逐镜控制画面与时长' : '关闭后按单镜整段生成'}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="studio-storyboard-bar__custom"
                      disabled={submitting || !storyboardOn}
                      onClick={() => (customOpen ? setCustomOpen(false) : openCustomStoryboard())}
                    >
                      {customOpen ? '收起分镜' : '自定义分镜'}
                    </button>
                  </div>

                  {storyboardOn && customOpen && (
                    <>
                      <button
                        type="button"
                        className="studio-ghost-btn"
                        disabled={submitting || scripting || !prompt.trim()}
                        onClick={() => void runAiStoryboard()}
                      >
                        {scripting ? '正在拆解分镜…' : '✦ 用 AI 自动拆分镜'}
                      </button>
                      <StudioShotList
                        shots={shots}
                        onChange={setShots}
                        onExit={() => setCustomOpen(false)}
                        targetSec={params.durationSec}
                        disabled={submitting}
                      />
                      {storyboardTotal !== params.durationSec && shots.length > 0 && (
                        <p className="studio-console__disclaimer">
                          分镜总时长 {storyboardTotal}s 与设定的 {params.durationSec}s 不一致，将以分镜时间线为准。
                        </p>
                      )}
                    </>
                  )}
                </>
              )}
            </div>

            <div className="studio-console__footer">
              <div className="studio-console__submit-row">
                <StudioParamsBar
                  mode={mode}
                  params={params}
                  options={paramOptions}
                  onChange={setParams}
                  disabled={submitting}
                />
                {/* 提交前的积分预估：与提交同口径，未登录/估价失败时不展示 */}
                <span className="studio-cost" aria-live="polite">
                  {estimating && '积分预估中…'}
                  {!estimating && estimate && (
                    <>
                      <span className={`studio-cost__value${estimate.canAfford ? '' : ' is-short'}`}>
                        {estimate.total} 积分
                      </span>
                      {estimate.balance !== null && (
                        <span className="studio-cost__balance">余额 {estimate.balance}</span>
                      )}
                    </>
                  )}
                </span>
              </div>
              <button type="button" className="studio-submit" disabled={!canSubmit} onClick={() => void submit()}>
                {submitting ? '生成中…' : estimate ? `生成 · ${estimate.total} 积分` : '生成'}
              </button>
              <p className="studio-console__disclaimer">内容由 AI 生成，请遵守平台规范，禁止用于违法用途。</p>
            </div>
          </section>

          {/* ── 右侧结果流 ── */}
          <div className="studio-view__feed">
            <StudioResultFeed
              batches={batches}
              filter={filter}
              onFilterChange={setFilter}
              loading={historyLoading}
              loadingMore={historyLoadingMore}
              hasMore={historyHasMore}
              onLoadMore={() => void loadOlderHistory()}
              onPreview={(item) => item.url && window.open(item.url, '_blank', 'noopener,noreferrer')}
              onRetry={(target) => {
                // 参数会由模式/模型 effect 自动收敛到目标模式的合法档位。
                setMode(target.mode)
                setPrompt(target.prompt)
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
