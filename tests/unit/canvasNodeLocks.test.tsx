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

it('blocks all node commands under an Agent lock and sends only an explicit conditional unlock', async () => {
  const call = vi.mocked(requestBusinessJson)
  call.mockClear()
  call.mockResolvedValue({
    nodes: {},
    granted: false,
    agent_owner: 'Owner',
    agent_lock: { id: 'held-1', owner_id: 2, owner: 'Owner', running: false, can_unlock: false },
  })
  const view = renderHook(() => useCanvasNodeLocks(4, 8, 1, true, []))
  await waitFor(() => expect(view.result.current.agentOwner).toBe('Owner'))
  expect(view.result.current.reason('any-node')).toContain('已锁定画布')
  expect(view.result.current.reason()).toContain('已锁定画布')
  expect(call.mock.calls.some(([path]) => String(path).includes('/unlock'))).toBe(false)
  await view.result.current.unlockAgent('held-1')
  expect(call.mock.calls.find(([path]) => String(path).includes('/unlock'))?.[1].body).toBe(
    JSON.stringify({ lock_id: 'held-1' }),
  )
  view.unmount()
})
