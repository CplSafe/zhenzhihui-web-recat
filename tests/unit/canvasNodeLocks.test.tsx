import { renderHook, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useCanvasNodeLocks } from '@/composables/useCanvasNodeLocks'
import { requestBusinessJson } from '@/api/business'
vi.mock('@/api/business', () => ({ requestBusinessJson: vi.fn() }))
const noReferences = new Set<string>()

it('uses the decoded lock response, distinguishes an editor from a shared reference, and releases the tab', async () => {
  const call = vi.mocked(requestBusinessJson)
  call.mockImplementation(async (_path, options) => {
    const { nodes } = JSON.parse(String(options.body))
    return {
      nodes: {
        B: [{ user_id: 2, name: '小王', editing: true }],
        A: [{ user_id: 2, name: '小王', editing: false }],
        C: [{ user_id: 1, name: '自己', editing: true }],
        D: [{ user_id: 2, name: '小王', editing: false }],
        E: [{ user_id: 1, name: '自己', editing: false }],
        F: [{ user_id: 1, name: '自己', editing: false }],
      },
      granted: !nodes.includes('B'),
    }
  })
  const referenceSourceIds = new Set(['A', 'E'])
  const view = renderHook(({ ids, refs }) => useCanvasNodeLocks(4, 8, 1, true, ids, refs), {
    initialProps: { ids: ['C'], refs: referenceSourceIds },
  })
  await waitFor(() => expect(view.result.current.granted).toBe(true))
  expect(view.result.current.reason('A')).toBe('小王 正在引用')
  expect(view.result.current.reason('B')).toBe('小王 正在编辑')
  expect(view.result.current.reason('C')).toBeUndefined()
  expect(view.result.current.reason('D')).toBe('小王 暂时占用')
  expect(view.result.current.labels.get('E')).toBe('你正在引用')
  expect(view.result.current.labels.has('F')).toBe(false)
  expect(view.result.current.hues.get('A')).toBe(view.result.current.hues.get('B'))
  expect(view.result.current.hues.get('A')).not.toBe(view.result.current.hues.get('C'))
  view.rerender({ ids: ['C'], refs: noReferences })
  expect(view.result.current.labels.has('E')).toBe(false)
  expect(view.result.current.reason('A')).toBe('小王 暂时占用')
  view.rerender({ ids: ['B'], refs: referenceSourceIds })
  await waitFor(() => expect(view.result.current.denied).toBe(true))
  view.rerender({ ids: ['C'], refs: referenceSourceIds })
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
  const view = renderHook(() => useCanvasNodeLocks(4, 8, 1, true, [], noReferences))
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

it('keeps collaborator colors consistent across viewers and prefers writers over unordered shared readers', async () => {
  vi.mocked(requestBusinessJson).mockResolvedValue({
    nodes: {
      A: [
        { user_id: 2, name: '编辑者', editing: true },
        { user_id: 1, name: '引用者', editing: false },
      ],
      B: [
        { user_id: 1, name: '引用者', editing: false },
        { user_id: 2, name: '编辑者', editing: true },
      ],
      C: [{ user_id: 2, name: '编辑者的新名字', editing: true }],
    },
    granted: true,
  })
  const first = renderHook(() => useCanvasNodeLocks(4, 8, 1, true, [], noReferences))
  const second = renderHook(() => useCanvasNodeLocks(4, 8, 2, true, [], noReferences))
  await waitFor(() => expect(first.result.current.hues.size).toBe(3))
  await waitFor(() => expect(second.result.current.hues.size).toBe(3))
  expect(first.result.current.hues).toEqual(second.result.current.hues)
  expect(new Set(first.result.current.hues.values()).size).toBe(1)
  expect(first.result.current.reason('A')).toBe('编辑者 正在编辑')
  expect(second.result.current.reason('A')).toBeUndefined()
})
