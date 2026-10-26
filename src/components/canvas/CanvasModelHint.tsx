import { getCanvasModelGuidance } from '@/utils/canvasModelGuidance'
import styles from './CanvasModelHint.module.css'

export default function CanvasModelHint({ model, operation }: { model: object; operation?: string }) {
  const guidance = getCanvasModelGuidance(model, operation)
  if (!guidance.scenario) return null
  return (
    <span className={styles.hint} data-canvas-model-hint>
      <span className={styles.tags}>
        {guidance.tags.map((tag) => (
          <span className={styles.tag} key={tag}>
            {tag}
          </span>
        ))}
      </span>
      <span className={styles.scenario}>{guidance.scenario}</span>
    </span>
  )
}
