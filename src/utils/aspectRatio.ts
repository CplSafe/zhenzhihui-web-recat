/**
 * 把画面比例串('16:9' / '9:16' / '1:1' / '4:3' / '3:4')转成 CSS aspect-ratio 值('9 / 16')。
 * 用于让分镜图 / 预览 / 缩略图容器按用户所选比例(横屏/竖屏/方形)显示,而非写死横屏。
 * 非法或缺省一律回退 16:9。
 */
function parseRatio(ratio?: string | null): { w: number; h: number } | null {
  const m = String(ratio || '').match(/^\s*(\d+(?:\.\d+)?)\s*[:：/xX]\s*(\d+(?:\.\d+)?)\s*$/)
  if (!m) return null
  const w = Number(m[1])
  const h = Number(m[2])
  return w > 0 && h > 0 ? { w, h } : null
}

export function ratioToAspect(ratio?: string | null): string {
  const p = parseRatio(ratio)
  return p ? `${p.w} / ${p.h}` : '16 / 9'
}

/** 是否竖屏(高>宽)。用于决定预览框按宽撑(横屏)还是按高撑(竖屏),避免竖屏占满宽度后过高。 */
export function ratioIsPortrait(ratio?: string | null): boolean {
  const p = parseRatio(ratio)
  return p ? p.h > p.w : false
}
