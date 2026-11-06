import { Select } from 'antd'
import { scriptIdeaGenres } from '@/utils/scriptIdeaGenres'

const options = scriptIdeaGenres.map((genre) => ({ label: genre, value: genre }))

export function ScriptGenreSelect({
  value,
  onChange,
  disabled,
  id,
  invalid,
}: {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  id?: string
  invalid?: boolean
}) {
  return (
    <Select
      id={id}
      aria-label="题材"
      aria-required="true"
      aria-invalid={invalid || undefined}
      aria-describedby={invalid ? 'si-genre-error' : undefined}
      className="si-genre-select"
      mode="tags"
      value={value
        .split(/[、,，]/)
        .map((item) => item.trim())
        .filter(Boolean)}
      onChange={(items) => onChange(items.join('、'))}
      options={options}
      placeholder="搜索或选择题材（可多选）"
      disabled={disabled}
      showSearch
      optionFilterProp="label"
    />
  )
}
