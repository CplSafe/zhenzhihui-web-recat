/**
 * Hook: 视频生成任务编排
 * 管理 Seedance 视频生成全流程：提交任务、轮询状态、历史记录、预览播放、下载发布。
 *
 * React 迁移说明：原 Vue composable 使用 ref + useTaskPolling(ref 版)。
 * 这里改为 React hook：对视图需要渲染的状态用 useState，对编排逻辑中频繁读写、
 * 不需要触发渲染的瞬时值（task / assetId / prompt / 历史列表的最新快照）用 useRef
 * 镜像，避免闭包读到旧值。useTaskPolling 已迁移为 React hook。
 */

import { useCallback, useRef, useState } from 'react'
import {
  createAiTask,
  deleteAsset,
  estimateAiTaskCost,
  getAiTask,
  getAssetDownloadUrl,
  getBusinessErrorMessage,
  getModelForOperation,
  isAbortedTaskError,
} from '@/api/business'
import { useTaskPolling } from '@/composables/useTaskPolling'
import { resolveGeneratedMediaUrls } from '@/utils/taskMedia'
import { normalizeSeedanceDuration, normalizeSeedanceRatio } from '@/utils/videoOptions'
import { buildVideoGenerationParams } from '@/utils/videoTasks'
import { isSafeMediaUrl } from '@/utils/urlSafety'

const VIDEO_MODEL_KEYWORDS = ['seedance', 'seedance 2.0', 'doubao-seedance-2-0']
const VIDEO_POLL_INTERVAL_MS = 4000
const VIDEO_POLL_TIMEOUT_MS = 20 * 60 * 1000
const VIDEO_HISTORY_LIMIT = 12

const extractVideoAssetId = (task: any): number =>
  task?.outputs?.find?.((output: any) => output?.asset_id)?.asset_id || 0

// 依赖注入：所有视图层关注点（workspace 查询、套餐加载、toast、prompt 构造、
// 输入素材选择、模型选项辅助、步骤导航、abort controller 注册表）通过 deps 注入，
// 保持本模块独立于视图内部实现。
export interface VideoGenerationDeps {
  workspaceId: { value: any } | (() => any)
  selectedDuration: { value: any } | (() => any)
  selectedRatio: { value: any } | (() => any)
  modelPlanCandidates: { value: any } | (() => any)
  timelineDuration: { value: any } | (() => any)
  buildPrompt: () => string
  buildInputAssets: () => any[]
  getAllCandidateAssets?: () => any[]
  getSupportedDurationOptions: (model: any) => any[]
  formatDurationOptions: (options: any[]) => string
  getWorkspaceIdOrNotify: () => any
  ensureModelPlanCandidatesLoaded: () => Promise<any>
  showToast: (message: string, type?: string) => void
  setCurrentStep: (step: string) => void
  createTaskAbortController?: () => any
  releaseTaskAbortController?: (controller: any) => void
  abortAllPendingTasks?: () => void
  onGenerated?: () => void
}

// 把 deps 里可能是 ref 风格（{ value }）或 getter（函数）的字段统一读成实际值。
function readDep(dep: any): any {
  if (typeof dep === 'function') return dep()
  return dep?.value
}

export function useVideoGeneration(deps: VideoGenerationDeps) {
  const {
    workspaceId,
    selectedDuration,
    selectedRatio,
    modelPlanCandidates,
    timelineDuration,
    buildPrompt,
    buildInputAssets,
    getAllCandidateAssets,
    getSupportedDurationOptions,
    formatDurationOptions,
    getWorkspaceIdOrNotify,
    ensureModelPlanCandidatesLoaded,
    showToast,
    setCurrentStep,
    onGenerated,
  } = deps

  // ---- 视图需要渲染的状态 ----
  const [generatedVideoUrl, setGeneratedVideoUrlState] = useState<string>('')
  const [generatedVideoTask, setGeneratedVideoTaskState] = useState<any>(null)
  const [videoHistoryList, setVideoHistoryListState] = useState<any[]>([])
  const [activeVideoHistoryId, setActiveVideoHistoryIdState] = useState<string>('')
  const [isVideoGenerating, setIsVideoGeneratingState] = useState<boolean>(false)
  const [videoProgress, setVideoProgressState] = useState<number>(0)

  const [videoCostEstimate, setVideoCostEstimate] = useState<any>(null)
  const [isEstimatingVideoCost, setIsEstimatingVideoCost] = useState<boolean>(false)
  const [videoCostEstimateError, setVideoCostEstimateError] = useState<string>('')

  // ---- 内部 ref 镜像：编排逻辑读最新值用 ----
  const generatedVideoUrlRef = useRef<string>('')
  const generatedVideoTaskRef = useRef<any>(null)
  const generatedVideoAssetIdRef = useRef<number>(0)
  const videoHistoryListRef = useRef<any[]>([])
  const activeVideoHistoryIdRef = useRef<string>('')
  const lastVideoPromptRef = useRef<string>('')
  const isVideoGeneratingRef = useRef<boolean>(false)

  // ---- 同步 setter：state + ref 一并更新 ----
  const setGeneratedVideoUrl = useCallback((value: string) => {
    generatedVideoUrlRef.current = value
    setGeneratedVideoUrlState(value)
  }, [])
  const setGeneratedVideoTask = useCallback((value: any) => {
    generatedVideoTaskRef.current = value
    setGeneratedVideoTaskState(value)
  }, [])
  const setGeneratedVideoAssetId = useCallback((value: number) => {
    generatedVideoAssetIdRef.current = value
  }, [])
  const setVideoHistoryList = useCallback((value: any[]) => {
    videoHistoryListRef.current = value
    setVideoHistoryListState(value)
  }, [])
  const setActiveVideoHistoryId = useCallback((value: string) => {
    activeVideoHistoryIdRef.current = value
    setActiveVideoHistoryIdState(value)
  }, [])
  const setIsVideoGenerating = useCallback((value: boolean) => {
    isVideoGeneratingRef.current = value
    setIsVideoGeneratingState(value)
  }, [])

  // 假进度 + 真状态收口的轮询引擎
  const videoPolling = useTaskPolling({
    fetchTask: (taskId: string) => getAiTask({ workspaceId: readDep(workspaceId), taskId }),
    defaultIntervalMs: VIDEO_POLL_INTERVAL_MS,
    timeoutMs: VIDEO_POLL_TIMEOUT_MS,
    onProgress: (p: number) => {
      setVideoProgressState(p)
    },
    onPoll: (latestTask: any) => {
      setGeneratedVideoTask(latestTask)
    },
  })

  function pushVideoHistory(entry: any) {
    if (!entry?.url || !isSafeMediaUrl(entry.url)) return
    const list = videoHistoryListRef.current
    const id = entry.id || `video-${entry.taskId || Date.now()}`
    const existing = list.find((item) => item.id === id)
    const record = {
      id,
      name: entry.name || existing?.name || `版本 ${String(list.length + 1).padStart(2, '0')}`,
      ...entry,
    }
    if (existing) {
      setVideoHistoryList(list.map((item) => (item.id === id ? { ...item, ...record } : item)))
    } else {
      setVideoHistoryList([record, ...list].slice(0, VIDEO_HISTORY_LIMIT))
    }
    setActiveVideoHistoryId(id)
  }

  function resolveDurationSec() {
    const td = readDep(timelineDuration)
    const seconds = td > 0 ? `${Math.round(td)}s` : readDep(selectedDuration)
    return normalizeSeedanceDuration(seconds)
  }

  function validateModel(model: any): true | string {
    const supported = getSupportedDurationOptions(model)
      .map((option: any) => Number.parseInt(String(option), 10))
      .filter((num: number) => Number.isFinite(num) && num > 0)
    if (!supported.length) {
      return true
    }

    const durationToSend = resolveDurationSec()
    if (supported.includes(durationToSend)) {
      return true
    }

    const optionsText = formatDurationOptions(supported)
    return `当前 Seedance 模型仅支持 ${optionsText}，请调整时长或在管理后台更新模型参数`
  }

  async function estimateVideoCost({ silent = false }: { silent?: boolean } = {}) {
    if (isEstimatingVideoCost) return videoCostEstimate
    const id = getWorkspaceIdOrNotify()
    if (!id) return null
    setIsEstimatingVideoCost(true)
    if (!silent) setVideoCostEstimateError('')
    try {
      await ensureModelPlanCandidatesLoaded()
      const model = await getModelForOperation('video.generate', VIDEO_MODEL_KEYWORDS, readDep(modelPlanCandidates))
      const validated = validateModel(model)
      if (validated !== true) {
        throw new Error(validated || '当前模型不可用')
      }
      const basePrompt = buildPrompt()
      const params = buildVideoGenerationParams(model, {
        duration: resolveDurationSec(),
        resolution: '720p',
        ratio: normalizeSeedanceRatio(readDep(selectedRatio)),
        generateAudio: true,
      })
      const res = await estimateAiTaskCost({
        workspaceId: id,
        modelVersionId: model?.id,
        operationCode: 'video.generate',
        prompt: basePrompt,
        params,
      })
      setVideoCostEstimate(res || null)
      return res
    } catch (error: any) {
      setVideoCostEstimate(null)
      if (!silent) setVideoCostEstimateError(getBusinessErrorMessage(error, error?.message || '预估失败'))
      return null
    } finally {
      setIsEstimatingVideoCost(false)
    }
  }

  async function runVideoGeneration({ overridePrompt }: { overridePrompt?: string } = {}) {
    if (isVideoGeneratingRef.current) return

    const id = getWorkspaceIdOrNotify()
    if (!id) return

    videoPolling.cancel()
    setIsVideoGenerating(true)

    try {
      await ensureModelPlanCandidatesLoaded()

      setCurrentStep('video')
      setGeneratedVideoUrl('')
      setGeneratedVideoTask(null)
      setGeneratedVideoAssetId(0)

      const basePrompt = buildPrompt()
      const promptText = overridePrompt ? `${basePrompt}\n额外修改要求：${overridePrompt}` : basePrompt
      lastVideoPromptRef.current = overridePrompt || ''

      // — Seedance 只接受一张参考图。优先用脱敏版，遇审核拦截换下一张。
      const allCandidates =
        typeof getAllCandidateAssets === 'function' ? getAllCandidateAssets() : buildInputAssets()
      const ordered = [
        ...allCandidates.filter((a: any) => a?.isBlurred && a?.asset_id),
        ...allCandidates.filter((a: any) => !a?.isBlurred && a?.asset_id),
      ]

      let lastError: any = null
      let completedTask: any = null
      let videoAssetId = 0
      let mediaUrl = ''

      for (const candidate of ordered) {
        try {
          const resolveInputAssets = () => {
            if (overridePrompt && generatedVideoAssetIdRef.current) {
              return [{ asset_id: generatedVideoAssetIdRef.current, role: 'video' }]
            }
            return [{ asset_id: candidate.asset_id, role: 'image' }]
          }

          const task = await createAiTask({
            workspaceId: id,
            capability: 'video',
            operationCode: 'video.generate',
            preferredModelKeywords: VIDEO_MODEL_KEYWORDS,
            modelPlanCandidates: readDep(modelPlanCandidates),
            modelValidator: validateModel,
            prompt: promptText,
            inputAssets: resolveInputAssets(),
            params: (model: any) =>
              buildVideoGenerationParams(model, {
                duration: resolveDurationSec(),
                resolution: '720p',
                ratio: normalizeSeedanceRatio(readDep(selectedRatio)),
                generateAudio: true,
              }),
          })
          setGeneratedVideoTask(task)

          videoPolling.cancel()
          const outcome = await videoPolling.start(task.id)
          if (!outcome.success) {
            if (outcome.cancelled) return
            throw new Error(outcome.error || '视频生成失败')
          }
          completedTask = outcome.result
          setGeneratedVideoTask(completedTask)

          videoAssetId = extractVideoAssetId(completedTask)
          setGeneratedVideoAssetId(videoAssetId)

          const [url] = await resolveGeneratedMediaUrls({
            workspaceId: id,
            task: completedTask,
            type: 'video',
          })
          mediaUrl = url || ''
          setGeneratedVideoUrl(mediaUrl)

          if (!mediaUrl) {
            throw new Error('视频任务已完成，暂未返回可预览地址')
          }

          lastError = null
          break
        } catch (error: any) {
          lastError = error
          if (!/SensitiveContentDetected|PrivacyInformation/i.test(String(error?.message || ''))) {
            throw error
          }
          // 内容审核拦截：换下一张候选图再试
          if (!/SensitiveContentDetected|PrivacyInformation/i.test(String(error?.message || ''))) {
            throw error
          }
          const remaining = ordered.filter((a) => a !== candidate)
          if (remaining.length) {
            showToast(
              `当前分镜图未通过内容审核，自动尝试下一张（剩余 ${remaining.length} 张）`,
              'info',
            )
          }
        }
      }

      if (lastError) {
        throw lastError
      }

      pushVideoHistory({
        url: mediaUrl,
        assetId: videoAssetId,
        taskId: completedTask?.id,
        prompt: lastVideoPromptRef.current,
        createdAt: Date.now(),
      })

      showToast('视频已生成', 'success')

      if (typeof onGenerated === 'function') {
        onGenerated()
      }
    } catch (error: any) {
      if (isAbortedTaskError(error)) return
      showToast(getBusinessErrorMessage(error, error.message || 'Seedance 2.0 视频生成失败'), 'error')
    } finally {
      setIsVideoGenerating(false)
    }
  }

  const generateVideo = () => runVideoGeneration()

  async function modifyVideoWithPrompt(prompt: string) {
    const trimmed = (prompt || '').trim()
    if (!trimmed) return showToast('请输入修改描述', 'error')
    if (isVideoGeneratingRef.current) return showToast('当前已有视频生成中，请稍候', 'error')
    if (!generatedVideoUrlRef.current && !generatedVideoAssetIdRef.current) {
      return showToast('暂无可修改的视频，请先生成', 'error')
    }
    await runVideoGeneration({ overridePrompt: trimmed })
  }

  async function handleSelectVideoHistory(item: any) {
    if (!item) return
    setActiveVideoHistoryId(item.id || '')
    // 先用存储的 URL 兜底（可能过期），再用 assetId 拿最新签名链接覆盖
    if (isSafeMediaUrl(item.url)) setGeneratedVideoUrl(item.url)
    if (item.assetId) {
      setGeneratedVideoAssetId(item.assetId)
      const wsId = readDep(workspaceId)
      if (wsId) {
        try {
          const freshUrl = await getAssetDownloadUrl({ workspaceId: wsId, assetId: item.assetId })
          if (freshUrl) setGeneratedVideoUrl(freshUrl)
        } catch {
          /* 获取失败不阻塞，保留旧 URL */
        }
      }
      // 后台更新历史记录里存的 URL
      refreshVideoHistoryUrl(item.id, item.assetId)
    } else {
      setGeneratedVideoAssetId(0)
    }
    if (item.taskId && generatedVideoTaskRef.current?.id !== item.taskId) {
      setGeneratedVideoTask({ id: item.taskId, status: 'succeeded' })
    } else if (!item.taskId) {
      setGeneratedVideoTask(null)
    }
  }

  // 后台静默刷新历史项的 src URL，不阻塞当前操作
  async function refreshVideoHistoryUrl(historyId: string, assetId: number) {
    const wsId = readDep(workspaceId)
    if (!historyId || !assetId || !wsId) return
    try {
      const freshUrl = await getAssetDownloadUrl({ workspaceId: wsId, assetId })
      if (freshUrl) {
        setVideoHistoryList(
          videoHistoryListRef.current.map((entry) =>
            entry.id === historyId ? { ...entry, url: freshUrl } : entry,
          ),
        )
      }
    } catch {
      /* 静默失败 */
    }
  }

  async function deleteVideoHistoryItem(item: any) {
    const targetId = item?.id
    if (!targetId) return

    const target = videoHistoryListRef.current.find((entry) => entry.id === targetId)
    if (!target) return

    const wsId = readDep(workspaceId)
    const assetId = Number(target.assetId || 0)

    if (assetId > 0 && wsId) {
      try {
        await deleteAsset({ workspaceId: wsId, assetId })
      } catch (error: any) {
        showToast(getBusinessErrorMessage(error, '删除历史视频失败，请稍后重试'), 'error')
        return
      }
    }

    const nextHistory = videoHistoryListRef.current.filter((entry) => entry.id !== targetId)
    setVideoHistoryList(nextHistory)

    if (activeVideoHistoryIdRef.current === targetId || generatedVideoUrlRef.current === target.url) {
      const fallback = nextHistory[0]
      if (fallback) {
        await handleSelectVideoHistory(fallback)
      } else {
        setGeneratedVideoUrl('')
        setGeneratedVideoTask(null)
        setGeneratedVideoAssetId(0)
        setActiveVideoHistoryId('')
      }
    }

    showToast('历史视频已删除', 'success')
  }

  async function refreshGeneratedVideoUrl(assetId: number) {
    const wsId = readDep(workspaceId)
    if (!assetId || !wsId) return
    try {
      const url = await getAssetDownloadUrl({ workspaceId: wsId, assetId })
      if (url) setGeneratedVideoUrl(url)
    } catch {
      // Best-effort refresh; keep cached URL if the asset is gone or unauthorized.
    }
  }

  // 进入视频步骤时批量刷新所有历史记录的签名 URL，避免过期无法播放
  async function refreshAllHistoryUrls() {
    const wsId = readDep(workspaceId)
    if (!wsId) return
    const entries = videoHistoryListRef.current
    if (!entries.length) return
    const refreshed = await Promise.all(
      entries.map(async (entry) => {
        const assetId = Number(entry.assetId || 0)
        if (!assetId) return entry
        try {
          const freshUrl = await getAssetDownloadUrl({ workspaceId: wsId, assetId })
          return freshUrl ? { ...entry, url: freshUrl } : entry
        } catch {
          return entry
        }
      }),
    )
    setVideoHistoryList(refreshed)
  }

  function handleVideoNotify(payload: any) {
    if (!payload) return
    const { message, type = 'success' } = typeof payload === 'string' ? { message: payload } : payload
    if (message) showToast(message, type)
  }

  function saveVideoDraft() {
    if (!generatedVideoUrlRef.current || !isSafeMediaUrl(generatedVideoUrlRef.current)) {
      showToast('暂无可保存的草稿视频，请先生成', 'error')
      return
    }
    const label = `草稿 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`
    pushVideoHistory({
      id: `draft-${Date.now()}`,
      name: label,
      url: generatedVideoUrlRef.current,
      assetId: generatedVideoAssetIdRef.current || 0,
      taskId: generatedVideoTaskRef.current?.id || 0,
      prompt: lastVideoPromptRef.current,
      createdAt: Date.now(),
      isDraft: true,
    })
    showToast('草稿已保存到历史记录', 'success')
  }

  const saveVideo = () => showToast('视频已保存', 'success')

  const publishVideo = (platform?: string) =>
    showToast(platform ? `已选择发布到${platform}` : '发布任务已创建', 'success')

  function resetVideo() {
    setGeneratedVideoUrl('')
    setGeneratedVideoTask(null)
    setGeneratedVideoAssetId(0)
    setVideoHistoryList([])
    setActiveVideoHistoryId('')
    lastVideoPromptRef.current = ''
    setIsVideoGenerating(false)
    setVideoProgressState(0)
    videoPolling.cancel()
  }

  return {
    // state
    generatedVideoUrl,
    generatedVideoTask,
    generatedVideoAssetId: generatedVideoAssetIdRef.current,
    videoHistoryList,
    activeVideoHistoryId,
    isVideoGenerating,
    videoProgress,
    // actions
    generateVideo,
    regenerateVideo: generateVideo,
    modifyVideoWithPrompt,
    handleSelectVideoHistory,
    deleteVideoHistoryItem,
    refreshGeneratedVideoUrl,
    refreshAllHistoryUrls,
    handleVideoNotify,
    saveVideoDraft,
    saveVideo,
    publishVideo,
    resetVideo,

    videoCostEstimate,
    isEstimatingVideoCost,
    videoCostEstimateError,
    estimateVideoCost,
  }
}
