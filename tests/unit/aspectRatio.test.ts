import { describe, expect, it } from 'vitest'

import { parseRatio, toCssAspectRatio } from '@/utils/aspectRatio'

describe('parseRatio', () => {
  it('解析常规比例', () => {
    expect(parseRatio('16:9')).toEqual({ width: 16, height: 9 })
    expect(parseRatio('9:16')).toEqual({ width: 9, height: 16 })
  })

  it('兼容全角冒号与斜杠', () => {
    // 后端与各模型回传的写法并不统一，解析要一并吃下。
    expect(parseRatio('16：9')).toEqual({ width: 16, height: 9 })
    expect(parseRatio('4/3')).toEqual({ width: 4, height: 3 })
  })

  it('容忍两侧与分隔符周围的空白', () => {
    expect(parseRatio('  16 : 9  ')).toEqual({ width: 16, height: 9 })
  })

  it('支持小数比例', () => {
    expect(parseRatio('1.85:1')).toEqual({ width: 1.85, height: 1 })
  })

  it('无法解析时返回 null', () => {
    expect(parseRatio('')).toBeNull()
    expect(parseRatio(undefined)).toBeNull()
    expect(parseRatio('宽屏')).toBeNull()
  })

  it('零值不是合法比例', () => {
    // 0 会让 aspect-ratio 塌成 0 高，必须拦住。
    expect(parseRatio('0:9')).toBeNull()
    expect(parseRatio('16:0')).toBeNull()
  })
})

describe('toCssAspectRatio', () => {
  it('转成 CSS aspect-ratio 写法', () => {
    expect(toCssAspectRatio('16:9')).toBe('16 / 9')
  })

  it('解析失败时用兜底值，保证格子仍有确定形状', () => {
    expect(toCssAspectRatio('')).toBe('1 / 1')
    expect(toCssAspectRatio(undefined)).toBe('1 / 1')
    expect(toCssAspectRatio('乱码', '16 / 9')).toBe('16 / 9')
  })
})
