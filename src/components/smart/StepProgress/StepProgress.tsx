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
  onStepClick?: (index: number) => void
}

export default function StepProgress({ steps, current, statuses, onStepClick }: StepProgressProps) {
  return (
    <div className={styles.stepProgress} role="list">
      {steps.map((s, i) => {
        const state = i < current ? 'done' : i === current ? 'active' : 'todo'
        const sub = statuses?.[i] ?? (state === 'done' ? '已完成' : state === 'active' ? '进行中' : '待生成')
        // 可点规则:① 当前步及之前(已经过 = 已生成)随时可回跳;② 往前只允许跳到「已完成」(已生成)的步骤。
        // 不再用 maxReached(只要「到达过」就放行)——否则没生成的前序步也能点,出现「1 跳到没生成的 3」。
        const clickable = i <= current || sub === '已完成'
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
