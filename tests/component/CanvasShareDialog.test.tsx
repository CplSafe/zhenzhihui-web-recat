import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import CanvasShareDialog from '@/components/canvas/CanvasShareDialog'
import { getCanvasShare, createCanvasShare, type CanvasShareState } from '@/api/canvasShare'

vi.mock('@/api/canvasShare', () => ({
  getCanvasShare: vi.fn().mockResolvedValue({ token: '', url: '', expiresAt: '' }),
  buildCanvasShareUrl: (state: CanvasShareState) =>
    state.url || (state.token ? `https://example.invalid/canvas/share/${state.token}` : ''),
  createCanvasShare: vi.fn(),
  deleteCanvasShare: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getCanvasShare).mockResolvedValue({ token: '', url: '', expiresAt: '', status: '' })
})

it('reopens an existing share returned as a URL without a separate token', async () => {
  vi.mocked(getCanvasShare).mockResolvedValue({
    token: '',
    url: 'https://example.invalid/shared',
    expiresAt: '',
    status: 'active',
  })
  const view = render(<CanvasShareDialog workspaceId={1} canvasId={1} onClose={vi.fn()} />)
  expect(await screen.findByRole('textbox', { name: '分享链接' })).toHaveValue('https://example.invalid/shared')
  view.unmount()
  render(<CanvasShareDialog workspaceId={1} canvasId={1} onClose={vi.fn()} />)
  expect(await screen.findByRole('textbox', { name: '分享链接' })).toHaveValue('https://example.invalid/shared')
  expect(screen.getByRole('button', { name: '重新生成链接' })).toBeEnabled()
  expect(createCanvasShare).not.toHaveBeenCalled()
})

it('does not mistake failed status reads for an unshared canvas and supports retry', async () => {
  vi.mocked(getCanvasShare).mockRejectedValueOnce(new Error('分享状态读取失败'))
  render(<CanvasShareDialog workspaceId={1} canvasId={1} onClose={vi.fn()} />)
  const retry = await screen.findByRole('button', { name: '重新读取分享状态' })
  expect(screen.queryByText('这块画布还没有分享链接。')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '生成链接' })).not.toBeInTheDocument()
  fireEvent.click(retry)
  await waitFor(() => expect(screen.getByRole('button', { name: '生成链接' })).toBeEnabled())
  expect(createCanvasShare).not.toHaveBeenCalled()
})

it('分享弹窗限制焦点，Esc关闭并恢复触发器焦点', async () => {
  const onClose = vi.fn()
  const trigger = document.createElement('button')
  document.body.append(trigger)
  trigger.focus()
  const view = render(<CanvasShareDialog workspaceId={1} canvasId={1} onClose={onClose} />)
  const close = screen.getByRole('button', { name: '关闭分享弹窗' })
  expect(close).toHaveFocus()
  const generate = await screen.findByRole('button', { name: '生成链接' })
  await waitFor(() => expect(generate).toBeEnabled())
  fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
  expect(generate).toHaveFocus()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(onClose).toHaveBeenCalledOnce()
  view.unmount()
  expect(trigger).toHaveFocus()
  trigger.remove()
})
