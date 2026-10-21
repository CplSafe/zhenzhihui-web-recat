import { describe, expect, it } from 'vitest'
import {
  composeStudioPrompt,
  panoramaModelDefaults,
  studioLightDirection,
  studioLightPosition,
  studioLightVector,
  wrapStudioAngle,
  hasPanoramaFrame,
  studioCaptureSize,
} from '@/utils/canvasStudioControls'
import { buildToolGeneration } from '@/utils/canvasTools'

describe('continuous studio controls', () => {
  it('limits export allocation to the advertised output sizes, including restored view state', () => {
    expect(studioCaptureSize({})).toEqual([1920, 1080])
    expect(studioCaptureSize({ capture_width: 1080, capture_height: 1920 })).toEqual([1080, 1920])
    expect(studioCaptureSize({ capture_width: 1536, capture_height: 1536 })).toEqual([1536, 1536])
    expect(studioCaptureSize({ capture_width: 1e10, capture_height: -1 })).toEqual([1920, 1080])
  })
  it('warns about obvious circular black corners without rejecting dark scenes or unknown pixels', () => {
    expect(hasPanoramaFrame([], 8, 8)).toBe(false)
    expect(hasPanoramaFrame([], 0, 0)).toBe(false)
    const data = new Uint8ClampedArray(8 * 8 * 4).fill(255)
    expect(hasPanoramaFrame(data, 8, 8)).toBe(false)
    for (const [x, y] of [
      [1, 1],
      [6, 1],
      [1, 6],
      [6, 6],
    ]) {
      const i = (y * 8 + x) * 4
      data[i] = data[i + 1] = data[i + 2] = 0
    }
    expect(hasPanoramaFrame(data, 8, 8)).toBe(true)
    expect(hasPanoramaFrame(new Uint8ClampedArray(8 * 8 * 4), 8, 8)).toBe(false)
  })
  it('preserves all azimuths, wraps at the seam and provides real continuous light vectors', () => {
    expect(wrapStudioAngle(-1)).toBe(359)
    expect(wrapStudioAngle(720)).toBe(0)
    const vector = studioLightVector(45, 30)
    expect(vector[0]).toBeCloseTo(Math.sqrt(3 / 8))
    expect(vector[1]).toBeCloseTo(0.5)
    expect(vector[2]).toBeCloseTo(vector[0])
    expect(studioLightVector(180, 0)[2]).toBeCloseTo(-1)
    expect(studioLightVector(270, 0)[0]).toBeCloseTo(-1)
    expect(studioLightVector(0, 100)[1]).toBeLessThan(1)
  })
  it('maps only the v1 base direction to supported enums while retaining exact angles in the prompt', () => {
    expect(studioLightDirection(359, 0)).toBe('front')
    expect(studioLightDirection(82, 12)).toBe('right')
    expect(studioLightDirection(182, 0)).toBe('back')
    expect(studioLightDirection(270, 0)).toBe('left')
    expect(studioLightDirection(0, 70)).toBe('top')
    expect(studioLightDirection(0, -70)).toBe('bottom')
    expect(studioLightPosition('left')).toEqual({ light_azimuth: 270, light_elevation: 0 })
    expect(studioLightPosition('unknown')).toEqual(studioLightPosition('front'))
    const request = buildToolGeneration({
      tool: {
        code: 'image.relight',
        display_name: '打光',
        version: 1,
        execution: 'prompt_workflow',
        operation_code: 'image.image_to_image',
        model_version_ids: [42],
        params_schema: {
          fields: [
            { name: 'mode', type: 'select' },
            { name: 'key_light', type: 'select' },
          ],
        },
      },
      modelId: 42,
      prompt: '暖色摄影棚',
      values: { mode: 'manual', key_light: 'right', light_azimuth: 82, light_elevation: 12 },
      modelFields: [],
      modelValues: {},
      assetIds: [501],
    })
    expect(request.prompt).toContain('82°')
    expect(request.prompt).toContain('12°')
    expect(request.prompt).toContain('暖色摄影棚')
    expect(request.params).toEqual({
      tool: 'image.relight',
      tool_version: 1,
      tool_params: { mode: 'manual', key_light: 'right' },
    })
  })
  it('does not leak manual lighting instructions into smart or reference modes', () => {
    for (const mode of ['smart', 'reference'])
      expect(
        composeStudioPrompt('image.relight', ' cinematic ', { mode, light_azimuth: 80, light_elevation: 20 }),
      ).toBe('cinematic')
    expect(composeStudioPrompt('image.relight', '', { mode: 'manual' })).toBe('')
    expect(composeStudioPrompt('other', ' test ', {})).toBe('test')
  })
  it('requires complete equirectangular coverage without instructing a fisheye crop', () => {
    const prompt = composeStudioPrompt('image.panorama', '花田', {})
    for (const text of ['等距柱状', '左右边缘无缝', '天顶和地面', '不要鱼眼', '人物仅出现一次', '花田'])
      expect(prompt).toContain(text)
    expect(composeStudioPrompt('image.multi_angle', '', {})).toContain('不要用平移裁切')
  })
  it('selects only advertised panorama sizes and never invents a supplier field', () => {
    expect(
      panoramaModelDefaults(
        [
          { name: 'ratio', type: 'select', options: ['1:1', '2:1'] },
          { name: 'size', type: 'select', options: [{ value: '1024x1024' }, { value: '2048x1024' }] },
        ],
        { ratio: '1:1', size: '1024x1024', count: 1 },
      ),
    ).toEqual({ ratio: '2:1', size: '2048x1024', count: 1 })
    expect(panoramaModelDefaults([{ name: 'size', type: 'string', help: '例如 1024*1536' }], {})).toEqual({
      size: '2048*1024',
    })
    expect(panoramaModelDefaults([{ name: 'size', type: 'string', default: '1024x1024' }], {})).toEqual({
      size: '2048x1024',
    })
    expect(
      panoramaModelDefaults(
        [
          { name: 'size', type: 'string' },
          { name: 'ratio', type: 'select', options: ['1:1'] },
        ],
        { ratio: '1:1' },
      ),
    ).toEqual({ ratio: '1:1' })
    expect(panoramaModelDefaults([{ name: 'size', type: 'select', options: [32, 'square'] }], {})).toEqual({})
  })
})
