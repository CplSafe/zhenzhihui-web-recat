/** 活动编辑器在系统更新刷新前同步保存最新输入。 */
const savers = new Set<() => boolean>()

export function registerUpdateDraftSaver(save: () => boolean): () => void {
  savers.add(save)
  return () => savers.delete(save)
}

export function saveDraftsBeforeUpdate(): boolean {
  let saved = true
  for (const save of savers) {
    try {
      if (!save()) saved = false
    } catch {
      saved = false
    }
  }
  return saved
}
