import { renderHook, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useCanvasNodeLocks } from '@/composables/useCanvasNodeLocks'
import { requestBusinessJson } from '@/api/business'
vi.mock('@/api/business', () => ({ requestBusinessJson: vi.fn() }))
it('uses the decoded lock response, distinguishes an editor from a shared reference, and releases the tab', async () => {
  const call = vi.mocked(requestBusinessJson)
  call.mockImplementation(async (_path, options) => {
    const { nodes } = JSON.parse(String(options.body))
    return {
      nodes: {
        B: [{ user_id: 2, name: '小王', editing: true }],
        A: [{ user_id: 2, name: '小王', editing: false }],
        C: [{ user_id: 1, name: '自己', editing: true }],
      },
      granted: !nodes.includes('B'),
    }
  })
  const view = renderHook(({ ids }) => useCanvasNodeLocks(4, 8, 1, true, ids), { initialProps: { ids: ['C'] } })
  await waitFor(() => expect(view.result.current.granted).toBe(true))
  expect(view.result.current.reason('A')).toBe('小王 正在引用')
  expect(view.result.current.reason('B')).toBe('小王 正在编辑')
  expect(view.result.current.reason('C')).toBeUndefined()
  view.rerender({ ids: ['B'] })
  await waitFor(() => expect(view.result.current.denied).toBe(true))
  view.rerender({ ids: ['C'] })
  await waitFor(() => expect(view.result.current.granted).toBe(true))
  view.unmount()
  expect(JSON.parse(String(call.mock.lastCall[1].body)).nodes).toEqual([])
})
