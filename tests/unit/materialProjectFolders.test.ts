import { describe, expect, it } from 'vitest'
import {
  collectCreativeProjectAssetIds,
  groupMaterialsByProject,
  resolveMaterialProjectId,
} from '@/utils/materialProjectFolders'

function material(id: number, projectId = 0) {
  return {
    id: `asset-${id}`,
    assetId: id,
    name: `素材 ${id}`,
    serverAsset: {
      id,
      ...(projectId ? { project_id: projectId } : {}),
    },
  }
}

describe('material project folders', () => {
  it('collects only asset-id fields from nested project drafts', () => {
    const ids = collectCreativeProjectAssetIds({
      draft_json: JSON.stringify({
        projectId: 999,
        smart: {
          entryMeta: { imageAssetIds: [11, 12] },
          shots: [{ imageAssetId: 13, taskId: 888 }],
          fullVideoAssetId: 14,
        },
      }),
    })

    expect([...ids].sort((a, b) => a - b)).toEqual([11, 12, 13, 14])
  })

  it('uses explicit project ownership before draft references and keeps unmatched materials unclassified', () => {
    const projects = [
      { id: 1, draft_json: { smart: { entryMeta: { imageAssetIds: [11, 12] } } } },
      { id: 2, draft_json: { smart: { entryMeta: { imageAssetIds: [12, 13] } } } },
    ]
    const explicitlyOwned = material(11, 2)
    const sharedByDraft = material(12)
    const projectTwoDraft = material(13)
    const unclassified = material(14)

    const result = groupMaterialsByProject([explicitlyOwned, sharedByDraft, projectTwoDraft, unclassified], projects)

    expect(result.groups.find((group) => group.projectId === 1)?.materials).toEqual([sharedByDraft])
    expect(result.groups.find((group) => group.projectId === 2)?.materials).toEqual([
      explicitlyOwned,
      sharedByDraft,
      projectTwoDraft,
    ])
    expect(result.unclassified).toEqual([unclassified])
    expect(resolveMaterialProjectId(explicitlyOwned)).toBe(2)
  })
})
