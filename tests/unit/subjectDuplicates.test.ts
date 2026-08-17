import { describe, expect, it } from 'vitest'
import { findDuplicateSubjectGroups, looksLikeSameSubject, normalizeSubjectName } from '@/utils/subjectDuplicates'

const shot = (...subjects: { tag: string; image?: string }[]) => ({ subjects })

describe('normalizeSubjectName', () => {
  it.each([
    ['@汽车置物架', '置物架'],
    ['车载置物架', '置物架'],
    ['这款置物架', '置物架'],
    ['产品的包装盒', '产品包装盒'],
    ['  精华液瓶 ', '精华液瓶'],
  ])('normalises %p to %p', (input, expected) => {
    expect(normalizeSubjectName(input)).toBe(expected)
  })

  it('never strips a name down to nothing', () => {
    // 「汽车」整个就是修饰词，剥光后要退回原名，否则会和任何主体都匹配上
    expect(normalizeSubjectName('汽车')).toBe('汽车')
  })
})

describe('looksLikeSameSubject', () => {
  it.each([
    ['汽车置物架', '车载置物架'],
    ['汽车置物架', '置物架'],
    ['置物架', '置物架架体'],
  ])('links %p and %p', (left, right) => {
    expect(looksLikeSameSubject(left, right)).toBe(true)
  })

  it.each([
    // 真正的两个产品不能被凑到一起
    ['前排置物架', '后备箱置物架'],
    ['架子', '货架收纳架组合'],
    ['年轻女性', '护肤仪器'],
    ['', '置物架'],
  ])('keeps %p and %p apart', (left, right) => {
    expect(looksLikeSameSubject(left, right)).toBe(false)
  })
})

describe('findDuplicateSubjectGroups', () => {
  it('flags the same product named differently across shots', () => {
    const groups = findDuplicateSubjectGroups([
      shot({ tag: '@汽车置物架', image: 'https://cdn/upload.png' }),
      shot({ tag: '@室内场景' }),
      shot({ tag: '@车载置物架' }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].names).toEqual(['汽车置物架', '车载置物架'])
    // 建议保留用户已经绑过素材的那个，合并后图自动共享
    expect(groups[0].canonical).toBe('汽车置物架')
  })

  it('prefers the subject that already has material even when the other name is longer', () => {
    const groups = findDuplicateSubjectGroups([
      shot({ tag: '@置物架', image: 'https://cdn/upload.png' }),
      shot({ tag: '@汽车置物架横杆' }),
    ])
    expect(groups[0].canonical).toBe('置物架')
  })

  it('falls back to the most descriptive name when none has material', () => {
    const groups = findDuplicateSubjectGroups([shot({ tag: '@置物架' }), shot({ tag: '@车载置物架' })])
    expect(groups[0].canonical).toBe('车载置物架')
  })

  it('ignores subjects that already share one name, since they share the image too', () => {
    expect(findDuplicateSubjectGroups([shot({ tag: '@置物架', image: 'a.png' }), shot({ tag: '@置物架' })])).toEqual([])
  })

  it('returns nothing for empty, single-subject or missing input', () => {
    expect(findDuplicateSubjectGroups([])).toEqual([])
    expect(findDuplicateSubjectGroups(undefined)).toEqual([])
    expect(findDuplicateSubjectGroups([shot({ tag: '@置物架' })])).toEqual([])
  })

  it('keeps unrelated products out of the report', () => {
    expect(
      findDuplicateSubjectGroups([shot({ tag: '@年轻女性' }, { tag: '@护肤仪器' }), shot({ tag: '@咨询区' })]),
    ).toEqual([])
  })
})
