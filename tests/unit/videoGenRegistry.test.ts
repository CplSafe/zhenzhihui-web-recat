import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VideoGenResult } from '../../src/utils/videoGenRegistry'

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

async function flushPromiseCleanup(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

let registry: typeof import('../../src/utils/videoGenRegistry')
let useUiStore: (typeof import('../../src/stores/ui'))['useUiStore']

beforeEach(async () => {
  vi.resetModules()
  window.localStorage.clear()
  ;({ useUiStore } = await import('../../src/stores/ui'))
  registry = await import('../../src/utils/videoGenRegistry')
  registry.setVideoGenOwnerScope('user-1')
  useUiStore.setState({
    workspaceSwitchLocked: false,
    workspaceSwitchLockReason: '',
    workspaceSwitchLockSources: new Map(),
  })
})

afterEach(() => {
  registry.setVideoGenOwnerScope('__test-cleanup__')
  window.localStorage.clear()
  vi.useRealTimers()
})

describe('video generation registry', () => {
  it('shares one promise for the same workspace, scope, and project and lets callers subscribe to its result', async () => {
    const generation = deferred<VideoGenResult>()
    const first = registry.trackVideoGen('smart', 7, 42, generation.promise, {
      taskId: 100,
      generationId: 'generation-1',
      status: 'preparing',
      startedAt: 1_000,
    })
    const second = registry.trackVideoGen('smart', 7, 42, generation.promise, {
      taskId: 101,
      status: 'processing',
    })
    const subscriber = registry.getRunningVideoGen('smart', 7, 42)

    expect(first).toBe(generation.promise)
    expect(second).toBe(generation.promise)
    expect(subscriber).toBe(generation.promise)
    expect(registry.isVideoGenRunning('smart', 7, 42)).toBe(true)
    expect(registry.getRunningVideoGenMeta('smart', 7, 42)).toMatchObject({
      scope: 'smart',
      projectId: 42,
      workspaceId: 7,
      taskId: 101,
      generationId: 'generation-1',
      status: 'processing',
      startedAt: 1_000,
    })

    const result = { url: '/videos/result.mp4', assetId: 88 }
    generation.resolve(result)

    await expect(subscriber).resolves.toEqual(result)
    await flushPromiseCleanup()

    expect(registry.getRunningVideoGen('smart', 7, 42)).toBeNull()
    expect(registry.getRunningVideoGenMeta('smart', 7, 42)).toBeNull()
    expect(registry.isVideoGenRunning('smart', 7, 42)).toBe(false)
  })

  it('does not let an older promise completion remove its replacement', async () => {
    const older = deferred<VideoGenResult>()
    const newer = deferred<VideoGenResult>()

    registry.trackVideoGen('smart', 7, 42, older.promise, { generationId: 'older' })
    registry.trackVideoGen('smart', 7, 42, newer.promise, { generationId: 'newer' })

    older.resolve({ url: '/videos/older.mp4', assetId: 1 })
    await older.promise
    await flushPromiseCleanup()

    expect(registry.getRunningVideoGen('smart', 7, 42)).toBe(newer.promise)
    expect(registry.getRunningVideoGenMeta('smart', 7, 42)?.generationId).toBe('newer')

    newer.resolve({ url: '/videos/newer.mp4', assetId: 2 })
    await newer.promise
    await flushPromiseCleanup()

    expect(registry.getRunningVideoGen('smart', 7, 42)).toBeNull()
  })

  it('keeps identical project ids isolated between workspaces', async () => {
    const firstWorkspace = deferred<VideoGenResult>()
    const secondWorkspace = deferred<VideoGenResult>()

    registry.trackVideoGen('smart', 7, 42, firstWorkspace.promise, { generationId: 'workspace-7' })
    registry.trackVideoGen('smart', 8, 42, secondWorkspace.promise, { generationId: 'workspace-8' })

    expect(registry.getRunningVideoGen('smart', 7, 42)).toBe(firstWorkspace.promise)
    expect(registry.getRunningVideoGen('smart', 8, 42)).toBe(secondWorkspace.promise)
    expect(registry.getRunningVideoGenMeta('smart', 7, 42)?.generationId).toBe('workspace-7')
    expect(registry.getRunningVideoGenMeta('smart', 8, 42)?.generationId).toBe('workspace-8')
    expect(registry.findRunningVideoGen('smart', 7)?.promise).toBe(firstWorkspace.promise)
    expect(registry.findRunningVideoGen('smart', 8)?.promise).toBe(secondWorkspace.promise)

    registry.updateRunningVideoGenMeta('smart', 7, 42, { generationId: 'workspace-7-updated' })
    expect(registry.getRunningVideoGenMeta('smart', 7, 42)?.generationId).toBe('workspace-7-updated')
    expect(registry.getRunningVideoGenMeta('smart', 8, 42)?.generationId).toBe('workspace-8')

    expect(registry.detachRunningVideoGen('smart', 7, 42)).toBe(true)
    expect(registry.getRunningVideoGen('smart', 7, 42)).toBeNull()
    expect(registry.getRunningVideoGen('smart', 8, 42)).toBe(secondWorkspace.promise)

    firstWorkspace.resolve({ url: '/videos/workspace-7.mp4', assetId: 7 })
    secondWorkspace.resolve({ url: '/videos/workspace-8.mp4', assetId: 8 })
    await Promise.all([firstWorkspace.promise, secondWorkspace.promise])
    await flushPromiseCleanup()
  })

  it('updates metadata with a fresh timestamp and clears it when generation succeeds', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-16T01:00:00.000Z'))
    const generation = deferred<VideoGenResult>()

    registry.trackVideoGen('hot-copy', 3, 9, generation.promise, {
      taskId: 20,
      generationId: 'copy-1',
      status: 'preparing',
      startedAt: 500,
    })

    vi.setSystemTime(new Date('2026-07-16T01:00:05.000Z'))
    registry.updateRunningVideoGenMeta('hot-copy', 3, 9, {
      taskId: 21,
      generationId: 'copy-2',
      status: 'reconnecting',
    })

    expect(registry.getRunningVideoGenMeta('hot-copy', 3, 9)).toEqual({
      scope: 'hot-copy',
      ownerScope: 'user-1',
      projectId: 9,
      workspaceId: 3,
      taskId: 21,
      generationId: 'copy-2',
      status: 'reconnecting',
      startedAt: 500,
      updatedAt: new Date('2026-07-16T01:00:05.000Z').getTime(),
    })

    generation.resolve({ url: '/videos/copy.mp4', assetId: 3 })
    await generation.promise
    await flushPromiseCleanup()

    expect(registry.getRunningVideoGenMeta('hot-copy', 3, 9)).toBeNull()
  })

  it('cleans the entry and metadata after a rejected generation', async () => {
    const generation = deferred<VideoGenResult>()
    registry.trackVideoGen('smart', 5, 77, generation.promise, {
      generationId: 'failed-generation',
    })

    generation.reject(new Error('generation failed'))
    await expect(generation.promise).rejects.toThrow('generation failed')
    await flushPromiseCleanup()

    expect(registry.getRunningVideoGen('smart', 5, 77)).toBeNull()
    expect(registry.getRunningVideoGenMeta('smart', 5, 77)).toBeNull()
    expect(registry.isVideoGenRunning('smart', 5, 77)).toBe(false)
  })

  it('keeps global running state and workspace switching locked until every scope settles', async () => {
    const smart = deferred<VideoGenResult>()
    const hotCopy = deferred<VideoGenResult>()

    registry.trackVideoGen('smart', 2, 12, smart.promise)
    registry.trackVideoGen('hot-copy', 2, 12, hotCopy.promise)

    expect(registry.isAnyVideoGenRunning()).toBe(true)
    expect(registry.isVideoGenRunning('smart', 2, 12)).toBe(true)
    expect(registry.isVideoGenRunning('hot-copy', 2, 12)).toBe(true)
    expect(useUiStore.getState()).toMatchObject({
      workspaceSwitchLocked: true,
    })
    expect(useUiStore.getState().workspaceSwitchLockReason).not.toBe('')

    smart.resolve({ url: '/videos/smart.mp4', assetId: 12 })
    await smart.promise
    await flushPromiseCleanup()

    expect(registry.isAnyVideoGenRunning()).toBe(true)
    expect(registry.isVideoGenRunning('smart', 2, 12)).toBe(false)
    expect(registry.isVideoGenRunning('hot-copy', 2, 12)).toBe(true)
    expect(useUiStore.getState().workspaceSwitchLocked).toBe(true)

    hotCopy.resolve({ url: '/videos/hot-copy.mp4', assetId: 13 })
    await hotCopy.promise
    await flushPromiseCleanup()

    expect(registry.isAnyVideoGenRunning()).toBe(false)
    expect(useUiStore.getState()).toMatchObject({
      workspaceSwitchLocked: false,
      workspaceSwitchLockReason: '',
    })
  })

  it('detaches an inaccessible project without cancelling its server promise', async () => {
    const inaccessible = deferred<VideoGenResult>()
    const remaining = deferred<VideoGenResult>()
    registry.trackVideoGen('smart', 2, 12, inaccessible.promise)
    registry.trackVideoGen('hot-copy', 2, 13, remaining.promise)

    expect(registry.detachRunningVideoGen('smart', 2, 12)).toBe(true)
    expect(registry.getRunningVideoGen('smart', 2, 12)).toBeNull()
    expect(registry.isAnyVideoGenRunning()).toBe(true)
    expect(useUiStore.getState().workspaceSwitchLocked).toBe(true)

    inaccessible.resolve({ url: '/videos/inaccessible.mp4', assetId: 12 })
    await inaccessible.promise
    await flushPromiseCleanup()
    expect(registry.getRunningVideoGen('hot-copy', 2, 13)).toBe(remaining.promise)

    remaining.resolve({ url: '/videos/remaining.mp4', assetId: 13 })
    await remaining.promise
    await flushPromiseCleanup()
    expect(registry.isAnyVideoGenRunning()).toBe(false)
    expect(useUiStore.getState().workspaceSwitchLocked).toBe(false)
  })

  it('does not register invalid project ids', async () => {
    const result = Promise.resolve({ url: '/videos/untracked.mp4', assetId: 1 })

    expect(registry.trackVideoGen('smart', 7, 0, result)).toBe(result)
    expect(registry.isAnyVideoGenRunning()).toBe(false)
    expect(registry.getRunningVideoGen('smart', 7, 0)).toBeNull()
    expect(useUiStore.getState().workspaceSwitchLocked).toBe(false)

    await result
  })

  it('isolates identical projects by account and detaches an account on logout', async () => {
    const firstAccount = deferred<VideoGenResult>()
    const secondAccount = deferred<VideoGenResult>()

    registry.setVideoGenOwnerScope('account-a')
    registry.trackVideoGen('smart', 7, 42, firstAccount.promise)
    expect(registry.isAnyVideoGenRunning()).toBe(true)

    registry.setVideoGenOwnerScope('account-b')
    expect(registry.getRunningVideoGen('smart', 7, 42)).toBeNull()
    expect(registry.isAnyVideoGenRunning()).toBe(false)
    registry.trackVideoGen('smart', 7, 42, secondAccount.promise)

    expect(registry.detachRunningVideoGensForOwner('account-a')).toBe(1)
    expect(registry.getRunningVideoGen('smart', 7, 42)).toBe(secondAccount.promise)
    expect(registry.isAnyVideoGenRunning()).toBe(true)

    firstAccount.resolve({ url: '/videos/a.mp4', assetId: 1 })
    secondAccount.resolve({ url: '/videos/b.mp4', assetId: 2 })
    await Promise.all([firstAccount.promise, secondAccount.promise])
    await flushPromiseCleanup()
  })

  it('honors a live generation lease created by another browser tab', () => {
    const registryKey = 'user-1:smart:7:42'
    window.localStorage.setItem(
      `zzh.video-gen-lease.v1.${encodeURIComponent(registryKey)}`,
      JSON.stringify({
        scope: 'smart',
        ownerScope: 'user-1',
        projectId: 42,
        workspaceId: 7,
        taskId: 100,
        generationId: 'other-tab',
        status: 'processing',
        startedAt: Date.now(),
        updatedAt: Date.now(),
        tabId: 'other-tab',
        expiresAt: Date.now() + 60_000,
      }),
    )

    registry.setVideoGenOwnerScope('user-1')

    expect(registry.isVideoGenRunning('smart', 7, 42)).toBe(true)
    expect(registry.isAnyVideoGenRunning()).toBe(true)
    expect(useUiStore.getState().workspaceSwitchLocked).toBe(true)
  })

  it('automatically unlocks when another tab stops heartbeating and its lease expires', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const registryKey = 'user-1:smart:7:42'
    const storageKey = `zzh.video-gen-lease.v1.${encodeURIComponent(registryKey)}`
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        scope: 'smart',
        ownerScope: 'user-1',
        projectId: 42,
        workspaceId: 7,
        taskId: 100,
        generationId: 'abandoned-tab',
        status: 'processing',
        startedAt: 900,
        updatedAt: 900,
        tabId: 'abandoned-tab',
        expiresAt: 1_100,
      }),
    )

    registry.setVideoGenOwnerScope('user-1')
    expect(useUiStore.getState().workspaceSwitchLocked).toBe(true)

    await vi.advanceTimersByTimeAsync(101)

    expect(window.localStorage.getItem(storageKey)).toBeNull()
    expect(registry.isAnyVideoGenRunning()).toBe(false)
    expect(useUiStore.getState()).toMatchObject({
      workspaceSwitchLocked: false,
      workspaceSwitchLockReason: '',
    })
  })

  it('keeps a page-owned lock after an external generation lease expires', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const pageSource = Symbol('smart-page-instance')
    useUiStore.getState().setWorkspaceSwitchLockSource(pageSource, true, '素材正在上传')

    const registryKey = 'user-1:smart:7:42'
    const storageKey = `zzh.video-gen-lease.v1.${encodeURIComponent(registryKey)}`
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        scope: 'smart',
        ownerScope: 'user-1',
        projectId: 42,
        workspaceId: 7,
        taskId: 100,
        generationId: 'abandoned-tab',
        status: 'processing',
        startedAt: 900,
        updatedAt: 900,
        tabId: 'abandoned-tab',
        expiresAt: 1_100,
      }),
    )

    registry.setVideoGenOwnerScope('user-1')
    expect(useUiStore.getState().workspaceSwitchLocked).toBe(true)

    await vi.advanceTimersByTimeAsync(101)

    expect(window.localStorage.getItem(storageKey)).toBeNull()
    expect(useUiStore.getState()).toMatchObject({
      workspaceSwitchLocked: true,
      workspaceSwitchLockReason: '素材正在上传',
    })

    useUiStore.getState().setWorkspaceSwitchLockSource(pageSource, false)
    expect(useUiStore.getState()).toMatchObject({
      workspaceSwitchLocked: false,
      workspaceSwitchLockReason: '',
    })
  })

  it('aggregates independent page instances and the backward-compatible lock source', () => {
    const firstPage = Symbol('smart-page-1')
    const secondPage = Symbol('smart-page-2')
    const ui = useUiStore.getState()

    ui.setWorkspaceSwitchLockSource(firstPage, true, '第一个页面处理中')
    ui.setWorkspaceSwitchLockSource(secondPage, true, '第二个页面处理中')
    ui.setWorkspaceSwitchLock(true, '兼容调用处理中')

    ui.setWorkspaceSwitchLockSource(firstPage, false)
    expect(useUiStore.getState().workspaceSwitchLocked).toBe(true)

    ui.setWorkspaceSwitchLock(false)
    expect(useUiStore.getState()).toMatchObject({
      workspaceSwitchLocked: true,
      workspaceSwitchLockReason: '第二个页面处理中',
    })

    ui.setWorkspaceSwitchLockSource(secondPage, false)
    expect(useUiStore.getState()).toMatchObject({
      workspaceSwitchLocked: false,
      workspaceSwitchLockReason: '',
    })
  })

  it('fails closed when workspace id is missing instead of matching another workspace', async () => {
    const generation = deferred<VideoGenResult>()
    registry.trackVideoGen('smart', 7, 42, generation.promise)

    expect(registry.trackVideoGen('smart', 0, 42, generation.promise)).toBe(generation.promise)
    expect(registry.getRunningVideoGen('smart', 0, 42)).toBeNull()
    expect(registry.getRunningVideoGenMeta('smart', 0, 42)).toBeNull()
    expect(registry.isVideoGenRunning('smart', 0, 42)).toBe(false)
    expect(registry.detachRunningVideoGen('smart', 0, 42)).toBe(false)
    expect(registry.findRunningVideoGen('smart', 0)).toBeNull()
    expect(registry.getRunningVideoGen('smart', 7, 42)).toBe(generation.promise)

    generation.resolve({ url: '/videos/workspace-7.mp4', assetId: 7 })
    await generation.promise
    await flushPromiseCleanup()
  })
})
