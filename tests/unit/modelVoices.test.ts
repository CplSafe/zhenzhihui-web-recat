import { describe, expect, it } from 'vitest'
import { getModelVoiceOptions, isModelVoiceField } from '@/utils/modelVoices'

describe('模型音色目录', () => {
  it('保留编号类型并使用后端名称，不生成前端音色编号', () => {
    expect(
      getModelVoiceOptions({
        name: 'speaker',
        options: [
          { value: 7, label: '沉稳旁白' },
          { value: '7', title: '清亮旁白' },
        ],
      }),
    ).toEqual([
      { value: 7, label: '沉稳旁白' },
      { value: '7', label: '清亮旁白' },
    ])
  })
  it('支持枚举、对象映射和 oneOf，忽略不支持的复合值', () => {
    expect(getModelVoiceOptions({ name: 'speaker', enum: ['a', 0, false, {}] })).toEqual([
      { value: 'a', label: 'a' },
      { value: 0, label: '0' },
    ])
    expect(getModelVoiceOptions({ name: 'voice', options: { a: '中文女声', b: { label: '中文男声' } } })).toEqual([
      { value: 'a', label: '中文女声' },
      { value: 'b', label: '中文男声' },
    ])
    expect(getModelVoiceOptions({ name: 'voice_id', oneOf: [{ const: 9, title: '旁白' }] })).toEqual([
      { value: 9, label: '旁白' },
    ])
    expect(getModelVoiceOptions({ name: 'voice_id' })).toEqual([])
  })
  it('只识别音色字段，不接管其他模型参数', () => {
    expect(['speaker', 'voice', 'voice_id'].every((name) => isModelVoiceField({ name }))).toBe(true)
    expect(isModelVoiceField({ name: 'speech_rate' })).toBe(false)
  })
})
