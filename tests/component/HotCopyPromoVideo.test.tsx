import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import HotCopyPromoVideo from '@/components/hotcopy/HotCopyShowcase/HotCopyPromoVideo'

describe('HotCopyPromoVideo', () => {
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens the banner video with seek controls and closes when the backdrop is clicked', async () => {
    const user = userEvent.setup()
    render(<HotCopyPromoVideo />)

    const banner = screen.getByRole('button', { name: '放大播放爆款复刻介绍视频' })
    const bannerVideo = banner.querySelector('video')
    expect(bannerVideo).toHaveAttribute('src', '/promo/hot-copy-promo.mp4')

    await user.click(banner)

    const dialog = screen.getByRole('dialog', { name: '视频预览' })
    const player = dialog.querySelector('video')
    expect(player).toHaveAttribute('src', '/promo/hot-copy-promo.mp4')
    expect(player).toHaveAttribute('controls')

    const backdrop = dialog.parentElement
    expect(backdrop).toHaveClass('home__video-modal-mask')
    fireEvent.click(backdrop!)
    expect(screen.queryByRole('dialog', { name: '视频预览' })).not.toBeInTheDocument()
  })

  it('supports opening the full preview with the keyboard', async () => {
    const user = userEvent.setup()
    render(<HotCopyPromoVideo />)

    const banner = screen.getByRole('button', { name: '放大播放爆款复刻介绍视频' })
    banner.focus()
    await user.keyboard('{Enter}')

    expect(screen.getByRole('dialog', { name: '视频预览' })).toBeInTheDocument()
  })
})
