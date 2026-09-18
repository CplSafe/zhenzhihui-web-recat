/**
 * 当前工作空间「视频生成模型 id → 展示名」的查表。
 *
 * 名字以模型目录为准(和创作页模型选择器看到的一致):智能成片 / 真人成片走 video.generate,
 * 爆款复制走 video.replicate。目录里查不到的(已下架 / 换套餐)由调用方退回草稿里的名字快照。
 */
import { useCallback, useMemo } from 'react'
import { useGenerationModelCatalog } from './useGenerationModelCatalog'
import { useHotCopyModelCatalog } from './useHotCopyModelCatalog'

export interface VideoModelNames {
  /** 目录已加载完(两条目录都不在 loading)。加载中时查不到名字很正常,调用方别急着兜底成「模型 #id」。 */
  ready: boolean
  /** 查表;查不到返回空串。 */
  resolveName: (modelVersionId: unknown) => string
}

export function useVideoModelNames(workspaceId: number): VideoModelNames {
  const generationCatalog = useGenerationModelCatalog(workspaceId)
  const hotCopyCatalog = useHotCopyModelCatalog(workspaceId)

  const namesById = useMemo(() => {
    const names = new Map<number, string>()
    generationCatalog.groups.forEach((group) =>
      group.operationGroups
        .filter((operationGroup) => operationGroup.operationCode === 'video.generate')
        .forEach((operationGroup) =>
          operationGroup.models.forEach((model) => {
            const id = Number(model.modelVersionId) || 0
            if (id > 0 && !names.has(id)) names.set(id, model.displayName)
          }),
        ),
    )
    hotCopyCatalog.pickerGroups.forEach((group) =>
      group.subgroups.forEach((subgroup) =>
        subgroup.models.forEach((model) => {
          const id = Number(model.id) || 0
          if (id > 0 && !model.disabled && !names.has(id)) names.set(id, model.name)
        }),
      ),
    )
    return names
  }, [generationCatalog.groups, hotCopyCatalog.pickerGroups])

  const resolveName = useCallback(
    (modelVersionId: unknown) => {
      const id = Number(modelVersionId) || 0
      return id > 0 ? namesById.get(id) || '' : ''
    },
    [namesById],
  )

  return { ready: !generationCatalog.loading && !hotCopyCatalog.loading, resolveName }
}
