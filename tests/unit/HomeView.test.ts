import { describe, expect, it } from 'vitest'

import { filterHomeHistoryProjects } from '@/views/HomeView'

function generatedProject(
  id: number,
  {
    ownerId = 99,
    restrictedMemberIds = [],
  }: {
    ownerId?: number
    restrictedMemberIds?: number[]
  } = {},
) {
  return {
    id,
    user_id: ownerId,
    draft_json: {
      generatedVideoAssetId: id + 1000,
      restrictedMemberIds,
    },
  }
}

describe('filterHomeHistoryProjects', () => {
  it('隐藏明确限制当前用户的项目，但保留普通成员可访问的项目', () => {
    const restricted = generatedProject(1, { restrictedMemberIds: [7] })
    const availableToMember = generatedProject(2, { restrictedMemberIds: [8] })
    const unrestricted = generatedProject(3)

    expect(filterHomeHistoryProjects([restricted, availableToMember, unrestricted], 7)).toEqual([
      availableToMember,
      unrestricted,
    ])
  })

  it('项目所有者不会被历史列表中的成员限制字段误隐藏', () => {
    const owned = generatedProject(4, { ownerId: 7, restrictedMemberIds: [7] })

    expect(filterHomeHistoryProjects([owned], 7)).toEqual([owned])
  })

  it('继续排除尚未生成视频的项目', () => {
    const unfinished = {
      id: 5,
      user_id: 99,
      draft_json: { restrictedMemberIds: [] },
    }

    expect(filterHomeHistoryProjects([unfinished], 7)).toEqual([])
  })
})
