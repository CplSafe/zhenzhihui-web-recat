/**
 * 画布生成任务的错误文案改写。
 *
 * 后端的报错是站在服务端视角写的（「素材类型不适用于当前操作，请检查素材角色…」），
 * 用户看不到「素材角色」这个概念，也不知道该去改什么。实际能做的动作只有一个：换模型。
 * 这里只做「说法」的替换，不改判断逻辑——判断仍以后端返回为准。
 */

/**
 * 命中即改写的规则表。
 *
 * 用关键词而不是整句匹配：后端同一类错误在不同接口上的措辞会有出入（标点、后缀不一），
 * 整句比对迟早会漏掉一种写法，用户就又看到那句原文了。
 */
const REWRITE_RULES: { match: RegExp; text: string }[] = [
  {
    // INVALID_MODEL_PARAMS：所选模型不接受这种输入素材（如把视频喂给「参考生视频」）
    match: /素材类型不适用于当前操作|素材角色|INVALID_MODEL_PARAMS/i,
    text: '当前模型暂不支持该操作，请更换其他模型',
  },
]

/** 把后端错误文案改写成用户能据此行动的说法；没有命中规则时原样返回。 */
export function humanizeCanvasTaskError(message: unknown): string {
  const text = String(message ?? '').trim()
  if (!text) return ''
  const hit = REWRITE_RULES.find((rule) => rule.match.test(text))
  return hit ? hit.text : text
}
