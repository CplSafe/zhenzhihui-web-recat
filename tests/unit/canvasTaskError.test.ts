import { describe, expect, it } from 'vitest'
import { humanizeCanvasTaskError } from '@/utils/canvasTaskError'

/**
 * 后端报错站在服务端视角写（「素材角色」这种概念用户根本看不到）。这类错误可能是素材本身不可用
 * （上传/入库未完成、类型不符），也可能是模型不收——所有模型都失败时多半是前者，故文案优先引导
 * 换素材、再兜底换模型，避免把用户往「换模型」死路上引。这里只改说法，不改判断。
 */
const ASSET_NOT_APPLICABLE = '该素材不适用于当前操作，请重新上传或更换素材后重试；也可尝试更换其他模型'

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

  it('其它错误原样返回，不掩盖真实原因', () => {
    expect(humanizeCanvasTaskError('积分不足')).toBe('积分不足')
    expect(humanizeCanvasTaskError('网络连接超时')).toBe('网络连接超时')
  })

  it('空值返回空串，交由调用方决定兜底文案', () => {
    expect(humanizeCanvasTaskError('')).toBe('')
    expect(humanizeCanvasTaskError(undefined)).toBe('')
    expect(humanizeCanvasTaskError(null)).toBe('')
  })
})
