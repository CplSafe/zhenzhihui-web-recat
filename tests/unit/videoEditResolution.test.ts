import { describe, expect, it } from 'vitest'
import { resolveVideoEditResolution } from '@/utils/videoEditResolution'

const modelWith = (options: string[]) => ({
  params_schema: { fields: [{ name: 'resolution', type: 'select', options }] },
})

describe('resolveVideoEditResolution', () => {
  it('2K 原片短边 1440 被阶梯表推成 1080p，模型没有该档时回到入口选的 2K', () => {
    expect(
      resolveVideoEditResolution({
        model: modelWith(['768P', '2K']),
        entryResolution: '2K',
        sourceWidth: 1440,
        sourceHeight: 2560,
      }),
    ).toBe('2K')
  })

  it('原片像素落在模型档位内时优先用像素反推，并沿用 schema 原始拼写', () => {
    expect(
      resolveVideoEditResolution({
        model: modelWith(['768P', '2K']),
        entryResolution: '2K',
        sourceWidth: 768,
        sourceHeight: 1366,
      }),
    ).toBe('768P')
  })

  it('入口值为空时靠像素反推兜底（旧草稿缺 resolution 的场景）', () => {
    expect(
      resolveVideoEditResolution({
        model: modelWith(['720p', '1080p']),
        entryResolution: '',
        sourceWidth: 1920,
        sourceHeight: 1080,
      }),
    ).toBe('1080p')
  })

  it('模型未声明分辨率档位时以入口值为准，缺入口值才用像素反推', () => {
    const model = { params_schema: { fields: [{ name: 'duration', type: 'select', options: ['5', '10'] }] } }
    expect(resolveVideoEditResolution({ model, entryResolution: '2K', sourceWidth: 1440, sourceHeight: 2560 })).toBe(
      '2K',
    )
    expect(resolveVideoEditResolution({ model, entryResolution: '', sourceWidth: 1920, sourceHeight: 1080 })).toBe(
      '1080p',
    )
  })

  it('两边都对不上时原样返回入口值，让下游用用户选的值报错而不是反推出来的值', () => {
    expect(
      resolveVideoEditResolution({
        model: modelWith(['480p']),
        entryResolution: '2K',
        sourceWidth: 1440,
        sourceHeight: 2560,
      }),
    ).toBe('2K')
  })

  it('兼容以 size 命名的分辨率字段', () => {
    const model = { params_schema: { fields: [{ name: 'size', type: 'select', options: ['720P', '1080P'] }] } }
    expect(resolveVideoEditResolution({ model, entryResolution: '', sourceWidth: 1080, sourceHeight: 1920 })).toBe(
      '1080P',
    )
  })
})
