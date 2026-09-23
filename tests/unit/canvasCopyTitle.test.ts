import { describe, expect, it } from 'vitest'
import { buildCanvasCopyTitle } from '@/utils/canvasCopyTitle'

describe('buildCanvasCopyTitle', () => {
  it('appends the copy suffix', () => {
    expect(buildCanvasCopyTitle('漫剧', ['漫剧'])).toBe('漫剧-副本')
  })

  it('numbers the suffix when a copy already exists', () => {
    expect(buildCanvasCopyTitle('漫剧', ['漫剧', '漫剧-副本', '漫剧-副本2'])).toBe('漫剧-副本3')
  })

  it('does not stack suffixes when copying a copy', () => {
    expect(buildCanvasCopyTitle('漫剧-副本', ['漫剧', '漫剧-副本'])).toBe('漫剧-副本2')
  })

  it('falls back for untitled canvases and keeps the result within the length limit', () => {
    expect(buildCanvasCopyTitle('', [])).toBe('未命名画布-副本')
    const copy = buildCanvasCopyTitle('长'.repeat(60), [])
    expect(copy).toHaveLength(60)
    expect(copy.endsWith('-副本')).toBe(true)
  })
})
