/**
 * 按项目草稿的 flow 决定打开路径:
 *  - 爆款复制(draft.flow==='hot-copy' 或 smart.flow==='hot-copy')→ /hot-copy/:id
 *  - 智能成片(draft.flow==='smart' 或含 smart 块)→ /smart/:id
 *  - 其它(旧版 2.0 分步创作)→ /smart/:id（统一走新版智能成片）
 * 失败兜底走 /smart。供首页/工作台/项目管理/布局等所有"打开历史项目"入口共用。
 */
import { getCreativeProject } from '@/api/business'

/** 从项目草稿兼容结构中读取流程标记。 */
function readDraftFlow(draft: any): string {
  if (!draft || typeof draft !== 'object') return ''
  return String(draft?.smart?.flow || draft?.flow || '').toLowerCase()
}

/** 拉取项目草稿并返回对应编辑器路径，读取失败时安全回退到智能成片。 */
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
    // 爆款复制先判:它的草稿也带 smart 块(flow:'hot-copy'),必须在 smart 分支之前拦掉,否则会误开 /smart。
    const flow = readDraftFlow(draft)
    if (flow === 'hot-copy') return `/hot-copy/${id}`
    if (draft && (flow === 'smart' || draft.smart)) return `/smart/${id}`
  } catch {
    /* 拉取失败 → 默认走智能成片 */
  }
  return `/smart/${id}`
}
