import { useEffect, useRef, useState } from 'react'
import body from '../../assets/logo/director-mascot-base.png'
import { doudouLabels } from './doudouState'
import type { DoudouState } from './doudouState'
import styles from './DoudouMascot.module.css'

export function DoudouMascot({ state = 'idle', compact = false }: { state?: DoudouState; compact?: boolean }) {
  const root = useRef<HTMLButtonElement>(null)
  const [visible, setVisible] = useState(false)
  const [pageVisible, setPageVisible] = useState(!document.hidden)
  const [paused, setPaused] = useState(false)
  useEffect(() => {
    const element = root.current
    const observer =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting))
    if (element) observer?.observe(element)
    const onVisibility = () => setPageVisible(!document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      observer?.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])
  const label = doudouLabels[state]
  return (
    <button
      ref={root}
      type="button"
      className={`${styles.mascot} ${compact ? styles.compact : ''}`}
      data-state={state}
      data-animated={visible && pageVisible && !paused}
      aria-label={`${label}，${paused ? '播放' : '暂停'}豆豆动画`}
      aria-pressed={paused}
      data-tooltip={`${label} · 点击${paused ? '播放' : '暂停'}动画`}
      onClick={() => setPaused((value) => !value)}
    >
      <span className={styles.character} aria-hidden="true">
        <img className={styles.body} src={body} alt="" width={96} height={96} draggable={false} />
        <svg className={styles.face} viewBox="0 0 1280 1280" focusable="false">
          <g className={styles.gaze}>
            <g className={styles.eye}>
              <ellipse cx="510" cy="548" rx="37" ry="40" />
              <circle cx="500" cy="534" r="8" />
            </g>
            <g className={styles.eye}>
              <ellipse cx="714" cy="548" rx="37" ry="40" />
              <circle cx="704" cy="534" r="8" />
            </g>
          </g>
          <path className={styles.smile} d="M 550 666 Q 615 755 681 666" />
          <path className={styles.neutral} d="M 570 689 Q 614 675 658 689" />
          <path className={styles.brow} d="M 474 455 Q 508 434 542 448" />
          <g className={styles.sparks}>
            <path d="M 1000 330 v 60 M 970 360 h 60" />
            <path d="M 286 750 v 40 M 266 770 h 40" />
          </g>
        </svg>
      </span>
    </button>
  )
}
