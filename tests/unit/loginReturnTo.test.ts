import { describe, expect, it } from 'vitest'
import { readLoginReturnTo, sanitizeLoginReturnTo } from '@/utils/loginReturnTo'

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
  })

  it('rejects the login/welcome pages themselves to avoid a redirect loop', () => {
    expect(sanitizeLoginReturnTo('/login')).toBe('')
    expect(sanitizeLoginReturnTo('/login/?invite_code=x')).toBe('')
    expect(sanitizeLoginReturnTo('/welcome')).toBe('')
    expect(sanitizeLoginReturnTo('/')).toBe('')
  })

  it('rejects non-string values', () => {
    expect(sanitizeLoginReturnTo(undefined)).toBe('')
    expect(sanitizeLoginReturnTo(42)).toBe('')
    expect(sanitizeLoginReturnTo({ toString: () => '/home' })).toBe('')
  })
})

describe('readLoginReturnTo', () => {
  it('reads returnTo from router state and tolerates missing state', () => {
    expect(readLoginReturnTo({ returnTo: '/canvas/3' })).toBe('/canvas/3')
    expect(readLoginReturnTo(null)).toBe('')
    expect(readLoginReturnTo({ returnTo: '//x' })).toBe('')
  })
})
