import { describe, expect, it } from 'vitest'

import { filterHomeHistoryProjects, filterHomeTemplates, limitHomeTemplates } from '@/views/HomeView'
import type { TemplateItem } from '@/api/templates'

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

function template(id: number, overrides: Partial<TemplateItem> = {}): TemplateItem {
  return {
    id,
    title: `模板${id}`,
    thumbnailUrl: '',
    videoUrl: `/video-${id}.mp4`,
    ratio: '16 / 9',
    style: '',
    useCount: 0,
    createdAt: '',
    grad: '',
    ...overrides,
  }
}

describe('home template preview', () => {
  it('searches title, style and backend-provided keyword metadata without case sensitivity', () => {
    const items = [
      template(1, { title: 'Summer Sale' }),
      template(2, { style: '国风' }),
      template(3, { searchTerms: ['食品', '餐饮广告'] }),
    ]

    expect(filterHomeTemplates(items, 'summer')).toEqual([items[0]])
    expect(filterHomeTemplates(items, '国风')).toEqual([items[1]])
    expect(filterHomeTemplates(items, '餐饮')).toEqual([items[2]])
  })

  it('limits the homepage template preview to twenty items', () => {
    const items = Array.from({ length: 25 }, (_, index) => template(index + 1))
    const visible = limitHomeTemplates(items)

    expect(visible).toHaveLength(20)
    expect(visible[visible.length - 1]?.id).toBe(20)
  })
})
