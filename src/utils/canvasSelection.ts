/**
 * 记住每个画布最后选中的节点（localStorage）。
 *
 * 属于本机视图状态而非文档内容：不进云端增量同步，否则会把「我选中了哪个节点」
 * 推给同画布的其他协作者。按画布 id 隔离，切换画布互不覆盖。
 */

const LAST_NODE_KEY_PREFIX = 'zzh_canvas_last_node'

/** 按画布 id 生成隔离的存储键；缺少 id 时退回公共键，避免不同画布互相污染。 */
function lastNodeKey(canvasId?: string | number): string {
  const id = String(canvasId ?? '').trim()
  return id ? `${LAST_NODE_KEY_PREFIX}_${encodeURIComponent(id)}` : LAST_NODE_KEY_PREFIX
}

/** 记录当前选中的节点；传空表示取消选中，直接清除记录。 */
export function saveLastSelectedNodeId(canvasId: string | number | undefined, nodeId: string): void {
  try {
    const key = lastNodeKey(canvasId)
    const value = String(nodeId || '').trim()
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  } catch {
    // 隐私模式/存储写满时忽略：记不住选中态不影响画布本身可用
  }
}

/** 读取上次选中的节点 id；无记录返回空串。 */
export function loadLastSelectedNodeId(canvasId?: string | number): string {
  try {
    return String(localStorage.getItem(lastNodeKey(canvasId)) || '').trim()
  } catch {
    return ''
  }
}

/** 画布被删除或需要重置时清掉记录，避免残留指向已不存在的节点。 */
export function clearLastSelectedNodeId(canvasId?: string | number): void {
  try {
    localStorage.removeItem(lastNodeKey(canvasId))
  } catch {
    // 同上：清理失败不影响主流程
  }
}

/**
 * 小地图显示与否。
 *
 * 与选中节点不同，这个偏好不按画布隔离：用户关掉小地图是「我不想要这个面板」，
 * 而不是「这张画布不想要」，逐画布记会让他每开一张新画布都得再关一次。
 */
const MINIMAP_KEY = 'zzh_canvas_minimap_visible'

/** 读取小地图偏好；没有记录时默认显示，保持与既有行为一致。 */
export function loadMinimapVisible(): boolean {
  try {
    const raw = localStorage.getItem(MINIMAP_KEY)
    return raw === null ? true : raw === '1'
  } catch {
    return true
  }
}

/** 记录小地图偏好。 */
export function saveMinimapVisible(visible: boolean): void {
  try {
    localStorage.setItem(MINIMAP_KEY, visible ? '1' : '0')
  } catch {
    // 隐私模式/存储写满时忽略：记不住偏好不影响画布本身可用
  }
}
