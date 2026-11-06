import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import CanvasFloatingToolbar from '@/components/canvas/CanvasFloatingToolbar'

it('从添加菜单手动创建音频编辑节点并关闭菜单', async () => {
  const user = userEvent.setup()
  const onAddNode = vi.fn()
  render(
    <CanvasFloatingToolbar
      onAddNode={onAddNode}
      onAddLocalImage={vi.fn()}
      panModeEnabled={false}
      onPanModeToggle={vi.fn()}
      dragEnabled
      onDragToggle={vi.fn()}
      onOpenSearch={vi.fn()}
      onOpenAssets={vi.fn()}
      onOpenHelp={vi.fn()}
      onOpenHistory={vi.fn()}
    />,
  )
  expect(screen.queryByRole('button', { name: /DoDo Agent/ })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '添加节点' }))
  expect(await screen.findByRole('menuitem', { name: /音频节点/ })).toBeInTheDocument()
  await user.click(screen.getByRole('menuitem', { name: /音频编辑/ }))
  expect(onAddNode).toHaveBeenCalledWith('audio-editor')
  await waitFor(() => expect(screen.queryByRole('menuitem', { name: /音频编辑/ })).not.toBeInTheDocument())
})
