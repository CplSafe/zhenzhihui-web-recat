import { useCallback, useEffect, useRef, useState } from 'react'
import { Modal } from 'antd'
import StepProgress from '@/components/smart/StepProgress'
import {
  canRefundPromoOrder,
  getPromoMaterialDownload,
  getPromoOrder,
  getWorkspacePromoOrderIds,
  promoOrderBelongsToWorkspace,
  listPromoOrders,
  refundPromoOrder,
  reworkPromoOrder,
  type PromoOrder,
} from '@/api/promo'
import { useWorkspaceSessionStore } from '@/stores/workspaceSession'
import { sanitizeMediaUrl } from '@/utils/urlSafety'
import styles from './PromoOrders.module.css'

const labels: Record<string, string> = {
  pending: '团队制作中',
  producing: '团队制作中',
  reworking: '返工中',
  overdue: '制作中，顾问会主动联系你',
  delivered: '成片已就绪',
  completed: '已完成',
  cancelled: '已取消',
}
const billing: Record<string, string> = { frozen: '已冻结', settled: '已结算', refunded: '已退回' }
const rework: Record<string, string> = {
  requested: '待受理',
  accepted: '已受理',
  rejected: '已婉拒',
  fulfilled: '返工已交付',
}

interface Props {
  workspaceId: number
  onClose: () => void
  initialOrderId?: number
  serviceTel?: string
}

/** 真实宣传片订单；服务端是状态、费用与操作权限的唯一来源。 */
export default function PromoOrders({ workspaceId, onClose, initialOrderId, serviceTel }: Props) {
  const [items, setItems] = useState<PromoOrder[]>([])
  const [offset, setOffset] = useState(0)
  const [total, setTotal] = useState(0)
  const [hasUnfinished, setHasUnfinished] = useState(false)
  const [selected, setSelected] = useState<number | null>(initialOrderId || null)
  const [order, setOrder] = useState<PromoOrder | null>(null)
  const [videoUrl, setVideoUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionNotice, setActionNotice] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [confirm, setConfirm] = useState<'refund' | 'rework' | null>(null)
  const [reload, setReload] = useState(0)
  const refreshWallet = useWorkspaceSessionStore((state) => state.loadSubscriptionLabel)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    setOrder(null)
    setVideoUrl('')
    const run = async () => {
      try {
        if (selected === null) {
          const [result, ids] = await Promise.all([
            listPromoOrders(20, offset, controller.signal),
            getWorkspacePromoOrderIds(workspaceId, controller.signal),
          ])
          if (!controller.signal.aborted) {
            const scopedItems = result.items.filter((item) => promoOrderBelongsToWorkspace(item, workspaceId, ids))
            setItems(scopedItems)
            setTotal(result.total)
            setHasUnfinished(
              scopedItems.some((item) => ['pending', 'producing', 'reworking', 'overdue'].includes(item.status)),
            )
          }
        } else {
          const result = await getPromoOrder(selected, controller.signal)
          const ids =
            result.order.workspace_id == null
              ? await getWorkspacePromoOrderIds(workspaceId, controller.signal)
              : new Set<number>()
          if (!promoOrderBelongsToWorkspace(result.order, workspaceId, ids)) throw new Error('该订单不属于当前工作空间')
          if (!controller.signal.aborted) setOrder(result.order)
        }
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '订单加载失败，请重试')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void run()
    return () => controller.abort()
  }, [selected, workspaceId, reload, offset])

  useEffect(() => {
    if (!order || !['pending', 'producing', 'reworking', 'overdue'].includes(order.status)) return
    const timer = window.setTimeout(() => setReload((value) => value + 1), 45000)
    return () => window.clearTimeout(timer)
  }, [order])

  const loadVideo = useCallback(
    async (signal?: AbortSignal) => {
      if (!order?.delivered_material_id) return
      try {
        const result = await getPromoMaterialDownload(order.delivered_material_id, signal)
        if (!signal?.aborted) {
          const safeUrl = sanitizeMediaUrl(result.download_url)
          if (!safeUrl) throw new Error('视频地址无效，请重试')
          setVideoUrl(safeUrl)
          setError('')
        }
      } catch (reason) {
        if (!signal?.aborted) setError(reason instanceof Error ? reason.message : '视频地址获取失败')
      }
    },
    [order?.delivered_material_id],
  )

  useEffect(() => {
    const controller = new AbortController()
    if (order?.delivered_material_id) void loadVideo(controller.signal)
    return () => controller.abort()
  }, [order?.delivered_material_id, loadVideo])

  const submit = async () => {
    if (!order || busyRef.current || !confirm) return
    busyRef.current = true
    setBusy(true)
    setError('')
    setActionNotice('')
    try {
      if (confirm === 'refund') {
        if (!canRefundPromoOrder(order)) throw new Error('订单状态已变化，请刷新后重试')
        await refundPromoOrder(order.id)
        void refreshWallet({ force: true })
      } else {
        if (!order.can_rework || !note.trim()) throw new Error('订单当前不能申请修改')
        await reworkPromoOrder(order.id, note.trim())
        setNote('')
      }
      setConfirm(null)
      setReload((value) => value + 1)
    } catch (reason) {
      setConfirm(null)
      setOrder(null)
      setActionNotice(
        `操作结果未确认：${reason instanceof Error ? reason.message : '请求失败'}。请查看刷新后的订单状态，再决定是否操作。`,
      )
      setReload((value) => value + 1)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <section className={selected === null ? styles.panel : styles.workflow} aria-label="真实宣传片订单">
      {selected !== null && (
        <div className={`smart__progress ${styles.steps}`}>
          <StepProgress
            steps={[
              { key: 'material', label: '需求与素材' },
              { key: 'confirm', label: '确认并提交' },
              { key: 'produce', label: '制作中' },
              { key: 'delivery', label: '交付验收' },
            ]}
            current={order && ['delivered', 'completed'].includes(order.status) ? 3 : 2}
          />
        </div>
      )}
      <div className={styles.heading}>
        <h1>{selected === null ? '宣传片订单' : `宣传片订单 #${selected}`}</h1>
        <button type="button" onClick={selected === null ? onClose : () => setSelected(null)}>
          {selected === null ? '返回' : '返回订单列表'}
        </button>
      </div>
      {actionNotice && <p role="status">{actionNotice}</p>}
      {loading && <p role="status">正在加载订单…</p>}
      {error && (
        <p role="alert">
          {error}{' '}
          <button type="button" onClick={() => setReload((v) => v + 1)}>
            重试
          </button>
        </p>
      )}
      {!loading && !error && selected === null && !items.length && (
        <p>{total > 20 ? '当前页暂无本空间订单，可翻页查看。' : '暂无宣传片订单。'}</p>
      )}
      {selected === null && hasUnfinished && <p>您有未完成的订单，仍可继续下单。</p>}
      {selected === null &&
        items.map((item) => (
          <button className={styles.row} type="button" key={item.id} onClick={() => setSelected(item.id)}>
            <span>订单 #{item.id}</span>
            <span>{item.is_overdue ? labels.overdue : labels[item.status] || item.status}</span>
          </button>
        ))}
      {selected === null && total > 20 && (
        <div>
          <button type="button" disabled={loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}>
            上一页
          </button>
          <span>
            {' '}
            {offset + 1}–{Math.min(offset + 20, total)} / {total}{' '}
          </span>
          <button type="button" disabled={loading || offset + 20 >= total} onClick={() => setOffset(offset + 20)}>
            下一页
          </button>
        </div>
      )}
      {selected !== null &&
        order &&
        (['delivered', 'completed'].includes(order.status) ? (
          <div className={styles.delivery}>
            <div>
              {order.is_overdue && <p role="status">制作中，顾问会主动联系你</p>}
              {videoUrl ? (
                <video
                  className={styles.video}
                  controls
                  src={videoUrl}
                  aria-label="宣传片成片"
                  onError={() => setVideoUrl('')}
                />
              ) : (
                <div className={styles.videoPlaceholder}>成片视频暂不可用</div>
              )}
              <div className={styles.downloadBar}>
                <div>
                  <b>宣传片成片</b>
                  <p>
                    {order.duration_seconds ? `${order.duration_seconds} 秒` : '时长待确认'} ·{' '}
                    {order.resolution || '分辨率待确认'}
                  </p>
                </div>
                {videoUrl && (
                  <a className={styles.primary} href={videoUrl} download>
                    下载视频
                  </a>
                )}
                <button type="button" onClick={() => void loadVideo()}>
                  {videoUrl ? '刷新视频地址' : '加载成片'}
                </button>
              </div>
              <dl className={styles.deliveryInfo}>
                <div>
                  <dt>承诺交付</dt>
                  <dd>{order.promised_date || '待确定'}</dd>
                </div>
                <div>
                  <dt>实际交付</dt>
                  <dd>
                    {order.delivered_at
                      ? new Date(order.delivered_at).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })
                      : '—'}
                  </dd>
                </div>
                <div>
                  <dt>成品</dt>
                  <dd>1 条 · {order.resolution || '—'}</dd>
                </div>
                <div>
                  <dt>修改权益</dt>
                  <dd>{order.can_rework ? '可申请修改' : '以订单状态为准'}</dd>
                </div>
              </dl>
            </div>
            <aside>
              {order.can_rework && (
                <section className={styles.sidePanel}>
                  <h2>不满意？提 1 次修改</h2>
                  <p>可申请一次免费修改，提交后等待受理。</p>
                  <label htmlFor="promo-rework-note">修改意见</label>
                  <textarea id="promo-rework-note" value={note} onChange={(event) => setNote(event.target.value)} />
                  <button
                    className={styles.primary}
                    type="button"
                    disabled={!note.trim() || busy}
                    onClick={() => setConfirm('rework')}
                  >
                    申请免费修改
                  </button>
                </section>
              )}
              {order.rework_status && (
                <section className={styles.sidePanel}>
                  <h2>修改状态</h2>
                  <p>{rework[order.rework_status] || order.rework_status}</p>
                  {order.rework_text && <p>修改意见：{order.rework_text}</p>}
                  {order.rework_reply && <p>回复：{order.rework_reply}</p>}
                </section>
              )}
              <section className={styles.sidePanel}>
                <h2>还要别的版本？</h2>
                <p>需要其他版本可重新提交需求。</p>
                <button type="button" onClick={onClose}>
                  再下一单
                </button>
              </section>
              {serviceTel && (
                <section className={styles.sidePanel}>
                  <h2>联系客服</h2>
                  <a href={`tel:${serviceTel}`}>{serviceTel}</a>
                </section>
              )}
            </aside>
            <div className={styles.billingLine}>积分状态：{billing[order.billing_status] || order.billing_status}</div>
          </div>
        ) : (
          <div className={styles.wait}>
            <div className={styles.waitVisual}>
              {['pending', 'producing', 'reworking', 'overdue'].includes(order.status) && (
                <span className={styles.spinner} aria-hidden="true" />
              )}
              <strong>{order.is_overdue ? labels.overdue : labels[order.status] || order.status}</strong>
              <span>订单编号 {order.id}</span>
            </div>
            <h2>
              {order.status === 'cancelled'
                ? '订单已取消'
                : order.status === 'reworking'
                  ? '修改制作中'
                  : '宣传片制作中'}
            </h2>
            <p>
              承诺交付日期：{order.promised_date || '待确定'}
              <br />
              积分状态：{billing[order.billing_status] || order.billing_status}
            </p>
            {order.rework_status && <p>修改状态：{rework[order.rework_status] || order.rework_status}</p>}
            {order.rework_text && <p>修改意见：{order.rework_text}</p>}
            {order.rework_reply && <p>回复：{order.rework_reply}</p>}
            {order.status !== 'cancelled' && (
              <div className={styles.phase}>
                <span>已提交</span>
                <span>制作中</span>
                <span>交付</span>
              </div>
            )}
            {serviceTel && (
              <p className={styles.hotline}>
                联系客服：<a href={`tel:${serviceTel}`}>{serviceTel}</a>
              </p>
            )}
            <div className={styles.waitActions}>
              <button type="button" onClick={() => setReload((v) => v + 1)}>
                刷新状态
              </button>
              {canRefundPromoOrder(order) && (
                <button type="button" disabled={busy} onClick={() => setConfirm('refund')}>
                  申请退回积分
                </button>
              )}
            </div>
          </div>
        ))}
      <Modal
        open={confirm !== null}
        title={confirm === 'refund' ? '确认退回积分？' : '确认申请修改？'}
        okText="确认"
        cancelText="取消"
        confirmLoading={busy}
        closable={!busy}
        maskClosable={!busy}
        onCancel={() => !busy && setConfirm(null)}
        onOk={() => void submit()}
      >
        <p>{confirm === 'refund' ? '将全额退回积分并终止制作。' : '本次修改免费，提交后等待团队受理。'}</p>
        {error && <p role="alert">{error}</p>}
      </Modal>
    </section>
  )
}
