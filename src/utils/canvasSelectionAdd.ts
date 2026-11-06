/**
 * 框选多节点「+」菜单的来源类型规则。
 *
 * 规则只作用于批量下游创建入口；普通拖线和单节点「添加下一步」继续使用
 * CanvasView 中的 allowedSourceKinds，避免把矩阵限制误当成全局接口能力。
 */
export type CanvasSelectionAddTarget = 'text' | 'image' | 'video' | 'timeline' | 'audio' | 'audio-editor' | 'script'

const SELECTION_ADD_SOURCE_KINDS: Record<CanvasSelectionAddTarget, readonly string[]> = {
  // 新节点保留来源，所选模型在生成前校验媒体能力。
  text: ['text', 'image', 'video', 'timeline'],
  image: ['text', 'image'],
  // 新节点先保留所有来源，所选模型的素材类型与数量在节点面板中校验。
  video: ['text', 'image', 'video', 'timeline', 'audio'],
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
