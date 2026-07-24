/**
 * 模型参数 schema 的通用解析工具。
 *
 * 后端目录同时存在 fields、自定义 options 和标准 JSON Schema 等结构。这里统一
 * 负责字段、别名、必填项与可选值解析，避免各任务构建器维护不同的兼容规则。
 */

export type ModelParamSchema = Readonly<Record<string, unknown>>
export type ModelParamField = Record<string, unknown> & {
  name: string
  required?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** 字符串 schema 使用 JSON.parse；解析失败或非对象输入返回 null。 */
export function parseParamsSchema(schema: unknown): ModelParamSchema | null {
  if (!schema) return null
  if (typeof schema === 'string') {
    try {
      const parsed = JSON.parse(schema)
      return isRecord(parsed) ? parsed : null
    } catch {
      return null
    }
  }
  return isRecord(schema) ? schema : null
}

/** 读取模型原始参数 schema。 */
export function getModelParamSchema(model: unknown): ModelParamSchema | null {
  if (!isRecord(model)) return null
  return parseParamsSchema(model.params_schema ?? model.paramsSchema)
}

/** 模型是否显式携带参数 schema；合法空 schema 也属于显式声明。 */
export function hasModelParamSchema(model: unknown): boolean {
  if (!isRecord(model)) return false
  const schema = model.params_schema ?? model.paramsSchema
  return schema !== undefined && schema !== null && schema !== ''
}

/**
 * 规范化参数名用于别名匹配。
 *
 * aspect_ratio、aspectRatio、aspect-ratio 会得到同一个键；原始字段名仍保留用于
 * 构建请求，规范化结果只用于查找。
 */
export function normalizeModelParamName(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return ''
  return String(value)
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '')
}

function collectAliasTexts(value: unknown, result: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectAliasTexts(item, result))
    return
  }
  if (isRecord(value)) {
    collectAliasTexts(value.name ?? value.value ?? value.code ?? value.key, result)
    return
  }
  if (typeof value !== 'string' && typeof value !== 'number') return
  const text = String(value).trim()
  if (!text) return
  text.split(/[\s,|]+/).forEach((item) => {
    const alias = item.trim()
    if (alias) result.push(alias)
  })
}

/** 返回字段原名和后端显式 alias/aliases 的去重列表。 */
export function getModelParamFieldNames(field: unknown): string[] {
  if (!isRecord(field)) return []
  const names: string[] = []
  collectAliasTexts(field.name, names)
  collectAliasTexts(field.alias, names)
  collectAliasTexts(field.aliases, names)
  collectAliasTexts(field.field_alias, names)
  collectAliasTexts(field.fieldAliases, names)
  return Array.from(new Set(names))
}

/** 读取一个选项对象中的真实提交值。 */
export function readModelParamOptionValue(option: unknown): unknown {
  if (!isRecord(option)) return option
  if ('value' in option) return option.value
  if ('const' in option) return option.const
  if ('id' in option) return option.id
  if ('code' in option) return option.code
  if ('key' in option) return option.key
  if (Array.isArray(option.enum) && option.enum.length === 1) return option.enum[0]
  return undefined
}

function optionValuesFromObject(options: Record<string, unknown>): unknown[] {
  const directValue = readModelParamOptionValue(options)
  if (directValue !== undefined) return [directValue]

  return Object.entries(options).map(([key, descriptor]) => {
    const value = readModelParamOptionValue(descriptor)
    // `{ "16:9": "横屏" }` 这类映射的键才是真实提交值。
    return value === undefined || typeof descriptor !== 'object' ? key : value
  })
}

/**
 * 读取字段可选值，兼容 options/enum/oneOf/choices/values/allowed_values、
 * `{ value, label }` 数组和对象映射。
 */
export function getModelParamOptionValues(field: unknown): unknown[] {
  if (!isRecord(field)) return []
  const raw =
    field.options ??
    field.enum ??
    field.oneOf ??
    field.choices ??
    field.values ??
    field.allowed_values ??
    field.allowedValues ??
    (Object.prototype.hasOwnProperty.call(field, 'const') ? [field.const] : [])

  const values = Array.isArray(raw)
    ? raw.map(readModelParamOptionValue)
    : isRecord(raw)
      ? optionValuesFromObject(raw)
      : []

  return values.filter((value) => value !== undefined && value !== null)
}

function schemaContainers(schema: ModelParamSchema): ModelParamSchema[] {
  const candidates = [schema, schema.params, schema.parameters, schema.schema, schema.json_schema, schema.jsonSchema]
  return candidates.filter(isRecord)
}

function applyRequiredFields(fields: unknown[], requiredValue: unknown): ModelParamField[] {
  const required = new Set(
    (Array.isArray(requiredValue) ? requiredValue : []).map(normalizeModelParamName).filter(Boolean),
  )

  return fields.flatMap((field) => {
    if (!isRecord(field) || typeof field.name !== 'string' || !field.name.trim()) return []
    const names = getModelParamFieldNames(field).map(normalizeModelParamName)
    return [
      {
        ...field,
        name: field.name.trim(),
        ...(field.required === true || names.some((name) => required.has(name)) ? { required: true } : {}),
      },
    ]
  })
}

/**
 * 取模型参数字段；兼容容器内 fields 与标准 JSON Schema properties。
 * JSON Schema 的 required 会映射到对应 field.required。
 */
export function getModelParamFields(model: unknown): ModelParamField[] {
  const schema = getModelParamSchema(model)
  if (!schema) return []

  for (const container of schemaContainers(schema)) {
    if (Object.prototype.hasOwnProperty.call(container, 'fields')) {
      return Array.isArray(container.fields) ? applyRequiredFields(container.fields, container.required) : []
    }

    if (!isRecord(container.properties)) continue
    const fields = Object.entries(container.properties).flatMap(([name, definition]) => {
      if (definition === false) return []
      const details = isRecord(definition) ? definition : {}
      const options = getModelParamOptionValues(details)
      return [
        {
          ...details,
          name,
          ...(options.length ? { options } : {}),
        },
      ]
    })
    return applyRequiredFields(fields, container.required)
  }

  return []
}

/** 按规范化原名或显式别名找到第一个字段，保持后端字段顺序。 */
export function findFirstField(fields: readonly unknown[], names: readonly string[]): ModelParamField | null {
  const candidates = new Set(names.map(normalizeModelParamName).filter(Boolean))
  if (!candidates.size) return null

  return (
    fields.find(
      (field): field is ModelParamField =>
        isRecord(field) &&
        typeof field.name === 'string' &&
        getModelParamFieldNames(field).some((name) => candidates.has(normalizeModelParamName(name))),
    ) || null
  )
}

/** 语义更清晰的别名，便于新代码复用；旧入口 findFirstField 保持兼容。 */
export const findModelParamField = findFirstField
