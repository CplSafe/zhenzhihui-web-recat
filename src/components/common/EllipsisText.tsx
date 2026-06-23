/**
 * EllipsisText — 文本超出省略 + 仅在「真的被截断」时才显示完整内容 tooltip。
 * 通用组件:凡是单/多行省略的文本(素材名、标题、标签等),都可用它替换原来的 <span>,
 * 自动接管省略样式与悬浮提示,避免到处手写 overflow 检测。
 *
 * 用法:
 *   <EllipsisText text={`@${name}`} className={styles.smbName} />   // 单行省略
 *   <EllipsisText text={desc} lines={2} />                          // 两行省略
 *   <EllipsisText text={name} title={`@${name} ${kind}`} />         // 自定义 tooltip 内容
 *
 * 实现:进入悬浮时测量 scrollWidth/Height 是否超出 client 尺寸,只有溢出才把 tooltip 标题
 * 置为完整文本(antd Tooltip 标题为空时不弹出)。测量在 antd 默认 100ms 弹出延迟前完成,首次悬浮即可生效。
 */
import { useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Tooltip } from 'antd'
import type { TooltipProps } from 'antd'

interface EllipsisTextProps {
  /** 要展示的文本 */
  text: string
  /** tooltip 内容(默认用 text);需要展示比可见文本更完整的内容时传它 */
  title?: ReactNode
  /** 多行省略的行数;不传 = 单行省略 */
  lines?: number
  className?: string
  style?: CSSProperties
  /** 透传给 antd Tooltip 的额外属性(如 placement) */
  tooltipProps?: Omit<TooltipProps, 'title'>
}

export default function EllipsisText({ text, title, lines, className, style, tooltipProps }: EllipsisTextProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const [overflow, setOverflow] = useState(false)

  const measure = () => {
    const el = ref.current
    if (!el) return
    // +1 容差,规避亚像素四舍五入误报
    const isOver = lines && lines > 1 ? el.scrollHeight > el.clientHeight + 1 : el.scrollWidth > el.clientWidth + 1
    if (isOver !== overflow) setOverflow(isOver)
  }

  const clampStyle: CSSProperties =
    lines && lines > 1
      ? { display: '-webkit-box', WebkitLineClamp: lines, WebkitBoxOrient: 'vertical', overflow: 'hidden' }
      : { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }

  return (
    <Tooltip title={overflow ? (title ?? text) : ''} {...tooltipProps}>
      <span ref={ref} className={className} style={{ ...clampStyle, ...style }} onMouseEnter={measure}>
        {text}
      </span>
    </Tooltip>
  )
}
