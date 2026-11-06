import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DoudouMascot } from '@/components/director/DoudouMascot'
import { doudouState } from '@/components/director/doudouState'
import type { StudioRun } from '@/components/director/studio'

const run = (overrides: Partial<StudioRun> = {}): StudioRun => ({
  id: 'one',
  status: 'running',
  cursor: 0,
  events: [],
  ...overrides,
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Doudou reflects confirmed production state', () => {
  it('tracks actual merge_id receipts separately from same-number generation task ids', () => {
    const current = run({
      events: [
        {
          id: 'image',
          kind: 'cost',
          text: '',
          data: { task_id: 1, tool: 'model.generate_image', status: 'succeeded' },
        },
        { id: 'merge', kind: 'merge', text: '', data: { merge_id: 1, status: 'queued' } },
      ],
    })
    expect(doudouState(current)).toBe('generating')
    current.events[1].data!.status = 'running'
    expect(doudouState(current)).toBe('generating')
    current.events[1].data!.status = 'succeeded'
    expect(doudouState(current)).toBe('thinking')
  })
  it('distinguishes inference from media and stops celebrating old runs during a new run', () => {
    expect(doudouState(null)).toBe('idle')
    expect(doudouState(run())).toBe('thinking')
    const current = run({
      events: [
        { id: 'text', kind: 'cost', text: '', data: { task_id: 1, tool: 'model.generate_text', status: 'running' } },
        { id: 'image', kind: 'cost', text: '', data: { task_id: 2, tool: 'model.generate_image', status: 'running' } },
      ],
    })
    expect(doudouState(current)).toBe('generating')
    current.events.push({ id: 'done', kind: 'cost', text: '', data: { task_id: 2, status: 'succeeded' } })
    expect(doudouState(current)).toBe('thinking')
    expect(doudouState(run({ status: 'complete' }))).toBe('complete')
    expect(doudouState(run({ events: [{ id: 'prose', kind: 'assistant', text: '正在生成视频' }] }))).toBe('thinking')
  })
  it('does not resurrect a task from an older receipt after an event upsert', () => {
    expect(
      doudouState(
        run({
          events: [
            {
              id: 'updated',
              kind: 'cost',
              text: '',
              at: 30,
              data: { task_id: 2, tool: 'model.generate_video', status: 'failed' },
            },
            {
              id: 'old',
              kind: 'progress',
              text: '',
              at: 20,
              data: { task_id: 2, tool: 'model.generate_video', status: 'running' },
            },
          ],
        }),
      ),
    ).toBe('thinking')
  })
  it('uses parallel batch activity, but gives approval, errors and connection loss priority', () => {
    const current = run({ batches: [{ id: 'batch', revision: 1, nodes: { a: { status: 'submitting' } } }] })
    expect(doudouState(current)).toBe('generating')
    expect(doudouState(current, true)).toBe('offline')
    expect(doudouState({ ...current, status: 'waiting' })).toBe('waiting')
    expect(doudouState({ ...current, status: 'error' })).toBe('error')
    expect(doudouState({ ...current, stop: true })).toBe('paused')
    expect(doudouState({ ...current, batches: [{ ...current.batches![0], cancelled: true }] })).toBe('thinking')
  })
})

it('pauses offscreen, on hidden pages, by user choice, and disconnects observers on unmount', () => {
  let intersect: (entries: { isIntersecting: boolean }[]) => void = () => {}
  const disconnect = vi.fn()
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: typeof intersect) {
        intersect = callback
      }
      observe = vi.fn()
      disconnect = disconnect
    },
  )
  let hidden = false
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
  const view = render(<DoudouMascot state="thinking" />)
  const mascot = screen.getByRole('button', { name: /豆豆正在思考/ })
  expect(mascot).toHaveAttribute('data-animated', 'false')
  act(() => intersect([{ isIntersecting: true }]))
  expect(mascot).toHaveAttribute('data-animated', 'true')
  act(() => {
    hidden = true
    document.dispatchEvent(new Event('visibilitychange'))
  })
  expect(mascot).toHaveAttribute('data-animated', 'false')
  act(() => {
    hidden = false
    document.dispatchEvent(new Event('visibilitychange'))
  })
  fireEvent.click(mascot)
  expect(mascot).toHaveAttribute('data-animated', 'false')
  expect(mascot).toHaveAttribute('aria-pressed', 'true')
  view.rerender(<DoudouMascot state="generating" />)
  expect(mascot).toHaveAccessibleName('豆豆正在制作素材，播放豆豆动画')
  expect(mascot).toHaveAttribute('data-animated', 'false')
  fireEvent.click(mascot)
  expect(mascot).toHaveAttribute('data-animated', 'true')
  act(() => intersect([{ isIntersecting: false }]))
  expect(mascot).toHaveAttribute('data-animated', 'false')
  view.unmount()
  expect(disconnect).toHaveBeenCalledOnce()
})
