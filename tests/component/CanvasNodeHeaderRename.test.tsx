/**
 * 画布节点头部改名的交互契约。
 *
 * 节点组件由 React Flow 内部渲染、未单独导出，这里按 CanvasView 中头部的同款组合
 * （InlineEdit + resolveCanvasNodeTitle + 提交时的「改回默认名即清空」判断）搭出等价结构，
 * 锁住三件容易回归的事：默认标题怎么算、改名提交什么、改回默认名是否落库。
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import InlineEdit from '@/components/common/InlineEdit'
import { CANVAS_TITLE_MAX_LENGTH, getCanvasKindLabel, resolveCanvasNodeTitle } from '@/utils/canvasNodeTitle'

function NodeHeader({
  kind,
  data,
  onRenameNode,
}: {
  kind: string
  data: Record<string, unknown>
  onRenameNode: (id: string, next: string) => void
}) {
  // 与 CanvasView 一致：默认名单独算，提交时用它判断「是否改回默认」
  const { title: customTitle, ...content } = data
  const derivedTitle = resolveCanvasNodeTitle({ kind, ...content })
  const headerTitle = String(customTitle || '').trim() || derivedTitle
  return (
    <div className="canvas-node-header nodrag nopan" title={headerTitle}>
      <span className="canvas-node-header__label-wrap" onDoubleClick={(event) => event.stopPropagation()}>
        <InlineEdit
          className="canvas-node-header__label"
          value={headerTitle}
          maxLength={CANVAS_TITLE_MAX_LENGTH}
          placeholder={getCanvasKindLabel(kind)}
          onCommit={(next) => {
            onRenameNode('n1', next.trim() === derivedTitle.trim() ? '' : next)
          }}
        />
      </span>
    </div>
  )
}

describe('画布节点头部改名', () => {
  it('未改名时显示「类型 · 内容摘要」，而不是光秃秃的类型名', () => {
    render(<NodeHeader kind="image" data={{ prompt: '夜晚的教学楼走廊' }} onRenameNode={vi.fn()} />)
    expect(screen.getByText('图片 · 夜晚的教学楼走廊')).toBeInTheDocument()
  })

  it('双击进入编辑并回车提交新名字', async () => {
    const user = userEvent.setup()
    const onRenameNode = vi.fn()
    render(<NodeHeader kind="image" data={{ prompt: '走廊' }} onRenameNode={onRenameNode} />)

    await user.dblClick(screen.getByText('图片 · 走廊'))
    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, '主角定妆照{Enter}')

    expect(onRenameNode).toHaveBeenCalledWith('n1', '主角定妆照')
  })

  it('把名字改回默认标题时提交空串，让上层删掉 title 而不是固化一份默认名', async () => {
    const user = userEvent.setup()
    const onRenameNode = vi.fn()
    render(<NodeHeader kind="image" data={{ title: '主角定妆照', prompt: '走廊' }} onRenameNode={onRenameNode} />)

    await user.dblClick(screen.getByText('主角定妆照'))
    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, '图片 · 走廊{Enter}')

    expect(onRenameNode).toHaveBeenCalledWith('n1', '')
  })

  it('已改名的节点改回默认名，比较的是推导名而不是当前显示名', async () => {
    // 回归：早先用 headerTitle 比较，已改名时它就是自定义名，永远不相等，
    // 于是「改回默认」被存成一个固化的自定义名，内容再变标题也不动了。
    const user = userEvent.setup()
    const onRenameNode = vi.fn()
    render(<NodeHeader kind="video" data={{ title: '第三镜' }} onRenameNode={onRenameNode} />)

    await user.dblClick(screen.getByText('第三镜'))
    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, '视频{Enter}')

    expect(onRenameNode).toHaveBeenCalledWith('n1', '')
  })

  it('Esc 取消不提交任何改动', async () => {
    const user = userEvent.setup()
    const onRenameNode = vi.fn()
    render(<NodeHeader kind="video" data={{}} onRenameNode={onRenameNode} />)

    await user.dblClick(screen.getByText('视频'))
    await user.type(screen.getByRole('textbox'), '改了一半{Escape}')

    expect(onRenameNode).not.toHaveBeenCalled()
  })

  it('头部带 nodrag/nopan：否则拖选标题会拖动节点、双击会穿到画布手势', () => {
    const { container } = render(<NodeHeader kind="image" data={{}} onRenameNode={vi.fn()} />)
    const header = container.querySelector('.canvas-node-header')
    expect(header).toHaveClass('nodrag')
    expect(header).toHaveClass('nopan')
  })

  it('完整标题挂在 title 属性上，省略号截断后仍可悬停看全', () => {
    const prompt = '一个少年在夜晚的教学楼走廊里缓缓回头看向镜头'
    const { container } = render(<NodeHeader kind="image" data={{ prompt }} onRenameNode={vi.fn()} />)
    expect(container.querySelector('.canvas-node-header')?.getAttribute('title')).toContain('…')
  })
})
