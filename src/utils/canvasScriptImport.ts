import { parseCanvasStructuredText } from './canvasStructuredText'

export const MAX_SCRIPT_IMPORT_CHARS = 50_000
export const MAX_SCRIPT_IMPORT_BYTES = 1024 * 1024
export type CanvasScriptImport = { title: string; text: string; shotCount: number }

/** 导入必须整份有效；不沿用模型输出的宽松解析，避免静默丢掉无效镜头。 */
export function parseCanvasScriptImport(value: string, format: 'text' | 'storyboard'): CanvasScriptImport {
  const text = value.replace(/^\uFEFF/, '').trim()
  if (!text) throw new Error('请先粘贴内容或选择文件')
  if (text.length > MAX_SCRIPT_IMPORT_CHARS) throw new Error('内容超过 50,000 字，请分段导入')
  if (format === 'text') return { title: '导入文本', text, shotCount: 0 }
  let source: unknown
  try {
    source = JSON.parse(text)
  } catch {
    throw new Error('分镜 JSON 格式不正确，请检查括号、引号和逗号')
  }
  const container = source as Record<string, unknown> | null
  const records = Array.isArray(source) ? source : (container?.storyboard ?? container?.shots ?? container?.scenes)
  if (!Array.isArray(records) || !records.length) throw new Error('分镜需要一个非空镜头数组')
  if (records.length > 100) throw new Error('一次最多导入 100 个镜头，请拆分文件')
  for (let index = 0; index < records.length; index++) {
    const parsed = parseCanvasStructuredText(JSON.stringify([records[index]]))
    if (parsed.kind !== 'storyboard' || parsed.items.length !== 1 || !parsed.items[0].prompt.trim())
      throw new Error(`镜头 ${index + 1} 缺少有效的 prompt 画面描述，请补充后导入`)
  }
  const parsed = parseCanvasStructuredText(text)
  if (parsed.kind !== 'storyboard') throw new Error('无法读取分镜内容，请检查镜头字段')
  return { title: '导入分镜', text: JSON.stringify(parsed.items), shotCount: parsed.items.length }
}
