import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listAssets: vi.fn(),
  getAssetDownloadUrl: vi.fn(),
  listRealPeople: vi.fn(),
}))

vi.mock('@/api/business', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/business')>()),
  listAssets: mocks.listAssets,
  getAssetDownloadUrl: mocks.getAssetDownloadUrl,
}))
vi.mock('@/api/realPeople', () => ({ listRealPeople: mocks.listRealPeople }))

import CanvasMaterialPicker from '@/components/canvas/CanvasMaterialPicker'

const assets = [1, 2, 3, 4].map((id) => ({
  id,
  name: `素材${id}`,
  type: 'image',
  mime_type: 'image/png',
  source: 'upload',
  status: 'active',
}))

beforeEach(() => {
  mocks.listRealPeople.mockReset().mockResolvedValue([])
  mocks.listAssets.mockReset().mockResolvedValue({ items: assets, total: assets.length })
  mocks.getAssetDownloadUrl.mockReset().mockImplementation(({ assetId }) => Promise.resolve(`/a/${assetId}.png`))
})

describe('CanvasMaterialPicker automatic identity routing', () => {
  it('recognizes a registered real-person asset selected from the ordinary material tab', async () => {
    mocks.listRealPeople.mockResolvedValue([
      {
        id: 9,
        workspace_id: 7,
        name: '测试真人',
        status: 'verified',
        assets: [{ id: 21, local_asset_id: 1, status: 'ready' }],
      },
    ])
    const user = userEvent.setup()
    const onApplyMany = vi.fn()
    render(
      <CanvasMaterialPicker
        workspaceId={7}
        visible
        variant="modal"
        onClose={vi.fn()}
        onApply={vi.fn()}
        selectionLimit={2}
        onApplyMany={onApplyMany}
      />,
    )
    await user.click(await screen.findByRole('checkbox', { name: '素材1' }))
    await user.click(screen.getByRole('checkbox', { name: '素材2' }))
    await user.click(screen.getByRole('button', { name: '添加 2 个参考' }))
    await waitFor(() => expect(onApplyMany).toHaveBeenCalledOnce())
    const selected = onApplyMany.mock.calls[0][0]
    expect(selected[0]).toMatchObject({
      source: 'real_person',
      realPerson: { realPersonId: 9, mappingId: 21, localAssetId: 1 },
    })
    expect(selected[1].realPerson).toBeUndefined()
    expect(mocks.listRealPeople).toHaveBeenCalledTimes(1)
  })

  it('keeps the selection for retry when the identity query fails', async () => {
    mocks.listRealPeople.mockRejectedValue(new Error('offline'))
    const user = userEvent.setup()
    const onApplyMany = vi.fn()
    render(
      <CanvasMaterialPicker
        workspaceId={7}
        visible
        variant="modal"
        onClose={vi.fn()}
        onApply={vi.fn()}
        selectionLimit={2}
        onApplyMany={onApplyMany}
      />,
    )
    await user.click(await screen.findByRole('checkbox', { name: '素材1' }))
    await user.click(screen.getByRole('button', { name: '添加 1 个参考' }))
    expect(await screen.findByText('真人身份查询失败，请稍后重试添加素材')).toBeInTheDocument()
    expect(onApplyMany).not.toHaveBeenCalled()
    expect(screen.getByRole('checkbox', { name: '素材1' })).toHaveAttribute('aria-checked', 'true')
  })
})

describe('CanvasMaterialPicker 选参考多选', () => {
  it('可多选、按勾选顺序一次性添加，超过剩余名额的勾选被拦下', async () => {
    const user = userEvent.setup()
    const onApplyMany = vi.fn()
    render(
      <CanvasMaterialPicker
        workspaceId={7}
        visible
        variant="modal"
        onClose={vi.fn()}
        onApply={vi.fn()}
        selectionLimit={2}
        onApplyMany={onApplyMany}
      />,
    )

    await user.click(await screen.findByRole('checkbox', { name: '素材3' }))
    await user.click(screen.getByRole('checkbox', { name: '素材1' }))
    expect(screen.getByText('已选 2 个，还可选 0 个')).toBeInTheDocument()

    // 第 3 个超出名额：不选中，并提示
    await user.click(screen.getByRole('checkbox', { name: '素材2' }))
    expect(screen.getByRole('checkbox', { name: '素材2' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByText('当前最多还能添加 2 个参考')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '添加 2 个参考' }))
    await waitFor(() => expect(onApplyMany).toHaveBeenCalledOnce())
    expect(onApplyMany.mock.calls[0][0].map((item: any) => [item.assetId, item.src])).toEqual([
      [3, '/a/3.png'],
      [1, '/a/1.png'],
    ])
  })

  it('取消勾选后名额释放', async () => {
    const user = userEvent.setup()
    render(
      <CanvasMaterialPicker
        workspaceId={7}
        visible
        variant="modal"
        onClose={vi.fn()}
        onApply={vi.fn()}
        selectionLimit={1}
        onApplyMany={vi.fn()}
      />,
    )
    const first = await screen.findByRole('checkbox', { name: '素材1' })
    await user.click(first)
    await user.click(first)
    await user.click(screen.getByRole('checkbox', { name: '素材2' }))
    expect(screen.getByRole('checkbox', { name: '素材2' })).toHaveAttribute('aria-checked', 'true')
  })

  it('不给 selectionLimit 时保持原来的单个「应用」', async () => {
    render(<CanvasMaterialPicker workspaceId={7} visible variant="modal" onClose={vi.fn()} onApply={vi.fn()} />)
    expect((await screen.findAllByRole('button', { name: '应用' })).length).toBe(4)
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })
})
