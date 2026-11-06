import { ConfigProvider } from 'antd'
import { render, screen, within, waitFor } from '@testing-library/react'
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
  render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <CanvasViewControls {...props} />
    </ConfigProvider>,
  )
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
it('开关悬停显示下一步操作，离开后关闭气泡', async () => {
  const user = userEvent.setup()
  mount({ snapEnabled: true, minimapVisible: true, edgesHidden: true })
  for (const [name, hint] of [
    ['隐藏连线', '显示节点连线'],
    ['小地图', '隐藏小地图'],
    ['网格吸附', '关闭网格吸附'],
  ]) {
    const button = screen.getByRole('button', { name })
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(button).not.toHaveAttribute('title')
    await user.hover(button)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(hint)
    await user.unhover(button)
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument())
  }
})
it('键盘聚焦也显示提示，不触发任何操作', async () => {
  const user = userEvent.setup()
  const props = mount()
  await user.tab()
  expect(await screen.findByRole('tooltip')).toHaveTextContent('整理画布')
  expect(props.onArrange).not.toHaveBeenCalled()
})
it('连线开启时提示隐藏节点连线', async () => {
  const user = userEvent.setup()
  mount()
  await user.hover(screen.getByRole('button', { name: '隐藏连线' }))
  expect(await screen.findByRole('tooltip')).toHaveTextContent('隐藏节点连线')
})
it('极小倍率下百分比不显示为零', () => {
  mount({ zoom: 0.002 })
  expect(screen.getByRole('button', { name: /当前缩放 1%/ })).toHaveTextContent('1%')
})
