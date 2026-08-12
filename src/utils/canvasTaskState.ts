import { normalizeAiTaskStatus } from '@/api/business'

export interface CanvasTaskPresentation {
  running: boolean
  failed: boolean
  title: string
  detail: string
  progress?: number
}

/** 将后端真实状态翻译为用户可理解的阶段，不伪造百分比。 */
export function getCanvasTaskPresentation(args: {
  status?: unknown
  progress?: unknown
  hasResult?: boolean
  error?: unknown
}): CanvasTaskPresentation {
  const status = normalizeAiTaskStatus(args.status)
  const rawProgress = Number(args.progress)
  const progress = Number.isFinite(rawProgress) && rawProgress > 0 ? Math.min(100, Math.max(0, rawProgress)) : undefined
  const failed = [
    'failed',
    'error',
    'payment_failed',
    'cancelled',
    'expired',
    'submit_failed',
    'result_sync_failed',
  ].includes(status)
  const succeeded = ['succeeded', 'completed', 'success'].includes(status)

  if (failed) {
    return { running: false, failed: true, title: '生成失败', detail: String(args.error || '请检查设置后重试') }
  }
  if (!status || (succeeded && args.hasResult)) {
    return { running: false, failed: false, title: '', detail: '', progress }
  }
  if (status === 'submitting') {
    return { running: true, failed: false, title: '正在提交任务', detail: '等待服务确认任务', progress }
  }
  if (['pending', 'queued', 'created'].includes(status)) {
    return { running: true, failed: false, title: '已进入生成队列', detail: '等待模型开始处理', progress }
  }
  if (status === 'result_pending' || succeeded) {
    return { running: true, failed: false, title: '正在同步生成结果', detail: '任务已完成，正在读取结果', progress }
  }
  return {
    running: true,
    failed: false,
    title: '正在生成内容',
    detail: progress ? `${Math.round(progress)}%` : '模型处理中',
    progress,
  }
}
