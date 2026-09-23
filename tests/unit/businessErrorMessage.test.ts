import { describe, expect, it } from 'vitest'

import { BusinessApiError, getBusinessErrorMessage, humanizeProviderErrorText } from '@/api/business'

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

  it('火山账户/接入点/限流错误分别说明原因,不把英文原码暴露给用户', () => {
    // 以前这几种全翻成一句「AI 生成服务暂时不可用」，欠费和模型没开通分不清，用户只能一遍遍重试
    const overdue = new BusinessApiError('replicate analyze video: volcengine HTTP 403: AccountOverdueError', {
      response: { error_message: 'replicate analyze video: volcengine HTTP 403: AccountOverdueError' },
    })
    const endpoint = new BusinessApiError('volcengine HTTP 404: InvalidEndpointOrModel.NotFound', {
      response: { error_message: 'volcengine HTTP 404: InvalidEndpointOrModel.NotFound' },
    })
    const throttled = new BusinessApiError('volcengine HTTP 429: RateLimitExceeded', {
      response: { error_message: 'volcengine HTTP 429: RateLimitExceeded' },
    })
    expect(getBusinessErrorMessage(overdue)).toContain('账户已欠费或被停用')
    expect(getBusinessErrorMessage(endpoint)).toContain('未开通或接入配置有误')
    expect(getBusinessErrorMessage(throttled)).toContain('限流或配额已用完')
    // 英文原码/供应商名不得出现在给用户的文案里
    expect(getBusinessErrorMessage(overdue)).not.toMatch(/volcengine|AccountOverdue/i)
    expect(getBusinessErrorMessage(endpoint)).not.toMatch(/volcengine|InvalidEndpoint/i)
  })

  it('字符串路径也能翻出版权审核：任务轮询拿到的 error_message 不是 BusinessApiError', () => {
    const message = humanizeProviderErrorText(
      'The request failed because the output video may be related to copyright restrictions. Request id: 0217895',
    )
    expect(message).toContain('版权审核')
    expect(message).not.toMatch(/copyright|Request id/i)
  })

  it('参考视频时长超限：翻成中文范围并指出是第几个', () => {
    expect(humanizeProviderErrorText('content[1].video_url: media duration must be between 2 and 15 seconds')).toBe(
      '第 2 个参考视频的时长需要在 2–15 秒之间，请先裁剪或更换视频后重试',
    )
    expect(
      humanizeProviderErrorText('content[2].video_url: media duration must be between 2 and 15.5 seconds'),
    ).toContain('2–15.5 秒')
    expect(humanizeProviderErrorText('https://x.example/a.mp4?X=1 duration should be at most 15s, got 23.8s')).toBe(
      '参考视频最长 15 秒（当前 23.8 秒），请先裁剪到范围内后重试',
    )
  })

  it('参考图尺寸超限：把供应商英文范围翻成中文，并保留具体数值', () => {
    const error = new BusinessApiError('video generation failed', {
      response: {
        error_message: 'content[1].image_url: media dimensions must be between 256 and 5760 pixels',
      },
    })
    const message = getBusinessErrorMessage(error)
    // content[1] 从 0 起数，用户看到的是「第 2 张」
    expect(message).toBe('第 2 张参考图的宽和高都需要在 256–5760 像素之间，请调整图片尺寸后重试')
    expect(message).not.toMatch(/image_url|media dimensions/i)
  })

  it('参考图宽高比超限：翻成中文并指出是第几张', () => {
    const error = new BusinessApiError('video generation failed', {
      response: { error_message: 'content[3].image_url: media aspect ratio must be between 0.4 and 2.5' },
    })
    const message = getBusinessErrorMessage(error)
    expect(message).toBe('第 4 张参考图的宽高比需要在 0.4–2.5 之间（太窄或太扁的长条图不支持），请裁剪后重试')
    expect(message).not.toMatch(/aspect ratio|image_url/i)
  })

  it('供应商余额/计费异常：不把 402 与 insufficient_balance 原文暴露给用户，也不说成用户积分不足', () => {
    const metaso = new BusinessApiError('metaso HTTP 402 insufficient_balance_error', {
      response: { error_message: 'metaso HTTP 402 insufficient_balance_error' },
    })
    const google = new BusinessApiError('PROVIDER_FAILED', {
      code: 10502,
      response: { data: { error_message: 'Google image billing usage is missing for this project' } },
    })
    for (const error of [metaso, google]) {
      const message = getBusinessErrorMessage(error)
      expect(message).toContain('供应商账户余额或计费配置异常')
      expect(message).not.toMatch(/metaso|402|insufficient|billing/i)
      expect(message).not.toContain('积分不足')
    }
  })

  it('供应商任务失败无原因：给可执行的中文提示而不是 provider task failed 原文', () => {
    const error = new BusinessApiError('provider task failed with status failed', {
      response: { error_message: 'provider task failed with status failed' },
    })
    const message = getBusinessErrorMessage(error)
    expect(message).toContain('请稍后重试或换一个模型')
    expect(message).not.toMatch(/provider task failed/i)
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
