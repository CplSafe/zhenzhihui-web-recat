/**
 * 全站比例选择图标：固定 SVG 外框，内部矩形保持真实宽高比并居中。
 * 自动或跟随素材等非固定比例显示虚线框与自适应箭头。
 */
import { parseRatio } from '@/utils/aspectRatio'

/** 比例字符串与 SVG 画布尺寸。 */
interface RatioIconProps {
  ratio?: string
  size?: number
}

/** 保持真实宽高比，最长边限制在图标画布内。非固定比例使用虚线自适应标记。 */
export default function RatioIcon({ ratio = '16:9', size = 20 }: RatioIconProps) {
  const parsed = parseRatio(ratio)
  const scale = parsed ? 19 / Math.max(parsed.width, parsed.height) : 1
  const rw = parsed ? parsed.width * scale : 17
  const rh = parsed ? parsed.height * scale : 17
  const x = (24 - rw) / 2
  const y = (24 - rh) / 2
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      aria-hidden="true"
      focusable="false"
      style={{ flexShrink: 0, verticalAlign: 'middle' }}
    >
      <rect x={x} y={y} width={rw} height={rh} rx={1.5} strokeDasharray={parsed ? undefined : '3 2'} />
      {!parsed && <path d="M9 15l6-6M10 9h5v5" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  )
}
