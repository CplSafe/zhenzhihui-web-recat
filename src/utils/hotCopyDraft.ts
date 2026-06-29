/**
 * 爆款复制(HotCopy)会话草稿持久化(localStorage)。
 * 目的:生成视频途中切到别处 / 刷新后,不再回到入口、不再丢失在途生成 —— 与智能成片一致。
 * 只存「恢复生成步」所需的可序列化状态(不存 File / blob:objectURL);用 vidGenTaskId 续轮询在途任务。
 * 单工作空间一条草稿(/hot-copy 无 :id),按 workspaceId 隔离。
 */
export interface HotCopyDraft {
  /** 已建后端项目 id(>0):用于「/hot-copy 无 id 但在制」时重定向回 /hot-copy/:id */
  projectId?: number
  started: boolean
  step: number
  maxReached: number
  basePrompt: string
  projectName: string
  nameTouched: boolean
  sourceVideo: { assetId: number; url: string }
  productAssetIds: number[]
  fullVideo: { url: string; assetId: number }
  videoVersions: { url: string; assetId: number }[]
  vidGenTaskId: number // >0 表示有在途生成任务,恢复时续轮询
  /** 每次生成的独立记录(生成中/失败 → 项目里显示成可重试「草稿」;成功并入成片后置 published 即从草稿列表消失)。
   *  进行中那条的 createdAt 同时作为「加载进度锚点」:切页面/刷新回来按真实流逝时间续算,不从头爬。 */
  videoGenerations?: { id: string; status: string; taskId?: number; note?: string; createdAt?: number }[]
}

const keyOf = (workspaceId: number) => `zzh_hotcopy_draft_v1_ws${Math.floor(Number(workspaceId) || 0)}`

export function saveHotCopyDraft(workspaceId: number, draft: HotCopyDraft): void {
  const ws = Number(workspaceId || 0)
  if (!ws) return
  try {
    localStorage.setItem(keyOf(ws), JSON.stringify(draft))
  } catch {
    /* 配额满 / 隐私模式:忽略 */
  }
}

export function loadHotCopyDraft(workspaceId: number): HotCopyDraft | null {
  const ws = Number(workspaceId || 0)
  if (!ws) return null
  try {
    const raw = localStorage.getItem(keyOf(ws))
    if (!raw) return null
    const d = JSON.parse(raw)
    return d && typeof d === 'object' ? (d as HotCopyDraft) : null
  } catch {
    return null
  }
}

export function clearHotCopyDraft(workspaceId: number): void {
  const ws = Number(workspaceId || 0)
  if (!ws) return
  try {
    localStorage.removeItem(keyOf(ws))
  } catch {
    /* 忽略 */
  }
}
