import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  deleteAsset: vi.fn(),
  getAssetDownloadUrl: vi.fn(),
  listAssets: vi.fn(),
  requestConfirm: vi.fn(),
  showToast: vi.fn(),
  uploadAssetFile: vi.fn(),
}))

vi.mock('@/api/business', () => ({
  deleteAsset: mocks.deleteAsset,
  extractAssetPage: (payload: { items?: unknown[]; limit?: number; offset?: number; total?: number }) => ({
    items: payload?.items ?? [],
    limit: payload?.limit ?? payload?.items?.length ?? 0,
    offset: payload?.offset ?? 0,
    total: payload?.total ?? payload?.items?.length ?? 0,
  }),
  getAssetDownloadUrl: mocks.getAssetDownloadUrl,
  getBusinessErrorMessage: (error: unknown, fallback: string) =>
    error instanceof Error && error.message ? error.message : fallback,
  listAssets: mocks.listAssets,
  uploadAssetFile: mocks.uploadAssetFile,
}))

vi.mock('@/composables/useToast', () => ({
  useConfirmDialog: () => ({ requestConfirm: mocks.requestConfirm }),
  useToast: () => ({ showToast: mocks.showToast }),
}))

import RealPersonLibrary from '@/components/resource/RealPersonLibrary'

describe('RealPersonLibrary partial URL failures', () => {
  beforeEach(() => {
    mocks.deleteAsset.mockReset()
    mocks.getAssetDownloadUrl.mockReset()
    mocks.listAssets.mockReset()
    mocks.requestConfirm.mockReset()
    mocks.showToast.mockReset()
    mocks.uploadAssetFile.mockReset()
  })

  it('keeps valid people visible when one asset URL cannot be resolved', async () => {
    mocks.listAssets.mockResolvedValue({
      items: [
        { id: 1, name: '失效形象', source: 'real_person' },
        { id: 2, name: '可用形象', source: 'real_person' },
      ],
      limit: 20,
      offset: 0,
      total: 2,
    })
    mocks.getAssetDownloadUrl.mockImplementation(({ assetId }: { assetId: number }) =>
      assetId === 1 ? Promise.reject(new Error('temporary URL failure')) : Promise.resolve('/people/2.png'),
    )

    render(<RealPersonLibrary workspaceId={21} />)

    expect(await screen.findByRole('img', { name: '可用形象' })).toHaveAttribute('src', '/people/2.png')
    expect(screen.queryByRole('img', { name: '失效形象' })).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('loads one server page and resolves URLs for the visible page only', async () => {
    const firstPage = Array.from({ length: 20 }, (_, index) => ({
      id: index + 1,
      name: `首屏形象 ${index + 1}`,
      source: 'real_person',
    }))
    const secondPage = [{ id: 21, name: '第二页形象', source: 'real_person' }]
    mocks.listAssets
      .mockResolvedValueOnce({ items: firstPage, limit: 20, offset: 0, total: 21 })
      .mockResolvedValueOnce({ items: secondPage, limit: 20, offset: 20, total: 21 })
    mocks.getAssetDownloadUrl.mockImplementation(({ assetId }: { assetId: number }) =>
      Promise.resolve(`/people/${assetId}.png`),
    )

    render(<RealPersonLibrary workspaceId={21} />)

    expect(await screen.findByRole('img', { name: '首屏形象 1' })).toHaveAttribute('src', '/people/1.png')
    expect(mocks.listAssets).toHaveBeenCalledTimes(1)
    expect(mocks.listAssets).toHaveBeenCalledWith({
      workspaceId: 21,
      type: 'image',
      status: 'active',
      source: 'real_person',
      limit: 20,
      offset: 0,
    })
    expect(mocks.getAssetDownloadUrl).toHaveBeenCalledTimes(20)
    expect(mocks.getAssetDownloadUrl).not.toHaveBeenCalledWith({ workspaceId: 21, assetId: 21 })

    fireEvent.click(screen.getByTitle('2'))
    await waitFor(() =>
      expect(mocks.listAssets).toHaveBeenLastCalledWith({
        workspaceId: 21,
        type: 'image',
        status: 'active',
        source: 'real_person',
        limit: 20,
        offset: 20,
      }),
    )
    expect(await screen.findByRole('img', { name: '第二页形象' })).toHaveAttribute('src', '/people/21.png')
  })
})
