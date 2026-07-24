import { describe, expect, it } from 'vitest'
import { isHotCopyTransientTaskRecoveryError } from '@/utils/hotCopyTaskRecovery'

describe('isHotCopyTransientTaskRecoveryError', () => {
  it('allows bounded recovery for network and service interruptions', () => {
    expect(isHotCopyTransientTaskRecoveryError({ status: 502, message: 'Bad Gateway' })).toBe(true)
    expect(isHotCopyTransientTaskRecoveryError({ status: 429, message: 'rate limited' })).toBe(true)
    expect(isHotCopyTransientTaskRecoveryError({ message: '网络请求失败' })).toBe(true)
  })

  it('does not restart another full polling cycle after the generation deadline', () => {
    expect(isHotCopyTransientTaskRecoveryError({ message: 'AI 任务生成超时，请稍后在历史记录中查看' })).toBe(false)
  })

  it('does not retry content-safety failures', () => {
    expect(isHotCopyTransientTaskRecoveryError({ status: 502, message: '生成内容未通过安全审核' })).toBe(false)
  })
})
