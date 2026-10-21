import { requestBusinessJson } from './business'

export interface ToolField {
  name: string
  display_name?: string
  type: string
  control?: string
  default?: unknown
  required?: boolean
  min?: number
  max?: number
  step?: number
  help?: string
  options?: unknown[]
  operation_codes?: string[]
  visible_when?: Record<string, unknown[]>
}
export interface CreativeTool {
  code: string
  display_name: string
  description?: string
  execution: string
  version: number
  operation_code?: string
  min_input_images?: number
  max_input_images?: number
  model_version_ids: number[]
  projection?: string
  params_schema?: { fields?: ToolField[] }
}

export async function listCanvasTools(workspaceId: number, signal?: AbortSignal): Promise<CreativeTool[]> {
  if (!Number.isSafeInteger(workspaceId) || workspaceId <= 0) throw new Error('工作空间无效')
  const tools = await requestBusinessJson(`/api/v1/ai/tools?workspace_id=${workspaceId}`, { signal })
  if (!Array.isArray(tools)) throw new Error('工具目录返回格式不完整，请稍后重试')
  return tools.filter((tool) => tool && typeof tool.code === 'string')
}
