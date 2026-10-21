import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import CanvasShareDialog from '@/components/canvas/CanvasShareDialog'

vi.mock('@/api/canvasShare', () => ({
  getCanvasShare: vi.fn().mockResolvedValue({ token: '', url: '', expiresAt: '' }),
  buildCanvasShareUrl: () => '',
  createCanvasShare: vi.fn(),
  deleteCanvasShare: vi.fn(),
}))

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
