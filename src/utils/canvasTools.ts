import type { CreativeTool, ToolField } from '@/api/canvasTools'
import { composeStudioPrompt } from './canvasStudioControls'

/** 工具目录已按空间授权过滤；仅展示前端已接入且后端声明可用的工具。 */
export function availableCanvasImageTools(tools: readonly CreativeTool[]): CreativeTool[] {
  return tools.filter((tool) => {
    if (tool.code === 'panorama.view') return tool.execution === 'browser'
    return (
      ['image.multi_angle', 'image.relight', 'image.panorama'].includes(tool.code) &&
      tool.execution === 'prompt_workflow' &&
      Boolean(tool.operation_code) &&
      tool.model_version_ids?.length > 0
    )
  })
}

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
/** 机位按界面显示的整度提交，避免拖动产生的浮点尾数进入模型参数。 */
export function normalizeMultiAngleValues(values: Record<string, unknown>): Record<string, unknown> {
  const next = { ...values }
  for (const name of ['horizontal_angle', 'vertical_angle', 'zoom']) {
    const value = next[name]
    if (typeof value === 'number' && Number.isFinite(value)) next[name] = Math.round(value)
  }
  return next
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
  const { tool, modelId, assetIds } = args
  const values = tool.code === 'image.multi_angle' ? normalizeMultiAngleValues(args.values) : args.values
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
  // 打光不提供输出尺寸；旧值和目录默认值同样不参与校验或请求。
  const modelFields = args.modelFields.filter((field) => tool.code !== 'image.relight' || field.name !== 'size')
  const error = validateToolFields(fields, values) || validateToolFields(modelFields, args.modelValues)
  if (error) throw new Error(error)
  const prompt = normalizeCanvasToolPrompt(composeStudioPrompt(tool.code, args.prompt, values), { tool: tool.code })
  // 为后端多角度v2模板预留空间，避免拼接后超过模型提示词长度限制。
  // 模型48真实估价中230字成功、240字被拒绝；不截断用户内容，提前给出可操作提示。
  if (tool.code === 'image.multi_angle' && Array.from(prompt).length > 200)
    throw new Error('多角度描述过长，请缩短补充描述（含机位说明最多200字）')
  return {
    kind: 'image',
    // 工具说明允许不填补充描述，但统一任务接口的 prompt 为必填字符串。
    // 估价与提交都使用这份正文，避免估价接受空值、创建任务时被绑定校验拒绝。
    prompt,
    modelVersionId: modelId,
    operationCode: tool.operation_code,
    params: {
      ...activeToolParams(modelFields, args.modelValues),
      // 工具身份与目录版本成对发送，兼容仍按 params.tool 解析模板的后端。
      tool: tool.code,
      tool_version: tool.version,
      tool_params: activeToolParams(fields, values),
    },
    inputAssets: assetIds.map((asset_id) => ({ asset_id, role: 'reference_image' })),
  }
}
