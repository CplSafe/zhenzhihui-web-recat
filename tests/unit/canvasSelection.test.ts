import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearLastSelectedNodeId, loadLastSelectedNodeId, saveLastSelectedNodeId } from '@/utils/canvasSelection'

afterEach(() => {
  // 先恢复真实 localStorage 再清理：桩对象没有 clear，顺序反了会抛错
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('canvas last selected node', () => {
  it('keeps each canvas isolated so switching canvases does not restore the wrong node', () => {
    saveLastSelectedNodeId(11, 'image-a')
    saveLastSelectedNodeId(12, 'video-b')

    expect(loadLastSelectedNodeId(11)).toBe('image-a')
    expect(loadLastSelectedNodeId(12)).toBe('video-b')
    expect(loadLastSelectedNodeId(13)).toBe('')
  })

  it('treats an empty node id as clearing the record', () => {
    saveLastSelectedNodeId(11, 'image-a')
    saveLastSelectedNodeId(11, '')
    expect(loadLastSelectedNodeId(11)).toBe('')
  })

  it('clears the record explicitly', () => {
    saveLastSelectedNodeId(11, 'image-a')
    clearLastSelectedNodeId(11)
    expect(loadLastSelectedNodeId(11)).toBe('')
  })

  it('never throws when storage is unavailable', () => {
    // 隐私模式下 localStorage 读写会抛错；记不住选中态不能连累画布本身。
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
      removeItem: () => {
        throw new Error('denied')
      },
    })

    expect(() => saveLastSelectedNodeId(11, 'image-a')).not.toThrow()
    expect(loadLastSelectedNodeId(11)).toBe('')
    expect(() => clearLastSelectedNodeId(11)).not.toThrow()
  })
})
