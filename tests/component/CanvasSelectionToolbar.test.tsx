import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import CanvasSelectionToolbar from '@/components/canvas/CanvasSelectionToolbar'

const anchor = { centerX: 400, bottom: 200 }

function renderBar(overrides: Partial<Parameters<typeof CanvasSelectionToolbar>[0]> = {}) {
  const props = {
    count: 3,
    timelineReadyCount: 3,
    anchor,
    isGroup: false,
    onGroup: vi.fn(),
    onUngroup: vi.fn(),
    onCreateTimeline: vi.fn(),
    onDelete: vi.fn(),
    onClear: vi.fn(),
    ...overrides,
  }
  render(<CanvasSelectionToolbar {...props} />)
  return props
}

describe('CanvasSelectionToolbar', () => {
  it('报出选中数量，并把动作接到对应回调上', async () => {
    const user = userEvent.setup()
    const props = renderBar()

    expect(screen.getByText('已选 3')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /创建剪辑时间线/ }))
    expect(props.onCreateTimeline).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: /删除/ }))
    expect(props.onDelete).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(props.onClear).toHaveBeenCalledTimes(1)
  })

  it('未成组时给「打组」，成组后同一位置换成「解组」', async () => {
    const user = userEvent.setup()
    const props = renderBar()

    // 两者互斥：并排放会让用户先判断该点哪个
    expect(screen.queryByRole('button', { name: /解组/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /打组/ }))
    expect(props.onGroup).toHaveBeenCalledTimes(1)
  })

  it('选中正好是一个完整分组时只给解组', async () => {
    const user = userEvent.setup()
    const props = renderBar({ isGroup: true })

    expect(screen.queryByRole('button', { name: /打组/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /解组/ }))
    expect(props.onUngroup).toHaveBeenCalledTimes(1)
  })

  it('选中里没有可用视频时不给出建时间线的入口', () => {
    // 给一个点了必然失败的按钮，比点完弹一句「没有可用视频」更糟：
    // 后者至少解释了原因，前者让用户以为是功能坏了
    renderBar({ timelineReadyCount: 0 })
    expect(screen.queryByRole('button', { name: /创建剪辑时间线/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /删除/ })).toBeInTheDocument()
  })

  it('可用视频少于选中数时说明会带走几个', () => {
    // 选了 5 个但只有 2 个是已生成的视频：不写清楚的话，用户会以为另外 3 个也进了时间线
    renderBar({ count: 5, timelineReadyCount: 2 })
    expect(screen.getByRole('button', { name: /创建剪辑时间线/ })).toHaveTextContent('2 个视频')
  })

  it('数量一致时不画蛇添足地重复一遍数字', () => {
    renderBar({ count: 4, timelineReadyCount: 4 })
    expect(screen.getByRole('button', { name: /创建剪辑时间线/ })).not.toHaveTextContent('4 个视频')
  })

  it('按锚点水平居中定位，且带上 nodrag/nopan 以免手势被画布接管', () => {
    renderBar()
    const bar = screen.getByRole('toolbar', { name: '已选中 3 个节点' })
    expect(bar).toHaveStyle({ left: '400px', bottom: '200px' })
    expect(bar.className).toContain('nodrag')
    expect(bar.className).toContain('nopan')
  })
})
