/**
 * StepProgress — 智能成片 2.1 流程进度条(按 Figma:靛蓝数字圆点 + 标签 + 子状态)。
 * 圆点在左,标签/子状态竖排在右;已到达步骤可点击跳转。
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
  /** 每步子状态文案(如 脚本生成中/待生成/已完成);不传则按状态给默认 */
  statuses?: string[]
  maxReached?: number
  onStepClick?: (index: number) => void
}

export default function StepProgress({ steps, current, statuses, maxReached = 0, onStepClick }: StepProgressProps) {
  const reachable = Math.max(current, maxReached)
  return (
    <div className="step-progress" role="list">
      {steps.map((s, i) => {
        const state = i < current ? 'done' : i === current ? 'active' : 'todo'
        const clickable = i <= reachable
        const sub = statuses?.[i] ?? (state === 'done' ? '已完成' : state === 'active' ? '进行中' : '待生成')
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
              <span className="step-progress__circle">{i + 1}</span>
              <span className="step-progress__texts">
                <span className="step-progress__label">{s.label}</span>
                <span className="step-progress__sub">{sub}</span>
              </span>
            </button>
          </Fragment>
        )
      })}
    </div>
  )
}
