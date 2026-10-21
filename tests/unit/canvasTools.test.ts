import { describe, expect, it, vi } from 'vitest'
import type { CreativeTool, ToolField } from '@/api/canvasTools'
import {
  activeToolParams,
  buildToolGeneration,
  fieldOptions,
  fieldVisible,
  schemaDefaults,
  validateToolFields,
} from '@/utils/canvasTools'
import { pickPersistedNodeData } from '@/utils/canvasElements'
const request = vi.hoisted(() => vi.fn())
vi.mock('@/api/business', () => ({ requestBusinessJson: request }))
import { listCanvasTools } from '@/api/canvasTools'

const fields: ToolField[] = [
  { name: 'mode', type: 'select', default: 'manual', options: ['manual', 'smart', 'reference'], required: true },
  { name: 'brightness', type: 'integer', min: 0, max: 100, default: 50, visible_when: { mode: ['manual'] } },
  { name: 'preset', type: 'select', options: ['soft', 'studio'], visible_when: { mode: ['smart'] } },
]
const tool: CreativeTool = {
  code: 'image.relight',
  display_name: '打光',
  execution: 'prompt_workflow',
  version: 1,
  operation_code: 'image.image_to_image',
  model_version_ids: [42],
  params_schema: { fields },
}
const input = {
  tool,
  modelId: 42,
  prompt: '',
  values: schemaDefaults(fields),
  modelFields: [{ name: 'count', type: 'integer', default: 1 }],
  modelValues: { count: 1 },
  assetIds: [501],
}

describe('canvas tools backend contract', () => {
  it('loads the workspace-scoped catalog, preserves versions and rejects invalid responses', async () => {
    const signal = new AbortController().signal
    request.mockResolvedValueOnce([null, {}, tool])
    expect(await listCanvasTools(21, signal)).toEqual([tool])
    expect(request).toHaveBeenCalledWith('/api/v1/ai/tools?workspace_id=21', { signal })
    await expect(listCanvasTools(0)).rejects.toThrow('工作空间')
    request.mockResolvedValueOnce({})
    await expect(listCanvasTools(21)).rejects.toThrow('格式')
  })
  it('keeps tool version separate from the operation, preserves false/zero, and sends exact ordered input references', () => {
    const result = buildToolGeneration(input)
    expect(result).toEqual({
      kind: 'image',
      prompt: '请按工具参数处理参考图片。',
      modelVersionId: 42,
      operationCode: 'image.image_to_image',
      params: { count: 1, tool: 'image.relight', tool_version: 1, tool_params: { mode: 'manual', brightness: 50 } },
      inputAssets: [{ asset_id: 501, role: 'reference_image' }],
    })
    const angle = buildToolGeneration({
      ...input,
      tool: {
        ...tool,
        code: 'image.multi_angle',
        version: 2,
        min_input_images: 1,
        max_input_images: 1,
        params_schema: {
          fields: [
            { name: 'horizontal_angle', type: 'number' },
            { name: 'watermark', type: 'boolean' },
          ],
        },
      },
      values: { horizontal_angle: 0, watermark: false },
      prompt: ' test ',
    })
    expect(angle.params).toMatchObject({ tool_version: 2, tool_params: { horizontal_angle: 0, watermark: false } })
    expect(angle.prompt).toContain('test')
    expect(angle.prompt).toContain('不要用平移裁切')
  })
  it('drops hidden fields on smart/reference modes and requires two different reference images', () => {
    const values = { mode: 'reference', brightness: 99, preset: 'studio' }
    expect(buildToolGeneration({ ...input, values, assetIds: [501, 502] }).params.tool_params).toEqual({
      mode: 'reference',
    })
    expect(
      buildToolGeneration({ ...input, values: { mode: 'smart', brightness: 99, preset: 'soft' } }).params.tool_params,
    ).toEqual({ mode: 'smart', preset: 'soft' })
    expect(() => buildToolGeneration({ ...input, values })).toThrow('2 张')
    expect(() => buildToolGeneration({ ...input, values, assetIds: [501, 501] })).toThrow('不同')
    expect(() => buildToolGeneration({ ...input, assetIds: [0] })).toThrow('上传')
    expect(() => buildToolGeneration({ ...input, assetIds: [501, 502] })).toThrow('1 张')
  })
  it('blocks unavailable models, browser execution, unsupported operations, and invalid values', () => {
    expect(() => buildToolGeneration({ ...input, modelId: 99 })).toThrow('可用')
    expect(() => buildToolGeneration({ ...input, tool: { ...tool, execution: 'browser' } })).toThrow('生成任务')
    expect(() => buildToolGeneration({ ...input, tool: { ...tool, operation_code: '' } })).toThrow('生成任务')
    expect(() => buildToolGeneration({ ...input, values: { mode: 'manual', brightness: 101 } })).toThrow('范围')
    expect(() =>
      buildToolGeneration({
        ...input,
        modelFields: [{ name: 'count', type: 'integer', min: 1 }],
        modelValues: { count: 0 },
      }),
    ).toThrow('范围')
  })
  it('validates required fields, options, numeric types and integers against the schema', () => {
    expect(validateToolFields(fields, {})).toContain('mode')
    expect(validateToolFields(fields, { mode: 'bad' })).toContain('选项')
    for (const brightness of [NaN, '5', 1.2])
      expect(validateToolFields(fields, { mode: 'manual', brightness })).toContain('无效')
    expect(validateToolFields(fields, { mode: 'manual', brightness: -1 })).toContain('范围')
    expect(validateToolFields(fields, { mode: 'smart', brightness: -10 })).toBeNull()
    expect(validateToolFields([{ name: 'prompt', type: 'string' }], {})).toBeNull()
    expect(validateToolFields([{ name: 'prompt', type: 'string', required: true }], { prompt: '' })).toContain('填写')
    expect(fieldVisible({ name: 'a', type: 'number' }, {})).toBe(true)
    expect(activeToolParams([{ name: 'a', type: 'string' }], { a: undefined, other: 1 })).toEqual({})
  })
  it('supports primitive and named schema choices and persists panorama view without preview URLs', () => {
    expect(
      fieldOptions({
        name: 'p',
        type: 'select',
        options: ['a', 2, { value: 'b', label: 'B' }, { value: 'c', display_name: 'C' }, { value: 'd' }],
      }),
    ).toEqual([
      { value: 'a', label: 'a' },
      { value: 2, label: '2' },
      { value: 'b', label: 'B' },
      { value: 'c', label: 'C' },
      { value: 'd', label: 'd' },
    ])
    expect(fieldOptions({ name: 'a', type: 'number' })).toEqual([])
    expect(
      pickPersistedNodeData({ assetId: 501, panoramaView: { yaw: 90, pitch: 10, fov: 60 }, preview: 'signed' }),
    ).toEqual({ assetId: 501, panoramaView: { yaw: 90, pitch: 10, fov: 60 } })
  })
})
