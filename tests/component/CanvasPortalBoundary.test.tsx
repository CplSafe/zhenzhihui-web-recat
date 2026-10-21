import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CanvasPortalBoundary from '@/components/canvas/CanvasPortalBoundary'
import { createPortal } from 'react-dom'

describe('画布 Portal 事件隔离', () => {
  it('弹窗按钮仍能操作，但点击和按下不会冒泡到节点', () => {
    const selectNode = vi.fn()
    const close = vi.fn()
    render(
      <div onClick={selectNode} onPointerDown={selectNode} onMouseDown={selectNode}>
        {createPortal(
          <CanvasPortalBoundary>
            <button onClick={close}>关闭测试弹窗</button>
          </CanvasPortalBoundary>,
          document.body,
        )}
      </div>,
    )
    const button = screen.getByRole('button', { name: '关闭测试弹窗' })
    fireEvent.pointerDown(button)
    fireEvent.mouseDown(button)
    fireEvent.click(button)
    expect(close).toHaveBeenCalledOnce()
    expect(selectNode).not.toHaveBeenCalled()
  })
})
