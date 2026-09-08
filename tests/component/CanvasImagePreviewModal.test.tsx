import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import CanvasImagePreviewModal from '@/components/canvas/CanvasImagePreviewModal'

const ITEMS = [
  { id: 'n1', url: '/img-1.png', title: '图片 · 商品主图' },
  { id: 'n2', url: '/img-2.png', title: '图片 · 场景图' },
  { id: 'n3', url: '/img-3.png', title: '' },
]

function renderModal(overrides: Partial<React.ComponentProps<typeof CanvasImagePreviewModal>> = {}) {
  const props = {
    items: ITEMS,
    activeId: 'n2',
    onSelect: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  }
  render(<CanvasImagePreviewModal {...props} />)
  return props
}

describe('CanvasImagePreviewModal', () => {
  it('展示当前图片、标题与「第几张 / 共几张」序号', () => {
    renderModal()
    const image = screen.getByRole('img', { name: '图片 · 场景图' })
    expect(image).toHaveAttribute('src', '/img-2.png')
    expect(screen.getByText('2 / 3')).toBeInTheDocument()
  })

  it('左右箭头切换到相邻图片，两端按钮禁用', async () => {
    const user = userEvent.setup()
    const props = renderModal({ activeId: 'n1' })

    expect(screen.getByRole('button', { name: '上一张图片' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '下一张图片' }))
    expect(props.onSelect).toHaveBeenCalledWith('n2')
  })

  it('方向键翻图，Esc 关闭', async () => {
    const user = userEvent.setup()
    const props = renderModal()

    await user.keyboard('{ArrowRight}')
    expect(props.onSelect).toHaveBeenCalledWith('n3')
    await user.keyboard('{ArrowLeft}')
    expect(props.onSelect).toHaveBeenCalledWith('n1')
    await user.keyboard('{Escape}')
    expect(props.onClose).toHaveBeenCalledOnce()
  })

  it('底部缩略图列出全部图片，点击直达任意一张', async () => {
    const user = userEvent.setup()
    const props = renderModal({ activeId: 'n1' })

    const thumbs = screen.getAllByRole('option')
    expect(thumbs).toHaveLength(3)
    expect(thumbs[0]).toHaveAttribute('aria-selected', 'true')

    await user.click(thumbs[2])
    expect(props.onSelect).toHaveBeenCalledWith('n3')
  })

  it('只有一张图片时不显示箭头与缩略图条', () => {
    renderModal({ items: [ITEMS[0]], activeId: 'n1' })
    expect(screen.queryByRole('button', { name: /一张图片/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
    expect(screen.queryByText('1 / 1')).not.toBeInTheDocument()
  })

  it('当前图片被删掉（activeId 失效）时回退到第一张而不是白屏', () => {
    renderModal({ activeId: 'gone' })
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '图片 · 商品主图' })).toBeInTheDocument()
  })

  it('点遮罩关闭，点画面本身不关闭', async () => {
    const user = userEvent.setup()
    const props = renderModal()

    await user.click(screen.getByRole('img', { name: '图片 · 场景图' }))
    expect(props.onClose).not.toHaveBeenCalled()

    await user.click(screen.getByRole('presentation'))
    expect(props.onClose).toHaveBeenCalledOnce()
  })
})
