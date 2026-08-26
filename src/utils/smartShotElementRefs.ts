import type { Shot } from '@/components/smart/ScriptStoryboardTable'

function positiveAssetId(value: unknown): number {
  const id = Math.floor(Number(value) || 0)
  return Number.isSafeInteger(id) && id > 0 ? id : 0
}

/**
 * 返回当前镜头经过脚本/VL匹配后绑定的客户上传元素 asset_id。
 * refAssetIds 表示同一产品的多角度素材；旧草稿只有 refAssetId 时仍可恢复。
 * 普通 AI 主体的 assetId 不在这里下发，避免误把历史生成图当作客户原始元素。
 */
export function resolveShotElementReferenceAssetIds(shot: Pick<Shot, 'subjects'>): number[] {
  const seen = new Set<number>()
  const result: number[] = []

  for (const subject of shot.subjects || []) {
    const candidates =
      Array.isArray(subject.refAssetIds) && subject.refAssetIds.length ? subject.refAssetIds : [subject.refAssetId]
    for (const value of candidates) {
      const id = positiveAssetId(value)
      if (!id || seen.has(id)) continue
      seen.add(id)
      result.push(id)
    }
  }

  return result
}
