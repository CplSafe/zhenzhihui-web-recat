/**
 * 推广邀请码(invite_code)捕获与读取。
 * 分享链接形如 /login?invite_code=ZZH-XXXX;新用户带此参数进站注册时,把它作为推广来源传给注册接口。
 * 进站即从 URL 捕获并暂存(sessionStorage),避免后续路由跳转丢掉 query;注册成功后清除。
 */
const KEY = 'zzh_invite_code'

/** 进站时调用:URL 带 invite_code 就暂存,供后续注册读取(即便之后跳转丢了 query)。 */
export function captureInviteCode(): void {
  try {
    const code = String(new URLSearchParams(window.location.search).get('invite_code') || '').trim()
    if (code) sessionStorage.setItem(KEY, code)
  } catch {
    /* 忽略(隐私模式等) */
  }
}

/** 注册时读取:优先当前 URL,其次暂存值。 */
export function getInviteCode(): string {
  try {
    const fromUrl = String(new URLSearchParams(window.location.search).get('invite_code') || '').trim()
    if (fromUrl) {
      sessionStorage.setItem(KEY, fromUrl)
      return fromUrl
    }
    return String(sessionStorage.getItem(KEY) || '').trim()
  } catch {
    return ''
  }
}

/** 注册成功后清除,避免后续误归因。 */
export function clearInviteCode(): void {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    /* 忽略 */
  }
}
