import { describe, expect, it } from 'vitest'
import { humanizeCanvasTaskError, isCanvasProviderServiceError } from '@/utils/canvasTaskError'

/**
 * 后端报错站在服务端视角写（「素材角色」这种概念用户根本看不到）。这类错误可能是素材本身不可用
 * （上传/入库未完成、类型不符），也可能是模型不收——所有模型都失败时多半是前者，故文案优先引导
 * 换素材、再兜底换模型，避免把用户往「换模型」死路上引。这里只改说法，不改判断。
 */
const ASSET_NOT_APPLICABLE = '该素材不适用于当前操作，请重新上传或更换素材后重试；也可尝试更换其他模型'
const PROVIDER_UNAVAILABLE = '该模型的服务商暂时不可用（计费未配置或额度/接入异常），请更换其他模型后重试，或联系管理员'

describe('humanizeCanvasTaskError', () => {
  it('把「素材类型不适用于当前操作」改写成可执行的说法', () => {
    expect(humanizeCanvasTaskError('素材类型不适用于当前操作，请检查素材角色或更换素材后重试。')).toBe(
      ASSET_NOT_APPLICABLE,
    )
  })

  it('同一类错误的其它措辞同样命中', () => {
    // 整句比对迟早会漏掉一种写法，用户就又看到那句原文了
    expect(humanizeCanvasTaskError('input asset role invalid: INVALID_MODEL_PARAMS')).toBe(ASSET_NOT_APPLICABLE)
    expect(humanizeCanvasTaskError('素材角色不被支持')).toBe(ASSET_NOT_APPLICABLE)
  })

  it('供应商账户/计费/接入类服务级失败改写成「换模型/联系管理员」，不甩英文原码', () => {
    // Google 图片计费缺失（PROVIDER_FAILED 10502）
    expect(humanizeCanvasTaskError('Google image billing usage is missing or inconsistent')).toBe(PROVIDER_UNAVAILABLE)
    expect(humanizeCanvasTaskError('PROVIDER_FAILED')).toBe(PROVIDER_UNAVAILABLE)
    // 火山账号欠费 / 接入点失效
    expect(humanizeCanvasTaskError('AccountOverdueError: account is overdue')).toBe(PROVIDER_UNAVAILABLE)
    expect(humanizeCanvasTaskError('InvalidEndpointOrModel.NotFound')).toBe(PROVIDER_UNAVAILABLE)
  })

  it('画布自己没规则的供应商原文交给全链路共用的翻译（参考图宽高比 / provider task failed）', () => {
    expect(humanizeCanvasTaskError('content[3].image_url: media aspect ratio must be between 0.4 and 2.5')).toBe(
      '第 4 张参考图的宽高比需要在 0.4–2.5 之间（太窄或太扁的长条图不支持），请裁剪后重试',
    )
    expect(humanizeCanvasTaskError('provider task failed with status failed')).not.toMatch(/provider task failed/i)
  })

  it('其它错误原样返回，不掩盖真实原因', () => {
    // 用户自己积分不足是可自行处理的，绝不能被供应商服务级文案吞掉
    expect(humanizeCanvasTaskError('积分不足')).toBe('积分不足')
    expect(humanizeCanvasTaskError('网络连接超时')).toBe('网络连接超时')
  })

  it('空值返回空串，交由调用方决定兜底文案', () => {
    expect(humanizeCanvasTaskError('')).toBe('')
    expect(humanizeCanvasTaskError(undefined)).toBe('')
    expect(humanizeCanvasTaskError(null)).toBe('')
  })
})

describe('isCanvasProviderServiceError', () => {
  it('识别供应商服务级失败（供轮询侧把这类 throw 落成终态失败而非无限重试）', () => {
    expect(isCanvasProviderServiceError('Google image billing usage is missing or inconsistent')).toBe(true)
    expect(isCanvasProviderServiceError('PROVIDER_FAILED')).toBe(true)
    expect(isCanvasProviderServiceError('AccountOverdueError')).toBe(true)
    expect(isCanvasProviderServiceError('InvalidEndpointOrModel.NotFound')).toBe(true)
  })

  it('普通网络/未知错误不算，交由既有的查询重试逻辑处理', () => {
    expect(isCanvasProviderServiceError('Failed to fetch')).toBe(false)
    expect(isCanvasProviderServiceError('网络连接超时')).toBe(false)
    expect(isCanvasProviderServiceError('')).toBe(false)
    expect(isCanvasProviderServiceError(undefined)).toBe(false)
  })
})
