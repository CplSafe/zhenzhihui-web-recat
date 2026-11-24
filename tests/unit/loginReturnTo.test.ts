import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearOAuthLoginReturnTo,
  consumeOAuthLoginReturnTo,
  keepOAuthLoginReturnTo,
  readLoginReturnTo,
  sanitizeLoginReturnTo,
} from '@/utils/loginReturnTo'

describe('sanitizeLoginReturnTo', () => {
  it('accepts in-app paths with search and hash', () => {
    expect(sanitizeLoginReturnTo('/projects/12/videos?x=1#top')).toBe('/projects/12/videos?x=1#top')
    expect(sanitizeLoginReturnTo('/smart/90000')).toBe('/smart/90000')
  })

  it('rejects anything that could leave the site', () => {
    expect(sanitizeLoginReturnTo('//evil.example/phish')).toBe('')
    expect(sanitizeLoginReturnTo('/\\evil.example')).toBe('')
    expect(sanitizeLoginReturnTo('https://evil.example')).toBe('')
    expect(sanitizeLoginReturnTo('javascript:alert(1)')).toBe('')
    expect(sanitizeLoginReturnTo('/foo\nbar')).toBe('')
    expect(sanitizeLoginReturnTo('/\t\\evil.example')).toBe('')
    expect(sanitizeLoginReturnTo('/safe/..//evil.example')).toBe('')
  })

  it('rejects the login/welcome pages themselves to avoid a redirect loop', () => {
    expect(sanitizeLoginReturnTo('/login')).toBe('')
    expect(sanitizeLoginReturnTo('/login/?invite_code=x')).toBe('')
    expect(sanitizeLoginReturnTo('/safe/../login')).toBe('')
    expect(sanitizeLoginReturnTo('/welcome')).toBe('')
    expect(sanitizeLoginReturnTo('/')).toBe('')
  })

  it('rejects non-string values', () => {
    expect(sanitizeLoginReturnTo(undefined)).toBe('')
    expect(sanitizeLoginReturnTo(42)).toBe('')
    expect(sanitizeLoginReturnTo({ toString: () => '/home' })).toBe('')
  })
})

describe('full-page OAuth return target', () => {
  beforeEach(() => window.sessionStorage.clear())
  afterEach(() => {
    window.sessionStorage.clear()
    vi.useRealTimers()
  })

  it('restores the complete target once after navigation in the same tab', () => {
    keepOAuthLoginReturnTo('/projects/12/videos?filter=mine#selected')

    expect(consumeOAuthLoginReturnTo()).toBe('/projects/12/videos?filter=mine#selected')
    expect(consumeOAuthLoginReturnTo()).toBe('')
  })

  it('drops stale or explicitly cleared targets', () => {
    vi.useFakeTimers()
    keepOAuthLoginReturnTo('/canvas/3')
    vi.advanceTimersByTime(5 * 60 * 1000)
    expect(consumeOAuthLoginReturnTo()).toBe('')

    keepOAuthLoginReturnTo('/canvas/3')
    clearOAuthLoginReturnTo()
    expect(consumeOAuthLoginReturnTo()).toBe('')
  })

  it('clears an older target when a new attempt has no safe return path', () => {
    keepOAuthLoginReturnTo('/canvas/3')
    keepOAuthLoginReturnTo('//another-origin.test')

    expect(consumeOAuthLoginReturnTo()).toBe('')
  })
})

describe('readLoginReturnTo', () => {
  it('reads returnTo from router state and tolerates missing state', () => {
    expect(readLoginReturnTo({ returnTo: '/canvas/3' })).toBe('/canvas/3')
    expect(readLoginReturnTo(null)).toBe('')
    expect(readLoginReturnTo({ returnTo: '//x' })).toBe('')
  })
})
