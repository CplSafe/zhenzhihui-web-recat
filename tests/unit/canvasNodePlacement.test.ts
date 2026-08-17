/**
 * 新建节点落点。
 *
 * 锁的是一个实测出来的问题：工具栏新建节点用的是画布固定随机坐标
 * （{300+random*200, 200+random*200}），既与视口无关也不看已有节点，
 * 新节点常压在旧节点上；而选中态节点 z-index:1000 会把另一个整片盖住，
 * 刚建的时间线节点播放/精修/合成全部点不到。
 */
import { describe, expect, it } from 'vitest'
import { findFreeNodePosition, type NodePlacementRect } from '@/utils/canvasNodePlacement'

const size = { width: 200, height: 100 }

function rect(x: number, y: number, width = 200, height = 100): NodePlacementRect {
  return { x, y, width, height }
}

/** 按 gap 外扩后是否相交，用来独立校验返回值真的不重叠。 */
function intersects(a: NodePlacementRect, b: NodePlacementRect, gap = 24): boolean {
  return (
    a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y
  )
}

describe('findFreeNodePosition', () => {
  it('空画布时直接用期望落点', () => {
    expect(findFreeNodePosition({ anchor: { x: 40, y: 60 }, size, occupied: [] })).toEqual({ x: 40, y: 60 })
  })

  it('期望落点被占时挪开，且与已占矩形不再重叠', () => {
    const occupied = [rect(0, 0)]
    const pos = findFreeNodePosition({ anchor: { x: 0, y: 0 }, size, occupied })

    expect(pos).not.toEqual({ x: 0, y: 0 })
    expect(intersects({ ...pos, ...size }, occupied[0])).toBe(false)
  })

  it('连续新建多个节点都不会互相重叠', () => {
    const occupied: NodePlacementRect[] = []
    for (let i = 0; i < 8; i += 1) {
      const pos = findFreeNodePosition({ anchor: { x: 500, y: 500 }, size, occupied })
      const placed = { ...pos, ...size }
      // 与此前每一个都不重叠
      for (const existing of occupied) expect(intersects(placed, existing)).toBe(false)
      occupied.push(placed)
    }
    expect(occupied).toHaveLength(8)
  })

  it('尊重 gap：留白不足的位置不算空位', () => {
    const occupied = [rect(0, 0)]
    // gap 很大时，紧邻右侧仍算冲突，落点必须更远
    const pos = findFreeNodePosition({ anchor: { x: 0, y: 0 }, size, occupied, gap: 300, step: 100 })
    expect(intersects({ ...pos, ...size }, occupied[0], 300)).toBe(false)
  })

  it('忽略尺寸非法或坐标缺失的占位记录，不因脏数据挪走', () => {
    const occupied = [
      { x: Number.NaN, y: 0, width: 200, height: 100 },
      { x: 0, y: 0, width: 0, height: 0 },
    ]
    expect(findFreeNodePosition({ anchor: { x: 0, y: 0 }, size, occupied })).toEqual({ x: 0, y: 0 })
  })

  it('画布铺满时退回错开落点，而不是精确压在期望落点上', () => {
    // 用超大 gap 让任何位置都算冲突，逼出兜底分支
    const occupied = [rect(0, 0)]
    const pos = findFreeNodePosition({
      anchor: { x: 0, y: 0 },
      size,
      occupied,
      gap: 1e6,
      step: 10,
      maxRings: 2,
    })
    expect(pos).not.toEqual({ x: 0, y: 0 })
  })
})
