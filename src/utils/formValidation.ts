/** 中国大陆手机号：11 位数字，以 13–19 号段开头。 */
export function isValidMobile(value: string): boolean {
  return /^1[3-9]\d{9}$/.test(value.trim())
}

/** 选填链接为空时有效；填写时须为完整的 HTTP(S) 链接。 */
export function isValidOptionalHttpUrl(value: string): boolean {
  const text = value.trim()
  if (!text) return true
  if (/\s/.test(text) || !/^https?:\/\//i.test(text)) return false
  try {
    const url = new URL(text)
    return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname)
  } catch {
    return false
  }
}
