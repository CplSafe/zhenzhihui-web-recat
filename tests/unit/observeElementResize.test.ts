import { describe, expect, it, vi } from 'vitest'
import { observeElementResize } from '@/utils/observeElementResize'

describe('observeElementResize', () => {
  it('falls back to window resize events when ResizeObserver is unavailable', () => {
    const original = globalThis.ResizeObserver
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: undefined,
    })
    const callback = vi.fn()
    const element = document.createElement('div')

    try {
      const cleanup = observeElementResize(element, callback)
      expect(callback).toHaveBeenCalledTimes(1)

      window.dispatchEvent(new Event('resize'))
      expect(callback).toHaveBeenCalledTimes(2)

      cleanup()
      window.dispatchEvent(new Event('resize'))
      expect(callback).toHaveBeenCalledTimes(2)
    } finally {
      Object.defineProperty(globalThis, 'ResizeObserver', {
        configurable: true,
        writable: true,
        value: original,
      })
    }
  })
})
