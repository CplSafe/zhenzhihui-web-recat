import type { CreativeTool, ToolField } from '@/api/canvasTools'
import { composeStudioPrompt } from './canvasStudioControls'

/** 同时覆盖工具面板新任务与旧画布保存的空描述重试请求。 */
export function normalizeCanvasToolPrompt(prompt: unknown, params: unknown): string {
  const text = typeof prompt === 'string' ? prompt : ''
  const tool = params && typeof params === 'object' ? (params as Record<string, unknown>).tool : undefined
  if (typeof tool !== 'string' || !tool.trim()) return text
  return text.trim() || '请按工具参数处理参考图片。'
}

export function fieldOptions(field: ToolField): Array<{ value: unknown; label: string }> {
  return (field.options || []).map((option) => {
    if (option && typeof option === 'object') {
      const record = option as Record<string, unknown>
      return { value: record.value, label: String(record.label ?? record.display_name ?? record.value) }
    }
    return { value: option, label: String(option) }
  })
}
export function fieldVisible(field: ToolField, values: Record<string, unknown>): boolean {
  return Object.entries(field.visible_when || {}).every(
    ([key, options]) => Array.isArray(options) && options.includes(values[key]),
  )
}
export function schemaDefaults(fields: ToolField[]): Record<string, unknown> {
  return Object.fromEntries(fields.filter((f) => f.default !== undefined).map((f) => [f.name, f.default]))
}
export function activeToolParams(fields: ToolField[], values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    fields.filter((f) => fieldVisible(f, values) && values[f.name] !== undefined).map((f) => [f.name, values[f.name]]),
  )
}
export function validateToolFields(fields: ToolField[], values: Record<string, unknown>): string | null {
  for (const field of fields.filter((f) => fieldVisible(f, values))) {
    const value = values[field.name]
    const label = field.display_name || field.name
    if (value === undefined || value === '') {
      if (field.required) return `请填写${label}`
      continue
    }
    if (field.options?.length && !fieldOptions(field).some((option) => option.value === value))
      return `${label}选项无效`
    if (['number', 'integer', 'int', 'float'].includes(field.type)) {
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        (['integer', 'int'].includes(field.type) && !Number.isInteger(value))
      )
        return `${label}数值无效`
      if ((field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max))
        return `${label}超出允许范围`
    }
  }
  return null
}
export interface ToolGeneration {
  kind: 'image'
  prompt: string
  modelVersionId: number
  operationCode: string
  params: Record<string, unknown>
  inputAssets: Array<{ asset_id: number; role: string }>
}
/** 估价与提交共用唯一正文；模式切换后隐藏参数不会进入请求。 */
export function buildToolGeneration(args: {
  tool: CreativeTool
  modelId: number
  prompt: string
  values: Record<string, unknown>
  modelFields: ToolField[]
  modelValues: Record<string, unknown>
  assetIds: number[]
}): ToolGeneration {
  const { tool, modelId, values, assetIds } = args
  if (tool.execution !== 'prompt_workflow' || !tool.operation_code) throw new Error('当前工具不支持生成任务')
  if (!tool.model_version_ids?.includes(modelId)) throw new Error('请选择当前工具可用的模型')
  const referenceMode = tool.code === 'image.relight' && values.mode === 'reference'
  const min = tool.code === 'image.relight' ? (referenceMode ? 2 : 1) : (tool.min_input_images ?? 1)
  const max = tool.code === 'image.relight' ? min : (tool.max_input_images ?? 1)
  if (assetIds.length < min || assetIds.length > max)
    throw new Error(`当前模式需要 ${min === max ? min : `${min}～${max}`} 张图片`)
  if (assetIds.some((id) => !Number.isSafeInteger(id) || id <= 0) || new Set(assetIds).size !== assetIds.length)
    throw new Error('请选择不同且已上传完成的图片')
  const fields = tool.params_schema?.fields || []
  const error = validateToolFields(fields, values) || validateToolFields(args.modelFields, args.modelValues)
  if (error) throw new Error(error)
  return {
    kind: 'image',
    // 工具说明允许不填补充描述，但统一任务接口的 prompt 为必填字符串。
    // 估价与提交都使用这份正文，避免估价接受空值、创建任务时被绑定校验拒绝。
    prompt: normalizeCanvasToolPrompt(composeStudioPrompt(tool.code, args.prompt, values), { tool: tool.code }),
    modelVersionId: modelId,
    operationCode: tool.operation_code,
    params: {
      ...activeToolParams(args.modelFields, args.modelValues),
      tool: tool.code,
      tool_version: tool.version,
      tool_params: activeToolParams(fields, values),
    },
    inputAssets: assetIds.map((asset_id) => ({ asset_id, role: 'reference_image' })),
  }
}
