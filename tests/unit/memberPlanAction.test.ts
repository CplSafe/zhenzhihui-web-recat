import { describe, expect, it } from 'vitest'
import { memberPlanRank, resolveMemberPlanAction } from '@/utils/memberPlanAction'

describe('member plan actions', () => {
  it.each([
    [true, true, true, 2, 2, '续费', false, 'subscribe'],
    [false, true, true, null, null, '续费', false, 'subscribe'],
    [false, false, true, 2, 1, '重新开通', false, 'subscribe'],
    [false, false, false, null, null, '开通', false, 'subscribe'],
    [true, false, true, 2, 1, '不可降级', true, 'upgrade'],
    [true, false, true, 2, 3, '购买', false, 'upgrade'],
    [true, false, true, 2, 2, '购买', false, 'upgrade'],
    [true, false, true, null, 3, '购买', false, 'upgrade'],
    [true, false, true, 2, null, '购买', false, 'upgrade'],
    [true, false, true, null, null, '购买', false, 'upgrade'],
    [true, false, true, 1, 0, '不可降级', true, 'upgrade'],
  ])(
    'active=%s purchased=%s history=%s rank=%s→%s',
    (active, purchased, hasHistory, currentRank, targetRank, text, disabled, intent) => {
      expect(resolveMemberPlanAction({ active, purchased, hasHistory, currentRank, targetRank })).toMatchObject({
        text,
        disabled,
        intent,
      })
    },
  )
  it.each([
    [undefined, null],
    [null, null],
    ['', null],
    [-1, null],
    ['bad', null],
    [Infinity, null],
    [0, 0],
    ['3', 3],
  ])('normalizes rank %s', (input, expected) => {
    expect(memberPlanRank(input)).toBe(expected)
  })
})
