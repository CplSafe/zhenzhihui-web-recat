/**
 * StepProgress — 智能成片 2.1 流程进度条(按 Figma:靛蓝数字圆点 + 标签 + 子状态)。
 * 圆点在左,标签/子状态竖排在右;已到达步骤可点击跳转。
 */
import { Fragment } from 'react'
import styles from './StepProgress.module.less'

/** 一个创作步骤的稳定键和展示名称。 */
export interface StepItem {
  key: string
  label: string
}

/** 当前步骤、子状态和允许回跳到的最远步骤。 */
interface StepProgressProps {
  steps: StepItem[]
  current: number
  /** 每步子状态文案(如 脚本生成中/待生成/已完成);不传则按状态给默认 */
  statuses?: string[]
  onStepClick?: (index: number) => void
  /** 已到达的最远步索引:≤ 此索引的步都可点(即使正在进行中,如「镜头编排中」也能回跳)。-1=不启用 */
  clickableMax?: number
}

/** 展示创作流程状态，并只允许跳转到已完成、当前或曾经到达的步骤。 */
export default function StepProgress({ steps, current, statuses, onStepClick, clickableMax = -1 }: StepProgressProps) {
  return (
    <div className={styles.stepProgress} role="list">
      {steps.map((s, i) => {
        const state = i < current ? 'done' : i === current ? 'active' : 'todo'
        const sub = statuses?.[i] ?? (state === 'done' ? '已完成' : state === 'active' ? '进行中' : '待生成')
        // 可点规则:① 当前步及之前随时可回跳;② 已到达过的步(≤ clickableMax)随时可点,
        //   即使它「正在进行中」(如镜头编排生成中)也能回跳;③ 往前只允许跳到「已完成」的步骤。
        const clickable = i <= current || i <= clickableMax || sub === '已完成'
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
