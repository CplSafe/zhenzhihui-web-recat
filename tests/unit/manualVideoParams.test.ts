import { describe, expect, it } from 'vitest'
import { getManualDurationSpec, getManualParamOptions } from '@/utils/manualVideoParams'

describe('人工视频模型参数', () => {
  it('在模型范围内选择精制时长档位', () => {
    const model = { params_schema: { fields: [{ name: 'duration', min: 20, max: 90, default: 40 }] } }
    const spec = getManualDurationSpec(model)
    expect([spec.min, spec.max, spec.fallback]).toEqual([20, 90, 30])
    expect(spec.options).toEqual([30, 45, 60])
    expect(spec.valid(47)).toBe(false)
    expect(spec.valid(19)).toBe(false)
    expect(spec.valid(47.5)).toBe(false)
  })

  it('枚举仅允许模型声明的值，并读取模型比例', () => {
    const model = {
      params_schema: { properties: { duration: { enum: [30, 60], default: 60 }, ratio: { enum: ['9:16'] } } },
    }
    const spec = getManualDurationSpec(model)
    expect(spec.options).toEqual([30, 60])
    expect(spec.valid(45)).toBe(false)
    expect(spec.fallback).toBe(60)
    expect(getManualParamOptions(model, 'ratio')).toEqual(['9:16'])
  })
})
