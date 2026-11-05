/** 精制服务的目标成片时长，单位为秒。 */
export const REFINE_DURATIONS = [15, 30, 45, 60, 120, 180, 300] as const

export type RefineDuration = (typeof REFINE_DURATIONS)[number]

/** 原型价格仅供展示参考；实际冻结金额必须使用服务端报价。 */
export function estimateRefineCredits(seconds: RefineDuration): number {
  return Math.round(seconds * 25 * 1.5)
}

export function formatRefineDuration(seconds: RefineDuration): string {
  return seconds < 60 ? `${seconds} 秒` : `${seconds / 60} 分钟`
}

/** 演示用途：次日北京时间 18:00；真实业务必须以服务端为准。 */
export function getDemoDueAt(now: number): number {
  const chinaTime = new Date(now + 8 * 60 * 60 * 1000)
  return Date.UTC(chinaTime.getUTCFullYear(), chinaTime.getUTCMonth(), chinaTime.getUTCDate() + 1, 10)
}
