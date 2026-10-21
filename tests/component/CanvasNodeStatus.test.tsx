import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import CanvasNodeFailure from '@/components/canvas/CanvasNodeFailure'
import CanvasFailureDetails from '@/components/canvas/CanvasFailureDetails'
import CanvasNodeStatus from '@/components/canvas/CanvasNodeStatus'

const showToast = vi.hoisted(() => vi.fn())
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ showToast }) }))

let width = 360
let height = 300
let resized: () => void
const disconnect = vi.fn()

it('历史并发错误带失败时间，不声称当前仍在生成', () => {
  render(
    <CanvasNodeFailure
      title="上次超分失败"
      reason="当前模型有任务正在生成中，请稍后再试"
      failedAt="2026-10-21T08:00:00Z"
    />,
  )
  expect(screen.getByText('上次超分失败')).toBeInTheDocument()
  expect(screen.getByText(/不代表当前仍有任务运行/)).toBeInTheDocument()
  expect(screen.getByText(/失败时间：/)).toBeInTheDocument()
})

beforeEach(() => {
  showToast.mockClear()
  width = 360
  height = 300
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => height)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resized = callback
      }
      observe() {}
      disconnect = disconnect
    },
  )
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('uses screen dimensions for full, compact and overview without setting node dimensions', () => {
  const { rerender, unmount } = render(<CanvasNodeFailure zoom={1} reason="请求失败" />)
  const overlay = screen.getByRole('alert')
  expect(overlay).toHaveAttribute('data-layout', 'full')
  rerender(<CanvasNodeFailure zoom={0.5} reason="请求失败" />)
  expect(overlay).toHaveAttribute('data-layout', 'compact')
  expect(overlay.style.getPropertyValue('--status-scale')).toBe('1')
  expect(overlay.style.getPropertyValue('--status-width')).toBe('336px')
  rerender(<CanvasNodeFailure zoom={0.02} reason="请求失败" />)
  expect(overlay).toHaveAttribute('data-layout', 'overview')
  expect(overlay.style.width).toBe('')
  expect(overlay.style.height).toBe('')
  expect(Number(overlay.style.getPropertyValue('--status-scale')) * 20).toBeLessThanOrEqual(height)
  unmount()
  expect(disconnect).toHaveBeenCalled()
})

it('adapts a wide, short audio node on resize even at unchanged zoom', () => {
  const { rerender } = render(
    <CanvasNodeStatus zoom={1} label="正在生成">
      <strong>正在生成</strong>
    </CanvasNodeStatus>,
  )
  height = 80
  act(() => resized())
  expect(screen.getByRole('status')).toHaveAttribute('data-layout', 'compact')
  expect(screen.getByRole('status')).toHaveAttribute('data-size', 'small')
  width = 100
  act(() => resized())
  expect(screen.getByRole('status')).toHaveAttribute('data-layout', 'overview')
  // A larger node at the same zoom can show the full presentation.
  width = 720
  height = 600
  act(() => resized())
  rerender(
    <CanvasNodeStatus zoom={0.5} label="正在生成">
      <strong>正在生成</strong>
    </CanvasNodeStatus>,
  )
  expect(screen.getByRole('status')).toHaveAttribute('data-layout', 'full')
})

it('keeps failure details operable in the overview presentation', async () => {
  render(
    <CanvasNodeFailure zoom={0.02} reason="模型拒绝">
      <CanvasFailureDetails data={{ taskError: '模型拒绝' }} />
    </CanvasNodeFailure>,
  )
  await userEvent.click(screen.getByRole('button', { name: '查看详情' }))
  expect(await screen.findByRole('dialog', { name: '生成失败详情' })).toBeInTheDocument()
  expect(within(screen.getByRole('dialog', { name: '生成失败详情' })).getByText('模型拒绝')).toBeInTheDocument()
})

it('shows the failure reason and copies only the actual RequestID with a success toast', async () => {
  const user = userEvent.setup()
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
  const requestId = '095fdfbd-071f-4f5b-b7dc-263379d01a69'
  render(<CanvasNodeFailure reason="提示词未通过内容安全审核，请调整后重试" requestId={requestId} />)
  expect(screen.getByText('提示词未通过内容安全审核，请调整后重试')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: `复制 RequestID：${requestId}` }))
  expect(copy).toHaveBeenCalledWith(requestId)
  expect(showToast).toHaveBeenCalledWith('复制成功', 'success')
})

it('does not invent a RequestID and reports clipboard failures without a success toast', async () => {
  const user = userEvent.setup()
  const { rerender } = render(<CanvasNodeFailure reason="服务暂不可用" />)
  expect(screen.queryByRole('button', { name: /复制 RequestID/ })).not.toBeInTheDocument()
  vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'))
  rerender(<CanvasNodeFailure reason="服务暂不可用" requestId="actual-request" />)
  await user.click(screen.getByRole('button', { name: /复制 RequestID/ }))
  expect(showToast).toHaveBeenCalledWith('复制失败，请稍后重试', 'error')
  expect(showToast).not.toHaveBeenCalledWith('复制成功', 'success')
})
