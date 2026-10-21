import { expect, it } from 'vitest'
import { hasActiveVideoUpscale, upscaleDisplayFields, upscaleImageSize } from '@/utils/canvasUpscale'

it('阻止同模型在途超分，排除自身、其他模型和历史失败', () => {
  const node = {
    id: 'upscale',
    data: { operationCode: 'video.upscale', modelVersionId: 8, taskId: 12, taskStatus: 'running' },
  }
  expect(hasActiveVideoUpscale([node], 8)).toBe(true)
  expect(hasActiveVideoUpscale([node], 9)).toBe(false)
  expect(hasActiveVideoUpscale([node], 8, 'upscale')).toBe(false)
  expect(hasActiveVideoUpscale([{ ...node, data: { ...node.data, taskStatus: 'failed' } }], 8)).toBe(false)
  expect(hasActiveVideoUpscale([{ ...node, data: { ...node.data, taskId: 0 } }], 8)).toBe(false)
  expect(
    hasActiveVideoUpscale([{ ...node, data: { ...node.data, taskId: 0 } }], 8, undefined, new Set(['upscale'])),
  ).toBe(true)
})

it('增强策略显示中文，保留后端英文值和倍率约束', () => {
  const fields = [
    { name: 'generative_enhance_mode', type: 'string', options: ['generative_first', 'fidelity_first', 'future_mode'] },
    { name: 'multiple', type: 'number', min: 1, max: 4, step: 0.25, options: [1, 2, 4] },
    { name: 'target_width', type: 'integer' },
    { name: 'target_height', type: 'integer' },
    { name: 'resolution', type: 'string', options: ['1080p'] },
  ]
  const display = upscaleDisplayFields(fields)
  expect(display[0].options).toEqual([
    { value: 'generative_first', label: '细节增强优先' },
    { value: 'fidelity_first', label: '保真优先' },
    { value: 'future_mode', label: 'future_mode' },
  ])
  expect(display[1]).toMatchObject({ min: 1, max: 4, step: 0.25, display_name: '放大倍率（倍）' })
  expect(display[1].options).toContainEqual({ value: 2, label: '2 倍' })
  expect(display[2].display_name).toBe('目标宽度（像素）')
  expect(display[3].display_name).toBe('目标高度（像素）')
  expect(display[4]).toEqual(fields[4])
  expect(fields[0].options[0]).toBe('generative_first')
})

it.each([
  [{ multiple: 1 }, { width: 1024, height: 768 }],
  [{ multiple: 2 }, { width: 2048, height: 1536 }],
  [{ multiple: 2.5 }, { width: 2560, height: 1920 }],
  [
    { multiple: 2, target_width: 100, target_height: 100 },
    { width: 2048, height: 1536 },
  ],
  [{ target_width: 2048 }, { width: 2048, height: 1536 }],
  [{ target_height: 1536 }, { width: 2048, height: 1536 }],
  [
    { target_width: 2000, target_height: 1000 },
    { width: 2000, height: 1000 },
  ],
  [{}, null],
])('根据原图与参数估算输出：%j', (params, output) => {
  expect(upscaleImageSize(1024, 768, params)).toEqual(output)
})

it('未知原图尺寸不猜测输出大小，数值输入标明倍数单位', () => {
  expect(upscaleImageSize(0, 0, { multiple: 2 })).toBeNull()
  expect(upscaleDisplayFields([{ name: 'multiple', type: 'number' }])[0].display_name).toBe('放大倍率（倍）')
})
