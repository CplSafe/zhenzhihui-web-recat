import { describe, expect, it } from 'vitest'
import { normalizeProgressPercent, readAiTaskProgress } from '../../src/utils/taskProgress'

describe('normalizeProgressPercent', () => {
  it.each([
    [0, 0],
    [0.5, 0.5],
    [1, 1],
    [2, 2],
    [42, 42],
    [99.99, 99.99],
    [100, 100],
  ])('treats %s as an already-normalized percentage', (input, expected) => {
    expect(normalizeProgressPercent(input)).toBe(expected)
  })

  it.each([
    ['42', 42],
    ['42%', 42],
    [' 0.5 % ', 0.5],
    ['+1.25', 1.25],
    ['.5', 0.5],
  ])('accepts the numeric percentage string %j', (input, expected) => {
    expect(normalizeProgressPercent(input)).toBe(expected)
  })

  it.each([
    [-1, 0],
    [-0.01, 0],
    [100.01, 100],
    [101, 100],
    [1_000, 100],
  ])('clamps %s into the 0..100 range', (input, expected) => {
    expect(normalizeProgressPercent(input)).toBe(expected)
  })

  it.each(['', '   ', '1e2', '42px', '%', 'Infinity', 'NaN'])('rejects the non-percentage string %j', (input) => {
    expect(normalizeProgressPercent(input)).toBeUndefined()
  })

  it.each([undefined, null, true, false, Number.NaN, Number.POSITIVE_INFINITY, {}, [], () => 42])(
    'rejects the non-numeric value %s',
    (input) => {
      expect(normalizeProgressPercent(input)).toBeUndefined()
    },
  )
})

describe('readAiTaskProgress', () => {
  it('reads the canonical progress field without ratio conversion', () => {
    expect(readAiTaskProgress({ progress: 0.5 })).toBe(0.5)
    expect(readAiTaskProgress({ progress: 1 })).toBe(1)
  })

  it.each([
    [{ progress_percent: 12.5 }, 12.5],
    [{ progressPercent: '35%' }, 35],
    [{ percentage: '88' }, 88],
  ])('supports backend alias fields', (task, expected) => {
    expect(readAiTaskProgress(task)).toBe(expected)
  })

  it('uses the first valid alias when an earlier field is invalid', () => {
    expect(
      readAiTaskProgress({
        progress: 'not-a-number',
        progress_percent: 27,
        progressPercent: 90,
      }),
    ).toBe(27)
  })

  it.each([undefined, null, '42', 42, {}, { progress: 'unknown' }])(
    'returns undefined when a task has no valid progress: %s',
    (task) => {
      expect(readAiTaskProgress(task)).toBeUndefined()
    },
  )
})
