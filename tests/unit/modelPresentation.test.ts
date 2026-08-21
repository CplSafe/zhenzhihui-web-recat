import { describe, expect, it } from 'vitest'
import { readModelAccentHue, readModelInitial, readModelPresentation } from '@/utils/modelPresentation'

/**
 * 取值宽进严出：字段名按候选列表匹配、数据形状尽量兼容，但读不到就返回空。
 * 编一个「高质量」标签出来比不显示更糟——用户会照着它做选择。
 */
describe('readModelPresentation', () => {
  it('读 logo 字段作为图标地址，绝对/相对/data: 都放行', () => {
    expect(readModelPresentation({ logo: 'https://cdn.example.com/seedance.png' }).logo).toBe(
      'https://cdn.example.com/seedance.png',
    )
    expect(readModelPresentation({ logo_url: '/static/logos/minimax.svg' }).logo).toBe('/static/logos/minimax.svg')
    expect(readModelPresentation({ icon: 'logos/hh.webp' }).logo).toBe('logos/hh.webp')
  })

  it('logo 字段里塞的是普通文本时当作没有，不渲染碎图', () => {
    // 直接拿去当 src 会渲染出一个碎图占位，比退回首字母更难看、也更难发现是数据问题
    expect(readModelPresentation({ logo: 'seedance-v2' }).logo).toBe('')
  })

  it('读不到任何展示字段时全部为空，不编造内容', () => {
    expect(readModelPresentation({ display_name: '某模型' })).toEqual({
      logo: '',
      provider: '',
      tags: [],
      durationLabel: '',
      isNew: false,
      priceLabel: '',
    })
    expect(readModelPresentation(null).tags).toEqual([])
  })

  it('厂商、标签、NEW 标记按常见命名读出来', () => {
    const info = readModelPresentation({
      provider: 'DeepSeek',
      tags: ['深度推理', '高质量'],
      is_new: true,
    })
    expect(info.provider).toBe('DeepSeek')
    expect(info.tags).toEqual(['深度推理', '高质量'])
    expect(info.isNew).toBe(true)
  })

  it('扩展字段塞在 meta/extra 容器里同样能读到', () => {
    // 后端把展示信息放进嵌套容器是常态，只看顶层会漏掉一半
    const info = readModelPresentation({ meta: { vendor: 'Google', labels: '轻量快速,低成本' } })
    expect(info.provider).toBe('Google')
    expect(info.tags).toEqual(['轻量快速', '低成本'])
  })

  it('耗时兼容数字、区间对象、数组与已成文的字符串', () => {
    expect(readModelPresentation({ estimated_duration: { min: 5, max: 10 } }).durationLabel).toBe('5 ~ 10s')
    expect(readModelPresentation({ estimated_duration: [10, 20] }).durationLabel).toBe('10 ~ 20s')
    expect(readModelPresentation({ estimated_duration: 8 }).durationLabel).toBe('8s')
    // 后端已经给了完整文案就原样采用，不重新拼装
    expect(readModelPresentation({ eta: '5~10s' }).durationLabel).toBe('5~10s')
  })

  it('纯数字的价格补上单位，已带单位的原样用', () => {
    expect(readModelPresentation({ credits: 150 }).priceLabel).toBe('150 积分')
    expect(readModelPresentation({ price: '150 积分' }).priceLabel).toBe('150 积分')
  })

  it('标签最多三个：再多会把模型名挤成两行', () => {
    expect(readModelPresentation({ tags: ['a', 'b', 'c', 'd', 'e'] }).tags).toEqual(['a', 'b', 'c'])
  })

  it('目录里的 option 形状同样能读（字段挂在 source 上）', () => {
    expect(readModelPresentation({ displayName: 'X', source: { provider: 'OpenAI' } }).provider).toBe('OpenAI')
  })
})

describe('readModelInitial', () => {
  it('取模型名首字母，而不是厂商名', () => {
    // Seedance 的厂商是火山、HappyHorse 挂在字节名下，按厂商取会显示成 V/B，
    // 和紧挨着的模型名对不上，读起来像贴错了标签
    expect(readModelInitial('Seedance 2.5', 'volcengine')).toBe('S')
    expect(readModelInitial('HappyHorse 1.1', 'bytedance')).toBe('H')
    expect(readModelInitial('MiniMax H3(海螺 03)', 'minimax')).toBe('M')
  })

  it('跳过引号括号等无意义起始字符，中文取首字', () => {
    expect(readModelInitial('「豆包」视频')).toBe('豆')
    expect(readModelInitial('(测试) 模型')).toBe('测')
  })

  it('模型名没有可用字符时退回厂商名，都没有则为空', () => {
    expect(readModelInitial('  ', 'Google')).toBe('G')
    expect(readModelInitial('', '')).toBe('')
  })
})

describe('readModelAccentHue', () => {
  it('同一名称恒定同一色相，不同名称区分开', () => {
    // 用随机值的话，同一个模型每次打开都换颜色，颜色就失去了识别作用
    expect(readModelAccentHue('Seedance 2.5')).toBe(readModelAccentHue('Seedance 2.5'))
    expect(readModelAccentHue('Seedance 2.5')).not.toBe(readModelAccentHue('MiniMax H3'))
    expect(readModelAccentHue('任意名称')).toBeGreaterThanOrEqual(0)
    expect(readModelAccentHue('任意名称')).toBeLessThan(360)
  })
})
