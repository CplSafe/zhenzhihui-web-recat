import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ listCanvasTools: vi.fn(), listAiModels: vi.fn(), estimateAiTaskCost: vi.fn() }))
vi.mock('@/api/canvasTools', () => ({ listCanvasTools: mocks.listCanvasTools }))
vi.mock('@/api/business', () => ({
  listAiModels: mocks.listAiModels,
  estimateAiTaskCost: mocks.estimateAiTaskCost,
  getSubscription: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/components/canvas/CanvasToolScene', () => ({ default: () => <div>3D preview</div> }))
import CanvasImageTools from '@/components/canvas/CanvasImageTools'

const angle = {
  code: 'image.multi_angle',
  version: 2,
  display_name: '多角度',
  execution: 'prompt_workflow',
  operation_code: 'image.image_to_image',
  model_version_ids: [42],
  params_schema: {
    fields: [{ name: 'horizontal_angle', display_name: '水平角', type: 'number', min: 0, max: 360, default: 0 }],
  },
}
const relight = {
  ...angle,
  code: 'image.relight',
  version: 1,
  display_name: '打光',
  params_schema: {
    fields: [
      {
        name: 'mode',
        display_name: '模式',
        type: 'select',
        options: ['manual', 'smart', 'reference'],
        default: 'manual',
      },
      {
        name: 'brightness',
        display_name: '亮度',
        type: 'integer',
        min: 0,
        max: 100,
        default: 50,
        visible_when: { mode: ['manual'] },
      },
    ],
  },
}
function mount(code = 'image.multi_angle') {
  const props = {
    workspaceId: 21,
    source: { nodeId: 'n1', assetId: 501, title: '原图' },
    images: [{ nodeId: 'n2', assetId: 502, title: '参考图' }],
    initialTool: code,
    onGenerate: vi.fn().mockResolvedValue(undefined),
    onClose: vi.fn(),
    onCapture: vi.fn(),
    onViewChange: vi.fn(),
  }
  render(<CanvasImageTools {...props} />)
  return props
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.listCanvasTools.mockResolvedValue([angle, relight, { ...angle, code: 'panorama.view', execution: 'browser' }])
  mocks.listAiModels.mockResolvedValue([
    {
      id: 42,
      display_name: '后端模型',
      operation_codes: ['image.image_to_image'],
      params_schema: { fields: [{ name: 'count', display_name: '张数', type: 'integer', min: 1, max: 6, default: 1 }] },
    },
  ])
  mocks.estimateAiTaskCost.mockResolvedValue({ estimated_cost: 10, balance: 100, can_afford: true })
})
describe('CanvasImageTools', () => {
  it('按工具独立操作码查模型，估价和提交保持同一操作码', async () => {
    const operation = 'image.relight_tool'
    mocks.listCanvasTools.mockResolvedValue([{ ...relight, operation_code: operation }])
    mocks.listAiModels.mockResolvedValue([
      { id: 42, display_name: '打光模型', operation_codes: [operation] },
      { id: 99, display_name: '普通图片模型', operation_codes: ['image.image_to_image'] },
    ])
    const props = mount('image.relight')
    const button = await screen.findByRole('button', { name: '生成新图片' })
    await waitFor(() => expect(button).toBeEnabled())
    expect(mocks.listAiModels).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 21,
        operationCode: operation,
        plan: '',
      }),
    )
    expect(mocks.listAiModels.mock.calls[0][0]).not.toHaveProperty('capability')
    expect(mocks.estimateAiTaskCost).toHaveBeenLastCalledWith(expect.objectContaining({ operationCode: operation }))
    await userEvent.click(button)
    expect(props.onGenerate.mock.calls[0][0].request.operationCode).toBe(operation)
  })

  it.each(['image.multi_angle', 'image.relight', 'image.panorama'])(
    '单模型自动选用，打光保留模型展示：%s',
    async (code) => {
      mocks.listCanvasTools.mockResolvedValue([{ ...angle, code }])
      const props = mount(code)
      const button = await screen.findByRole('button', { name: '生成新图片' })
      await waitFor(() => expect(button).toBeEnabled())
      if (code === 'image.relight') {
        expect(screen.getByRole('combobox', { name: '生成模型' })).toBeInTheDocument()
      } else {
        expect(screen.queryByRole('combobox', { name: '生成模型' })).not.toBeInTheDocument()
        expect(screen.queryByText('模型', { exact: true })).not.toBeInTheDocument()
      }
      await userEvent.click(button)
      expect(props.onGenerate.mock.calls[0][0].request.modelVersionId).toBe(42)
    },
  )

  it('工具操作码不匹配时不回退普通图生图模型', async () => {
    mocks.listCanvasTools.mockResolvedValue([{ ...angle, operation_code: 'image.multi_angle_tool' }])
    mount()
    expect(await screen.findByText('当前空间暂无可用模型')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '生成新图片' })).toBeDisabled()
    expect(mocks.estimateAiTaskCost).not.toHaveBeenCalled()
  })
  it('模型查询失败保留重试入口', async () => {
    mocks.listAiModels.mockRejectedValueOnce(new Error('模型服务暂不可用'))
    mount()
    expect(await screen.findByText('模型服务暂不可用')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '生成新图片' })).toBeEnabled())
  })
  it('多个可用模型时展示选择，并按所选模型更新报价和提交', async () => {
    mocks.listCanvasTools.mockResolvedValue([{ ...angle, model_version_ids: [42, 43] }])
    mocks.listAiModels.mockResolvedValue([
      { id: 42, display_name: '模型一', operation_codes: ['image.image_to_image'] },
      { id: 43, display_name: '模型二', operation_codes: ['image.image_to_image'] },
    ])
    const props = mount()
    const selector = await screen.findByRole('combobox', { name: '生成模型' })
    await userEvent.click(selector)
    await userEvent.click(await screen.findByText('模型二', { selector: '.ant-select-item-option-content' }))
    const button = screen.getByRole('button', { name: '生成新图片' })
    await waitFor(() => expect(button).toBeEnabled())
    await userEvent.click(button)
    expect(props.onGenerate.mock.calls[0][0].request.modelVersionId).toBe(43)
  })
  it('uses the same versioned parameters and assets for estimation and one paid submission', async () => {
    const props = mount()
    const button = await screen.findByRole('button', { name: '生成新图片' })
    await waitFor(() => expect(button).toBeEnabled())
    fireEvent.change(screen.getByRole('spinbutton', { name: '水平角' }), { target: { value: '90' } })
    expect(button).toBeDisabled()
    await waitFor(() => expect(button).toBeEnabled())
    await userEvent.click(button)
    expect(props.onGenerate).toHaveBeenCalledTimes(1)
    const submitted = props.onGenerate.mock.calls[0][0].request
    expect(submitted.params).toEqual({
      count: 1,
      tool: 'image.multi_angle',
      tool_version: 2,
      tool_params: { horizontal_angle: 90 },
    })
    expect(mocks.estimateAiTaskCost).toHaveBeenLastCalledWith(
      expect.objectContaining({
        params: submitted.params,
        inputAssets: submitted.inputAssets,
        prompt: submitted.prompt,
      }),
    )
    expect(props.onClose).toHaveBeenCalled()
  })
  it('removes manual controls and requires a distinct second image in reference mode', async () => {
    const props = mount('image.relight')
    await screen.findByRole('group', { name: '模式' })
    await userEvent.click(screen.getByRole('button', { name: '参考图布光' }))
    expect(screen.queryByRole('spinbutton', { name: '亮度' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '生成新图片' })).toBeDisabled()
    await userEvent.click(screen.getByRole('combobox', { name: '打光参考图' }))
    await userEvent.click(await screen.findByText('参考图', { selector: '.ant-select-item-option-content' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '生成新图片' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: '生成新图片' }))
    expect(props.onGenerate.mock.calls[0][0].request).toMatchObject({
      params: { tool: 'image.relight', tool_params: { mode: 'reference' } },
      inputAssets: [
        { asset_id: 501, role: 'reference_image' },
        { asset_id: 502, role: 'reference_image' },
      ],
    })
  })
  it('后端目录无可用模型时不展示工具生成操作', async () => {
    mocks.listCanvasTools.mockResolvedValue([{ ...angle, model_version_ids: [] }])
    mount()
    expect(
      await screen.findByText('当前空间尚未开放此工具，请选择其他工具；如需开通，请联系平台管理员。'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '生成新图片' })).not.toBeInTheDocument()
    expect(mocks.listAiModels).not.toHaveBeenCalled()
    expect(mocks.estimateAiTaskCost).not.toHaveBeenCalled()
  })
  it('does not estimate or submit a browser tool and saves the view state', async () => {
    const props = mount('panorama.view')
    await screen.findByRole('spinbutton', { name: '水平视角' })
    fireEvent.change(screen.getByRole('spinbutton', { name: '水平视角' }), { target: { value: '90' } })
    expect(props.onViewChange).toHaveBeenCalledWith(expect.objectContaining({ yaw: 90 }))
    expect(mocks.estimateAiTaskCost).not.toHaveBeenCalled()
    expect(mocks.listAiModels).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: '生成新图片' })).not.toBeInTheDocument()
  })
  it('blocks malformed and unaffordable quotes', async () => {
    mocks.estimateAiTaskCost.mockResolvedValue({ estimated_cost: 10, balance: 1, can_afford: false })
    mount()
    await screen.findByText('积分不足，请充值后重新估价')
    expect(screen.getByRole('button', { name: '生成新图片' })).toBeDisabled()
    mocks.estimateAiTaskCost.mockResolvedValue({ estimated_cost: -1 })
    await userEvent.click(screen.getByRole('button', { name: '重新估价' }))
    expect(await screen.findByText('估价返回不完整，请重试')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '生成新图片' })).toBeDisabled()
  })
})
