export const cardFields = [
  '中文剧名',
  '英文剧名',
  '一卡覆盖集数',
  '免费段最强付费卡点',
  '中文完整版剧情简介',
  '核心卖点',
  '人物小传',
  '分集大纲与付费卡点',
] as const
export type CardValues = Record<string, string>
const prefix = '一卡信息（结构化正文）\n'
export function parseCardContent(content: string): CardValues | null {
  if (!content.startsWith(prefix)) return null
  try {
    const value: unknown = JSON.parse(content.slice(prefix.length))
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const values = value as Record<string, unknown>
    return Object.fromEntries(
      cardFields.map((field) => [field, typeof values[field] === 'string' ? values[field] : '']),
    )
  } catch {
    return null
  }
}
export function formatCardContent(values: CardValues) {
  return prefix + JSON.stringify(Object.fromEntries(cardFields.map((field) => [field, values[field] || ''])), null, 2)
}
export function readableCardContent(content: string) {
  const values = parseCardContent(content)
  return values ? cardFields.map((field) => `${field}：${values[field] || '—'}`).join('\n\n') : content
}

export const scriptFields = [
  '中文剧名',
  '题材',
  '预计集数',
  '单集最短时长',
  '单集最长时长',
  '首个付费解锁集',
  '重点付费 / 追更节点',
  '分幕大纲',
  '世界观与核心规则',
] as const
const scriptPrefix = '剧本信息（结构化正文）\n'
export function parseScriptContent(content: string): CardValues | null {
  if (!content.startsWith(scriptPrefix)) return null
  try {
    const value: unknown = JSON.parse(content.slice(scriptPrefix.length))
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const values = value as Record<string, unknown>
    return Object.fromEntries(
      scriptFields.map((field) => [field, typeof values[field] === 'string' ? values[field] : '']),
    )
  } catch {
    return null
  }
}
export function formatScriptContent(values: CardValues) {
  return (
    scriptPrefix +
    JSON.stringify(Object.fromEntries(scriptFields.map((field) => [field, values[field] || ''])), null, 2)
  )
}
const revisionPrefix = '完善剧本（结构化正文）\n'
export type RevisionContent = { description: string; body: string; original: boolean }
export function parseRevisionContent(content: string): RevisionContent | null {
  if (!content.startsWith(revisionPrefix)) return null
  try {
    const value = JSON.parse(content.slice(revisionPrefix.length))
    return typeof value?.description === 'string' &&
      typeof value?.body === 'string' &&
      typeof value?.original === 'boolean'
      ? value
      : null
  } catch {
    return null
  }
}
export function formatRevisionContent(value: RevisionContent) {
  return revisionPrefix + JSON.stringify(value, null, 2)
}
export function readableStageContent(content: string) {
  const revision = parseRevisionContent(content)
  if (revision)
    return `本次修改说明：${revision.description}\n\n剧本正文：\n${revision.body}\n\n原创声明：${revision.original ? '已确认' : '未确认'}`
  const values = parseScriptContent(content)
  return values
    ? scriptFields.map((field) => `${field}：${values[field] || '—'}`).join('\n\n')
    : readableCardContent(content)
}
