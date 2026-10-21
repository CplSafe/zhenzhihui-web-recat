/**
 * 无限画布功能开关。
 *
 * 音频节点入口、素材和历史结果统一开放；生成能力仍由后端模型目录决定。
 */
export const CANVAS_AUDIO_NODES_ENABLED = true

/** 后端素材类型可能是 audio、音频或 MIME type，统一判断。 */
export function isCanvasAudioKind(value: unknown): boolean {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
  return normalized === 'audio' || normalized === '音频' || normalized.startsWith('audio/')
}

/** 用在菜单、节点、素材和搜索结果的统一可见性判断。 */
export function isCanvasAudioEntryVisible(value: unknown): boolean {
  return CANVAS_AUDIO_NODES_ENABLED || !isCanvasAudioKind(value)
}
