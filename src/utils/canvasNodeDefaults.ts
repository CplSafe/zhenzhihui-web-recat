/**
 * 新建画布节点时的默认参数继承。
 *
 * 画布上连着做几个节点时，比例往往是同一个；每加一个节点都要重新选一次是纯粹的重复劳动。
 * 这里从画布现有节点里取「上一个同类节点」的比例作为新节点默认值，
 * 用户仍可随时改——只是不必每次都改。
 *
 * 取「同类型的最后一个节点」而不是记在内存变量里：刷新页面、换标签页继续编辑时，
 * 继承关系依然成立，不需要额外的持久化。
 */

/**
 * 所选模型未声明参考图上限时的兜底槽位数。
 *
 * 「后端没声明」和「后端声明了正好是 5」是两件事：前者用这个兜底值，后者用后端给的数。
 * 前端不替模型编一个能力，所以取值来源只有 params schema 和这个显式兜底。
 */
export const DEFAULT_MAX_REFS = 5

/**
 * 视频首尾帧模式的固定槽位数：首帧 + 尾帧。
 *
 * 这是语义约束而不是数量约束——模型即便声明能收 9 张，这个模式下也没有第三张的位置，
 * 所以它不跟随模型上限。
 */
export const FIRST_LAST_REF_SLOTS = 2

/** 参与继承判定的最小节点信息。 */
export interface CanvasNodeLike {
  type?: string
  data?: Record<string, unknown>
}

/** 读取节点的类型：优先节点数据里的 kind，回落到 React Flow 的 type。 */
function nodeKindOf(node: CanvasNodeLike | undefined): string {
  if (!node) return ''
  const kind = String((node.data as Record<string, unknown> | undefined)?.kind || '').trim()
  return kind || String(node.type || '').trim()
}

/**
 * 取同类型节点里最后一个已设置的比例。
 *
 * @param nodes 画布当前节点，按创建顺序排列（React Flow 的节点数组即为此顺序）
 * @param kind  新节点类型（image / video）
 * @param fallback 画布上还没有同类节点时使用的默认值
 */
export function resolveInheritedNodeRatio(
  nodes: readonly CanvasNodeLike[] | undefined,
  kind: string,
  fallback: string,
): string {
  const targetKind = String(kind || '').trim()
  if (!targetKind) return fallback

  for (let index = (nodes?.length ?? 0) - 1; index >= 0; index -= 1) {
    const node = nodes![index]
    if (nodeKindOf(node) !== targetKind) continue
    const ratio = String((node.data as Record<string, unknown> | undefined)?.ratio || '').trim()
    // 跳过没设过比例的节点，继续往前找：它们本身就是拿默认值创建的，继承不到有效信息
    if (ratio) return ratio
  }
  return fallback
}
