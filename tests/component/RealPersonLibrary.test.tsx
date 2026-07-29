import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  addRealPersonAsset: vi.fn(),
  createRealPerson: vi.fn(),
  deleteRealPerson: vi.fn(),
  deleteRealPersonAsset: vi.fn(),
  getAssetDownloadUrl: vi.fn(),
  getRealPerson: vi.fn(),
  listRealPeople: vi.fn(),
  requestConfirm: vi.fn(),
  restartRealPersonVerification: vi.fn(),
  showToast: vi.fn(),
  syncRealPerson: vi.fn(),
  syncRealPersonAsset: vi.fn(),
  uploadAssetFile: vi.fn(),
}))

vi.mock('@/api/business', () => ({
  getAssetDownloadUrl: mocks.getAssetDownloadUrl,
  getBusinessErrorMessage: (error: unknown, fallback: string) =>
    error instanceof Error && error.message ? error.message : fallback,
  uploadAssetFile: mocks.uploadAssetFile,
}))

vi.mock('@/api/realPeople', () => ({
  addRealPersonAsset: mocks.addRealPersonAsset,
  createRealPerson: mocks.createRealPerson,
  deleteRealPerson: mocks.deleteRealPerson,
  deleteRealPersonAsset: mocks.deleteRealPersonAsset,
  getRealPerson: mocks.getRealPerson,
  listRealPeople: mocks.listRealPeople,
  restartRealPersonVerification: mocks.restartRealPersonVerification,
  syncRealPerson: mocks.syncRealPerson,
  syncRealPersonAsset: mocks.syncRealPersonAsset,
}))

vi.mock('@/composables/useToast', () => ({
  useConfirmDialog: () => ({ requestConfirm: mocks.requestConfirm }),
  useToast: () => ({ showToast: mocks.showToast }),
}))

vi.mock('uqr', () => ({
  renderSVG: () => '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
}))

import RealPersonLibrary from '@/components/resource/RealPersonLibrary'

const pendingPerson = {
  id: 9,
  workspace_id: 21,
  name: '品牌主理人',
  description: '产品讲解人',
  status: 'pending',
  consent_confirmed_at: '2026-07-28T08:00:00Z',
  created_at: '2026-07-28T08:00:00Z',
  assets: [],
}

const activeMapping = {
  id: 701,
  workspace_id: 21,
  real_person_id: 9,
  local_asset_id: 44,
  name: '正面照',
  asset_type: 'image',
  status: 'active',
}

const verifiedPerson = {
  ...pendingPerson,
  status: 'verified',
  verified_at: '2026-07-28T08:03:00Z',
  assets: [activeMapping],
}

describe('RealPersonLibrary', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset())
    sessionStorage.clear()
    mocks.listRealPeople.mockResolvedValue([])
    mocks.getAssetDownloadUrl.mockImplementation(({ assetId }: { assetId: number }) =>
      Promise.resolve(`/people/${assetId}.png`),
    )
    mocks.requestConfirm.mockResolvedValue(true)
  })

  it('renders dedicated real-person records and resolves the cover by local asset ID', async () => {
    mocks.listRealPeople.mockResolvedValue([verifiedPerson])

    render(<RealPersonLibrary workspaceId={21} userId={301} />)

    expect(await screen.findByRole('img', { name: '品牌主理人' })).toHaveAttribute('src', '/people/44.png')
    expect(mocks.listRealPeople).toHaveBeenCalledWith({
      workspaceId: 21,
      signal: expect.any(AbortSignal),
    })
    expect(mocks.getAssetDownloadUrl).toHaveBeenCalledWith({ workspaceId: 21, assetId: 44 })
    expect(screen.getByRole('button', { name: '管理品牌主理人' })).toBeEnabled()
    expect(screen.getByRole('button', { name: /^创建新形象/ })).toHaveTextContent('完成真人认证后上传素材')
  })

  it('creates a profile only after explicit consent and renders the backend KYC link', async () => {
    const user = userEvent.setup()
    const session = {
      h5_link: 'https://verify.example.test/session-9',
      expires_at: '2099-07-28T08:30:00Z',
      person: pendingPerson,
    }
    mocks.createRealPerson.mockResolvedValue(session)

    render(<RealPersonLibrary workspaceId={21} userId={301} />)

    await user.click(await screen.findByRole('button', { name: /^创建新形象/ }))
    const dialog = screen.getByRole('dialog', { name: '创建或管理真人形象' })
    const startButton = within(dialog).getByRole('button', { name: /开始真人认证/ })
    expect(startButton).toBeDisabled()

    await user.type(within(dialog).getByLabelText('形象名称'), '品牌主理人')
    await user.type(within(dialog).getByLabelText('形象说明（选填）'), '产品讲解人')
    await user.click(within(dialog).getByLabelText(/我确认已取得本人授权/))
    expect(startButton).toBeEnabled()
    await user.click(startButton)

    await waitFor(() =>
      expect(mocks.createRealPerson).toHaveBeenCalledWith({
        workspaceId: 21,
        name: '品牌主理人',
        consentConfirmed: true,
        description: '产品讲解人',
        signal: expect.any(AbortSignal),
      }),
    )
    expect(await within(dialog).findByLabelText(`认证二维码 ${session.h5_link}`)).toBeInTheDocument()
    const links = within(dialog).getAllByRole('link')
    expect(links).toHaveLength(2)
    expect(links.every((link) => link.getAttribute('href') === session.h5_link)).toBe(true)
  })

  it('rejects an unsafe KYC link and asks for a new verification session', async () => {
    const user = userEvent.setup()
    mocks.createRealPerson.mockResolvedValue({
      h5_link: 'javascript:alert(document.cookie)',
      expires_at: '2099-07-28T08:30:00Z',
      person: pendingPerson,
    })

    render(<RealPersonLibrary workspaceId={21} userId={301} />)

    await user.click(await screen.findByRole('button', { name: /^创建新形象/ }))
    await user.type(screen.getByLabelText('形象名称'), '品牌主理人')
    await user.click(screen.getByLabelText(/我确认已取得本人授权/))
    await user.click(screen.getByRole('button', { name: /开始真人认证/ }))

    expect(await screen.findByRole('heading', { name: '需要认证链接' })).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /重新发起认证/ })).toBeEnabled()
  })

  it('does not turn an existing profile opened for management into a recoverable new-profile draft', async () => {
    const user = userEvent.setup()
    mocks.listRealPeople.mockResolvedValue([verifiedPerson])
    mocks.getRealPerson.mockResolvedValue(verifiedPerson)

    render(<RealPersonLibrary workspaceId={21} userId={301} />)

    await user.click(await screen.findByRole('button', { name: '管理品牌主理人' }))
    expect(await screen.findByRole('heading', { name: '上传照片或视频' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '返回真人素材库' }))
    await user.click(await screen.findByRole('button', { name: /^创建新形象/ }))

    expect(await screen.findByRole('heading', { name: '创建真人档案' })).toBeInTheDocument()
    expect(mocks.getRealPerson).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem('zzh:real-person-creation:301:21')).toBeNull()
  })

  it('completes KYC, uploads a local asset, binds it, and syncs by mapping ID', async () => {
    const user = userEvent.setup()
    const session = {
      h5_link: 'https://verify.example.test/session-9',
      expires_at: '2099-07-28T08:30:00Z',
      person: pendingPerson,
    }
    const pendingMapping = { ...activeMapping, status: 'processing' }
    mocks.createRealPerson.mockResolvedValue(session)
    mocks.syncRealPerson.mockResolvedValue(verifiedPerson)
    mocks.uploadAssetFile.mockResolvedValue({ asset: { id: 44 } })
    mocks.addRealPersonAsset.mockResolvedValue(pendingMapping)
    mocks.syncRealPersonAsset.mockResolvedValue(activeMapping)
    mocks.getRealPerson.mockResolvedValue(verifiedPerson)

    const { container } = render(<RealPersonLibrary workspaceId={21} userId={301} />)

    await user.click(await screen.findByRole('button', { name: /^创建新形象/ }))
    await user.type(screen.getByLabelText('形象名称'), '品牌主理人')
    await user.click(screen.getByLabelText(/我确认已取得本人授权/))
    await user.click(screen.getByRole('button', { name: /开始真人认证/ }))
    await user.click(await screen.findByRole('button', { name: /我已完成认证，同步状态/ }))

    expect(await screen.findByRole('heading', { name: '上传照片或视频' })).toBeInTheDocument()
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')
    expect(fileInput).not.toBeNull()
    const file = new File(['portrait'], 'portrait.png', { type: 'image/png' })
    await user.upload(fileInput!, file)

    expect(await screen.findByRole('heading', { name: '创建完成' })).toBeInTheDocument()
    expect(mocks.uploadAssetFile).toHaveBeenCalledWith({
      workspaceId: 21,
      file,
      source: 'real_person',
      prompt: '品牌主理人',
      signal: expect.any(AbortSignal),
    })
    expect(mocks.addRealPersonAsset).toHaveBeenCalledWith({
      workspaceId: 21,
      personId: 9,
      assetId: 44,
      name: 'portrait',
      signal: expect.any(AbortSignal),
    })
    expect(mocks.syncRealPersonAsset).toHaveBeenCalledWith({
      workspaceId: 21,
      personId: 9,
      assetId: 701,
      signal: expect.any(AbortSignal),
    })
  })

  it('deletes a mapped person asset by mapping ID without deleting the source asset', async () => {
    const user = userEvent.setup()
    mocks.listRealPeople.mockResolvedValue([verifiedPerson])
    mocks.getRealPerson.mockResolvedValueOnce(verifiedPerson).mockResolvedValueOnce({ ...verifiedPerson, assets: [] })
    mocks.deleteRealPersonAsset.mockResolvedValue(undefined)

    render(<RealPersonLibrary workspaceId={21} userId={301} />)

    await user.click(await screen.findByRole('button', { name: '管理品牌主理人' }))
    const dialog = screen.getByRole('dialog', { name: '创建或管理真人形象' })
    await within(dialog).findByText('已关联素材')
    await user.click(within(dialog).getByRole('button', { name: /删除/ }))

    await waitFor(() =>
      expect(mocks.deleteRealPersonAsset).toHaveBeenCalledWith({
        workspaceId: 21,
        personId: 9,
        assetId: 701,
        signal: expect.any(AbortSignal),
      }),
    )
    expect(mocks.requestConfirm).toHaveBeenCalledWith(
      '确定删除“正面照”吗？',
      expect.objectContaining({ title: '删除真人素材', danger: true }),
    )
    expect(mocks.showToast).toHaveBeenCalledWith('真人素材已删除，素材中心原始文件不受影响', 'success')
  })

  it('keeps a successful mapping deletion when the follow-up detail refresh fails', async () => {
    const user = userEvent.setup()
    mocks.listRealPeople.mockResolvedValue([verifiedPerson])
    mocks.getRealPerson.mockResolvedValueOnce(verifiedPerson).mockRejectedValueOnce(new Error('refresh unavailable'))
    mocks.deleteRealPersonAsset.mockResolvedValue(undefined)

    render(<RealPersonLibrary workspaceId={21} userId={301} />)

    await user.click(await screen.findByRole('button', { name: '管理品牌主理人' }))
    const dialog = screen.getByRole('dialog', { name: '创建或管理真人形象' })
    await user.click(within(dialog).getByRole('button', { name: /删除/ }))

    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith('真人素材已删除，素材中心原始文件不受影响', 'success'),
    )
    expect(within(dialog).queryByText('正面照')).not.toBeInTheDocument()
    expect(mocks.showToast).not.toHaveBeenCalledWith(expect.stringContaining('删除失败'), 'error')
  })

  it('deletes the profile through the card menu and explains an undeployed backend', async () => {
    const user = userEvent.setup()
    mocks.listRealPeople.mockResolvedValueOnce([verifiedPerson]).mockRejectedValueOnce(
      Object.assign(new Error('Not Found'), {
        status: 404,
      }),
    )
    mocks.deleteRealPerson.mockResolvedValue(undefined)

    render(<RealPersonLibrary workspaceId={21} userId={301} />)

    await user.click(await screen.findByRole('button', { name: '品牌主理人的更多操作' }))
    await user.click(await screen.findByText('删除形象'))

    await waitFor(() =>
      expect(mocks.deleteRealPerson).toHaveBeenCalledWith({
        workspaceId: 21,
        personId: 9,
        signal: expect.any(AbortSignal),
      }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('当前环境尚未部署真人素材接口，请联系后端部署后重试')
  })
})
