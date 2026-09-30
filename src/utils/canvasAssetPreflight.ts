import type { CanvasGenerationSourceRef, CanvasInputAsset } from './canvasGeneration'
import { findActiveWorkspaceAssetIds } from './taskMedia'

/** 只检查前端能确认的归属和入库状态；素材存储是否可读取仍由服务端最终判定。 */
export async function preflightCanvasAssets({
  workspaceId,
  sourceRefs,
  inputAssets,
}: {
  workspaceId: number
  sourceRefs: CanvasGenerationSourceRef[]
  inputAssets: CanvasInputAsset[]
}): Promise<string | null> {
  if (!inputAssets.length) return null
  if (!Number.isSafeInteger(workspaceId) || workspaceId <= 0) return '当前团队尚未就绪，请刷新页面后重试'

  const foreign = sourceRefs.find(
    (ref) => ref.kind !== 'text' && Number(ref.workspaceId || 0) > 0 && Number(ref.workspaceId) !== workspaceId,
  )
  if (foreign) {
    return `参考素材${foreign.assetId ? `（ID ${foreign.assetId}）` : ''}属于其他团队，请从当前团队素材库重新选择`
  }

  // 真人素材通过独立授权接口核验，不一定出现在普通图片素材列表中。
  const realPersonIds = new Set(
    sourceRefs.filter((ref) => ref.source === 'real_person').map((ref) => Number(ref.assetId)),
  )
  const ordinaryAssets = inputAssets.filter((asset) => !realPersonIds.has(Number(asset.asset_id)))
  try {
    for (const type of ['video', 'image'] as const) {
      const ids = [
        ...new Set(
          ordinaryAssets
            .filter((asset) => (asset.role === 'video') === (type === 'video'))
            .map((asset) => Number(asset.asset_id)),
        ),
      ]
      if (!ids.length) continue
      const active = await findActiveWorkspaceAssetIds(workspaceId, ids, type)
      const missing = ids.find((id) => !active.has(id))
      if (missing) {
        return `参考${type === 'video' ? '视频' : '图片'}（素材 ID ${missing}）在当前团队不可用，可能未上传完成、已失效或属于其他团队，请重新选择素材`
      }
    }
  } catch {
    return '暂时无法核验当前团队的参考素材，请稍后重试'
  }
  return null
}
