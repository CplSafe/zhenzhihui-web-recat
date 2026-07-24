/** 判断爆款复制轮询错误是否适合继续订阅同一个后端任务。 */
export function isHotCopyTransientTaskRecoveryError(error: any): boolean {
  const status = Number(error?.status || 0)
  const code = String(error?.code || '').toUpperCase()
  const message = [error?.message, error?.response?.message, error?.response?.data?.message].filter(Boolean).join(' ')

  if (
    /安全审核|内容审核|内容安全|未通过.{0,8}审核|审核未通过|敏感内容|版权限制|copyright|content policy|policy violation|moderation|safety review/i.test(
      message,
    )
  ) {
    return false
  }

  // waitForAiTask 的总等待时间已经耗尽时必须收口，不能再启动下一轮完整超时周期。
  if (/任务生成超时|AI 任务生成超时/i.test(message)) return false

  return (
    code === 'TASK_MEDIA_PENDING' ||
    status >= 500 ||
    status === 429 ||
    error?.cause === 'timeout' ||
    /任务状态查询连续失败|网络请求失败|网络请求超时|Failed to fetch|fetch failed/i.test(message)
  )
}
