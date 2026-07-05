/**
 * 空间名称的安全校验与查重归一化。
 * 规则与「创建团队」输入框保持一致(≤20 字、非空),另加基本安全过滤(禁控制字符 / 尖括号,防注入/XSS)。
 * 供重命名(TeamManagementModal)等入口复用。
 */
export const WORKSPACE_NAME_MAX = 20

// 控制字符(0x00–0x1F,含换行/制表)与 DEL(0x7F):名称里一律不允许。
// 用码点判断而非字面量正则,避免源码里出现不可见控制字符。
function hasControlChar(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

/**
 * 校验空间名称,返回错误文案('' 表示通过)。传原值即可(内部会 trim)。
 */
export function validateWorkspaceName(name: string): string {
  const value = String(name ?? '').trim()
  if (!value) return '空间名称不能为空'
  // 按 Unicode 码点计长度,和输入框 maxLength 视觉一致(避免 emoji/代理对被算成 2)
  const len = [...value].length
  if (len > WORKSPACE_NAME_MAX) return `空间名称不能超过 ${WORKSPACE_NAME_MAX} 个字符`
  if (hasControlChar(value)) return '空间名称不能包含换行或控制字符'
  // 尖括号:防 HTML / 脚本注入
  if (/[<>]/.test(value)) return '空间名称不能包含 < 或 > 字符'
  return ''
}

/**
 * 查重用归一化:去首尾空白 + 折叠内部连续空白为单个空格 + 转小写。
 * 让「Team A」「team  a」视为同名,避免仅大小写/空格不同的重复空间名。
 */
export function normalizeWorkspaceNameForCompare(name: string): string {
  return String(name ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
}
