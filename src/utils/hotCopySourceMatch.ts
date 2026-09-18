/**
 * 爆款复刻：让比例 / 时长跟着源视频走。
 *
 * 这两个参数与源视频不一致时模型必须重新构图或裁剪——16:9 塞进 9:16 就得丢两侧，
 * 22 秒选 10 秒就得自己决定砍哪 12 秒——这是必然偏离，不是概率问题。
 * 选中源视频后按其真实尺寸与时长自动选档，用户改动后只提示不覆盖。
 */

/** 解析 "16:9" 这类比例字符串为宽高比数值；非法返回 0。 */
export function parseRatioValue(ratio: string): number {
  const match = /^\s*(\d+(?:\.\d+)?)\s*[:：xX×]\s*(\d+(?:\.\d+)?)\s*$/.exec(String(ratio || ''))
  if (!match) return 0
  const w = Number(match[1])
  const h = Number(match[2])
  return w > 0 && h > 0 ? w / h : 0
}

/** 在可选比例里挑与源视频宽高比最接近的一档；缺尺寸或无档位时返回空串。 */
export function closestRatioOption(width: number, height: number, options: readonly string[]): string {
  const w = Number(width) || 0
  const h = Number(height) || 0
  if (w <= 0 || h <= 0) return ''
  const target = w / h
  let best = ''
  let bestDiff = Number.POSITIVE_INFINITY
  for (const option of options || []) {
    const value = parseRatioValue(option)
    if (!value) continue
    // 用对数距离：16:9 vs 9:16 的差距要和 9:16 vs 16:9 对称
    const diff = Math.abs(Math.log(value) - Math.log(target))
    if (diff < bestDiff) {
      best = option
      bestDiff = diff
    }
  }
  return best
}

/**
 * 在可选时长里挑不超过源视频时长的最大一档；源视频比所有档位都短时取最小档。
 * 不做四舍五入进位：14.8 秒的源视频配 15 秒会让模型补 0.2 秒，配 10 秒只是少一点尾巴。
 */
export function closestDurationOption(sourceSec: number, options: readonly number[]): number {
  const source = Number(sourceSec) || 0
  const sorted = (options || [])
    .map((option) => Number(option) || 0)
    .filter((option) => option > 0)
    .sort((a, b) => a - b)
  if (!sorted.length || source <= 0) return 0
  const fit = sorted.filter((option) => option <= source + 0.05)
  return fit.length ? fit[fit.length - 1] : sorted[0]
}

export interface SourceVideoMeta {
  width: number
  height: number
  durationSec: number
}

export interface SourceMismatchArgs {
  source: SourceVideoMeta | null | undefined
  ratio: string
  durationSec: number
  ratioOptions: readonly string[]
  durationOptions: readonly number[]
}

/** 比例 / 时长与源视频不一致时的说明 + 一键改回推荐档所需的值。 */
export interface SourceMismatch {
  /** 推荐比例；当前已一致时为空串 */
  ratio: string
  /** 推荐秒数；当前已一致时为 0 */
  durationSec: number
  /** 提示正文 */
  message: string
  /** 一键采纳按钮文案，如「改为 9:16 · 15s」，和参数下拉里的写法保持一致 */
  actionLabel: string
}

/** 当前比例 / 时长与源视频不一致时给出提示与推荐值；一致或缺信息时返回 null。 */
export function resolveSourceMismatch(args: SourceMismatchArgs): SourceMismatch | null {
  const source = args.source
  if (!source) return null
  const parts: string[] = []
  const actionParts: string[] = []
  let ratio = ''
  let durationSec = 0
  const matchedRatio = closestRatioOption(source.width, source.height, args.ratioOptions)
  if (matchedRatio && args.ratio && matchedRatio !== args.ratio) {
    ratio = matchedRatio
    parts.push(`源视频接近 ${matchedRatio}，当前选了 ${args.ratio}，模型需要重新构图`)
    actionParts.push(matchedRatio)
  }
  const matchedDuration = closestDurationOption(source.durationSec, args.durationOptions)
  const current = Number(args.durationSec) || 0
  if (matchedDuration && current > 0 && matchedDuration !== current) {
    durationSec = matchedDuration
    const sourceLabel = Number.isInteger(source.durationSec) ? `${source.durationSec}` : source.durationSec.toFixed(1)
    parts.push(`源视频约 ${sourceLabel} 秒，当前选了 ${current} 秒，节奏会被裁剪或拉伸`)
    actionParts.push(`${matchedDuration}s`)
  }
  if (!parts.length) return null
  return {
    ratio,
    durationSec,
    message: `${parts.join('；')}。与源视频保持一致复刻效果更稳定。`,
    actionLabel: `改为 ${actionParts.join(' · ')}`,
  }
}

/** 当前比例 / 时长与源视频不一致时给出的提示文案；一致或缺信息时返回空串。 */
export function describeSourceMismatch(args: SourceMismatchArgs): string {
  return resolveSourceMismatch(args)?.message ?? ''
}
