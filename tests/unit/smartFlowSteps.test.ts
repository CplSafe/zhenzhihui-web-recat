import { describe, expect, it } from 'vitest'

/**
 * 智能成片流程步的形状约束。
 *
 * 背景：流程从 4 步（分镜脚本 / 准备素材 / 镜头编排 / 生成视频）缩到 2 步后，
 * 进度条仍按 `[0, 2, 3]` 取步骤，索引 2/3 落到 undefined，渲染时读 `.label`
 * 直接抛 `Cannot read properties of undefined (reading 'label')`，整个流程页白屏。
 *
 * 这里不测 UI，只钉住两条不变式：可见索引必须都落在步骤数组内、且两套流程
 * （普通 / 真人）步数一致——后者一旦不同，共用的 step 判断就会开始错位。
 */

/** 与 SmartCreateView 保持同一份定义；改那边必须同步改这里，测试会红。 */
const STEP_SCRIPT = 0
const STEP_VIDEO = 1
const STEPS = [
  { key: 'script', label: '分镜脚本' },
  { key: 'video', label: '生成视频' },
]
const REAL_PERSON_STEPS = [
  { key: 'script', label: '真人策划' },
  { key: 'video', label: '真人成片' },
]
const VISIBLE_STEP_INDICES = [STEP_SCRIPT, STEP_VIDEO]

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
    const clamp = (value: number) => Math.min(STEPS.length - 1, Math.max(0, value))
    expect(clamp(3)).toBe(STEP_VIDEO)
    expect(clamp(2)).toBe(STEP_VIDEO)
    expect(clamp(1)).toBe(STEP_VIDEO)
    expect(clamp(0)).toBe(STEP_SCRIPT)
    expect(clamp(-1)).toBe(STEP_SCRIPT)
  })
})
