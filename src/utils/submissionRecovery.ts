/** 明确的客户端请求拒绝才允许用户修改后发起新请求；冲突及服务异常仍保留原幂等键。 */
export function isDefiniteSubmissionRejection(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('status' in error)) return false
  const status = Number(error.status)
  return [400, 401, 402, 403, 404, 405, 413, 415, 422].includes(status)
}
