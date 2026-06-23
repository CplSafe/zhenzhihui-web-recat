/**
 * 模型参数 schema 的通用解析工具。
 * 原先在 videoOptions / videoTasks / storyboardTasks 各有一份逐行相同的实现，集中于此。
 */

// 解析 params_schema：字符串则 JSON.parse（失败返回 null），对象原样返回。
export function parseParamsSchema(schema) {
  if (!schema) return null
  if (typeof schema !== 'string') return schema
  try {
    return JSON.parse(schema)
  } catch {
    return null
  }
}

// 取模型的参数字段数组。
export function getModelParamFields(model) {
  const schema = parseParamsSchema(model?.params_schema ?? model?.paramsSchema)
  return Array.isArray(schema?.fields) ? schema.fields : []
}

// 在字段列表中按候选名集合找到第一个匹配字段。
export function findFirstField(fields, names) {
  const set = new Set(names)
  return fields.find((field) => set.has(field?.name)) || null
}
