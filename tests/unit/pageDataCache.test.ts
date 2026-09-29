import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearPageCache, pageCacheKey, readPageCache, writePageCache } from '@/utils/pageDataCache'

describe('pageDataCache', () => {
  afterEach(() => {
    vi.useRealTimers()
    clearPageCache()
  })

  it('isolates entries by page, workspace and user', () => {
    writePageCache(pageCacheKey('projects', 7, 9), ['mine'])
    expect(readPageCache(pageCacheKey('projects', 7, 9))).toEqual(['mine'])
    expect(readPageCache(pageCacheKey('projects', 8, 9))).toBeUndefined()
    expect(readPageCache(pageCacheKey('projects', 7, 10))).toBeUndefined()
    expect(readPageCache(pageCacheKey('canvas-list', 7, 9))).toBeUndefined()
  })

  it('drops entries older than ten minutes so expired signed URLs are never rendered', () => {
    vi.useFakeTimers()
    writePageCache('k', 1)
    vi.advanceTimersByTime(9 * 60_000)
    expect(readPageCache('k')).toBe(1)
    vi.advanceTimersByTime(2 * 60_000)
    expect(readPageCache('k')).toBeUndefined()
  })

  it('never touches web storage', () => {
    writePageCache('k', { url: 'https://signed.example/a?sig=1' })
    expect(window.sessionStorage.length).toBe(0)
    expect(window.localStorage.length).toBe(0)
  })

  it('clears everything on logout', () => {
    writePageCache('a', 1)
    clearPageCache()
    expect(readPageCache('a')).toBeUndefined()
  })
})
