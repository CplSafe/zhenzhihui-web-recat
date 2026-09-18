/**
 * 画布提示词里的 @参考素材 引用（纯逻辑，供 CanvasNodePanel 使用）。
 *
 * 两层口径：
 * - **界面/存储**：重命名过的参考用名字（`@天安门`），没改名的用位置号（`@图片1` / `@视频1`）——
 *   多参考时用户才分得清谁是谁。名字重复（或撞上位置号）时自动加 `(1)` `(2)` 后缀保证唯一。
 * - **提交给模型**：一律翻成位置号 `@图片N`。模型只按附图顺序理解"第几张"，看到 `@天安门`
 *   并不知道指哪张图；所以名字只活在界面，出门前换成模型认得的位置号。
 *
 * 显示文本与存储文本必须逐字一致（提示词框是"透明 textarea 叠高亮层"，二者错一字光标就对不上），
 * 因此不做"显示一个名、底下存另一个"的富标签，而是存储里就直接写 `@名字`。
 */

export interface MentionRefLike {
  edgeId: string
  kind: string
  /** 来源节点被用户重命名后的名字；未改名不带。 */
  title?: string
}

const isMediaRef = (ref: MentionRefLike) => ref.kind === 'image' || ref.kind === 'video'

/** 位置号标签（不含 @）：同类型按展示顺序编号，与下发的 input_assets 顺序一致。 */
export function buildPositionalMentionLabels(refs: MentionRefLike[]): Map<string, string> {
  const out = new Map<string, string>()
  let image = 0
  let video = 0
  for (const ref of refs) {
    if (ref.kind === 'image') out.set(ref.edgeId, `图片${++image}`)
    else if (ref.kind === 'video') out.set(ref.edgeId, `视频${++video}`)
  }
  return out
}

/**
 * 界面/存储用的 @ 标签（不含 @）：重命名过用名字，否则位置号。
 * 名字重复、或恰好撞上某个位置号（比如把节点改名成「图片2」）时，按出现顺序加 `(1)` `(2)` 后缀，
 * 保证每条参考的标签唯一——否则 `@产品` 指不清是哪张。
 */
export function buildMentionLabels(refs: MentionRefLike[]): Map<string, string> {
  const media = refs.filter(isMediaRef)
  const positional = buildPositionalMentionLabels(media)
  const positionalSet = new Set(positional.values())

  const titleCount = new Map<string, number>()
  for (const ref of media) {
    const title = String(ref.title || '').trim()
    if (title) titleCount.set(title, (titleCount.get(title) || 0) + 1)
  }

  const titleSeen = new Map<string, number>()
  const out = new Map<string, string>()
  for (const ref of media) {
    const title = String(ref.title || '').trim()
    if (!title) {
      out.set(ref.edgeId, positional.get(ref.edgeId) || '')
      continue
    }
    const duplicated = (titleCount.get(title) || 0) > 1 || positionalSet.has(title)
    if (duplicated) {
      const n = (titleSeen.get(title) || 0) + 1
      titleSeen.set(title, n)
      out.set(ref.edgeId, `${title}(${n})`)
    } else {
      out.set(ref.edgeId, title)
    }
  }
  return out
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 按「最长优先」把一组标签拼成可用于匹配 `@标签` 的正则（全局），名字带空格/标点也能精确命中。 */
export function buildMentionRegex(labels: Iterable<string>): RegExp {
  const unique = Array.from(new Set(Array.from(labels).filter(Boolean))).sort((a, b) => b.length - a.length)
  const alternatives = unique.map(escapeRegExp)
  // 位置号兜底：即便某条参考已被删、标签表里没有了，残留的 @图片N 也仍按引用样式高亮
  alternatives.push('(?:图片|视频)\\d+')
  return new RegExp(`@(?:${alternatives.join('|')})`, 'g')
}

/**
 * 单趟把提示词里的 `@旧标签` 改成 `@新标签`（新标签为空串则整个删掉）。
 * 必须单趟：删掉图片1 后「图片3→图片2、图片2→图片1」若逐条替换会级联，把 3 一路改成 1。
 */
export function rewriteMentions(text: string, mapping: Map<string, string>): string {
  const olds = Array.from(mapping.keys()).filter((label) => label && mapping.get(label) !== label)
  if (!olds.length || !text) return text
  const re = new RegExp(
    `@(${olds
      .sort((a, b) => b.length - a.length)
      .map(escapeRegExp)
      .join('|')})`,
    'g',
  )
  return text.replace(re, (_full, label: string) => {
    const next = mapping.get(label)
    return next ? `@${next}` : ''
  })
}

/**
 * 提交前把名字型引用翻成位置号：`@天安门` → `@图片1`。位置号本身原样保留；
 * 匹配不到的 `@xxx`（比如参考已被删）不硬猜、原样留给模型。
 */
export function translateMentionsToPositional(text: string, refs: MentionRefLike[]): string {
  const labels = buildMentionLabels(refs)
  const positional = buildPositionalMentionLabels(refs.filter(isMediaRef))
  const mapping = new Map<string, string>()
  for (const [edgeId, label] of labels) {
    const pos = positional.get(edgeId)
    if (pos && pos !== label) mapping.set(label, pos)
  }
  return rewriteMentions(text, mapping)
}

/**
 * 参考集合变化时，算出提示词里需要跟着改的引用：
 * - 仍在但标签变了（重命名、或前面有参考被删导致位置号前移）→ 旧标签→新标签；
 * - 已不在了 → 旧标签→''（删掉）。
 * 返回的 mapping 直接交给 rewriteMentions。
 */
export function diffMentionLabels(prev: Map<string, string>, next: Map<string, string>): Map<string, string> {
  const mapping = new Map<string, string>()
  for (const [edgeId, oldLabel] of prev) {
    const newLabel = next.get(edgeId)
    if (newLabel === undefined) mapping.set(oldLabel, '')
    else if (newLabel !== oldLabel) mapping.set(oldLabel, newLabel)
  }
  return mapping
}
