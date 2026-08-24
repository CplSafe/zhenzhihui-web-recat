/**
 * 需求市场卡片（设计稿「需求市场」Tab）：
 * 左缩略图 + 价格/时长/比例/数量，下方标题，底部发布者与报名截止时间。
 */
import { formatDemandDate, formatDemandPrice, type MarketDemand } from '@/api/market'
import styles from './DemandCard.module.css'

interface DemandCardProps {
  demand: MarketDemand
  onOpen: (demand: MarketDemand) => void
}

/** 挑第一张有 URL 的图片素材作为缩略图；素材签名地址可能过期，onError 时回退占位。 */
function thumbnailOf(demand: MarketDemand): string {
  const materials = demand.extras.materials || []
  const image = materials.find(
    (item) => item.url && /\.(jpe?g|png|gif|webp|bmp|avif)(\?|$)/i.test(item.name + (item.url || '')),
  )
  return image?.url || materials.find((item) => item.url)?.url || ''
}

export default function DemandCard({ demand, onOpen }: DemandCardProps) {
  const thumbnail = thumbnailOf(demand)
  const applyDeadline = demand.extras.applyDeadline || formatDemandDate(demand.deliveryDeadline)
  return (
    <button type="button" className={styles.card} onClick={() => onOpen(demand)}>
      <div className={styles.top}>
        <div className={styles.thumb}>
          {thumbnail ? (
            <img
              src={thumbnail}
              alt=""
              loading="lazy"
              onError={(event) => {
                event.currentTarget.style.display = 'none'
              }}
            />
          ) : null}
          <span className={styles.thumbPh} aria-hidden="true">
            🎬
          </span>
        </div>
        <div className={styles.meta}>
          <div className={styles.price}>
            {formatDemandPrice(demand)}
            {demand.budgetCents > 0 && <em>/条</em>}
          </div>
          <div className={styles.metaLine}>
            <span>视频时长：</span>
            {demand.extras.duration || '—'}
          </div>
          <div className={styles.metaLine}>
            <span>视频比例：</span>
            {demand.extras.ratio || '—'}
          </div>
          <div className={styles.metaLine}>
            <span>视频数量：</span>
            {demand.extras.quantity ? `${demand.extras.quantity}条` : '—'}
          </div>
        </div>
      </div>
      <div className={styles.title}>{demand.title}</div>
      <div className={styles.footer}>
        <span className={styles.publisher}>
          {demand.publisher.avatar ? (
            <img src={demand.publisher.avatar} alt="" />
          ) : (
            <span className={styles.publisherFallback} aria-hidden="true">
              {demand.publisher.nickname.slice(0, 1)}
            </span>
          )}
          {demand.publisher.nickname}
        </span>
        {applyDeadline && <span className={styles.deadline}>报名截止时间：{applyDeadline}</span>}
      </div>
    </button>
  )
}
