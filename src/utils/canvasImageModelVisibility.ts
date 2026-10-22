import type { GenerationModelOption } from './generationModelCatalog'

/** 普通图片节点不开放 Qwen Edit 2.0；工具目录、历史模型信息仍保留原始目录。 */
export function isCanvasToolOnlyImageModel(model: GenerationModelOption): boolean {
  return [
    model.displayName,
    model.source.model_code,
    model.source.modelCode,
    model.source.model_name,
    model.source.modelName,
    model.source.name,
  ].some((value) => {
    const identity = String(value ?? '')
      .toLowerCase()
      .replace(/[\s._-]/g, '')
    // 精确限定编辑模型及版本，不按 Qwen 品牌隐藏文生图、视觉或后续版本。
    return /^qwen(?:image)?edit20(?:\d{8})?$/.test(identity)
  })
}
