import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import CanvasVideoPreviewModal from '@/components/canvas/CanvasVideoPreviewModal'

describe('CanvasVideoPreviewModal', () => {
  it('renders nothing without a source', () => {
    const { container } = render(<CanvasVideoPreviewModal src="" onClose={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('plays the video in a portal on body and shows the duration label', () => {
    render(<CanvasVideoPreviewModal src="https://cdn.example.com/a.mp4" durationLabel="00:05" onClose={vi.fn()} />)

    const dialog = screen.getByRole('dialog', { name: '视频预览' })
    expect(dialog.closest('body')).toBe(document.body)
    expect(screen.getByText('时长 00:05')).toBeTruthy()
    const video = dialog.querySelector('video')
    expect(video?.getAttribute('src')).toBe('https://cdn.example.com/a.mp4')
    expect(video?.hasAttribute('controls')).toBe(true)
  })

  it('omits the duration label when the duration is unknown', () => {
    render(<CanvasVideoPreviewModal src="/a.mp4" onClose={vi.fn()} />)
    expect(screen.queryByText(/时长/)).toBeNull()
  })

  it('closes on the close button, on the mask, and on Escape — but not on the player itself', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<CanvasVideoPreviewModal src="/a.mp4" onClose={onClose} />)

    await user.click(screen.getByRole('dialog', { name: '视频预览' }))
    expect(onClose).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '关闭视频预览' }))
    expect(onClose).toHaveBeenCalledTimes(1)

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('locks and restores body scrolling around the preview', () => {
    const { unmount } = render(<CanvasVideoPreviewModal src="/a.mp4" onClose={vi.fn()} />)
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('')
  })
})
