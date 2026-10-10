import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CanvasAudioGenerator from '@/components/canvas/CanvasAudioGenerator'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  estimate: vi.fn(),
  submit: vi.fn(),
  confirm: vi.fn(),
  update: vi.fn(),
  wait: vi.fn(),
}))
vi.mock('@xyflow/react', () => ({
  useReactFlow: () => ({ updateNodeData: mocks.update, getEdges: () => [], getNode: () => null }),
}))
vi.mock('@/api/business', () => ({
  listAiModels: mocks.list,
  estimateAiTaskCost: mocks.estimate,
  createAiTask: mocks.submit,
  getAiTaskId: (task: any) => task.id,
  waitForAiTask: mocks.wait,
}))
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
  useConfirmDialog: () => ({ requestConfirm: mocks.confirm }),
}))

const model = {
  id: 91,
  display_name: '配音模型',
  operation_codes: ['audio.tts'],
  params_schema: { properties: { speed: { type: 'number', default: 1 }, enabled: { type: 'boolean', default: true } } },
}
describe('音频生成任务提交', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset())
    mocks.list.mockResolvedValue([model])
    mocks.estimate.mockResolvedValue({ estimated_cost: 100, can_afford: true })
    mocks.confirm.mockResolvedValue(true)
    mocks.submit.mockResolvedValue({ id: 71 })
  })
  const choose = async () => {
    await screen.findByRole('option', { name: /配音模型/ })
    fireEvent.change(screen.getByLabelText('音频生成模型'), { target: { value: '91:audio.tts' } })
    fireEvent.change(screen.getByLabelText('配音文案或音乐描述'), { target: { value: '你好，欢迎使用帧智汇' } })
  }
  it('按实际目录下发模型、操作码和 schema 默认值，并持久化任务 ID', async () => {
    render(<CanvasAudioGenerator nodeId="a" data={{}} workspaceId={21} />)
    await choose()
    fireEvent.click(screen.getByRole('button', { name: '生成音频' }))
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1))
    expect(mocks.submit.mock.calls[0][0]).toMatchObject({
      workspaceId: 21,
      modelVersionId: 91,
      operationCode: 'audio.tts',
      prompt: '你好，欢迎使用帧智汇',
      params: { speed: 1, enabled: true },
    })
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith('a', expect.objectContaining({ taskId: 71, taskStatus: 'processing' })),
    )
  })
  it('取消费用确认不提交任务', async () => {
    mocks.confirm.mockResolvedValueOnce(false)
    render(<CanvasAudioGenerator nodeId="a" data={{}} workspaceId={21} />)
    await choose()
    fireEvent.click(screen.getByRole('button', { name: '生成音频' }))
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1))
    expect(mocks.submit).not.toHaveBeenCalled()
  })
  it('没有目录能力时不展示可提交的模拟模型', async () => {
    mocks.list.mockResolvedValue([])
    render(<CanvasAudioGenerator nodeId="a" data={{}} workspaceId={21} />)
    expect(await screen.findByRole('option', { name: '暂无可用音频生成模型' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '生成音频' })).not.toBeInTheDocument()
  })
  it('音色克隆必须先声明授权', async () => {
    mocks.list.mockResolvedValue([{ ...model, operation_codes: ['audio.clone'] }])
    render(<CanvasAudioGenerator nodeId="a" data={{ assetId: 81 }} workspaceId={21} />)
    await screen.findByRole('option', { name: /音色克隆/ })
    fireEvent.change(screen.getByLabelText('音频生成模型'), { target: { value: '91:audio.clone' } })
    fireEvent.change(screen.getByLabelText('配音文案或音乐描述'), { target: { value: '欢迎' } })
    expect(screen.getByRole('button', { name: '生成音频' })).toBeDisabled()
    fireEvent.click(screen.getByLabelText('我确认该声音属于本人或已取得音色克隆授权'))
    fireEvent.click(screen.getByRole('button', { name: '生成音频' }))
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1))
    expect(mocks.submit.mock.calls[0][0].inputAssets).toEqual([{ asset_id: 81, role: 'audio' }])
  })
})
