import type { ReactNode } from 'react'
import styles from './CanvasBottomBar.module.css'

/** One layout owns both bottom regions, including the user's UI scale. */
export default function CanvasBottomBar({
  controls,
  overview,
  children,
}: {
  controls?: ReactNode
  overview?: ReactNode
  children: ReactNode
}) {
  return (
    <div className={styles.dock}>
      <div className={styles.row}>
        <div className={styles.controls}>
          {overview && <div className={styles.overview}>{overview}</div>}
          {controls}
        </div>
        <div className={styles.creation}>{children}</div>
      </div>
    </div>
  )
}
