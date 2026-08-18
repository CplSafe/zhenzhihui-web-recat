import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import CanvasEdgeArrowDefs, { CANVAS_EDGE_ARROW_ID } from '@/components/canvas/CanvasEdgeArrowDefs'

/**
 * 这份定义存在的唯一理由，就是「在任何一条连线出现之前，箭头 id 就已经在文档里」。
 *
 * React Flow 自带的 MarkerDefinitions 在没有边时返回 null，第一条连线会连同 marker 定义
 * 一起插入 DOM，浏览器解析不到该 id 便按无箭头定稿——新连的线是光杆，刷新才有箭头。
 * 下面的用例守的就是这条不变量。
 */
describe('CanvasEdgeArrowDefs', () => {
  it('无需任何连线即渲染箭头定义', () => {
    const { container } = render(<CanvasEdgeArrowDefs />)
    const marker = container.querySelector('marker')
    expect(marker).not.toBeNull()
    expect(marker?.getAttribute('id')).toBe(CANVAS_EDGE_ARROW_ID)
  })

  it('箭头对连线方向可见：有填充色且随线段方向旋转', () => {
    const { container } = render(<CanvasEdgeArrowDefs />)
    const marker = container.querySelector('marker')
    // auto-start-reverse 让箭头跟着线段走向转；固定角度会让竖直连线的箭头朝错方向
    expect(marker?.getAttribute('orient')).toBe('auto-start-reverse')
    const head = container.querySelector('polyline')
    // 只描边不填充会得到一个空心的「>」，看起来不像箭头
    expect(head?.style.fill).toBeTruthy()
    expect(head?.style.stroke).toBeTruthy()
  })

  it('id 不含会破坏 url(#id) 引用的字符', () => {
    // markerEnd 最终被 React Flow 渲染成 url('#<id>')；引号、括号、井号都会让引用失效
    expect(CANVAS_EDGE_ARROW_ID).toMatch(/^[a-zA-Z][\w-]*$/)
  })
})
