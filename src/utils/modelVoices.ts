import { getModelParamOptionValues, readModelParamOptionValue, type ModelParamField } from './modelSchema'

export type ModelVoiceValue = string | number
export interface ModelVoiceOption {
  value: ModelVoiceValue
  label: string
}

/** 只读取模型已声明的音色参数；不把样本资产 ID 当作音色 ID。 */
export function getModelVoiceOptions(field: ModelParamField): ModelVoiceOption[] {
  const raw =
    field.options ??
    field.enum ??
    field.oneOf ??
    field.choices ??
    field.values ??
    field.allowed_values ??
    field.allowedValues
  return getModelParamOptionValues(field).flatMap((value) => {
    if (typeof value !== 'string' && typeof value !== 'number') return []
    const descriptor = Array.isArray(raw)
      ? raw.find((option) => Object.is(readModelParamOptionValue(option), value))
      : raw && typeof raw === 'object'
        ? (raw as Record<string, unknown>)[String(value)]
        : undefined
    const record = descriptor && typeof descriptor === 'object' ? (descriptor as Record<string, unknown>) : null
    const label =
      record?.label ??
      record?.title ??
      record?.display_name ??
      record?.name ??
      (typeof descriptor === 'string' && !Array.isArray(raw) ? descriptor : value)
    return [{ value, label: String(label) }]
  })
}

export function isModelVoiceField(field: ModelParamField): boolean {
  return /^(speaker|voice|voice_id)$/.test(field.name)
}
