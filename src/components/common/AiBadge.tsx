/**
 * AiBadge — 「AI 生成」标识(右上角小机器人图标)。
 * 全系统统一:凡是 AI 生成的图片,在缩略图右上角叠加此徽标,让用户一眼区分 AI 图 / 用户上传图。
 * 用法:把它放进一个 position:relative 的图片容器里即可(无新增依赖,纯内联 SVG)。
 */
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
      {/* 小机器人:头部 + 天线 + 双眼 + 两侧耳 */}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <rect x="5" y="8.5" width="14" height="10.5" rx="3" />
        <path d="M12 4.5v4" />
        <circle cx="12" cy="3.4" r="1.25" fill="currentColor" stroke="none" />
        <circle cx="9.3" cy="13.2" r="1.25" fill="currentColor" stroke="none" />
        <circle cx="14.7" cy="13.2" r="1.25" fill="currentColor" stroke="none" />
        <path d="M3 12.5v3M21 12.5v3" />
      </svg>
    </span>
  )
}
