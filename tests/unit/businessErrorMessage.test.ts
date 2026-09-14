import { describe, expect, it } from 'vitest'

import { BusinessApiError, getBusinessErrorMessage } from '@/api/business'

describe('getBusinessErrorMessage', () => {
  it('reads nested copyright review details and returns an actionable, non-accusatory message', () => {
    const error = new BusinessApiError('PROVIDER_FAILED', {
      code: 10502,
      response: {
        code_string: 'PROVIDER_FAILED',
        data: {
          error_message: 'Seedance safety review rejected: copyright / protected character',
        },
      },
    })

    const message = getBusinessErrorMessage(error)

    expect(message).toContain('可能包含受保护的品牌、角色')
    expect(message).toContain('自有或已获授权的素材')
    expect(message).not.toContain('已经侵权')
  })

  it('distinguishes portrait and privacy review failures from copyright failures', () => {
    const error = new BusinessApiError('PROVIDER_FAILED', {
      response: {
        data: {
          error_message: 'SensitiveContentDetected: real person face identity',
        },
      },
    })

    const message = getBusinessErrorMessage(error)

    expect(message).toContain('真人肖像、身份或隐私信息')
    expect(message).toContain('人物素材已获授权')
    expect(message).not.toContain('版权审核')
  })

  it('uses a generic content-safety message when the provider gives no narrower category', () => {
    const error = new BusinessApiError('生成失败', {
      response: { error_message: 'content policy violation during safety review' },
    })

    expect(getBusinessErrorMessage(error)).toBe(
      '提示词、参考素材或生成结果未通过模型服务商的内容安全审核。请调整敏感描述或更换参考素材后重试',
    )
  })

  it('keeps unrelated provider failures unchanged', () => {
    const error = new BusinessApiError('上游服务暂时不可用', {
      code: 'PROVIDER_FAILED',
    })

    expect(getBusinessErrorMessage(error)).toBe('上游服务暂时不可用')
  })

  it('将火山账户/接入点/服务级错误统一兜底,不把英文原码暴露给用户', () => {
    const expected = 'AI 生成服务暂时不可用，请稍后重试或联系管理员'
    const overdue = new BusinessApiError('replicate analyze video: volcengine HTTP 403: AccountOverdueError', {
      response: { error_message: 'replicate analyze video: volcengine HTTP 403: AccountOverdueError' },
    })
    const endpoint = new BusinessApiError('volcengine HTTP 404: InvalidEndpointOrModel.NotFound', {
      response: { error_message: 'volcengine HTTP 404: InvalidEndpointOrModel.NotFound' },
    })
    expect(getBusinessErrorMessage(overdue)).toBe(expected)
    expect(getBusinessErrorMessage(endpoint)).toBe(expected)
    // 英文原码/供应商名不得出现在给用户的文案里
    expect(getBusinessErrorMessage(overdue)).not.toMatch(/volcengine|AccountOverdue/i)
    expect(getBusinessErrorMessage(endpoint)).not.toMatch(/volcengine|InvalidEndpoint/i)
  })

  it('内容安全审核类错误优先于服务级兜底,保留更具体的可操作提示', () => {
    // 即便走的是同一个 provider,内容审核失败也要给出内容类提示,不能被「服务不可用」吞掉。
    const error = new BusinessApiError('volcengine HTTP 400: safety review rejected', {
      response: { error_message: 'volcengine content policy violation during safety review' },
    })
    expect(getBusinessErrorMessage(error)).toBe(
      '提示词、参考素材或生成结果未通过模型服务商的内容安全审核。请调整敏感描述或更换参考素材后重试',
    )
  })
})
