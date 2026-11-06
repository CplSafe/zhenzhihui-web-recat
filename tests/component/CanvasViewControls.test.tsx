import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import CanvasViewControls from '@/components/canvas/CanvasViewControls'

function mount(overrides: Partial<React.ComponentProps<typeof CanvasViewControls>> = {}) {
  const props = {
    zoom: 0.89,
    onArrange: vi.fn(),
    onZoomReset: vi.fn(),
    snapEnabled: false,
    onSnapToggle: vi.fn(),
    edgesHidden: false,
    onEdgesToggle: vi.fn(),
    minimapVisible: false,
    onMinimapToggle: vi.fn(),
    ...overrides,
  }
  render(<CanvasViewControls {...props} />)
  return props
}

it('左下只显示四个图标与百分比，顺序固定且不再提供额外菜单', () => {
  mount()
  const bar = screen.getByRole('toolbar', { name: '画布视图控制' })
  expect(
    within(bar)
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label')),
  ).toEqual(['整理画布', '小地图', '隐藏连线', '网格吸附', '当前缩放 89%，点击回到 100%'])
  expect(bar.querySelector('[aria-haspopup],[aria-expanded],select')).toBeNull()
  expect(screen.queryByText('更多视图选项')).not.toBeInTheDocument()
})
it('整理、地图、连线和磁吸分别执行原有操作', async () => {
  const user = userEvent.setup(),
    props = mount()
  for (const name of ['整理画布', '小地图', '隐藏连线', '网格吸附'])
    await user.click(screen.getByRole('button', { name }))
  for (const callback of [props.onArrange, props.onMinimapToggle, props.onEdgesToggle, props.onSnapToggle])
    expect(callback).toHaveBeenCalledOnce()
})
it('百分比保持真实倍率，点击直接复位，不打开任何菜单', async () => {
  const user = userEvent.setup(),
    props = mount()
  await user.click(screen.getByRole('button', { name: /当前缩放 89%/ }))
  expect(props.onZoomReset).toHaveBeenCalledOnce()
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  expect(screen.getAllByRole('button')).toHaveLength(5)
})
it('开关提供当前状态和准确的下一步提示', () => {
  mount({ snapEnabled: true, minimapVisible: true, edgesHidden: true })
  for (const name of ['小地图', '隐藏连线', '网格吸附'])
    expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: '隐藏连线' })).toHaveAttribute('title', '显示连线')
  expect(screen.getByRole('button', { name: '小地图' })).toHaveAttribute('title', '隐藏小地图')
})
it('极小倍率下百分比不显示为零', () => {
  mount({ zoom: 0.002 })
  expect(screen.getByRole('button', { name: /当前缩放 1%/ })).toHaveTextContent('1%')
})
