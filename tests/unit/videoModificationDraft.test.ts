import { describe, expect, it } from 'vitest'
import {
  bindVideoModificationNote,
  createEmptyVideoModificationDraft,
  getVideoModificationVersionKey,
  mergeVideoModificationDraft,
} from '@/utils/videoModificationDraft'

describe('video modification note ownership', () => {
  it('uses asset identity instead of the transient playback URL', () => {
    expect(
      getVideoModificationVersionKey({ assetId: 81, url: 'https://provider.example/signed.mp4?token=secret' }),
    ).toBe('asset:81')
  })

  it('binds each generation note to its own completed result', () => {
    const first = bindVideoModificationNote(
      { ...createEmptyVideoModificationDraft(), pendingNote: '第一版修改' },
      { assetId: 81, url: '/first.mp4' },
      '第一版修改',
      { clearPending: false },
    )
    const second = bindVideoModificationNote(first, { assetId: 82, url: '/second.mp4' }, '第二版修改')

    expect(second.noteByVersion).toEqual({
      'asset:81': '第一版修改',
      'asset:82': '第二版修改',
    })
    expect(second.pendingNote).toBe('')
  })

  it('does not create a version note when a generation has no modification request', () => {
    const result = bindVideoModificationNote(
      { ...createEmptyVideoModificationDraft(), pendingNote: '已失败的旧说明' },
      { assetId: 83 },
      '',
    )

    expect(result.noteByVersion).toEqual({})
    expect(result.pendingNote).toBe('')
  })

  it('adopts background version notes without replacing current editor inputs', () => {
    const merged = mergeVideoModificationDraft(
      {
        ...createEmptyVideoModificationDraft(),
        overallNote: '当前页面尚未提交的输入',
        pendingNote: '旧任务仍显示生成中',
        noteByVersion: { 'asset:80': '本地已有说明' },
      },
      {
        ...createEmptyVideoModificationDraft(),
        pendingNote: '',
        noteByVersion: { 'asset:81': '后台刚完成的说明' },
      },
      { preferLatestPending: true },
    )

    expect(merged.overallNote).toBe('当前页面尚未提交的输入')
    expect(merged.pendingNote).toBe('')
    expect(merged.noteByVersion).toEqual({
      'asset:80': '本地已有说明',
      'asset:81': '后台刚完成的说明',
    })
  })
})
