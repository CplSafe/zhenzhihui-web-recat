import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCanvasPullLoop } from '@/utils/canvasPullLoop'

afterEach(() => vi.useRealTimers())
describe('canvas change notifications', () => {
  it('continuous notifications retain the in-flight result and coalesce into one follow-up read', async () => {
    vi.useFakeTimers()
    let finish!: () => void
    const applied: string[] = []
    const pull = vi.fn().mockImplementationOnce(async () => {
      await new Promise<void>(resolve => { finish = resolve })
      applied.push('first')
      loop.schedule(10_000)
    }).mockImplementation(async () => { applied.push('second'); loop.schedule(10_000) })
    const loop = createCanvasPullLoop(pull)
    loop.wake()
    vi.advanceTimersByTime(0)
    for (let i = 0; i < 5; i++) { loop.wake(); vi.advanceTimersByTime(500) }
    expect(pull).toHaveBeenCalledTimes(1)
    finish()
    await vi.advanceTimersByTimeAsync(1)
    expect(applied).toEqual(['first','second'])
    loop.dispose()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(pull).toHaveBeenCalledTimes(2)
  })
  it('switching canvas discards the old scheduler and allows the new canvas first change immediately', async () => {
    vi.useFakeTimers()
    const oldPull = vi.fn(async () => {}), newPull = vi.fn(async () => {})
    const old = createCanvasPullLoop(oldPull)
    old.schedule(1500)
    old.dispose()
    old.wake()
    const next = createCanvasPullLoop(newPull)
    next.wake()
    await vi.advanceTimersByTimeAsync(1)
    expect(newPull).toHaveBeenCalledTimes(1)
    expect(oldPull).not.toHaveBeenCalled()
    next.dispose()
  })
})
