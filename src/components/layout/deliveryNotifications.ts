import { getManualVideoTask, listManualVideoHistory } from '@/api/manualVideo'
import { getWorkspacePromoOrderIds, listPromoOrders, promoOrderBelongsToWorkspace } from '@/api/promo'
import type { NotificationItem } from './NotificationBell'

const manualStatuses: Record<string, string> = {
  awaiting_manual: '等待制作',
  manual_processing: '制作中',
  succeeded: '已交付',
  failed: '制作失败',
  cancelled: '已取消',
}
const promoStatuses: Record<string, string> = {
  pending: '等待制作',
  producing: '制作中',
  reworking: '修改中',
  overdue: '已逾期',
  delivered: '已交付',
  completed: '已完成',
  cancelled: '已取消',
}
const reworkStatuses: Record<string, string> = {
  requested: '修改待受理',
  accepted: '修改已受理',
  rejected: '修改未通过',
  fulfilled: '修改已交付',
}

function time(value: unknown): number {
  if (typeof value !== 'string' && typeof value !== 'number') return 0
  const result = new Date(value).getTime()
  return Number.isFinite(result) ? result : 0
}

function notice(kind: 't1' | 't5', workspaceId: number, record: Record<string, any>): NotificationItem | null {
  const id = Number(record.id)
  const status =
    kind === 't1'
      ? manualStatuses[record.status]
      : reworkStatuses[record.rework_status] || (record.is_overdue ? '已逾期' : promoStatuses[record.status])
  if (!Number.isSafeInteger(id) || id <= 0 || !status) return null
  const ts = time(record.updated_at || record.delivered_at || record.created_at)
  const label = kind === 't1' ? 'T+1 精制任务' : 'T+5 宣传片订单'
  return {
    key: `delivery-${workspaceId}-${kind}-${id}-${record.status}-${record.rework_status || ''}-${record.billing_status || ''}-${record.is_overdue === true ? 'overdue' : ''}`,
    title: `${label} ${status}`,
    text: `${label} #${id}：${status}${kind === 't5' && record.company ? ` · ${record.company}` : ''}`,
    tone: ['failed', 'cancelled', 'overdue'].includes(record.status)
      ? 'warning'
      : ['succeeded', 'delivered', 'completed'].includes(record.status)
        ? 'success'
        : 'info',
    href: kind === 't1' ? `/smart?manualTask=${id}` : `/promo?order=${id}`,
    ts,
    dateLabel: ts ? new Date(ts).toLocaleString('zh-CN') : '',
    delivery: { kind, id },
  }
}

export async function loadManualDeliveryNotifications(
  workspaceId: number,
  signal?: AbortSignal,
  ownerId = 0,
): Promise<NotificationItem[]> {
  const result = await listManualVideoHistory(workspaceId, signal)
  if (!Array.isArray(result.items)) throw new Error('精制任务列表格式错误')
  const known = result.items.filter((task) => task.operation_code === 'video.t1')
  let localIds: number[] = []
  if (ownerId > 0) {
    try {
      const ids: unknown = JSON.parse(localStorage.getItem(`zzh.manual.tasks.${ownerId}.${workspaceId}`) || '[]')
      if (Array.isArray(ids))
        localIds = ids.filter((id): id is number => Number.isSafeInteger(id) && id > 0).slice(0, 20)
    } catch {
      /* 本地历史不可用时仍展示服务端明确标识的任务 */
    }
  }
  const missingIds = [...new Set(localIds)].filter((id) => !known.some((task) => task.id === id))
  const results = await Promise.allSettled(missingIds.map((id) => getManualVideoTask(workspaceId, id, signal)))
  const unexpectedFailure = results.find(
    (result) => result.status === 'rejected' && ![403, 404].includes(Number(result.reason?.status)),
  )
  if (unexpectedFailure?.status === 'rejected') throw unexpectedFailure.reason
  const local = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
  return [...known, ...local]
    .map((task) => notice('t1', workspaceId, task))
    .filter((item): item is NotificationItem => item !== null)
}

export async function loadPromoDeliveryNotifications(
  workspaceId: number,
  signal?: AbortSignal,
): Promise<NotificationItem[]> {
  const result = await listPromoOrders(20, 0, signal)
  if (!Array.isArray(result.items)) throw new Error('宣传片订单列表格式错误')
  const ids = result.items.some((order) => order.workspace_id == null)
    ? await getWorkspacePromoOrderIds(workspaceId, signal)
    : new Set<number>()
  return result.items
    .filter((order) => promoOrderBelongsToWorkspace(order, workspaceId, ids))
    .map((order) => notice('t5', workspaceId, order))
    .filter((item): item is NotificationItem => item !== null)
}
