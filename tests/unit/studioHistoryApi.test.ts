import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/business', () => ({ listAiTasks: vi.fn() }))

import { listAiTasks } from '@/api/business'
import { STUDIO_OPERATIONS, fetchStudioHistoryPage } from '@/api/studioHistory'

const mockedListAiTasks = vi.mocked(listAiTasks)

/** 造一条带创建时间的任务。 */
function task(id: number, createdAt: string) {
  return { id, status: 'succeeded', created_at: createdAt }
}

describe('fetchStudioHistoryPage', () => {
  beforeEach(() => {
    mockedListAiTasks.mockReset()
  })

  it('并行拉取创作台的三类 operation', async () => {
    mockedListAiTasks.mockResolvedValue({ items: [] })
    await fetchStudioHistoryPage({ workspaceId: 1 })

    expect(mockedListAiTasks).toHaveBeenCalledTimes(STUDIO_OPERATIONS.length)
    const requested = mockedListAiTasks.mock.calls.map(([args]: any[]) => args.operationCode)
    expect(requested).toEqual([...STUDIO_OPERATIONS])
  })

  it('合并各 operation 的结果并按创建时间倒序', async () => {
    mockedListAiTasks
      .mockResolvedValueOnce({ items: [task(1, '2026-08-26T10:00:00Z')] })
      .mockResolvedValueOnce({ items: [task(2, '2026-08-26T12:00:00Z')] })
      .mockResolvedValueOnce({ items: [task(3, '2026-08-26T11:00:00Z')] })

    const page = await fetchStudioHistoryPage({ workspaceId: 1 })
    expect(page.items.map((item) => item.id)).toEqual([2, 3, 1])
  })

  it('兼容 data 包裹的响应形态', async () => {
    mockedListAiTasks.mockResolvedValue({ data: { items: [task(9, '2026-08-26T10:00:00Z')] } })
    const page = await fetchStudioHistoryPage({ workspaceId: 1 })
    expect(page.items.map((item) => item.id)).toEqual([9, 9, 9])
  })

  it('任一 operation 满页即认为还有更早的历史', async () => {
    mockedListAiTasks
      .mockResolvedValueOnce({ items: [task(1, '2026-08-26T10:00:00Z'), task(2, '2026-08-26T10:00:00Z')] })
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [] })

    await expect(fetchStudioHistoryPage({ workspaceId: 1, limit: 2 })).resolves.toMatchObject({
      nextOffsets: { 'image.text_to_image': 2 },
    })
  })

  it('都不满页时判定已到底', async () => {
    mockedListAiTasks.mockResolvedValue({ items: [task(1, '2026-08-26T10:00:00Z')] })
    await expect(fetchStudioHistoryPage({ workspaceId: 1, limit: 5 })).resolves.toMatchObject({ nextOffsets: {} })
  })

  it('失败的流保留原偏移，成功的流独立前进', async () => {
    mockedListAiTasks
      .mockResolvedValueOnce({ items: [task(1, '2026-08-26T10:00:00Z')] })
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ items: [task(3, '2026-08-26T11:00:00Z')] })

    const page = await fetchStudioHistoryPage({ workspaceId: 1, limit: 1 })
    expect(page.items.map((item) => item.id)).toEqual([3, 1])
    expect(page.failedOperations).toEqual(['image.image_to_image'])
    expect(page.nextOffsets).toEqual({ 'image.text_to_image': 1, 'image.image_to_image': 0, 'video.generate': 1 })
  })

  it('把 offset 与 limit 透传给后端', async () => {
    mockedListAiTasks.mockResolvedValue({ items: [] })
    await fetchStudioHistoryPage({
      workspaceId: 42,
      offsets: { 'video.generate': 24, 'image.image_to_image': 12 },
      limit: 12,
    })

    expect(mockedListAiTasks).toHaveBeenCalledTimes(2)
    expect(mockedListAiTasks).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 42, operationCode: 'video.generate', offset: 24, limit: 12 }),
    )
    expect(mockedListAiTasks).toHaveBeenCalledWith(
      expect.objectContaining({ operationCode: 'image.image_to_image', offset: 12 }),
    )
  })
})
