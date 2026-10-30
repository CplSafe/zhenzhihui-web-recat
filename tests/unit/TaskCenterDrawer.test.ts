import { describe, expect, it } from 'vitest'
import {
  filterTaskCenterHistoricalProjects,
  formatHistoricalTaskTitle,
  getAccessibleTaskCenterProjectIds,
  getRestrictedTaskCenterProjectIds,
  isTaskCenterTaskAccessible,
  isTaskCenterTaskRestricted,
} from '@/components/task/TaskCenterDrawer'

function project(id: number, ownerId: number, restrictedMemberIds: number[]) {
  return {
    id,
    user_id: ownerId,
    draft_json: { restrictedMemberIds },
  }
}

describe('filterTaskCenterHistoricalProjects', () => {
  it('hides a restricted project without hiding projects available to ordinary members', () => {
    const restricted = project(1, 8, [7])
    const accessible = project(2, 8, [9])

    expect(filterTaskCenterHistoricalProjects([restricted, accessible], 7)).toEqual([accessible])
    const restrictedIds = getRestrictedTaskCenterProjectIds([restricted, accessible], 7)
    expect([...restrictedIds]).toEqual([1])
    expect(isTaskCenterTaskRestricted({ projectId: 1 }, restrictedIds)).toBe(true)
    expect(isTaskCenterTaskRestricted({ projectId: 2 }, restrictedIds)).toBe(false)
    expect(isTaskCenterTaskRestricted({ projectId: 2 }, restrictedIds, false)).toBe(true)
    expect(isTaskCenterTaskRestricted({ projectId: 0 }, restrictedIds, false)).toBe(false)
    const accessibleIds = getAccessibleTaskCenterProjectIds([restricted, accessible], 7)
    expect([...accessibleIds]).toEqual([2])
    expect(isTaskCenterTaskAccessible({ projectId: 2 }, accessibleIds)).toBe(true)
    expect(isTaskCenterTaskAccessible({ projectId: 1 }, accessibleIds)).toBe(false)
    expect(isTaskCenterTaskAccessible({ projectId: 999 }, accessibleIds)).toBe(false)
    expect(isTaskCenterTaskAccessible({ projectId: 2 }, accessibleIds, false)).toBe(false)
    expect(isTaskCenterTaskAccessible({ projectId: 0 }, accessibleIds, false)).toBe(true)
  })

  it('keeps the project owner visible even if stale metadata contains the owner id', () => {
    const owned = project(1, 7, [7])

    expect(filterTaskCenterHistoricalProjects([owned], 7)).toEqual([owned])
  })
})

describe('formatHistoricalTaskTitle', () => {
  it('uses the same prompt-summary and numbered-media naming for video and image history', () => {
    expect(formatHistoricalTaskTitle('一只猫在花园里奔跑', '项目名', '视频', 2)).toBe('一只猫在花园里奔跑 · 视频 2')
    expect(formatHistoricalTaskTitle('一只猫在花园里奔跑', '项目名', '图片', 1)).toBe('一只猫在花园里奔跑 · 图片 1')
  })

  it('falls back to project title and truncates long prompts without splitting emoji', () => {
    expect(formatHistoricalTaskTitle('', '项目名', '视频', 1)).toBe('项目名 · 视频 1')
    const prompt = `${'猫'.repeat(29)}🐱还有更多`
    expect(formatHistoricalTaskTitle(prompt, '项目名', '图片', 3)).toBe(`${'猫'.repeat(29)}🐱… · 图片 3`)
  })
})
