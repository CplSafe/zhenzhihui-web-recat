/** 画布名称上限（与新建 / 编辑弹窗的 maxLength 一致）。 */
export const CANVAS_TITLE_MAX_LENGTH = 60

const COPY_SUFFIX = '-副本'

/**
 * 生成画布副本名称：「原名-副本」，已存在时依次尝试「原名-副本2」「原名-副本3」…
 * 对副本再复制时先去掉已有的副本后缀，避免叠成「原名-副本-副本」。
 * 超长时截断原名部分，保证后缀完整且总长不超过上限。
 */
export function buildCanvasCopyTitle(title: string | undefined, existingTitles: Iterable<string | undefined>): string {
  const base =
    String(title || '')
      .trim()
      .replace(/-副本\d*$/, '') || '未命名画布'
  const taken = new Set<string>()
  for (const existing of existingTitles) {
    const normalized = String(existing || '').trim()
    if (normalized) taken.add(normalized)
  }
  for (let index = 1; ; index += 1) {
    const suffix = index === 1 ? COPY_SUFFIX : `${COPY_SUFFIX}${index}`
    const candidate = `${base.slice(0, CANVAS_TITLE_MAX_LENGTH - suffix.length)}${suffix}`
    if (!taken.has(candidate)) return candidate
  }
}
