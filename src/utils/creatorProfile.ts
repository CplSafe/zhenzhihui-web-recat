/** 创作者档案暂存于当前账号的浏览器存储，接口接入后可替换此适配层。 */
export type CreatorProfile = Record<string, string>

export function creatorProfileKey(owner: string): string {
  return owner ? `zzh.script-creator-profile.v1.${owner}` : ''
}

export function readCreatorProfile(owner: string): CreatorProfile | null {
  const key = creatorProfileKey(owner)
  if (!key) return null
  try {
    const data = JSON.parse(localStorage.getItem(key) || 'null')
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null
    const required = ['真实姓名', '身份类型', '学校 / 机构', '联系手机', '联系邮箱', '擅长题材（可多选）']
    return required.every((name) => typeof data[name] === 'string' && data[name].trim()) ? data : null
  } catch {
    return null
  }
}
