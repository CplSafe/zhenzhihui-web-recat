import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installChunkFailureRecovery, isChunkLoadError, reloadOnceForChunkFailure } from '@/utils/chunkReload'

const reload = vi.fn()

beforeEach(() => {
  window.sessionStorage.clear()
  reload.mockClear()
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, reload },
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('isChunkLoadError', () => {
  it.each([
    'Unable to preload CSS for /assets/useBackgroundVideoSound-DKnwRQIz.css',
    'Failed to fetch dynamically imported module: https://app/assets/HomeView-abc.js',
    'error loading dynamically imported module',
    'Importing a module script failed.',
  ])('recognises %p as a stale-chunk failure', (message) => {
    expect(isChunkLoadError(new Error(message))).toBe(true)
    expect(isChunkLoadError(message)).toBe(true)
  })

  it.each([
    new Error('工作空间 ID 无效'),
    new TypeError('Cannot read properties of undefined'),
    new Error('HTTP 500'),
    null,
    undefined,
    '',
  ])('does not misclassify %p', (error) => {
    expect(isChunkLoadError(error)).toBe(false)
  })
})

describe('reloadOnceForChunkFailure', () => {
  it('reloads on the first failure', () => {
    expect(reloadOnceForChunkFailure(1_000)).toBe(true)
    expect(reload).toHaveBeenCalledOnce()
  })

  it('refuses to reload again inside the cooldown, so a broken deploy cannot loop', () => {
    expect(reloadOnceForChunkFailure(1_000)).toBe(true)
    reload.mockClear()

    expect(reloadOnceForChunkFailure(5_000)).toBe(false)
    expect(reloadOnceForChunkFailure(30_999)).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })

  it('allows recovery again after the cooldown, since a session may span several releases', () => {
    reloadOnceForChunkFailure(1_000)
    reload.mockClear()

    expect(reloadOnceForChunkFailure(31_001)).toBe(true)
    expect(reload).toHaveBeenCalledOnce()
  })

  it('never reloads when sessionStorage is unavailable, rather than risking a loop', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(reloadOnceForChunkFailure(1_000)).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })
})

describe('installChunkFailureRecovery', () => {
  it('recovers from the vite:preloadError event and stops listening after teardown', () => {
    const uninstall = installChunkFailureRecovery()

    const event = new Event('vite:preloadError', { cancelable: true })
    window.dispatchEvent(event)
    expect(reload).toHaveBeenCalledOnce()
    expect(event.defaultPrevented).toBe(true)

    uninstall()
    reload.mockClear()
    window.dispatchEvent(new Event('vite:preloadError', { cancelable: true }))
    expect(reload).not.toHaveBeenCalled()
  })

  it('leaves the event untouched inside the cooldown so the error page can take over', () => {
    installChunkFailureRecovery()
    window.dispatchEvent(new Event('vite:preloadError', { cancelable: true }))
    reload.mockClear()

    const second = new Event('vite:preloadError', { cancelable: true })
    window.dispatchEvent(second)
    expect(reload).not.toHaveBeenCalled()
    expect(second.defaultPrevented).toBe(false)
  })
})
