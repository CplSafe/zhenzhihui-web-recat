import { useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { getWorkspacePromoOrderIds, listPromoOrders, promoOrderBelongsToWorkspace, type PromoOrder } from '@/api/promo'
import { promoCredits, usePromoDemoStore } from '@/stores/promoDemo'
import styles from './PromoTaskList.module.css'
import DeliveryTaskCard from './DeliveryTaskCard'

export default function PromoTaskList({
  ownerId,
  workspaceId,
  activeOnly = false,
  onPresenceChange,
}: {
  ownerId: number
  workspaceId: number
  activeOnly?: boolean
  onPresenceChange?: (present: boolean) => void
}) {
  const navigate = useNavigate()
  const tasks = usePromoDemoStore((state) => state.tasks)
  const [orders, setOrders] = useState<PromoOrder[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [offset, setOffset] = useState(0)
  const [total, setTotal] = useState(0)
  useEffect(() => {
    if (!ownerId || !workspaceId) return
    const controller = new AbortController()
    if (offset === 0) setOrders([])
    setError('')
    setLoading(true)
    void Promise.all([
      listPromoOrders(20, offset, controller.signal),
      getWorkspacePromoOrderIds(workspaceId, controller.signal),
    ])
      .then(([result, ids]) => {
        if (!controller.signal.aborted) {
          setOrders((old) =>
            offset === 0
              ? result.items.filter((order) => promoOrderBelongsToWorkspace(order, workspaceId, ids))
              : [
                  ...old,
                  ...result.items.filter(
                    (order) =>
                      promoOrderBelongsToWorkspace(order, workspaceId, ids) &&
                      !old.some((item) => item.id === order.id),
                  ),
                ],
          )
          setTotal(result.total)
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '订单加载失败')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [ownerId, workspaceId, attempt, offset])
  const visible = tasks.filter(
    (task) =>
      ownerId > 0 &&
      workspaceId > 0 &&
      task.ownerId === ownerId &&
      task.workspaceId === workspaceId &&
      (!activeOnly || ['待交接', '制作中', '返工中', '逾期'].includes(task.status)),
  )
  const real = activeOnly
    ? orders.filter((order) => ['pending', 'producing', 'reworking', 'overdue'].includes(order.status))
    : orders
  const present = !!(visible.length || real.length || loading || error || offset + 20 < total)
  useEffect(() => {
    onPresenceChange?.(present)
  }, [onPresenceChange, present])
  if (!present && activeOnly) return null
  if (!visible.length && !real.length && !loading && !error && offset + 20 >= total)
    return (
      <div className={styles.empty}>
        暂无宣传片任务
        <br />
        提交需求后可在这里查看。
      </div>
    )
  return (
    <div className={styles.list}>
      {loading && <div role="status">正在加载宣传片订单…</div>}
      {error && (
        <div role="alert">
          {error}{' '}
          <button type="button" onClick={() => setAttempt((value) => value + 1)}>
            重试
          </button>
        </div>
      )}
      {real.map((order) => (
        <DeliveryTaskCard
          key={`order-${order.id}`}
          title={order.company || `宣传片订单 #${order.id}`}
          status={
            order.is_overdue
              ? '制作中，顾问会主动联系你'
              : (
                  {
                    pending: '团队制作中',
                    producing: '团队制作中',
                    reworking: '返工中',
                    overdue: '制作中，顾问会主动联系你',
                    delivered: '成片已就绪',
                    completed: '已完成',
                    cancelled: '已取消',
                  } as Record<string, string>
                )[order.status] || order.status
          }
          meta={`T+5 · ${order.promised_date ? `承诺交付 ${order.promised_date}` : `订单 #${order.id}`}`}
          onOpen={() => navigate(`/promo?order=${order.id}`)}
        />
      ))}
      {offset + 20 < total && (
        <button type="button" disabled={loading || !!error} onClick={() => setOffset((value) => value + 20)}>
          加载更多订单
        </button>
      )}
      {visible.map((task) => (
        <DeliveryTaskCard
          key={task.id}
          title={`${task.scene} · ${task.org}（演示）`}
          status={task.status}
          meta={`T+5 演示 · ${task.duration / 60} 分钟 · ${promoCredits(task.duration).toLocaleString()} 积分（模拟）`}
          onOpen={() => navigate(`/promo?task=${encodeURIComponent(task.id)}`)}
        />
      ))}
    </div>
  )
}
