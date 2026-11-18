import { fireEvent, render as renderTesting, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfigProvider } from 'antd'
import CanvasVoiceLibrary from '@/components/canvas/CanvasVoiceLibrary'

// jsdom does not complete CSS animations; keep real visibility assertions without modal motion.
function render(ui: React.ReactElement) {
  return renderTesting(<ConfigProvider theme={{ token: { motion: false } }}>{ui}</ConfigProvider>)
}

const mocks = vi.hoisted(() => ({ list: vi.fn(), filters: vi.fn(), get: vi.fn() }))
vi.mock('@/api/voices', async (original) => ({
  ...(await original<typeof import('@/api/voices')>()),
  listVoices: mocks.list,
  getVoiceFilters: mocks.filters,
  getVoice: mocks.get,
}))
const voice = { id: 5, name: '角色旁白', source: 'public', status: 'ready', workspace_id: 21 }
const defaults = () => ({
  userId: 'user',
  workspaceId: 21,
  modelName: '配音模型',
  modelVersionId: 91,
  fields: [],
  values: {},
  disabled: false,
  onApply: vi.fn(),
  onClose: vi.fn(),
  onUpload: vi.fn(),
  onReference: vi.fn(),
  onSelectVoice: vi.fn(),
})
beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset())
  mocks.list.mockResolvedValue({ items: [voice], total: 1 })
  mocks.filters.mockResolvedValue({ sources: ['public', 'cloned'], languages: ['en'] })
  mocks.get.mockResolvedValue(voice)
})

describe('画布统一音色库', () => {
  it('提供系统、我的和收藏分类，关闭浏览不提交选择', async () => {
    const props = defaults()
    render(<CanvasVoiceLibrary {...props} />)
    await screen.findByRole('button', { name: '选用' }, { timeout: 5000 })
    for (const name of ['系统音色', '我的音色', '收藏'])
      await waitFor(() => expect(screen.getByRole('button', { name })).toBeVisible())
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(props.onClose).toHaveBeenCalledOnce()
    expect(props.onSelectVoice).not.toHaveBeenCalled()
    expect(props.onApply).not.toHaveBeenCalled()
    expect(mocks.get).not.toHaveBeenCalled()
  })
  it('确认前重新核验音色，应用服务器编号并关闭，不启动配音', async () => {
    const props = defaults()
    render(<CanvasVoiceLibrary {...props} />)
    fireEvent.click(await screen.findByRole('button', { name: '选用' }, { timeout: 5000 }))
    await waitFor(() => expect(props.onSelectVoice).toHaveBeenCalledWith(voice))
    expect(mocks.get).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 21 }), 5)
    expect(props.onClose).toHaveBeenCalledOnce()
    expect(props.onApply).not.toHaveBeenCalled()
    expect(props.onUpload).not.toHaveBeenCalled()
  })
  it.each(['running', 'unsupported'] as const)('%s 时允许浏览但不能选用', async (reason) => {
    const props = defaults()
    render(
      <CanvasVoiceLibrary
        {...props}
        disabled={reason === 'running'}
        onSelectVoice={reason === 'unsupported' ? undefined : props.onSelectVoice}
      />,
    )
    expect(await screen.findByRole('button', { name: '选用' }, { timeout: 5000 })).toBeDisabled()
    expect(mocks.get).not.toHaveBeenCalled()
    expect(props.onSelectVoice).not.toHaveBeenCalled()
  })
  it('没有模型时不能应用音色，也不传入虚构模型编号', async () => {
    render(<CanvasVoiceLibrary {...defaults()} modelVersionId={undefined} />)
    expect(await screen.findByRole('button', { name: '选用' }, { timeout: 5000 })).toBeDisabled()
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 21, modelVersionId: undefined }))
  })
  it('音色在选择前变为训练中时保留弹窗，不应用旧结果', async () => {
    const props = defaults()
    mocks.get.mockResolvedValue({ ...voice, status: 'training' })
    render(<CanvasVoiceLibrary {...props} />)
    fireEvent.click(await screen.findByRole('button', { name: '选用' }, { timeout: 5000 }))
    await screen.findByText('该音色尚不可用，请稍后重试或选择其他音色')
    expect(props.onSelectVoice).not.toHaveBeenCalled()
    expect(props.onClose).not.toHaveBeenCalled()
  })
})
