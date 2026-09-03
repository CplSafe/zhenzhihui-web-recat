import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import CanvasNodeToolbar from '@/components/canvas/CanvasNodeToolbar'

function renderToolbar(overrides: Partial<React.ComponentProps<typeof CanvasNodeToolbar>> = {}) {
  const props = {
    anchor: { centerX: 400, bottom: 300 },
    kind: 'video',
    hasContent: true,
    uploading: false,
    capturing: false,
    onRename: vi.fn(),
    onUpload: vi.fn(),
    onDownload: vi.fn(),
    onCapture: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  }
  render(<CanvasNodeToolbar {...props} />)
  return props
}

describe('CanvasNodeToolbar', () => {
  it('改名与删除对所有节点类型都可用', () => {
    renderToolbar({ kind: 'text', hasContent: false })
    expect(screen.getByRole('button', { name: '重命名节点' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '删除节点' })).toBeInTheDocument()
  })

  it('文本节点不显示上传/下载/截帧', () => {
    renderToolbar({ kind: 'text', hasContent: false })
    expect(screen.queryByRole('button', { name: /素材/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '截取画面为图片' })).not.toBeInTheDocument()
  })

  it('只有视频且已有素材时才给截帧入口', () => {
    renderToolbar({ kind: 'image', hasContent: true })
    expect(screen.queryByRole('button', { name: '截取画面为图片' })).not.toBeInTheDocument()
  })

  it('空视频节点给「上传」，有素材后不再给「替换」', () => {
    renderToolbar({ kind: 'video', hasContent: false })
    expect(screen.getByRole('button', { name: '上传素材' })).toBeInTheDocument()
  })

  it('视频有素材后不再提供替换：换视频等于换节点', () => {
    renderToolbar({ kind: 'video', hasContent: true })
    expect(screen.queryByRole('button', { name: '替换素材' })).not.toBeInTheDocument()
  })

  it('图片有素材时给「替换」而不是「上传」', () => {
    renderToolbar({ kind: 'image', hasContent: true })
    expect(screen.getByRole('button', { name: '替换素材' })).toBeInTheDocument()
  })

  it('素材上传中不给替换与下载：此刻拿不到 assetId', () => {
    renderToolbar({ kind: 'image', hasContent: true, uploading: true })
    expect(screen.queryByRole('button', { name: '替换素材' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '下载素材' })).not.toBeInTheDocument()
  })

  it('展开截帧菜单并选中一项后回调对应位置', async () => {
    const user = userEvent.setup()
    const props = renderToolbar()

    await user.click(screen.getByRole('button', { name: '截取画面为图片' }))
    await user.click(screen.getByRole('menuitem', { name: '截取尾帧' }))

    expect(props.onCapture).toHaveBeenCalledWith('last')
    // 选完即收起，菜单不该继续盖在画面上
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('截帧进行中禁用入口，避免重复触发', () => {
    renderToolbar({ capturing: true })
    expect(screen.getByRole('button', { name: '截取画面为图片' })).toBeDisabled()
  })

  it('Esc 收起截帧菜单', async () => {
    const user = userEvent.setup()
    renderToolbar()
    await user.click(screen.getByRole('button', { name: '截取画面为图片' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('带 nodrag/nopan：否则点工具条会连带拖动画布或取消选中', () => {
    renderToolbar()
    const bar = screen.getByRole('toolbar')
    expect(bar).toHaveClass('nodrag')
    expect(bar).toHaveClass('nopan')
  })

  it('各动作把点击转交给对应回调', async () => {
    const user = userEvent.setup()
    const props = renderToolbar({ kind: 'image', hasContent: true })

    await user.click(screen.getByRole('button', { name: '重命名节点' }))
    await user.click(screen.getByRole('button', { name: '下载素材' }))
    await user.click(screen.getByRole('button', { name: '删除节点' }))

    expect(props.onRename).toHaveBeenCalledOnce()
    expect(props.onDownload).toHaveBeenCalledOnce()
    expect(props.onDelete).toHaveBeenCalledOnce()
  })
})
