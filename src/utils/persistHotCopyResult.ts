/**
 * 爆款复制:整片视频生成「完成即落库」—— 不依赖组件挂载。
 *
 * 背景与智能成片相同:生成是 server 端任务,用户在生成中切走 → 组件卸载,setState/autosave 不再运行,
 * 即使后端跑完也没写进草稿(只能等下次重进凭 task id 续轮询)。本函数在完成那刻直接拉最新草稿合并回写。
 *
 * 为什么单独一个函数、不复用 persistVideoResultToBackend:后者用 buildSmartSnapshot 重建草稿,会把
 * flow 变成 'smart',导致爆款项目进错编辑器(/smart)。这里【原样取回 draft_json】,只合并视频字段
 * (顶层 + smart 块)再存回,保留 flow:'hot-copy' 及所有爆款字段(sourceVideo/productAssetIds…)。
 */
import { getCreativeProject, updateCreativeProjectDraft } from '@/api/business'
import { enqueueCreativeProjectDraftSave } from '@/utils/creativeDraftSaveQueue'
import { sanitizeHotCopyPersistentDraft } from '@/utils/hotCopyPersistentDraft'
import { sanitizePersistentMediaUrl } from '@/utils/persistentMediaUrl'
import { sanitizeTelemetryText } from '@/utils/observabilitySanitizer'
import { bindVideoModificationNote } from '@/utils/videoModificationDraft'
import { findVideoGeneration, updateVideoGeneration } from '@/utils/videoGenerationRecords'

/**
 * 将爆款复制生成结果合并到服务端最新草稿，并串行保存以避免版本冲突。
 * 仅更新视频相关字段，保留 hot-copy 流程标记、源素材及其他页面写入的元数据。
 */
export async function persistHotCopyResultToBackend(args: {
  projectId: number
  workspaceId: number
  url: string
  assetId: number
  taskId?: number
  generationId?: string
  modificationNote?: string
}): Promise<boolean> {
  const { projectId, workspaceId, assetId, taskId, generationId } = args
  const url = sanitizePersistentMediaUrl(args.url, { assetId, workspaceId })
  if (!projectId || !workspaceId || (!url && !assetId)) return false

  const doSave = async () => {
    const proj: any = await getCreativeProject({ projectId, workspaceId })
    const rev = Number(proj?.draft_revision ?? proj?.data?.draft_revision ?? 0) || 0
    let draft: any = proj?.draft_json ?? proj?.data?.draft_json ?? proj?.draft
    if (typeof draft === 'string') {
      try {
        draft = JSON.parse(draft)
      } catch {
        draft = null
      }
    }
    if (!draft || typeof draft !== 'object') return false // 解析不出草稿 → 不动,避免空覆盖
    draft = sanitizeHotCopyPersistentDraft(draft, workspaceId)
    const flow = String(draft?.flow || draft?.smart?.flow || '').toLowerCase()
    if (flow !== 'hot-copy') return false // 只处理爆款草稿(别的流程走各自的持久化)

    const pushUnique = (list: any[], item: { url: string; assetId: number }) => {
      const arr = Array.isArray(list) ? list.slice() : []
      const exists = arr.some(
        (value: any) =>
          (item.assetId > 0 && Number(value?.assetId || 0) === item.assetId) ||
          (item.url && String(value?.url || '') === item.url),
      )
      if (!exists) arr.push(item)
      return arr
    }

    const smartSource = draft.smart && typeof draft.smart === 'object' ? draft.smart : null
    const topLevelVersions = Array.isArray(draft.videoHistoryList) ? draft.videoHistoryList : []
    const smartVersions = Array.isArray(smartSource?.videoVersions) ? smartSource.videoVersions : []
    const resultAlreadyPersisted =
      (assetId > 0 &&
        (Number(draft.generatedVideoAssetId || 0) === assetId ||
          Number(smartSource?.fullVideoAssetId || 0) === assetId ||
          topLevelVersions.some((version: any) => Number(version?.assetId || 0) === assetId) ||
          smartVersions.some((version: any) => Number(version?.assetId || 0) === assetId))) ||
      (Boolean(url) &&
        (String(draft.generatedVideoUrl || '') === url ||
          String(smartSource?.fullVideoUrl || '') === url ||
          topLevelVersions.some((version: any) => String(version?.url || '') === url) ||
          smartVersions.some((version: any) => String(version?.url || '') === url)))

    const expectedTaskId = Number(taskId || 0) || 0
    const expectedGenerationId = String(generationId || '').trim()
    const draftTaskId = Number(smartSource?.vidGenTaskId || 0) || 0
    const generations = Array.isArray(smartSource?.videoGenerations) ? smartSource.videoGenerations : []
    const matchingGeneration = findVideoGeneration<any>(generations, expectedGenerationId, expectedTaskId)
    const generationTaskId = Number(matchingGeneration?.taskId || 0) || 0
    const ownsByTask = expectedTaskId > 0 && draftTaskId === expectedTaskId
    const ownsByGeneration = Boolean(
      matchingGeneration &&
      String(matchingGeneration?.status || '').toLowerCase() === 'processing' &&
      (!expectedTaskId || !generationTaskId || generationTaskId === expectedTaskId),
    )
    // 自动保存可能先把媒体写进历史，但仍保留本任务的 processing/vidGenTaskId。
    // 只有媒体已存在且本回调没有任何可收尾的任务所有权时，才是可直接返回的真正重复回调。
    if (resultAlreadyPersisted && !ownsByTask && !ownsByGeneration) return true
    if ((!expectedTaskId && !expectedGenerationId) || !smartSource) return false
    if (!ownsByTask && !ownsByGeneration) return false
    const lastCompletedGenerationId = String(smartSource.lastCompletedVideoGenerationId || '').trim()
    const currentAssetId = Number(smartSource.fullVideoAssetId || 0) || 0
    const currentUrl = String(smartSource.fullVideoUrl || '').trim()
    const callbackIsCurrentResult =
      (assetId > 0 && currentAssetId === assetId) || (Boolean(url) && currentUrl === String(url).trim())
    const resultExistsOnlyInHistory =
      resultAlreadyPersisted && (currentAssetId > 0 || Boolean(currentUrl)) && !callbackIsCurrentResult
    const preserveNewerCurrentResult = Boolean(
      ownsByGeneration &&
      !ownsByTask &&
      (resultExistsOnlyInHistory ||
        (draftTaskId > 0 && draftTaskId !== expectedTaskId) ||
        (expectedGenerationId && lastCompletedGenerationId && lastCompletedGenerationId !== expectedGenerationId)),
    )

    // Clone only after the ownership gate. Stale callbacks must not mutate result fields in the fetched snapshot.
    draft = { ...draft }
    const smart = { ...smartSource }

    // 顶层字段(项目管理/首页派生用)
    if (!preserveNewerCurrentResult) {
      draft.generatedVideoUrl = url || draft.generatedVideoUrl
      draft.generatedVideoAssetId = assetId || draft.generatedVideoAssetId
    }
    draft.videoHistoryList = pushUnique(draft.videoHistoryList, { url, assetId })

    // smart 块(爆款回填精确恢复用;字段名与 buildHotCopySnapshot 一致)
    if (!preserveNewerCurrentResult) {
      smart.fullVideoUrl = url || smart.fullVideoUrl
      smart.fullVideoAssetId = assetId || smart.fullVideoAssetId
    }
    smart.videoVersions = pushUnique(smart.videoVersions, { url, assetId })
    if (ownsByTask) {
      smart.videoGenerating = false
      smart.vidGenTaskId = 0
    }
    if (generationId && !preserveNewerCurrentResult) smart.lastCompletedVideoGenerationId = generationId
    if (Array.isArray(smart.videoGenerations)) {
      smart.videoGenerations = updateVideoGeneration(
        smart.videoGenerations,
        expectedGenerationId,
        expectedTaskId,
        (generation: any) => ({ ...generation, status: 'published', taskId: 0 }),
      )
    }
    const modificationNote = String(
      args.modificationNote ?? matchingGeneration?.modificationNote ?? matchingGeneration?.note ?? '',
    )
    if (modificationNote || smart.videoModificationDraft) {
      smart.videoModificationDraft = bindVideoModificationNote(
        smart.videoModificationDraft,
        { assetId, url },
        modificationNote,
        { clearPending: !preserveNewerCurrentResult },
      )
    }
    draft.smart = smart

    // coverAssetId 省略(0)→ 后端保留现有封面,不误清
    await updateCreativeProjectDraft({ projectId, workspaceId, draft, draftRevision: rev })
    return true
  }

  return enqueueCreativeProjectDraftSave({
    projectId,
    workspaceId,
    task: async () => {
      try {
        return await doSave()
      } catch (e: any) {
        if (e?.status === 409) return doSave() // 版本冲突:重拉最新 revision 再存一遍
        throw e
      }
    },
  })
}

/** 将爆款复制后台任务的失败/取消终态落回草稿。 */
export async function persistHotCopyTerminalStateToBackend(args: {
  projectId: number
  workspaceId: number
  taskId: number
  generationId?: string
  status: 'failed' | 'cancelled'
  error?: string
}): Promise<boolean> {
  const { projectId, workspaceId, taskId, generationId, status, error } = args
  if (!projectId || !workspaceId || (!taskId && !generationId)) return false

  const doSave = async () => {
    const proj: any = await getCreativeProject({ projectId, workspaceId })
    const rev = Number(proj?.draft_revision ?? proj?.data?.draft_revision ?? 0) || 0
    let draft: any = proj?.draft_json ?? proj?.data?.draft_json ?? proj?.draft
    if (typeof draft === 'string') {
      try {
        draft = JSON.parse(draft)
      } catch {
        return false
      }
    }
    if (!draft || typeof draft !== 'object') return false
    draft = sanitizeHotCopyPersistentDraft(draft, workspaceId)
    const flow = String(draft?.flow || draft?.smart?.flow || '').toLowerCase()
    if (flow !== 'hot-copy') return false

    const smartSource = draft.smart && typeof draft.smart === 'object' ? draft.smart : null
    if (!smartSource) return false
    const draftTaskId = Number(smartSource.vidGenTaskId || 0) || 0
    const expectedGenerationId = String(generationId || '').trim()
    const generations = Array.isArray(smartSource.videoGenerations) ? smartSource.videoGenerations : []
    const matchingGeneration = findVideoGeneration<any>(generations, expectedGenerationId, taskId)
    const generationTaskId = Number(matchingGeneration?.taskId || 0) || 0
    const ownsDraftTask = taskId > 0 && draftTaskId === taskId
    const generationStatus = String(matchingGeneration?.status || '').toLowerCase()
    const lastCompletedGenerationId = String(smartSource.lastCompletedVideoGenerationId || '').trim()
    const generationAlreadySucceeded =
      generationStatus === 'published' ||
      Boolean(expectedGenerationId && lastCompletedGenerationId === expectedGenerationId)
    if (generationAlreadySucceeded) return false
    const generationTaskMatches = taskId <= 0 || generationTaskId === taskId || (generationTaskId <= 0 && ownsDraftTask)
    const ownsGeneration = Boolean(matchingGeneration && generationStatus === 'processing' && generationTaskMatches)
    // Legacy HotCopy drafts may have only vidGenTaskId. The exact active task
    // remains a safe ownership proof for clearing its failed recovery marker.
    const ownsLegacyTaskOnlyDraft = ownsDraftTask && !matchingGeneration
    // Only the matching in-flight generation may transition to failed/cancelled.
    // Published or otherwise terminal generations are immutable to late error callbacks.
    if (!ownsGeneration && !ownsLegacyTaskOnlyDraft) return false

    const smart = { ...smartSource }
    if (ownsDraftTask) {
      smart.videoGenerating = false
      smart.vidGenTaskId = 0
    }
    if (Array.isArray(smart.videoGenerations)) {
      smart.videoGenerations = updateVideoGeneration(
        smart.videoGenerations,
        expectedGenerationId,
        taskId,
        (generation: any) => ({
          ...generation,
          status,
          taskId: 0,
          ...(error ? { error: sanitizeTelemetryText(String(error)).slice(0, 500) } : {}),
        }),
      )
    }
    draft.smart = smart
    await updateCreativeProjectDraft({ projectId, workspaceId, draft, draftRevision: rev })
    return true
  }

  return enqueueCreativeProjectDraftSave({
    projectId,
    workspaceId,
    task: async () => {
      try {
        return await doSave()
      } catch (e: any) {
        if (e?.status === 409) return doSave()
        throw e
      }
    },
  })
}
