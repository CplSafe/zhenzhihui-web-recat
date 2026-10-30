/**
 * 框选多节点「+」菜单的来源类型规则。
 *
 * 规则只作用于批量下游创建入口；普通拖线和单节点「添加下一步」继续使用
 * CanvasView 中的 allowedSourceKinds，避免把矩阵限制误当成全局接口能力。
 */
export type CanvasSelectionAddTarget = 'text' | 'image' | 'video' | 'timeline' | 'audio' | 'audio-editor' | 'script'

const SELECTION_ADD_SOURCE_KINDS: Record<CanvasSelectionAddTarget, readonly string[]> = {
  // 分镜文本可汇总文字和图片上下文，但不接收视频/时间线输入。
  text: ['text', 'image'],
  image: ['text', 'image'],
  // B7：音频仅作为视频生成的独立输入支持，不在多选「+」矩阵内开放。
  video: ['text', 'image', 'video', 'timeline'],
  // 图片片段尚未纳入 TimelineClip（它要求可裁切的视频 asset 和时长），暂不开放混选剪辑。
  timeline: ['video', 'timeline'],
  // B4/B6：只放开报告确认的视频来源；文本不能作为音频素材引用。
  audio: ['video'],
  'audio-editor': [],
  script: [],
}

export function isCanvasSelectionAddAllowed(target: string, sources: readonly string[]): boolean {
  const allowed = SELECTION_ADD_SOURCE_KINDS[target as CanvasSelectionAddTarget]
  return Boolean(
    allowed && sources.length && target !== 'script' && sources.every((source) => allowed.includes(source)),
  )
}

export function getCanvasSelectionAddUnsupportedSources(target: string, sources: readonly string[]): string[] {
  const allowed = SELECTION_ADD_SOURCE_KINDS[target as CanvasSelectionAddTarget] || []
  return [...new Set(sources.filter((source) => !allowed.includes(source)))]
}
