import { describe, expect, it } from 'vitest'
import { computeLayeredLayout, type LayoutNode } from '@/utils/canvasLayout'

const node = (id: string, x: number, y: number, width = 100, height = 50): LayoutNode => ({ id, x, y, width, height })

describe('computeLayeredLayout', () => {
  it('按连线方向分列：上游在左、下游在右，列间距按最宽节点算', () => {
    const nodes = [node('a', 500, 500, 120), node('b', 0, 0), node('c', 900, 100)]
    const layout = computeLayeredLayout(
      nodes,
      [
        { source: 'b', target: 'a' },
        { source: 'a', target: 'c' },
      ],
      {
        hGap: 40,
        vGap: 20,
      },
    )
    // 原包围盒左上角是 (0, 0)：整理后整体不搬家
    expect(layout.get('b')).toEqual({ x: 0, y: 0 })
    expect(layout.get('a')).toEqual({ x: 140, y: 0 })
    expect(layout.get('c')).toEqual({ x: 140 + 120 + 40, y: 0 })
  })

  it('同列节点上下堆叠，保留原来的上下顺序', () => {
    const nodes = [node('top', 0, 10), node('bottom', 0, 300), node('sink', 400, 0)]
    const layout = computeLayeredLayout(
      nodes,
      [
        { source: 'bottom', target: 'sink' },
        { source: 'top', target: 'sink' },
      ],
      { vGap: 20 },
    )
    expect(layout.get('top')).toEqual({ x: 0, y: 0 })
    expect(layout.get('bottom')).toEqual({ x: 0, y: 70 })
  })

  it('孤立节点单独放到最后一列，不夹在流程中间', () => {
    const nodes = [node('a', 0, 0), node('b', 200, 0), node('lonely', 100, 300)]
    const layout = computeLayeredLayout(nodes, [{ source: 'a', target: 'b' }], { hGap: 10 })
    expect(layout.get('lonely')!.x).toBeGreaterThan(layout.get('b')!.x)
  })

  it('层号取最长路径：菱形依赖里汇点排在两条支路之后', () => {
    const nodes = [node('s', 0, 0), node('l', 0, 100), node('r', 0, 200), node('t', 0, 300)]
    const layout = computeLayeredLayout(
      nodes,
      [
        { source: 's', target: 'l' },
        { source: 's', target: 'r' },
        { source: 'l', target: 't' },
        { source: 's', target: 't' },
      ],
      { hGap: 0 },
    )
    expect(layout.get('t')!.x).toBe(200)
    expect(layout.get('l')!.x).toBe(100)
    expect(layout.get('r')!.x).toBe(100)
  })

  it('只认两端都在这批里的连线；有环也能算完', () => {
    const nodes = [node('a', 0, 0), node('b', 0, 100)]
    const layout = computeLayeredLayout(nodes, [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'a' },
      { source: 'outside', target: 'a' },
    ])
    expect(layout.size).toBe(2)
    // 回边被忽略后两者仍分在不同列，而不是叠在一起
    expect(layout.get('a')!.x).not.toBe(layout.get('b')!.x)
  })

  it('空输入返回空表', () => {
    expect(computeLayeredLayout([], []).size).toBe(0)
  })
})
