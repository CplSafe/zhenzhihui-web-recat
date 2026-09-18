import { describe, expect, it } from 'vitest'
import {
  SCENE_CUT_WARN_THRESHOLD,
  describeSceneCutWarning,
  findSceneCuts,
  histogramDistance,
  rgbHistogram,
  sceneSampleTimes,
} from '@/utils/videoSceneCuts'

/** 生成一张纯色小图的 RGBA 像素。 */
function solid(r: number, g: number, b: number, count = 64): number[] {
  const out: number[] = []
  for (let i = 0; i < count; i += 1) out.push(r, g, b, 255)
  return out
}

describe('videoSceneCuts', () => {
  it('直方图归一化后各桶之和为 1，纯色图只落在一个桶', () => {
    const hist = rgbHistogram(solid(255, 0, 0))
    expect(hist.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1)
    expect(hist.filter((value) => value > 0)).toHaveLength(1)
  })

  it('相同分布距离为 0，完全不同的纯色距离接近 1', () => {
    const red = rgbHistogram(solid(255, 0, 0))
    const blue = rgbHistogram(solid(0, 0, 255))
    expect(histogramDistance(red, red)).toBeCloseTo(0)
    expect(histogramDistance(red, blue)).toBeGreaterThan(0.9)
  })

  it('相邻样本颜色分布突变处记为一次硬切，缓慢变化不算', () => {
    const red = rgbHistogram(solid(255, 0, 0))
    const blue = rgbHistogram(solid(0, 0, 255))
    // 红→红→蓝→蓝→红：两次切换
    const samples = [red, red, blue, blue, red].map((histogram, index) => ({ timeSec: index * 1.0, histogram }))
    expect(findSceneCuts(samples)).toEqual([2, 4])
    // 混色渐变（红中掺一点蓝）不该触发
    const mostlyRed = rgbHistogram([...solid(255, 0, 0, 60), ...solid(0, 0, 255, 4)])
    expect(findSceneCuts([red, mostlyRed].map((histogram, index) => ({ timeSec: index, histogram })))).toEqual([])
  })

  it('一次转场内的多帧突变只算一次切换（最小间隔）', () => {
    const red = rgbHistogram(solid(255, 0, 0))
    const blue = rgbHistogram(solid(0, 0, 255))
    const green = rgbHistogram(solid(0, 255, 0))
    // 0.5s 间隔：红→蓝→绿 两次突变相隔 0.5s，小于最小间隔 0.8s，只算第一次
    const samples = [red, blue, green].map((histogram, index) => ({ timeSec: index * 0.5, histogram }))
    expect(findSceneCuts(samples)).toEqual([0.5])
    expect(findSceneCuts(samples, { minGapSec: 0.4 })).toEqual([0.5, 1])
  })

  it('抽帧时刻从半步开始均匀分布，长视频受样本上限约束', () => {
    expect(sceneSampleTimes(2, 0.5)).toEqual([0.25, 0.75, 1.25, 1.75])
    expect(sceneSampleTimes(0)).toEqual([])
    const long = sceneSampleTimes(600, 0.5, 80)
    expect(long.length).toBeLessThanOrEqual(80)
    expect(long[0]).toBeCloseTo(3.75)
  })

  it('硬切数达到阈值才提示，文案给出镜头数与建议', () => {
    expect(describeSceneCutWarning(null)).toBe('')
    expect(describeSceneCutWarning({ cuts: [], sampled: 0, durationSec: 10 })).toBe('')
    expect(describeSceneCutWarning({ cuts: [3], sampled: 20, durationSec: 10 })).toBe('')
    const hint = describeSceneCutWarning({
      cuts: [2.3, 5.1, 8.3, 14.4, 16.7, 20.5, 22.7],
      sampled: 48,
      durationSec: 23.8,
    })
    expect(hint).toContain('爆款视频里有约 7 次镜头切换（8 个镜头）')
    expect(hint).toContain('复刻一次只能出一个连续镜头')
    expect(hint).toContain('拆成几段分别复刻再拼起来')
    expect(SCENE_CUT_WARN_THRESHOLD).toBe(2)
  })
})
