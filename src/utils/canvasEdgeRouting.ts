export type EdgePoint = { x: number; y: number }
export type EdgeObstacle = EdgePoint & { width: number; height: number }

/** Orthogonal corridor routing for generated provenance edges; never changes graph data. */
export function routeCanvasReference(
  start: EdgePoint,
  end: EdgePoint,
  obstacles: EdgeObstacle[],
): EdgePoint[] | undefined {
  const boxes = obstacles
    .filter((r) => [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width > 0 && r.height > 0)
    .map((r) => ({ left: r.x - 12, right: r.x + r.width + 12, top: r.y - 12, bottom: r.y + r.height + 12 }))
  const clear = (a: EdgePoint, b: EdgePoint) =>
    boxes.every((r) =>
      a.x === b.x
        ? a.x <= r.left || a.x >= r.right || Math.max(a.y, b.y) <= r.top || Math.min(a.y, b.y) >= r.bottom
        : a.y === b.y &&
          (a.y <= r.top || a.y >= r.bottom || Math.max(a.x, b.x) <= r.left || Math.min(a.x, b.x) >= r.right),
    )
  const candidates: EdgePoint[][] = []
  const ys = [...new Set([start.y, end.y, ...boxes.flatMap((r) => [r.top, r.bottom])])]
  const xs = [...new Set([start.x, end.x, ...boxes.flatMap((r) => [r.left, r.right])])]
  for (const y of ys) {
    candidates.push([start, { x: start.x, y }, { x: end.x, y }, end])
  }
  for (const x of xs) {
    candidates.push([start, { x, y: start.y }, { x, y: end.y }, end])
  }
  const length = (path: EdgePoint[]) =>
    path.slice(1).reduce((sum, p, i) => sum + Math.abs(p.x - path[i].x) + Math.abs(p.y - path[i].y), 0)
  const valid = (path: EdgePoint[]) => path.slice(1).every((b, i) => clear(path[i], b))
  const direct = candidates.filter(valid).sort((a, b) => length(a) - length(b))[0]
  if (direct) return direct
  // Try a sideways escape before going around the intervening cards. Only
  // consider x corridors reachable from an endpoint to avoid needless work.
  const detours: EdgePoint[][] = []
  for (const x of xs) {
    const fromStart = { x, y: start.y },
      fromEnd = { x, y: end.y }
    const startClear = clear(start, fromStart),
      endClear = clear(fromEnd, end)
    if (!startClear && !endClear) continue
    for (const y of ys) {
      if (startClear) detours.push([start, fromStart, { x, y }, { x: end.x, y }, end])
      if (endClear) detours.push([start, { x: start.x, y }, { x, y }, fromEnd, end])
    }
  }
  return detours.sort((a, b) => length(a) - length(b)).find(valid)
}
