import { beforeEach, describe, expect, it, vi } from 'vitest'
import { beginLogoutDraftWriteBarrier, releaseLogoutDraftWriteBarrier } from '@/utils/logoutBarrier'
import { saveSmartDraft, setSmartDraftUserScope, setSmartDraftWorkspaceScope } from '@/utils/smartDraft'
import { saveHotCopyDraft, setHotCopyDraftUserScope } from '@/utils/hotCopyDraft'
import { saveSmartEntryDraft, setSmartEntryDraftScope } from '@/utils/smartEntryDraft'

describe('logout draft write barrier', () => {
  beforeEach(() => {
    window.localStorage.clear()
    releaseLogoutDraftWriteBarrier('7')
    setSmartDraftUserScope('7')
    setSmartDraftWorkspaceScope(1)
    setHotCopyDraftUserScope('7')
    setSmartEntryDraftScope('7', 1)
  })

  it('blocks every creative draft writer during logout cleanup', () => {
    beginLogoutDraftWriteBarrier('7')
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    saveSmartDraft({ workspaceId: 1 } as any, 1)
    saveHotCopyDraft(1, {
      started: true,
      step: 0,
      maxReached: 0,
      basePrompt: '',
      projectName: '',
      nameTouched: false,
      sourceVideo: { url: '', assetId: 0 },
      productAssetIds: [],
      fullVideo: { url: '', assetId: 0 },
      videoVersions: [],
      vidGenTaskId: 0,
    })
    saveSmartEntryDraft({ text: 'must not be recreated' })

    expect(setItem).not.toHaveBeenCalled()
  })

  it('restores persistence after a new authenticated session releases the barrier', () => {
    beginLogoutDraftWriteBarrier('7')
    releaseLogoutDraftWriteBarrier('7')
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    saveSmartEntryDraft({ text: 'new account draft' })

    expect(setItem).toHaveBeenCalledTimes(1)
  })

  it('reads the persistent owner barrier written by another browser tab', () => {
    window.localStorage.setItem('zzh.logout-draft-write-barrier.v1.7', '1')
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    saveSmartEntryDraft({ text: 'stale tab write' })

    expect(setItem).not.toHaveBeenCalled()
  })
})
