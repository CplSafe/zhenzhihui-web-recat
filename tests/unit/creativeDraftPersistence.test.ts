import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertCreativeDraftContentUnchanged,
  assertCreativeDraftWriteStillOwned,
  createCreativeDraftContentFingerprint,
  createDraftFingerprint,
  isCreativeDraftContentConflictError,
  isDraftConflictError,
  isRetryableDraftSaveError,
  waitForDraftSaveRetry,
} from '@/utils/creativeDraftPersistence'

describe('creative draft persistence helpers', () => {
  afterEach(() => vi.useRealTimers())

  it('recognizes all supported conflict shapes', () => {
    expect(isDraftConflictError({ status: 409 })).toBe(true)
    expect(isDraftConflictError({ response: { code_string: 'DRAFT_CONFLICT' } })).toBe(true)
    expect(isDraftConflictError({ status: 500 })).toBe(false)
  })

  it('retries transient failures but not validation or abort errors', () => {
    expect(isRetryableDraftSaveError({ status: 0 })).toBe(true)
    expect(isRetryableDraftSaveError({ status: 429 })).toBe(true)
    expect(isRetryableDraftSaveError({ status: 503 })).toBe(true)
    expect(isRetryableDraftSaveError({ status: 422 })).toBe(false)
    expect(isRetryableDraftSaveError({ name: 'AbortError', status: 0 })).toBe(false)
  })

  it('uses deterministic fingerprints and bounded retry delays', async () => {
    expect(createDraftFingerprint({ title: 'A' }, 1)).toBe(createDraftFingerprint({ title: 'A' }, 1))
    expect(createDraftFingerprint({ title: 'B' }, 1)).not.toBe(createDraftFingerprint({ title: 'A' }, 1))

    vi.useFakeTimers()
    const done = vi.fn()
    void waitForDraftSaveRetry(9).then(done)
    await vi.advanceTimersByTimeAsync(1199)
    expect(done).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(done).toHaveBeenCalledOnce()
  })

  it('ignores generated-video metadata and expiring URL signatures in creative-content fingerprints', () => {
    const base = {
      flow: 'smart',
      generatedVideoUrl: 'https://cdn.example.com/video.mp4?token=old',
      restrictedMemberIds: [7],
      smart: {
        flow: 'smart',
        requirement: '制作一条新品视频',
        shots: [{ id: 'shot-1', line: '第一句', image: 'https://cdn.example.com/shot.jpg?token=old' }],
        fullVideoAssetId: 10,
        videoVersions: [{ assetId: 10, url: 'https://cdn.example.com/video.mp4?token=old' }],
        videoGenerations: [{ id: 'generation-1', taskId: 99, status: 'processing' }],
        savedAt: 100,
      },
    }
    const metadataOnlyUpdate = {
      ...base,
      generatedVideoUrl: 'https://cdn.example.com/video.mp4?token=new',
      restrictedMemberIds: [8],
      smart: {
        ...base.smart,
        shots: [{ ...base.smart.shots[0], image: 'https://cdn.example.com/shot.jpg?token=new' }],
        fullVideoAssetId: 11,
        videoVersions: [{ assetId: 11, url: 'https://cdn.example.com/video.mp4?token=new' }],
        videoGenerations: [{ id: 'generation-1', taskId: 99, status: 'published' }],
        savedAt: 200,
      },
    }

    expect(createCreativeDraftContentFingerprint(metadataOnlyUpdate)).toBe(createCreativeDraftContentFingerprint(base))
  })

  it('detects competing creative edits without treating the first server snapshot as a conflict', () => {
    const initial = {
      flow: 'hot-copy',
      smart: {
        flow: 'hot-copy',
        basePrompt: '原始提示词',
        productAssetIds: [1],
        fullVideoAssetId: 21,
      },
    }
    const baseFingerprint = assertCreativeDraftContentUnchanged('', initial)
    expect(baseFingerprint).toBe(createCreativeDraftContentFingerprint(initial))
    expect(() => assertCreativeDraftContentUnchanged(baseFingerprint, initial)).not.toThrow()

    try {
      assertCreativeDraftContentUnchanged(baseFingerprint, {
        ...initial,
        smart: { ...initial.smart, basePrompt: '另一个标签页修改后的提示词' },
      })
      throw new Error('expected a content conflict')
    } catch (error) {
      expect(isCreativeDraftContentConflictError(error)).toBe(true)
    }
  })

  it('uses a real fingerprint for an empty server draft so a later first write cannot be silently replaced', () => {
    const emptyFingerprint = assertCreativeDraftContentUnchanged('', null)
    expect(emptyFingerprint).not.toBe('')
    expect(() =>
      assertCreativeDraftContentUnchanged(emptyFingerprint, {
        flow: 'smart',
        smart: { flow: 'smart', requirement: '另一个标签页先写入的内容' },
      }),
    ).toThrowError('项目已在其他页面被修改，当前内容尚未覆盖云端')
  })

  it('fails closed when a previously valid server draft becomes unreadable', () => {
    const baseFingerprint = createCreativeDraftContentFingerprint({
      flow: 'smart',
      smart: { requirement: '原始需求' },
    })

    expect(() => assertCreativeDraftContentUnchanged(baseFingerprint, '{invalid json')).toThrowError(
      '项目已在其他页面被修改，当前内容尚未覆盖云端',
    )
  })

  it('preserves stable URL query parameters that identify different creative media', () => {
    const first = {
      flow: 'hot-copy',
      smart: { sourceVideo: { url: 'https://media.example.com/download?asset_id=1&token=old' } },
    }
    const refreshedSignature = {
      flow: 'hot-copy',
      smart: { sourceVideo: { url: 'https://media.example.com/download?token=new&asset_id=1' } },
    }
    const differentAsset = {
      flow: 'hot-copy',
      smart: { sourceVideo: { url: 'https://media.example.com/download?asset_id=2&token=new' } },
    }

    expect(createCreativeDraftContentFingerprint(refreshedSignature)).toBe(createCreativeDraftContentFingerprint(first))
    expect(createCreativeDraftContentFingerprint(differentAsset)).not.toBe(createCreativeDraftContentFingerprint(first))
  })

  it('accepts exact intended content on the first pre-read while rejecting a third-party edit', () => {
    const base = { flow: 'smart', smart: { requirement: '旧需求' } }
    const intended = { flow: 'smart', smart: { requirement: '本页的新需求' } }
    const competing = { flow: 'smart', smart: { requirement: '另一页的新需求' } }
    const baseFingerprint = createCreativeDraftContentFingerprint(base)
    const intendedFingerprint = createCreativeDraftContentFingerprint(intended)

    expect(
      assertCreativeDraftWriteStillOwned({
        baseFingerprint,
        intendedFingerprint,
        latestDraft: intended,
        acceptIntendedContent: true,
      }),
    ).toBe(intendedFingerprint)
    expect(
      assertCreativeDraftWriteStillOwned({
        baseFingerprint,
        intendedFingerprint,
        latestDraft: intended,
      }),
    ).toBe(intendedFingerprint)
    expect(() =>
      assertCreativeDraftWriteStillOwned({
        baseFingerprint,
        intendedFingerprint,
        latestDraft: competing,
        acceptIntendedContent: true,
      }),
    ).toThrowError('项目已在其他页面被修改，当前内容尚未覆盖云端')
  })

  it('does not self-conflict when video completion has already committed this editor pending note', () => {
    const base = {
      flow: 'smart',
      smart: {
        requirement: '制作产品视频',
        fields: {
          __videoModificationDraftV1: JSON.stringify({
            overallNote: '提高画面亮度',
            frameSlots: [],
            noteByVersion: {},
            pendingNote: '【整段视频】提高画面亮度',
          }),
        },
      },
    }
    const intended = {
      flow: 'smart',
      smart: {
        ...base.smart,
        fields: {
          __videoModificationDraftV1: JSON.stringify({
            overallNote: '提高画面亮度',
            frameSlots: [],
            noteByVersion: { 'asset:2552': '【整段视频】提高画面亮度' },
            pendingNote: '',
          }),
        },
        fullVideoAssetId: 2552,
      },
    }
    const competing = {
      ...intended,
      smart: { ...intended.smart, requirement: '另一标签页改过的需求' },
    }
    const baseFingerprint = createCreativeDraftContentFingerprint(base)
    const intendedFingerprint = createCreativeDraftContentFingerprint(intended)

    expect(
      assertCreativeDraftWriteStillOwned({
        baseFingerprint,
        intendedFingerprint,
        latestDraft: intended,
      }),
    ).toBe(intendedFingerprint)
    expect(() =>
      assertCreativeDraftWriteStillOwned({
        baseFingerprint,
        intendedFingerprint,
        latestDraft: competing,
      }),
    ).toThrowError('项目已在其他页面被修改，当前内容尚未覆盖云端')
  })

  it('normalizes object key order and handles cyclic diagnostic input safely', () => {
    expect(createCreativeDraftContentFingerprint({ b: 2, a: 1 })).toBe(
      createCreativeDraftContentFingerprint({ a: 1, b: 2 }),
    )

    const cyclic: Record<string, unknown> = { flow: 'smart' }
    cyclic.self = cyclic
    expect(createCreativeDraftContentFingerprint(cyclic)).not.toBe('')
  })
})
