import { describe, expect, it } from 'vitest'
import { normalizeSmartScriptName } from '@/utils/smartScriptOptions'

describe('smartScriptOptions', () => {
  it.each([
    ['电商广告', '电商广告'],
    ['信息电商智能脚本', '电商广告'],
    ['信息电商Skill', '电商广告'],
    ['本地生活广告', '本地生活广告'],
    ['本地生活智能脚本', '本地生活广告'],
    ['本地生活Skill', '本地生活广告'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeSmartScriptName(input)).toBe(expected)
  })
})
