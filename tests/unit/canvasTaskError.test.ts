import { describe, expect, it } from 'vitest'
import { humanizeCanvasTaskError } from '@/utils/canvasTaskError'

/**
 * 后端报错站在服务端视角写（「素材角色」这种概念用户根本看不到），
 * 而用户实际能做的动作只有一个：换模型。这里只改说法，不改判断。
 */
describe('humanizeCanvasTaskError', () => {
  it('把「素材类型不适用于当前操作」改写成可执行的说法', () => {
    expect(humanizeCanvasTaskError('素材类型不适用于当前操作，请检查素材角色或更换素材后重试。')).toBe(
      '当前模型暂不支持该操作，请更换其他模型',
    )
  })

  it('同一类错误的其它措辞同样命中', () => {
    // 整句比对迟早会漏掉一种写法，用户就又看到那句原文了
    expect(humanizeCanvasTaskError('input asset role invalid: INVALID_MODEL_PARAMS')).toBe(
      '当前模型暂不支持该操作，请更换其他模型',
    )
    expect(humanizeCanvasTaskError('素材角色不被支持')).toBe('当前模型暂不支持该操作，请更换其他模型')
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
