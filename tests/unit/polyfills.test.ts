import { afterEach, describe, expect, it, vi } from 'vitest'

const originalAllSettled = Promise.allSettled

afterEach(() => {
  Object.defineProperty(Promise, 'allSettled', {
    configurable: true,
    writable: true,
    value: originalAllSettled,
  })
})

describe('legacy runtime polyfills', () => {
  it('installs Promise.allSettled when the browser does not provide it', async () => {
    Object.defineProperty(Promise, 'allSettled', {
      configurable: true,
      writable: true,
      value: undefined,
    })
    vi.resetModules()

    await import('@/polyfills')

    await expect(Promise.allSettled([Promise.resolve('ok'), Promise.reject(new Error('failed'))])).resolves.toEqual([
      { status: 'fulfilled', value: 'ok' },
      { status: 'rejected', reason: new Error('failed') },
    ])
  })
})
