import { describe, expect, it } from 'vitest'

import {
  clampStep,
  REAL_PERSON_STEPS,
  STEP_SCRIPT,
  STEP_VIDEO,
  STEPS,
  VISIBLE_STEP_INDICES,
} from '@/utils/smartFlowSteps'

/**
 * 智能成片流程步的形状约束。
 *
 * 背景：流程从 4 步（分镜脚本 / 准备素材 / 镜头编排 / 生成视频）缩到 2 步后，
 * 进度条仍按 `[0, 2, 3]` 取步骤，索引 2/3 落到 undefined，渲染时读 `.label`
 * 直接抛 `Cannot read properties of undefined (reading 'label')`，整个流程页白屏。
 *
 * 这些断言必须跑在**真实常量**上。此前它们跑在文件内的一份副本上，
 * 只能证明副本自洽——真正越界时照样全绿，白屏还是会上线。
 */
describe('smart flow steps', () => {
  it('resolves every visible index to a real step in both flows', () => {
    for (const steps of [STEPS, REAL_PERSON_STEPS]) {
      const resolved = VISIBLE_STEP_INDICES.map((index) => steps[index])
      expect(resolved.every(Boolean)).toBe(true)
      // 渲染只读 label，缺一个就是白屏。
      expect(resolved.map((step) => step.label)).toHaveLength(VISIBLE_STEP_INDICES.length)
    }
  })

  it('keeps both flows the same length so shared step checks stay aligned', () => {
    expect(REAL_PERSON_STEPS).toHaveLength(STEPS.length)
  })

  it('never exposes an index beyond the step array', () => {
    expect(Math.max(...VISIBLE_STEP_INDICES)).toBeLessThan(STEPS.length)
  })

  /**
   * 旧草稿存的 step / maxReached 可能是 2 或 3（当时确实有那两步）。
   * 恢复时必须夹到当前步数上限，否则进度条会把不存在的步骤算成"已到达"。
   */
  it('clamps restored step and maxReached from pre-2-step drafts', () => {
    expect(clampStep(3)).toBe(STEP_VIDEO)
    expect(clampStep(2)).toBe(STEP_VIDEO)
    expect(clampStep(1)).toBe(STEP_VIDEO)
    expect(clampStep(0)).toBe(STEP_SCRIPT)
    expect(clampStep(-1)).toBe(STEP_SCRIPT)
    // 非数字（草稿字段缺失/损坏）按第一步处理，不能变成 NaN 传下去
    expect(clampStep(undefined)).toBe(STEP_SCRIPT)
    expect(clampStep('abc')).toBe(STEP_SCRIPT)
  })
})
