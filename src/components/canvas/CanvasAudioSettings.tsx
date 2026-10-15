import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { getModelParamOptionValues, type ModelParamField } from '@/utils/modelSchema'
import styles from './CanvasAudioSettings.module.css'

type Props = {
  anchor: HTMLElement
  fields: ModelParamField[]
  values: Record<string, unknown>
  disabled: boolean
  label: (field: ModelParamField) => string
  onChange: (values: Record<string, unknown>) => void
  onClose: () => void
}

export default function CanvasAudioSettings({ anchor, fields, values, disabled, label, onChange, onClose }: Props) {
  const panel = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: 0, top: 0, maxHeight: 500 })
  const [search, setSearch] = useState('')
  useLayoutEffect(() => {
    const update = () => {
      const bounds = anchor.getBoundingClientRect()
      const width = Math.min(380, window.innerWidth - 24)
      const height = Math.min(panel.current?.offsetHeight || 500, window.innerHeight - 24)
      const above = bounds.top - 12
      const below = window.innerHeight - bounds.bottom - 12
      const opensAbove = above >= height || above > below
      const maxHeight = Math.max(120, opensAbove ? above - 12 : below - 12)
      setPosition({
        left: Math.max(12, Math.min(window.innerWidth - width - 12, bounds.right - width)),
        top: opensAbove
          ? Math.max(12, bounds.top - Math.min(height, maxHeight) - 8)
          : Math.min(window.innerHeight - 132, bounds.bottom + 8),
        maxHeight,
      })
    }
    update()
    let frame = 0
    let previousBounds = ''
    const trackAnchor = () => {
      const bounds = anchor.getBoundingClientRect()
      const signature = `${bounds.left},${bounds.top},${bounds.width},${bounds.height}`
      if (signature !== previousBounds) {
        previousBounds = signature
        update()
      }
      frame = requestAnimationFrame(trackAnchor)
    }
    frame = requestAnimationFrame(trackAnchor)
    const observer = new ResizeObserver(update)
    if (panel.current) observer.observe(panel.current)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    const pointer = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node) && !anchor.contains(event.target as Node)) onClose()
    }
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
        anchor.focus()
      }
    }
    document.addEventListener('pointerdown', pointer)
    document.addEventListener('keydown', keyboard, true)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      document.removeEventListener('pointerdown', pointer)
      document.removeEventListener('keydown', keyboard, true)
    }
  }, [anchor, onClose])
  const voice = fields.filter((field) => /^(speaker|voice|voice_id)$/.test(field.name))
  const sound = fields.filter((field) => /^(speech_rate|loudness_rate|pitch_rate|speed|pitch|volume)$/.test(field.name))
  const advanced = fields.filter((field) => !voice.includes(field) && !sound.includes(field))
  const change = (field: ModelParamField, value: unknown) => onChange({ ...values, [field.name]: value })
  const control = (field: ModelParamField) => {
    const options = getModelParamOptionValues(field)
    const type =
      field.type ||
      (typeof field.default === 'boolean' ? 'boolean' : typeof field.default === 'number' ? 'number' : 'string')
    const name = label(field)
    const value = values[field.name]
    const booleanControl =
      type === 'boolean' ||
      (/^(enable_subtitle|aigc_watermark)$/.test(field.name) &&
        [true, false, 'true', 'false'].includes((value ?? field.default) as boolean | string))
    const stringBoolean = type === 'string' || typeof value === 'string'
    const isVoice = voice.includes(field)
    const ranged =
      sound.includes(field) &&
      (type === 'integer' || type === 'number') &&
      typeof field.minimum === 'number' &&
      typeof field.maximum === 'number' &&
      field.maximum > field.minimum &&
      !options.length
    const defaultValue = field.default
    const numberValue = Number(value)
    const invalid =
      value !== undefined &&
      value !== '' &&
      (type === 'number' || type === 'integer') &&
      (!Number.isFinite(numberValue) ||
        (type === 'integer' && !Number.isInteger(numberValue)) ||
        (typeof field.minimum === 'number' && numberValue < field.minimum) ||
        (typeof field.maximum === 'number' && numberValue > field.maximum))
    const format = (option: unknown) =>
      typeof option === 'boolean' || option === 'true' || option === 'false'
        ? option === true || option === 'true'
          ? '开启'
          : '关闭'
        : field.name === 'sample_rate' && Number(option) >= 1000
          ? `${Number(option) / 1000} kHz`
          : field.name === 'output_format'
            ? String(option).toUpperCase()
            : String(option)
    return (
      <div className={styles.field} key={field.name}>
        <div className={styles.fieldHeading}>
          <label htmlFor={`audio-setting-${field.name}`}>
            {name}
            {field.required ? ' *' : ''}
          </label>
          {defaultValue !== undefined && (
            <button
              type="button"
              disabled={disabled || Object.is(value, defaultValue)}
              onClick={() => change(field, defaultValue)}
              aria-label={`恢复${name}默认值`}
            >
              恢复默认
            </button>
          )}
        </div>
        {booleanControl ? (
          <label className={styles.toggle}>
            <input
              id={`audio-setting-${field.name}`}
              type="checkbox"
              role="switch"
              aria-label={name}
              disabled={disabled}
              checked={value === true || value === 'true'}
              onChange={(event) => change(field, stringBoolean ? String(event.target.checked) : event.target.checked)}
            />
            <span>{value === true || value === 'true' ? '开启' : '关闭'}</span>
          </label>
        ) : options.length ? (
          <>
            {isVoice && options.length > 6 && (
              <input
                aria-label="搜索音色"
                placeholder="搜索音色名称或编号"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            )}
            <select
              id={`audio-setting-${field.name}`}
              disabled={disabled}
              value={String(value ?? '')}
              onChange={(event) =>
                change(
                  field,
                  options.find((option) => String(option) === event.target.value),
                )
              }
            >
              <option value="">请选择{name}</option>
              {options
                .filter(
                  (option) =>
                    !isVoice ||
                    !search ||
                    String(option).toLowerCase().includes(search.toLowerCase()) ||
                    Object.is(option, value),
                )
                .map((option) => (
                  <option key={String(option)} value={String(option)}>
                    {format(option)}
                  </option>
                ))}
            </select>
          </>
        ) : field.name === 'context_text' ? (
          <textarea
            id={`audio-setting-${field.name}`}
            disabled={disabled}
            value={String(value ?? '')}
            placeholder="填写模型需要的上下文信息（可选）"
            onChange={(event) => change(field, event.target.value)}
          />
        ) : (
          <div className={ranged ? styles.adjustment : undefined}>
            {ranged && (
              <input
                type="range"
                aria-label={`${name}滑块`}
                disabled={disabled}
                min={Number(field.minimum)}
                max={Number(field.maximum)}
                step={type === 'integer' ? 1 : Number(field.multipleOf) || 0.01}
                value={Number(value ?? defaultValue ?? field.minimum)}
                onChange={(event) => change(field, Number(event.target.value))}
              />
            )}
            <input
              id={`audio-setting-${field.name}`}
              type={type === 'number' || type === 'integer' ? 'number' : 'text'}
              aria-invalid={invalid || undefined}
              disabled={disabled}
              min={typeof field.minimum === 'number' ? field.minimum : undefined}
              max={typeof field.maximum === 'number' ? field.maximum : undefined}
              step={type === 'integer' ? 1 : 'any'}
              value={String(value ?? '')}
              onChange={(event) =>
                change(
                  field,
                  event.target.value === ''
                    ? undefined
                    : type === 'number' || type === 'integer'
                      ? Number(event.target.value)
                      : event.target.value,
                )
              }
            />
          </div>
        )}
        {invalid && <small role="alert">请填写模型允许范围内的{type === 'integer' ? '整数' : '数值'}。</small>}
        {sound.includes(field) && (
          <small>
            {Object.is(value, defaultValue) && defaultValue !== undefined ? '当前为模型默认值。' : ''}
            {typeof field.minimum === 'number' && typeof field.maximum === 'number'
              ? `支持范围 ${field.minimum}～${field.maximum}。`
              : '按模型原始数值调整。'}
          </small>
        )}
        {typeof field.description === 'string' && <small>{field.description}</small>}
      </div>
    )
  }
  return createPortal(
    <div
      ref={panel}
      className={`${styles.panel} nodrag nopan nowheel`}
      style={position}
      role="dialog"
      aria-label="声音设置"
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <header>
        <div>
          <strong>声音设置</strong>
          <span>按当前模型配置声音</span>
        </div>
        <button type="button" aria-label="关闭声音设置" onClick={onClose}>
          ×
        </button>
      </header>
      <div className={styles.body}>
        {voice.some(
          (field) => getModelParamOptionValues(field).length > 0 || (field.required && field.default === undefined),
        ) && (
          <section aria-label="音色选择">
            {voice
              .filter(
                (field) =>
                  getModelParamOptionValues(field).length > 0 || (field.required && field.default === undefined),
              )
              .map(control)}
          </section>
        )}
        {sound.length > 0 && (
          <section aria-label="声音调节">
            <h4>声音调节</h4>
            {sound.map(control)}
          </section>
        )}
        {advanced.length > 0 && (
          <details className={styles.advanced}>
            <summary>
              高级设置 <span>格式、输出与附加参数</span>
            </summary>
            {advanced.map(control)}
          </details>
        )}
      </div>
      <footer>
        <span>自动保存，用于下一次生成</span>
        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            onChange(
              Object.fromEntries(
                fields.filter((field) => field.default !== undefined).map((field) => [field.name, field.default]),
              ),
            )
          }
        >
          恢复全部默认
        </button>
      </footer>
    </div>,
    document.body,
  )
}
