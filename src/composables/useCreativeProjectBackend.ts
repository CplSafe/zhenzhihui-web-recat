/**
 * 智能成片 / 爆款复制 共用的「后端项目持久化」核心。
 * 从 SmartCreateView / HotCopyCreateView 抽出(原各一份近乎相同的实现):
 *  - 草稿版本号 normRev / fetchRevision(乐观并发)
 *  - createDraftSaver:串行化保存链 + 409 冲突重试(superset:首存预取 revision + 用 409 错误体 revision + 可选封面)
 *  - resolvePlanCandidates:套餐内可用模型计划候选
 *  - resolveProjectId / isUnnamedTitle 纯工具
 * 视图自己持有 draftRevisionRef / serverTitleRef / saveChainRef(避免大范围改写),仅把这些 ref 传入。
 */
import type { MutableRefObject } from 'react'
import { getCreativeProject, updateCreativeProjectDraft } from '@/api/business'
import { useWorkspaceSessionStore, deriveModelPlanCandidates } from '@/stores/workspaceSession'

// 从 createCreativeProject 返回里取项目 id(字段名后端不统一,取两视图字段并集兜底)
export function resolveProjectId(payload: any): number {
  const id = Number(
    [
      payload?.id,
      payload?.project_id,
      payload?.projectId,
      payload?.project?.id,
      payload?.data?.id,
      payload?.data?.project_id,
      payload?.data?.projectId,
    ].find((v) => Number(v) > 0) || 0,
  )
  return Number.isFinite(id) && id > 0 ? Math.floor(id) : 0
}

// 是否「未命名」标题:空 或 含「未命名」都视为未命名(不回写后端,避免无意义 PATCH)
export function isUnnamedTitle(title: string): boolean {
  const t = String(title || '').trim()
  return !t || t.includes('未命名')
}

// 从任意返回体里取 draft_revision(后端字段有下划线/驼峰/嵌套 data 多种写法)
export function normRev(p: any): number {
  const v = Number(p?.draft_revision ?? p?.draftRevision ?? p?.data?.draft_revision ?? p?.data?.draftRevision ?? NaN)
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : NaN
}

// 计划候选(套餐内可用模型计划):确保已加载后从 store 读取
export async function resolvePlanCandidates(): Promise<string[]> {
  try {
    await useWorkspaceSessionStore.getState().ensureModelPlanCandidatesLoaded()
  } catch {
    /* 加载失败则退回当前已有候选 */
  }
  return (deriveModelPlanCandidates(useWorkspaceSessionStore.getState()) as string[]) || []
}

/**
 * 创建草稿保存器。视图把自己的三个 ref + 取 id/ws + 构建草稿 的回调传入,得到:
 *  - putDraft():串行化保存(防并发 PUT 同 revision 互撞 409),内部做版本号同步 + 409 重试。
 *  - fetchRevision(id, ws):按需重新拉取 revision(一般内部用,导出以备视图需要)。
 * buildDraft() 返回 { draft, coverAssetId? };coverAssetId>0 时随草稿带上(列表封面)。
 */
export function createDraftSaver(args: {
  draftRevisionRef: MutableRefObject<number>
  saveChainRef: MutableRefObject<Promise<any>>
  getProjectId: () => number
  getWorkspaceId: () => number
  buildDraft: () => { draft: any; coverAssetId?: number }
}) {
  const { draftRevisionRef, saveChainRef, getProjectId, getWorkspaceId, buildDraft } = args

  const fetchRevision = async (id: number, ws: number) => {
    try {
      const proj: any = await getCreativeProject({ projectId: id, workspaceId: ws })
      const r = normRev(proj)
      if (Number.isFinite(r)) draftRevisionRef.current = r
    } catch {
      /* ignore */
    }
  }

  const doPut = async (): Promise<boolean> => {
    const id = getProjectId()
    const ws = getWorkspaceId()
    if (!id || !ws) return false
    const { draft, coverAssetId } = buildDraft()
    const body = () => ({
      projectId: id,
      workspaceId: ws,
      draft,
      draftRevision: draftRevisionRef.current,
      ...(Number(coverAssetId) > 0 ? { coverAssetId: Number(coverAssetId) } : {}),
    })
    // 首次/未知 revision:先拉一次,避免用错版本号导致 409 把后续(含图)保存全部打掉
    if (!draftRevisionRef.current) await fetchRevision(id, ws)
    try {
      const payload: any = await updateCreativeProjectDraft(body())
      const next = normRev(payload)
      if (Number.isFinite(next)) draftRevisionRef.current = next
      else await fetchRevision(id, ws) // 返回体没带 revision → 重新拉,保持同步
      return true
    } catch (e: any) {
      if (e?.status !== 409) return false
      // 版本冲突:优先用 409 响应体里直接带的最新 revision,没有再拉一次,然后重试
      const fromErr = normRev(e?.response)
      if (Number.isFinite(fromErr)) draftRevisionRef.current = fromErr
      else await fetchRevision(id, ws)
      try {
        const payload: any = await updateCreativeProjectDraft(body())
        const next = normRev(payload)
        if (Number.isFinite(next)) draftRevisionRef.current = next
        else await fetchRevision(id, ws)
        return true
      } catch {
        return false
      }
    }
  }

  // 串行化:排队执行,前一个完成(并更新 revision)再执行下一个
  const putDraft = (): Promise<boolean> => {
    const run = saveChainRef.current.catch(() => {}).then(() => doPut())
    saveChainRef.current = run
    return run
  }

  return { putDraft, fetchRevision }
}
