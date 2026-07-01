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

export async function persistHotCopyResultToBackend(args: {
  projectId: number
  workspaceId: number
  url: string
  assetId: number
}): Promise<void> {
  const { projectId, workspaceId, url, assetId } = args
  if (!projectId || !workspaceId || (!url && !assetId)) return

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
    if (!draft || typeof draft !== 'object') return // 解析不出草稿 → 不动,避免空覆盖
    const flow = String(draft?.flow || draft?.smart?.flow || '').toLowerCase()
    if (flow !== 'hot-copy') return // 只处理爆款草稿(别的流程走各自的持久化)

    const pushUnique = (list: any[], item: { url: string; assetId: number }) => {
      const arr = Array.isArray(list) ? list.slice() : []
      if (!(item.assetId && arr.some((v: any) => Number(v?.assetId || 0) === item.assetId))) arr.push(item)
      return arr
    }

    // 顶层字段(项目管理/首页派生用)
    draft.generatedVideoUrl = url || draft.generatedVideoUrl
    draft.generatedVideoAssetId = assetId || draft.generatedVideoAssetId
    draft.videoHistoryList = pushUnique(draft.videoHistoryList, { url, assetId })

    // smart 块(爆款回填精确恢复用;字段名与 buildHotCopySnapshot 一致)
    const smart = draft.smart && typeof draft.smart === 'object' ? draft.smart : (draft.smart = { flow: 'hot-copy' })
    smart.fullVideoUrl = url || smart.fullVideoUrl
    smart.fullVideoAssetId = assetId || smart.fullVideoAssetId
    smart.videoVersions = pushUnique(smart.videoVersions, { url, assetId })
    smart.vidGenTaskId = 0 // 已完成 → 清在途任务标记
    if (Array.isArray(smart.videoGenerations)) {
      smart.videoGenerations = smart.videoGenerations.map((g: any) =>
        g?.status === 'processing' ? { ...g, status: 'published' } : g,
      )
    }

    // coverAssetId 省略(0)→ 后端保留现有封面,不误清
    await updateCreativeProjectDraft({ projectId, workspaceId, draft, draftRevision: rev })
  }

  try {
    await doSave()
  } catch (e: any) {
    if (e?.status === 409) {
      try {
        await doSave() // 版本冲突:重拉最新 revision 再存一遍
      } catch {
        /* 放弃:重进 /hot-copy/:id 时仍可凭 vidGenTaskId 续轮询兜底 */
      }
    }
  }
}
