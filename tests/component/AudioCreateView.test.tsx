import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  listAiModels: vi.fn(),
  listAiTasks: vi.fn(),
  estimateAiTaskCost: vi.fn(),
  createAiTask: vi.fn(),
  waitForAiTask: vi.fn(),
}))
vi.mock('@/components/home/AppSidebar', () => ({ default: () => <nav /> }))
vi.mock('@/components/layout/AppTopbar', () => ({ default: () => <header /> }))
vi.mock('@/composables/useSidebarNavigate', () => ({ useSidebarNavigate: () => vi.fn() }))
vi.mock('@/stores/workspaceSession', () => ({ useWorkspaceId: () => 21 }))
vi.mock('@/api/business', () => ({
  ...mocks,
  getBusinessErrorMessage: (e: unknown) => (e instanceof Error ? e.message : ''),
}))
import AudioCreateView from '@/views/AudioCreateView'
const model = (tts = false) => ({
  id: tts ? 12 : 11,
  enabled: true,
  capability: 'audio',
  version: tts ? 'seed-tts-2.0' : 'seed-audio-1.0',
  display_name: tts ? 'Seed TTS 2.0' : 'Seed Audio 1.0',
  operation_codes: [tts ? 'audio.text_to_speech' : 'audio.generate'],
  params_schema: {
    fields: [
      { name: 'speaker', display_name: '音色 ID', type: 'string', default: tts ? 'zh_female_vv_uranus_bigtts' : '' },
    ],
  },
})
beforeEach(() => {
  vi.resetAllMocks()
  mocks.listAiModels.mockImplementation(async ({ operationCode }) => [model(operationCode === 'audio.text_to_speech')])
  mocks.listAiTasks.mockResolvedValue({ items: [] })
  // balance is already available balance: do not subtract frozen again.
  mocks.estimateAiTaskCost.mockResolvedValue({ estimated_cost: 10, balance: 10, frozen: 90, can_afford: true })
  mocks.createAiTask.mockResolvedValue({ id: 91, status: 'succeeded' })
  mocks.waitForAiTask.mockResolvedValue({
    id: 91,
    status: 'succeeded',
    prompt: '测试',
    outputs: [{ type: 'audio', asset_id: 42 }],
  })
})
it('submits each mode to its explicit model, preserves fields after history refresh, and plays saved assets', async () => {
  render(<AudioCreateView />)
  await screen.findByRole('option', { name: 'Seed Audio 1.0' })
  fireEvent.change(screen.getByLabelText('创作描述'), { target: { value: '测试' } })
  fireEvent.change(screen.getByLabelText('音色 ID'), { target: { value: 'public_voice' } })
  await waitFor(() => expect(screen.getByRole('button', { name: '生成音频' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '生成音频' }))
  await waitFor(() =>
    expect(mocks.createAiTask).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 21,
        modelVersionId: 11,
        operationCode: 'audio.generate',
        params: { speaker: 'public_voice' },
      }),
    ),
  )
  await waitFor(() => expect(screen.getByRole('button', { name: '生成音频' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '刷新记录' }))
  expect(screen.getByLabelText('音色 ID')).toHaveValue('public_voice')
  expect(mocks.listAiModels).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('tab', { name: '语音合成' }))
  await screen.findByRole('option', { name: 'Seed TTS 2.0' })
  expect(screen.getByLabelText('音色 ID')).toHaveValue('zh_female_vv_uranus_bigtts')
  await waitFor(() => expect(screen.getByRole('button', { name: '合成语音' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '合成语音' }))
  await waitFor(() =>
    expect(mocks.createAiTask).toHaveBeenLastCalledWith(
      expect.objectContaining({ modelVersionId: 12, operationCode: 'audio.text_to_speech' }),
    ),
  )
  mocks.listAiTasks.mockResolvedValue({
    items: [{ id: 91, status: 'succeeded', outputs: [{ type: 'audio', asset_id: 42 }] }],
  })
  await waitFor(() => expect(screen.getByRole('button', { name: '合成语音' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '刷新记录' }))
  expect(await screen.findByLabelText('任务 91 音频 1')).toHaveAttribute(
    'src',
    '/api/v1/assets/42/download?workspace_id=21',
  )
})
it('blocks generation when the server says balance is insufficient', async () => {
  mocks.estimateAiTaskCost.mockResolvedValue({ estimated_cost: 100, balance: 20, frozen: 0, can_afford: false })
  render(<AudioCreateView />)
  await screen.findByRole('option', { name: 'Seed Audio 1.0' })
  fireEvent.change(screen.getByLabelText('创作描述'), { target: { value: '雨声' } })
  expect(await screen.findByRole('button', { name: '积分不足' })).toBeDisabled()
  expect(mocks.createAiTask).not.toHaveBeenCalled()
})
it('keeps the idempotency key for uncertain network failures', async () => {
  mocks.createAiTask.mockRejectedValue(new Error('网络中断'))
  render(<AudioCreateView />)
  await screen.findByRole('option', { name: 'Seed Audio 1.0' })
  fireEvent.change(screen.getByLabelText('创作描述'), { target: { value: '雨声' } })
  await waitFor(() => expect(screen.getByRole('button', { name: '生成音频' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '生成音频' }))
  await screen.findByText('网络中断')
  fireEvent.click(screen.getByRole('button', { name: '生成音频' }))
  await waitFor(() => expect(mocks.createAiTask).toHaveBeenCalledTimes(2))
  expect(mocks.createAiTask.mock.calls[0][0].idempotencyKey).toEqual(mocks.createAiTask.mock.calls[1][0].idempotencyKey)
})
it('shows a configuration message when no models are enabled', async () => {
  mocks.listAiModels.mockResolvedValue([])
  render(<AudioCreateView />)
  expect(await screen.findByText(/暂无可用的音频生成模型/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '生成音频' })).not.toBeInTheDocument()
})
