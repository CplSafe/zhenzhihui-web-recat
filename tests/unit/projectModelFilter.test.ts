import { describe, expect, it } from 'vitest'
import {
  ALL_VIDEO_MODELS,
  UNKNOWN_VIDEO_MODEL,
  buildVideoModelFilterOptions,
  matchesVideoModelFilter,
} from '@/utils/projectModelFilter'

describe('buildVideoModelFilterOptions', () => {
  it('counts videos per model, sorts by count then name, and prefers catalog names over snapshots', () => {
    const options = buildVideoModelFilterOptions(
      [
        { modelVersionId: 1 },
        { modelVersionId: 2, modelName: '快照名' },
        { modelVersionId: 1, modelName: '旧快照' },
        { modelVersionId: 3 },
      ],
      (id) => (id === 1 ? '目录模型 A' : ''),
    )
    expect(options).toEqual([
      { value: ALL_VIDEO_MODELS, label: '全部' },
      { value: '1', label: '目录模型 A（2）' },
      { value: '2', label: '快照名（1）' },
      { value: '3', label: '模型 #3（1）' },
    ])
  })

  it('adds a trailing "未记录模型" option only when some video has no model', () => {
    expect(buildVideoModelFilterOptions([{ modelVersionId: 5 }, {}, { modelVersionId: 0 }], () => '')).toEqual([
      { value: ALL_VIDEO_MODELS, label: '全部' },
      { value: '5', label: '模型 #5（1）' },
      { value: UNKNOWN_VIDEO_MODEL, label: '未记录模型（2）' },
    ])
  })

  it('returns no options at all when no video recorded a model (the control is hidden)', () => {
    expect(buildVideoModelFilterOptions([{}, { modelName: '只有名字没有 id' }], () => '')).toEqual([])
    expect(buildVideoModelFilterOptions([], () => '')).toEqual([])
  })
})

describe('matchesVideoModelFilter', () => {
  it('passes everything for 全部, matches by id, and isolates unknown-model videos', () => {
    expect(matchesVideoModelFilter({ modelVersionId: 5 }, ALL_VIDEO_MODELS)).toBe(true)
    expect(matchesVideoModelFilter({}, ALL_VIDEO_MODELS)).toBe(true)
    expect(matchesVideoModelFilter({ modelVersionId: 5 }, '5')).toBe(true)
    expect(matchesVideoModelFilter({ modelVersionId: 5 }, '6')).toBe(false)
    expect(matchesVideoModelFilter({}, '5')).toBe(false)
    expect(matchesVideoModelFilter({}, UNKNOWN_VIDEO_MODEL)).toBe(true)
    expect(matchesVideoModelFilter({ modelVersionId: 5 }, UNKNOWN_VIDEO_MODEL)).toBe(false)
  })
})
