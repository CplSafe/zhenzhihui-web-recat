import { describe, expect, it } from 'vitest'
import { upscaleFields } from '@/components/canvas/CanvasUpscale'
import { activeToolParams } from '@/utils/canvasTools'

describe('超分参数目录', () => {
  it('不为未声明参数的模型添加分辨率或帧率', () => {
    expect(upscaleFields({ id: 1 }, 'image.upscale')).toEqual([])
    expect(upscaleFields({ id: 1, params_schema: 'invalid' }, 'image.upscale')).toEqual([])
  })
  it('按当前操作过滤字段并保留后端选项', () => {
    const multiple = { name: 'multiple', type: 'integer', options: [2, 4] }
    const fields = upscaleFields(
      {
        id: 1,
        params_schema: JSON.stringify({
          fields: [
            multiple,
            { name: 'fps', type: 'integer', operation_codes: ['video.upscale'] },
            { name: 'input_assets', type: 'array' },
          ],
        }),
      },
      'image.upscale',
    )
    expect(fields).toEqual([multiple])
    expect(activeToolParams(fields, { multiple: 2, fps: 60, resolution: '4k' })).toEqual({ multiple: 2 })
  })
  it('条件隐藏的字段不提交', () => {
    const fields = upscaleFields(
      { id: 1, params_schema: { fields: [{ name: 'fps', type: 'integer', visible_when: { interpolate: [true] } }] } },
      'video.upscale',
    )
    expect(activeToolParams(fields, { interpolate: false, fps: 60 })).toEqual({})
  })
})
