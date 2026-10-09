/**
 * 积分展示与计算。
 * 后端积分精度为 0.001；前端最多展示 2 位小数（去尾零），非零但不足 0.01 时显示「<0.01」。
 * 客户端涉及积分的加减乘、比较一律走整数毫积分（toMilli/fromMilli），避免浮点误差。
 */

/** 积分 → 整数毫积分（0.001 积分）。非法值按 0 处理。 */
export function toMilli(credits: unknown): number {
  const n = Number(credits)
  return Number.isFinite(n) ? Math.round(n * 1000) : 0
}

/** 整数毫积分 → 积分。 */
export function fromMilli(milli: number): number {
  return milli / 1000
}

/** 以毫积分精度计算 a - b。 */
export function subtractCredits(a: unknown, b: unknown): number {
  return fromMilli(toMilli(a) - toMilli(b))
}

/** 以毫积分精度计算单价 × 数量。 */
export function multiplyCredits(unit: unknown, count: number): number {
  return fromMilli(toMilli(unit) * count)
}

/** 以毫积分精度求和。 */
export function sumCredits(values: readonly unknown[]): number {
  return fromMilli(values.reduce<number>((sum, v) => sum + toMilli(v), 0))
}

/** 积分展示：千分位、最多 2 位小数去尾零；非零但 <0.005 显示「<0.01」。 */
export function formatCredits(credits: unknown): string {
  const n = Number(credits)
  if (!Number.isFinite(n) || n === 0) return '0'
  if (Math.abs(n) < 0.005) return n > 0 ? '<0.01' : '-<0.01'
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}
