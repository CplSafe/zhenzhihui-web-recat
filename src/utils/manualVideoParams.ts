import { getModelParamFields, getModelParamOptionValues } from './modelSchema'

/** 人工视频时长约束；服务端 schema 可在业务范围内进一步收窄。 */
export function getManualDurationSpec(model: unknown) {
  const field = getModelParamFields(model).find((item) => item.name === 'duration')
  const minValue = Number(field?.minimum ?? field?.min ?? 15)
  const maxValue = Number(field?.maximum ?? field?.max ?? 300)
  const min = Number.isFinite(minValue) ? Math.max(15, Math.ceil(minValue)) : 15
  const max = Number.isFinite(maxValue) ? Math.min(300, Math.floor(maxValue)) : 300
  const rawOptions = getModelParamOptionValues(field)
  const options = rawOptions.map(Number).filter((value) => Number.isInteger(value) && value >= min && value <= max)
  const valid = (value: number) =>
    Number.isInteger(value) && value >= min && value <= max && (!rawOptions.length || options.includes(value))
  const preferred = Number(field?.default)
  const fallback = valid(preferred) ? preferred : (options[0] ?? (valid(30) ? 30 : min))
  return { field, min, max, options, hasOptions: rawOptions.length > 0, valid, fallback }
}

export function getManualParamOptions(model: unknown, name: string): string[] {
  const field = getModelParamFields(model).find((item) => item.name === name)
  return getModelParamOptionValues(field).filter((value): value is string => typeof value === 'string')
}
