import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/studioHistory', () => ({ fetchStudioHistoryPage: vi.fn() }))

import { fetchStudioHistoryPage } from '@/api/studioHistory'
import { useStudioHistory } from '@/composables/useStudioHistory'

const mockedFetch = vi.mocked(fetchStudioHistoryPage)

/** 造一条后端任务。 */
function task(id: number, createdAt = '2026-08-26T10:00:00Z') {
  return { id, status: 'succeeded', operation_code: 'video.generate', created_at: createdAt, outputs: [] }
}

describe('useStudioHistory', () => {
  beforeEach(() => {
    mockedFetch.mockReset()
  })

  it('首屏加载最近一页并按旧→新排列', async () => {
    mockedFetch.mockResolvedValue({
      items: [task(2, '2026-08-26T11:00:00Z'), task(1, '2026-08-26T10:00:00Z')],
      hasMore: false,
    })

    const { result } = renderHook(() => useStudioHistory(1))
    await waitFor(() => expect(result.current.loading).toBe(false))

    // 后端给的是新→旧，页面要旧在上、新在下。
    expect(result.current.batches.map((batch) => batch.id)).toEqual(['task-1', 'task-2'])
  })

  it('工作空间为 0 时不发请求', async () => {
    const { result } = renderHook(() => useStudioHistory(0))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(mockedFetch).not.toHaveBeenCalled()
    expect(result.current.batches).toEqual([])
  })

  it('翻页把更早的历史拼到前面并推进 offset', async () => {
    mockedFetch
      .mockResolvedValueOnce({ items: [task(10, '2026-08-26T12:00:00Z')], hasMore: true })
      .mockResolvedValueOnce({ items: [task(5, '2026-08-26T09:00:00Z')], hasMore: false })

    const { result } = renderHook(() => useStudioHistory(1))
    await waitFor(() => expect(result.current.hasMore).toBe(true))

    await act(async () => {
      await result.current.loadMore()
    })

    expect(result.current.batches.map((batch) => batch.id)).toEqual(['task-5', 'task-10'])
    // 第二页必须从第一页之后继续取，否则会把同一页反复拼进来。
    expect(mockedFetch).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 12 }))
    expect(result.current.hasMore).toBe(false)
  })

  it('没有更多时不再请求', async () => {
    mockedFetch.mockResolvedValue({ items: [task(1)], hasMore: false })
    const { result } = renderHook(() => useStudioHistory(1))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.loadMore()
    })
    expect(mockedFetch).toHaveBeenCalledTimes(1)
  })

  it('并发触发翻页只发一次请求', async () => {
    // 滚动抖动会连续触发哨兵，重复请求既浪费又会把同一页拼两次。
    mockedFetch
      .mockResolvedValueOnce({ items: [task(10)], hasMore: true })
      .mockResolvedValueOnce({ items: [task(5)], hasMore: true })

    const { result } = renderHook(() => useStudioHistory(1))
    await waitFor(() => expect(result.current.hasMore).toBe(true))

    await act(async () => {
      await Promise.all([result.current.loadMore(), result.current.loadMore(), result.current.loadMore()])
    })

    expect(mockedFetch).toHaveBeenCalledTimes(2) // 首屏 1 次 + 翻页 1 次
  })

  it('翻页失败后仍可重试，不会永久卡死', async () => {
    // 回归：若把 inFlightRef 清理写在 IIFE 内部，同步抛错会让 ref 停在一个已 settle
    // 的 promise 上，之后每次 loadMore 都直接返回它，翻页静默失效。
    mockedFetch
      .mockResolvedValueOnce({ items: [task(10)], hasMore: true })
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ items: [task(5)], hasMore: false })

    const { result } = renderHook(() => useStudioHistory(1))
    await waitFor(() => expect(result.current.hasMore).toBe(true))

    await act(async () => {
      await result.current.loadMore()
    })
    // 失败后停止继续翻，但已加载的历史保留。
    expect(result.current.batches.map((batch) => batch.id)).toEqual(['task-10'])
    expect(result.current.loadingMore).toBe(false)
  })

  it('切换工作空间后清空并重新加载', async () => {
    mockedFetch
      .mockResolvedValueOnce({ items: [task(1)], hasMore: false })
      .mockResolvedValueOnce({ items: [task(99)], hasMore: false })

    const { result, rerender } = renderHook(({ ws }) => useStudioHistory(ws), { initialProps: { ws: 1 } })
    await waitFor(() => expect(result.current.batches.map((b) => b.id)).toEqual(['task-1']))

    rerender({ ws: 2 })
    // 旧空间的历史绝不能留在新空间的列表里。
    await waitFor(() => expect(result.current.batches.map((b) => b.id)).toEqual(['task-99']))
  })

  it('迟到的旧空间响应不会污染新空间', async () => {
    let resolveFirst: (value: any) => void = () => {}
    mockedFetch
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce({ items: [task(99)], hasMore: false })

    const { result, rerender } = renderHook(({ ws }) => useStudioHistory(ws), { initialProps: { ws: 1 } })
    rerender({ ws: 2 })
    await waitFor(() => expect(result.current.batches.map((b) => b.id)).toEqual(['task-99']))

    // 旧空间的请求现在才返回，必须被丢弃。
    await act(async () => {
      resolveFirst({ items: [task(1)], hasMore: true })
    })
    expect(result.current.batches.map((b) => b.id)).toEqual(['task-99'])
  })

  it('首屏失败时保持空列表且不阻塞创作', async () => {
    mockedFetch.mockRejectedValue(new Error('network down'))
    const { result } = renderHook(() => useStudioHistory(1))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.batches).toEqual([])
    expect(result.current.hasMore).toBe(false)
  })

  it('setBatches 可供外部追加新生成的批次', async () => {
    mockedFetch.mockResolvedValue({ items: [task(1)], hasMore: false })
    const { result } = renderHook(() => useStudioHistory(1))
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => {
      result.current.setBatches((current) => [
        ...current,
        { id: 'local', mode: 'video', prompt: '', summary: '', createdAt: 0, items: [] },
      ])
    })
    // 新生成追加到尾部（聊天式：新在下）。
    expect(result.current.batches.map((b) => b.id)).toEqual(['task-1', 'local'])
  })
})
