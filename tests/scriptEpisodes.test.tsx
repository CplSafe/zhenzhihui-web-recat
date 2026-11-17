import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ScriptEpisodes } from '@/components/director/ScriptEpisodes'

const models = [
  { id: 2, model: 'Image A', operation_codes: ['image.text_to_image'] },
  { id: 3, model: 'Video A', operation_codes: ['video.generate'] },
  { id: 4, model: 'Image B', operation_codes: ['image.text_to_image'] },
  { id: 5, model: 'Video B', operation_codes: ['video.generate'] },
]
const episodes = [1, 2, 3].map((n) => ({
  id: `42:${n}`,
  number: n,
  title: `第${n}集`,
  file_name: '剧本.docx',
  characters: 200,
}))
const result = { fingerprint: 'fixed-source', episodes, range_specified: false, notice: '请勾选本次制作集数' }
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})
function setup(
  value: typeof result & {
    method?: 'rules' | 'model'
    analysis_pending?: boolean
    needs_assistance?: boolean
    receipts?: Array<{ task_id: number; actual_cost: number; status: string }>
  } = result,
) {
  const request = vi.fn().mockResolvedValue(value),
    onConfirm = vi.fn()
  const props = {
    request,
    attachmentIds: ['script'],
    message: '',
    models,
    image: 2,
    video: 3,
    mode: 'auto' as const,
    disabled: false,
    open: true,
    onOpen: vi.fn(),
    onClose: vi.fn(),
    onConfirm,
  }
  const view = render(<ScriptEpisodes {...props} />)
  return { ...view, request, onConfirm, props }
}
describe('script episode intake', () => {
  it('never selects or submits the whole script on upload; per-episode overrides preserve defaults', async () => {
    const { onConfirm, request } = setup()
    await screen.findByRole('checkbox', { name: '选择 第1集' })
    expect(request).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '确认并开始制作' })).toBeDisabled()
    expect(onConfirm).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 第2集' }))
    fireEvent.click(screen.getByRole('button', { name: '第2集，修改模型' }).querySelector('svg')!)
    fireEvent.change(screen.getByRole('combobox', { name: '本集生图模型' }), { target: { value: '4' } })
    fireEvent.change(screen.getByRole('combobox', { name: '本集视频模型' }), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: '完成设置' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 第1集' }))
    fireEvent.click(screen.getByRole('button', { name: '确认并开始制作' }))
    expect(onConfirm).toHaveBeenCalledWith({
      episode_plan: { fingerprint: 'fixed-source', episodes: [{ id: '42:1' }, { id: '42:2', image: 4, video: 5 }] },
    })
  })
  it('uses only the requested range and inherits session models when unchanged', async () => {
    const { onConfirm } = setup({ ...result, episodes: [episodes[2]], range_specified: true })
    await screen.findByRole('checkbox', { name: '选择 第3集' })
    expect(screen.queryByRole('checkbox', { name: '选择 第1集' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认并开始制作' }))
    expect(onConfirm).toHaveBeenCalledWith({
      episode_plan: { fingerprint: 'fixed-source', episodes: [{ id: '42:3' }] },
    })
  })
  it('invalidates the old plan immediately when the message changes', async () => {
    const { rerender, props, request } = setup({ ...result, range_specified: true })
    await screen.findByRole('checkbox', { name: '选择 第1集' })
    request.mockImplementation(() => new Promise(() => {}))
    rerender(<ScriptEpisodes {...props} message="只做第3集" />)
    expect(screen.getByRole('button', { name: '确认并开始制作' })).toBeDisabled()
    expect(screen.queryByRole('checkbox', { name: '选择 第1集' })).not.toBeInTheDocument()
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
  })
  it('allows discussion when no reliable episode headers are found', async () => {
    const { onConfirm } = setup({ ...result, episodes: [], notice: '未识别到独立集标题，可以先讨论剧本。' })
    await screen.findByText(/未识别到独立集标题/)
    expect(screen.getByRole('button', { name: '确认并开始制作' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '仅讨论剧本' }))
    expect(onConfirm).toHaveBeenCalledWith({ discuss_script: true })
  })
  it('quietly polls existing analysis and requires checking model boundaries before creation', async () => {
    const { request, onConfirm } = setup({
      ...result,
      episodes: [],
      analysis_pending: true,
      notice: '正在核对分集结构',
    })
    await screen.findByText('正在辅助识别集数…')
    expect(onConfirm).not.toHaveBeenCalled()
    request.mockResolvedValue({
      ...result,
      method: 'model',
      range_specified: true,
      receipts: [{ task_id: 123, actual_cost: 1.25, status: 'succeeded' }],
      episodes: [{ ...episodes[0], start_excerpt: '原文开头', end_excerpt: '原文结尾' }],
    })
    await screen.findByText('开头：原文开头', {}, { timeout: 4000 })
    expect(screen.getByText(/分集识别已消耗 1.250/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认并开始制作' })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: '已核对分集标题及开头、结尾' }))
    fireEvent.click(screen.getByRole('button', { name: '确认并开始制作' }))
    expect(onConfirm).toHaveBeenCalledWith({
      episode_plan: { fingerprint: 'fixed-source', boundaries_confirmed: true, episodes: [{ id: '42:1' }] },
    })
    expect(request).toHaveBeenCalledTimes(2)
  })
  it('does not show zero episodes as a successful recognition and cannot start ambiguous results', async () => {
    const { onConfirm, request } = setup({
      ...result,
      episodes: [],
      needs_assistance: true,
      notice: '无法可靠确认分集边界',
    })
    await screen.findByText('分集边界待核对 · 点击查看')
    expect(screen.getByRole('button', { name: '确认并开始制作' })).toBeDisabled()
    expect(request).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
