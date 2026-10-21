import { Children, isValidElement, type ReactNode } from 'react'
import { Select } from 'antd'
import styles from './CanvasImageTools.module.css'

/** Preserve schema values while replacing the platform-native option menu. */
export default function CanvasToolSelect({
  value,
  disabled,
  children,
  onChange,
  'aria-label': label,
}: {
  value: string | number
  disabled?: boolean
  children: ReactNode
  onChange: (event: { target: { value: string } }) => void
  'aria-label'?: string
}) {
  const options = Children.toArray(children).flatMap((child) => {
    if (!isValidElement<{ value: string | number; children: ReactNode; disabled?: boolean }>(child)) return []
    return [{ value: String(child.props.value), label: child.props.children, disabled: child.props.disabled }]
  })
  const placeholder = options.find((option) => option.value === '')?.label || '请选择'
  return (
    <Select
      className={styles.toolSelect}
      popupClassName={styles.toolSelectPopup}
      dropdownStyle={{ zIndex: 2400 }}
      aria-label={label}
      value={value === '' ? undefined : String(value)}
      placeholder={placeholder}
      disabled={disabled}
      options={options.filter((option) => option.value !== '')}
      onChange={(next) => onChange({ target: { value: next } })}
      notFoundContent="暂无可选项"
      listHeight={224}
      optionLabelProp="label"
    />
  )
}
