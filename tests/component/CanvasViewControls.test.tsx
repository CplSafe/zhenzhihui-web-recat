import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import CanvasViewControls from '@/components/canvas/CanvasViewControls'

function renderControls(overrides: Partial<React.ComponentProps<typeof CanvasViewControls>> = {}) {
  const props = {
    zoom: 1,
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onZoomReset: vi.fn(),
    onFitView: vi.fn(),
    snapEnabled: false,
    onSnapToggle: vi.fn(),
    edgesHidden: false,
    onEdgesToggle: vi.fn(),
    minimapVisible: true,
    onMinimapToggle: vi.fn(),
    ...overrides,
  }
  render(<CanvasViewControls {...props} />)
  return props
}

describe('CanvasViewControls', () => {
  it('快捷键优先按钮展示状态并转交用户点击', async () => {
    const user = userEvent.setup()
    const toggle = vi.fn()
    renderControls({ keyboardPriority: true, onKeyboardPriorityToggle: toggle })
    const button = screen.getByRole('button', { name: '全屏快捷键模式' })
    expect(button).toHaveAttribute('aria-pressed', 'true')
    await user.click(button)
    expect(toggle).toHaveBeenCalledOnce()
  })
  it('等待全屏和权限时禁用按钮，防止重复请求', () => {
    renderControls({ keyboardPriorityPending: true, onKeyboardPriorityToggle: vi.fn() })
    expect(screen.getByRole('button', { name: '全屏快捷键模式' })).toBeDisabled()
  })
  it('选择预设倍率时调用缩放回调', async () => {
    const user = userEvent.setup()
    const onZoomTo = vi.fn()
    renderControls({ onZoomTo })
    await user.selectOptions(screen.getByRole('combobox', { name: '画布缩放' }), '60')
    expect(onZoomTo).toHaveBeenCalledWith(0.6)
  })
  it('把当前倍率读成百分比，点读数回到 100%', async () => {
    const user = userEvent.setup()
    const props = renderControls({ zoom: 0.8 })

    const value = screen.getByRole('button', { name: /当前缩放 80%/ })
    expect(value).toHaveTextContent('80%')
    await user.click(value)
    expect(props.onZoomReset).toHaveBeenCalledTimes(1)
  })

  it('极小倍率下不显示成 0%——那看起来像坏了', () => {
    // 画布 minZoom 是 0.02，四舍五入到 2%；再小也要保底 1%
    renderControls({ zoom: 0.002 })
    expect(screen.getByRole('button', { name: /当前缩放 1%/ })).toHaveTextContent('1%')
  })

  it('缩放与复位各自接到对应回调', async () => {
    const user = userEvent.setup()
    const props = renderControls()

    await user.click(screen.getByRole('button', { name: '放大' }))
    await user.click(screen.getByRole('button', { name: '缩小' }))
    await user.click(screen.getByRole('button', { name: '复位视图' }))
    expect(props.onZoomIn).toHaveBeenCalledTimes(1)
    expect(props.onZoomOut).toHaveBeenCalledTimes(1)
    expect(props.onFitView).toHaveBeenCalledTimes(1)
  })

  it('两个开关把当前状态报给辅助技术，不只靠颜色区分', () => {
    renderControls({ snapEnabled: true, edgesHidden: false })
    expect(screen.getByRole('button', { name: '网格吸附' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '隐藏连线' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('开关的提示文案说的是「点下去会怎样」，而不是当前状态', () => {
    renderControls({ edgesHidden: true })
    expect(screen.getByRole('button', { name: '隐藏连线' })).toHaveAttribute('title', '显示连线')
  })

  it('小地图开关把点击转交出去，并报出当前显隐状态', async () => {
    const user = userEvent.setup()
    const props = renderControls({ minimapVisible: true })

    const toggle = screen.getByRole('button', { name: '小地图' })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(toggle).toHaveAttribute('title', '隐藏小地图')

    await user.click(toggle)
    expect(props.onMinimapToggle).toHaveBeenCalledOnce()
  })

  it('小地图已隐藏时，开关提示变成「显示」', () => {
    renderControls({ minimapVisible: false })
    const toggle = screen.getByRole('button', { name: '小地图' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(toggle).toHaveAttribute('title', '显示小地图')
  })
})
