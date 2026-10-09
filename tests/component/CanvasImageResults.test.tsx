import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import CanvasImageResults from '@/components/canvas/CanvasImageResults'

function Group({ onDownload = vi.fn(), onSplit = vi.fn(), disabled = false }) {
  const [primary, setPrimary] = useState(1)
  const [expanded, setExpanded] = useState(false)
  return (
    <CanvasImageResults
      assetIds={[1, 2, 3, 4]}
      primaryAssetId={primary}
      expanded={expanded}
      resolveUrl={(id) => `/image-${id}.png`}
      disabled={disabled}
      onToggle={() => setExpanded(!expanded)}
      onSelectPrimary={setPrimary}
      onDownload={onDownload}
      onSplit={onSplit}
    />
  )
}
describe('CanvasImageResults', () => {
  it('expands, selects a main image, downloads an individual image and collapses to that main image', async () => {
    const user = userEvent.setup()
    const download = vi.fn()
    const split = vi.fn()
    render(<Group onDownload={download} onSplit={split} />)
    expect(screen.getAllByRole('img')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: '展开 4 张图片' }))
    expect(screen.getAllByRole('img')).toHaveLength(4)
    await user.click(screen.getByRole('button', { name: '将第 3 张设为主图' }))
    expect(screen.getByRole('img', { name: '生成图片 3（主图）' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '下载第 2 张' }))
    expect(download).toHaveBeenCalledWith(2)
    await user.click(screen.getByRole('button', { name: '拆为独立节点' }))
    expect(split).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: '收起组图' }))
    expect(screen.getAllByRole('img')).toHaveLength(1)
    expect(screen.getByRole('img', { name: '生成图片 3（主图）' })).toBeInTheDocument()
  })
  it('disables group mutations while a generation is running', () => {
    render(<Group disabled />)
    expect(screen.getByRole('button', { name: '展开 4 张图片' })).toBeDisabled()
  })
})
