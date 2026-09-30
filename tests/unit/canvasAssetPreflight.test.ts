import { beforeEach, describe, expect, it, vi } from 'vitest'
import { preflightCanvasAssets } from '@/utils/canvasAssetPreflight'
import { findActiveWorkspaceAssetIds } from '@/utils/taskMedia'

vi.mock('@/utils/taskMedia', () => ({ findActiveWorkspaceAssetIds: vi.fn() }))

const findActive = vi.mocked(findActiveWorkspaceAssetIds)

describe('canvas asset preflight', () => {
  beforeEach(() => vi.resetAllMocks())

  it('allows text-only generation without querying assets', async () => {
    expect(await preflightCanvasAssets({ workspaceId: 11, sourceRefs: [], inputAssets: [] })).toBeNull()
    expect(findActive).not.toHaveBeenCalled()
  })

  it('blocks known foreign-team references before querying', async () => {
    const error = await preflightCanvasAssets({
      workspaceId: 11,
      sourceRefs: [{ kind: 'video', assetId: 42, workspaceId: 12 }],
      inputAssets: [{ asset_id: 42, role: 'video' }],
    })
    expect(error).toContain('其他团队')
    expect(error).toContain('42')
    expect(findActive).not.toHaveBeenCalled()
  })

  it('checks video and image IDs in the current workspace', async () => {
    findActive.mockImplementation(async (_workspaceId, ids) => new Set(ids))
    expect(
      await preflightCanvasAssets({
        workspaceId: 11,
        sourceRefs: [],
        inputAssets: [
          { asset_id: 42, role: 'video' },
          { asset_id: 43, role: 'reference_image' },
        ],
      }),
    ).toBeNull()
    expect(findActive).toHaveBeenCalledWith(11, [42], 'video')
    expect(findActive).toHaveBeenCalledWith(11, [43], 'image')
  })

  it('identifies an unavailable asset without claiming its exact cause', async () => {
    findActive.mockResolvedValue(new Set())
    const error = await preflightCanvasAssets({
      workspaceId: 11,
      sourceRefs: [],
      inputAssets: [{ asset_id: 42, role: 'video' }],
    })
    expect(error).toContain('42')
    expect(error).toContain('可能')
  })

  it('leaves real-person authorization to its dedicated check', async () => {
    expect(
      await preflightCanvasAssets({
        workspaceId: 11,
        sourceRefs: [{ kind: 'image', assetId: 42, source: 'real_person' }],
        inputAssets: [{ asset_id: 42, role: 'image' }],
      }),
    ).toBeNull()
    expect(findActive).not.toHaveBeenCalled()
  })

  it('does not misdiagnose a lookup failure as a foreign-team asset', async () => {
    findActive.mockRejectedValue(new Error('network'))
    const error = await preflightCanvasAssets({
      workspaceId: 11,
      sourceRefs: [],
      inputAssets: [{ asset_id: 42, role: 'video' }],
    })
    expect(error).toContain('暂时无法核验')
  })
})
