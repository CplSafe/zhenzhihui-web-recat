import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ listBackendTemplates: vi.fn() }))

vi.mock('@/api/templates', () => ({ listBackendTemplates: mocks.listBackendTemplates }))

import { clearTemplateCatalogCache, loadTemplateCatalog } from '@/utils/templateCatalog'

describe('templateCatalog', () => {
  beforeEach(() => {
    clearTemplateCatalogCache()
    mocks.listBackendTemplates.mockReset()
  })

  it('首页和模板页并发读取时只探测一次后端', async () => {
    mocks.listBackendTemplates.mockResolvedValue([])

    const [first, second] = await Promise.all([loadTemplateCatalog(), loadTemplateCatalog()])

    expect(mocks.listBackendTemplates).toHaveBeenCalledTimes(1)
    expect(first).toBe(second)
    expect(first.source).toBe('builtin')
    expect(first.items.length).toBeGreaterThan(0)
    expect(first.notice).toContain('内置')
  })

  it('远程模板可用时明确标记在线来源', async () => {
    const remote = [{ id: 1, title: '在线模板' }]
    mocks.listBackendTemplates.mockResolvedValue(remote)

    await expect(loadTemplateCatalog()).resolves.toEqual({ items: remote, source: 'backend', notice: '' })
  })

  it('接口异常时也稳定降级为内置模板', async () => {
    mocks.listBackendTemplates.mockRejectedValue(new Error('404'))

    const catalog = await loadTemplateCatalog()

    expect(catalog.source).toBe('builtin')
    expect(catalog.items.length).toBeGreaterThan(0)
    expect(catalog.notice).toContain('暂时不可用')
  })
})
