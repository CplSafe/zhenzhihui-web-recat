import { describe, expect, it } from 'vitest'
import { findVideoGeneration, updateVideoGeneration } from '@/utils/videoGenerationRecords'

const generations = [
  { id: 'first', taskId: 11, status: 'processing' },
  { id: 'second', taskId: 22, status: 'processing' },
]

describe('videoGenerationRecords', () => {
  it('finds by generation id before considering task id', () => {
    expect(findVideoGeneration(generations, 'second', 11)).toEqual(generations[1])
  })

  it('falls back to task id when generation id is empty', () => {
    expect(findVideoGeneration(generations, '', 11)).toEqual(generations[0])
  })

  it('returns undefined for invalid collections or selectors', () => {
    expect(findVideoGeneration(null, 'first', 11)).toBeUndefined()
    expect(findVideoGeneration(generations, '', 0)).toBeUndefined()
  })

  it('updates only the selected generation without mutating the others', () => {
    const result = updateVideoGeneration(generations, 'second', 22, (generation) => ({
      ...generation,
      status: 'published',
      taskId: 0,
    }))

    expect(result).toEqual([generations[0], { id: 'second', taskId: 0, status: 'published' }])
    expect(result[0]).toBe(generations[0])
    expect(generations[1]).toEqual({ id: 'second', taskId: 22, status: 'processing' })
  })

  it('rejects an id match whose recorded task belongs to another task', () => {
    const result = updateVideoGeneration(generations, 'second', 11, (generation) => ({
      ...generation,
      status: 'failed',
    }))

    expect(result).toEqual(generations)
    expect(result[1]).toBe(generations[1])
  })
})
