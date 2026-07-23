import { describe, expect, it } from 'vitest'
import {
  inspectHotCopyProjectDraft,
  isAcceptedHotCopyProjectDraft,
  resolveHotCopyRestoredStarted,
  resolveHotCopySubmissionProjectId,
} from '@/utils/hotCopyProjectDraft'

describe('inspectHotCopyProjectDraft', () => {
  it.each([
    { flow: 'hot-copy', smart: {} },
    { smart: { flow: 'hot-copy' } },
    JSON.stringify({ flow: 'hot-copy', smart: { sourceVideo: {}, productAssetIds: [] } }),
  ])('accepts only an explicit hot-copy flow: %o', (draft) => {
    const inspection = inspectHotCopyProjectDraft(draft)

    expect(inspection.kind).toBe('hot-copy')
    expect(isAcceptedHotCopyProjectDraft(inspection)).toBe(true)
  })

  it.each([
    [{ flow: 'smart', smart: { flow: 'smart' } }, 'smart'],
    [{ flow: 'legacy', smart: {} }, 'legacy'],
    [{ flow: 'hot-copy', smart: { flow: 'smart' } }, 'hot-copy/smart'],
  ])('rejects an explicit foreign or conflicting flow without exposing it as HotCopy: %o', (draft, flow) => {
    const inspection = inspectHotCopyProjectDraft(draft)

    expect(inspection).toMatchObject({ kind: 'foreign', flow })
    expect(isAcceptedHotCopyProjectDraft(inspection)).toBe(false)
  })

  it.each([null, '', {}, { smart: {} }, JSON.stringify({})])(
    'keeps truly empty project drafts compatible: %o',
    (draft) => {
      const inspection = inspectHotCopyProjectDraft(draft)

      expect(inspection.kind).toBe('empty')
      expect(isAcceptedHotCopyProjectDraft(inspection)).toBe(true)
    },
  )

  it('accepts a legacy HotCopy snapshot only when HotCopy-specific fields identify it', () => {
    const inspection = inspectHotCopyProjectDraft({
      smart: {
        projectName: '旧爆款项目',
        sourceVideo: { assetId: 11, url: '/source.mp4' },
        productAssetIds: [21],
      },
    })

    expect(inspection).toMatchObject({ kind: 'hot-copy', flow: '', legacy: true })
    expect(isAcceptedHotCopyProjectDraft(inspection)).toBe(true)
  })

  it('rejects an unmarked Smart-shaped snapshot instead of guessing and overwriting it', () => {
    const inspection = inspectHotCopyProjectDraft({
      smart: {
        requirement: '智能成片需求',
        shots: [{ id: 1 }],
      },
    })

    expect(inspection).toMatchObject({ kind: 'foreign', flow: '', legacy: false })
    expect(isAcceptedHotCopyProjectDraft(inspection)).toBe(false)
  })

  it.each(['{broken-json', [], 42])('rejects malformed or non-object drafts: %o', (draft) => {
    expect(inspectHotCopyProjectDraft(draft).kind).toBe('invalid')
  })
})

describe('HotCopy project binding and restore state', () => {
  it('keeps the URL project authoritative instead of creating a second project', () => {
    expect(
      resolveHotCopySubmissionProjectId({
        routeProjectId: 171,
        restartProjectId: 172,
        boundProjectId: 173,
      }),
    ).toBe(171)
  })

  it('uses project-management navigation state only on an unbound route', () => {
    expect(resolveHotCopySubmissionProjectId({ routeProjectId: 0, restartProjectId: '171' })).toBe(171)
    expect(resolveHotCopySubmissionProjectId({ routeProjectId: 0, boundProjectId: 172 })).toBe(172)
    expect(resolveHotCopySubmissionProjectId({ routeProjectId: 'invalid' })).toBe(0)
  })

  it('restores an explicitly unfinished entry draft without starting a provider operation', () => {
    expect(
      resolveHotCopyRestoredStarted(
        {
          started: false,
          step: 1,
          entryInitial: { libraryVideo: { assetId: 11 }, products: [{ assetId: 22 }] },
          vidGenTaskId: 0,
        },
        { currentStep: 'entry' },
      ),
    ).toBe(false)
  })

  it('keeps legacy completed and in-flight drafts on the video step', () => {
    expect(resolveHotCopyRestoredStarted({ fullVideoAssetId: 91 }, {})).toBe(true)
    expect(resolveHotCopyRestoredStarted({ vidGenTaskId: 301, videoGenerating: true }, {})).toBe(true)
    expect(resolveHotCopyRestoredStarted({}, {})).toBe(false)
  })
})
