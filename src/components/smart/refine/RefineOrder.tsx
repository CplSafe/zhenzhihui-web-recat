import { Modal } from 'antd'
import { useState } from 'react'
import { formatRefineDuration, type RefineDuration } from '@/utils/refineDelivery'
import styles from './RefineOrder.module.less'

/** 由调用方提供的有效服务端报价与订单参数。 */
export interface RefineOrderSnapshot {
  duration: RefineDuration
  script: string
  ratio: string
  resolution: string
  referenceModel: string
  count: number
  deliveryTime: string
  credits: number
}

interface RefineOrderProps {
  order: RefineOrderSnapshot
  submitting?: boolean
  error?: string
  onEdit: () => void
  onConfirm: () => void
}

/** 展示同一份订单快照；提交及冻结由调用方的服务端契约处理。 */
export default function RefineOrder({ order, submitting = false, error, onEdit, onConfirm }: RefineOrderProps) {
  const [confirming, setConfirming] = useState(false)
  const duration = formatRefineDuration(order.duration)
  const credits = order.credits.toLocaleString('zh-CN')
  const details = [
    ['制作方式', '精制交付'],
    ['爆款脚本', order.script],
    ['画面比例 / 分辨率', `${order.ratio} · ${order.resolution}`],
    ['成片时长', duration],
    ['参考底模', order.referenceModel],
    ['生成条数', `${order.count} 条`],
    ['交付时效', order.deliveryTime],
    ['本次消耗', `${credits} 积分（交付才扣）`],
  ]

  return (
    <div className={styles.orderPage}>
      <section className={`${styles.section} ${styles.parameters}`} aria-labelledby="refine-parameters-title">
        <div className={styles.heading}>
          <h2 id="refine-parameters-title">本次生成参数</h2>
          <button type="button" className={styles.secondary} onClick={onEdit} disabled={submitting}>
            修改
          </button>
        </div>
        <dl className={styles.details}>
          {details.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className={`${styles.section} ${styles.order}`} aria-labelledby="refine-order-title">
        <div className={styles.orderHead}>
          <h2 id="refine-order-title">精制成片</h2>
          <span>T+1 交付</span>
        </div>
        <p className={styles.promise}>{order.deliveryTime}交付</p>
        <dl className={styles.orderDetails}>
          <div>
            <dt>成片时长</dt>
            <dd>{duration}</dd>
          </div>
          <div>
            <dt>制作方式</dt>
            <dd>系统精制</dd>
          </div>
          <div className={styles.total}>
            <dt>本次冻结</dt>
            <dd>
              <strong>{credits}</strong> 积分 <small>交付才扣</small>
            </dd>
          </div>
        </dl>
        <div className={styles.explanation}>
          <h3>提交后会发生什么</h3>
          <ul>
            <li>成片会在 {order.deliveryTime}出现在任务里，点开就能看、能下载。</li>
            <li>不满意可以提出修改，重新排期。</li>
            <li>超时没交，积分全额退回。</li>
          </ul>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.primary} disabled={submitting} onClick={() => setConfirming(true)}>
            提交精制任务（T+1）
          </button>
        </div>
      </section>
      <Modal
        open={confirming}
        title="确认提交精制任务？"
        okText="确认提交"
        cancelText="取消"
        confirmLoading={submitting}
        closable={!submitting}
        maskClosable={!submitting}
        keyboard={!submitting}
        cancelButtonProps={{ disabled: submitting }}
        okButtonProps={{ disabled: submitting }}
        onCancel={() => setConfirming(false)}
        onOk={() => {
          if (!submitting) onConfirm()
        }}
      >
        <p>{order.deliveryTime}交付成片，到时在任务里点开就能看。</p>
        {error && <p role="alert">{error}</p>}
        <dl className={styles.confirmation}>
          <div>
            <dt>本次冻结</dt>
            <dd>
              {credits} 积分（约 ¥{(order.credits * 0.02).toFixed(2)}）
            </dd>
          </div>
          <div>
            <dt>什么时候扣</dt>
            <dd>交付成片时</dd>
          </div>
          <div>
            <dt>超时没交</dt>
            <dd>全额退回</dd>
          </div>
        </dl>
      </Modal>
    </div>
  )
}
