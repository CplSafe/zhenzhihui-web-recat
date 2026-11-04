import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import CanvasDragStablePanel from '@/components/canvas/CanvasDragStablePanel'

it('拖动时保留面板，松手或切换节点后接收最新内容', () => {
  const panel = (dragging: boolean, nodeId: string, value: string) => (
    <CanvasDragStablePanel dragging={dragging} nodeId={nodeId}>
      <input aria-label="提示词" defaultValue={value} />
      <span>{value}</span>
    </CanvasDragStablePanel>
  )
  const view = render(panel(false, 'a', '初始'))
  const input = screen.getByLabelText('提示词') as HTMLInputElement
  input.value = '用户输入'
  view.rerender(panel(true, 'a', '拖动开始'))
  view.rerender(panel(true, 'a', '拖动中更新'))
  expect(screen.getByText('拖动开始')).toBeTruthy()
  expect(input.value).toBe('用户输入')
  view.rerender(panel(false, 'a', '松手后更新'))
  expect(screen.getByText('松手后更新')).toBeTruthy()
  expect(screen.getByLabelText('提示词')).toBe(input)
  view.rerender(panel(true, 'a', '再次拖动'))
  view.rerender(panel(true, 'b', '切换节点'))
  expect(screen.getByText('切换节点')).toBeTruthy()
})
