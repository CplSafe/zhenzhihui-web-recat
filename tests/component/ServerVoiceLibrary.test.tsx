import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ServerVoiceLibrary from '@/components/canvas/ServerVoiceLibrary'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  edit: vi.fn(),
  remove: vi.fn(),
  favorite: vi.fn(),
  retry: vi.fn(),
  sync: vi.fn(),
  upload: vi.fn(),
  confirm: vi.fn(),
}))
vi.mock('@/api/voices', async (original) => ({
  ...(await original<typeof import('@/api/voices')>()),
  listVoices: mocks.list,
  getVoice: mocks.get,
  createVoice: mocks.create,
  updateVoice: mocks.edit,
  deleteVoice: mocks.remove,
  setVoiceFavorite: mocks.favorite,
  retryVoice: mocks.retry,
  syncVoice: mocks.sync,
}))
vi.mock('@/api/business', () => ({ uploadAssetFile: mocks.upload }))
vi.mock('@/composables/useToast', () => ({ useConfirmDialog: () => ({ requestConfirm: mocks.confirm }) }))
const voice = { id: 5, name: '角色旁白', source: 'cloned', status: 'ready', workspace_id: 21, is_favorite: false }
const props = () => ({
  userId: 'user',
  workspaceId: 21,
  modelVersionId: 91,
  canManage: true,
  disabled: false,
  onSelect: vi.fn(),
  onBusyChange: vi.fn(),
})
beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset())
  mocks.list.mockResolvedValue({ items: [voice], total: 1 })
  mocks.get.mockResolvedValue(voice)
  mocks.sync.mockResolvedValue(voice)
  mocks.confirm.mockResolvedValue(true)
  mocks.upload.mockResolvedValue({ asset: { id: 55 } })
})

describe('公共音色库业务交互', () => {
  it('按模型读取并在选用时重新获取详情', async () => {
    const p = props()
    render(<ServerVoiceLibrary {...p} />)
    fireEvent.click(await screen.findByRole('button', { name: '选用' }))
    await waitFor(() => expect(p.onSelect).toHaveBeenCalledWith(voice))
    expect(mocks.list).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 21, modelVersionId: 91, limit: 20, offset: 0 }),
    )
    expect(mocks.get).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 21 }), 5)
  })
  it('只读成员不能创建，未就绪音色不可选用', async () => {
    mocks.list.mockResolvedValue({ items: [{ ...voice, status: 'training' }], total: 1 })
    render(<ServerVoiceLibrary {...props()} canManage={false} />)
    expect(screen.getByRole('button', { name: '创建音色' })).toBeDisabled()
    expect(await screen.findByRole('button', { name: '选用' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: '编辑' })).not.toBeInTheDocument()
  })
  it('收藏、详情和同步分别调用真实客户端', async () => {
    render(<ServerVoiceLibrary {...props()} />)
    fireEvent.click(await screen.findByRole('button', { name: '收藏 角色旁白' }))
    await waitFor(() =>
      expect(mocks.favorite).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 21 }), 5, true),
    )
    await waitFor(() => expect(screen.getByRole('button', { name: '详情' })).toBeEnabled())
    fireEvent.click(await screen.findByRole('button', { name: '详情' }))
    expect(await screen.findByLabelText('音色详情')).toHaveTextContent('角色旁白')
    await waitFor(() => expect(screen.getByRole('button', { name: '同步' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '同步' }))
    await waitFor(() => expect(mocks.sync).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 21 }), 5))
  })
  it('创建失败后复用已上传录音及幂等键，不污染配音参考列表', async () => {
    mocks.create.mockRejectedValueOnce(new Error('响应暂不可用')).mockResolvedValueOnce(voice)
    render(<ServerVoiceLibrary {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: '创建音色' }))
    fireEvent.change(screen.getByLabelText('音色名称'), { target: { value: '角色旁白' } })
    fireEvent.change(screen.getByLabelText('上传训练录音'), {
      target: { files: [new File(['sound'], 'record.wav', { type: 'audio/wav' })] },
    })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: '提交复刻' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('响应暂不可用')
    fireEvent.click(screen.getByRole('button', { name: '提交复刻' }))
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2))
    expect(mocks.upload).toHaveBeenCalledTimes(1)
    expect(mocks.create.mock.calls[0][1]).toMatchObject({
      sample_asset_id: 55,
      consent_confirmed: true,
      name: '角色旁白',
    })
    expect(mocks.create.mock.calls[0][1].idempotency_key).toBe(mocks.create.mock.calls[1][1].idempotency_key)
  })
  it('编辑元信息及确认删除，删除不操作素材资产', async () => {
    render(<ServerVoiceLibrary {...props()} />)
    fireEvent.click(await screen.findByRole('button', { name: '编辑' }))
    fireEvent.change(screen.getByLabelText('音色名称'), { target: { value: '新旁白' } })
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))
    await waitFor(() =>
      expect(mocks.edit).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: 21 }),
        5,
        expect.objectContaining({ name: '新旁白' }),
      ),
    )
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2))
    fireEvent.click(await screen.findByRole('button', { name: '删除' }))
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled())
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 21 }), 5))
    expect(mocks.confirm).toHaveBeenCalledWith(expect.stringContaining('不会回收'), expect.anything())
  })
  it('失败训练可沿用样本重试，错误不会显示为可用', async () => {
    mocks.list.mockResolvedValue({
      items: [{ ...voice, status: 'failed', last_error: '录音不清晰', remaining_training_times: 2 }],
      total: 1,
    })
    mocks.retry.mockResolvedValue({ ...voice, status: 'training' })
    render(<ServerVoiceLibrary {...props()} />)
    fireEvent.click(await screen.findByRole('button', { name: '重试训练' }))
    fireEvent.click(screen.getByRole('button', { name: '确认重试' }))
    await waitFor(() =>
      expect(mocks.retry).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 21 }), 5, undefined),
    )
  })
  it('列表异常显示可重试错误，不伪装为空列表或无权限', async () => {
    mocks.list.mockRejectedValue(new Error('权限不足'))
    render(<ServerVoiceLibrary {...props()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('权限不足')
    expect(screen.queryByText('暂无符合条件的音色。')).not.toBeInTheDocument()
  })
})
