/**
 * RatioIcon — 画一个「朝向随比例变化、整体视觉大小恒定」的矩形图标(供比例下拉的左侧图标用)。
 * 解析 ratio(如 16:9 / 9:16 / 1:1 / 4:3),在 24×24 画布内居中画保持该比值的矩形。
 * 按「面积恒定(几何均值 g 固定)」算宽高:w=g·√(a/b)、h=g·√(b/a) ——
 *   横屏(16:9)→ 约 18 宽的扁矩形(与原图标一样大)、竖屏(9:16)→ 高窄、1:1 → 中等方块,各比例视觉大小一致。
 * 图标宽随比例变化无妨:外层 pill 宽已由 valueMinWidth 固定,SVG 外框恒为 size×size,图标居中不推动布局。
 */
interface RatioIconProps {
  ratio?: string
  size?: number
}

const G = 14 // 几何均值(√面积)固定 → 各比例视觉大小一致,且横向够大(≈原图标尺寸)

export default function RatioIcon({ ratio = '16:9', size = 20 }: RatioIconProps) {
  const m = /(\d+(?:\.\d+)?)\s*[:：/]\s*(\d+(?:\.\d+)?)/.exec(String(ratio || ''))
  let a = m ? Number(m[1]) : 16
  let b = m ? Number(m[2]) : 9
  if (!(a > 0) || !(b > 0)) {
    a = 16
    b = 9
  }
  const k = Math.sqrt(a / b)
  const clamp = (v: number) => Math.max(7, Math.min(19, v)) // 防极端比例超出画布/过小
  const rw = clamp(G * k)
  const rh = clamp(G / k)
  const x = (24 - rw) / 2
  const y = (24 - rh) / 2
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.7}>
      <rect x={x} y={y} width={rw} height={rh} rx={2} />
    </svg>
  )
}
