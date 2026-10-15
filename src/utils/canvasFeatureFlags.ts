/**
 * 无限画布功能开关。
 *
 * 音频节点暂时不对用户开放，但不删除底层解析、同步和历史数据兼容代码。
 * 这样旧画布中已经保存的音频数据不会被前端误删，后续重新开放时也只需改一处。
 */
export const CANVAS_AUDIO_NODES_ENABLED = false

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
