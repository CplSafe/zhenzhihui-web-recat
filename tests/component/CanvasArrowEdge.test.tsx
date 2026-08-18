import { render } from '@testing-library/react'
import { Position } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import CanvasArrowEdge from '@/components/canvas/CanvasArrowEdge'

/**
 * 这个边型存在的理由，是箭头必须「随边一起画出来」而不是去引用别处的 marker 定义。
 *
 * 旧方案把箭头放在 <defs> 里、边用 url(#id) 引用：新建第一条连线时定义与引用同批进 DOM，
 * 浏览器解析不到 id 就按无箭头定稿——线是光杆，刷新才有箭头。下面守的就是「不再有引用」。
 */
function renderEdge(props: Record<string, unknown>) {
  return render(
    <svg>
      <CanvasArrowEdge
        id="e1"
        source="a"
        target="b"
        sourceX={0}
        sourceY={0}
        targetX={100}
        targetY={50}
        sourcePosition={Position.Right}
        targetPosition={Position.Left}
        {...(props as any)}
      />
    </svg>,
  )
}

describe('CanvasArrowEdge', () => {
  it('箭头与连线同批渲染，且不引用任何外部 marker', () => {
    const { container } = renderEdge({})
    const arrow = container.querySelector('polygon.canvas-edge-arrow')
    expect(arrow).not.toBeNull()
    // 只描边会得到空心的「>」，看着不像箭头
    expect(arrow?.getAttribute('fill')).toBeTruthy()
    // 一旦又出现 url(#...) 引用，就说明退回了那条要刷新才显示的老路
    expect(container.innerHTML).not.toContain('url(#')
    expect(container.querySelector('path')?.getAttribute('marker-end')).toBeNull()
  })

  it('箭头尖端落在目标端点上', () => {
    const { container } = renderEdge({ targetX: 120, targetY: 40 })
    expect(container.querySelector('polygon.canvas-edge-arrow')?.getAttribute('transform')).toContain(
      'translate(120 40)',
    )
  })

  it('朝向跟着连入目标的那一侧走', () => {
    // 固定角度会让竖直连线的箭头朝错方向，所以四个方向都要对
    const cases: Array<[Position, string]> = [
      [Position.Left, 'rotate(0)'],
      [Position.Right, 'rotate(180)'],
      [Position.Top, 'rotate(90)'],
      [Position.Bottom, 'rotate(-90)'],
    ]
    for (const [position, expected] of cases) {
      const { container } = renderEdge({ targetPosition: position })
      expect(container.querySelector('polygon.canvas-edge-arrow')?.getAttribute('transform')).toContain(expected)
    }
  })

  it('边自定义了线色时箭头跟随同色', () => {
    const { container } = renderEdge({ style: { stroke: '#ff0000' } })
    expect(container.querySelector('polygon.canvas-edge-arrow')?.getAttribute('fill')).toBe('#ff0000')
  })
})
