import { describe, expect, it } from 'vitest'
import { routeCanvasReference } from '@/utils/canvasEdgeRouting'

describe('Agent reference corridors', () => {
  it('routes around a card instead of crossing its body', () => {
    const route = routeCanvasReference({ x: 0, y: 50 }, { x: 300, y: 50 }, [{ x: 100, y: 0, width: 100, height: 100 }])!
    expect(route).toBeDefined()
    expect(route[1].y < 0 || route[1].y > 100).toBe(true)
    expect(route[0]).toEqual({ x: 0, y: 50 })
    expect(route.at(-1)).toEqual({ x: 300, y: 50 })
  })
  it('does not cross another card on the initially preferred detour', () => {
    const route = routeCanvasReference({ x: 0, y: 50 }, { x: 300, y: 50 }, [
      { x: 100, y: 0, width: 100, height: 100 },
      { x: -10, y: -50, width: 50, height: 40 },
    ])!
    expect(route[1].y).toBeGreaterThan(100)
  })
  it('escapes sideways when both vertical detours are blocked', () => {
    expect(
      routeCanvasReference({ x: 0, y: 0 }, { x: 300, y: 0 }, [
        { x: 100, y: -20, width: 100, height: 40 },
        { x: -20, y: 40, width: 40, height: 40 },
        { x: -20, y: -80, width: 40, height: 40 },
      ]),
    ).toBeDefined()
  })
  it('falls back for overlapping endpoints and handles an empty canvas', () => {
    expect(
      routeCanvasReference({ x: 50, y: 50 }, { x: 300, y: 50 }, [{ x: 0, y: 0, width: 100, height: 100 }]),
    ).toBeUndefined()
    expect(routeCanvasReference({ x: 0, y: 0 }, { x: 300, y: 50 }, [])).toBeDefined()
  })
})
