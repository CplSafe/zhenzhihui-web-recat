import { describe, expect, it } from 'vitest'
import {
  buildSmartImageParamsFingerprint,
  createLockedSmartImageQuote,
  getSmartImageQuoteBindingError,
  getSmartImageQuoteValidationError,
} from '@/utils/smartImageQueueSafety'

const model = {
  model_version_id: 5102,
  operation_codes: ['image.image_to_image'],
  effect_type: 'reference-image',
  params_schema: {
    fields: [
      { name: 'size', options: ['2K', '3K'] },
      { name: 'watermark', default: false },
    ],
  },
}

const binding = {
  workspaceId: 21,
  operationCode: 'image.image_to_image' as const,
  modelVersionId: 5102,
  modelVersion: model,
  params: { size: '2K', watermark: false },
  batchSize: 3,
}

describe('smart image queue quote safety', () => {
  it('freezes workspace, model schema, params, batch price and balance in one quote', () => {
    const quote = createLockedSmartImageQuote({
      ...binding,
      perImageCost: 50,
      balance: 500,
      quotedAt: 1_700_000_000_000,
    })

    expect(quote).toMatchObject({
      workspaceId: 21,
      operationCode: 'image.image_to_image',
      modelVersionId: 5102,
      perImageCost: 50,
      batchTotalCost: 150,
      balanceAtQuote: 500,
      batchSize: 3,
      quotedAt: 1_700_000_000_000,
    })
    expect(quote.modelExecutionFingerprint).toContain('params_schema')
    expect(quote.paramsFingerprint).toBe('{"size":"2K","watermark":false}')
  })

  it('keeps params fingerprints stable across object key order', () => {
    expect(buildSmartImageParamsFingerprint({ size: '2K', nested: { b: 2, a: 1 } })).toBe(
      buildSmartImageParamsFingerprint({ nested: { a: 1, b: 2 }, size: '2K' }),
    )
  })

  it('rejects a restored message when workspace, model schema, params or batch size changed', () => {
    const quote = createLockedSmartImageQuote({
      ...binding,
      perImageCost: 50,
      balance: 500,
      quotedAt: 1_700_000_000_000,
    })

    expect(getSmartImageQuoteBindingError(quote, { ...binding, workspaceId: 22 })).toContain('工作空间')
    expect(
      getSmartImageQuoteBindingError(quote, {
        ...binding,
        modelVersion: {
          ...model,
          params_schema: { fields: [{ name: 'size', options: ['2K', '3K', '4K'] }] },
        },
      }),
    ).toContain('模型配置已变化')
    expect(getSmartImageQuoteBindingError(quote, { ...binding, params: { size: '3K', watermark: false } })).toContain(
      '生成参数已变化',
    )
    expect(getSmartImageQuoteBindingError(quote, { ...binding, batchSize: 2 })).toContain('生成数量已变化')
  })

  it('allows the next image only when the price is unchanged and balance covers every remaining item', () => {
    const quote = createLockedSmartImageQuote({
      ...binding,
      perImageCost: 50,
      balance: 500,
      quotedAt: 1_700_000_000_000,
    })

    expect(
      getSmartImageQuoteValidationError(quote, {
        ...binding,
        estimatedCost: 50,
        balance: 100,
        canAfford: true,
        remainingCount: 2,
      }),
    ).toBe('')
    expect(
      getSmartImageQuoteValidationError(quote, {
        ...binding,
        estimatedCost: 60,
        balance: 500,
        canAfford: true,
        remainingCount: 3,
      }),
    ).toContain('每张 50 积分变为 60 积分')
    expect(
      getSmartImageQuoteValidationError(quote, {
        ...binding,
        estimatedCost: 50,
        balance: 99,
        canAfford: true,
        remainingCount: 2,
      }),
    ).toContain('不足以完成剩余 2 张图片')
  })

  it('fails closed for legacy pending jobs without a quote or malformed quote metadata', () => {
    expect(
      getSmartImageQuoteValidationError(undefined, {
        ...binding,
        estimatedCost: 50,
        balance: 500,
        canAfford: true,
        remainingCount: 3,
      }),
    ).toContain('缺少用户已确认')

    const quote = createLockedSmartImageQuote({
      ...binding,
      perImageCost: 50,
      balance: 500,
      quotedAt: 1_700_000_000_000,
    })
    expect(
      getSmartImageQuoteValidationError(
        { ...quote, batchTotalCost: 149 },
        {
          ...binding,
          estimatedCost: 50,
          balance: 500,
          canAfford: true,
          remainingCount: 3,
        },
      ),
    ).toContain('报价无效')
  })
})
