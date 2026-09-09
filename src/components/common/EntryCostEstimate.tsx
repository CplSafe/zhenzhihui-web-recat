import { INSUFFICIENT_CREDITS_TEXT, creditsYuanLabel } from '@/utils/creditsYuan'
import styles from './EntryCostEstimate.module.css'

interface EntryCostEstimateProps {
  loading?: boolean
  failed?: boolean
  estimatedCost?: number
  canAfford?: boolean
}

/** 创作入口生成按钮旁的统一费用提示。 */
export default function EntryCostEstimate({
  loading = false,
  failed = false,
  estimatedCost,
  canAfford = true,
}: EntryCostEstimateProps) {
  if (!loading && !failed && estimatedCost === undefined) return null

  return (
    <span className={`${styles.cost}${canAfford ? '' : ` ${styles.insufficient}`}`} aria-live="polite">
      {loading
        ? '预估中…'
        : failed
          ? '预估失败'
          : canAfford
            ? creditsYuanLabel(estimatedCost)
            : INSUFFICIENT_CREDITS_TEXT}
    </span>
  )
}
