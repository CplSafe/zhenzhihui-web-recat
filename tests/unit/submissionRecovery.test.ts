import { describe, expect, it } from 'vitest'
import { isDefiniteSubmissionRejection } from '@/utils/submissionRecovery'

describe('提交结果恢复', () => {
  it('明确拒绝允许修改，结果不明保留原请求', () => {
    for (const status of [400, 401, 402, 403, 404, 422]) expect(isDefiniteSubmissionRejection({ status })).toBe(true)
    for (const status of [0, 200, 408, 409, 429, 500, 503])
      expect(isDefiniteSubmissionRejection({ status })).toBe(false)
    expect(isDefiniteSubmissionRejection(new Error('timeout'))).toBe(false)
  })
})
