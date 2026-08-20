import { describe, expect, it } from 'vitest'

import { modelInitial, readModelLogo, toStudioModelChoice } from '@/utils/studioModelPresentation'

describe('readModelLogo', () => {
  it('识别 snake_case 与 camelCase 的 logo 字段', () => {
    expect(readModelLogo({ logo_url: 'https://cdn.example.com/a.png' })).toBe('https://cdn.example.com/a.png')
    expect(readModelLogo({ iconUrl: 'https://cdn.example.com/b.png' })).toBe('https://cdn.example.com/b.png')
  })

  it('从嵌套的 provider 对象里取 logo', () => {
    expect(readModelLogo({ provider: { name: '厂商', logo: 'https://cdn.example.com/c.png' } })).toBe(
      'https://cdn.example.com/c.png',
    )
  })

  it('协议相对地址补全为 https', () => {
    expect(readModelLogo({ logo: '//cdn.example.com/d.png' })).toBe('https://cdn.example.com/d.png')
  })

  it('接受 data: 图片与站内绝对路径', () => {
    expect(readModelLogo({ logo: 'data:image/png;base64,AAA' })).toBe('data:image/png;base64,AAA')
    expect(readModelLogo({ logo: '/assets/e.png' })).toBe('/assets/e.png')
  })

  it('拒绝非图片地址，避免把任意字符串塞进 img src', () => {
    // 纯文案、javascript: 伪协议都不能当作 logo。
    expect(readModelLogo({ logo: '暂无' })).toBe('')
    expect(readModelLogo({ logo: 'javascript:alert(1)' })).toBe('')
  })

  it('没有任何 logo 字段时返回空串', () => {
    expect(readModelLogo({ name: '某模型' })).toBe('')
    expect(readModelLogo(undefined)).toBe('')
  })
})

describe('modelInitial', () => {
  it('取名称首字母并大写', () => {
    expect(modelInitial('seedance')).toBe('S')
  })

  it('空名称回退为 AI', () => {
    expect(modelInitial('')).toBe('AI')
  })
})

describe('toStudioModelChoice', () => {
  it('投影出 id、名称、描述、供应商与约束', () => {
    // Arrange
    const option = {
      modelVersionId: 7,
      displayName: '某视频模型',
      operationCodes: ['video.generate'] as any,
      source: {
        description: '支持多镜头',
        provider_name: '某厂商',
        version_name: 'v2',
        logo: 'https://cdn.example.com/f.png',
      },
    }

    // Act
    const choice = toStudioModelChoice(option as any)

    // Assert
    expect(choice.id).toBe(7)
    expect(choice.name).toBe('某视频模型')
    expect(choice.description).toBe('支持多镜头')
    expect(choice.provider).toBe('某厂商')
    expect(choice.version).toBe('v2')
    expect(choice.logo).toBe('https://cdn.example.com/f.png')
    expect(choice.constraints).toBeTruthy()
  })

  it('缺字段时降级为空串而不是 undefined', () => {
    const choice = toStudioModelChoice({
      modelVersionId: 1,
      displayName: '裸模型',
      operationCodes: [],
      source: {},
    } as any)
    expect(choice.description).toBe('')
    expect(choice.logo).toBe('')
    expect(choice.provider).toBe('')
  })
})
