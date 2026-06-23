/**
 * 按项目草稿的 flow 决定打开路径:
 *  - 智能成片(draft.flow==='smart' 或含 smart 块)→ /smart/:id
 *  - 其它(旧版 2.0 分步创作)→ /smart/:id（统一走新版智能成片）
 * 失败兜底走 /smart。供首页/工作台/项目管理/布局等所有"打开历史项目"入口共用。
 */
import { getCreativeProject } from '@/api/business'

export async function resolveProjectPath(projectId: number | string, workspaceId: number): Promise<string> {
  const id = Number(projectId || 0)
  if (!id) return '/smart'
  try {
    const proj: any = await getCreativeProject({ projectId: id, workspaceId: Number(workspaceId || 0) })
    let draft: any = proj?.draft_json ?? proj?.data?.draft_json ?? proj?.draft
    if (typeof draft === 'string') {
      try {
        draft = JSON.parse(draft)
      } catch {
        draft = null
      }
    }
    if (draft && (draft.flow === 'smart' || draft.smart)) return `/smart/${id}`
  } catch {
    /* 拉取失败 → 默认走智能成片 */
  }
  return `/smart/${id}`
}
