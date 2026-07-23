import { beforeEach, describe, expect, it, vi } from 'vitest'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function flushTaskStart(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

let queue: typeof import('../../src/utils/creativeDraftSaveQueue')

beforeEach(async () => {
  vi.resetModules()
  queue = await import('../../src/utils/creativeDraftSaveQueue')
})

describe('creative project draft save queue', () => {
  it('runs saves for the same workspace and project strictly in enqueue order', async () => {
    const firstGate = deferred<void>()
    const events: string[] = []

    const first = queue.enqueueCreativeProjectDraftSave({
      workspaceId: 3,
      projectId: 8,
      task: async () => {
        events.push('first:start')
        await firstGate.promise
        events.push('first:end')
        return 'first-result'
      },
    })
    const second = queue.enqueueCreativeProjectDraftSave({
      workspaceId: 3,
      projectId: 8,
      task: async () => {
        events.push('second:start')
        events.push('second:end')
        return 'second-result'
      },
    })

    await flushTaskStart()
    expect(events).toEqual(['first:start'])

    firstGate.resolve()

    await expect(first).resolves.toBe('first-result')
    await expect(second).resolves.toBe('second-result')
    expect(events).toEqual(['first:start', 'first:end', 'second:start', 'second:end'])
  })

  it('allows saves for different projects to run in parallel', async () => {
    const firstGate = deferred<void>()
    const secondGate = deferred<void>()
    const events: string[] = []

    const first = queue.enqueueCreativeProjectDraftSave({
      workspaceId: 3,
      projectId: 8,
      task: async () => {
        events.push('project-8:start')
        await firstGate.promise
        events.push('project-8:end')
      },
    })
    const second = queue.enqueueCreativeProjectDraftSave({
      workspaceId: 3,
      projectId: 9,
      task: async () => {
        events.push('project-9:start')
        await secondGate.promise
        events.push('project-9:end')
      },
    })

    await flushTaskStart()
    expect(events).toEqual(['project-8:start', 'project-9:start'])

    secondGate.resolve()
    await second
    expect(events).toEqual(['project-8:start', 'project-9:start', 'project-9:end'])

    firstGate.resolve()
    await first
    expect(events).toEqual(['project-8:start', 'project-9:start', 'project-9:end', 'project-8:end'])
  })

  it('continues with the next save after a previous save fails', async () => {
    const failure = new Error('draft conflict')
    const events: string[] = []

    const first = queue.enqueueCreativeProjectDraftSave({
      workspaceId: 4,
      projectId: 10,
      task: async () => {
        events.push('first')
        throw failure
      },
    })
    const second = queue.enqueueCreativeProjectDraftSave({
      workspaceId: 4,
      projectId: 10,
      task: async () => {
        events.push('second')
        return 'recovered'
      },
    })

    await expect(first).rejects.toBe(failure)
    await expect(second).resolves.toBe('recovered')
    expect(events).toEqual(['first', 'second'])
  })

  it('waits for saves that are appended while waiting is already in progress', async () => {
    const firstGate = deferred<void>()
    const secondGate = deferred<void>()
    const secondStarted = deferred<void>()
    const events: string[] = []
    let waitFinished = false

    const first = queue.enqueueCreativeProjectDraftSave({
      workspaceId: 5,
      projectId: 11,
      task: async () => {
        events.push('first:start')
        await firstGate.promise
        events.push('first:end')
      },
    })
    await flushTaskStart()

    const waiting = queue.waitForCreativeProjectDraftSaves({ workspaceId: 5, projectId: 11 }).then(() => {
      waitFinished = true
    })
    const second = queue.enqueueCreativeProjectDraftSave({
      workspaceId: 5,
      projectId: 11,
      task: async () => {
        events.push('second:start')
        secondStarted.resolve()
        await secondGate.promise
        events.push('second:end')
      },
    })

    firstGate.resolve()
    await first
    await secondStarted.promise

    expect(events).toEqual(['first:start', 'first:end', 'second:start'])
    expect(waitFinished).toBe(false)

    secondGate.resolve()
    await second
    await waiting

    expect(waitFinished).toBe(true)
    expect(events).toEqual(['first:start', 'first:end', 'second:start', 'second:end'])
  })

  it('cleans a drained queue so waiting finishes and a later save starts normally', async () => {
    const firstTask = vi.fn(async () => 'saved')

    await expect(
      queue.enqueueCreativeProjectDraftSave({
        workspaceId: 6,
        projectId: 12,
        task: firstTask,
      }),
    ).resolves.toBe('saved')
    await queue.waitForCreativeProjectDraftSaves({ workspaceId: 6, projectId: 12 })

    let emptyWaitFinished = false
    await queue.waitForCreativeProjectDraftSaves({ workspaceId: 6, projectId: 12 }).then(() => {
      emptyWaitFinished = true
    })
    expect(emptyWaitFinished).toBe(true)

    const nextTask = vi.fn(async () => 'saved-again')
    await expect(
      queue.enqueueCreativeProjectDraftSave({
        workspaceId: 6,
        projectId: 12,
        task: nextTask,
      }),
    ).resolves.toBe('saved-again')

    expect(firstTask).toHaveBeenCalledTimes(1)
    expect(nextTask).toHaveBeenCalledTimes(1)
  })
})
