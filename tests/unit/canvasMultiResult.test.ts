import { describe, expect, it } from 'vitest'
import {
  MULTI_RESULT_GAP_X,
  MULTI_RESULT_GAP_Y,
  planMultiResultPositions,
  type CanvasRect,
} from '@/utils/canvasMultiResult'

const source: CanvasRect = { x: 0, y: 0, width: 200, height: 200 }
const stepX = 200 + MULTI_RESULT_GAP_X
const stepY = 200 + MULTI_RESULT_GAP_Y

const overlaps = (a: CanvasRect, b: CanvasRect) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y

describe('planMultiResultPositions', () => {
  it('空画布：紧挨原节点右侧、顶边对齐排成一行', () => {
    expect(planMultiResultPositions(source, 2, [source])).toEqual([
      { x: stepX, y: 0 },
      { x: stepX * 2, y: 0 },
    ])
  })

  it('超过 3 张换行成网格', () => {
    const positions = planMultiResultPositions(source, 5, [source])
    expect(positions).toHaveLength(5)
    expect(positions[3]).toEqual({ x: stepX, y: stepY })
    expect(positions[4]).toEqual({ x: stepX * 2, y: stepY })
  })

  it('右侧被已有节点占住时整块往下挪，且不与任何节点重叠', () => {
    const blocker: CanvasRect = { x: stepX, y: 0, width: 200, height: 200 }
    const positions = planMultiResultPositions(source, 3, [source, blocker])
    expect(positions[0].y).toBeGreaterThan(0)
    // 仍是整齐一行
    expect(new Set(positions.map((p) => p.y)).size).toBe(1)
    positions.forEach((p) => {
      const rect = { ...p, width: 200, height: 200 }
      expect(overlaps(rect, blocker)).toBe(false)
      expect(overlaps(rect, source)).toBe(false)
    })
  })

  it('count 为 0 返回空', () => {
    expect(planMultiResultPositions(source, 0, [])).toEqual([])
  })
})
