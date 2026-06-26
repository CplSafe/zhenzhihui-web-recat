/**
 * StepProgress — 智能成片 2.1 流程进度条(按 Figma:靛蓝数字圆点 + 标签 + 子状态)。
 * 圆点在左,标签/子状态竖排在右;已到达步骤可点击跳转。
 */
import { Fragment } from 'react'
import styles from './StepProgress.module.less'

export interface StepItem {
  key: string
  label: string
}

interface StepProgressProps {
  steps: StepItem[]
  current: number
  /** 每步子状态文案(如 脚本生成中/待生成/已完成);不传则按状态给默认 */
  statuses?: string[]
  maxReached?: number
  onStepClick?: (index: number) => void
}

export default function StepProgress({ steps, current, statuses, maxReached = 0, onStepClick }: StepProgressProps) {
  const reachable = Math.max(current, maxReached)
  return (
    <div className={styles.stepProgress} role="list">
      {steps.map((s, i) => {
        const state = i < current ? 'done' : i === current ? 'active' : 'todo'
        const sub = statuses?.[i] ?? (state === 'done' ? '已完成' : state === 'active' ? '进行中' : '待生成')
        // 已到达/当前步可点;另外只要该步状态是「已完成」就一律可点,支持来回切换查看
        const clickable = i <= reachable || sub === '已完成'
        return (
          <Fragment key={s.key}>
            {i > 0 && <span className={styles.line} aria-hidden="true" />}
            <button
              type="button"
              role="listitem"
              className={`${styles.node} ${styles[state]}`}
              disabled={!clickable}
              aria-current={state === 'active' ? 'step' : undefined}
              onClick={() => clickable && onStepClick?.(i)}
            >
              <span className={styles.circle}>{i + 1}</span>
              <span className={styles.texts}>
                <span className={styles.label}>{s.label}</span>
                <span className={styles.sub}>{sub}</span>
              </span>
            </button>
          </Fragment>
        )
      })}
    </div>
  )
}
