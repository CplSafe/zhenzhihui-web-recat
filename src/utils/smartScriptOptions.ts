/** “爆款脚本自动生成”下拉菜单对用户展示并写入新草稿的广告类型。 */
export const SMART_SCRIPT_OPTIONS = ['电商广告', '本地生活广告'] as const

export type SmartScriptOption = (typeof SMART_SCRIPT_OPTIONS)[number]

/** 兼容更名前已经写入本地或云端草稿的旧 SKILL 名称。 */
const LEGACY_SMART_SCRIPT_NAMES: Record<string, SmartScriptOption> = {
  信息电商Skill: '电商广告',
  本地生活Skill: '本地生活广告',
  信息电商智能脚本: '电商广告',
  本地生活智能脚本: '本地生活广告',
}

/** 界面辅助行清理时同时识别新旧名称，避免旧文案残留在真实创作需求中。 */
export const ALL_SMART_SCRIPT_NAMES = [
  ...SMART_SCRIPT_OPTIONS,
  ...Object.keys(LEGACY_SMART_SCRIPT_NAMES),
] as readonly string[]

/** 将旧草稿名称迁移到当前展示名称；未知值原样保留，便于后续扩展。 */
export function normalizeSmartScriptName(value?: string | null): string {
  const name = String(value || '').trim()
  return LEGACY_SMART_SCRIPT_NAMES[name] || name
}
