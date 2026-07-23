/**
 * 整片视频生成「完成即落库」—— 不依赖组件挂载。
 *
 * 背景:智能成片的整片生成是 server 端任务,前端只是 await 轮询。用户在生成中切到别的页面后,
 * 组件卸载,setState / autosave effect 不再运行 → 即使后端跑完、await 也 resolve 了,结果也没被写进草稿。
 * 本函数在「生成完成」那一刻【直接】拉最新草稿、把这版视频合并进去、PUT 回后端,
 * 从而做到「切走也能把成片保存到项目」(全局后台完成,见 SmartCreateView runFullVideo / resume / edit 调用处)。
 *
 * 安全:先拉最新 draft(拿到 revision + 现有内容)再合并,避免覆盖期间组件 autosave 写入的其它改动;
 * 解析不出智能成片草稿(非 smart 项目)则直接跳过,绝不用空快照覆盖已有项目数据。
 */
import { getCreativeProject, updateCreativeProjectDraft } from '@/api/business'
import {
  parseSmartSnapshot,
  buildSmartSnapshot,
  computeVideoContentSig,
  mergeCompletedVideoGenerationIds,
  type SmartDraft,
} from '@/utils/smartDraft'
import { enqueueCreativeProjectDraftSave } from '@/utils/creativeDraftSaveQueue'
import { getCreativeProjectDraft, type CreativeDraftRecord } from '@/utils/creativeDraftMetadata'
import { sanitizePersistentMediaUrl, sanitizePersistentProjectVideoStore } from '@/utils/persistentMediaUrl'
import { sanitizeTelemetryText } from '@/utils/observabilitySanitizer'
import {
  bindVideoModificationNote,
  serializeVideoModificationDraft,
  VIDEO_MODIFICATION_DRAFT_FIELD,
} from '@/utils/videoModificationDraft'
import { findVideoGeneration, updateVideoGeneration } from '@/utils/videoGenerationRecords'

/**
 * 后台视频回调不能重建整份草稿；权限、项目视频清单和顶层元数据由其他页面维护。
 * 因此从最新草稿出发，只覆盖视频投影及更新后的原生 smart 状态。
 */
function mergeSmartVideoResult(
  latestDraft: CreativeDraftRecord,
  smart: SmartDraft,
  workspaceId: number,
  updateTopLevelVideoFields: boolean,
): CreativeDraftRecord {
  const videoSnapshot = buildSmartSnapshot(smart, workspaceId)
  const latestAssetId = Number((latestDraft as any).generatedVideoAssetId || 0) || 0
  const latestGeneratedUrl = sanitizePersistentMediaUrl((latestDraft as any).generatedVideoUrl, {
    assetId: latestAssetId,
    workspaceId,
  })
  const latestHistory = (
    Array.isArray((latestDraft as any).videoHistoryList) ? (latestDraft as any).videoHistoryList : []
  )
    .map((version: any) => {
      const assetId = Number(version?.assetId || 0) || 0
      const url = sanitizePersistentMediaUrl(version?.url, { assetId, workspaceId })
      return assetId || url ? { ...version, assetId, url } : null
    })
    .filter(Boolean)
  return {
    ...latestDraft,
    ...(Object.prototype.hasOwnProperty.call(latestDraft, 'projectVideoStore')
      ? { projectVideoStore: sanitizePersistentProjectVideoStore((latestDraft as any).projectVideoStore, workspaceId) }
      : {}),
    ...(updateTopLevelVideoFields
      ? {
          generatedVideoUrl: videoSnapshot.generatedVideoUrl,
          generatedVideoAssetId: videoSnapshot.generatedVideoAssetId,
          videoHistoryList: videoSnapshot.videoHistoryList,
        }
      : {
          generatedVideoUrl: latestGeneratedUrl,
          generatedVideoAssetId: latestAssetId,
          videoHistoryList: latestHistory,
        }),
    smart: videoSnapshot.smart,
  }
}

/**
 * 将智能成片结果合并进最新项目草稿，并按 generation 精确完成对应记录。
 * 缺少可持久化素材标识时拒绝落库，让恢复流程等待资产入库而不保存过期签名。
 */
export async function persistVideoResultToBackend(args: {
  projectId: number
  workspaceId: number
  url: string
  assetId: number
  /** 发起任务的后端 task_id；用于只清理属于本次结果的恢复凭证。 */
  taskId?: number
  /** 对应的生成记录 id:置为 published(从「草稿」列表消失) */
  genId?: string
  /** 发起该 generation 时锁定的原始修改说明。 */
  modificationNote?: string
  /** 本片【发起时锁定】的内容签名:优先用它盖 lastVideoSig(而非读完成时的当前分镜) */
  lockedSig?: string
}): Promise<boolean> {
  const { projectId, workspaceId, assetId, taskId, genId, lockedSig } = args
  // assetId 缺失时只能接受可长期保存的地址。供应商预签名 URL 仍可供当前页面临时播放，
  // 但不能写进项目历史；返回 false 让任务保持 reconnecting，待资产落库后再次收口。
  const url = sanitizePersistentMediaUrl(args.url, { assetId, workspaceId })
  if (!projectId || !workspaceId || (!url && !assetId)) return false

  return enqueueCreativeProjectDraftSave({
    projectId,
    workspaceId,
    task: async () => {
      const doSave = async () => {
        const proj: any = await getCreativeProject({ projectId, workspaceId })
        const rev = Number(proj?.draft_revision ?? proj?.data?.draft_revision ?? 0) || 0
        const latestDraft = getCreativeProjectDraft(proj)
        const smart = parseSmartSnapshot(latestDraft) as SmartDraft | null
        if (!latestDraft || !smart) return false // 非智能成片草稿 / 解析失败 → 不动,避免空快照覆盖

        const expectedTaskId = Number(taskId || 0) || 0
        const expectedGenerationId = String(genId || '').trim()
        const versions = Array.isArray(smart.videoVersions) ? smart.videoVersions.slice() : []
        const resultAlreadyPersisted =
          (assetId > 0 &&
            (Number(smart.fullVideoAssetId || 0) === assetId ||
              versions.some((version: any) => Number(version?.assetId || 0) === assetId))) ||
          (Boolean(url) &&
            (String(smart.fullVideoUrl || '') === url ||
              versions.some((version: any) => String(version?.url || '') === url)))
        const draftTaskId = Number((smart as any).vidGenTaskId || 0) || 0
        const generations = Array.isArray(smart.videoGenerations) ? smart.videoGenerations : []
        const matchingGeneration = findVideoGeneration<any>(generations, expectedGenerationId, expectedTaskId)
        const completedGenerationId = expectedGenerationId || String((matchingGeneration as any)?.id || '').trim()
        const generationTaskId = Number((matchingGeneration as any)?.taskId || 0) || 0
        const ownsByTask = expectedTaskId > 0 && draftTaskId === expectedTaskId
        const ownsByGeneration = Boolean(
          matchingGeneration &&
          String((matchingGeneration as any)?.status || '').toLowerCase() === 'processing' &&
          (!expectedTaskId || !generationTaskId || generationTaskId === expectedTaskId),
        )
        // 普通 autosave 可能先把视频资产写进历史，但仍保留本任务的 processing/vidGenTaskId。
        // 因此“媒体已存在”不等于“任务已收尾”：只在本回调已没有任何可清理的所有权时才幂等返回。
        if (resultAlreadyPersisted && !ownsByTask && !ownsByGeneration) return true
        if (!expectedTaskId && !expectedGenerationId) return false
        // Never interpret an empty active slot as ownership. A stale callback may arrive after a newer generation has
        // completed or started; only the current task or its explicit generation record may authorize result changes.
        if (!ownsByTask && !ownsByGeneration) return false
        const lastCompletedGenerationId = String((smart as any).lastCompletedVideoGenerationId || '').trim()
        const currentAssetId = Number(smart.fullVideoAssetId || 0) || 0
        const currentUrl = String(smart.fullVideoUrl || '').trim()
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
        const modificationNote = String(
          args.modificationNote ??
            (matchingGeneration as any)?.modificationNote ??
            (matchingGeneration as any)?.note ??
            '',
        )
        const currentModificationDraft = (smart.fields as any)?.[VIDEO_MODIFICATION_DRAFT_FIELD]
        if (modificationNote || currentModificationDraft) {
          smart.fields = {
            ...(smart.fields || {}),
            [VIDEO_MODIFICATION_DRAFT_FIELD]: serializeVideoModificationDraft(
              bindVideoModificationNote(currentModificationDraft, { assetId, url }, modificationNote, {
                clearPending: !preserveNewerCurrentResult,
              }),
            ),
          }
        }

        if (!preserveNewerCurrentResult) {
          smart.fullVideoUrl = url || smart.fullVideoUrl
          smart.fullVideoAssetId = assetId || smart.fullVideoAssetId
        }
        // createdAt = 该版视频最终生成完成的时间(项目管理每条视频卡片按它展示时间,
        // 而非整个项目的创建/修改时间)。新版打时间戳;已存在但缺时间的旧版补一个。
        const nowIso = new Date().toISOString()
        const existIdx = versions.findIndex(
          (version: any) =>
            (assetId > 0 && Number(version?.assetId || 0) === assetId) || (url && String(version?.url || '') === url),
        )
        if (existIdx >= 0) {
          if (!(versions[existIdx] as any)?.createdAt) {
            versions[existIdx] = { ...versions[existIdx], createdAt: nowIso }
          }
        } else {
          versions.push({ url, assetId, createdAt: nowIso })
        }
        smart.videoVersions = versions
        if (ownsByTask) smart.vidGenTaskId = 0 // 只清属于本次结果的在途任务标记
        if (completedGenerationId) {
          ;(smart as any).completedVideoGenerationIds = mergeCompletedVideoGenerationIds(
            (smart as any).completedVideoGenerationIds,
            (smart as any).lastCompletedVideoGenerationId,
            completedGenerationId,
          )
        }
        if (completedGenerationId && !preserveNewerCurrentResult) {
          ;(smart as any).lastCompletedVideoGenerationId = completedGenerationId
        }
        // 盖章「本版成片依据的内容签名」:【优先用发起时锁定的签名】(lockedSig 显式传入,或草稿里持久化的
        // pendingVideoSig)。都没有才退回"当前草稿分镜"兜底(老数据)。避免用完成时的当前分镜盖章 ——
        // 否则用户在生成中/生成后改了内容,会把签名盖成新内容 ⇒ 列表误判"没变"、旧片当已完成、不显示草稿。
        if (!preserveNewerCurrentResult && (ownsByTask || lockedSig)) {
          smart.lastVideoSig =
            lockedSig ||
            (ownsByTask ? (smart as any).pendingVideoSig : '') ||
            computeVideoContentSig(
              smart.shots as any[],
              smart.entryMeta,
              String(smart.reqSummary || smart.requirement || ''),
            )
        }
        if (ownsByTask) (smart as any).pendingVideoSig = '' // 新任务已接管时保留它的锁定签名
        // 生成记录置 published(从「草稿」列表消失):有 genId 则置那条,否则把所有「生成中」的都收尾(resume 场景)
        if (Array.isArray(smart.videoGenerations)) {
          smart.videoGenerations = updateVideoGeneration(
            smart.videoGenerations,
            expectedGenerationId,
            expectedTaskId,
            (generation: any) => ({ ...generation, status: 'published', taskId: 0 }),
          )
        }
        await updateCreativeProjectDraft({
          projectId,
          workspaceId,
          draft: mergeSmartVideoResult(latestDraft, smart, workspaceId, true),
          draftRevision: rev,
        })
        return true
      }

      try {
        return await doSave()
      } catch (e: any) {
        // 版本冲突(组件也在存):重拉一次最新 revision 再存一遍
        if (e?.status === 409) {
          return doSave()
        }
        throw e
      }
    },
  })
}

/** 将后台失败/取消终态写回智能成片草稿，避免刷新后继续把它恢复成“生成中”。 */
export async function persistVideoTerminalStateToBackend(args: {
  projectId: number
  workspaceId: number
  taskId: number
  genId?: string
  status: 'failed' | 'cancelled'
  error?: string
}): Promise<boolean> {
  const { projectId, workspaceId, taskId, genId, status, error } = args
  if (!projectId || !workspaceId || (!taskId && !genId)) return false

  return enqueueCreativeProjectDraftSave({
    projectId,
    workspaceId,
    task: async () => {
      const doSave = async () => {
        const proj: any = await getCreativeProject({ projectId, workspaceId })
        const rev = Number(proj?.draft_revision ?? proj?.data?.draft_revision ?? 0) || 0
        const latestDraft = getCreativeProjectDraft(proj)
        const smart = parseSmartSnapshot(latestDraft) as SmartDraft | null
        if (!latestDraft || !smart) return false

        const draftTaskId = Number((smart as any).vidGenTaskId || 0) || 0
        const expectedGenerationId = String(genId || '').trim()
        const generations = Array.isArray((smart as any).videoGenerations) ? (smart as any).videoGenerations : []
        const matchingGeneration = findVideoGeneration<any>(generations, expectedGenerationId, taskId)
        const terminalGenerationId = expectedGenerationId || String(matchingGeneration?.id || '').trim()
        const generationTaskId = Number(matchingGeneration?.taskId || 0) || 0
        const ownsDraftTask = taskId > 0 && draftTaskId === taskId
        const generationStatus = String(matchingGeneration?.status || '').toLowerCase()
        const lastCompletedGenerationId = String((smart as any).lastCompletedVideoGenerationId || '').trim()
        const generationAlreadySucceeded =
          generationStatus === 'published' ||
          Boolean(expectedGenerationId && lastCompletedGenerationId === expectedGenerationId)
        if (generationAlreadySucceeded) return false
        const generationTaskMatches =
          taskId <= 0 || generationTaskId === taskId || (generationTaskId <= 0 && ownsDraftTask)
        const ownsGeneration = Boolean(matchingGeneration && generationStatus === 'processing' && generationTaskMatches)
        // Older drafts persisted only vidGenTaskId. An exact active-task match is
        // sufficient ownership to close that legacy recovery credential even
        // when no generation record exists.
        const ownsLegacyTaskOnlyDraft = ownsDraftTask && !matchingGeneration
        // A terminal callback may only close the still-processing generation it was created for.
        // A cleared/published record is a success barrier, not permission for a late catch to rewrite it.
        if (!ownsGeneration && !ownsLegacyTaskOnlyDraft) return false
        if (ownsDraftTask) {
          ;(smart as any).vidGenTaskId = 0
          ;(smart as any).pendingVideoSig = ''
        }
        if (Array.isArray((smart as any).videoGenerations)) {
          ;(smart as any).videoGenerations = updateVideoGeneration(
            (smart as any).videoGenerations,
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
        if (terminalGenerationId) {
          ;(smart as any).completedVideoGenerationIds = mergeCompletedVideoGenerationIds(
            (smart as any).completedVideoGenerationIds,
            terminalGenerationId,
          )
        }
        await updateCreativeProjectDraft({
          projectId,
          workspaceId,
          draft: mergeSmartVideoResult(latestDraft, smart, workspaceId, false),
          draftRevision: rev,
        })
        return true
      }

      try {
        return await doSave()
      } catch (e: any) {
        if (e?.status === 409) return doSave()
        throw e
      }
    },
  })
}
