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
