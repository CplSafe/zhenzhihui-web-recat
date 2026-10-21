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

  it('孤立节点放在流程下方，不夹在流程中间', () => {
    const nodes = [node('a', 0, 0), node('b', 200, 0), node('lonely', 100, 300)]
    const layout = computeLayeredLayout(nodes, [{ source: 'a', target: 'b' }], { hGap: 10 })
    expect(layout.get('lonely')!.y).toBeGreaterThan(layout.get('b')!.y + 50)
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
    expect(
      computeLayeredLayout(
        nodes.map((n) => ({ ...n, ...layout.get(n.id)! })),
        [
          { source: 'a', target: 'b' },
          { source: 'b', target: 'a' },
          { source: 'outside', target: 'a' },
        ],
      ),
    ).toEqual(layout)
  })

  it('空输入返回空表', () => {
    expect(computeLayeredLayout([], []).size).toBe(0)
  })

  it('不同工作流各占完整区域，连线不再跨过另一条流程', () => {
    const nodes = [node('a', 0, 0), node('d', 200, 10), node('c', 0, 50), node('b', 200, 100)]
    const layout = computeLayeredLayout(nodes, [
      { source: 'a', target: 'b' },
      { source: 'c', target: 'd' },
    ])
    expect(layout.get('a')!.y).toBe(layout.get('b')!.y)
    expect(layout.get('c')!.y).toBe(layout.get('d')!.y)
    const first = [layout.get('a')!, layout.get('b')!]
    const second = [layout.get('c')!, layout.get('d')!]
    expect(
      Math.max(...first.map((p) => p.y + 50)) < Math.min(...second.map((p) => p.y)) ||
        Math.max(...first.map((p) => p.x + 100)) < Math.min(...second.map((p) => p.x)),
    ).toBe(true)
  })

  it('孤立素材按网格换行，不会排成长列', () => {
    const layout = computeLayeredLayout(
      Array.from({ length: 16 }, (_, i) => node(String(i), i * 40, i * 20)),
      [],
    )
    const xs = new Set(Array.from(layout.values(), (p) => p.x))
    const ys = new Set(Array.from(layout.values(), (p) => p.y))
    expect(xs.size).toBeGreaterThan(1)
    expect(ys.size).toBeGreaterThan(1)
    expect(ys.size).toBeLessThan(16)
  })

  it('父节点围绕分支居中，分支和汇点减少交叉', () => {
    const nodes = [
      node('s', 0, 0),
      node('a', 200, 0),
      node('b', 200, 100),
      node('c', 400, 0),
      node('d', 400, 100),
      node('t', 600, 0),
    ]
    const edges = [
      { source: 's', target: 'a' },
      { source: 's', target: 'b' },
      { source: 'a', target: 'd' },
      { source: 'b', target: 'c' },
      { source: 'd', target: 't' },
      { source: 'c', target: 't' },
    ]
    const layout = computeLayeredLayout(nodes, edges)
    expect((layout.get('a')!.y - layout.get('b')!.y) * (layout.get('d')!.y - layout.get('c')!.y)).toBeGreaterThan(0)
    expect(Math.abs(layout.get('s')!.y - (layout.get('a')!.y + layout.get('b')!.y) / 2)).toBeLessThanOrEqual(1)
    expect(Math.abs(layout.get('t')!.y - layout.get('s')!.y)).toBeLessThanOrEqual(1)
  })

  it('分组整体参与布局，组内节点排列后不会夹入外部节点', () => {
    const nodes = [
      { ...node('a', 40, 20), groupId: 'g' },
      node('other', 0, 50),
      { ...node('b', 400, 200), groupId: 'g' },
      node('out', 600, 70),
    ]
    const edges = [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'out' },
    ]
    const layout = computeLayeredLayout(nodes, edges)
    expect(layout.get('b')!.x).toBeGreaterThan(layout.get('a')!.x)
    expect(layout.get('out')!.x).toBeGreaterThan(layout.get('b')!.x + 100)
    expect(layout.get('other')!.y).toBeGreaterThan(layout.get('a')!.y + 50)
    const again = computeLayeredLayout(
      nodes.map((n) => ({ ...n, ...layout.get(n.id)! })),
      edges,
    )
    expect(again).toEqual(layout)
  })

  it('混合尺寸的节点和分组不重叠，重复整理保持稳定', () => {
    const nodes = [
      node('a', -200, -100, 320, 500),
      node('b', 600, 5, 520, 160),
      node('c', 400, 30, 150, 600),
      { ...node('d', 50, 100, 220, 100), groupId: 'g' },
      { ...node('e', 50, 300, 440, 300), groupId: 'g' },
      node('f', 0, 300, 100, 50),
    ]
    const edges = [
      { source: 'a', target: 'b' },
      { source: 'a', target: 'c' },
      { source: 'd', target: 'e' },
    ]
    const layout = computeLayeredLayout(nodes, edges)
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++) {
        const a = { ...nodes[i], ...layout.get(nodes[i].id)! }
        const b = { ...nodes[j], ...layout.get(nodes[j].id)! }
        expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(
          true,
        )
      }
    expect(Math.min(...Array.from(layout.values(), (p) => p.x))).toBe(-200)
    expect(Math.min(...Array.from(layout.values(), (p) => p.y))).toBe(-100)
    expect(
      computeLayeredLayout(
        nodes.map((n) => ({ ...n, ...layout.get(n.id)! })),
        edges,
      ),
    ).toEqual(layout)
  })
})
