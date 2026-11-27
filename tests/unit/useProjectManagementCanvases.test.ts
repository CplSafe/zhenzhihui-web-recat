import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listCanvasesPage, type CanvasListPage } from '@/api/canvasApi'
import { useProjectManagementCanvases } from '@/composables/useProjectManagementCanvases'

vi.mock('@/api/canvasApi', () => ({ listCanvasesPage: vi.fn() }))

const list = vi.mocked(listCanvasesPage)

function page(count: number, ...ids: number[]): CanvasListPage {
  return { count, items: ids.map((id) => ({ id, title: `画布 ${id}` })) }
}

function deferredPage() {
  let resolve!: (value: CanvasListPage) => void
  const promise = new Promise<CanvasListPage>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('useProjectManagementCanvases', () => {
  beforeEach(() => {
    list.mockReset()
  })

  it('continues at the raw count and keeps only unique IDs when pages overlap', async () => {
    const next = deferredPage()
    list.mockResolvedValueOnce(page(100, 1, 2)).mockReturnValueOnce(next.promise)
    const { result } = renderHook(() => useProjectManagementCanvases(21, 7))

    await waitFor(() => expect(result.current.items.map(({ id }) => id)).toEqual([1, 2]))
    expect(result.current.loading).toBe(true)
    expect(list.mock.calls.map(([options]) => options.offset)).toEqual([0, 100])
    expect(list).toHaveBeenLastCalledWith(
      expect.objectContaining({ workspaceId: 21, includeArchived: true, limit: 100, signal: expect.any(AbortSignal) }),
    )

    await act(async () => {
      next.resolve(page(4, 2, 3, 3, 4))
      await next.promise
    })

    expect(result.current.items.map(({ id }) => id)).toEqual([1, 2, 3, 4])
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBe('')
  })

  it('keeps the last good page and retries the failed offset without restarting the list', async () => {
    list.mockResolvedValueOnce(page(100, 1)).mockRejectedValueOnce(new Error('fixture network failure'))
    const { result } = renderHook(() => useProjectManagementCanvases(21, 7))

    await waitFor(() => expect(result.current.error).toBeTruthy())
    expect(result.current.items).toEqual(page(1, 1).items)
    expect(result.current.loading).toBe(false)

    const retry = deferredPage()
    list.mockReturnValueOnce(retry.promise)
    act(() => result.current.retry())
    expect(result.current.items).toEqual(page(1, 1).items)
    expect(result.current.loading).toBe(true)

    await act(async () => {
      retry.resolve(page(1, 2))
      await retry.promise
    })

    expect(list.mock.calls.map(([options]) => options.offset)).toEqual([0, 100, 100])
    expect(result.current.items).toEqual(page(2, 1, 2).items)
    expect(result.current.error).toBe('')
  })

  it('stops a server that keeps returning full pages without any new record', async () => {
    list.mockResolvedValue(page(100, 1))
    const { result } = renderHook(() => useProjectManagementCanvases(21, 7))

    await waitFor(() => expect(result.current.error).toBeTruthy())
    expect(result.current.items).toEqual(page(1, 1).items)
    expect(list.mock.calls.map(([options]) => options.offset)).toEqual([0, 100, 200, 300])
  })

  it('ignores old response and setter even after returning to the original actor and workspace', async () => {
    const old = deferredPage()
    list.mockReturnValueOnce(old.promise).mockResolvedValueOnce(page(1, 2)).mockResolvedValueOnce(page(1, 3))
    const { result, rerender } = renderHook(({ ws, actor }) => useProjectManagementCanvases(ws, actor), {
      initialProps: { ws: 21, actor: 7 },
    })
    const oldSetter = result.current.setItems
    const originalSignal = list.mock.calls[0][0].signal

    rerender({ ws: 22, actor: 8 })
    expect(result.current.items).toEqual([])
    expect(originalSignal?.aborted).toBe(true)
    await waitFor(() => expect(result.current.items).toEqual(page(1, 2).items))
    rerender({ ws: 21, actor: 7 })
    await waitFor(() => expect(result.current.items).toEqual(page(1, 3).items))

    await act(async () => {
      oldSetter(page(1, 99).items)
      old.resolve(page(1, 98))
      await old.promise
    })

    expect(result.current.items).toEqual(page(1, 3).items)
    expect(list.mock.calls.map(([options]) => options.workspaceId)).toEqual([21, 22, 21])
  })

  it('rebases in-flight pagination after deletion without reintroducing the removed row', async () => {
    const old = deferredPage()
    list
      .mockResolvedValueOnce(page(100, 1, 2))
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(page(3, 1, 2, 3))
    const { result } = renderHook(() => useProjectManagementCanvases(21, 7))
    await waitFor(() => expect(result.current.items).toEqual(page(2, 1, 2).items))

    act(() => result.current.setItems((items) => items.filter(({ id }) => id !== 1)))
    expect(list.mock.calls[1][0].signal?.aborted).toBe(true)
    await waitFor(() => expect(result.current.items).toEqual(page(2, 2, 3).items))

    await act(async () => {
      old.resolve(page(1, 98))
      await old.promise
    })

    expect(result.current.items).toEqual(page(2, 2, 3).items)
    expect(list.mock.calls.map(([options]) => options.offset)).toEqual([0, 100, 99])
  })
})
