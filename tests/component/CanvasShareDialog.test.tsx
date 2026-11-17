import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import CanvasShareDialog from '@/components/canvas/CanvasShareDialog'
import {
  getCanvasShare,
  createCanvasShare,
  updateCanvasShareCopy,
  listCanvasShareActivity,
  type CanvasShareState,
} from '@/api/canvasShare'

vi.mock('@/api/canvasShare', () => ({
  getCanvasShare: vi.fn().mockResolvedValue({ token: '', url: '', expiresAt: '' }),
  buildCanvasShareUrl: (state: CanvasShareState) =>
    state.url || (state.token ? `https://example.invalid/canvas/share/${state.token}` : ''),
  createCanvasShare: vi.fn(),
  deleteCanvasShare: vi.fn(),
  updateCanvasShareCopy: vi.fn(),
  listCanvasShareActivity: vi.fn().mockResolvedValue({ items: [], has_more: false }),
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

it('persists copy permission without rotating an existing link and displays activity', async () => {
  vi.mocked(getCanvasShare).mockResolvedValue({
    token: '',
    url: '',
    expiresAt: '',
    status: '',
    enabled: true,
    allowCopy: false,
  })
  vi.mocked(updateCanvasShareCopy).mockResolvedValue({
    token: '',
    url: '',
    expiresAt: '',
    status: '',
    enabled: true,
    allowCopy: true,
  })
  vi.mocked(listCanvasShareActivity).mockResolvedValue({
    items: [
      {
        id: 1,
        user_id: 42,
        user_name: '小明',
        action: 'copy',
        target_workspace_name: '设计空间',
        created_at: '2026-11-12T09:00:00Z',
      },
    ],
    has_more: false,
  })
  render(<CanvasShareDialog workspaceId={1} canvasId={2} onClose={vi.fn()} />)
  expect(await screen.findByText(/小明.*设计空间/)).toBeInTheDocument()
  const toggle = await screen.findByRole('switch')
  await waitFor(() => expect(toggle).toBeEnabled())
  fireEvent.click(toggle)
  await waitFor(() => expect(toggle).toBeChecked())
  expect(updateCanvasShareCopy).toHaveBeenCalledWith(1, 2, true)
  expect(createCanvasShare).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: '关闭分享' })).toBeInTheDocument()
})
