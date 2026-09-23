import { beforeEach, describe, expect, it } from 'vitest'
import {
  buildOwnerFilterOptions,
  isTeamWorkspace,
  matchesOwnerFilter,
  memberDisplayName,
  ownerFilterStorageKey,
  readOwnerFilter,
  resolveEffectiveOwnerFilter,
  writeOwnerFilter,
} from '@/utils/memberOwnerFilter'

describe('memberOwnerFilter', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('treats personal workspaces as non-team and everything else (including unknown) as team', () => {
    expect(isTeamWorkspace({ type: 'personal' })).toBe(false)
    expect(isTeamWorkspace({ type: 'PERSONAL' })).toBe(false)
    expect(isTeamWorkspace({ type: 'team' })).toBe(true)
    expect(isTeamWorkspace(undefined)).toBe(true)
  })

  it('resolves member display names from any of the compatible fields', () => {
    expect(memberDisplayName({ nickname: '小明' })).toBe('小明')
    expect(memberDisplayName({ user: { name: '小红' } })).toBe('小红')
    expect(memberDisplayName({ username: 'alice' })).toBe('alice')
    expect(memberDisplayName({ user_id: 42 })).toBe('成员 42')
  })

  it('builds options as 全部 / 我(n) / other producing members sorted by count', () => {
    const options = buildOwnerFilterOptions({
      countsByUserId: new Map([
        [7, 1],
        [8, 2],
        [9, 5],
      ]),
      mineCount: 3,
      members: [
        { id: 7, nickname: '我自己' },
        { id: 8, nickname: '同事乙' },
        { id: 9, nickname: '同事丙' },
        { id: 10, nickname: '没产出的同事' },
      ],
      currentUserId: 7,
    })
    expect(options).toEqual([
      { value: '', label: '全部成员' },
      { value: '7', label: '我（3）' },
      { value: '9', label: '同事丙（5）' },
      { value: '8', label: '同事乙（2）' },
    ])
  })

  it('falls back to 全部 when the remembered value is stale or the space is personal', () => {
    const options = buildOwnerFilterOptions({
      countsByUserId: new Map([[8, 1]]),
      mineCount: 0,
      members: [{ id: 8, nickname: '同事乙' }],
      currentUserId: 7,
    })
    expect(resolveEffectiveOwnerFilter({ isTeamSpace: true, ownerFilter: '8', options })).toBe('8')
    expect(resolveEffectiveOwnerFilter({ isTeamSpace: true, ownerFilter: '999', options })).toBe('')
    expect(resolveEffectiveOwnerFilter({ isTeamSpace: false, ownerFilter: '8', options })).toBe('')
    expect(resolveEffectiveOwnerFilter({ isTeamSpace: true, ownerFilter: '', options })).toBe('')
  })

  it('matches 我 by the backend mine set first and falls back to creator comparison', () => {
    const base = { currentUserId: 7, projectId: 3, creatorUserId: 8 }
    // 后端 mine 判定优先：归属字段是同事，但 mine 集合里有它 → 算我的
    expect(matchesOwnerFilter({ ...base, ownerFilter: '7', myProjectIds: new Set([3]) })).toBe(true)
    expect(matchesOwnerFilter({ ...base, ownerFilter: '7', myProjectIds: new Set([4]) })).toBe(false)
    // mine 集合缺失 → 回退按创作者
    expect(matchesOwnerFilter({ ...base, ownerFilter: '7', myProjectIds: null })).toBe(false)
    expect(matchesOwnerFilter({ ...base, creatorUserId: 7, ownerFilter: '7', myProjectIds: null })).toBe(true)
    // 其他成员始终按创作者比对，不看 mine 集合
    expect(matchesOwnerFilter({ ...base, ownerFilter: '8', myProjectIds: new Set([3]) })).toBe(true)
    expect(matchesOwnerFilter({ ...base, ownerFilter: '9', myProjectIds: new Set([3]) })).toBe(false)
    // 空筛选命中一切
    expect(matchesOwnerFilter({ ...base, ownerFilter: '', myProjectIds: null })).toBe(true)
  })

  it('remembers the filter per scope and workspace, ignoring invalid workspace ids', () => {
    expect(ownerFilterStorageKey('pm', 21)).toBe('zzh.pm.ownerFilter.21')
    expect(ownerFilterStorageKey('taskCenter', 21)).toBe('zzh.taskCenter.ownerFilter.21')

    writeOwnerFilter('pm', 21, '7')
    writeOwnerFilter('taskCenter', 21, '8')
    expect(readOwnerFilter('pm', 21)).toBe('7')
    expect(readOwnerFilter('taskCenter', 21)).toBe('8')
    expect(readOwnerFilter('pm', 22)).toBe('')

    writeOwnerFilter('pm', 21, '')
    expect(localStorage.getItem('zzh.pm.ownerFilter.21')).toBeNull()

    writeOwnerFilter('pm', 0, '7')
    expect(readOwnerFilter('pm', 0)).toBe('')
    expect(localStorage.length).toBe(1)
  })
})
