/**
 * AiBadge — 「AI 生成」标识(右上角 AI 图标)。
 * 全系统统一:凡是 AI 生成的图片,在缩略图右上角叠加此徽标,让用户一眼区分 AI 图 / 用户上传图。
 * 用法:把它放进一个 position:relative 的图片容器里即可。
 */
import badgeIcon from '@/assets/image copy.png'
import './AiBadge.css'

interface AiBadgeProps {
  /** 角标尺寸(px),默认 18 */
  size?: number
  /** 悬浮提示,默认「AI 生成」 */
  title?: string
  className?: string
}

export default function AiBadge({ size = 18, title = 'AI 生成', className = '' }: AiBadgeProps) {
  return (
    <span
      className={`ai-badge ${className}`.trim()}
      style={{ width: size, height: size }}
      title={title}
      aria-label={title}
    >
      <img src={badgeIcon} alt="" />
    </span>
  )
}
