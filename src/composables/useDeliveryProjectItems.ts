import { useEffect, useState } from 'react'
import { getManualVideoTask, listManualVideoHistory, type ManualVideoTask } from '@/api/manualVideo'
import { getWorkspacePromoOrderIds, listPromoOrders, promoOrderBelongsToWorkspace, type PromoOrder } from '@/api/promo'
import { MANUAL_DELIVERY_ENABLED, PROMO_DELIVERY_ENABLED } from '@/utils/manualDeliveryVisibility'

interface Snapshot {
  scope: string
  manual: ManualVideoTask[]
  promo: PromoOrder[]
  errors: string[]
  loading: boolean
}

/** 人工任务和订单不是项目；查询仅限当前账号与空间。 */
export function useDeliveryProjectItems(ownerId: number, workspaceId: number) {
  const scope = `${ownerId}:${workspaceId}`
  const [attempt, setAttempt] = useState(0)
  const [snapshot, setSnapshot] = useState<Snapshot>({ scope: '', manual: [], promo: [], errors: [], loading: false })
  useEffect(() => {
    if (!ownerId || !workspaceId) return
    const controller = new AbortController()
    setSnapshot({ scope, manual: [], promo: [], errors: [], loading: true })
    const loadManual = async () => {
      if (!MANUAL_DELIVERY_ENABLED) return []
      const tasks: ManualVideoTask[] = []
      const seen = new Set<number>()
      for (let offset = 0; ; ) {
        const page = await listManualVideoHistory(workspaceId, controller.signal, offset)
        if (!Array.isArray(page.items)) throw new Error('精制任务列表格式错误')
        const fresh = page.items.filter((task) => Number.isSafeInteger(task.id) && task.id > 0 && !seen.has(task.id))
        if (page.items.length && !fresh.length) throw new Error('精制任务分页未向前推进')
        fresh.forEach((task) => {
          seen.add(task.id)
          if (task.operation_code === 'video.t1') tasks.push(task)
        })
        offset += page.items.length
        if (!page.items.length || (typeof page.total === 'number' ? offset >= page.total : page.items.length < 20))
          break
      }
      let ids: number[] = []
      try {
        const stored: unknown = JSON.parse(localStorage.getItem(`zzh.manual.tasks.${ownerId}.${workspaceId}`) || '[]')
        if (Array.isArray(stored))
          ids = [...new Set(stored.filter((id): id is number => Number.isSafeInteger(id) && id > 0))]
      } catch {
        /* 忽略损坏的本地历史 */
      }
      const missing = ids.filter((id) => !tasks.some((task) => task.id === id))
      const results: PromiseSettledResult<ManualVideoTask>[] = []
      for (let index = 0; index < missing.length; index += 5) {
        controller.signal.throwIfAborted()
        results.push(
          ...(await Promise.allSettled(
            missing.slice(index, index + 5).map((id) => getManualVideoTask(workspaceId, id, controller.signal)),
          )),
        )
      }
      const unexpected = results.find(
        (item) => item.status === 'rejected' && ![403, 404].includes(Number(item.reason?.status)),
      )
      if (unexpected?.status === 'rejected') throw unexpected.reason
      return [...tasks, ...results.flatMap((item) => (item.status === 'fulfilled' ? [item.value] : []))]
    }
    const loadPromo = async () => {
      if (!PROMO_DELIVERY_ENABLED) return []
      const orders: PromoOrder[] = []
      const seen = new Set<number>()
      for (let offset = 0; ; ) {
        const page = await listPromoOrders(20, offset, controller.signal)
        if (!Array.isArray(page.items)) throw new Error('宣传片订单列表格式错误')
        const fresh = page.items.filter(
          (order) => Number.isSafeInteger(order.id) && order.id > 0 && !seen.has(order.id),
        )
        if (page.items.length && !fresh.length) throw new Error('宣传片订单分页未向前推进')
        fresh.forEach((order) => seen.add(order.id))
        orders.push(...fresh)
        offset += page.items.length
        if (!page.items.length || (typeof page.total === 'number' ? offset >= page.total : page.items.length < 20))
          break
      }
      const ids = orders.some((order) => order.workspace_id == null)
        ? await getWorkspacePromoOrderIds(workspaceId, controller.signal)
        : new Set<number>()
      return orders.filter((order) => promoOrderBelongsToWorkspace(order, workspaceId, ids))
    }
    void Promise.allSettled([loadManual(), loadPromo()]).then(([manual, promo]) => {
      if (controller.signal.aborted) return
      setSnapshot({
        scope,
        manual: manual.status === 'fulfilled' ? manual.value : [],
        promo: promo.status === 'fulfilled' ? promo.value : [],
        errors: [
          manual.status === 'rejected' ? '精制任务' : '',
          promo.status === 'rejected' ? '宣传片订单' : '',
        ].filter(Boolean),
        loading: false,
      })
    })
    return () => controller.abort()
  }, [ownerId, workspaceId, scope, attempt])
  return {
    ...(snapshot.scope === scope
      ? snapshot
      : { manual: [], promo: [], errors: [], loading: !!ownerId && !!workspaceId }),
    reload: () => setAttempt((value) => value + 1),
  }
}
