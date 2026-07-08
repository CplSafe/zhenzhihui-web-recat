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
import { parseSmartSnapshot, buildSmartSnapshot, computeVideoContentSig, type SmartDraft } from '@/utils/smartDraft'
import { enqueueCreativeProjectDraftSave } from '@/utils/creativeDraftSaveQueue'

export async function persistVideoResultToBackend(args: {
  projectId: number
  workspaceId: number
  url: string
  assetId: number
  /** 对应的生成记录 id:置为 published(从「草稿」列表消失) */
  genId?: string
  /** 本片【发起时锁定】的内容签名:优先用它盖 lastVideoSig(而非读完成时的当前分镜) */
  lockedSig?: string
}): Promise<void> {
  const { projectId, workspaceId, url, assetId, genId, lockedSig } = args
  if (!projectId || !workspaceId || (!url && !assetId)) return

  await enqueueCreativeProjectDraftSave({
    projectId,
    workspaceId,
    task: async () => {
      const doSave = async () => {
        const proj: any = await getCreativeProject({ projectId, workspaceId })
        const rev = Number(proj?.draft_revision ?? proj?.data?.draft_revision ?? 0) || 0
        const smart = parseSmartSnapshot(proj?.draft_json ?? proj?.data?.draft_json ?? proj?.draft) as SmartDraft | null
        if (!smart) return // 非智能成片草稿 / 解析失败 → 不动,避免空快照覆盖
        smart.fullVideoUrl = url || smart.fullVideoUrl
        smart.fullVideoAssetId = assetId || smart.fullVideoAssetId
        const versions = Array.isArray(smart.videoVersions) ? smart.videoVersions.slice() : []
        if (!(assetId && versions.some((v: any) => Number(v?.assetId || 0) === assetId))) {
          versions.push({ url, assetId })
        }
        smart.videoVersions = versions
        smart.vidGenTaskId = 0 // 已完成 → 清在途任务标记
        // 盖章「本版成片依据的内容签名」:【优先用发起时锁定的签名】(lockedSig 显式传入,或草稿里持久化的
        // pendingVideoSig)。都没有才退回"当前草稿分镜"兜底(老数据)。避免用完成时的当前分镜盖章 ——
        // 否则用户在生成中/生成后改了内容,会把签名盖成新内容 ⇒ 列表误判"没变"、旧片当已完成、不显示草稿。
        smart.lastVideoSig =
          lockedSig ||
          (smart as any).pendingVideoSig ||
          computeVideoContentSig(
            smart.shots as any[],
            smart.entryMeta,
            String(smart.reqSummary || smart.requirement || ''),
          )
        ;(smart as any).pendingVideoSig = '' // 本片已收尾,清掉在途锁定签名
        // 生成记录置 published(从「草稿」列表消失):有 genId 则置那条,否则把所有「生成中」的都收尾(resume 场景)
        if (Array.isArray(smart.videoGenerations)) {
          smart.videoGenerations = smart.videoGenerations.map((g: any) =>
            (genId ? g?.id === genId : g?.status === 'processing') ? { ...g, status: 'published' } : g,
          )
        }
        await updateCreativeProjectDraft({
          projectId,
          workspaceId,
          draft: buildSmartSnapshot(smart),
          draftRevision: rev,
        })
      }

      try {
        await doSave()
      } catch (e: any) {
        // 版本冲突(组件也在存):重拉一次最新 revision 再存一遍
        if (e?.status === 409) {
          try {
            await doSave()
          } catch {
            /* 放弃:回到页面时仍可凭 vidGenTaskId 续轮询兜底 */
          }
        }
      }
    },
  })
}
