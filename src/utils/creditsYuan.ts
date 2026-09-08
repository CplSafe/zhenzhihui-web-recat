/**
 * 积分 → 人民币换算。
 * 平台固定汇率：1 积分 = 0.02 元。所有「预估积分」旁的金额提示统一走这里，
 * 避免各页面自行换算导致口径不一。
 */

/** 1 积分对应的人民币元数。 */
export const YUAN_PER_CREDIT = 0.02

/** 将积分换算为元的展示数字（去掉多余尾零：12 → "0.24"，100 → "2"）。非正数或非法值返回空串。 */
export function creditsToYuanAmount(credits: unknown): string {
  const n = Number(credits)
  if (!Number.isFinite(n) || n <= 0) return ''
  return (n * YUAN_PER_CREDIT).toFixed(2).replace(/\.?0+$/, '')
}

/** 生成「约0.24元」提示文案；算不出金额时返回空串。 */
export function creditsYuanHint(credits: unknown): string {
  const amount = creditsToYuanAmount(credits)
  return amount ? `约${amount}元` : ''
}

/** 生成可直接拼在「X 积分」后面的「（约0.24元）」后缀；算不出金额时返回空串。 */
export function creditsYuanSuffix(credits: unknown): string {
  const hint = creditsYuanHint(credits)
  return hint ? `（${hint}）` : ''
}

/** 面向按钮/正文的费用文案：正数 → 「约0.24元」；0 或未知 → 「约0元」，保证永远有内容可展示。 */
export function creditsYuanLabel(credits: unknown): string {
  return creditsYuanHint(credits) || '约0元'
}

/** 额度不足时的统一提示文案，各展示位不再各写一句。 */
export const INSUFFICIENT_CREDITS_TEXT = '积分不足，请充值积分'
