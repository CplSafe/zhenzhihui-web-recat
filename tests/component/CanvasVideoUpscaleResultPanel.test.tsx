import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import CanvasVideoUpscaleResultPanel from '@/components/canvas/CanvasVideoUpscaleResultPanel'

vi.mock('@/composables/useToast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
const data = {
  operationCode: 'video.upscale',
  taskStatus: 'submit_failed',
  upscaleModelName: '视频高清修复',
  upscaleParamLabels: { scale: '放大倍率' },
  generationRequest: {
    kind: 'video',
    operationCode: 'video.upscale',
    modelVersionId: 8,
    params: { scale: 2 },
    inputAssets: [{ asset_id: 99, role: 'video' }],
  },
}

it('模型并发拒绝明确说明未创建任务，并保留手动重试', () => {
  render(
    <CanvasVideoUpscaleResultPanel
      data={{ ...data, taskFailure: { httpStatus: 409, code: '10401' } }}
      onRetry={vi.fn()}
    />,
  )
  expect(screen.getByRole('status')).toHaveTextContent('未创建超分任务')
  expect(screen.getByRole('status')).toHaveTextContent('RequestID')
  expect(screen.getByRole('button', { name: '重试超分' })).toBeEnabled()
})

it('显示实际超分模型和参数，只提供超分重试且防止重复点击', async () => {
  const retry = vi.fn().mockReturnValue(new Promise(() => {}))
  render(<CanvasVideoUpscaleResultPanel data={data} onRetry={retry} />)
  expect(screen.getByText('模型：视频高清修复')).toBeInTheDocument()
  expect(screen.getByText('放大倍率')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '生成' })).not.toBeInTheDocument()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: '重试超分' }))
  await user.click(screen.getByRole('button', { name: '正在提交超分…' }))
  expect(retry).toHaveBeenCalledOnce()
})

it('缺少原超分请求时禁用重试，不回退到普通视频生成', () => {
  render(<CanvasVideoUpscaleResultPanel data={{ ...data, generationRequest: undefined }} onRetry={vi.fn()} />)
  expect(screen.getByRole('button', { name: '重试超分' })).toBeDisabled()
  expect(screen.getByRole('alert')).toHaveTextContent('缺少原始超分请求')
})

it('处理中不提供重试入口，缺少模型名称时显示实际ID', () => {
  render(
    <CanvasVideoUpscaleResultPanel
      data={{ ...data, taskStatus: 'processing', upscaleModelName: '' }}
      onRetry={vi.fn()}
    />,
  )
  expect(screen.getByText('模型：超分模型 #8')).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('超分任务处理中')
  expect(screen.queryByRole('button', { name: '重试超分' })).not.toBeInTheDocument()
})

it('刷新后从持久化超分请求恢复模型参数，完成后不再提供重试', () => {
  render(
    <CanvasVideoUpscaleResultPanel
      data={{
        ...data,
        generationRequest: undefined,
        videoUpscaleRequest: data.generationRequest,
        taskStatus: 'succeeded',
        assetId: 77,
      }}
      onRetry={vi.fn()}
    />,
  )
  expect(screen.getByRole('status')).toHaveTextContent('超分已完成')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '重试超分' })).not.toBeInTheDocument()
})

it('重试异常后恢复按钮，支持展示布尔及结构化超分参数', async () => {
  const retry = vi.fn().mockRejectedValue(new Error('素材校验失败'))
  render(
    <CanvasVideoUpscaleResultPanel
      data={{
        ...data,
        generationRequest: {
          ...data.generationRequest,
          params: { enabled: true, disabled: false, config: { mode: 'keep' } },
        },
      }}
      onRetry={retry}
    />,
  )
  expect(screen.getByText('开启')).toBeInTheDocument()
  expect(screen.getByText('关闭')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '重试超分' }))
  expect(screen.getByRole('button', { name: '重试超分' })).toBeEnabled()
})
