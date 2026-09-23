import { describe, expect, it } from 'vitest'
import { computeAlignment, type AlignRect } from '@/utils/canvasAlignment'

const rect = (id: string, x: number, y: number, width = 100, height = 100): AlignRect => ({ id, x, y, width, height })

describe('computeAlignment', () => {
  it('左边靠近别的节点左边时吸附过去，并给出贯穿两者的竖线', () => {
    const moving = rect('m', 104, 300)
    const result = computeAlignment(moving, [rect('a', 100, 0)], 8)
    expect(result.x).toBe(100)
    expect(result.y).toBe(300)
    expect(result.guides).toEqual([{ axis: 'x', position: 100, from: 0, to: 400 }])
  })

  it('中线也参与对齐：横向中心对上时吸到中心', () => {
    // 被移动节点中心 155，目标中心 150
    const result = computeAlignment(rect('m', 105, 300), [rect('a', 100, 0)], 8)
    // 左边距离 5、中心距离 5、并列取先算到的（左边），两者都合法：x 落在 100
    expect(result.x).toBe(100)
  })

  it('两轴独立：横向吸 A、纵向吸 B', () => {
    const result = computeAlignment(rect('m', 203, 507), [rect('a', 200, 0), rect('b', 600, 500)], 8)
    expect(result.x).toBe(200)
    expect(result.y).toBe(500)
    expect(result.guides.map((guide) => guide.axis)).toEqual(['x', 'y'])
  })

  it('超出阈值不吸附、不画线', () => {
    const result = computeAlignment(rect('m', 120, 300), [rect('a', 100, 0)], 8)
    expect(result).toEqual({ x: 120, y: 300, guides: [] })
  })

  it('忽略自己，没有别的节点时原样返回', () => {
    const moving = rect('m', 120, 300)
    expect(computeAlignment(moving, [moving], 8)).toEqual({ x: 120, y: 300, guides: [] })
    expect(computeAlignment(moving, [], 8)).toEqual({ x: 120, y: 300, guides: [] })
  })

  it('多个候选取最近的那个', () => {
    const result = computeAlignment(rect('m', 106, 0), [rect('a', 100, 200), rect('b', 108, 400)], 8)
    expect(result.x).toBe(108)
  })
})
