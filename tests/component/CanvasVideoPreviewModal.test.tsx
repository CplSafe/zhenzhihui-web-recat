import { fireEvent, render, screen } from '@testing-library/react'
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
    // 只断言「时长和它的值都呈现出来了」，不绑定具体标签结构：
    // 弹窗信息区的排版会调整，测试不该因为换了标签就红。
    expect(screen.getByText('时长')).toBeTruthy()
    expect(screen.getByText('00:05')).toBeTruthy()
    const video = dialog.querySelector('video')
    expect(video?.getAttribute('src')).toBe('https://cdn.example.com/a.mp4')
    expect(video?.hasAttribute('controls')).toBe(true)
    expect(video?.getAttribute('preload')).toBe('auto')
  })

  it('omits the duration label when the duration is unknown', () => {
    render(<CanvasVideoPreviewModal src="/a.mp4" onClose={vi.fn()} />)
    expect(screen.queryByText(/时长/)).toBeNull()
  })

  it('视频元数据返回前就按节点比例预留大播放器尺寸', () => {
    render(<CanvasVideoPreviewModal src="/portrait.mp4" info={{ ratio: '9:16' }} onClose={vi.fn()} />)
    const media = screen.getByTestId('video-preview-media')
    expect(media.style.getPropertyValue('--preview-aspect-ratio')).toBe(String(9 / 16))
    expect(screen.getByRole('dialog', { name: '视频预览' })).toHaveAttribute('data-has-info', 'true')
  })

  it('视频元数据返回后按文件真实比例重排并修正信息栏', () => {
    render(<CanvasVideoPreviewModal src="/landscape.mp4" info={{ ratio: '9:16' }} onClose={vi.fn()} />)
    const media = screen.getByTestId('video-preview-media')
    const video = screen.getByRole('dialog', { name: '视频预览' }).querySelector('video') as HTMLVideoElement
    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 1920 })
    Object.defineProperty(video, 'videoHeight', { configurable: true, value: 1080 })

    fireEvent.loadedMetadata(video)

    expect(media.style.getPropertyValue('--preview-aspect-ratio')).toBe(String(16 / 9))
    expect(media).toHaveAttribute('data-aspect-ratio', '16:9')
    expect(screen.getByText('16:9')).toBeTruthy()
    expect(screen.queryByText('9:16')).toBeNull()
  })

  it('打开时优先复用画布播放器已知的真实尺寸', () => {
    render(
      <CanvasVideoPreviewModal
        src="/landscape.mp4"
        info={{ ratio: '9:16', mediaWidth: 1920, mediaHeight: 1080 }}
        onClose={vi.fn()}
      />,
    )

    const media = screen.getByTestId('video-preview-media')
    expect(media.style.getPropertyValue('--preview-aspect-ratio')).toBe(String(16 / 9))
    expect(media).toHaveAttribute('data-aspect-ratio', '16:9')
    expect(screen.queryByText('9:16')).toBeNull()
  })

  it('将接近标准横屏的编码尺寸显示为 16:9', () => {
    render(
      <CanvasVideoPreviewModal
        src="/landscape.mp4"
        info={{ ratio: '9:16', mediaWidth: 1248, mediaHeight: 720 }}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByTestId('video-preview-media')).toHaveAttribute('data-aspect-ratio', '16:9')
    expect(screen.getByText('16:9')).toBeTruthy()
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

  it('关闭前立即暂停并静音视频，避免弹窗消失后音轨继续播放', async () => {
    const user = userEvent.setup()
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
    const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined)
    render(<CanvasVideoPreviewModal src="/a.mp4" onClose={vi.fn()} />)

    const video = screen.getByRole('dialog', { name: '视频预览' }).querySelector('video') as HTMLVideoElement
    await user.click(screen.getByRole('button', { name: '关闭视频预览' }))

    expect(pause).toHaveBeenCalled()
    expect(video.muted).toBe(true)
    expect(video.hasAttribute('src')).toBe(false)
    expect(load).toHaveBeenCalled()
    pause.mockRestore()
    load.mockRestore()
  })

  it('locks and restores body scrolling around the preview', () => {
    const { unmount } = render(<CanvasVideoPreviewModal src="/a.mp4" onClose={vi.fn()} />)
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('')
  })
})
