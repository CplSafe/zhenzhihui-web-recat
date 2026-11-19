import { render, screen, fireEvent } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import CanvasAgentReadOnly from '@/components/canvas/CanvasAgentReadOnly'
import { guardCanvasReadOnlyInteraction } from '@/utils/canvasReadOnly'

it('shows a non-modal read-only status without unlocking on entry', () => {
  const unlock = vi.fn()
  render(<CanvasAgentReadOnly owner="成员甲" onUnlock={unlock} />)
  expect(screen.getByRole('status')).toHaveTextContent('成员甲 已锁定画布 · 当前只读')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  expect(unlock).not.toHaveBeenCalled()
})

it('requires an explicit authorized unlock and refuses while the Agent is running', () => {
  const unlock = vi.fn().mockResolvedValue(undefined)
  const lock = { id: 'locked', owner_id: 7, owner: '成员甲', running: true, can_unlock: true }
  const view = render(<CanvasAgentReadOnly owner="成员甲" lock={lock} onUnlock={unlock} />)
  fireEvent.click(screen.getByRole('button', { name: '管理员解锁' }))
  expect(unlock).not.toHaveBeenCalled()
  view.rerender(<CanvasAgentReadOnly owner="成员甲" lock={{ ...lock, running: false }} onUnlock={unlock} />)
  fireEvent.click(screen.getByRole('button', { name: '管理员解锁' }))
  expect(unlock).toHaveBeenCalledExactlyOnceWith('locked')
})

it('blocks node editing and source handles but permits viewport and viewing controls', () => {
  const action = vi.fn()
  render(
    <div
      onClickCapture={guardCanvasReadOnlyInteraction}
      onPointerDownCapture={guardCanvasReadOnlyInteraction}
      onKeyDownCapture={guardCanvasReadOnlyInteraction}
    >
      <div className="react-flow__node">
        <button onClick={action} onPointerDown={action} onKeyDown={action}>
          编辑
        </button>
        <button className="react-flow__handle source" onClick={action}>
          连线
        </button>
      </div>
      <div className="react-flow__pane" data-testid="pane" onPointerDown={action} />
      <div data-canvas-readonly-control>
        <button onClick={action}>缩放</button>
      </div>
      <video data-testid="video" onClick={action} />
    </div>,
  )
  const edit = screen.getByRole('button', { name: '编辑' })
  fireEvent.click(edit)
  fireEvent.pointerDown(edit)
  fireEvent.keyDown(edit, { key: 'Enter' })
  fireEvent.click(screen.getByRole('button', { name: '连线' }))
  expect(action).not.toHaveBeenCalled()
  fireEvent.pointerDown(screen.getByTestId('pane'))
  fireEvent.click(screen.getByRole('button', { name: '缩放' }))
  fireEvent.click(screen.getByTestId('video'))
  expect(action).toHaveBeenCalledTimes(3)
})
