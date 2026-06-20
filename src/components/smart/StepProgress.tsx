/**
 * StepProgress — 智能成片 2.1 流程进度条(数字圆点 + 连接线 + 标签)。
 * 状态:已完成(✓ 绿实心) / 当前(绿实心高亮) / 未到(灰)。已到达的步骤可点击跳转。
 */
import { Fragment } from 'react'
import './StepProgress.css'

export interface StepItem {
  key: string
  label: string
}

interface StepProgressProps {
  steps: StepItem[]
  current: number
  maxReached?: number
  onStepClick?: (index: number) => void
}

export default function StepProgress({ steps, current, maxReached = 0, onStepClick }: StepProgressProps) {
  const reachable = Math.max(current, maxReached)
  return (
    <div className="step-progress" role="list">
      {steps.map((s, i) => {
        const state = i < current ? 'done' : i === current ? 'active' : 'todo'
        const clickable = i <= reachable
        return (
          <Fragment key={s.key}>
            {i > 0 && <span className={`step-progress__line${i <= current ? ' is-done' : ''}`} aria-hidden="true" />}
            <button
              type="button"
              role="listitem"
              className={`step-progress__node is-${state}`}
              disabled={!clickable}
              aria-current={state === 'active' ? 'step' : undefined}
              onClick={() => clickable && onStepClick?.(i)}
            >
              <span className="step-progress__circle">{state === 'done' ? '✓' : i + 1}</span>
              <span className="step-progress__label">{s.label}</span>
            </button>
          </Fragment>
        )
      })}
    </div>
  )
}
