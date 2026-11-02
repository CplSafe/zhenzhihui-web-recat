import WakeSlider from '@/components/common/WakeSlider'

/** Shared duration selector used by Studio, smart creation, and hot-copy flows. */
export interface StudioDurationPickerProps {
  /** Supported duration values in seconds, already sorted ascending. */
  options: number[]
  value: number
  onChange: (durationSec: number) => void
  disabled?: boolean
}

export default function StudioDurationPicker({ options, value, onChange, disabled }: StudioDurationPickerProps) {
  return (
    <WakeSlider
      options={options.map((seconds) => ({ value: seconds, label: `${seconds}s` }))}
      value={value}
      onChange={(next) => onChange(Number(next))}
      ariaLabel="视频时长"
      disabled={disabled}
      bars={36}
      wake={60}
    />
  )
}
