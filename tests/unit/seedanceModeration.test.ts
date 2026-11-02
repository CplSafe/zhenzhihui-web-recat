import { describe, expect, it } from 'vitest'
import { normalizeSeedanceModerationResult } from '@/utils/seedanceModeration'

describe('Seedance certification status', () => {
  it.each(['active', ' ACTIVE '])('only %s certifies the asset', (status) => {
    expect(normalizeSeedanceModerationResult({ data: { status } }).state).toBe('approved')
  })

  it.each(['approved', 'passed', 'pass', 'rejected', 'inactive', 'failed', 'unexpected'])(
    '%s is not a successful certification, even with legacy success flags',
    (status) => {
      expect(normalizeSeedanceModerationResult({ status, approved: true, passed: true }).state).toBe('rejected')
    },
  )

  it.each(['pending', 'processing', 'queued', 'reviewing'])('waits for ongoing %s', (status) => {
    expect(normalizeSeedanceModerationResult({ review_status: status }).state).toBe('pending')
  })

  it.each([null, {}, { data: { status: 'unreviewed' } }])('allows first-time submission for %j', (payload) => {
    expect(normalizeSeedanceModerationResult(payload).state).toBe('unreviewed')
  })

  it('preserves rejection reasons and accepts the existing response field variants', () => {
    expect(normalizeSeedanceModerationResult({ moderation_status: 'failed', reject_reason: ' 不符合要求 ' })).toEqual({
      state: 'rejected',
      rawStatus: 'failed',
      reason: '不符合要求',
    })
    expect(normalizeSeedanceModerationResult({ state: 'active' }).state).toBe('approved')
    expect(normalizeSeedanceModerationResult({ result_status: 'active' }).state).toBe('approved')
    expect(normalizeSeedanceModerationResult({ result: 'active' }).state).toBe('approved')
  })
})
