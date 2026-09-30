import { describe, expect, it } from 'vitest'
import {
  applyVideoTaskModeParams,
  formatVideoTaskModeLabel,
  getVideoEditModeConflict,
  isFollowSourceVideoMode,
  isVideoTaskModeField,
  resolveSelfVideoAssetId,
} from '@/utils/canvasVideoTaskMode'

const modeField = { name: 'mode', options: ['generate', 'edit', 'extend'] }

describe('isVideoTaskModeField', () => {
  it('recognizes the Seedance mode field by its edit/extend options', () => {
    expect(isVideoTaskModeField(modeField)).toBe(true)
  })

  it('ignores unrelated fields that happen to be named mode', () => {
    expect(isVideoTaskModeField({ name: 'mode', options: ['fast', 'quality'] })).toBe(false)
    expect(isVideoTaskModeField({ name: 'ratio', options: ['edit'] })).toBe(false)
  })
})

describe('isFollowSourceVideoMode', () => {
  it.each(['edit', 'extend'])('%s follows the source video', (mode) => {
    expect(isFollowSourceVideoMode(mode)).toBe(true)
  })

  it.each(['generate', '', undefined])('%p does not', (mode) => {
    expect(isFollowSourceVideoMode(mode)).toBe(false)
  })
})

describe('formatVideoTaskModeLabel', () => {
  it('shows Chinese labels instead of raw API values', () => {
    expect(formatVideoTaskModeLabel('generate')).toBe('生成')
    expect(formatVideoTaskModeLabel('edit')).toBe('编辑')
    expect(formatVideoTaskModeLabel('extend')).toBe('延长')
  })
})

describe('applyVideoTaskModeParams', () => {
  it('drops mode when no video is connected so the backend falls back to generate', () => {
    const params = { mode: 'edit', duration: 5 }
    expect(
      applyVideoTaskModeParams(params, { modeFieldName: 'mode', hasVideoInput: false, sourceVideoSeconds: 0 }),
    ).toEqual({ duration: 5 })
    expect(params).toEqual({ mode: 'edit', duration: 5 })
  })

  it('reports the total source video length rounded up for billing', () => {
    expect(
      applyVideoTaskModeParams(
        { mode: 'edit', duration: 5 },
        { modeFieldName: 'mode', hasVideoInput: true, sourceVideoSeconds: 7.2 },
      ),
    ).toEqual({ mode: 'edit', duration: 5, source_video_duration: 8 })
  })

  it('omits the source length while it is still unknown', () => {
    expect(
      applyVideoTaskModeParams(
        { mode: 'extend' },
        { modeFieldName: 'mode', hasVideoInput: true, sourceVideoSeconds: 0 },
      ),
    ).toEqual({ mode: 'extend' })
  })

  it('leaves models without a task mode field untouched', () => {
    const params = { duration: 5 }
    expect(
      applyVideoTaskModeParams(params, { modeFieldName: undefined, hasVideoInput: true, sourceVideoSeconds: 9 }),
    ).toBe(params)
  })
})

describe('resolveSelfVideoAssetId', () => {
  it('sends the node video while editing it', () => {
    expect(resolveSelfVideoAssetId({ isEditingVideo: true, followSourceVideo: false, assetId: 7 })).toBe(7)
  })

  it('sends the node video for edit/extend even after switching models', () => {
    // 上传视频 → 换 Seedance → 选编辑：isEditingVideo 为 false，但必须带上自身视频
    expect(resolveSelfVideoAssetId({ isEditingVideo: false, followSourceVideo: true, assetId: 7 })).toBe(7)
  })

  it('regenerates from scratch with a new model in generate mode', () => {
    expect(resolveSelfVideoAssetId({ isEditingVideo: false, followSourceVideo: false, assetId: 7 })).toBe(0)
  })

  it('never sends a video that has no asset id', () => {
    expect(resolveSelfVideoAssetId({ isEditingVideo: true, followSourceVideo: true, assetId: 0 })).toBe(0)
  })
})

describe('getVideoEditModeConflict', () => {
  const editPrompt = '将篮球替换成足球'
  it('blocks edit intent submitted as generation with source video', () => {
    expect(
      getVideoEditModeConflict({ prompt: editPrompt, mode: 'generate', hasVideoInput: true, supportsTaskMode: true }),
    ).toContain('切换为「编辑」')
  })
  it('allows selected edit mode, plain generation and models without mode', () => {
    expect(
      getVideoEditModeConflict({ prompt: editPrompt, mode: 'edit', hasVideoInput: true, supportsTaskMode: true }),
    ).toBeNull()
    expect(
      getVideoEditModeConflict({
        prompt: '参考这个视频生成广告',
        mode: 'generate',
        hasVideoInput: true,
        supportsTaskMode: true,
      }),
    ).toBeNull()
    expect(
      getVideoEditModeConflict({ prompt: editPrompt, mode: 'generate', hasVideoInput: false, supportsTaskMode: true }),
    ).toBeNull()
    expect(
      getVideoEditModeConflict({ prompt: editPrompt, mode: 'generate', hasVideoInput: true, supportsTaskMode: false }),
    ).toBeNull()
  })
})
