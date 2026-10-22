import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import CanvasUpscale from '@/components/canvas/CanvasUpscale'
import { hasOpenCanvasModal } from '@/utils/canvasModal'

const mocks = vi.hoisted(() => ({
  models: vi.fn(),
  estimate: vi.fn(),
  create: vi.fn(),
  detail: vi.fn(),
  poll: vi.fn(),
}))
vi.mock('@/api/business', async (original) => ({
  ...(await original<typeof import('@/api/business')>()),
  listAiModels: mocks.models,
  estimateAiTaskCost: mocks.estimate,
  createAiTask: mocks.create,
  getAiTask: mocks.detail,
  waitForAiTask: mocks.poll,
}))

beforeEach(() => {
  vi.clearAllMocks()
  const NativeImage = globalThis.Image
  vi.spyOn(globalThis, 'Image').mockImplementation(function () {
    const image = new NativeImage()
    Object.defineProperties(image, { naturalWidth: { value: 1024 }, naturalHeight: { value: 768 } })
    queueMicrotask(() => image.dispatchEvent(new Event('load')))
    return image
  } as unknown as typeof Image)
  mocks.estimate.mockResolvedValue({ estimated_cost: 24, balance: 100, can_afford: true })
  mocks.create.mockResolvedValue({ id: 55, status: 'queued' })
  mocks.detail.mockReturnValue(new Promise(() => {}))
})
afterEach(() => vi.restoreAllMocks())

it('中文策略保留英文提交值，倍率变化更新预计输出尺寸', async () => {
  mocks.models.mockResolvedValue([
    {
      id: 8,
      name: '图片超分',
      operation_codes: ['image.upscale'],
      params_schema: {
        fields: [
          { name: 'multiple', type: 'number', default: 1, min: 1, max: 4 },
          {
            name: 'generative_enhance_mode',
            type: 'string',
            default: 'generative_first',
            options: ['generative_first', 'fidelity_first'],
          },
        ],
      },
    },
  ])
  render(
    <CanvasUpscale
      workspaceId={21}
      canvasId={7}
      nodes={[{ id: 'source', position: { x: 0, y: 0 }, data: { kind: 'image', assetId: 99 } }]}
      request={{ ids: ['source'], key: 1 }}
      onCloseRequest={vi.fn()}
      onTasks={vi.fn()}
      onModalChange={vi.fn()}
    />,
  )
  const multiple = await screen.findByRole('spinbutton', { name: '放大倍率（倍）' })
  expect(await screen.findByText('原始尺寸：1024 × 768 像素')).toBeInTheDocument()
  expect(screen.getByText('预计输出：1024 × 768 像素')).toBeInTheDocument()
  expect(screen.getByText('细节增强优先')).toBeInTheDocument()
  const user = userEvent.setup()
  await user.clear(multiple)
  await user.type(multiple, '2')
  expect(screen.getByText('预计输出：2048 × 1536 像素')).toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole('button', { name: '确认超分' })).toBeEnabled())
  expect(mocks.estimate.mock.lastCall![0].params).toEqual({ multiple: 2, generative_enhance_mode: 'generative_first' })
})

it.each(['image', 'video'])('%s 超分估价与确认使用相同参数和源素材，图片不传描述', async (kind) => {
  const operation = `${kind}.upscale`
  const model = {
    id: 8,
    name: '超分模型',
    operation_codes: [operation],
    params_schema: { fields: [{ name: 'scale', type: 'integer', default: 2 }] },
  }
  mocks.models.mockResolvedValue([model])
  const close = vi.fn()
  const tasks = vi.fn()
  render(
    <CanvasUpscale
      workspaceId={21}
      canvasId={7}
      nodes={[{ id: 'source', position: { x: 0, y: 0 }, data: { kind, assetId: 99 } }]}
      request={{ ids: ['source'], key: 1 }}
      onCloseRequest={close}
      onTasks={tasks}
      onModalChange={vi.fn()}
    />,
  )
  const user = userEvent.setup()
  await waitFor(() => expect(screen.getByRole('button', { name: '确认超分' })).toBeEnabled())
  const confirm = await screen.findByRole('button', { name: /确认超分/ })
  expect(document.querySelector('.ant-modal-mask')).toBeInTheDocument()
  expect(hasOpenCanvasModal()).toBe(true)
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(mocks.create).not.toHaveBeenCalled()
  const body = mocks.estimate.mock.calls[0][0]
  expect(body).toMatchObject({
    workspaceId: 21,
    modelVersionId: 8,
    operationCode: operation,
    inputAssets: [{ asset_id: 99, role: kind }],
    params: { scale: 2 },
  })
  if (kind === 'image') expect(body).not.toHaveProperty('prompt')
  else expect(body.prompt).toContain('参考视频')
  await user.click(confirm)
  await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce())
  expect(mocks.create).toHaveBeenCalledWith({
    ...body,
    modelVersion: model,
    capability: kind,
    idempotencyKey: expect.any(String),
  })
  await waitFor(() => expect(close).toHaveBeenCalledOnce())
  expect(tasks).toHaveBeenCalled()
})

it('创建失败保留弹窗与源素材，显示错误', async () => {
  mocks.models.mockResolvedValue([{ id: 8, name: '超分模型', operation_codes: ['image.upscale'] }])
  mocks.create.mockRejectedValue(new Error('模型服务暂不可用'))
  const close = vi.fn()
  const tasks = vi.fn()
  render(
    <CanvasUpscale
      workspaceId={21}
      canvasId={7}
      nodes={[{ id: 'source', position: { x: 0, y: 0 }, data: { kind: 'image', assetId: 99 } }]}
      request={{ ids: ['source'], key: 1 }}
      onCloseRequest={close}
      onTasks={tasks}
      onModalChange={vi.fn()}
    />,
  )
  await waitFor(() => expect(screen.getByRole('button', { name: '确认超分' })).toBeEnabled())
  await userEvent.click(await screen.findByRole('button', { name: /确认超分/ }))
  expect(await screen.findByText('模型服务暂不可用')).toBeInTheDocument()
  expect(close).not.toHaveBeenCalled()
  expect(tasks).not.toHaveBeenCalled()
})

it('视频确认后交给画布节点流程，预估和重复点击不会额外提交旧超分任务', async () => {
  mocks.models.mockResolvedValue([{ id: 8, name: '视频超分', operation_codes: ['video.upscale'] }])
  const generate = vi.fn().mockReturnValue(new Promise(() => {}))
  const tasks = vi.fn()
  render(
    <CanvasUpscale
      workspaceId={21}
      canvasId={7}
      nodes={[{ id: 'source', position: { x: 0, y: 0 }, data: { kind: 'video', assetId: 99 } }]}
      request={{ ids: ['source'], key: 1 }}
      onCloseRequest={vi.fn()}
      onTasks={tasks}
      onModalChange={vi.fn()}
      onVideoGenerate={generate}
    />,
  )
  const user = userEvent.setup()
  await waitFor(() => expect(screen.getByRole('button', { name: '确认超分' })).toBeEnabled())
  const confirm = await screen.findByRole('button', { name: /确认超分/ })
  expect(generate).not.toHaveBeenCalled()
  await user.click(confirm)
  await user.click(confirm)
  expect(generate).toHaveBeenCalledOnce()
  const quote = mocks.estimate.mock.calls[0][0]
  expect(generate).toHaveBeenCalledWith({
    source: expect.objectContaining({ node_id: 'source', asset_id: 99, kind: 'video' }),
    modelName: '视频超分',
    paramLabels: {},
    request: {
      kind: 'video',
      prompt: quote.prompt,
      modelVersionId: 8,
      operationCode: 'video.upscale',
      params: quote.params,
      inputAssets: quote.inputAssets,
    },
  })
  expect(mocks.create).not.toHaveBeenCalled()
  expect(tasks).not.toHaveBeenCalled()
})

it('原视频失效时显示错误，不回退到旧的付费任务流程', async () => {
  mocks.models.mockResolvedValue([{ id: 8, name: '视频超分', operation_codes: ['video.upscale'] }])
  const generate = vi.fn().mockRejectedValue(new Error('原视频已更换或移除，请重新打开超分'))
  render(
    <CanvasUpscale
      workspaceId={21}
      canvasId={7}
      nodes={[{ id: 'source', position: { x: 0, y: 0 }, data: { kind: 'video', assetId: 99 } }]}
      request={{ ids: ['source'], key: 1 }}
      onCloseRequest={vi.fn()}
      onTasks={vi.fn()}
      onModalChange={vi.fn()}
      onVideoGenerate={generate}
    />,
  )
  const user = userEvent.setup()
  await waitFor(() => expect(screen.getByRole('button', { name: '确认超分' })).toBeEnabled())
  await user.click(await screen.findByRole('button', { name: /确认超分/ }))
  expect(await screen.findByText('原视频已更换或移除，请重新打开超分')).toBeInTheDocument()
  expect(mocks.create).not.toHaveBeenCalled()
})

it('视频分辨率和增强风格使用单选，参数改变自动重新计价', async () => {
  mocks.models.mockResolvedValue([
    {
      id: 47,
      name: '视频超分',
      operation_codes: ['video.upscale'],
      params_schema: {
        fields: [
          { name: 'resolution', display_name: '分辨率', type: 'string', default: '2k', options: ['2k', '4k'] },
          { name: 'enhance_mode', display_name: '增强风格', type: 'string', default: 'hd', options: ['hd', 'detail'] },
        ],
      },
    },
  ])
  render(
    <CanvasUpscale
      workspaceId={21}
      canvasId={7}
      nodes={[{ id: 'source', position: { x: 0, y: 0 }, data: { kind: 'video', assetId: 99 } }]}
      request={{ ids: ['source'], key: 1 }}
      onCloseRequest={vi.fn()}
      onTasks={vi.fn()}
      onModalChange={vi.fn()}
    />,
  )
  await waitFor(() => expect(screen.getByRole('button', { name: '确认超分' })).toBeEnabled())
  expect(screen.queryByRole('button', { name: '预估费用' })).not.toBeInTheDocument()
  expect(screen.getByRole('radio', { name: 'hd' })).toBeChecked()
  fireEvent.click(screen.getByRole('radio', { name: '4k' }))
  expect(screen.getByRole('button', { name: '确认超分' })).toBeDisabled()
  await waitFor(() =>
    expect(mocks.estimate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        params: { resolution: '4k', enhance_mode: 'hd' },
      }),
    ),
  )
  await waitFor(() => expect(screen.getByRole('button', { name: '确认超分' })).toBeEnabled())
})
