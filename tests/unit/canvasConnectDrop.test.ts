/**
 * 从加号拖出连线后的落点判定。
 *
 * 锁的是用户实测反馈的问题：连线只能「加号连加号」——松手落在目标卡片上不算数。
 * 连接点本体是 0×0，React Flow 的 connectionRadius 够不到卡片中间，那恰好是最自然的落点。
 */
import { describe, expect, it } from 'vitest'
import { resolveCanvasConnectDropTarget, type CanvasNodeScreenRect } from '@/utils/canvasConnectDrop'

/** 屏幕坐标下的一张卡片。 */
function rect(nodeId: string, left: number, top: number, width = 200, height = 120): CanvasNodeScreenRect {
  return { nodeId, left, right: left + width, top, bottom: top + height }
}

const source = rect('source', 0, 0)
// 目标在源的右边：左边缘 400、右边缘 600、垂直中心 60
const target = rect('target', 400, 0)
const base = { sourceId: 'source', sourceCenterX: 100, rects: [source, target], zoom: 1 }

describe('resolveCanvasConnectDropTarget', () => {
  it('落在卡片正中间也算连到它——这正是加号够不着、之前连不上的地方', () => {
    expect(resolveCanvasConnectDropTarget({ ...base, point: { x: 500, y: 60 } })).toEqual({
      nodeId: 'target',
      side: 'left',
    })
    // 卡片四角同样在内部
    expect(resolveCanvasConnectDropTarget({ ...base, point: { x: 400, y: 0 } })?.nodeId).toBe('target')
    expect(resolveCanvasConnectDropTarget({ ...base, point: { x: 600, y: 120 } })?.nodeId).toBe('target')
  })

  it('落在卡片内部时按源节点方位选接入侧，连线不绕过整张卡片', () => {
    // 源在左 → 从目标左侧进
    expect(resolveCanvasConnectDropTarget({ ...base, point: { x: 590, y: 60 } })?.side).toBe('left')
    // 源在右 → 从目标右侧进
    expect(resolveCanvasConnectDropTarget({ ...base, sourceCenterX: 1200, point: { x: 410, y: 60 } })?.side).toBe(
      'right',
    )
    // 读不到源位置时退化为按落点相对卡片中心判断
    const { sourceCenterX: _unused, ...withoutSource } = base
    expect(resolveCanvasConnectDropTarget({ ...withoutSource, point: { x: 590, y: 60 } })?.side).toBe('right')
  })

  it('仍然支持瞄准左右加号：卡片外 30px 处的判定框按缩放换算', () => {
    // 目标左侧加号中心 = 400 - 30 = 370
    expect(resolveCanvasConnectDropTarget({ ...base, point: { x: 370, y: 60 } })).toEqual({
      nodeId: 'target',
      side: 'left',
    })
    // 目标右侧加号中心 = 600 + 30 = 630
    expect(resolveCanvasConnectDropTarget({ ...base, point: { x: 630, y: 60 } })).toEqual({
      nodeId: 'target',
      side: 'right',
    })
    // 缩小到 0.5 时判定框同样缩小：屏幕上 350（= 400-30*0.5-35）仍在框内，300 已超出
    const zoomed = { ...base, zoom: 0.5 }
    expect(resolveCanvasConnectDropTarget({ ...zoomed, point: { x: 370, y: 60 } })?.nodeId).toBe('target')
    expect(resolveCanvasConnectDropTarget({ ...zoomed, point: { x: 300, y: 60 } })).toBeNull()
  })

  it('永远不连自己，落在空白处返回 null 交给「添加下一步」菜单', () => {
    expect(resolveCanvasConnectDropTarget({ ...base, point: { x: 100, y: 60 } })).toBeNull()
    expect(resolveCanvasConnectDropTarget({ ...base, point: { x: 900, y: 900 } })).toBeNull()
    expect(resolveCanvasConnectDropTarget({ ...base, rects: [source], point: { x: 60, y: 60 } })).toBeNull()
  })

  it('卡片重叠时取最后渲染的那个——用户看到并瞄准的是盖在上面的那张', () => {
    const under = rect('under', 400, 0)
    const over = rect('over', 440, 20)
    const hit = resolveCanvasConnectDropTarget({
      ...base,
      rects: [source, under, over],
      point: { x: 500, y: 60 },
    })
    expect(hit?.nodeId).toBe('over')
  })

  it('坐标无效或缩放异常时不崩，也不误连', () => {
    expect(resolveCanvasConnectDropTarget({ ...base, point: { x: Number.NaN, y: 60 } })).toBeNull()
    // zoom 为 0 / 负数时按 1 处理，判定框不会塌成一个点
    expect(resolveCanvasConnectDropTarget({ ...base, zoom: 0, point: { x: 370, y: 60 } })?.nodeId).toBe('target')
  })
})
