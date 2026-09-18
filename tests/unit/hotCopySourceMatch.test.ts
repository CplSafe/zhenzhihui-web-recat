import { describe, expect, it } from 'vitest'
import {
  closestDurationOption,
  closestRatioOption,
  describeSourceMismatch,
  parseRatioValue,
  resolveSourceMismatch,
} from '@/utils/hotCopySourceMatch'

const RATIOS = ['9:16', '3:4', '1:1', '4:3', '16:9', '21:9']

describe('hotCopySourceMatch', () => {
  it('解析比例字符串，兼容中文冒号与 x，非法返回 0', () => {
    expect(parseRatioValue('16:9')).toBeCloseTo(16 / 9)
    expect(parseRatioValue('9：16')).toBeCloseTo(9 / 16)
    expect(parseRatioValue('4x3')).toBeCloseTo(4 / 3)
    expect(parseRatioValue('abc')).toBe(0)
    expect(parseRatioValue('0:9')).toBe(0)
  })

  it('按源视频宽高挑最接近的比例档位，横竖屏对称', () => {
    expect(closestRatioOption(1920, 1080, RATIOS)).toBe('16:9')
    expect(closestRatioOption(1080, 1920, RATIOS)).toBe('9:16')
    expect(closestRatioOption(1080, 1350, RATIOS)).toBe('3:4')
    expect(closestRatioOption(1000, 1000, RATIOS)).toBe('1:1')
    // 2560×1080 更接近 21:9 而不是 16:9
    expect(closestRatioOption(2560, 1080, RATIOS)).toBe('21:9')
  })

  it('缺尺寸或无可选档位时返回空串', () => {
    expect(closestRatioOption(0, 1080, RATIOS)).toBe('')
    expect(closestRatioOption(1920, 1080, [])).toBe('')
    expect(closestRatioOption(1920, 1080, ['bad'])).toBe('')
  })

  it('时长取不超过源视频的最大档位，不进位', () => {
    expect(closestDurationOption(14.8, [5, 10, 15])).toBe(10)
    expect(closestDurationOption(15, [5, 10, 15])).toBe(15)
    expect(closestDurationOption(22, [5, 10, 15])).toBe(15)
    expect(closestDurationOption(7.3, [5, 10, 15])).toBe(5)
  })

  it('源视频比所有档位都短时取最小档；无档位或无时长返回 0', () => {
    expect(closestDurationOption(3, [5, 10, 15])).toBe(5)
    expect(closestDurationOption(10, [])).toBe(0)
    expect(closestDurationOption(0, [5, 10])).toBe(0)
  })

  it('比例与时长都一致时不提示', () => {
    expect(
      describeSourceMismatch({
        source: { width: 1080, height: 1920, durationSec: 14.8 },
        ratio: '9:16',
        durationSec: 10,
        ratioOptions: RATIOS,
        durationOptions: [5, 10, 15],
      }),
    ).toBe('')
  })

  it('比例不一致时说明源视频接近哪一档、当前选了哪一档', () => {
    const hint = describeSourceMismatch({
      source: { width: 1920, height: 1080, durationSec: 10 },
      ratio: '9:16',
      durationSec: 10,
      ratioOptions: RATIOS,
      durationOptions: [5, 10, 15],
    })
    expect(hint).toContain('源视频接近 16:9')
    expect(hint).toContain('当前选了 9:16')
    expect(hint).not.toContain('秒')
  })

  it('时长不一致时给出源时长与所选秒数，两项都不一致时合并成一句', () => {
    const hint = describeSourceMismatch({
      source: { width: 1920, height: 1080, durationSec: 22 },
      ratio: '9:16',
      durationSec: 5,
      ratioOptions: RATIOS,
      durationOptions: [5, 10, 15],
    })
    expect(hint).toContain('源视频接近 16:9')
    expect(hint).toContain('源视频约 22 秒，当前选了 5 秒')
    expect(hint).toContain('；')
    expect(hint.endsWith('复刻效果更稳定。')).toBe(true)
  })

  it('没有源视频信息时不提示', () => {
    expect(
      describeSourceMismatch({
        source: null,
        ratio: '9:16',
        durationSec: 5,
        ratioOptions: RATIOS,
        durationOptions: [5, 10, 15],
      }),
    ).toBe('')
  })

  it('resolveSourceMismatch 给出推荐值与「改为 …」按钮文案，只列不一致的那一项', () => {
    const both = resolveSourceMismatch({
      source: { width: 1080, height: 1920, durationSec: 15.1 },
      ratio: '16:9',
      durationSec: 30,
      ratioOptions: RATIOS,
      durationOptions: [5, 10, 15, 20, 30],
    })
    expect(both).toMatchObject({ ratio: '9:16', durationSec: 15, actionLabel: '改为 9:16 · 15s' })
    expect(both?.message).toContain('源视频约 15.1 秒，当前选了 30 秒')

    const durationOnly = resolveSourceMismatch({
      source: { width: 1080, height: 1920, durationSec: 15.1 },
      ratio: '9:16',
      durationSec: 30,
      ratioOptions: RATIOS,
      durationOptions: [5, 10, 15, 20, 30],
    })
    expect(durationOnly).toMatchObject({ ratio: '', durationSec: 15, actionLabel: '改为 15s' })

    const ratioOnly = resolveSourceMismatch({
      source: { width: 1920, height: 1080, durationSec: 15 },
      ratio: '9:16',
      durationSec: 15,
      ratioOptions: RATIOS,
      durationOptions: [5, 10, 15],
    })
    expect(ratioOnly).toMatchObject({ ratio: '16:9', durationSec: 0, actionLabel: '改为 16:9' })

    expect(
      resolveSourceMismatch({
        source: { width: 1920, height: 1080, durationSec: 15 },
        ratio: '16:9',
        durationSec: 15,
        ratioOptions: RATIOS,
        durationOptions: [5, 10, 15],
      }),
    ).toBeNull()
  })
})
