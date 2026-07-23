import { describe, expect, it } from 'vitest'
import { runWithConcurrencyLimit } from '@/components/task/TaskCenterCoordinator'

describe('task-center polling concurrency', () => {
  it('starts independent task polls concurrently while respecting the cap', async () => {
    let active = 0
    let maxActive = 0
    const releases: Array<() => void> = []

    const running = runWithConcurrencyLimit([1, 2, 3, 4, 5], 3, async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise<void>((resolve) => releases.push(resolve))
      active -= 1
    })

    await Promise.resolve()
    expect(active).toBe(3)
    expect(maxActive).toBe(3)

    releases.splice(0, 3).forEach((release) => release())
    await Promise.resolve()
    await Promise.resolve()
    expect(active).toBe(2)

    releases.splice(0).forEach((release) => release())
    await running
    expect(maxActive).toBe(3)
  })
})
