import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import CanvasNodeSearch, { type CanvasSearchableNode } from '@/components/canvas/CanvasNodeSearch'

const nodes: CanvasSearchableNode[] = [
  { id: 'n1', kind: 'text', text: '开场白：夏日海边的清凉感', kindLabel: '文本' },
  { id: 'n2', kind: 'image', text: '产品特写，冷色调', kindLabel: '图片' },
  { id: 'n3', kind: 'video', text: '海边奔跑的长镜头', kindLabel: '视频' },
]

function renderSearch(overrides: Partial<React.ComponentProps<typeof CanvasNodeSearch>> = {}) {
  const props = { nodes, onPick: vi.fn(), onClose: vi.fn(), ...overrides }
  render(<CanvasNodeSearch {...props} />)
  return props
}

describe('CanvasNodeSearch', () => {
  it('未输入时不铺开结果区，避免一打开就糊一屏', () => {
    renderSearch()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('按内容匹配并给出类型标签', async () => {
    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('textbox'), '海边')
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(2)
    expect(options[0]).toHaveTextContent('开场白：夏日海边的清凉感')
    expect(options[0]).toHaveTextContent('文本')
  })

  it('匹配不到时明说没有结果，而不是留一片空白', async () => {
    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('textbox'), '不存在的词')
    expect(screen.getByText('没有匹配的节点')).toBeInTheDocument()
    expect(screen.queryAllByRole('option')).toHaveLength(0)
  })

  it('回车选中当前高亮项，上下键可在结果间移动', async () => {
    const user = userEvent.setup()
    const props = renderSearch()

    await user.type(screen.getByRole('textbox'), '海边')
    // 默认高亮首条
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{ArrowDown}')
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{Enter}')
    expect(props.onPick).toHaveBeenCalledWith('n3')
  })

  it('换关键词后高亮回到首条，不会停在已经不存在的下标上', async () => {
    const user = userEvent.setup()
    const props = renderSearch()
    const input = screen.getByRole('textbox')

    await user.type(input, '海边')
    await user.keyboard('{ArrowDown}')
    // 换成只有一条结果的词：若高亮仍停在下标 1，回车会选空
    await user.clear(input)
    await user.type(input, '冷色调')
    await user.keyboard('{Enter}')
    expect(props.onPick).toHaveBeenCalledWith('n2')
  })

  it('Esc 关闭面板', async () => {
    const user = userEvent.setup()
    const props = renderSearch()

    await user.type(screen.getByRole('textbox'), '海')
    await user.keyboard('{Escape}')
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('大小写不敏感：搜英文时不该因为大小写落空', async () => {
    const user = userEvent.setup()
    renderSearch({ nodes: [{ id: 'n9', kind: 'text', text: 'Summer Beach', kindLabel: '文本' }] })

    await user.type(screen.getByRole('textbox'), 'beach')
    expect(screen.getAllByRole('option')).toHaveLength(1)
  })
})
