import CanvasToolSelect from './CanvasToolSelect'
import { Switch } from 'antd'
import type { ToolField } from '@/api/canvasTools'
import { fieldOptions, fieldVisible } from '@/utils/canvasTools'
import styles from './CanvasImageTools.module.css'

const OPTION_LABELS: Record<string, Record<string, string>> = {
  mode: { manual: '手动布光', smart: '智能补光', reference: '参考图布光' },
  preset: {
    none: '无预设',
    overexposed_film: '过曝胶片',
    blue_backlight: '蓝色背光',
    rembrandt: '伦勃朗光',
    cyberpunk: '赛博朋克',
    low_key: '低调光',
    high_key: '高调光',
    golden_hour: '黄金时刻',
    sunset: '落日暖光',
    studio: '影棚光',
    natural: '自然光',
    cinematic: '电影光',
    soft_light: '柔光',
    dramatic: '戏剧光',
    neon: '霓虹光',
  },
  key_light: { front: '正面', back: '背面', left: '左侧', right: '右侧', top: '顶部', bottom: '底部' },
}

export default function CanvasToolFields({
  fields,
  values,
  onChange,
  disabled = false,
}: {
  fields: ToolField[]
  values: Record<string, unknown>
  onChange: (values: Record<string, unknown>) => void
  disabled?: boolean
}) {
  return (
    <>
      {fields
        .filter((field) => fieldVisible(field, values))
        .map((field) => {
          const value = values[field.name]
          const options = fieldOptions(field).map((option) => ({
            ...option,
            label:
              option.label === String(option.value) || (field.name === 'preset' && /^[\x20-\x7e]+$/.test(option.label))
                ? OPTION_LABELS[field.name]?.[String(option.value)] ||
                  ({ balanced: '均衡细节', rich: '丰富细节' } as Record<string, string>)[String(option.value)] ||
                  option.label
                : option.label,
          }))
          const numeric = ['number', 'integer', 'int', 'float'].includes(field.type)
          const update = (next: unknown) => onChange({ ...values, [field.name]: next })
          if (['count', 'n', 'num_images', 'batch_size'].includes(field.name) && numeric) {
            return (
              <div className={styles.field} key={field.name}>
                <span>{field.display_name || '生成数量'}</span>
                <div className={styles.countOptions} role="group" aria-label={field.display_name || '生成数量'}>
                  {[1, 2, 4].map((count) => (
                    <button
                      key={count}
                      type="button"
                      aria-pressed={value === count}
                      disabled={
                        disabled ||
                        (field.min !== undefined && count < field.min) ||
                        (field.max !== undefined && count > field.max) ||
                        (options.length > 0 && !options.some((option) => option.value === count))
                      }
                      onClick={() => update(count)}
                    >
                      {count}张
                    </button>
                  ))}
                </div>
                {field.help && <small>{field.help}</small>}
              </div>
            )
          }
          if (['key_light', 'mode', 'preset'].includes(field.name) && options.length) {
            return (
              <div className={styles.field} key={field.name}>
                <span>{field.display_name || field.name}</span>
                <div className={styles.presets} role="group" aria-label={field.display_name || field.name}>
                  {options.map((option) => (
                    <button
                      key={String(option.value)}
                      type="button"
                      disabled={disabled}
                      aria-pressed={value === option.value}
                      onClick={() => update(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            )
          }
          return (
            <label className={`${styles.field} ${numeric ? styles.compactNumber : ''}`} key={field.name}>
              <span>
                {field.display_name || field.name}
                {field.required ? ' *' : ''}
              </span>
              {options.length ? (
                <CanvasToolSelect
                  aria-label={field.display_name || field.name}
                  disabled={disabled}
                  value={value === undefined ? '' : String(options.findIndex((o) => o.value === value))}
                  onChange={(e) => update(options[Number(e.target.value)]?.value)}
                >
                  <option value="" disabled>
                    请选择
                  </option>
                  {options.map((o, index) => (
                    <option key={index} value={index}>
                      {o.label}
                    </option>
                  ))}
                </CanvasToolSelect>
              ) : ['boolean', 'bool'].includes(field.type) ? (
                <Switch
                  className={styles.fieldSwitch}
                  size="small"
                  aria-label={field.display_name || field.name}
                  disabled={disabled}
                  checked={value === true}
                  onChange={update}
                />
              ) : field.name === 'color' ? (
                <div className={styles.colorField}>
                  <input
                    type="color"
                    aria-label="光源颜色选择器"
                    value={/^#[0-9a-f]{6}$/i.test(String(value)) ? String(value) : '#ffffff'}
                    disabled={disabled}
                    onChange={(event) => update(event.target.value)}
                  />
                  <input
                    aria-label={field.display_name || field.name}
                    type="text"
                    value={String(value ?? '')}
                    placeholder="自动颜色 / #RRGGBB"
                    disabled={disabled}
                    onChange={(event) => update(event.target.value)}
                  />
                  <button type="button" disabled={disabled} onClick={() => update('')}>
                    自动
                  </button>
                </div>
              ) : numeric ? (
                <div className={styles.number}>
                  {field.min !== undefined && field.max !== undefined && (
                    <input
                      aria-label={`${field.display_name || field.name}滑块`}
                      disabled={disabled}
                      type="range"
                      min={field.min}
                      max={field.max}
                      step={field.step ?? (field.type === 'integer' ? 1 : 'any')}
                      value={Number(value ?? field.min)}
                      onChange={(e) => update(Number(e.target.value))}
                    />
                  )}
                  <input
                    aria-label={field.display_name || field.name}
                    disabled={disabled}
                    type="number"
                    min={field.min}
                    max={field.max}
                    step={field.step ?? 'any'}
                    value={value === undefined ? '' : Number(value)}
                    onChange={(e) => update(e.target.value === '' ? undefined : Number(e.target.value))}
                  />
                </div>
              ) : (
                <input
                  disabled={disabled}
                  type="text"
                  value={String(value ?? '')}
                  onChange={(e) => update(e.target.value)}
                  placeholder={field.name === 'color' ? '#RRGGBB（可留空）' : undefined}
                />
              )}
              {field.help && <small>{field.help}</small>}
            </label>
          )
        })}
    </>
  )
}
