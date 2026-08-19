import { describe, expect, it } from 'vitest'
import { resolveModelVideoInputSupport } from '@/utils/modelVideoInputSupport'

/**
 * 判定刻意保守：只有拿到「明确说了不支持」的证据才判 unsupported。
 * 误判会让一个本来能用的模型从下拉里消失，用户无从自查；漏判最多是维持现状（后端拒绝）。
 */
describe('resolveModelVideoInputSupport', () => {
  const withRoleField = (field: Record<string, unknown>) => ({
    params_schema: { fields: [{ name: 'input_asset_role', type: 'select', ...field }] },
  })

  it('角色候选里有 video 即支持', () => {
    expect(resolveModelVideoInputSupport(withRoleField({ options: ['image', 'video'] }) as any)).toBe('supported')
  })

  it('角色候选明确列出且不含 video 即不支持', () => {
    expect(resolveModelVideoInputSupport(withRoleField({ options: ['image', 'reference_image'] }) as any)).toBe(
      'unsupported',
    )
  })

  it('只有默认值时：默认是 video 才算支持，是别的角色则不下结论', () => {
    // 默认值只说明「不指定时用哪个」，不代表其它角色一律不收
    expect(resolveModelVideoInputSupport(withRoleField({ default: 'video' }) as any)).toBe('supported')
    expect(resolveModelVideoInputSupport(withRoleField({ default: 'image' }) as any)).toBe('unknown')
  })

  it('读得懂 input_assets 数组项里的标准 JSON Schema role 声明', () => {
    const model = {
      params_schema: {
        fields: [{ name: 'input_assets', type: 'array', items: { properties: { role: { enum: ['first_frame'] } } } }],
      },
    }
    expect(resolveModelVideoInputSupport(model as any)).toBe('unsupported')
  })

  it('schema 没声明角色时退回效果分类：参考生视频确定不吃视频', () => {
    expect(resolveModelVideoInputSupport({ display_name: 'HappyHorse 参考生视频' } as any)).toBe('unsupported')
  })

  it('目录里的 option 形状同样能判：schema 在 source 上，名字在 option 上', () => {
    // 只收一种形状的话，调用方就得在每个入口自己拆 source，迟早拆漏
    expect(
      resolveModelVideoInputSupport({ displayName: 'HappyHorse 参考生视频', source: { model_code: 'hh-v1' } } as any),
    ).toBe('unsupported')
    expect(
      resolveModelVideoInputSupport({ displayName: '某模型', source: withRoleField({ options: ['video'] }) } as any),
    ).toBe('supported')
  })

  it('其余未识别的模型一律不下结论，交给后端裁决', () => {
    expect(resolveModelVideoInputSupport({ display_name: '某个图生视频模型' } as any)).toBe('unknown')
    expect(resolveModelVideoInputSupport(null)).toBe('unknown')
  })
})
