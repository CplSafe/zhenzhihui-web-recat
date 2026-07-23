import { describe, expect, it } from 'vitest'
import { isUnnamedProjectTitle, resolveCreativeProjectTitleWrite } from '@/utils/creativeProjectTitlePersistence'

describe('resolveCreativeProjectTitleWrite', () => {
  it('recognizes empty and placeholder project titles', () => {
    expect(isUnnamedProjectTitle('')).toBe(true)
    expect(isUnnamedProjectTitle('未命名项目')).toBe(true)
    expect(isUnnamedProjectTitle('夏日新品')).toBe(false)
  })

  it('recognizes a PATCH that already succeeded despite a lost response', () => {
    expect(resolveCreativeProjectTitleWrite('旧标题', '新标题', '新标题')).toBe('already-saved')
  })

  it('allows a write while the server still has the frozen baseline title', () => {
    expect(resolveCreativeProjectTitleWrite('旧标题', '新标题', '旧标题')).toBe('write')
  })

  it('blocks a stale tab after another editor changed the title', () => {
    expect(resolveCreativeProjectTitleWrite('旧标题', '我的标题', '其他页面的新标题')).toBe('conflict')
  })

  it('allows the first real title to replace an unnamed placeholder only', () => {
    expect(resolveCreativeProjectTitleWrite('', 'AI 标题', '未命名项目')).toBe('write')
    expect(resolveCreativeProjectTitleWrite('', 'AI 标题', '已存在的真实标题')).toBe('conflict')
  })
})
