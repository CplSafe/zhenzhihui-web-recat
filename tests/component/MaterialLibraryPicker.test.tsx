import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createInitializedProjectFolder: vi.fn(),
  listCreativeProjects: vi.fn(),
  user: { id: 7 as number | string },
}))

vi.mock('antd', () => ({
  Modal: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div role="dialog">{children}</div> : null,
}))

vi.mock('@/api/business', () => ({
  getBusinessErrorMessage: (error: unknown, fallback: string) =>
    error instanceof Error && error.message ? error.message : fallback,
  listCreativeProjects: mocks.listCreativeProjects,
}))

vi.mock('@/utils/creativeProjectInitialization', () => ({
  createInitializedProjectFolder: mocks.createInitializedProjectFolder,
}))

vi.mock('@/stores/workspaceSession', () => ({
  useCurrentUser: () => mocks.user,
}))

import MaterialLibraryPicker from '@/components/material/MaterialLibraryPicker'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function project(id: number, title: string) {
  return {
    id,
    title,
    created_at: '2026-07-17T00:00:00.000Z',
    draft_json: { smart: { entryMeta: { imageAssetIds: [10] } } },
  }
}

const material = {
  id: 10,
  name: '人物照片',
  src: '/portrait.png',
  type: 'image',
  serverAsset: { id: 10, created_at: '2026-07-17T00:00:00.000Z' },
}

function pickerProps(workspaceId: number) {
  return {
    materials: [material],
    modelValue: true,
    onModelValueChange: vi.fn(),
    onBatchFavorite: vi.fn(),
    tab: 'mine',
    workspaceId,
  }
}

function folderButton(title: string): HTMLElement {
  const button = screen.getByText(title).closest<HTMLElement>('[role="button"]')
  if (!button) throw new Error(`找不到文件夹：${title}`)
  return button
}

function favoriteStar(): HTMLElement {
  const star = screen
    .getAllByRole('button', { name: '收藏' })
    .find((element) => element.classList.contains('mlp-media-star'))
  if (!star) throw new Error('找不到素材收藏按钮')
  return star
}

describe('MaterialLibraryPicker workspace isolation', () => {
  beforeEach(() => {
    mocks.createInitializedProjectFolder.mockReset()
    mocks.listCreativeProjects.mockReset()
    mocks.user.id = 7
  })

  it('initializes a new project folder before refreshing the folder list', async () => {
    const created = project(31, '新建项目文件夹')
    mocks.createInitializedProjectFolder.mockResolvedValue(created)
    mocks.listCreativeProjects.mockResolvedValueOnce([]).mockResolvedValueOnce([created]).mockResolvedValueOnce([])

    render(<MaterialLibraryPicker {...pickerProps(21)} />)

    await waitFor(() => expect(mocks.listCreativeProjects).toHaveBeenCalled())
    const initialListCalls = mocks.listCreativeProjects.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: '新建项目文件夹' }))

    await waitFor(() =>
      expect(mocks.createInitializedProjectFolder).toHaveBeenCalledWith({
        workspaceId: 21,
        title: '新建项目文件夹',
      }),
    )
    expect(await screen.findByRole('img', { name: '新建项目文件夹' })).toBeInTheDocument()
    expect(mocks.listCreativeProjects.mock.calls.length).toBeGreaterThan(initialListCalls)
  })

  it('hides A immediately and ignores its late project response after switching to B', async () => {
    const workspaceA = deferred<unknown[]>()
    const workspaceB = deferred<unknown[]>()
    mocks.listCreativeProjects.mockImplementation(({ workspaceId }: { workspaceId: number }) =>
      workspaceId === 21 ? workspaceA.promise : workspaceB.promise,
    )

    const { rerender } = render(<MaterialLibraryPicker {...pickerProps(21)} />)
    await waitFor(() =>
      expect(mocks.listCreativeProjects).toHaveBeenCalledWith({ workspaceId: 21, offset: 0, limit: 100 }),
    )

    rerender(<MaterialLibraryPicker {...pickerProps(22)} />)
    expect(screen.queryByText('Workspace A folder')).not.toBeInTheDocument()
    await waitFor(() =>
      expect(mocks.listCreativeProjects).toHaveBeenCalledWith({ workspaceId: 22, offset: 0, limit: 100 }),
    )

    await act(async () => {
      workspaceB.resolve([project(2, 'Workspace B folder')])
    })
    expect(await screen.findByText('Workspace B folder')).toBeInTheDocument()

    await act(async () => {
      workspaceA.resolve([project(1, 'Workspace A folder')])
    })
    expect(screen.queryByText('Workspace A folder')).not.toBeInTheDocument()
    expect(screen.getByText('Workspace B folder')).toBeInTheDocument()
  })

  it('reloads favorite overrides from the new workspace and writes only to its storage key', async () => {
    window.localStorage.setItem('mlp-favorites-user-7-workspace-21', JSON.stringify({ 10: true }))
    mocks.listCreativeProjects.mockImplementation(({ workspaceId }: { workspaceId: number }) =>
      Promise.resolve([project(workspaceId, workspaceId === 21 ? 'Workspace A folder' : 'Workspace B folder')]),
    )

    const { rerender } = render(<MaterialLibraryPicker {...pickerProps(21)} />)
    await screen.findByText('Workspace A folder')
    fireEvent.doubleClick(folderButton('Workspace A folder'))
    expect(favoriteStar()).toHaveClass('active')

    rerender(<MaterialLibraryPicker {...pickerProps(22)} />)
    expect(screen.queryByText('Workspace A folder')).not.toBeInTheDocument()
    await screen.findByText('Workspace B folder')
    fireEvent.doubleClick(folderButton('Workspace B folder'))

    const workspaceBFavorite = favoriteStar()
    expect(workspaceBFavorite).not.toHaveClass('active')
    fireEvent.click(workspaceBFavorite)

    expect(JSON.parse(window.localStorage.getItem('mlp-favorites-user-7-workspace-22') || '{}')).toEqual({
      10: true,
    })
    expect(JSON.parse(window.localStorage.getItem('mlp-favorites-user-7-workspace-21') || '{}')).toEqual({
      10: true,
    })
  })

  it('isolates local favorite overrides by account inside the same workspace', async () => {
    window.localStorage.setItem('mlp-favorites-user-7-workspace-21', JSON.stringify({ 10: true }))
    mocks.listCreativeProjects.mockResolvedValue([project(21, 'Shared workspace folder')])

    const { rerender } = render(<MaterialLibraryPicker {...pickerProps(21)} />)
    await screen.findByText('Shared workspace folder')
    fireEvent.doubleClick(folderButton('Shared workspace folder'))
    expect(favoriteStar()).toHaveClass('active')

    mocks.user.id = 'account-b'
    rerender(<MaterialLibraryPicker {...pickerProps(21)} />)
    await screen.findByText('Shared workspace folder')
    fireEvent.doubleClick(folderButton('Shared workspace folder'))
    await waitFor(() => expect(favoriteStar()).not.toHaveClass('active'))
    fireEvent.click(favoriteStar())

    expect(JSON.parse(window.localStorage.getItem('mlp-favorites-user-account-b-workspace-21') || '{}')).toEqual({
      10: true,
    })
    expect(JSON.parse(window.localStorage.getItem('mlp-favorites-user-7-workspace-21') || '{}')).toEqual({
      10: true,
    })
  })

  it('hides only projects that explicitly restrict the current member', async () => {
    mocks.listCreativeProjects.mockResolvedValue([
      {
        ...project(1, 'Restricted folder'),
        user_id: 8,
        draft_json: { restrictedMemberIds: [7] },
      },
      {
        ...project(2, 'Accessible folder'),
        user_id: 8,
        draft_json: { restrictedMemberIds: [9] },
      },
    ])

    render(<MaterialLibraryPicker {...pickerProps(21)} />)

    expect(await screen.findByText('Accessible folder')).toBeInTheDocument()
    expect(screen.queryByText('Restricted folder')).not.toBeInTheDocument()
  })

  it('never exposes materials owned by a restricted project through the unclassified folder', async () => {
    mocks.listCreativeProjects.mockResolvedValue([
      {
        id: 1,
        title: 'Restricted folder',
        user_id: 8,
        draft_json: {
          restrictedMemberIds: [7],
          smart: { entryMeta: { imageAssetIds: [21] } },
        },
      },
      {
        id: 2,
        title: 'Accessible folder',
        user_id: 8,
        draft_json: {
          restrictedMemberIds: [9],
          smart: { entryMeta: { imageAssetIds: [22] } },
        },
      },
    ])
    const materials = [
      { ...material, id: 'asset-21', assetId: 21, name: '受限草稿关联素材', serverAsset: { id: 21 } },
      {
        ...material,
        id: 'asset-23',
        assetId: 23,
        name: '受限显式关联素材',
        serverAsset: { id: 23, project_id: 1 },
      },
      { ...material, id: 'asset-22', assetId: 22, name: '可访问项目素材', serverAsset: { id: 22 } },
      { ...material, id: 'asset-24', assetId: 24, name: '真正未归类素材', serverAsset: { id: 24 } },
    ]

    render(<MaterialLibraryPicker {...pickerProps(21)} materials={materials} />)

    await screen.findByText('Accessible folder')
    expect(screen.queryByText('Restricted folder')).not.toBeInTheDocument()
    fireEvent.doubleClick(folderButton('未归类素材'))

    expect(screen.getByAltText('真正未归类素材')).toBeInTheDocument()
    expect(screen.queryByAltText('受限草稿关联素材')).not.toBeInTheDocument()
    expect(screen.queryByAltText('受限显式关联素材')).not.toBeInTheDocument()
  })

  it('applies the same restricted-project filter in the favorites view', async () => {
    mocks.listCreativeProjects.mockResolvedValue([
      {
        id: 1,
        title: 'Restricted folder',
        user_id: 8,
        draft_json: {
          restrictedMemberIds: [7],
          smart: { entryMeta: { imageAssetIds: [21] } },
        },
      },
    ])
    const materials = [
      {
        ...material,
        id: 'asset-21',
        assetId: 21,
        name: '受限收藏素材',
        favorite: true,
        serverAsset: { id: 21 },
      },
      {
        ...material,
        id: 'asset-24',
        assetId: 24,
        name: '可访问收藏素材',
        favorite: true,
        serverAsset: { id: 24 },
      },
    ]

    render(<MaterialLibraryPicker {...pickerProps(21)} tab="favorite" materials={materials} />)

    await screen.findByText('全部素材')
    fireEvent.doubleClick(folderButton('全部素材'))
    expect(screen.getByAltText('可访问收藏素材')).toBeInTheDocument()
    expect(screen.queryByAltText('受限收藏素材')).not.toBeInTheDocument()
  })

  it('fails closed when project access cannot be loaded', async () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined)
    mocks.listCreativeProjects.mockRejectedValue(new Error('权限列表暂不可用'))

    render(<MaterialLibraryPicker {...pickerProps(21)} />)

    await waitFor(() => expect(alert).toHaveBeenCalledWith('权限列表暂不可用'))
    expect(screen.queryByText('全部素材')).not.toBeInTheDocument()
    expect(screen.queryByAltText('人物照片')).not.toBeInTheDocument()
  })

  it('places materials only in their real project folder and keeps unmatched assets unclassified', async () => {
    mocks.listCreativeProjects.mockResolvedValue([
      {
        id: 1,
        title: '项目一',
        draft_json: { smart: { entryMeta: { imageAssetIds: [21] } } },
      },
      {
        id: 2,
        title: '项目二',
        draft_json: { smart: { entryMeta: { imageAssetIds: [22] } } },
      },
    ])
    const materials = [
      { ...material, id: 'asset-21', assetId: 21, name: '项目一素材', serverAsset: { id: 21 } },
      { ...material, id: 'asset-22', assetId: 22, name: '项目二素材', serverAsset: { id: 22 } },
      { ...material, id: 'asset-23', assetId: 23, name: '未归类素材项', serverAsset: { id: 23 } },
    ]

    render(<MaterialLibraryPicker {...pickerProps(21)} materials={materials} />)

    await screen.findByText('项目一')
    fireEvent.doubleClick(folderButton('项目一'))
    expect(screen.getByAltText('项目一素材')).toBeInTheDocument()
    expect(screen.queryByAltText('项目二素材')).not.toBeInTheDocument()
    expect(screen.queryByAltText('未归类素材项')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '返回上一页' }))
    fireEvent.doubleClick(folderButton('未归类素材'))
    expect(screen.getByAltText('未归类素材项')).toBeInTheDocument()
    expect(screen.queryByAltText('项目一素材')).not.toBeInTheDocument()
  })

  it('does not render upload, delete or favorite controls when callers provide no persistence handlers', async () => {
    mocks.listCreativeProjects.mockResolvedValue([project(1, '项目一')])
    const props = pickerProps(21)
    const { onBatchFavorite: _onBatchFavorite, ...withoutPersistenceHandlers } = props

    render(<MaterialLibraryPicker {...withoutPersistenceHandlers} />)

    await screen.findByText('项目一')
    expect(screen.queryByRole('button', { name: '我的收藏' })).not.toBeInTheDocument()
    fireEvent.doubleClick(folderButton('项目一'))
    expect(screen.queryByRole('button', { name: '上传本地素材' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '收藏' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '删除' })).not.toBeInTheDocument()
  })
})
