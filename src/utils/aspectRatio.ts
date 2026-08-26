/**
 * 画面比例字符串的解析工具。
 *
 * 全站的比例值形态并不统一：用户选的是 16:9，后端可能回 16：9（全角冒号）或 16/9，
 * 所以解析统一放在这里，避免各处各写一份正则。
 */

/** 比例字符串的宽/高，如 16:9 → { width: 16, height: 9 }。 */
export interface ParsedRatio {
  width: number
  height: number
}

/** 兼容半角/全角冒号与斜杠的比例写法。 */
const RATIO_PATTERN = /(\d+(?:\.\d+)?)\s*[:：/]\s*(\d+(?:\.\d+)?)/

/** 解析比例字符串；无法解析或含非正数时返回 null，由调用方决定兜底。 */
export function parseRatio(ratio?: string): ParsedRatio | null {
  const matched = RATIO_PATTERN.exec(String(ratio || ''))
  if (!matched) return null
  const width = Number(matched[1])
  const height = Number(matched[2])
  if (!(width > 0) || !(height > 0)) return null
  return { width, height }
}

/**
 * 比例字符串 → CSS aspect-ratio 值（如「16 / 9」）。
 *
 * 解析不出来时返回 fallback，让格子仍有确定的形状——占位尺寸一旦缺失，
 * 出图瞬间就会撑开布局造成跳变。
 */
export function toCssAspectRatio(ratio?: string, fallback = '1 / 1'): string {
  const parsed = parseRatio(ratio)
  return parsed ? `${parsed.width} / ${parsed.height}` : fallback
}
