import type { ReactNode } from 'react'
import RatioIcon from './RatioIcon'

/** 比例选择项共用的图形与文字，图标随选中项的文字颜色变化。 */
export default function RatioLabel({
  ratio,
  children,
  stacked = false,
}: {
  ratio: string
  children?: ReactNode
  stacked?: boolean
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        flexDirection: stacked ? 'column' : 'row',
        alignItems: 'center',
        gap: stacked ? 4 : 6,
        whiteSpace: 'nowrap',
      }}
    >
      <RatioIcon ratio={ratio} />
      <span>{children ?? ratio}</span>
    </span>
  )
}
