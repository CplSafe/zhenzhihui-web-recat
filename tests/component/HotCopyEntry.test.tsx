import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listAiTasks: vi.fn(),
  listAssets: vi.fn(),
  listCreativeProjects: vi.fn(),
  showToast: vi.fn(),
  currentUserId: 7,
  workspaceId: 21,
}))

vi.mock('@/stores/workspaceSession', () => ({
  useCurrentUser: () => (mocks.currentUserId ? { id: mocks.currentUserId } : null),
  useWorkspaceId: () => mocks.workspaceId,
}))

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}))

vi.mock('@/api/business', () => ({
  extractAssetPage: (payload: { items?: unknown[]; offset?: number; total?: number }) => ({
    items: payload?.items ?? [],
    limit: payload?.items?.length ?? 0,
    offset: payload?.offset ?? 0,
    total: payload?.total ?? payload?.items?.length ?? 0,
  }),
  extractAssetPageItems: (payload: { items?: unknown[] } | null) => payload?.items ?? [],
  listAiTasks: mocks.listAiTasks,
  listAssets: mocks.listAssets,
  listCreativeProjects: mocks.listCreativeProjects,
}))

vi.mock('@/components/material/MaterialLibraryPicker', () => ({
  default: ({
    materials,
    modelValue,
    projectName,
  }: {
    materials: Array<{ id: string; name: string }>
    modelValue: boolean
    projectName: string
  }) =>
    modelValue ? (
      <section aria-label={`${projectName}素材选择器`}>
        {materials.map((material) => (
          <span key={material.id}>{material.name}</span>
        ))}
      </section>
    ) : null,
}))

vi.mock('@/components/hotcopy/HotCopyCaseModal/HotCopyCaseModal', () => ({
  default: () => null,
}))

vi.mock('@/components/smart/EntryCanvasBg', () => ({
  default: () => null,
}))

import HotCopyEntry from '@/components/hotcopy/HotCopyEntry/HotCopyEntry'

function project(id: number, restrictedMemberIds: number[]) {
  return { id, user_id: 8, draft_json: { restrictedMemberIds } }
}

function asset(id: number, name: string, type: 'image' | 'video', projectId = 0) {
  return {
    id,
    name,
    type,
    url: `/${id}.${type === 'video' ? 'mp4' : 'png'}`,
    ...(projectId ? { project_id: projectId } : {}),
  }
}

function openLibraryFor(tileLabel: string) {
  const tile = screen.getByText(tileLabel).closest('.hotcopy__tilewrap')
  if (!tile) throw new Error(`找不到入口: ${tileLabel}`)
  fireEvent.click(within(tile as HTMLElement).getByRole('button', { name: tileLabel }))
  fireEvent.click(within(tile as HTMLElement).getByRole('button', { name: '素材库' }))
}

describe('HotCopyEntry project asset access', () => {
  beforeEach(() => {
    mocks.listAiTasks.mockReset()
    mocks.listAiTasks.mockResolvedValue({ items: [] })
    mocks.listAssets.mockReset()
    mocks.listCreativeProjects.mockReset()
    mocks.showToast.mockReset()
    mocks.currentUserId = 7
    mocks.workspaceId = 21
  })

  it('shows unlinked and accessible-project videos but hides restricted and unknown linked videos', async () => {
    mocks.listCreativeProjects.mockResolvedValue([project(1, [7]), project(2, [9])])
    mocks.listAssets.mockResolvedValue({
      items: [
        asset(101, 'Unlinked video', 'video'),
        asset(102, 'Accessible video', 'video', 2),
        asset(103, 'Restricted video', 'video', 1),
        asset(104, 'Unknown video', 'video', 999),
      ],
    })

    render(<HotCopyEntry onSubmit={vi.fn()} />)
    openLibraryFor('上传爆款视频')

    expect(await screen.findByText('Unlinked video')).toBeInTheDocument()
    expect(await screen.findByText('Accessible video')).toBeInTheDocument()
    expect(screen.queryByText('Restricted video')).not.toBeInTheDocument()
    expect(screen.queryByText('Unknown video')).not.toBeInTheDocument()
  })

  it('keeps unlinked images and fails closed for linked images when project permissions fail', async () => {
    mocks.listCreativeProjects.mockRejectedValue(new Error('project list unavailable'))
    mocks.listAssets.mockResolvedValue({
      items: [asset(201, 'Unlinked image', 'image'), asset(202, 'Linked hidden image', 'image', 2)],
    })

    render(<HotCopyEntry onSubmit={vi.fn()} />)
    openLibraryFor('上传替换素材')

    expect(await screen.findByText('Unlinked image')).toBeInTheDocument()
    expect(screen.queryByText('Linked hidden image')).not.toBeInTheDocument()
  })

  it('does not request project-scoped materials before the user identity is known', () => {
    mocks.currentUserId = 0

    render(<HotCopyEntry onSubmit={vi.fn()} />)
    openLibraryFor('上传爆款视频')

    expect(mocks.listAssets).not.toHaveBeenCalled()
    expect(mocks.listCreativeProjects).not.toHaveBeenCalled()
    expect(mocks.showToast).toHaveBeenCalledWith('登录身份尚未就绪，请稍后重试', 'error')
  })

  it('discards an in-flight material response when the user changes in the same workspace', async () => {
    let resolveAssets: (value: unknown) => void = () => {}
    let resolveProjects: (value: unknown) => void = () => {}
    mocks.listAssets.mockReturnValue(
      new Promise((resolve) => {
        resolveAssets = resolve
      }),
    )
    mocks.listCreativeProjects.mockReturnValue(
      new Promise((resolve) => {
        resolveProjects = resolve
      }),
    )

    const { rerender } = render(<HotCopyEntry onSubmit={vi.fn()} />)
    openLibraryFor('上传爆款视频')

    mocks.currentUserId = 9
    rerender(<HotCopyEntry onSubmit={vi.fn()} />)
    await act(async () => {
      resolveProjects([project(2, [9])])
      resolveAssets({ items: [asset(301, 'Previous user video', 'video', 2)] })
      await Promise.resolve()
    })

    expect(screen.queryByText('Previous user video')).not.toBeInTheDocument()
  })

  it('emits project-persistable entry changes without submitting a generation', async () => {
    const onSubmit = vi.fn()
    const onDraftChange = vi.fn()
    render(
      <HotCopyEntry
        onSubmit={onSubmit}
        onDraftChange={onDraftChange}
        initial={{
          tab: 'remake',
          videoSource: 'library',
          libraryVideo: { assetId: 101, src: '/101.mp4' },
          videoPreview: '/101.mp4',
          products: [{ assetId: 201, url: '/201.png', file: null, isVideo: false }],
          ratio: '16:9',
          duration: '10s',
          text: '',
        }}
      />,
    )

    await waitFor(() => expect(onDraftChange).toHaveBeenCalled())
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '保留节奏，突出产品' } })
    const durationButton = screen
      .getAllByRole('button')
      .filter((button) => button.getAttribute('aria-haspopup') === 'listbox')[1]
    fireEvent.click(durationButton)
    fireEvent.click(screen.getByRole('option', { name: '7s' }))

    await waitFor(() => {
      expect(onDraftChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          libraryVideo: { assetId: 101, src: '/101.mp4' },
          products: [expect.objectContaining({ assetId: 201 })],
          text: '保留节奏，突出产品',
          ratio: '16:9',
          duration: '7s',
        }),
      )
    })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('offers the same 1s through 15s whole-second range as smart video', async () => {
    const user = userEvent.setup()
    render(<HotCopyEntry onSubmit={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: '10s' }))
    expect(
      within(screen.getByRole('listbox'))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['1s', '2s', '3s', '4s', '5s', '6s', '7s', '8s', '9s', '10s', '11s', '12s', '13s', '14s', '15s'])
  })

  it('restores and submits the exact duration saved in the entry draft', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <HotCopyEntry
        onSubmit={onSubmit}
        initial={{
          tab: 'remake',
          videoSource: 'library',
          libraryVideo: { assetId: 101, src: '/101.mp4' },
          videoPreview: '/101.mp4',
          products: [{ assetId: 201, url: '/201.png', file: null, isVideo: false }],
          ratio: '16:9',
          duration: '7s',
          text: '',
        }}
      />,
    )

    expect(screen.getByRole('button', { name: '7s' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '去制作' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ duration: '7s' }))
  })
})
