import type { ToolField } from '@/api/canvasTools'
import { fieldOptions } from './canvasTools'
import { getCanvasTaskPresentation } from './canvasTaskState'

/** 本画布内同一超分模型已有任务时，不重复创建结果节点或提交请求。 */
export function hasActiveVideoUpscale(
  nodes: Array<{ id: string; data: Record<string, any> }>,
  modelVersionId: number,
  excludeNodeId?: string,
  pendingIds?: Set<string>,
) {
  return nodes.some(
    (node) =>
      node.id !== excludeNodeId &&
      node.data.operationCode === 'video.upscale' &&
      Number(node.data.modelVersionId) === Number(modelVersionId) &&
      (pendingIds?.has(node.id) ||
        (Number(node.data.taskId) > 0 &&
          getCanvasTaskPresentation({
            status: node.data.taskStatus,
            hasResult: Boolean(node.data.assetId || node.data.resultUrl),
          }).running)),
  )
}

/** 仅调整展示，不改变模型声明的字段、选项值及取值范围。 */
export function upscaleDisplayFields(fields: ToolField[]): ToolField[] {
  return fields.map((field) => {
    if (field.name === 'generative_enhance_mode') {
      const labels: Record<string, string> = { fidelity_first: '保真优先', generative_first: '细节增强优先' }
      return {
        ...field,
        display_name: '增强策略',
        options: fieldOptions(field).map((option) => ({
          ...option,
          label: labels[String(option.value)] || option.label,
        })),
        help: field.help || '保真优先：尽量保留原有细节；细节增强优先：补充纹理细节，可能改变局部细节。',
      }
    }
    if (field.name === 'multiple')
      return {
        ...field,
        display_name: '放大倍率（倍）',
        ...(field.options?.length
          ? { options: fieldOptions(field).map((option) => ({ ...option, label: `${option.value} 倍` })) }
          : {}),
        help: field.help || '1 倍保持像素尺寸；选择更高倍率将放大图片宽度和高度。',
      }
    if (field.name === 'target_width' || field.name === 'target_height')
      return {
        ...field,
        display_name: field.name === 'target_width' ? '目标宽度（像素）' : '目标高度（像素）',
      }
    return field
  })
}

/** 显示估计值；不把估计尺寸写回请求，最终尺寸以产物为准。 */
export function upscaleImageSize(width: number, height: number, params: Record<string, unknown>) {
  if (!(width > 0 && height > 0)) return null
  const multiple = Number(params.multiple)
  if (Number.isFinite(multiple) && multiple > 0)
    return { width: Math.round(width * multiple), height: Math.round(height * multiple) }
  const targetWidth = Number(params.target_width)
  const targetHeight = Number(params.target_height)
  if (targetWidth > 0 && targetHeight > 0) return { width: Math.round(targetWidth), height: Math.round(targetHeight) }
  if (targetWidth > 0) return { width: Math.round(targetWidth), height: Math.round((height * targetWidth) / width) }
  if (targetHeight > 0) return { width: Math.round((width * targetHeight) / height), height: Math.round(targetHeight) }
  return null
}
