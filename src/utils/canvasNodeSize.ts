/** 视频「自适应」比例的存储值（英文，避免中文写入节点数据/接口参数）。 */
export const AUTO_RATIO = 'auto'
/** 「自适应」比例的界面显示文案（中文）。 */
export const AUTO_RATIO_LABEL = '自适应'

/** 判断比例是否为自适应（兼容旧数据中的中文「自适应」存储值）。 */
export function isAutoRatio(ratio: string | undefined | null): boolean {
  return ratio === AUTO_RATIO || ratio === AUTO_RATIO_LABEL
}

/** 比例显示文案：自适应显示中文，其余（2:3 等）原样显示。 */
export function formatRatio(ratio: string): string {
  return isAutoRatio(ratio) ? AUTO_RATIO_LABEL : ratio
}

/** 根据比例字符串计算节点尺寸，baseSize 为短边基准 */
export function calcNodeSize(ratio: string, baseSize: number): { width: number; height: number } {
  if (isAutoRatio(ratio)) return { width: 444, height: 250 }
  const [w, h] = ratio.split(':').map(Number)
  if (!w || !h) return { width: baseSize, height: baseSize }
  if (w > h) return { width: (baseSize * w) / h, height: baseSize }
  return { width: baseSize, height: (baseSize * h) / w }
}
