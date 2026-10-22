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
    onPreview: vi.fn(),
    onCapture: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  }
  render(<CanvasNodeToolbar {...props} />)
  return props
}

describe('CanvasNodeToolbar', () => {
  it('只展示后端配置可用的图片工具', async () => {
    const onImageTool = vi.fn()
    renderToolbar({ kind: 'image', onImageTool, imageToolCodes: ['image.relight'] })
    expect(screen.queryByRole('button', { name: '多角度' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '全景' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '打光' }))
    expect(onImageTool).toHaveBeenCalledWith('image.relight')
  })

  it('只有全景查看可用时直接打开查看，不展示全景生成', async () => {
    const onImageTool = vi.fn()
    renderToolbar({ kind: 'image', onImageTool, imageToolCodes: ['panorama.view'] })
    await userEvent.click(screen.getByRole('button', { name: '全景' }))
    expect(onImageTool).toHaveBeenCalledWith('panorama.view')
  })

  it('改名与删除对所有节点类型都可用', () => {
    renderToolbar({ kind: 'text', hasContent: false })
    expect(screen.getByRole('button', { name: '重命名节点' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '删除节点' })).toBeInTheDocument()
  })

  it('音频复用同一下载按钮，保留改名删除且不开放图片视频专用动作', async () => {
    const props = renderToolbar({ kind: 'audio', hasContent: true })
    await userEvent.click(screen.getByRole('button', { name: '下载素材' }))
    expect(props.onDownload).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: '重命名节点' })).toBeVisible()
    expect(screen.getByRole('button', { name: '删除节点' })).toBeVisible()
    expect(screen.queryByRole('button', { name: /上传素材|替换素材|放大预览|截取画面/ })).not.toBeInTheDocument()
  })
  it.each([{ hasContent: false }, { uploading: true }])('音频无素材或上传中不展示下载 %j', (props) => {
    renderToolbar({ kind: 'audio', ...props })
    expect(screen.queryByRole('button', { name: '下载素材' })).not.toBeInTheDocument()
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

  it('图片与视频有素材时都提供放大预览，文本节点不显示', async () => {
    const user = userEvent.setup()
    const videoProps = renderToolbar({ kind: 'video', hasContent: true })
    await user.click(screen.getByRole('button', { name: '放大预览视频' }))
    expect(videoProps.onPreview).toHaveBeenCalledOnce()

    const imageProps = renderToolbar({ kind: 'image', hasContent: true })
    await user.click(screen.getByRole('button', { name: '放大预览图片' }))
    expect(imageProps.onPreview).toHaveBeenCalledOnce()

    renderToolbar({ kind: 'text', hasContent: true })
    expect(screen.getAllByRole('button', { name: /放大预览/ })).toHaveLength(2)
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

  it('截帧菜单里有「自定义截帧」入口，选中后以 custom 回调（由画布打开放大预览拖进度条）', async () => {
    const user = userEvent.setup()
    const props = renderToolbar()

    await user.click(screen.getByRole('button', { name: '截取画面为图片' }))
    const custom = screen.getByRole('menuitem', { name: /自定义截帧/ })
    expect(custom).toHaveTextContent('拖动进度条选取任意一帧')
    await user.click(custom)

    expect(props.onCapture).toHaveBeenCalledWith('custom')
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
